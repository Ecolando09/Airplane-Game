import * as THREE from 'three';

// Local split screen: up to 3 more players on the same screen, each with their
// own controller and quarter of the screen.
//
// Every extra player runs a full copy of the game in their quarter (an iframe
// with ?player=N&pad=I), so they can do everything player 1 can: robot,
// growing, driving, games, their own menu and settings. The copies and player
// 1 meet in one multiplayer room (made automatically if player 1 isn't in one),
// so they see each other, share smashed buildings and play room games. The
// room's city and look are shared; player 1 (the host) can change them.
//
// Join: press ☰ (Menu) on another controller. Leave: hold ☰ for 1.5 seconds.
// Layout: 2 players side by side; 3 or 4 in quarters (with 3, the fourth
// quarter is an overview camera that keeps everyone in sight).

export const PLAYER_COLORS = ['#e03131', '#1c7ed6', '#2f9e44', '#f59f00'];
const MAX_GUESTS = 3;
const LEAVE_HOLD = 1.5; // seconds holding ☰ to leave
const _v = new THREE.Vector3();

/** In a player 2-4 copy of the game: that player's number (else 0). */
export const SPLIT_CHILD = (() => {
  const n = +new URLSearchParams(location.search).get('player');
  return n >= 2 && n <= 4 && window.parent !== window ? n : 0;
})();

/** Screen rectangles (CSS pixels, top-left origin) for n views. */
export function splitRects(n, W, H) {
  const hw = Math.floor(W / 2);
  const hh = Math.floor(H / 2);
  if (n <= 1) return [{ x: 0, y: 0, w: W, h: H }];
  if (n === 2) return [{ x: 0, y: 0, w: hw, h: H }, { x: hw, y: 0, w: W - hw, h: H }];
  return [
    { x: 0, y: 0, w: hw, h: hh }, { x: hw, y: 0, w: W - hw, h: hh },
    { x: 0, y: hh, w: hw, h: H - hh }, { x: hw, y: hh, w: W - hw, h: H - hh },
  ];
}

export class SplitScreen {
  /**
   * @param {object} o
   * @param {THREE.PerspectiveCamera} o.camera player 1's camera
   * @param {object} o.input player 1's Input (its pinned controller is never a guest's)
   * @param {() => string|null} o.ensureRoom the room code everyone meets in (joins one if needed)
   * @param {() => void} o.releaseRoom the last guest left (leave a room made just for split screen)
   * @param {(n, pad, room) => string} o.frameUrl the page a guest's copy of the game opens
   * @param {() => THREE.Vector3[]} o.others where the other players are (for the overview)
   * @param {(text, color) => void} o.toast
   * @param {(rect|null) => void} o.onLayout player 1's rectangle (null: full screen)
   */
  constructor(o) {
    Object.assign(this, o);
    this.guests = [];
    this.hinted = new Map(); // pad index -> time a "press ☰ to join" hint was shown
    this.prev = new Map(); // pad index -> previous button states
    this.overview = new THREE.PerspectiveCamera(55, 1, 1, 40000);
    this.overviewPos = new THREE.Vector3();
    this.overviewInit = false;
    this.root = Object.assign(document.createElement('div'), { id: 'split' });
    document.body.appendChild(this.root);
  }

  get active() {
    return this.guests.length > 0;
  }

  /** Controller indexes guests own (player 1 never uses these). */
  get padIndexes() {
    return new Set(this.guests.map((g) => g.pad));
  }

  _nextNumber() {
    for (let n = 2; n <= 4; n++) if (!this.guests.some((g) => g.n === n)) return n;
    return 0;
  }

  join(pad) {
    const n = this._nextNumber();
    if (!n) return;
    const room = this.ensureRoom();
    const frame = document.createElement('iframe');
    frame.className = 'split-frame';
    frame.allow = 'gamepad; autoplay; fullscreen';
    frame.src = this.frameUrl(n, pad, room);
    const box = Object.assign(document.createElement('div'), { className: 'split-box' });
    box.style.setProperty('--pc', PLAYER_COLORS[n - 1]);
    const badge = Object.assign(document.createElement('div'), { className: 'split-badge', innerHTML: `<b>P${n}</b>` });
    const msg = Object.assign(document.createElement('div'), { className: 'split-msg' });
    box.append(frame, badge, msg);
    this.root.appendChild(box);
    this.guests.push({ n, pad, box, frame, msg, holdSince: null, joinHeld: true });
    this.guests.sort((a, b) => a.n - b.n);
    this._layoutKey = null;
    this.toast(`🎮 Player ${n} joined! Hold ☰ to leave`, PLAYER_COLORS[n - 1]);
  }

  leave(g) {
    g.box.remove();
    this.guests = this.guests.filter((x) => x !== g);
    this._layoutKey = null;
    this.toast(`Player ${g.n} left`, PLAYER_COLORS[g.n - 1]);
    if (!this.guests.length) this.releaseRoom();
  }

  /** Read every controller: joins and leaves (guests' copies read their own controllers). */
  update(canJoin) {
    const pads = navigator.getGamepads?.() || [];
    const now = performance.now();
    for (const gp of pads) {
      if (!gp || gp.connected === false) continue;
      const i = gp.index;
      const prev = this.prev.get(i) || [];
      const down = (b) => !!gp.buttons[b]?.pressed;
      const fresh = (b) => down(b) && !prev[b];
      const g = this.guests.find((x) => x.pad === i);
      if (g) {
        if (g.joinHeld) g.joinHeld = down(9); // the press that joined doesn't count as a hold
        else if (down(9)) {
          g.holdSince ??= now;
          const held = (now - g.holdSince) / 1000;
          if (held > 0.4) g.msg.textContent = `Leaving… ${Math.max(0, LEAVE_HOLD - held).toFixed(1)}`;
          if (held >= LEAVE_HOLD) this.leave(g);
        } else if (g.holdSince != null) {
          g.holdSince = null;
          g.msg.textContent = '';
        }
      } else if (canJoin && i !== this.input.padIndex && this.input.padIndex != null && this.guests.length < MAX_GUESTS) {
        // A controller that isn't player 1's and isn't playing yet.
        if (fresh(9)) this.join(i);
        else if (gp.buttons.some((b) => b.pressed) && now - (this.hinted.get(i) || 0) > 6000) {
          this.hinted.set(i, now);
          const n = this._nextNumber();
          this.toast(`🎮 Press ☰ on this controller to join as Player ${n}`, PLAYER_COLORS[n - 1]);
        }
      }
      this.prev.set(i, gp.buttons.map((b) => !!b.pressed));
    }
    // A guest's controller unplugged: they leave.
    for (const g of [...this.guests]) if (!pads[g.pad] || pads[g.pad].connected === false) this.leave(g);
  }

  _updateOverview(dt, points) {
    const c = new THREE.Vector3();
    points.forEach((p) => c.add(p));
    c.divideScalar(points.length);
    let spread = 0;
    for (const p of points) spread = Math.max(spread, Math.hypot(p.x - c.x, p.z - c.z));
    const dist = Math.min(4000, Math.max(120, spread * 2.2 + 80));
    const want = c.clone().add(_v.set(0, dist * 0.75, dist * 0.65));
    if (!this.overviewInit) this.overviewPos.copy(want), (this.overviewInit = true);
    this.overviewPos.lerp(want, 1 - Math.exp(-dt * 2));
    this.overview.position.copy(this.overviewPos);
    this.overview.up.set(0, 1, 0);
    this.overview.lookAt(c);
    this.overview.far = this.camera.far;
  }

  /** Draw player 1's view (and, with 3 players, the overview) into their part of the screen. */
  render(renderer, scene, { p1Pos, sun, sunDir, cull, dt }) {
    const W = innerWidth;
    const H = innerHeight;
    const n = 1 + this.guests.length;
    const rects = splitRects(n, W, H);
    this._layout(rects);
    const views = [{ cam: this.camera, rect: rects[0], focus: p1Pos }];
    if (n === 3) {
      this._updateOverview(dt, [p1Pos, ...this.others()].filter(Boolean));
      views.push({ cam: this.overview, rect: rects[3], focus: null });
    }
    renderer.setScissorTest(true);
    views.forEach((v, i) => {
      const r = v.rect;
      const aspect = r.w / r.h;
      if (v.cam.aspect !== aspect) {
        v.cam.aspect = aspect;
        v.cam.updateProjectionMatrix();
      }
      renderer.setViewport(r.x, H - r.y - r.h, r.w, r.h);
      renderer.setScissor(r.x, H - r.y - r.h, r.w, r.h);
      renderer.shadowMap.autoUpdate = i === 0; // the overview reuses player 1's shadows
      if (i === 0 && v.focus) {
        sun.target.position.copy(v.focus);
        sun.position.copy(v.focus).addScaledVector(sunDir, 800);
      }
      cull?.(v.cam.position);
      renderer.render(scene, v.cam);
    });
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.shadowMap.autoUpdate = true;
  }

  /** Put player 1's HUD and the guests' copies of the game over their parts of the screen. */
  _layout(rects) {
    const key = `${rects.length}:${innerWidth}x${innerHeight}:${this.guests.map((g) => g.n).join(',')}`;
    if (key === this._layoutKey) return;
    this._layoutKey = key;
    document.body.classList.add('split');
    document.body.dataset.split = String(rects.length);
    this.onLayout(rects[0]);
    this.guests.forEach((g, i) => {
      const r = rects[i + 1];
      Object.assign(g.box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    });
    this.root.querySelectorAll('.split-line, .split-overview').forEach((l) => l.remove());
    const W = innerWidth;
    const H = innerHeight;
    const line = (css) => (this.root.appendChild(Object.assign(document.createElement('div'), { className: 'split-line' })).style.cssText = css);
    line(`left:${Math.floor(W / 2) - 2}px;top:0;width:4px;height:${H}px`);
    if (rects.length > 2) line(`left:0;top:${Math.floor(H / 2) - 2}px;width:${W}px;height:4px`);
    if (rects.length === 4 && this.guests.length === 2) {
      const r = rects[3];
      const cap = Object.assign(document.createElement('div'), { className: 'split-overview', textContent: '🗺️ Everyone' });
      Object.assign(cap.style, { left: `${r.x + 12}px`, top: `${r.y + 12}px` });
      this.root.appendChild(cap);
    }
  }

  /** Back to one full-screen view (everyone left). */
  endLayout() {
    if (!document.body.classList.contains('split')) return;
    this._layoutKey = null;
    document.body.classList.remove('split');
    delete document.body.dataset.split;
    this.root.querySelectorAll('.split-line, .split-overview').forEach((l) => l.remove());
    this.overviewInit = false;
    this.onLayout(null);
  }
}

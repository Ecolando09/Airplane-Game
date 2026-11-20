import * as THREE from 'three';
import { GROUND_TILT, MAIN_CONTACT } from './airplane.js';

// Local split screen: up to 3 more players on the same screen, each with their
// own controller, vehicle and quarter of the screen. Player 1 is the full game
// (menus, games, robot, everything); players 2-4 fly a plane, copter or shuttle.
//
// Join: press ☰ (Menu/START) on another controller while flying.
// Guest buttons: tap ☰ for your own settings (vehicle, paint, invert,
// sensitivity), Y change vehicle, RB turbo, B floats, A brakes (after a crash:
// respawn), View restart on the runway, hold ☰ to leave. Each player number's
// settings are remembered on this device; city, look and sky are shared.
//
// Layout: 2 players side by side; 3 or 4 in quarters (with 3, the fourth
// quarter is an overview camera that keeps everyone in sight).

export const PLAYER_COLORS = ['#e03131', '#1c7ed6', '#2f9e44', '#f59f00'];
export const PLAYER_PAINTS = [null, 'blue', 'green', 'gold'];
const KINDS = ['plane', 'heli', 'jet'];
const KIND_NAME = { plane: '✈️ Bush Plane', heli: '🕷️ Copter', jet: '🛫 Shuttle' };
const MAX_GUESTS = 3;
const SENS = [50, 75, 100, 125, 150];
const loadSettings = (n) => {
  try {
    return JSON.parse(localStorage.getItem(`legosky.split.p${n}`)) || {};
  } catch {
    return {};
  }
};
const LEAVE_HOLD = 1.5; // seconds holding ☰ to leave
const AXIS_X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();

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
   * @param {THREE.Scene} o.scene
   * @param {THREE.PerspectiveCamera} o.camera player 1's camera
   * @param {object} o.input player 1's Input (its pinned controller is never a guest's)
   * @param {() => object} o.getWorld
   * @param {(kind: string, player: number) => object} o.makeModel a painted model, already in the scene
   * @param {(model, kind) => object} o.newFlight
   * @param {() => ({pos, heading, kind}|null)} o.getP1 player 1's vehicle
   * @param {() => object} o.prefs invert / sens
   * @param {(text: string, color: string) => void} o.toast
   * @param {(rect|null) => void} o.onLayout player 1's rectangle (null: full screen)
   * @param {(objs) => void} o.dispose
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
    this.lastN = 1;
  }

  get active() {
    return this.guests.length > 0;
  }

  /** Controller indexes guests own (player 1 never uses these). */
  get padIndexes() {
    return new Set(this.guests.map((g) => g.pad));
  }

  // ------------------------------------------------------------ joining and leaving
  _nextNumber() {
    for (let n = 2; n <= 4; n++) if (!this.guests.some((g) => g.n === n)) return n;
    return 0;
  }

  join(padIndex) {
    const n = this._nextNumber();
    if (!n) return;
    const p1 = this.getP1();
    const saved = loadSettings(n);
    const kind = KINDS.includes(saved.kind) ? saved.kind : p1 && KINDS.includes(p1.kind) ? p1.kind : 'plane';
    const g = {
      n, pad: padIndex, kind, color: PLAYER_COLORS[n - 1],
      opts: { paint: saved.paint || PLAYER_PAINTS[n - 1], invert: !!saved.invert, sens: SENS.includes(saved.sens) ? saved.sens : 100 },
      cam: new THREE.PerspectiveCamera(this.camera.fov, 1, 0.3, this.camera.far),
      camOff: new THREE.Vector3(), camLookOff: new THREE.Vector3(), camFwd: new THREE.Vector3(0, 0, -1), camPos: new THREE.Vector3(), camLook: new THREE.Vector3(), camInit: false,
      tilt: 0, booster: 0, floatsAnim: 0, trail: [], trailT: 0, debris: [], leaveHold: 0, needSpawn: true, joinHeld: true,
    };
    this._buildVehicle(g);
    this._buildHud(g);
    this.guests.push(g);
    this.guests.sort((a, b) => a.n - b.n);
    this.toast(`🎮 Player ${n} joined! Hold ☰ to leave`, g.color);
  }

  leave(g) {
    this._clearDebris(g);
    this.dispose([g.model.group]);
    g.hud.remove();
    g.tag?.remove();
    for (const o of this.guests) o.tags?.get(g.n)?.remove(), o.tags?.delete(g.n);
    this.p1Tags?.get(g.n)?.remove();
    this.p1Tags?.delete(g.n);
    this.guests = this.guests.filter((x) => x !== g);
    this.toast(`Player ${g.n} left`, g.color);
  }

  /** The world (city or look) changed: rebuild every guest's vehicle; they respawn near player 1. */
  rebuild() {
    for (const g of this.guests) {
      this._clearDebris(g);
      this.dispose([g.model.group]);
      this._buildVehicle(g);
      g.needSpawn = true;
    }
  }

  _buildVehicle(g) {
    if (!this.paints().some((x) => x.id === g.opts.paint)) g.opts.paint = 'classic'; // (not unlocked here)
    g.model = this.makeModel(g.kind, g.n, g.opts.paint);
    g.flight = this.newFlight(g.model, g.kind);
    g.isHeli = g.kind === 'heli';
    g.tilt = 0;
    g.floatsAnim = 0;
    g.camInit = false;
  }

  _buildHud(g) {
    g.hud = document.createElement('div');
    g.hud.className = 'split-hud';
    g.hud.style.setProperty('--pc', g.color);
    g.hud.innerHTML = `
      <div class="split-badge"><b>P${g.n}</b><span class="split-kind"></span></div>
      <div class="split-stats"><span><b class="split-spd">0</b> MPH</span><span><b class="split-alt">0</b> FT</span><span class="split-turbo"></span></div>
      <div class="split-msg"></div>
      <div class="split-help">☰ settings · Y vehicle · RB turbo · B floats · hold ☰ leave</div>
      <div class="split-menu" hidden></div>`;
    g.els = {
      kind: g.hud.querySelector('.split-kind'), spd: g.hud.querySelector('.split-spd'), alt: g.hud.querySelector('.split-alt'),
      turbo: g.hud.querySelector('.split-turbo'), msg: g.hud.querySelector('.split-msg'), help: g.hud.querySelector('.split-help'), menu: g.hud.querySelector('.split-menu'),
    };
    g.helpUntil = performance.now() + 8000;
    this.root.appendChild(g.hud);
  }

  // ------------------------------------------------------------ spawning
  /** In the air beside player 1 (or over downtown), heading the same way. */
  _spawn(g) {
    const f = g.flight;
    this._clearDebris(g);
    const p1 = this.getP1();
    const world = this.getWorld();
    f.resetAirborne();
    f.turbo = 1;
    f.turboNow = 1;
    if (p1) {
      const yaw = -THREE.MathUtils.degToRad(p1.heading);
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const side = g.n % 2 ? -1 : 1; // P2 right, P3 left, P4 right again and farther
      const pos = p1.pos.clone().addScaledVector(right, side * 30 * Math.ceil((g.n - 1) / 2)).addScaledVector(back, 20 * (g.n - 1));
      pos.y = Math.max(pos.y + 20, world.heightAt(pos.x, pos.z) + g.model.gearHeight + (g.isHeli ? 30 : 70));
      for (let i = 0; i < 40 && world.hitsObstacle(pos, 8); i++) pos.y += 10;
      this._place(g, pos, yaw);
    }
    g.trail = [];
    g.camInit = false;
    g.needSpawn = false;
    g.els.msg.textContent = '';
  }

  _place(g, pos, yaw) {
    const f = g.flight;
    f.pos.copy(pos);
    if (g.isHeli) {
      f.yaw = yaw;
      f._updateQuat();
    } else {
      f.quat.setFromAxisAngle(Y, yaw);
      f.speed = Math.max(f.speed, 45);
      f.throttle = Math.max(f.throttle, 0.7);
      f.vel.copy(f.forward).multiplyScalar(f.speed);
      f.onGround = false;
    }
  }

  /** After a crash: back where they were a few seconds earlier, lifted clear. */
  _respawnHere(g) {
    const snap = g.trail[Math.max(0, g.trail.length - 7)];
    if (!snap) return this._spawn(g);
    const world = this.getWorld();
    const { floats, turbo } = g.flight;
    this._clearDebris(g);
    g.flight.resetAirborne();
    g.flight.floats = floats;
    g.flight.turbo = g.flight.turboNow = turbo || 1;
    const pos = snap.pos.clone();
    pos.y = Math.max(pos.y, world.heightAt(pos.x, pos.z) + g.model.gearHeight + (g.isHeli ? 25 : 60));
    for (let i = 0; i < 40 && world.hitsObstacle(pos, 8); i++) pos.y += 10;
    this._place(g, pos, -THREE.MathUtils.degToRad(snap.heading));
    g.trail = [{ pos: pos.clone(), heading: snap.heading }];
    g.camInit = false;
    g.els.msg.textContent = '';
  }

  _restartRunway(g) {
    this._clearDebris(g);
    g.flight.reset();
    // Side by side on the runway (or helipad), so nobody starts inside player 1.
    const world = this.getWorld();
    const yaw = g.isHeli ? g.flight.yaw : -THREE.MathUtils.degToRad(world.runway.heading);
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    g.flight.pos.addScaledVector(right, (g.n % 2 ? -1 : 1) * 14 * Math.ceil((g.n - 1) / 2));
    g.flight.pos.addScaledVector(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), 12 * (g.n - 1));
    g.flight.pos.y = world.heightAt(g.flight.pos.x, g.flight.pos.z) + g.model.gearHeight;
    g.tilt = g.isHeli || g.model.level ? 0 : GROUND_TILT;
    g.trail = [];
    g.camInit = false;
    g.els.msg.textContent = '';
  }

  _changeVehicle(g, kind = KINDS[(KINDS.indexOf(g.kind) + 1) % KINDS.length]) {
    const pos = g.flight.pos.clone();
    const heading = g.flight.heading;
    const crashed = g.flight.crashed;
    this._clearDebris(g);
    this.dispose([g.model.group]);
    g.kind = kind;
    this._save(g);
    this._buildVehicle(g);
    g.flight.resetAirborne();
    if (crashed) return this._spawn(g);
    const world = this.getWorld();
    pos.y = Math.max(pos.y, world.heightAt(pos.x, pos.z) + g.model.gearHeight + (g.isHeli ? 15 : 40));
    this._place(g, pos, -THREE.MathUtils.degToRad(heading));
    g.els.msg.textContent = '';
  }

  // ------------------------------------------------------------ crash debris
  _explode(g) {
    const { model, flight } = g;
    const q = model.group.quaternion;
    for (const p of model.parts || []) {
      const s = p.size.clone().multiplyScalar(0.45);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.x, s.y, s.z), new THREE.MeshLambertMaterial({ color: p.color }));
      mesh.position.copy(p.pos).applyQuaternion(q).add(model.group.position);
      const v = flight.vel.clone().multiplyScalar(0.25).add(new THREE.Vector3().randomDirection().multiplyScalar(10));
      v.y = Math.abs(v.y) + 6;
      this.scene.add(mesh);
      g.debris.push({ mesh, v, spin: new THREE.Vector3().randomDirection().multiplyScalar(6) });
    }
    model.group.visible = false;
  }

  _clearDebris(g) {
    for (const d of g.debris) {
      this.scene.remove(d.mesh);
      d.mesh.geometry.dispose();
      d.mesh.material.dispose();
    }
    g.debris = [];
    if (g.model) g.model.group.visible = true;
  }

  _updateDebris(g, dt) {
    const world = this.getWorld();
    for (const d of g.debris) {
      d.v.y -= 9.81 * dt;
      d.mesh.position.addScaledVector(d.v, dt);
      const gy = world.heightAt(d.mesh.position.x, d.mesh.position.z) + 0.3;
      if (d.mesh.position.y < gy) {
        d.mesh.position.y = gy;
        d.v.multiplyScalar(0.6);
        d.v.y = Math.abs(d.v.y) * 0.5;
        d.spin.multiplyScalar(0.7);
      }
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
    }
  }

  // ------------------------------------------------------------ controllers
  _readPad(g, gp) {
    const dz = (v) => (Math.abs(v) < 0.16 ? 0 : v);
    const ax = (i) => dz(gp.axes[i] ?? 0);
    let pitch = 0;
    let roll = ax(0);
    let throttle = 0;
    let liftSet;
    const yaw = ax(2);
    if (g.isHeli) {
      if (ax(3)) liftSet = -ax(3);
    } else pitch = -ax(1);
    const rt = gp.buttons[7]?.value ?? 0;
    const lt = gp.buttons[6]?.value ?? 0;
    if (rt || lt) throttle = rt - lt;
    else if (g.isHeli) throttle = -ax(1);
    else throttle = -ax(3);
    if (g.opts.invert && !g.isHeli) pitch = -pitch;
    const sens = g.opts.sens / 100;
    const lim = (v) => Math.max(-1, Math.min(1, v * sens));
    return { pitch: lim(pitch), roll: lim(roll), yaw, throttle, throttleSet: undefined, liftSet, brake: !!gp.buttons[0]?.pressed, run: false };
  }

  /** Read every controller: joins, leaves and guests' buttons. */
  _pollPads(dt, running) {
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
        if (running) this._guestButtons(g, gp, fresh, down, dt);
      } else if (i !== this.input.padIndex && this.input.padIndex != null) {
        // A controller that isn't player 1's and isn't playing yet.
        const pressed = gp.buttons.some((b) => b.pressed);
        if (running && fresh(9) && this.guests.length < MAX_GUESTS) this.join(i);
        else if (running && pressed && this.guests.length < MAX_GUESTS && now - (this.hinted.get(i) || 0) > 6000) {
          this.hinted.set(i, now);
          this.toast(`🎮 Press ☰ on this controller to join as Player ${this._nextNumber()}`, PLAYER_COLORS[this._nextNumber() - 1]);
        }
      }
      this.prev.set(i, gp.buttons.map((b) => !!b.pressed));
    }
    // A guest's controller unplugged: they leave.
    for (const g of [...this.guests]) if (!pads[g.pad] || pads[g.pad].connected === false) this.leave(g);
  }

  _guestButtons(g, gp, fresh, down, dt) {
    const f = g.flight;
    if (g.joinHeld) {
      // The ☰ press that joined isn't also a tap (settings) or a hold (leave).
      if (down(9)) return;
      g.joinHeld = false;
    }
    if (g.menuOpen && !down(9) && !g.leaveHold) return this._menuButtons(g, gp, fresh);
    if (down(9)) {
      g.holdSince ??= performance.now(); // real time, so a slow frame rate doesn't stretch it
      g.leaveHold = Math.max(1e-3, (performance.now() - g.holdSince) / 1000);
      g.els.msg.textContent = `Leaving… ${Math.max(0, LEAVE_HOLD - g.leaveHold).toFixed(1)}`;
      if (g.leaveHold >= LEAVE_HOLD) return this.leave(g);
    } else if (g.leaveHold > 0) {
      // A tap of ☰: after a crash it respawns; otherwise nothing.
      if (g.leaveHold < 0.4 && f.crashed) this._respawnHere(g);
      else if (g.leaveHold < 0.4) this._openMenu(g, !g.menuOpen);
      if (!f.crashed) g.els.msg.textContent = '';
      g.leaveHold = 0;
      g.holdSince = null;
    }
    if (fresh(3)) this._changeVehicle(g);
    if (fresh(8)) this._restartRunway(g);
    if (f.crashed && fresh(0)) this._respawnHere(g);
    if (fresh(5) && !f.crashed) {
      f.turbo = (f.turbo % 3) + 1;
      g.els.msg.textContent = f.turbo === 1 ? 'Turbo off' : `🚀 T${f.turbo}X`;
      g.msgT = 1.5;
    }
    if (fresh(1) && !f.crashed && g.kind === 'plane') f.floats = !f.floats;
  }

  // ------------------------------------------------------------ settings
  _save(g) {
    try {
      localStorage.setItem(`legosky.split.p${g.n}`, JSON.stringify({ kind: g.kind, ...g.opts }));
    } catch {}
  }

  _openMenu(g, on) {
    g.menuOpen = on;
    g.menuRow ??= 0;
    g.els.menu.hidden = !on;
    g.helpUntil = 0;
    if (on) this._drawMenu(g);
  }

  _menuRows(g) {
    const paints = this.paints();
    const paint = paints.find((x) => x.id === g.opts.paint) || paints[0];
    return [
      { key: 'kind', label: 'Fly', value: KIND_NAME[g.kind] },
      { key: 'paint', label: 'Paint', value: paint.name, swatch: paint.color },
      { key: 'invert', label: 'Invert up/down', value: g.opts.invert ? 'On' : 'Off' },
      { key: 'sens', label: 'Steering', value: `${g.opts.sens}%` },
      { key: 'runway', label: 'Restart on the runway', action: true },
      { key: 'leave', label: 'Leave the game', action: true },
      { key: 'close', label: 'Back to flying', action: true },
    ];
  }

  _drawMenu(g) {
    const rows = this._menuRows(g);
    g.menuRow = Math.max(0, Math.min(rows.length - 1, g.menuRow));
    g.els.menu.innerHTML = `<h3>P${g.n} settings</h3>` + rows.map((r, i) => {
      const sw = r.swatch === 'rainbow' ? '<i class="sw rainbow"></i>' : r.swatch ? `<i class="sw" style="background:${r.swatch}"></i>` : r.key === 'paint' ? '<i class="sw classic"></i>' : '';
      return `<div class="row${i === g.menuRow ? ' sel' : ''}${r.action ? ' act' : ''}"><span>${r.label}</span>${r.action ? '' : `<b>‹ ${sw}${r.value} ›</b>`}</div>`;
    }).join('') + '<small>D-pad: choose · ‹ › or A: change · B: close</small>';
  }

  _menuButtons(g, gp, fresh) {
    // Stick or D-pad, one step per push.
    const ax = gp.axes[0] || 0;
    const ay = gp.axes[1] || 0;
    const dir = gp.buttons[12]?.pressed || ay < -0.6 ? 'up' : gp.buttons[13]?.pressed || ay > 0.6 ? 'down' : gp.buttons[14]?.pressed || ax < -0.6 ? 'left' : gp.buttons[15]?.pressed || ax > 0.6 ? 'right' : '';
    const moved = dir && dir !== g.menuDir;
    g.menuDir = dir;
    if (fresh(1)) return this._openMenu(g, false);
    const rows = this._menuRows(g);
    if (moved && dir === 'up') g.menuRow = (g.menuRow + rows.length - 1) % rows.length;
    if (moved && dir === 'down') g.menuRow = (g.menuRow + 1) % rows.length;
    const step = moved && dir === 'left' ? -1 : (moved && dir === 'right') || fresh(0) ? 1 : 0;
    if (step) {
      const r = rows[g.menuRow];
      const cyc = (list, v) => list[(list.indexOf(v) + step + list.length) % list.length];
      if (r.key === 'kind') this._changeVehicle(g, cyc(KINDS, g.kind));
      else if (r.key === 'paint') {
        g.opts.paint = cyc(this.paints().map((x) => x.id), g.opts.paint);
        this._repaint(g);
      } else if (r.key === 'invert') g.opts.invert = !g.opts.invert;
      else if (r.key === 'sens') g.opts.sens = SENS[Math.max(0, Math.min(SENS.length - 1, SENS.indexOf(g.opts.sens) + step))];
      else if (fresh(0) && r.key === 'runway') {
        this._restartRunway(g);
        return this._openMenu(g, false);
      } else if (fresh(0) && r.key === 'leave') return this.leave(g);
      else if (fresh(0) && r.key === 'close') return this._openMenu(g, false);
      this._save(g);
    }
    if (step || moved) this._drawMenu(g);
  }

  /** A new paint job: same vehicle, same place and speed. */
  _repaint(g) {
    const old = g.model;
    g.model = this.makeModel(g.kind, g.n, g.opts.paint);
    g.flight.plane = g.model;
    g.model.group.visible = old.group.visible;
    this.dispose([old.group]);
  }

  // ------------------------------------------------------------ per frame
  update(dt, running, elapsed) {
    this._pollPads(dt, running);
    if (!running) return;
    for (const g of this.guests) {
      if (g.needSpawn) this._spawn(g);
      const f = g.flight;
      const gp = navigator.getGamepads?.()[g.pad];
      if (!f.crashed && gp) {
        const ctl = g.menuOpen ? { pitch: 0, roll: 0, yaw: 0, throttle: 0, liftSet: g.isHeli ? 0 : undefined, brake: false, run: false } : this._readPad(g, gp);
        f.update(dt, ctl);
        if (f.crashed) {
          this._explode(g);
          g.els.msg.innerHTML = `💥 ${f.crashReason || 'Crashed!'}<small>Press A to respawn</small>`;
        }
      }
      this._updateDebris(g, dt);
      this._pose(g, dt, elapsed);
      // Trail for respawning in place.
      g.trailT -= dt;
      if (g.trailT <= 0 && !f.crashed) {
        g.trailT = 0.5;
        g.trail.push({ pos: f.pos.clone(), heading: f.heading });
        if (g.trail.length > 12) g.trail.shift();
      }
      if (g.msgT > 0 && (g.msgT -= dt) <= 0 && !f.crashed) g.els.msg.textContent = '';
      this._camera(g, dt);
      this._hud(g);
    }
  }

  _pose(g, dt, elapsed) {
    const { model, flight: f } = g;
    if (g.isHeli) {
      model.group.position.copy(f.pos);
      model.group.quaternion.copy(f.quat);
      model.animate?.(f, dt);
    } else {
      const want = f.onGround && !f.floats && !model.level ? GROUND_TILT * THREE.MathUtils.clamp(1 - f.speed / 24, 0, 1) : 0;
      g.tilt += (want - g.tilt) * (1 - Math.exp(-dt * 5));
      const tq = new THREE.Quaternion().setFromAxisAngle(AXIS_X, g.tilt);
      const offset = MAIN_CONTACT.clone().sub(MAIN_CONTACT.clone().applyQuaternion(tq)).applyQuaternion(f.quat);
      model.group.position.copy(f.pos).add(offset);
      model.group.quaternion.copy(f.quat).multiply(tq);
      const c = f.ctrl;
      if (model.controls) {
        const [l, r] = model.controls.ailerons;
        l.rotation.x = c.roll * 0.35;
        r.rotation.x = -c.roll * 0.35;
        model.controls.elevator.rotation.x = -c.pitch * 0.4;
        model.controls.rudder.rotation.y = c.yaw * 0.4;
      }
      if (!model.noProp && model.propeller) {
        model.propeller.rotation.z += (8 + f.throttle * 60) * dt;
        if (model.propDisc) model.propDisc.material.opacity = f.throttle * 0.25;
      }
      if (model.floats) {
        g.floatsAnim += ((f.floats ? 1 : 0) - g.floatsAnim) * (1 - Math.exp(-dt * 4));
        model.floats.visible = g.floatsAnim > 0.02;
        model.floats.scale.setScalar(Math.max(0.001, g.floatsAnim));
        for (const w of model.wheels || []) w.visible = g.floatsAnim < 0.6;
      }
    }
    const on = f.turbo > 1 && !f.crashed;
    g.booster += ((on ? 1 : 0) - g.booster) * (1 - Math.exp(-dt * 5));
    model.updateBoosters?.(g.booster, Math.max(f.turbo, 2), f.throttle, elapsed);
  }

  /** Chase camera, the same feel as player 1's. */
  _camera(g, dt) {
    const { flight: f, model } = g;
    const p = model.group.position;
    const flatF = f.forward.clone().setY(0).normalize();
    const wantF = g.isHeli ? flatF : f.forward.clone();
    if (!g.camInit) g.camFwd.copy(wantF);
    g.camFwd.lerp(wantF, 1 - Math.exp(-dt * 3)).normalize();
    let want = p.clone().addScaledVector(g.camFwd, -25).addScaledVector(flatF, -2).add(_v.set(0, 12.5, 0));
    let look = p.clone().addScaledVector(g.camFwd, 10).add(_v.set(0, 1.5, 0));
    if (f.crashed) {
      look = g.debris.length ? g.debris[0].mesh.position.clone() : p.clone();
      const away = g.camPos.clone().sub(look).setY(0);
      if (away.lengthSq() < 1) away.set(0, 0, 1);
      want = look.clone().addScaledVector(away.normalize(), 45).add(_v.set(0, 22, 0));
    }
    const ground = this.getWorld().heightAt(want.x, want.z) + 3;
    want.y = Math.max(want.y, ground);
    const wantOff = want.clone().sub(p);
    const lookOff = look.clone().sub(p);
    if (!g.camInit) {
      g.camOff.copy(wantOff);
      g.camLookOff.copy(lookOff);
      g.camPos.copy(want);
      g.camLook.copy(look);
      g.camInit = true;
    }
    const k = 1 - Math.exp(-dt * 7);
    g.camOff.lerp(wantOff, k);
    g.camLookOff.lerp(lookOff, 1 - Math.exp(-dt * 12));
    if (f.crashed) {
      g.camPos.lerp(want, k);
      g.camLook.lerp(look, k);
    } else {
      g.camPos.copy(p).add(g.camOff);
      g.camLook.copy(p).add(g.camLookOff);
      g.camPos.y = Math.max(g.camPos.y, ground);
    }
    g.cam.position.copy(g.camPos);
    g.cam.up.set(0, 1, 0).lerp(f.up, g.isHeli ? 0.08 : 0.25).normalize();
    g.cam.lookAt(g.camLook);
  }

  _hud(g) {
    const f = g.flight;
    const world = this.getWorld();
    g.els.kind.textContent = KIND_NAME[g.kind];
    g.els.spd.textContent = Math.round(f.speed * 2.237);
    g.els.alt.textContent = Math.round((f.pos.y - g.model.gearHeight + world.baseElevation) * 3.281);
    g.els.turbo.textContent = f.turbo > 1 ? `🚀T${f.turbo}X` : '';
    g.els.help.hidden = performance.now() > g.helpUntil;
  }

  // ------------------------------------------------------------ drawing
  /** Who is in each view: player 1 first, then guests by number; with 3 players a 4th overview. */
  _views(p1Pos) {
    const views = [{ cam: this.camera, focus: p1Pos, n: 1 }];
    for (const g of this.guests) views.push({ cam: g.cam, focus: g.model.group.position, n: g.n, g });
    if (views.length === 3) views.push({ cam: this.overview, focus: null, n: 0 });
    return views;
  }

  _updateOverview(dt, focusAll) {
    const c = new THREE.Vector3();
    focusAll.forEach((p) => c.add(p));
    c.divideScalar(focusAll.length);
    let spread = 0;
    for (const p of focusAll) spread = Math.max(spread, Math.hypot(p.x - c.x, p.z - c.z));
    const dist = Math.max(120, spread * 2.2 + 80);
    const want = c.clone().add(_v.set(0, dist * 0.75, dist * 0.65));
    if (!this.overviewInit) this.overviewPos.copy(want), (this.overviewInit = true);
    this.overviewPos.lerp(want, 1 - Math.exp(-dt * 2));
    this.overview.position.copy(this.overviewPos);
    this.overview.up.set(0, 1, 0);
    this.overview.lookAt(c);
    this.overview.far = this.camera.far;
  }

  /** Draw every view into its part of the screen. */
  render(renderer, scene, { p1Pos, sun, sunDir, cull, dt }) {
    const W = innerWidth;
    const H = innerHeight;
    this._frame ||= 1;
    const views = this._views(p1Pos);
    const rects = splitRects(views.length, W, H);
    this._layout(rects, views);
    if (views.some((v) => v.n === 0)) this._updateOverview(dt, views.filter((v) => v.focus).map((v) => v.focus));
    renderer.setScissorTest(true);
    views.forEach((v, i) => {
      const r = rects[i];
      const aspect = r.w / r.h;
      if (v.cam.aspect !== aspect || (v.cam !== this.camera && v.cam.far !== this.camera.far)) {
        v.cam.aspect = aspect;
        if (v.cam !== this.camera && v.cam !== this.overview) {
          v.cam.fov = this.camera.fov;
          v.cam.far = this.camera.far;
        }
        v.cam.updateProjectionMatrix();
      }
      renderer.setViewport(r.x, H - r.y - r.h, r.w, r.h);
      renderer.setScissor(r.x, H - r.y - r.h, r.w, r.h);
      // The sun's shadows follow whoever this view is for. With 3 or 4 views
      // that's too slow: the shadows are worked out once, around player 1.
      const shared = views.length >= 3;
      renderer.shadowMap.autoUpdate = !shared || i === 0;
      if (!shared || i === 0) {
        const at = v.focus || v.cam.position;
        sun.target.position.copy(at);
        sun.position.copy(at).addScaledVector(sunDir, 800);
      }
      cull?.(v.cam.position);
      renderer.render(scene, v.cam);
      this._tags(v, r, views);
    });
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.shadowMap.autoUpdate = true;
    // Tags from views that are gone (the overview after a 4th player joins) go away.
    for (const el of this.root.querySelectorAll('.split-tag')) {
      if (el._frame !== this._frame) el.style.display = 'none';
    }
    this._frame = (this._frame || 0) + 1;
  }

  /** Position player 1's HUD and the guests' HUDs over their views. */
  _layout(rects, views) {
    const key = `${rects.length}:${innerWidth}x${innerHeight}:${views.map((v) => v.n).join(',')}`;
    if (key === this._layoutKey) return;
    this._layoutKey = key;
    document.body.classList.add('split');
    document.body.dataset.split = String(rects.length);
    this.onLayout(rects[0]);
    views.forEach((v, i) => {
      if (!v.g) return;
      const r = rects[i];
      Object.assign(v.g.hud.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    });
    // Divider lines between views.
    this.root.querySelectorAll('.split-line').forEach((l) => l.remove());
    const W = innerWidth;
    const H = innerHeight;
    const line = (css) => this.root.appendChild(Object.assign(document.createElement('div'), { className: 'split-line' })).style.cssText = css;
    line(`left:${Math.floor(W / 2) - 2}px;top:0;width:4px;height:${H}px`);
    if (rects.length > 2) line(`left:0;top:${Math.floor(H / 2) - 2}px;width:${W}px;height:4px`);
    // The overview's caption.
    this.root.querySelector('.split-overview')?.remove();
    const oi = views.findIndex((v) => v.n === 0);
    if (oi >= 0) {
      const r = rects[oi];
      const cap = Object.assign(document.createElement('div'), { className: 'split-overview', textContent: '🗺️ Everyone' });
      Object.assign(cap.style, { left: `${r.x + 12}px`, top: `${r.y + 12}px` });
      this.root.appendChild(cap);
    }
  }

  /** Coloured name tags over the other local players, in this view. */
  _tags(v, r, views) {
    const store = v.g ? (v.g.tags ||= new Map()) : v.n === 1 ? (this.p1Tags ||= new Map()) : (this.ovTags ||= new Map());
    for (const o of views) {
      if (!o.focus || o.n === v.n) continue;
      let el = store.get(o.n);
      if (!el) {
        el = Object.assign(document.createElement('div'), { className: 'split-tag', textContent: `P${o.n}` });
        el.style.setProperty('--pc', PLAYER_COLORS[o.n - 1]);
        this.root.appendChild(el);
        store.set(o.n, el);
      }
      _v.copy(o.focus).add(Y.clone().multiplyScalar(5)).project(v.cam);
      const behind = _v.z > 1;
      // Off screen (or behind): pin the tag to the edge of the view, pointing the way.
      let x = _v.x;
      let y = _v.y;
      if (behind) {
        x = -x;
        y = -y;
      }
      const off = behind || Math.abs(x) > 0.95 || Math.abs(y) > 0.92;
      if (off) {
        const m = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.85, 1e-6);
        x /= m;
        y /= m;
      }
      const d = v.focus ? Math.round(o.focus.distanceTo(v.focus)) : 0;
      el.textContent = `P${o.n}${v.focus && (off || d > 150) ? ` · ${d < 1000 ? `${d} m` : `${(d / 1609).toFixed(1)} mi`}` : ''}`;
      el.classList.toggle('edge', off);
      el.style.left = `${r.x + (x * 0.5 + 0.5) * r.w}px`;
      el.style.top = `${r.y + (-y * 0.5 + 0.5) * r.h}px`;
      el.style.display = '';
      el._frame = this._frame;
    }
    // Tags for players no longer in this view.
    for (const [n, el] of store) if (!views.some((o) => o.n === n && o.focus && o.n !== v.n)) el.style.display = 'none';
  }

  /** Back to one full-screen view (everyone left). */
  endLayout() {
    if (!this._layoutKey) return;
    this._layoutKey = null;
    document.body.classList.remove('split');
    delete document.body.dataset.split;
    this.root.querySelectorAll('.split-line, .split-overview, .split-tag').forEach((l) => l.remove());
    this.p1Tags = null;
    this.ovTags = null;
    this.overviewInit = false;
    this.onLayout(null);
  }

  /** Hide the guest overlays while player 1 is in the menu. */
  setVisible(on) {
    this.root.hidden = !on;
  }

  /** Dots for the minimap: [{ x, z, color }]. */
  dots() {
    return this.guests.filter((g) => !g.flight.crashed).map((g) => ({ x: g.flight.pos.x, z: g.flight.pos.z, color: g.color, n: g.n }));
  }
}

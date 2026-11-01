import * as THREE from 'three';

// Beer Run: the Fort Collins delivery game.
// A shift lasts SHIFT seconds and you work one delivery at a time: load kegs
// at a brewery, then drop them at a shop before that delivery's timer runs
// out. Fly low through the glowing beam (or land in it) to load or unload.
// Pay grows with distance and how early you deliver, times an on-time streak;
// rush jobs pay double, VIPs tip, and Happy Hour boosts everything for a while.
// Crashing breaks the kegs on board, so you have to go back for more.

export const SHIFT = 300;
const ZONE = 90; // radius of a stop, meters
const LOW = 60; // highest you can be (above the ground) to load or unload in flight
const DWELL = 1.0; // seconds inside a stop to load or unload
const HAPPY_AT = 150; // Happy Hour starts with this many seconds left
const HAPPY_LEN = 40;
const NEXT_DELAY = 1.5; // seconds between one delivery and the next
export const STEP_COLORS = { load: '#ffb300', deliver: '#2ecc71' };

/** Ranks for the end-of-shift card, by money earned. */
const TITLES = [[0, 'Keg Rookie'], [250, 'Delivery Cadet'], [600, 'Hop Hauler'], [1000, 'Barrel Baron'],
  [1500, 'Ale Ace'], [2200, 'Brewmaster Pilot'], [3000, 'Legend of Old Town']];
export const titleFor = (cash) => TITLES.filter(([min]) => cash >= min).pop()[1];

const fmt = (n) => `$${Math.round(n).toLocaleString()}`;
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtDist = (m) => (m < 300 ? `${Math.round(m * 3.281)} ft` : `${(m / 1609).toFixed(1)} mi`);

export class BeerRun {
  /**
   * @param hooks.toast(text, color)  short notification
   * @param hooks.sound(kind)         'load' | 'cash' | 'miss' | 'break'
   * @param hooks.onEnd(stats)        the shift is over
   */
  constructor(scene, world, labelsEl, hooks) {
    this.scene = scene;
    this.world = world;
    this.hooks = hooks;
    const d = world.data.beerRun;
    const stop = (s, kind) => ({ ...s, kind, y: world.heightAt(s.x, s.z) });
    this.breweries = d.breweries.map((b) => stop(b, 'brewery'));
    this.shops = d.shops.map((s) => stop(s, 'shop'));
    this.active = false;
    this.order = null;
    this.rand = Math.random;
    this.flying = []; // kegs flying between the vehicle and a stop

    // One beam, ground ring, label and bouncing arrow, moved to the current target.
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 420, 16, 1, true).translate(0, 210, 0),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
    this.ring = new THREE.Mesh(new THREE.RingGeometry(ZONE - 7, ZONE, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
    this.chevron = new THREE.Mesh(new THREE.ConeGeometry(16, 30, 4).rotateX(Math.PI),
      new THREE.MeshBasicMaterial({ fog: false }));
    for (const m of [this.beam, this.ring, this.chevron]) {
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
    }
    this.label = document.createElement('div');
    this.label.className = 'label beer';
    this.label.style.display = 'none';
    labelsEl.appendChild(this.label);
    this.kegGeo = new THREE.CylinderGeometry(1.4, 1.4, 2.4, 10);
    this.kegMat = new THREE.MeshLambertMaterial({ color: 0xc0c6cc });
    this.chuteGeo = new THREE.ConeGeometry(3.2, 2.2, 10, 1, true).translate(0, 3.2, 0);
    this.chuteMat = new THREE.MeshLambertMaterial({ color: 0xff7a1a, side: THREE.DoubleSide });
  }

  /** Remove the label (the meshes go with the world). */
  dispose() {
    this.label.remove();
  }

  /** Start a new shift. `capacity` is how many kegs the vehicle holds. */
  start(capacity) {
    this.active = true;
    this.capacity = capacity;
    this.timeLeft = SHIFT;
    this.cash = 0;
    this.combo = 1;
    this.bestCombo = 1;
    this.happy = 0;
    this.happyDone = false;
    this.stats = { deliveries: 0, kegs: 0, missed: 0, broken: 0, rush: 0, vip: 0, tips: 0 };
    this.dwell = 0;
    this.wait = 0;
    this.ended = false;
    this.order = null;
    this.delivery = 0; // count, for ids
    this._newOrder();
  }

  stop() {
    this.active = false;
    this.order = null;
    this._updateMarker();
    for (const f of this.flying) this.scene.remove(f.obj);
    this.flying = [];
  }

  /** The delivery in progress, as a list (for tests). */
  get orders() {
    return this.order ? [this.order] : [];
  }

  guideOrder() {
    return this.order;
  }

  get loaded() {
    return this.order?.state === 'loaded' ? this.order.kegs : 0;
  }

  /** Where to go now: the brewery until the kegs are on board, then the shop. */
  get target() {
    const o = this.order;
    return o && (o.state === 'pickup' ? o.from : o.to);
  }

  // ---------------------------------------------------------------- deliveries
  _newOrder() {
    const p = this.pos || this.breweries[0];
    const near = (list, from, lo, hi) => {
      const ok = list.filter((s) => {
        const d = Math.hypot(s.x - from.x, s.z - from.z);
        return d > lo && d < hi && s !== this.lastShop;
      });
      return ok.length ? ok[Math.floor(this.rand() * ok.length)] : list[Math.floor(this.rand() * list.length)];
    };
    const from = near(this.breweries, p, 500, 4500);
    // Now and then a VIP (family and friends) asks for a delivery.
    const vip = this.rand() < 0.2;
    const to = near(this.shops.filter((s) => !!s.vip === vip), from, 1200, 9000);
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const reach = Math.hypot(from.x - p.x, from.z - p.z);
    const rush = !vip && this.rand() < 0.2;
    const kegs = Math.min(this.capacity, 1 + Math.floor(this.rand() * 3));
    const travel = (reach + dist) / 40 + 20; // seconds at about 90 mph, plus loading
    const time = THREE.MathUtils.clamp(travel * (rush ? 1.2 : 1.8), 45, 170);
    this.order = {
      id: ++this.delivery, from, to, kegs, rush, vip: !!to.vip, time, timeLeft: time, state: 'pickup',
      pay: (40 + (dist / 1000) * 25) * kegs * (rush ? 2 : 1),
      tip: to.vip ? 40 + Math.round(this.rand() * 6) * 10 : 0,
    };
    this.lastShop = to;
    this.dwell = 0;
    const kind = rush ? '⚡ RUSH: ' : to.vip ? '⭐ VIP: ' : '';
    this.hooks.toast(`📋 ${kind}${kegs}× ${from.beer} from ${from.name} to ${to.name}`,
      rush ? '#ffd700' : to.vip ? '#ff5fa2' : STEP_COLORS.load);
    this._updateMarker();
  }

  _updateMarker() {
    const t = this.active && this.target;
    for (const m of [this.beam, this.ring, this.chevron]) m.visible = !!t;
    if (!t) return;
    const color = new THREE.Color(this.order.state === 'pickup' ? STEP_COLORS.load : STEP_COLORS.deliver);
    for (const m of [this.beam, this.ring, this.chevron]) m.material.color.copy(color);
    this.beam.position.set(t.x, t.y, t.z);
    this.ring.position.set(t.x, t.y + 1.5, t.z);
  }

  // ---------------------------------------------------------------- per frame
  /** v: { pos (Vector3), agl, onGround, crashed } */
  update(dt, v) {
    this._updateFlying(dt);
    if (!this.active || this.ended) return;
    this.pos = v.pos;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.ended = true;
      this.active = false;
      this._updateMarker();
      this.hooks.onEnd(this.results());
      return;
    }
    // Happy Hour once per shift.
    if (!this.happyDone && this.timeLeft <= HAPPY_AT) {
      this.happyDone = true;
      this.happy = HAPPY_LEN;
      this.hooks.toast('🍻 HAPPY HOUR! Everything pays 1.5× for 40 seconds', '#e8590c');
      this.hooks.sound('load');
    }
    if (this.happy > 0) this.happy = Math.max(0, this.happy - dt);

    // Between deliveries.
    if (!this.order) {
      this.wait -= dt;
      if (this.wait <= 0) this._newOrder();
      return;
    }
    // The one timer: the current delivery's.
    const o = this.order;
    o.timeLeft -= dt;
    if (o.timeLeft <= 0) {
      this.stats.missed++;
      this.combo = 1;
      this.hooks.toast(`⌛ Too slow! ${o.to.name} cancelled. Streak lost`, '#868e96');
      this.hooks.sound('miss');
      this._next();
      return;
    }
    if (!v.crashed) this._checkTarget(dt, v);
  }

  _next() {
    this.order = null;
    this.wait = NEXT_DELAY;
    this.dwell = 0;
    this._updateMarker();
  }

  _checkTarget(dt, v) {
    const t = this.target;
    const inside = (v.onGround || v.agl < LOW) && Math.hypot(t.x - v.pos.x, t.z - v.pos.z) < ZONE;
    if (!inside) {
      this.dwell = 0;
      return;
    }
    this.dwell += v.onGround ? dt * 3 : dt; // landing is quicker than a low pass
    if (this.dwell < DWELL) return;
    this.dwell = 0;
    if (this.order.state === 'pickup') this._load(v);
    else this._deliver(v);
  }

  _load(v) {
    const o = this.order;
    o.state = 'loaded';
    this._flyKegs(o.kegs, o.from, v.pos, false);
    this.hooks.toast(`🛢️ Loaded ${o.kegs}× ${o.from.beer}. Now fly it to ${o.to.name}!`, STEP_COLORS.load);
    this.hooks.sound('load');
    this._updateMarker();
  }

  _deliver(v) {
    const o = this.order;
    const early = Math.max(0, o.timeLeft / o.time); // 1 = instantly, 0 = at the buzzer
    const happy = this.happy > 0 ? 1.5 : 1;
    const earned = Math.round(o.pay * (1 + 0.5 * early) * this.combo * happy) + o.tip;
    this.cash += earned;
    this.stats.deliveries++;
    this.stats.kegs += o.kegs;
    if (o.rush) this.stats.rush++;
    if (o.vip) this.stats.vip++;
    this.stats.tips += o.tip;
    const streak = this.combo > 1 ? ` · streak ×${this.combo.toFixed(2).replace(/0$/, '')}` : '';
    const tip = o.tip ? ` (incl. ${fmt(o.tip)} tip!)` : '';
    this.hooks.toast(`💰 +${fmt(earned)} from ${o.to.name}${tip}${streak}`, STEP_COLORS.deliver);
    this.hooks.sound('cash');
    this.combo = Math.min(3, Math.round((this.combo + 0.15) * 100) / 100);
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this._flyKegs(o.kegs, o.to, v.pos, true);
    this._next();
  }

  /** The vehicle crashed: kegs on board break and you have to go back to the brewery. */
  onCrash() {
    if (!this.active) return;
    this.combo = 1;
    const o = this.order;
    if (o?.state !== 'loaded') return;
    o.state = 'pickup';
    const fine = o.kegs * 15;
    this.cash = Math.max(0, this.cash - fine);
    this.stats.broken += o.kegs;
    this.hooks.toast(`💥 ${o.kegs} keg${o.kegs > 1 ? 's' : ''} broken: −${fmt(fine)}. Back to ${o.from.name}!`, '#c91a09');
    this.hooks.sound('break');
    this._updateMarker();
  }

  results() {
    return { cash: this.cash, bestCombo: this.bestCombo, title: titleFor(this.cash), ...this.stats };
  }

  // ---------------------------------------------------------------- kegs in the air
  // Loading: kegs float up from the brewery to you. Delivering: they drop to the
  // shop under little orange parachutes.
  _flyKegs(n, stop, from, down) {
    for (let i = 0; i < n; i++) {
      const obj = new THREE.Group();
      obj.add(new THREE.Mesh(this.kegGeo, this.kegMat));
      if (down) obj.add(new THREE.Mesh(this.chuteGeo, this.chuteMat));
      this.scene.add(obj);
      const a = new THREE.Vector3(from.x, from.y - 3, from.z);
      const b = new THREE.Vector3(stop.x + (i - (n - 1) / 2) * 6, stop.y + 1.2, stop.z);
      this.flying.push({ obj, a: down ? a : b, b: down ? b : a.clone(), t: -i * 0.15, len: down ? 2.2 : 1.2 });
    }
  }

  _updateFlying(dt) {
    if (this.chevron.visible) {
      const t = this.target;
      this.bob = (this.bob || 0) + dt;
      this.chevron.position.set(t.x, t.y + 150 + Math.sin(this.bob * 3) * 12, t.z);
      this.chevron.rotation.y += dt * 1.5;
    }
    for (const f of [...this.flying]) {
      f.t += dt;
      const u = THREE.MathUtils.clamp(f.t / f.len, 0, 1);
      f.obj.position.lerpVectors(f.a, f.b, u);
      f.obj.rotation.y += dt * 2;
      f.obj.visible = f.t >= 0;
      if (f.t > f.len + 0.6) {
        this.scene.remove(f.obj);
        this.flying.splice(this.flying.indexOf(f), 1);
      }
    }
  }

  // ---------------------------------------------------------------- for the HUD
  /** The target's label, for the main label layout (the only stop label shown). */
  labelItems(p) {
    const t = this.active && this.target;
    if (!t) {
      this.label.style.display = 'none';
      return [];
    }
    const o = this.order;
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    this.label.textContent = `${o.state === 'pickup' ? `🏭 LOAD at ${t.name}` : `🏪 DELIVER to ${t.name}`} · ${fmtDist(d)}`;
    this.label.style.setProperty('--pin', o.state === 'pickup' ? STEP_COLORS.load : STEP_COLORS.deliver);
    return [{ el: this.label, x: t.x, y: t.y + 110, z: t.z, d, pin: true }];
  }

  /** The target for the minimap, plus where the kegs go after loading. */
  mapMarks() {
    const o = this.active && this.order;
    if (!o) return [];
    const t = this.target;
    const marks = [{ x: t.x, z: t.z, kind: t.kind, guide: true, color: o.state === 'pickup' ? STEP_COLORS.load : STEP_COLORS.deliver }];
    if (o.state === 'pickup') marks.push({ x: o.to.x, z: o.to.z, kind: 'shop', later: true, color: STEP_COLORS.deliver });
    return marks;
  }

  mapRoute() {
    const o = this.active && this.order;
    if (!o) return null;
    return { color: o.state === 'pickup' ? STEP_COLORS.load : STEP_COLORS.deliver, points: o.state === 'pickup' ? [o.from, o.to] : [o.to] };
  }

  /** Everything the HUD shows, already formatted. */
  hud(p, heading) {
    const o = this.order;
    let mission = null;
    if (o) {
      const t = this.target;
      const dx = t.x - p.x;
      const dz = t.z - p.z;
      const bearing = (THREE.MathUtils.radToDeg(Math.atan2(dx, -dz)) + 360) % 360;
      const loading = o.state === 'pickup';
      mission = {
        color: loading ? STEP_COLORS.load : STEP_COLORS.deliver,
        icon: loading ? '🏭' : '🏪',
        rel: bearing - heading,
        step: `${loading ? 'LOAD' : 'DELIVER'} ${o.kegs}× ${o.from.beer}${o.vip ? ' · ⭐ VIP' : o.rush ? ' · ⚡ RUSH' : ''}`,
        where: `${loading ? 'at' : 'to'} ${t.name}`,
        next: loading ? `then to ${o.to.name}` : `up to ${fmt(o.pay * 1.5 * this.combo + o.tip)}`,
        dist: fmtDist(Math.hypot(dx, dz)),
        time: fmtTime(Math.max(0, o.timeLeft)), frac: o.timeLeft / o.time, hurry: o.timeLeft < 20,
      };
    }
    return {
      cash: fmt(this.cash),
      clock: fmtTime(this.timeLeft),
      hurry: this.timeLeft < 30,
      combo: this.combo > 1 ? `×${this.combo.toFixed(2).replace(/0$/, '')}` : '',
      happy: this.happy > 0 ? `🍻 ${Math.ceil(this.happy)}s` : '',
      hold: { loaded: this.loaded, capacity: this.capacity },
      dwell: this.dwell > 0 ? this.dwell / DWELL : 0,
      dwellText: o?.state === 'pickup' ? 'Loading…' : 'Unloading…',
      mission,
    };
  }
}

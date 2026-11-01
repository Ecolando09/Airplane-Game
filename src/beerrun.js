import * as THREE from 'three';

// Beer Run: the Fort Collins delivery game.
// A shift lasts SHIFT seconds. Orders ask for kegs from a brewery to a shop
// before a deadline. Fly low through a stop's glowing beam (or land in it) to
// load or unload. Pay grows with distance and how early you deliver, times an
// on-time streak multiplier; rush orders pay double, VIPs tip, and Happy Hour
// boosts everything for a while. Crashing breaks the kegs on board.

export const SHIFT = 300;
const ZONE = 90; // radius of a stop, meters
const LOW = 60; // highest you can be (above the ground) to load or unload in flight
const DWELL = 1.0; // seconds inside a stop to load or unload
const HAPPY_AT = 150; // Happy Hour starts with this many seconds left
const HAPPY_LEN = 40;
// Each order gets a letter and its own color, used on its card, beams, labels and the minimap.
const LETTERS = ['A', 'B', 'C', 'D'];
const ORDER_COLORS = { A: '#ff8a1f', B: '#3b9dff', C: '#c06bff', D: '#1fc7a8' };

/** Ranks for the end-of-shift card, by money earned. */
const TITLES = [[0, 'Keg Rookie'], [300, 'Delivery Cadet'], [700, 'Hop Hauler'], [1200, 'Barrel Baron'],
  [1800, 'Ale Ace'], [2600, 'Brewmaster Pilot'], [3600, 'Legend of Old Town']];
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
    this.labelsEl = labelsEl;
    this.hooks = hooks;
    const d = world.data.beerRun;
    const stop = (s, kind) => ({ ...s, kind, y: world.heightAt(s.x, s.z) });
    this.breweries = d.breweries.map((b) => stop(b, 'brewery'));
    this.shops = d.shops.map((s) => stop(s, 'shop'));
    this.active = false;
    this.rand = Math.random;
    this.flying = []; // kegs flying between the vehicle and a stop

    // One beam and ground ring per stop, shown only while an order uses it.
    this.beamGeo = new THREE.CylinderGeometry(9, 9, 420, 16, 1, true).translate(0, 210, 0);
    this.ringGeo = new THREE.RingGeometry(ZONE - 7, ZONE, 48).rotateX(-Math.PI / 2);
    for (const s of [...this.breweries, ...this.shops]) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, fog: false });
      const ringMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
      s.beam = new THREE.Mesh(this.beamGeo, mat);
      s.ring = new THREE.Mesh(this.ringGeo, ringMat);
      s.beam.position.set(s.x, s.y, s.z);
      s.ring.position.set(s.x, s.y + 1.5, s.z);
      s.beam.visible = s.ring.visible = false;
      s.beam.renderOrder = s.ring.renderOrder = 2;
      scene.add(s.beam, s.ring);
      s.label = document.createElement('div');
      s.label.className = 'label beer';
      s.label.style.display = 'none';
      labelsEl.appendChild(s.label);
    }
    // A big bouncing arrow over the stop the guide points to.
    this.chevron = new THREE.Mesh(new THREE.ConeGeometry(16, 30, 4).rotateX(Math.PI),
      new THREE.MeshBasicMaterial({ fog: false, transparent: true, opacity: 0.95 }));
    this.chevron.visible = false;
    this.chevron.renderOrder = 3;
    scene.add(this.chevron);
    this.kegGeo = new THREE.CylinderGeometry(1.4, 1.4, 2.4, 10);
    this.kegMat = new THREE.MeshLambertMaterial({ color: 0xc0c6cc });
    this.chuteGeo = new THREE.ConeGeometry(3.2, 2.2, 10, 1, true).translate(0, 3.2, 0);
    this.chuteMat = new THREE.MeshLambertMaterial({ color: 0xff7a1a, side: THREE.DoubleSide });
  }

  /** Remove the stop labels (the meshes go with the world). */
  dispose() {
    for (const s of [...this.breweries, ...this.shops]) s.label.remove();
  }

  /** Start a new shift. `capacity` is how many kegs the vehicle holds. */
  start(capacity) {
    this.active = true;
    this.capacity = capacity;
    this.timeLeft = SHIFT;
    this.cash = 0;
    this.combo = 1;
    this.bestCombo = 1;
    this.orders = [];
    this.nextId = 1;
    this.spawnTimer = 0;
    this.happy = 0;
    this.happyDone = false;
    this.stats = { deliveries: 0, kegs: 0, missed: 0, broken: 0, rush: 0, vip: 0, tips: 0 };
    this.dwell = 0;
    this.dwellStop = null;
    this.guideId = null;
    this.ended = false;
    for (let i = 0; i < 3; i++) this._newOrder();
    this._updateMarkers();
  }

  stop() {
    this.active = false;
    this.orders = [];
    this._updateMarkers();
    for (const f of this.flying) this.scene.remove(f.obj);
    this.flying = [];
  }

  get loaded() {
    return this.orders.filter((o) => o.state === 'loaded').reduce((n, o) => n + o.kegs, 0);
  }

  // ---------------------------------------------------------------- orders
  _newOrder() {
    const busy = new Set(this.orders.map((o) => o.to));
    const vipOpen = !this.orders.some((o) => o.to.vip);
    let to;
    let from;
    let dist = 0;
    for (let tries = 0; tries < 40; tries++) {
      from = this.breweries[Math.floor(this.rand() * this.breweries.length)];
      const pool = this.shops.filter((s) => !busy.has(s) && (s.vip ? vipOpen && this.rand() < 0.5 : true));
      to = pool[Math.floor(this.rand() * pool.length)];
      dist = Math.hypot(to.x - from.x, to.z - from.z);
      if (dist > 1200 && dist < 9000) break;
    }
    const rush = !to.vip && this.rand() < 0.18;
    const kegs = Math.min(this.capacity, 1 + Math.floor(this.rand() * (rush ? 2 : 3)));
    const p = this.pos || from;
    const reach = Math.hypot(from.x - p.x, from.z - p.z);
    const travel = (reach + dist) / 40 + 22; // seconds at about 90 mph, plus loading
    const time = THREE.MathUtils.clamp(travel * (rush ? 1.15 : 1.9), 45, 170);
    const pay = (30 + (dist / 1000) * 18) * kegs * (rush ? 2 : 1);
    const letter = LETTERS.find((l) => !this.orders.some((o) => o.letter === l)) || 'A';
    this.orders.push({
      id: this.nextId++, letter, color: ORDER_COLORS[letter],
      from, to, kegs, pay, rush, vip: !!to.vip, time, timeLeft: time, state: 'pickup',
      tip: to.vip ? 40 + Math.round(this.rand() * 6) * 10 : 0,
    });
  }

  _updateMarkers() {
    const stops = [...this.breweries, ...this.shops];
    for (const s of stops) s.use = null;
    const guide = this.guideOrder();
    // Each stop shows one use: the guided order's next stop first, then other
    // orders' next stops, then where the guided order goes after loading.
    const uses = [];
    for (const o of this.orders) {
      const next = o.state === 'pickup' ? o.from : o.to;
      uses.push({ stop: next, order: o, step: o.state === 'pickup' ? 'load' : 'deliver', rank: o === guide ? 0 : 1 });
      if (o === guide && o.state === 'pickup') uses.push({ stop: o.to, order: o, step: 'then', rank: 2 });
    }
    uses.sort((a, b) => a.rank - b.rank || a.order.timeLeft - b.order.timeLeft);
    for (const u of uses) if (!u.stop.use) u.stop.use = u;
    for (const s of stops) {
      const on = this.active && !!s.use;
      s.beam.visible = s.ring.visible = on;
      if (!on) continue;
      const c = new THREE.Color(s.use.order.color);
      s.beam.material.color.copy(c);
      s.ring.material.color.copy(c);
      s.beam.material.opacity = { 0: 0.6, 1: 0.3, 2: 0.14 }[s.use.rank];
      s.ring.material.opacity = s.use.rank === 2 ? 0.3 : 0.7;
    }
    const g = this.active && this.guideStop();
    this.chevron.visible = !!g;
    if (g) {
      this.chevron.material.color.set(guide.color);
      this.chevron.userData.stop = g;
    }
  }

  /** The order the guide follows: the one you picked, or else the most urgent,
   *  which then stays picked until it's delivered or expires. */
  guideOrder() {
    let o = this.orders.find((x) => x.id === this.guideId);
    if (!o) {
      o = [...this.orders].sort((a, b) => a.timeLeft - b.timeLeft)[0];
      this.guideId = o?.id ?? null;
    }
    return o;
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
      this._updateMarkers();
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

    // Deadlines.
    for (const o of [...this.orders]) {
      o.timeLeft -= dt;
      if (o.timeLeft > 0) continue;
      this.orders.splice(this.orders.indexOf(o), 1);
      this.stats.missed++;
      this.combo = 1;
      this.hooks.toast(`⌛ ${o.to.name} gave up on their order — streak lost`, '#868e96');
      this.hooks.sound('miss');
      this.spawnTimer = Math.max(this.spawnTimer, 0);
    }
    // Keep 3 orders going (4 after the first minute).
    const want = this.timeLeft < SHIFT - 60 ? 4 : 3;
    if (this.orders.length < want) {
      this.spawnTimer += dt;
      if (this.spawnTimer > 2) {
        this.spawnTimer = 0;
        this._newOrder();
      }
    }

    if (!v.crashed) this._checkStops(dt, v);
    this._updateMarkers();
  }

  _checkStops(dt, v) {
    const p = v.pos;
    const low = v.onGround || v.agl < LOW;
    // The stop we're in that has something to do.
    let here = null;
    if (low) {
      for (const o of this.orders) {
        const s = o.state === 'pickup' ? o.from : o.to;
        if (Math.hypot(s.x - p.x, s.z - p.z) < ZONE) {
          here = s;
          break;
        }
      }
    }
    if (here !== this.dwellStop) {
      this.dwellStop = here;
      this.dwell = 0;
    }
    if (!here) return;
    this.dwell += v.onGround ? dt * 3 : dt; // landing is quicker than a low pass
    if (this.dwell < DWELL) return;
    this.dwell = 0;
    this.dwellStop = null;
    if (here.kind === 'brewery') this._load(here, v);
    else this._deliver(here, v);
  }

  _load(brewery, v) {
    const waiting = this.orders.filter((o) => o.state === 'pickup' && o.from === brewery).sort((a, b) => a.timeLeft - b.timeLeft);
    let n = 0;
    for (const o of waiting) {
      if (this.loaded + o.kegs > this.capacity) continue;
      o.state = 'loaded';
      n += o.kegs;
      this._flyKegs(o.kegs, brewery, v.pos, false);
    }
    if (n) {
      this.hooks.toast(`🛢️ Loaded ${n} keg${n > 1 ? 's' : ''} of ${brewery.beer} at ${brewery.name}`, '#ffb300');
      this.hooks.sound('load');
    } else {
      this.hooks.toast(`Hold is full! Deliver first (${this.loaded}/${this.capacity} kegs)`, '#c91a09');
      this.hooks.sound('miss');
    }
  }

  _deliver(shop, v) {
    for (const o of this.orders.filter((x) => x.state === 'loaded' && x.to === shop)) {
      const early = Math.max(0, o.timeLeft / o.time); // 1 = instantly, 0 = at the buzzer
      const happy = this.happy > 0 ? 1.5 : 1;
      const earned = Math.round(o.pay * (1 + 0.5 * early) * this.combo * happy) + o.tip;
      this.cash += earned;
      this.stats.deliveries++;
      this.stats.kegs += o.kegs;
      if (o.rush) this.stats.rush++;
      if (o.vip) this.stats.vip++;
      this.stats.tips += o.tip;
      const streak = this.combo > 1 ? ` · streak ×${this.combo.toFixed(1)}` : '';
      const tip = o.tip ? ` (incl. ${fmt(o.tip)} tip!)` : '';
      this.hooks.toast(`💰 +${fmt(earned)} from ${shop.name}${tip}${streak}`, o.color);
      this.combo = Math.min(3, Math.round((this.combo + 0.15) * 100) / 100);
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.orders.splice(this.orders.indexOf(o), 1);
      if (this.guideId === o.id) this.guideId = null;
      this._flyKegs(o.kegs, shop, v.pos, true);
    }
    this.hooks.sound('cash');
  }

  /** The vehicle crashed: kegs on board break and those orders need picking up again. */
  onCrash() {
    if (!this.active) return;
    let broken = 0;
    for (const o of this.orders) {
      if (o.state !== 'loaded') continue;
      o.state = 'pickup';
      broken += o.kegs;
    }
    this.combo = 1;
    if (!broken) return;
    const fine = broken * 15;
    this.cash = Math.max(0, this.cash - fine);
    this.stats.broken += broken;
    this.hooks.toast(`💥 ${broken} keg${broken > 1 ? 's' : ''} broken: −${fmt(fine)}. Pick them up again!`, '#c91a09');
    this.hooks.sound('break');
    this._updateMarkers();
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
      const g = this.chevron.userData.stop;
      this.bob = (this.bob || 0) + dt;
      this.chevron.position.set(g.x, g.y + 150 + Math.sin(this.bob * 3) * 12, g.z);
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
  /** Labels over the active stops, for the main label layout. */
  labelItems(p) {
    const items = [];
    for (const s of [...this.breweries, ...this.shops]) {
      if (!this.active || !s.use) {
        s.label.style.display = 'none';
        continue;
      }
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      const { order: o, step } = s.use;
      const what = step === 'load' ? `LOAD ${o.kegs}× at` : step === 'deliver' ? `DELIVER ${o.kegs}× to` : 'then deliver to';
      s.label.textContent = `${o.letter} · ${what} ${s.name} · ${fmtDist(d)}`;
      s.label.style.setProperty('--pin', o.color);
      s.label.classList.toggle('later', step === 'then');
      s.label.classList.toggle('guided', s.use.rank === 0);
      items.push({ el: s.label, x: s.x, y: s.y + 110, z: s.z, d, pin: s.use.rank < 2 });
    }
    return items;
  }

  /** Spots for the minimap: { x, z, color, letter, kind, guide, later }, plus the guided route. */
  mapMarks() {
    if (!this.active) return [];
    return [...this.breweries, ...this.shops].filter((s) => s.use).map((s) => ({
      x: s.x, z: s.z, color: s.use.order.color, letter: s.use.order.letter, kind: s.kind,
      guide: s.use.rank === 0, later: s.use.step === 'then',
    }));
  }

  /** The guided order's remaining path: [vehicle?] → pickup → shop. */
  mapRoute() {
    const o = this.active && this.guideOrder();
    if (!o) return null;
    return { color: o.color, points: o.state === 'pickup' ? [o.from, o.to] : [o.to] };
  }

  guideStop() {
    const o = this.guideOrder();
    return o && (o.state === 'pickup' ? o.from : o.to);
  }

  /** Everything the HUD shows, already formatted. */
  hud(p, heading) {
    const o = this.guideOrder();
    let mission = null;
    if (o) {
      const g = o.state === 'pickup' ? o.from : o.to;
      const dx = g.x - p.x;
      const dz = g.z - p.z;
      const bearing = (THREE.MathUtils.radToDeg(Math.atan2(dx, -dz)) + 360) % 360;
      mission = {
        id: o.id, letter: o.letter, color: o.color, rel: bearing - heading,
        step: o.state === 'pickup' ? `LOAD ${o.kegs}× ${o.from.beer}` : `DELIVER ${o.kegs}× ${o.from.beer}`,
        where: g.name,
        dist: fmtDist(Math.hypot(dx, dz)),
        next: o.state === 'pickup' ? `then deliver to ${o.to.name}` : `from ${o.from.name}`,
        time: fmtTime(Math.max(0, o.timeLeft)), frac: o.timeLeft / o.time, hurry: o.timeLeft < 20,
        pay: fmt(o.pay * 1.5 + o.tip), tag: o.vip ? 'VIP' : o.rush ? 'RUSH' : '',
      };
    }
    return {
      cash: fmt(this.cash),
      clock: fmtTime(this.timeLeft),
      hurry: this.timeLeft < 30,
      combo: this.combo > 1 ? `×${this.combo.toFixed(2).replace(/0$/, '')}` : '',
      happy: this.happy > 0 ? `🍻 ${Math.ceil(this.happy)}s` : '',
      hold: { loaded: this.loaded, capacity: this.capacity },
      dwell: this.dwellStop ? this.dwell / DWELL : 0,
      dwellText: this.dwellStop ? (this.dwellStop.kind === 'brewery' ? 'Loading…' : 'Unloading…') : '',
      mission,
      orders: [...this.orders].sort((a, b) => a.letter.localeCompare(b.letter)).map((x) => ({
        id: x.id, letter: x.letter, color: x.color, guided: x === o, state: x.state,
        text: `${x.kegs}× ${x.from.beer}`,
        route: x.state === 'pickup' ? `🏭 ${x.from.name} → ${x.to.name}` : `🏪 → ${x.to.name}`,
        pay: fmt(x.pay * 1.5 + x.tip), tag: x.vip ? 'VIP' : x.rush ? 'RUSH' : '',
        frac: x.timeLeft / x.time, time: fmtTime(Math.max(0, x.timeLeft)), hurry: x.timeLeft < 20,
      })),
    };
  }
}

import * as THREE from 'three';

// Games you can play in every city (Beer Run, in beerrun.js, is Fort Collins only):
//  - Ring Race: fly through a course of rings around the landmarks, against the clock.
//  - Rampage: two minutes as the robot; smash for points, keep hitting for a combo.
// Both hand the HUD the same shape of data Beer Run does.

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtDist = (m) => (m < 300 ? `${Math.round(m * 3.281)} ft` : `${(m / 1609).toFixed(1)} mi`);
const RING_R = 40; // meters

export class RingRace {
  /** hooks: toast(text, color), sound(kind), onEnd(result) */
  constructor(scene, world, labelsEl, hooks) {
    Object.assign(this, { scene, world, hooks });
    this.active = false;
    this.rings = [];
    this.geo = new THREE.TorusGeometry(RING_R, 3, 8, 28);
    this.label = document.createElement('div');
    this.label.className = 'label beer';
    this.label.style.display = 'none';
    labelsEl.appendChild(this.label);
  }

  /** Lay the course out from where the vehicle starts, then around the nearest landmarks. */
  start(pos, heading, fast) {
    this.stop();
    const w = this.world;
    const h = THREE.MathUtils.degToRad(heading);
    const f = { x: Math.sin(h), z: -Math.cos(h) };
    // Waypoints: straight out from the start, then a tour of nearby landmarks.
    const pts = [{ x: pos.x + f.x * 900, z: pos.z + f.z * 900 }, { x: pos.x + f.x * 1900, z: pos.z + f.z * 1900 }];
    const left = w.landmarks.filter((l) => Math.hypot(l.x - pos.x, l.z - pos.z) < 14000);
    let at = pts[1];
    for (let i = 0; i < 6 && left.length; i++) {
      left.sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z));
      const far = left.findIndex((l) => Math.hypot(l.x - at.x, l.z - at.z) > 900);
      if (far < 0) break;
      at = left.splice(far, 1)[0];
      pts.push({ x: at.x, z: at.z, name: at.name });
    }
    // Rings every 800 m or so along the way, each high enough to clear what's under it.
    const spots = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / 800));
      for (let k = 1; k <= n; k++) spots.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n, name: k === n ? b.name : undefined });
    }
    this.length = 0;
    let prev = pos;
    spots.slice(0, 16).forEach((s, i, list) => {
      let y = w.heightAt(s.x, s.z) + 80;
      for (let k = 0; k < 30 && w.hitsObstacle({ x: s.x, y, z: s.z }, RING_R + 10); k++) y += 20;
      const next = list[i + 1] || { x: s.x + (s.x - prev.x), z: s.z + (s.z - prev.z) };
      const mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, fog: false }));
      mesh.position.set(s.x, y, s.z);
      mesh.rotation.y = Math.atan2(next.x - prev.x, next.z - prev.z); // face along the course
      this.scene.add(mesh);
      this.rings.push({ x: s.x, y, z: s.z, mesh, name: s.name });
      this.length += Math.hypot(s.x - prev.x, s.z - prev.z);
      prev = s;
    });
    this.next = 0;
    this.time = 0;
    this.par = Math.round(this.length / (fast ? 52 : 30) + 30);
    this.active = true;
    this._paint();
  }

  _paint() {
    this.rings.forEach((r, i) => {
      r.mesh.visible = this.active && i >= this.next;
      r.mesh.material.color.setHex(i === this.next ? 0xffd21f : 0xffffff);
      r.mesh.material.opacity = i === this.next ? 0.95 : i === this.next + 1 ? 0.5 : 0.22;
    });
  }

  stop() {
    this.active = false;
    for (const r of this.rings) this.scene.remove(r.mesh);
    this.rings = [];
    this.label.style.display = 'none';
  }

  dispose() {
    this.stop();
    this.label.remove();
  }

  update(dt, v) {
    if (!this.active) return;
    this.time += dt;
    const r = this.rings[this.next];
    r.mesh.rotation.z += dt * 0.6;
    if (v.pos.distanceTo(new THREE.Vector3(r.x, r.y, r.z)) < RING_R + 4) {
      this.next++;
      this.hooks.sound('ring');
      if (r.name) this.hooks.toast(`⭕ ${r.name}`, '#ffd21f');
      if (this.next >= this.rings.length) return this._finish();
      this._paint();
    } else if (this.time > 900) {
      this._finish();
    }
  }

  _finish() {
    const done = this.next >= this.rings.length;
    const time = this.time;
    const stars = !done ? 0 : time <= this.par ? 3 : time <= this.par * 1.35 ? 2 : 1;
    const result = {
      score: done ? Math.min(99999, Math.round((30000 * this.par) / time)) : this.next * 100, stars, time, par: this.par,
      rings: this.next, total: this.rings.length,
    };
    this.stop();
    this.hooks.onEnd(result);
  }

  labelItems(p) {
    const r = this.active && this.rings[this.next];
    if (!r) {
      this.label.style.display = 'none';
      return [];
    }
    const d = Math.hypot(r.x - p.x, r.z - p.z);
    this.label.textContent = `⭕ Ring ${this.next + 1} · ${fmtDist(d)}`;
    this.label.style.setProperty('--pin', '#c79a00');
    return [{ el: this.label, x: r.x, y: r.y + RING_R + 12, z: r.z, d, pin: true }];
  }

  mapMarks() {
    if (!this.active) return [];
    return this.rings.slice(this.next, this.next + 3).map((r, i) => ({ x: r.x, z: r.z, kind: 'shop', guide: i === 0, later: i > 0, color: i ? '#ffffff' : '#ffd21f' }));
  }

  mapRoute() {
    if (!this.active) return null;
    return { color: '#ffd21f', points: this.rings.slice(this.next, this.next + 3) };
  }

  hud(p, heading) {
    const r = this.rings[this.next];
    const dx = r.x - p.x;
    const dz = r.z - p.z;
    const bearing = (THREE.MathUtils.radToDeg(Math.atan2(dx, -dz)) + 360) % 360;
    const up = r.y - p.y;
    return {
      cash: `⭕ ${this.next}/${this.rings.length}`, clock: fmtTime(this.time), hurry: false,
      combo: '', happy: `par ${fmtTime(this.par)}`, hold: null, dwell: 0, dwellText: '',
      mission: {
        color: '#ffd21f', icon: '⭕', rel: bearing - heading,
        step: `RING ${this.next + 1} OF ${this.rings.length}`,
        where: Math.abs(up) > 25 ? `${up > 0 ? 'Climb' : 'Descend'} ${Math.round(Math.abs(up) * 3.281)} ft` : 'Straight through!',
        next: r.name ? `at ${r.name}` : '', dist: fmtDist(Math.hypot(dx, dz)), time: '', frac: 1 - this.next / this.rings.length, hurry: false,
      },
    };
  }
}

const RAMPAGE_TIME = 120;

export class RampageGame {
  /** hooks: toast, sound, onEnd(result) */
  constructor(rampage, hooks) {
    Object.assign(this, { rampage, hooks });
    this.active = false;
  }

  start() {
    this.active = true;
    this.timeLeft = RAMPAGE_TIME;
    this.total = 0;
    this.combo = 1;
    this.bestCombo = 1;
    this.since = 99;
    this.last = '';
  }

  stop() {
    this.active = false;
  }

  dispose() {}

  /** Points from the robot's destruction, times the combo. Hits within 3 s keep it climbing. */
  onScore(points, what) {
    if (!this.active) return;
    this.combo = this.since < 3 ? Math.min(6, this.combo + 0.2) : 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.since = 0;
    const got = Math.round(points * this.combo);
    this.total += got;
    this.last = `+${got} ${what}`;
  }

  update(dt) {
    if (!this.active) return;
    this.timeLeft -= dt;
    this.since += dt;
    if (this.since > 3) this.combo = 1;
    if (this.timeLeft <= 10 && !this.warned) {
      this.warned = true;
      this.hooks.toast('⏱ 10 seconds left!', '#c91a09');
    }
    if (this.timeLeft > 0) return;
    this.active = false;
    this.warned = false;
    const s = this.rampage.stats;
    const score = Math.round(this.total);
    this.hooks.onEnd({
      score, stars: score >= 6000 ? 3 : score >= 2500 ? 2 : score > 0 ? 1 : 0, bestCombo: this.bestCombo,
      buildings: s.buildings, trees: s.trees, cars: s.cars, thrown: s.thrown,
    });
  }

  labelItems() {
    return [];
  }

  mapMarks() {
    return [];
  }

  mapRoute() {
    return null;
  }

  hud() {
    return {
      cash: `💥 ${Math.round(this.total).toLocaleString()}`, clock: fmtTime(Math.max(0, this.timeLeft)), hurry: this.timeLeft < 15,
      combo: this.combo > 1 ? `×${this.combo.toFixed(1)}` : '', happy: this.since < 1.5 ? this.last : '', hold: null, dwell: 0, dwellText: '',
      mission: null, idle: { icon: '🤖', step: 'RAMPAGE', where: this.combo > 1 ? `Combo ×${this.combo.toFixed(1)}: keep smashing!` : 'Smash, stomp and throw!' },
    };
  }
}

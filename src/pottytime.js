import * as THREE from 'three';
const fmtDist = (m) => (m < 300 ? `${Math.round(m * 3.281)} ft` : `${(m / 1609).toFixed(1)} mi`);

// Potty Time (plan 05, part 4): a silly race for robots. Potty, snack, potty,
// snack... across the city, ending at a golden toilet. Every player gets the
// same route. Toilets have one seat: the server keeps the queue and says who
// sits (potty-seat / potty-done), so nobody sees two robots on one seat. Snack
// stops serve everyone at once and each food has a side effect.

export const FOODS = [
  { id: 'pizza', icon: '🍕', name: 'pizza', effect: 'Full of pizza: steady run' },
  { id: 'soda', icon: '🥤', name: 'soda', effect: 'Soda: burp-jumps go higher' },
  { id: 'beans', icon: '🫘', name: 'beans', effect: 'Beans: fart boost!' },
  { id: 'icecream', icon: '🍦', name: 'ice cream', effect: 'Brain freeze… then zoom!' },
  { id: 'hotsauce', icon: '🌶️', name: 'hot sauce', effect: 'Hot sauce: feet on fire, run!' },
  { id: 'taco', icon: '🌮', name: 'taco', effect: 'Taco power' },
];
const TUMMY_TIME = 75; // seconds from a snack until the tummy is full (then: accident)
const REACH = 38; // meters from a stop

/** The same route for everyone: toilets and snack stops at landmarks spreading out from downtown. */
export function pottyRoute(world, laps) {
  const start = world.landmarks[0];
  const left = world.landmarks.slice(1).filter((l) => Math.hypot(l.x - start.x, l.z - start.z) < 9000);
  const stops = [];
  let at = start;
  const n = laps * 2 + 1;
  while (stops.length < n) {
    left.sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z));
    let k = left.findIndex((l) => Math.hypot(l.x - at.x, l.z - at.z) > 450);
    if (k < 0) k = 0;
    const l = left.splice(k, 1)[0];
    // Out of landmarks: make up a spot 700 m on, turning a little each time.
    const spot = l || { x: at.x + Math.cos(stops.length * 1.3) * 700, z: at.z + Math.sin(stops.length * 1.3) * 700, name: 'the park' };
    stops.push({ x: spot.x, z: spot.z, name: spot.name, toilet: stops.length % 2 === 0, food: FOODS[Math.floor(stops.length / 2) % FOODS.length] });
    at = spot;
  }
  stops[stops.length - 1].golden = true;
  return stops;
}

export class PottyTime {
  /**
   * hooks: world, scene, labelsEl, message(text, s), toast, sound(kind), send(msg),
   * bot() -> RobotWalk, myId(), progress() -> server progress, sit(toilet) / stand(), act(name)
   */
  constructor(hooks, laps) {
    this.hooks = hooks;
    this.laps = laps;
    this.active = false;
    this.stops = pottyRoute(hooks.world, laps);
    this.models = [];
    // Toilets on the route (the last one golden) and little snack stands.
    for (const s of this.stops) {
      if (s.toilet) {
        const t = hooks.world.addToilet({ x: s.x, z: s.z, r: 40 }, { golden: s.golden });
        Object.assign(s, { x: t.at.x, z: t.at.z, y: t.at.y, yaw: t.at.yaw });
        this.models.push(t.group);
      } else {
        s.y = hooks.world.heightAt(s.x, s.z);
        this.models.push(this._stand(s));
      }
    }
    this.label = document.createElement('div');
    this.label.className = 'label beer';
    this.label.style.display = 'none';
    hooks.labelsEl.appendChild(this.label);
    this.tummy = 0.35; // starts rumbling
    this.effect = null; // { id, t }
    this.eating = 0;
    this.frozen = 0;
    this.asked = -1; // toilet index we've queued at
    this.seat = {}; // toilet index -> { holder, until, queue }
    this.time = 0;
  }

  _stand(s) {
    const g = new THREE.Group();
    g.position.set(s.x, s.y, s.z);
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 4), mat(0xffffff));
    counter.position.y = 2;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(7, 3, 4), mat(0xff5fa2));
    roof.position.y = 9;
    roof.rotation.y = Math.PI / 4;
    for (const x of [-3.5, 3.5]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 7), mat(0x666666));
      pole.position.set(x, 4, 1.8);
      g.add(pole);
    }
    const sign = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 10), mat(0xffd21f));
    sign.position.y = 12.5;
    g.add(counter, roof, sign);
    this.hooks.scene.add(g);
    return g;
  }

  start() {
    this.active = true;
  }

  stop() {
    this.active = false;
    this.label.style.display = 'none';
  }

  dispose() {
    this.stop();
    for (const m of this.models) this.hooks.scene.remove(m);
    this.label.remove();
    const w = this.hooks.bot();
    if (w) w.turbo = 1;
  }

  get stepIndex() {
    return this.hooks.progress();
  }

  /** The server says who sits on toilet i (and who waits). */
  onSeat(m) {
    this.seat[m.i] = m;
    const me = this.hooks.myId();
    if (m.holder === me) {
      this.hooks.sit(this.stops[m.i * 2]);
      this.hooks.message('🚽 On the potty!<small>Mash SMASH to go faster</small>', 3);
      this.hooks.sound('potty');
    } else if (m.queue.includes(me)) {
      this.hooks.message(`🕺 Potty dance! You're #${m.queue.indexOf(me) + 1} in line`, 2.5);
    }
  }

  /** Someone flushed. */
  onDone(m) {
    if (m.id !== this.hooks.myId()) return;
    this.asked = -1;
    this.hooks.stand();
    this.hooks.sound('flush');
    this.hooks.act('plop');
    this.tummy = 0;
    const stop = this.stops[m.i * 2];
    this.hooks.message(stop.golden ? '🏆✨ GOLDEN FLUSH! You finished!' : 'Ahh! 💩✨ Now find a snack', 3);
  }

  /** Mash the button while sitting. */
  mash() {
    const me = this.hooks.myId();
    for (const [i, seat] of Object.entries(this.seat)) if (seat.holder === me) this.hooks.send({ t: 'game-mash', i: Number(i) });
  }

  update(dt, v) {
    if (!this.active) return;
    this.time += dt;
    const w = this.hooks.bot();
    const step = this.stepIndex;
    const stop = this.stops[step];
    // Side effects wear off.
    if (this.effect) {
      this.effect.t -= dt;
      if (this.effect.id === 'icecream' && w) w.turbo = this.effect.t > 6 ? 0.45 : 2; // freeze, then zoom
      if (this.effect.id === 'beans' && w && Math.random() < dt * 0.6) {
        w.vel.x += w.forward.x * 25;
        w.vel.z += w.forward.z * 25;
        this.hooks.puff(w.pos, 0x7fbf3f);
        this.hooks.sound('break');
      }
      if (this.effect.t <= 0) {
        if (w) w.turbo = 1;
        w && (w.jumpBoost = 1);
        this.effect = null;
      }
    }
    if (this.frozen > 0) {
      this.frozen -= dt;
      if (w) w.vel.set(0, 0, 0);
      return;
    }
    if (!stop || !w) return;
    const d = Math.hypot(stop.x - v.pos.x, stop.z - v.pos.z);
    if (stop.toilet) {
      // Tummy fills while heading for the toilet: too slow means an accident.
      if (step > 0) this.tummy = Math.min(1, this.tummy + dt / TUMMY_TIME);
      if (this.tummy >= 1 && this.asked < 0) {
        this.tummy = 0.5;
        this.frozen = 5;
        this.hooks.puff(w.pos, 0x8a5a2b);
        this.hooks.sound('miss');
        this.hooks.message('💨 Oops… an accident! Mopping up (5 s)', 3);
        return;
      }
      const i = step / 2;
      if (d < REACH * Math.max(1, w.size || 1) && this.asked !== i) {
        this.asked = i;
        this.hooks.send({ t: 'game-potty', i });
      }
    } else if (d < REACH * Math.max(1, w.size || 1) && this.eating <= 0 && this.ate !== step) {
      // Snack stop: eat (2 s), burp, side effect.
      this.eating = 2;
      this.ate = step;
      this.hooks.message(`${stop.food.icon} Eating ${stop.food.name}…`, 2);
      this.hooks.act(`eat:${stop.food.icon}`);
    }
    if (this.eating > 0) {
      this.eating -= dt;
      w.vel.set(0, w.vel.y, 0);
      if (this.eating <= 0) {
        this.hooks.act('burp');
        this.hooks.sound('miss');
        this.effect = { id: stop.food.id, t: 20 };
        if (stop.food.id === 'hotsauce') w.turbo = 2.6;
        if (stop.food.id === 'soda') w.jumpBoost = 1.7;
        this.tummy = 0;
        this.hooks.send({ t: 'game-score', progress: step + 1 });
        this.hooks.message(`BUUURP! ${stop.food.effect}<small>Next: the 🚽 toilet</small>`, 3);
      }
    }
  }

  labelItems(p) {
    const s = this.active && this.stops[this.stepIndex];
    if (!s) {
      this.label.style.display = 'none';
      return [];
    }
    const d = Math.hypot(s.x - p.x, s.z - p.z);
    this.label.textContent = `${s.toilet ? (s.golden ? '🏆🚽' : '🚽') : s.food.icon} ${fmtDist(d)}`;
    this.label.style.setProperty('--pin', s.toilet ? '#8a5a2b' : '#ff5fa2');
    return [{ el: this.label, x: s.x, y: s.y + 40, z: s.z, d, pin: true }];
  }

  mapMarks() {
    if (!this.active) return [];
    return this.stops.slice(this.stepIndex, this.stepIndex + 2).map((s, i) => ({ x: s.x, z: s.z, kind: 'shop', guide: i === 0, later: i > 0, color: s.toilet ? '#8a5a2b' : '#ff5fa2' }));
  }

  mapRoute() {
    if (!this.active) return null;
    return { color: '#ff5fa2', points: this.stops.slice(this.stepIndex, this.stepIndex + 2).map((s) => ({ x: s.x, y: s.y, z: s.z })) };
  }

  hud(p, heading) {
    const step = this.stepIndex;
    const s = this.stops[step];
    if (!s) return { cash: '🏁', clock: '', hurry: false, combo: '', happy: '', hold: null, dwell: 0, dwellText: '', mission: null, idle: { icon: '🏆', step: 'FINISHED', where: 'Waiting for the others…' } };
    const dx = s.x - p.x;
    const dz = s.z - p.z;
    const bearing = (THREE.MathUtils.radToDeg(Math.atan2(dx, -dz)) + 360) % 360;
    const seat = s.toilet && this.seat[step / 2];
    const me = this.hooks.myId();
    let where = s.toilet ? (s.golden ? 'The GOLDEN toilet!' : `Toilet at ${s.name}`) : `${s.food.name} at ${s.name}`;
    if (seat?.holder === me) where = 'On the seat: mash SMASH!';
    else if (seat?.queue?.includes(me)) where = `In line: #${seat.queue.indexOf(me) + 1}`;
    else if (seat?.holder) where += ' (occupied!)';
    return {
      cash: `🚽 ${Math.floor(step / 2)}/${this.laps + 1}`, clock: '', hurry: this.tummy > 0.8,
      combo: this.effect ? FOODS.find((f) => f.id === this.effect.id)?.icon : '',
      happy: `Tummy ${'🟫'.repeat(Math.round(this.tummy * 5))}${'⬜'.repeat(5 - Math.round(this.tummy * 5))}`, hold: null, dwell: 0, dwellText: '',
      mission: {
        color: s.toilet ? '#8a5a2b' : '#ff5fa2', icon: s.toilet ? '🚽' : s.food.icon, rel: bearing - heading,
        step: s.toilet ? `POTTY ${step / 2 + 1} OF ${this.laps + 1}` : 'SNACK STOP', where, next: '',
        dist: fmtDist(Math.hypot(dx, dz)), time: '', frac: 1 - this.tummy, hurry: this.tummy > 0.8,
      },
    };
  }
}

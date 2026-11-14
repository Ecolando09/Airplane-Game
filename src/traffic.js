import * as THREE from 'three';
import { LEGO, legoMaterial, isLego } from './lego.js';
import { CAR_KINDS, carModel, carWheels, wheelGeometry, trafficKinds } from './vehicles.js';

const DETAIL_RANGE = 320; // meters: nearer cars are drawn in detail (wheels, glass, lamps)

// Lego cars driving on the real streets. Each car follows one street from the
// map data in its right-hand lane, turns around at the end and drives back.
// Busier roads get more cars and drive faster.
const ROADS = {
  motorway: { weight: 6, speed: 30, width: 22 },
  trunk: { weight: 4, speed: 24, width: 18 },
  primary: { weight: 3, speed: 18, width: 14 },
  secondary: { weight: 2.5, speed: 16, width: 12 },
  tertiary: { weight: 1.5, speed: 14, width: 10 },
  residential: { weight: 0.6, speed: 10, width: 7 },
  unclassified: { weight: 0.6, speed: 11, width: 7 },
};
const COLORS = [LEGO.red, LEGO.blue, LEGO.yellow, LEGO.white, LEGO.black, LEGO.green, LEGO.orange,
  LEGO.lightGray, LEGO.medAzure, LEGO.red, LEGO.blue, LEGO.white];

export class Traffic {
  /** @param opts.detail how many nearby cars may be drawn in detail at once; opts.city picks local car kinds */
  constructor(scene, world, count, { detail = 150, city = '' } = {}) {
    this.world = world;
    this.scene = scene;
    this.detailCap = detail;
    // Precompute each usable street's segment lengths.
    const roads = [];
    let total = 0;
    for (const l of world.data.lines) {
      const cfg = ROADS[l.k];
      if (!cfg) continue;
      const cum = [0];
      for (let i = 2; i < l.p.length; i += 2) {
        cum.push(cum[cum.length - 1] + Math.hypot(l.p[i] - l.p[i - 2], l.p[i + 1] - l.p[i - 1]));
      }
      const len = cum[cum.length - 1];
      if (len < 60) continue;
      // More traffic near downtown (Morgan Square), thinning out toward the edges.
      const sq = world.data.landmarks[0];
      const d = Math.hypot(l.p[0] - sq.x, l.p[1] - sq.z);
      total += len * cfg.weight * (0.4 + 3 * Math.exp(-d / 2500));
      roads.push({ p: l.p, cum, len, cfg, w: total });
    }
    this.roads = roads;

    let seed = 99;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pick = () => {
      const r = rand() * total;
      let lo = 0;
      let hi = roads.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (roads[mid].w < r) lo = mid + 1;
        else hi = mid;
      }
      return roads[lo];
    };
    this.cars = Array.from({ length: count }, () => {
      const road = pick();
      return {
        road,
        s: rand() * road.len,
        dir: rand() < 0.5 ? 1 : -1,
        speed: road.cfg.speed * (0.8 + rand() * 0.4),
        truck: rand() < 0.12,
      };
    });
    const kinds = trafficKinds(city);
    for (const car of this.cars) {
      car.kind = car.truck ? 'van' : kinds[Math.floor(rand() * kinds.length)];
      car.propKind = car.kind === 'sedan' ? 'car' : car.kind; // what it becomes when a robot grabs it
      car.spin = 0;
    }

    // Instanced meshes: body (per-car color), cabin with windows, and a stud on the roof.
    const n = this.cars.length;
    const bodyGeo = new THREE.BoxGeometry(2.4, 1.1, 5.2).translate(0, 0.85, 0);
    const cabinGeo = new THREE.BoxGeometry(2.1, 0.95, 2.6).translate(0, 1.85, 0.35);
    const wheelGeo = new THREE.BoxGeometry(2.6, 0.7, 4.0).translate(0, 0.35, 0);
    this.body = new THREE.InstancedMesh(bodyGeo, legoMaterial({ studs: 0.8 }), n);
    this.cabin = new THREE.InstancedMesh(cabinGeo, legoMaterial({ color: 0x2a3d4d }), n);
    this.wheels = new THREE.InstancedMesh(wheelGeo, legoMaterial({ color: LEGO.black }), n);
    const c = new THREE.Color();
    this.cars.forEach((car, i) => {
      car.color = car.truck ? LEGO.lightGray : COLORS[Math.floor(rand() * COLORS.length)];
      if (car.kind === 'taxi') car.color = LEGO.yellow;
      this.body.setColorAt(i, c.setHex(car.color));
    });
    for (const m of [this.body, this.cabin, this.wheels]) {
      m.castShadow = true;
      m.frustumCulled = false; // cars are spread across the whole map
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._c = new THREE.Color();
    this._w = new THREE.Matrix4();
    this._r = new THREE.Matrix4();

    // Detailed cars near the camera: per kind, a body, glowing lamps and four spinning wheels.
    const style = isLego() ? 'lego' : 'real';
    const bodyMat = legoMaterial({ vertexColors: true });
    const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const wheelMat = legoMaterial({ vertexColors: true });
    this.detail = {};
    for (const kind of new Set(this.cars.map((c) => c.kind))) {
      if (!CAR_KINDS.includes(kind)) continue;
      const m = carModel(kind, style);
      const wheels = carWheels(kind);
      const cap = this.detailCap;
      const body = new THREE.InstancedMesh(m.body, bodyMat, cap);
      const lamps = new THREE.InstancedMesh(m.lamps, lampMat, cap);
      const wheel = new THREE.InstancedMesh(wheelGeometry(wheels[0][2], style), wheelMat, cap * 4);
      for (const im of [body, lamps, wheel]) {
        im.count = 0;
        im.frustumCulled = false;
        im.castShadow = im !== lamps;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(im);
      }
      body.setColorAt(0, new THREE.Color()); // allocate per-car paint
      this.detail[kind] = { body, lamps, wheel, wheels };
    }
    this.update(0);
  }

  /** Show or hide all traffic (the Google 3D look has none). */
  setVisible(on) {
    for (const m of [this.body, this.cabin, this.wheels]) m.visible = on;
    for (const d of Object.values(this.detail)) for (const m of [d.body, d.lamps, d.wheel]) m.visible = on;
  }

  update(dt, focus = null) {
    const { _m: m, _q: q, _p: p, _s: sc } = this;
    for (const d of Object.values(this.detail)) d.n = 0;
    let detailed = 0;
    const hidden = this._hide || (this._hide = new THREE.Matrix4().makeScale(0, 0, 0));
    this.cars.forEach((car, i) => {
      if (car.gone) return;
      const r = car.road;
      car.s += car.speed * dt * car.dir;
      if (car.s > r.len) {
        car.s = r.len;
        car.dir = -1;
      } else if (car.s < 0) {
        car.s = 0;
        car.dir = 1;
      }
      // Find the segment the car is on.
      let k = car.seg ?? 0;
      while (k < r.cum.length - 2 && r.cum[k + 1] < car.s) k++;
      while (k > 0 && r.cum[k] > car.s) k--;
      car.seg = k;
      const x0 = r.p[k * 2];
      const z0 = r.p[k * 2 + 1];
      const x1 = r.p[k * 2 + 2];
      const z1 = r.p[k * 2 + 3];
      const segLen = r.cum[k + 1] - r.cum[k] || 1;
      const t = (car.s - r.cum[k]) / segLen;
      let dx = (x1 - x0) / segLen;
      let dz = (z1 - z0) / segLen;
      if (car.dir < 0) {
        dx = -dx;
        dz = -dz;
      }
      // Keep right: offset a quarter of the road width to the right of travel.
      const lane = r.cfg.width * 0.25;
      const x = x0 + (x1 - x0) * t - dz * lane;
      const z = z0 + (z1 - z0) * t + dx * lane;
      p.set(x, this.world.heightAt(x, z) + 0.2, z);
      car.x = x;
      car.z = z;
      car.y = p.y;
      car.yaw = Math.atan2(-dx, -dz);
      q.setFromAxisAngle(this._up, Math.atan2(-dx, -dz));
      car.spin += (car.speed * dt) / 0.5;
      // Near the camera: the detailed model. Farther away: three simple blocks.
      const d = this.detail[car.kind];
      const near = d && focus && detailed < this.detailCap && Math.abs(x - focus.x) < DETAIL_RANGE && Math.abs(z - focus.z) < DETAIL_RANGE;
      if (near) {
        detailed++;
        sc.set(1.12, 1.12, 1.12);
        m.compose(p, q, sc);
        const k = d.n++;
        d.body.setMatrixAt(k, m);
        d.body.setColorAt(k, this._c.setHex(car.color));
        d.lamps.setMatrixAt(k, m);
        d.wheels.forEach(([wx, wz, wr], j) => {
          this._w.makeTranslation(wx, wr, wz).multiply(this._r.makeRotationX(-car.spin * car.dir));
          d.wheel.setMatrixAt(k * 4 + j, this._w.premultiply(m));
        });
        this.body.setMatrixAt(i, hidden);
        this.wheels.setMatrixAt(i, hidden);
        this.cabin.setMatrixAt(i, hidden);
        return;
      }
      // Slightly chunkier than life so they read from the air.
      sc.set(1.3, car.truck ? 1.75 : 1.3, car.truck ? 2.2 : 1.3);
      m.compose(p, q, sc);
      this.body.setMatrixAt(i, m);
      this.wheels.setMatrixAt(i, m);
      this.cabin.setMatrixAt(i, m);
    });
    this.body.instanceMatrix.needsUpdate = true;
    this.cabin.instanceMatrix.needsUpdate = true;
    this.wheels.instanceMatrix.needsUpdate = true;
    for (const d of Object.values(this.detail)) {
      d.body.count = d.lamps.count = d.n;
      d.wheel.count = d.n * 4;
      d.body.instanceMatrix.needsUpdate = d.lamps.instanceMatrix.needsUpdate = d.wheel.instanceMatrix.needsUpdate = true;
      if (d.body.instanceColor) d.body.instanceColor.needsUpdate = true;
    }
  }

  /** Cars within `r` of (x, z) that are still driving. */
  near(x, z, r) {
    return this.cars.filter((car) => !car.gone && car.x !== undefined && Math.hypot(car.x - x, car.z - z) < r);
  }

  /** Take a car off the road (grabbed, kicked or squashed). */
  remove(car) {
    car.gone = true;
    const i = this.cars.indexOf(car);
    this._m.makeScale(0, 0, 0);
    for (const m of [this.body, this.cabin, this.wheels]) {
      m.setMatrixAt(i, this._m);
      m.instanceMatrix.needsUpdate = true;
    }
  }

  /** Put every removed car back on its street. */
  restore() {
    for (const car of this.cars) car.gone = false;
  }
}

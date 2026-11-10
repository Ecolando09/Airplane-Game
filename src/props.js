import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LEGO, legoMaterial } from './lego.js';

// Loose objects lying around the city that the robot can pick up and throw:
// cars in parking lots, shipping containers in industrial yards, picnic tables
// in parks, boulders and logs in the woods, boats along the shore, kegs outside
// breweries, small planes at the airport and so on. Each kind is one instanced
// mesh; an object that is picked up leaves its instance and comes back as one
// wherever it lands.

const TINTS = [LEGO.red, LEGO.blue, LEGO.yellow, LEGO.white, LEGO.green, LEGO.orange, LEGO.medAzure, LEGO.darkRed];

/** A geometry painted one color (colors are per vertex so a whole object is one mesh). */
function part(geo, hex, x = 0, y = 0, z = 0) {
  const g = geo.toNonIndexed();
  g.translate(x, y, z);
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const colors = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}
const box = (w, h, d, hex, x, y, z) => part(new THREE.BoxGeometry(w, h, d), hex, x, y, z);
const cyl = (r, h, hex, x, y, z, rot) => {
  const g = new THREE.CylinderGeometry(r, r, h, 10);
  if (rot === 'x') g.rotateZ(Math.PI / 2);
  if (rot === 'z') g.rotateX(Math.PI / 2);
  return part(g, hex, x, y, z);
};
const WHITE = 0xffffff; // white parts take the object's own tint
const wheels = (xs, zs, r = 0.5) => xs.flatMap((x) => zs.map((z) => cyl(r, 0.4, LEGO.black, x, r, z, 'x')));

// name: what the game calls it; r: rough radius in meters (for grabbing and
// hitting things); tint: comes in several colors.
const KINDS = {
  car: { drive: true, name: 'car', r: 3.2, tint: true, make: () => [
    box(3.1, 1.4, 6.8, WHITE, 0, 1.2, 0), box(2.7, 1.2, 3.4, 0x2a3d4d, 0, 2.5, 0.4), ...wheels([-1.5, 1.5], [-2.2, 2.2], 0.6)] },
  bus: { drive: true, name: 'school bus', r: 5.5, make: () => [
    box(3.4, 3.2, 11, LEGO.yellow, 0, 2.4, 0), box(3.5, 0.9, 9, 0x2a3d4d, 0, 3.1, 0.6), box(3.4, 1.6, 1.6, LEGO.yellow, 0, 1.6, -6.2),
    box(3.5, 0.3, 11, LEGO.black, 0, 1.5, 0), ...wheels([-1.6, 1.6], [-4, 3.6], 0.8)] },
  container: { name: 'shipping container', r: 5, tint: true, make: () => [
    box(3.2, 3.4, 9.5, WHITE, 0, 1.7, 0), box(3.3, 0.3, 9.6, LEGO.darkGray, 0, 3.3, 0), box(2.6, 2.8, 0.2, LEGO.lightGray, 0, 1.7, 4.8)] },
  dumpster: { name: 'dumpster', r: 2.6, make: () => [
    box(3.6, 2, 2.4, LEGO.green, 0, 1.2, 0), box(3.8, 0.3, 2.6, LEGO.black, 0, 2.3, 0), ...wheels([-1.5, 1.5], [-0.9, 0.9], 0.3)] },
  table: { name: 'picnic table', r: 2.4, make: () => [
    box(4, 0.3, 1.8, LEGO.reddishBrown, 0, 1.6, 0), box(4, 0.25, 0.7, LEGO.reddishBrown, 0, 0.9, -1.5), box(4, 0.25, 0.7, LEGO.reddishBrown, 0, 0.9, 1.5),
    box(0.3, 1.6, 3.6, LEGO.brown, -1.5, 0.8, 0), box(0.3, 1.6, 3.6, LEGO.brown, 1.5, 0.8, 0)] },
  boulder: { name: 'boulder', r: 2.6, make: () => [part(new THREE.DodecahedronGeometry(2.6, 0), 0x8d8f8a, 0, 1.9, 0)] },
  log: { name: 'log', r: 3, make: () => [cyl(0.9, 7, LEGO.reddishBrown, 0, 0.9, 0, 'x'), cyl(0.7, 0.2, LEGO.tan, 3.55, 0.9, 0, 'x'), cyl(0.7, 0.2, LEGO.tan, -3.55, 0.9, 0, 'x')] },
  hay: { name: 'hay bale', r: 2, make: () => [cyl(1.8, 2.6, 0xd8b84a, 0, 1.8, 0, 'x'), cyl(1.85, 0.2, 0xb8962a, 0, 1.8, 0, 'x')] },
  cart: { drive: true, name: 'golf cart', r: 2, make: () => [
    box(1.8, 0.7, 3.2, LEGO.white, 0, 0.9, 0), box(1.8, 0.15, 2.6, LEGO.green, 0, 2.6, 0.1), box(0.12, 1.6, 0.12, LEGO.black, -0.8, 1.8, -1), box(0.12, 1.6, 0.12, LEGO.black, 0.8, 1.8, -1),
    box(0.12, 1.6, 0.12, LEGO.black, -0.8, 1.8, 1.2), box(0.12, 1.6, 0.12, LEGO.black, 0.8, 1.8, 1.2), ...wheels([-0.9, 0.9], [-1.1, 1.1], 0.4)] },
  ball: { name: 'giant soccer ball', r: 2.2, bouncy: true, make: () => [
    part(new THREE.IcosahedronGeometry(2.2, 1), LEGO.white, 0, 2.2, 0), part(new THREE.IcosahedronGeometry(2.24, 0), LEGO.black, 0, 2.2, 0).scale(1, 1, 1)] },
  umbrella: { name: 'beach umbrella', r: 2.4, tint: true, make: () => [
    cyl(0.12, 4, LEGO.lightGray, 0, 2, 0), part(new THREE.ConeGeometry(2.6, 1.2, 8), WHITE, 0, 4.3, 0)] },
  boat: { name: 'boat', r: 3.6, tint: true, floats: true, make: () => [
    box(2.6, 1.1, 7, WHITE, 0, 0.6, 0), box(2.2, 0.3, 6.4, LEGO.tan, 0, 1.2, 0), box(1.8, 1.3, 2, LEGO.white, 0, 1.9, 0.8),
    part(new THREE.ConeGeometry(1.3, 2.2, 4), WHITE, 0, 0.6, -4.4).rotateX(0)] },
  keg: { name: 'beer keg', r: 1.6, make: () => [
    cyl(1.3, 2.6, 0xc0c6cc, 0, 1.3, 0), cyl(1.36, 0.25, 0x8d949b, 0, 0.5, 0), cyl(1.36, 0.25, 0x8d949b, 0, 2.1, 0)] },
  plane: { name: 'parked plane', r: 5, tint: true, make: () => [
    box(1.6, 1.6, 8, LEGO.white, 0, 2, 0), box(11, 0.3, 2, WHITE, 0, 2.9, -1), box(4, 0.25, 1.2, WHITE, 0, 2.2, 3.6),
    box(0.25, 1.8, 1.4, WHITE, 0, 3.2, 3.6), box(0.2, 2.6, 0.3, LEGO.black, 0, 2, -4.2), ...wheels([-1.2, 1.2], [-1.2], 0.5)] },
  tanker: { drive: true, name: 'fuel truck', r: 4.5, make: () => [
    box(2.8, 2.4, 2.4, LEGO.red, 0, 1.9, -3.4), cyl(1.5, 6, LEGO.lightGray, 0, 2.3, 0.8, 'z'), box(2.8, 0.5, 9, LEGO.darkGray, 0, 0.9, 0),
    ...wheels([-1.4, 1.4], [-3.2, 1, 3.2], 0.7)] },
  marble: { name: 'marble block', r: 2.4, make: () => [box(3.4, 2.6, 3.4, 0xf2f1ec, 0, 1.3, 0), box(3.45, 0.15, 3.45, 0xd9d6cc, 0, 1.6, 0)] },
  truck: { drive: true, name: 'ice cream truck', r: 3.6, make: () => [
    box(3, 3.2, 6.4, LEGO.white, 0, 2.2, 0.4), box(3, 2, 1.8, LEGO.medAzure, 0, 1.6, -3.6), box(3.1, 0.5, 6.4, 0xff8fc7, 0, 3.9, 0.4),
    part(new THREE.ConeGeometry(0.8, 1.8, 8), LEGO.tan, 0, 4.9, 0.4).rotateX(0), part(new THREE.SphereGeometry(0.9, 8, 6), 0xff8fc7, 0, 6.1, 0.4),
    ...wheels([-1.5, 1.5], [-2.6, 2.4], 0.6)] },
};

// What turns up on each kind of ground, and how many of each ground type at most.
const LAND = {
  paved: { kinds: ['car', 'car', 'container', 'dumpster', 'car'], max: 260 },
  campus: { kinds: ['bus', 'car', 'table'], max: 70 },
  park: { kinds: ['table', 'table', 'truck'], max: 150 },
  forest: { kinds: ['boulder', 'log', 'log'], max: 110 },
  golf: { kinds: ['cart'], max: 40 },
  pitch: { kinds: ['ball'], max: 35 },
  track: { kinds: ['ball'], max: 10 },
  sand: { kinds: ['umbrella', 'ball'], max: 40 },
};
// Landmarks whose names hint at what's lying around them.
const NAMED = [
  [/brew|beer|distill|pub\b/i, 'keg', 4], [/quarry|marble/i, 'marble', 6],
  [/stadium|field|arena|dome|coors|oracle|busch/i, 'ball', 3], [/pier|ferry|harbou?r|marina|lake|reservoir|wharf|bay\b/i, 'boat', 4],
  [/market|square|museum|zoo|mall|plaza/i, 'truck', 2], [/airport|airstrip|air base/i, 'plane', 2],
];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class Props {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.items = []; // { kind, x, y, z, yaw, tint, idx, held }
    this.kinds = {};
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
    this._place();
    // One instanced mesh per kind, with room for extra ones (cars taken off the road).
    const mat = legoMaterial({ vertexColors: true });
    const counts = {};
    for (const it of this.items) counts[it.kind] = (counts[it.kind] || 0) + 1;
    for (const [key, def] of Object.entries(KINDS)) {
      const geo = mergeGeometries(def.make());
      geo.computeVertexNormals();
      const cap = (counts[key] || 0) + (key === 'car' ? 150 : 8);
      const im = new THREE.InstancedMesh(geo, mat, cap);
      im.count = 0;
      im.castShadow = true;
      im.frustumCulled = false;
      scene.add(im);
      this.kinds[key] = { ...def, key, geo, im, mat, cap };
    }
    const placed = this.items;
    this.items = [];
    for (const it of placed) this.add(it.kind, it.x, it.z, it.yaw, it.tint);
  }

  /** Decide where everything lies, the same way every time for a given city. */
  _place() {
    const w = this.world;
    const d = w.data;
    const r = rng(1234);
    const rw = w.runway;
    const ok = (x, z, wet = false) => {
      if (Math.abs(x) > w.halfX - 20 || Math.abs(z) > w.halfZ - 20) return false;
      if (w.isWater(x, z) !== wet || w.isOnRunway(x, z)) return false;
      const y = w.heightAt(x, z);
      if (Math.abs(w.heightAt(x + 4, z) - y) > 2.5 || Math.abs(w.heightAt(x, z + 4) - y) > 2.5) return false; // too steep
      return !w.hitsObstacle({ x, y: y + 2, z }, 5);
    };
    const put = (kind, x, z, spread = 0, wet = false) => {
      for (let tries = 0; tries < 6; tries++) {
        const px = x + (r() - 0.5) * spread * (1 + tries);
        const pz = z + (r() - 0.5) * spread * (1 + tries);
        if (!ok(px, pz, wet)) continue;
        if (this.items.some((it) => Math.abs(it.x - px) < 9 && Math.abs(it.z - pz) < 9)) continue;
        this.items.push({ kind, x: px, z: pz, yaw: r() * Math.PI * 2, tint: TINTS[Math.floor(r() * TINTS.length)] });
        return true;
      }
      return false;
    };
    // By the kind of ground. Bigger areas are more likely to get something.
    const used = {};
    const lands = d.land.map((l, i) => i).sort(() => r() - 0.5);
    for (const i of lands) {
      const l = d.land[i];
      const cfg = LAND[l.k];
      if (!cfg || (used[l.k] || 0) >= cfg.max) continue;
      let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
      for (let k = 0; k < l.p.length; k += 2) {
        minx = Math.min(minx, l.p[k]); maxx = Math.max(maxx, l.p[k]);
        minz = Math.min(minz, l.p[k + 1]); maxz = Math.max(maxz, l.p[k + 1]);
      }
      const size = Math.min(maxx - minx, maxz - minz);
      if (size < 25 || r() > size / 150) continue;
      const n = size > 300 ? 3 : size > 120 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const kind = cfg.kinds[Math.floor(r() * cfg.kinds.length)];
        if (put(kind, (minx + maxx) / 2, (minz + maxz) / 2, size * 0.5)) used[l.k] = (used[l.k] || 0) + 1;
      }
    }
    // Around landmarks, by name; kegs outside the Beer Run breweries.
    for (const l of d.landmarks) {
      for (const [re, kind, n] of NAMED) {
        if (re.test(l.name)) for (let k = 0; k < n; k++) put(kind, l.x, l.z, 90, kind === 'boat');
      }
    }
    for (const b of d.beerRun?.breweries || []) for (let k = 0; k < 3; k++) put('keg', b.x, b.z, 50);
    // The airport: parked planes and a fuel truck beside the runway.
    for (let k = 0; k < 6; k++) {
      const along = (r() - 0.5) * rw.length * 0.8;
      const side = (r() < 0.5 ? -1 : 1) * (rw.width / 2 + 45 + r() * 40);
      put(k < 4 ? 'plane' : 'tanker', rw.x + rw.fx * along - rw.fz * side, rw.z + rw.fz * along + rw.fx * side, 10);
    }
    // Boats close to shore, and boulders, logs and hay bales out in the open.
    let boats = 0;
    for (let k = 0; k < 900 && boats < 60; k++) {
      const x = (r() - 0.5) * w.sizeX * 0.95;
      const z = (r() - 0.5) * w.sizeZ * 0.95;
      if (!w.isWater(x, z)) continue;
      const a = r() * Math.PI * 2;
      if (w.isWater(x + Math.cos(a) * 70, z + Math.sin(a) * 70)) continue; // open water
      if (put('boat', x, z, 0, true)) boats++;
    }
    const rural = d.boxes.length < 100000; // hay bales belong in farm country, not Hong Kong
    for (let k = 0; k < 260; k++) {
      put((rural ? ['boulder', 'hay', 'log', 'hay'] : ['boulder', 'log', 'boulder', 'dumpster'])[Math.floor(r() * 4)], (r() - 0.5) * w.sizeX * 0.95, (r() - 0.5) * w.sizeZ * 0.95, 0);
    }
  }

  _write(it) {
    const k = this.kinds[it.kind];
    this._q.setFromAxisAngle(this._up, it.yaw);
    const sc = it.scale || 1;
    k.im.setMatrixAt(it.idx, it.held ? this._m.makeScale(0, 0, 0) : this._m.compose(new THREE.Vector3(it.x, it.y, it.z), this._q, new THREE.Vector3(sc, sc, sc)));
    k.im.instanceMatrix.needsUpdate = true;
  }

  /** Lay an object on the ground. Returns it, or null when that kind is full. */
  add(kind, x, z, yaw = 0, tint = LEGO.white) {
    const k = this.kinds[kind];
    if (k.im.count >= k.cap) return null;
    const it = { kind, x, z, y: this.world.heightAt(x, z), yaw, tint, idx: k.im.count++, held: false, scale: 1 };
    k.im.setColorAt(it.idx, new THREE.Color(k.tint ? tint : 0xffffff));
    k.im.instanceColor.needsUpdate = true;
    this.items.push(it);
    this._write(it);
    return it;
  }

  /** The closest object within `r` of (x, z) that is lying on the ground. */
  nearest(x, z, r) {
    let best = null;
    let bestD = r;
    for (const it of this.items) {
      if (it.held) continue;
      const dd = Math.hypot(it.x - x, it.z - z) - this.radius(it);
      if (dd < bestD) {
        bestD = dd;
        best = it;
      }
    }
    return best;
  }

  /** Objects lying within `r` of (x, z). */
  within(x, z, r) {
    return this.items.filter((it) => !it.held && Math.hypot(it.x - x, it.z - z) < r + this.radius(it));
  }

  /** An object's size in meters (its kind's radius times how supersized it is). */
  radius(it) {
    return this.kinds[it.kind].r * (it.scale || 1);
  }

  /** Take an object off the ground; returns a loose mesh of it to carry or throw. */
  lift(it) {
    it.held = true;
    this._write(it);
    const m = this.mesh(it.kind, it.tint);
    m.scale.setScalar(it.scale || 1);
    return m;
  }

  /** Supersize or shrink an object lying on the ground. */
  resize(it, scale) {
    it.scale = scale;
    if (!it.held) this._write(it);
  }

  /** A loose mesh of a kind (for carrying, throwing and other players' hands). */
  mesh(kind, tint = LEGO.white) {
    const k = this.kinds[kind];
    const mat = k.mat.clone();
    mat.onBeforeCompile = k.mat.onBeforeCompile;
    if (k.tint) mat.color.set(tint);
    const m = new THREE.Mesh(k.geo, mat);
    m.castShadow = true;
    return m;
  }

  /** Put a carried or thrown object back on the ground where it ended up. */
  drop(it, x, z, yaw) {
    Object.assign(it, { x, z, yaw, y: this.world.heightAt(x, z), held: false });
    this._write(it);
  }

  /** Re-seat objects near (x, z) on the ground (Google 3D: the real surface loads in late). */
  settle(x, z, r) {
    for (const it of this.items) {
      if (it.held || Math.abs(it.x - x) > r || Math.abs(it.z - z) > r) continue;
      const y = this.world.heightAt(it.x, it.z);
      if (Math.abs(y - it.y) > 0.3) {
        it.y = y;
        this._write(it);
      }
    }
  }

  info(kind) {
    return this.kinds[kind];
  }

  dispose() {
    for (const k of Object.values(this.kinds)) this.scene.remove(k.im);
  }
}

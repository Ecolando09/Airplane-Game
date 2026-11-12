import * as THREE from 'three';
import { LEGO, legoMaterial, isLego } from './lego.js';

// Hand-modeled landmarks the map data can't show well: bridges are only road
// lines over water, and arches, lattice towers and antennas would otherwise
// be solid blocks. Two kinds of entries come from the city file:
//  - "custom": built on a building's footprint (x, z, w = long side, d, ang, h)
//  - "structures": placed by position and compass heading (x, z, heading, ...)
// Each builder adds its meshes to the world and collision boxes for crashing
// (boxes may have a bottom, so you can fly under the bridge and through the arch).

// Shared materials for one world (a new city or look starts a fresh set).
const mats = new Map();
let matsWorld = null;
const mat = (color, opts = {}) => {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (!mats.has(key)) mats.set(key, legoMaterial({ color, ...opts }));
  return mats.get(key);
};

/** A group placed at (x, y, z). `ang` turns local +X to that angle (radians,
 *  like the footprint angle); for compass headings local -Z points along it. */
function group(world, x, y, z, ang) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = -ang;
  world.scene.add(g);
  world.meshes.push(g);
  return g;
}

function mesh(g, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  return m;
}

/** Collision box in the group's frame: centered at local (lx, lz), half sizes
 *  hw (local X) and hd (local Z), from world height `bottom` to `top`. */
function solid(world, g, lx, lz, hw, hd, bottom, top) {
  const a = -g.rotation.y;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = g.position.x + lx * c - lz * s;
  const z = g.position.z + lx * s + lz * c;
  const R = Math.hypot(hw, hd);
  world._addCollider({ t: 'box', x, z, c, s, hw, hd, bottom, top, lm: g },
    x - R + world.halfX, z - R + world.halfZ, x + R + world.halfX, z + R + world.halfZ);
}

/** A round solid (local center lx, lz, radius r) from `bottom` to `top`. */
function cyl(world, g, lx, lz, r, bottom, top) {
  const a = -g.rotation.y;
  const x = g.position.x + lx * Math.cos(a) - lz * Math.sin(a);
  const z = g.position.z + lx * Math.sin(a) + lz * Math.cos(a);
  world._addCollider({ t: 'cyl', x, z, r, bottom, top, lm: g }, x - r + world.halfX, z - r + world.halfZ, x + r + world.halfX, z + r + world.halfZ);
}

/** Lowest ground under a footprint, so models never float on a slope. */
function baseOf(world, { x, z, w = 40, d = 40, ang = 0 }) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  let min = Infinity;
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [0, 0]]) {
    min = Math.min(min, world.heightAt(x + (a * w * c - b * d * s) / 2, z + (a * w * s + b * d * c) / 2));
  }
  return min - 1;
}

/** A straight beam between two local points (for cables, struts and arch segments). */
function beam(g, a, b, thick, material) {
  const len = a.distanceTo(b);
  const m = mesh(g, new THREE.BoxGeometry(thick, len, thick), material);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

/** Tapered square (or round) section between two heights. */
function frustum(g, r0, r1, y0, y1, material, sides = 4) {
  const geo = new THREE.CylinderGeometry(r1, r0, y1 - y0, sides, 1);
  if (sides === 4) geo.rotateY(Math.PI / 4);
  return mesh(g, geo, material, 0, (y0 + y1) / 2, 0);
}

// ---------------------------------------------------------------- plain tower
// A building block in a set color, for towers that should match the real ones
// (like Marina Bay Sands' cream towers) instead of a random brick color.
function tower(world, f) {
  const base = baseOf(world, f);
  const g = group(world, f.x, base, f.z, f.ang);
  const color = new THREE.Color(f.color || '#e8e4da').getHex();
  mesh(g, new THREE.BoxGeometry(f.w, f.h + 1, f.d), mat(color, { windows: true, studs: 2.4 }), 0, (f.h + 1) / 2, 0);
  solid(world, g, 0, 0, f.w / 2, f.d / 2, -1e4, base + f.h + 1);
}

// ---------------------------------------------------------------- Gateway Arch
// St. Louis: a 192 m stainless steel catenary, as wide as it is tall, with
// legs that taper from about 16 m to 5 m.
function arch(world, f) {
  const base = baseOf(world, f);
  const g = group(world, f.x, base, f.z, f.ang);
  const steel = mat(isLego() ? LEGO.lightGray : 0xc9ced3);
  const H = f.h;
  const half = 96;
  const A = 39; // catenary shape constant: A (cosh(half / A) - 1) ≈ H
  const k = H / (A * (Math.cosh(half / A) - 1));
  const y = (x) => H - k * A * (Math.cosh(x / A) - 1);
  const N = 40;
  for (let i = 0; i < N; i++) {
    const x0 = -half + (i / N) * 2 * half;
    const x1 = -half + ((i + 1) / N) * 2 * half;
    const a = new THREE.Vector3(x0, Math.max(0, y(x0)), 0);
    const b = new THREE.Vector3(x1, Math.max(0, y(x1)), 0);
    const t = 1 - Math.abs(x0 + x1) / 2 / half; // 0 at the feet, 1 at the top
    const thick = 16 - 11 * t;
    beam(g, a, b, thick + 1.5, steel); // overlap a little so the joints close
    solid(world, g, (x0 + x1) / 2, 0, Math.abs(x1 - x0) / 2 + thick / 2, thick / 2,
      base + Math.min(a.y, b.y) - thick / 2, base + Math.max(a.y, b.y) + thick / 2);
  }
}

// ---------------------------------------------------------------- Sutro Tower
// San Francisco: a 298 m red-and-white three-legged antenna on Mount Sutro.
function sutro(world, f) {
  const base = baseOf(world, f);
  const g = group(world, f.x, base, f.z, f.ang);
  const red = mat(LEGO.red);
  const white = mat(LEGO.white);
  const H = f.h;
  const leg = (i, y0, y1, r0, r1) => {
    const a = (i / 3) * Math.PI * 2;
    return [new THREE.Vector3(Math.cos(a) * r0, y0, Math.sin(a) * r0), new THREE.Vector3(Math.cos(a) * r1, y1, Math.sin(a) * r1)];
  };
  // Legs in red and white bands, narrowing to a waist and widening at the top arms.
  const bands = [[0, 60, 26, 20], [60, 120, 20, 14], [120, 175, 14, 9], [175, 230, 9, 9], [230, 255, 9, 9]];
  for (let i = 0; i < 3; i++) {
    bands.forEach(([y0, y1, r0, r1], j) => beam(g, ...leg(i, y0, y1, r0, r1), 3.2, j % 2 ? white : red));
  }
  // Two sets of crossarms, the top one long, and three masts on top.
  for (const [y, r] of [[160, 16], [250, 30]]) {
    for (let i = 0; i < 3; i++) beam(g, ...leg(i, y, y, 0, r), 4, red);
    frustum(g, 7, 7, y - 2, y + 2, white, 6);
  }
  for (let i = 0; i < 3; i++) {
    const [, top] = leg(i, 250, 250, 0, 26);
    beam(g, top, top.clone().setY(H), 2, i % 2 ? white : red);
  }
  // One solid per leg segment (the space between the three legs is open).
  for (let i = 0; i < 3; i++) {
    for (const [y0, y1, r0, r1] of bands.slice(0, 4)) {
      for (let k = 0; k < 2; k++) {
        const ya = y0 + ((y1 - y0) * k) / 2;
        const yb = y0 + ((y1 - y0) * (k + 1)) / 2;
        const [p] = leg(i, (ya + yb) / 2, 0, r0 + ((r1 - r0) * (k + 0.5)) / 2, 0);
        solid(world, g, p.x, p.z, 3, 3, y0 || k ? base + ya : -1e4, base + yb);
      }
    }
  }
  cyl(world, g, 0, 0, 16, base + 157, base + 163); // the lower crossarms
  solid(world, g, 0, 0, 30, 30, base + 245, base + 256);
  solid(world, g, 0, 0, 27, 27, base + 256, base + H);
}

// ---------------------------------------------------------- Transamerica Pyramid
function pyramid(world, f) {
  const base = baseOf(world, f);
  const g = group(world, f.x, base, f.z, f.ang);
  const w = Math.min(f.w, f.d) / 2;
  const white = mat(isLego() ? LEGO.white : 0xe9e6df, { windows: true, studs: 2.4 });
  const body = 212;
  frustum(g, w * Math.SQRT2, 3, 0, body, white);
  // Elevator "wings" on two sides near the top, then the spire.
  for (const sx of [-1, 1]) mesh(g, new THREE.BoxGeometry(6, 60, 14), white, sx * 9, body - 60, 0);
  frustum(g, 3, 0.4, body, f.h, white);
  for (let i = 0; i < 4; i++) {
    const y0 = (i / 4) * body;
    const r = w * (1 - (y0 + body / 8) / body) + 2;
    solid(world, g, 0, 0, r, r, -1e4, base + y0 + body / 4);
  }
  solid(world, g, 0, 0, 3, 3, base + body, base + f.h);
}

// ---------------------------------------------------------------- Tokyo Tower
// 333 m orange-and-white lattice tower with the main deck at 150 m.
function tokyotower(world, f) {
  const base = baseOf(world, f);
  const g = group(world, f.x, base, f.z, f.ang);
  const orange = mat(isLego() ? LEGO.orange : 0xf05a28);
  const white = mat(LEGO.white);
  const glass = mat(isLego() ? LEGO.lightGray : 0xd8dde0, { windows: true });
  const half = 40;
  // Four legs that splay out at the ground, then the tapering tower above them.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    beam(g, new THREE.Vector3(sx * half, 0, sz * half), new THREE.Vector3(sx * 15, 140, sz * 15), 6, orange);
  }
  frustum(g, 24, 21, 40, 60, orange); // the first platform's band between the legs
  const bands = [[140, 150, 21, 19], [160, 185, 15, 12], [185, 205, 12, 9], [205, 225, 9, 7], [225, 245, 7, 5]];
  bands.forEach(([y0, y1, r0, r1], i) => frustum(g, r0, r1, y0, y1, i % 2 ? white : orange));
  frustum(g, 24, 24, 150, 160, glass, 8); // main deck
  frustum(g, 8, 8, 245, 252, glass, 8); // top deck
  for (let i = 0; i < 5; i++) frustum(g, 3 - i * 0.5, 2.6 - i * 0.5, 252 + i * 16, 268 + i * 16, i % 2 ? orange : white, 8);
  // One solid per leg below the first platform, so you can walk between them.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    for (let y0 = 0; y0 < 40; y0 += 10) {
      const o = half - ((half - 15) * (y0 + 5)) / 140;
      solid(world, g, sx * o, sz * o, 5, 5, y0 ? base + y0 : -1e4, base + y0 + 10);
    }
  }
  cyl(world, g, 0, 0, 25, base + 40, base + 60);
  solid(world, g, 0, 0, 20, 20, base + 60, base + 160);
  solid(world, g, 0, 0, 13, 13, base + 160, base + 205);
  solid(world, g, 0, 0, 8, 8, base + 205, base + 252);
  solid(world, g, 0, 0, 3, 3, base + 252, base + f.h);
}

// ---------------------------------------------------------------- Tokyo Skytree
// 634 m: a pale shaft that goes from a triangle to a circle, with two ring decks.
function skytree(world, f) {
  const base = baseOf(world, f);
  const g = group(world, f.x, base, f.z, f.ang);
  const shaft = mat(isLego() ? LEGO.white : 0xe6eef2);
  const deck = mat(isLego() ? LEGO.lightGray : 0xc8d2d8, { windows: true });
  const parts = [
    [0, 120, 34, 26, shaft, 3], [120, 340, 26, 15, shaft, 12], [340, 355, 22, 22, deck, 16],
    [355, 445, 15, 12, shaft, 12], [445, 452, 16, 16, deck, 16], [452, 500, 11, 7, shaft, 12],
    [500, 634, 5, 1, shaft, 8],
  ];
  for (const [y0, y1, r0, r1, m, sides] of parts) frustum(g, r0, r1, y0, y1, m, sides);
  for (const [y0, y1, r0, r1] of parts) cyl(world, g, 0, 0, Math.max(r0, r1) * 0.95, y0 ? base + y0 : -1e4, base + y1);
}

// ---------------------------------------------------------------- Golden Gate Bridge
// Two 227 m towers 1280 m apart, the deck 67 m over the water and the main
// cables sagging between them, all in International Orange. Local -Z runs
// north along the bridge; `south`/`north` are the deck's lengths each way.
function ggbridge(world, s) {
  const water = world.heightAt(s.x, s.z);
  const g = group(world, s.x, water, s.z, THREE.MathUtils.degToRad(s.heading));
  const orange = mat(0xc0452c);
  const DECK = 67;
  const TOWER = 227;
  const span = 640; // half the main span
  const anchor = 983; // tower + side span
  const fwd = new THREE.Vector3(Math.sin(THREE.MathUtils.degToRad(s.heading)), 0, -Math.cos(THREE.MathUtils.degToRad(s.heading)));
  // Deck height along the bridge: level over the water, then down onto the land at each end.
  const deckY = (t) => {
    const end = t < 0 ? -s.south : s.north;
    if (Math.abs(t) <= anchor) return DECK;
    const ground = world.heightAt(s.x + fwd.x * end, s.z + fwd.z * end) - water + 3;
    const u = (Math.abs(t) - anchor) / (Math.abs(end) - anchor);
    return DECK + (Math.max(ground, 8) - DECK) * u;
  };
  // Deck in 60 m pieces (local z = -t, since -Z is north).
  for (let t = -s.south; t < s.north; t += 60) {
    const t1 = Math.min(t + 60, s.north);
    const y0 = deckY(t);
    const y1 = deckY(t1);
    beam(g, new THREE.Vector3(0, y0 - 4, -t), new THREE.Vector3(0, y1 - 4, -t1), 1, orange).scale.set(27, 1, 7.6);
    solid(world, g, 0, -(t + t1) / 2, 14, (t1 - t) / 2, water + Math.min(y0, y1) - 9, water + Math.max(y0, y1) + 2);
  }
  // Towers: two legs joined by portal struts above the deck.
  for (const t of [-span, span]) {
    for (const sx of [-1, 1]) {
      mesh(g, new THREE.BoxGeometry(9, TOWER + 15, 14), orange, sx * 14, (TOWER - 15) / 2, -t);
    }
    for (const y of [DECK + 30, DECK + 75, DECK + 115, TOWER - 8]) mesh(g, new THREE.BoxGeometry(28, 7, 6), orange, 0, y, -t);
    solid(world, g, 0, -t, 20, 8, -1e4, water + TOWER);
  }
  // Main cables: a parabola across the main span, straight down to the anchors
  // on the side spans, with vertical suspenders down to the deck.
  const cableY = (t) => {
    const a = Math.abs(t);
    if (a <= span) return DECK + 5 + (TOWER - DECK - 12) * (a / span) ** 2;
    return TOWER - 7 - (TOWER - DECK - 10) * Math.min(1, (a - span) / (anchor - span));
  };
  const hangers = [];
  for (const sx of [-1, 1]) {
    let prev = null;
    for (let t = -anchor; t <= anchor; t += 40) {
      const p = new THREE.Vector3(sx * 14, cableY(t), -t);
      if (prev) beam(g, prev, p, 1.6, orange);
      prev = p;
    }
    for (let t = -anchor + 15; t < anchor; t += 15) {
      if (Math.abs(Math.abs(t) - span) < 8) continue;
      hangers.push([sx * 14, t]);
    }
    // The suspender curtain on each side is solid enough to crash into.
    for (let t = -anchor; t < anchor; t += 80) {
      const lo = DECK - 2;
      const hi = Math.max(cableY(t), cableY(t + 80));
      solid(world, g, sx * 14, -(t + 40), 1.5, 40, water + lo, water + hi);
    }
  }
  const hm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 1, 0.4).translate(0, 0.5, 0), orange, hangers.length);
  const m = new THREE.Matrix4();
  hangers.forEach(([x, t], i) => {
    const h = cableY(t) - DECK;
    hm.setMatrixAt(i, m.compose(new THREE.Vector3(x, DECK, -t), new THREE.Quaternion(), new THREE.Vector3(1, h, 1)));
  });
  g.add(hm);
  // Concrete anchorages where the cables come down.
  const concrete = mat(isLego() ? LEGO.lightGray : 0xb8b4aa);
  for (const t of [-anchor, anchor]) {
    const y = world.heightAt(s.x + fwd.x * t, s.z + fwd.z * t) - water;
    mesh(g, new THREE.BoxGeometry(40, DECK - y + 6, 30), concrete, 0, (DECK + y) / 2, -t);
    solid(world, g, 0, -t, 20, 15, -1e4, water + DECK + 3);
  }
}

// ---------------------------------------------------------------- Marina Bay Sands SkyPark
// The 340 m "ship" across the tops of the three towers (the towers are in the map data).
function skypark(world, s) {
  const ground = world.heightAt(s.x, s.z);
  const g = group(world, s.x, ground, s.z, THREE.MathUtils.degToRad(s.heading));
  const L = s.length;
  const hull = new THREE.Shape();
  hull.moveTo(-19, L / 2 - 20);
  hull.quadraticCurveTo(0, L / 2 + 15, 19, L / 2 - 20);
  hull.lineTo(19, -L / 2 + 10);
  hull.quadraticCurveTo(0, -L / 2 - 8, -19, -L / 2 + 10);
  hull.closePath();
  const geo = new THREE.ExtrudeGeometry(hull, { depth: 8, bevelEnabled: false }).rotateX(-Math.PI / 2);
  // After the rotation the shape's +y runs along local -Z (north, the cantilevered bow).
  mesh(g, geo, mat(isLego() ? LEGO.white : 0xdedede), 0, s.top, 0);
  const pool = mesh(g, new THREE.BoxGeometry(10, 0.6, L * 0.4), mat(isLego() ? LEGO.medAzure : 0x3cb6d8), -9, s.top + 8.3, -L * 0.15);
  pool.castShadow = false;
  for (let i = 0; i < 14; i++) {
    mesh(g, new THREE.SphereGeometry(2.6, 8, 6), mat(LEGO.green), 9, s.top + 10.5, -L * 0.4 + i * (L * 0.8 / 13));
  }
  solid(world, g, 0, 0, 20, L / 2 + 10, ground + s.top - 2, ground + s.top + 13);
}

// ---------------------------------------------------------------- Singapore Flyer
// A 150 m wheel on a terminal building, turning slowly; the wheel's plane
// runs along `heading`. You can fly through it, between the spokes.
function flyer(world, s) {
  const ground = world.heightAt(s.x, s.z);
  const g = group(world, s.x, ground, s.z, THREE.MathUtils.degToRad(s.heading));
  const white = mat(LEGO.white);
  const steel = mat(isLego() ? LEGO.lightGray : 0xb7bcc0);
  const R = 75;
  const HUB = 90;
  mesh(g, new THREE.BoxGeometry(40, 14, 110), mat(isLego() ? LEGO.sandGreen : 0xc7d3cc, { windows: true }), 0, 7, 0);
  // A-frame legs on one side holding the hub.
  for (const sz of [-1, 1]) beam(g, new THREE.Vector3(-14, 10, sz * 34), new THREE.Vector3(-8, HUB, 0), 3.5, white);
  const wheel = new THREE.Group();
  wheel.position.set(0, HUB, 0);
  g.add(wheel);
  mesh(wheel, new THREE.TorusGeometry(R, 2, 8, 64).rotateY(Math.PI / 2), white);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    beam(wheel, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, Math.sin(a) * R, Math.cos(a) * R), 0.6, steel);
  }
  const caps = new THREE.InstancedMesh(new THREE.CapsuleGeometry(2.4, 5, 4, 8).rotateX(Math.PI / 2),
    mat(isLego() ? LEGO.transBlue : 0x9fd3ea), 28);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    caps.setMatrixAt(i, m.makeTranslation(3.5, Math.sin(a) * (R + 3), Math.cos(a) * (R + 3)));
  }
  wheel.add(caps);
  mesh(g, new THREE.CylinderGeometry(4, 4, 10, 12).rotateZ(Math.PI / 2), steel, -2, HUB, 0);
  world.animate.push((t) => (wheel.rotation.x = t * 0.03));
  // Rim as solid pieces, the open middle and the spokes are fair game.
  for (let i = 0; i < 16; i++) {
    const a = ((i + 0.5) / 16) * Math.PI * 2;
    const y = HUB + Math.sin(a) * R;
    const dy = Math.abs(Math.cos(a)) * 15 + 4;
    solid(world, g, 0, Math.cos(a) * R, 5, Math.abs(Math.sin(a)) * 15 + 4, ground + y - dy, ground + y + dy);
  }
  solid(world, g, 0, 0, 20, 55, -1e4, ground + 14);
}

// ---------------------------------------------------------------- Supertree Grove
// Gardens by the Bay: a dozen 25-50 m steel "trees" with funnel canopies.
function supertrees(world, s) {
  const ground = world.heightAt(s.x, s.z);
  const g = group(world, s.x, ground, s.z, 0);
  const trunk = mat(isLego() ? 0x8e4fb5 : 0x6f4b7d);
  const canopy = mat(isLego() ? 0xc870a0 : 0x8b5a8f);
  const spots = [[0, 0, 50], [45, 10, 50], [-30, 25, 42], [20, -40, 36], [-40, -25, 32], [60, -30, 28],
    [-10, 55, 30], [35, 45, 26], [-55, 5, 28], [75, 25, 25], [5, -70, 27], [-25, -60, 25]];
  for (const [x, z, h] of spots) {
    mesh(g, new THREE.CylinderGeometry(2.2, 4, h - 6, 10), trunk, x, (h - 6) / 2, z);
    mesh(g, new THREE.CylinderGeometry(h * 0.28, 2.2, 7, 14, 1, true), canopy, x, h - 3.5, z).material.side = THREE.DoubleSide;
    cyl(world, g, x, z, 4, -1e4, ground + h - 6);
    cyl(world, g, x, z, h * 0.28, ground + h - 7, ground + h);
  }
  // The skyway between the two tallest.
  mesh(g, new THREE.BoxGeometry(45, 1.5, 3), mat(LEGO.darkGray), 22.5, 22, 5);
}

// ---------------------------------------------------------------- Tian Tan Buddha
// The Big Buddha at Ngong Ping, Lantau: a bronze seated figure on a lotus, on
// a three-tier round altar on top of its hill. Built a little larger than life
// (about 50 m with the altar) so it reads from the air.
function buddha(world, s) {
  const ground = world.heightAt(s.x, s.z);
  const g = group(world, s.x, ground, s.z, THREE.MathUtils.degToRad(s.heading || 0));
  const bronze = mat(isLego() ? 0x8a7443 : 0x6f6247);
  const stone = mat(isLego() ? LEGO.tan : 0xcfc6b0);
  const round = (r0, r1, y0, y1, m, sides = 20) => frustum(g, r0, r1, y0, y1, m, sides);
  // Altar: three tiers, modeled on the Temple of Heaven.
  round(30, 30, -6, 4, stone);
  round(23, 23, 4, 8, stone);
  round(17, 17, 8, 12, stone);
  // Lotus throne: a ring of petals around a low drum.
  round(11, 13, 12, 16, bronze);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const petal = mesh(g, new THREE.ConeGeometry(2.6, 6, 5), bronze, Math.cos(a) * 12.2, 15.5, Math.sin(a) * 12.2);
    petal.rotation.z = -Math.cos(a) * 0.45;
    petal.rotation.x = Math.sin(a) * 0.45;
  }
  // Crossed legs, body, shoulders, head.
  const legs = mesh(g, new THREE.SphereGeometry(11, 16, 10), bronze, 0, 18.5, -1);
  legs.scale.set(1, 0.38, 0.8);
  round(7.5, 5.6, 19, 32, bronze, 14);
  const shoulders = mesh(g, new THREE.SphereGeometry(7.4, 14, 10), bronze, 0, 31.5, 0);
  shoulders.scale.set(1.15, 0.55, 0.8);
  mesh(g, new THREE.SphereGeometry(3.9, 14, 12), bronze, 0, 38, -0.4);
  mesh(g, new THREE.SphereGeometry(1.7, 10, 8), bronze, 0, 42, -0.2); // topknot
  for (const sx of [-1, 1]) mesh(g, new THREE.BoxGeometry(0.8, 3.4, 1.2), bronze, sx * 3.9, 37.4, -0.2); // long ears
  // Right hand raised in blessing, left hand resting on the lap (local -Z is the front).
  const upper = mesh(g, new THREE.BoxGeometry(2.6, 8, 2.6), bronze, -7.6, 28, -1.5);
  upper.rotation.x = -0.25;
  mesh(g, new THREE.BoxGeometry(2.4, 7, 2.2), bronze, -7.4, 30.5, -6).rotation.x = 0.5;
  mesh(g, new THREE.BoxGeometry(3, 4.2, 0.9), bronze, -7.2, 34.8, -7.6); // open palm
  mesh(g, new THREE.BoxGeometry(2.6, 2.4, 7), bronze, 6.6, 23, -4.5).rotation.y = 0.5;
  mesh(g, new THREE.BoxGeometry(4.2, 1, 3.4), bronze, 3, 22.4, -8); // resting hand
  // The long stairway up from the plaza.
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    const d = 31 + i * 5.5;
    const x = s.x + Math.sin(THREE.MathUtils.degToRad(s.heading || 0)) * d;
    const z = s.z - Math.cos(THREE.MathUtils.degToRad(s.heading || 0)) * d;
    const y = world.heightAt(x, z) - ground;
    mesh(g, new THREE.BoxGeometry(12, 3, 6), stone, 0, Math.min(3, y) - 0.5, -d);
  }
  // Round, like the altar and the figure (the old square corners stuck out past the drawing).
  cyl(world, g, 0, 0, 30, -1e4, ground + 4);
  cyl(world, g, 0, 0, 23, ground + 4, ground + 8);
  cyl(world, g, 0, 0, 17, ground + 8, ground + 16);
  cyl(world, g, 0, 0, 9, ground + 16, ground + 34);
  cyl(world, g, 0, -0.4, 4, ground + 34, ground + 44);
}

const BUILDERS = { buddha, tower, arch, sutro, pyramid, tokyotower, skytree, ggbridge, skypark, flyer, supertrees };

/** Build a hand-modeled landmark; unknown kinds are skipped. Returns true if built. */
export function buildLandmark(world, spec) {
  const fn = BUILDERS[spec.kind];
  if (!fn) return false;
  if (matsWorld !== world) {
    mats.clear();
    matsWorld = world;
  }
  fn(world, spec);
  return true;
}

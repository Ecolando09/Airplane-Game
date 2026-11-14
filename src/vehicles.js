import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LEGO } from './lego.js';

// Detailed vehicles (plan 05 part 1g), built in code so the apps stay small.
// Two styles that match the city's look:
//  - 'lego': brick-built, like a Speed Champions set: plates, slopes, studs on
//    the roof, tiles for lights.
//  - 'real': smooth painted bodies from a side silhouette with rounded edges,
//    see-through-dark glass, bumpers and wheel arches.
// Each vehicle is a list of vertex-coloured geometries. WHITE parts take the
// vehicle's paint (instance colour); everything else keeps its own colour.
// Wheels come separately, so they can spin, and lamps separately, so they can
// glow at night. All models face -Z (the front), sitting on y = 0.

export const WHITE = 0xffffff;
const GLASS = 0x22323f;
const TYRE = 0x1b1b1b;
const HUB = 0xc9ced3;
const CHROME = 0xb9c0c6;
const DARK = 0x2b2f33;
export const HEAD = 0xfff4c8;
export const TAIL = 0xff2a1a;

function colour(g, hex) {
  const geo = g.index ? g.toNonIndexed() : g;
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  if (geo.attributes.uv1) geo.deleteAttribute('uv1');
  const c = new THREE.Color(hex);
  const a = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) c.toArray(a, i);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (!geo.attributes.normal) geo.computeVertexNormals();
  return geo;
}
const box = (w, h, d, hex, x = 0, y = 0, z = 0) => colour(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);
const cylX = (r, len, hex, x, y, z, seg = 14) => colour(new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2).translate(x, y, z), hex);
const cylY = (r, h, hex, x, y, z, seg = 10) => colour(new THREE.CylinderGeometry(r, r, h, seg).translate(x, y, z), hex);

/** A side silhouette [[z, y], ...] (front is -z) extruded across the width, with rounded edges. */
function profile(points, width, hex, bevel = 0.18) {
  const s = new THREE.Shape();
  points.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  s.closePath();
  const w = Math.max(0.05, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6 });
  g.rotateY(-Math.PI / 2); // shape x -> world z, extrusion -> world -x
  g.translate(w / 2, 0, 0);
  return colour(g, hex);
}

/** A wedge (Lego slope brick): rises from yLow at the front edge to yHigh at the back. */
function slope(w, d, yLow, yHigh, hex, z) {
  const s = new THREE.Shape();
  s.moveTo(-d / 2, 0);
  s.lineTo(d / 2, 0);
  s.lineTo(d / 2, yHigh - yLow);
  s.lineTo(-d / 2, 0.05);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
  g.rotateY(-Math.PI / 2);
  g.translate(w / 2, yLow, z);
  return colour(g, hex);
}

/** Studs on top of a plate (Lego style). */
function studs(nx, nz, pitch, y, cx, cz, hex) {
  const out = [];
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) out.push(cylY(pitch * 0.3, pitch * 0.22, hex, cx + (i - (nx - 1) / 2) * pitch, y + pitch * 0.11, cz + (k - (nz - 1) / 2) * pitch));
  return out;
}

// ------------------------------------------------------------------ cars
// Dimensions in meters (a little larger than life so they read from the air).
const CARS = {
  sedan: { L: 5.6, W: 2.3, wheelR: 0.48, axle: [-1.75, 1.75], sil: [[-2.8, 0.45], [-2.8, 0.95], [-1.4, 1.2], [-0.6, 1.95], [0.9, 1.95], [1.6, 1.25], [2.8, 1.15], [2.8, 0.45]], cab: [-0.55, 1.6] },
  taxi: { L: 5.6, W: 2.3, wheelR: 0.48, axle: [-1.75, 1.75], sil: [[-2.8, 0.45], [-2.8, 0.95], [-1.4, 1.2], [-0.6, 1.95], [0.9, 1.95], [1.6, 1.25], [2.8, 1.15], [2.8, 0.45]], cab: [-0.55, 1.6], sign: true },
  sports: { L: 5.4, W: 2.4, wheelR: 0.5, axle: [-1.7, 1.75], sil: [[-2.7, 0.4], [-2.7, 0.75], [-1.0, 1.05], [-0.1, 1.55], [0.9, 1.55], [2.2, 1.1], [2.7, 1.05], [2.7, 0.4]], cab: [-0.05, 1.3] },
  suv: { L: 5.8, W: 2.5, wheelR: 0.62, axle: [-1.85, 1.85], sil: [[-2.9, 0.55], [-2.9, 1.25], [-1.6, 1.45], [-1.0, 2.35], [2.6, 2.35], [2.9, 2.0], [2.9, 0.55]], cab: [-0.95, 2.6] },
  van: { L: 6.0, W: 2.5, wheelR: 0.55, axle: [-2.0, 2.0], sil: [[-3.0, 0.5], [-3.0, 1.2], [-2.4, 1.5], [-1.9, 2.75], [3.0, 2.75], [3.0, 0.5]], cab: [-1.85, 3.0], windows: 'side' },
  pickup: { L: 6.0, W: 2.5, wheelR: 0.62, axle: [-2.0, 1.9], sil: [[-3.0, 0.55], [-3.0, 1.3], [-1.7, 1.45], [-1.1, 2.3], [0.5, 2.3], [0.6, 1.45], [3.0, 1.45], [3.0, 0.55]], cab: [-1.05, 1.0], bed: true },
  kei: { L: 4.2, W: 2.0, wheelR: 0.4, axle: [-1.3, 1.3], sil: [[-2.1, 0.4], [-2.1, 2.3], [2.1, 2.3], [2.1, 0.4]], cab: [-2.0, 2.0], windows: 'side' },
};
export const CAR_KINDS = Object.keys(CARS);

/** Where a car kind's wheels go: [[x, z, r], ...]. */
export function carWheels(kind) {
  const c = CARS[kind];
  const x = c.W / 2 - 0.1;
  return c.axle.flatMap((z) => [[-x, z, c.wheelR], [x, z, c.wheelR]]);
}

/** Body (without wheels) and lamps for a car kind in a style. */
export function carModel(kind, style) {
  const c = CARS[kind];
  const body = [];
  const lamps = [];
  const { L, W } = c;
  if (style === 'real') {
    body.push(profile(c.sil, W, WHITE, 0.22));
    // Glass: a slightly wider greenhouse band above the waist.
    const waist = c.sil.reduce((m, [, y]) => Math.min(m, y > 1 ? y : m), 9);
    const top = Math.max(...c.sil.map(([, y]) => y));
    const roofPts = c.sil.filter(([, y]) => y > waist + 0.05);
    if (roofPts.length >= 2 && !c.bed) {
      const z0 = Math.min(...roofPts.map(([z]) => z));
      const z1 = Math.max(...roofPts.map(([z]) => z));
      body.push(profile([[z0 + 0.05, waist + 0.06], [z0 + 0.25, top - 0.12], [z1 - 0.25, top - 0.12], [z1 - 0.05, waist + 0.06]], W + 0.06, GLASS, 0.04));
    } else if (c.bed) {
      body.push(profile([[-1.65, 1.5], [-1.1, 2.18], [0.42, 2.18], [0.48, 1.5]], W + 0.06, GLASS, 0.04));
      body.push(box(W - 0.3, 0.25, 2.3, DARK, 0, 1.33, 1.75)); // the empty bed
    }
    body.push(box(W + 0.1, 0.35, 0.3, DARK, 0, 0.6, -L / 2 - 0.05)); // bumpers
    body.push(box(W + 0.1, 0.35, 0.3, DARK, 0, 0.6, L / 2 + 0.05));
    body.push(box(W * 0.45, 0.3, 0.05, CHROME, 0, 0.92, -L / 2 - 0.05)); // grille
    body.push(box(0.6, 0.2, 0.05, WHITE + 0, 0, 0.6, L / 2 + 0.22)); // plate
    for (const s of [-1, 1]) {
      body.push(box(0.25, 0.15, 0.35, WHITE, s * (W / 2 + 0.12), c.sil[2][1] + 0.35, c.sil[2][0] + 0.5)); // mirrors
      for (const z of c.axle) body.push(colour(new THREE.TorusGeometry(c.wheelR + 0.12, 0.08, 6, 14, Math.PI).rotateY(Math.PI / 2).translate(s * (W / 2 + 0.02), c.wheelR + 0.1, z), DARK)); // arches
    }
  } else {
    // Lego: chassis plate, body bricks, slopes for the hood and windscreen, a studded roof.
    body.push(box(W - 0.2, 0.32, L - 0.3, DARK, 0, 0.42, 0));
    body.push(box(W, 0.75, L, WHITE, 0, 0.95, 0));
    const [cabZ, cabTop] = c.cab;
    const roofZ0 = c.sil.find(([, y]) => y > 1.7)?.[0] ?? cabZ;
    const top = Math.max(...c.sil.map(([, y]) => y));
    const rearZ = c.bed ? 0.55 : Math.max(...c.sil.filter(([, y]) => y > 1.7).map(([z]) => z));
    if (c.windows === 'side') {
      body.push(box(W, top - 1.32, rearZ - roofZ0, WHITE, 0, (1.32 + top) / 2, (roofZ0 + rearZ) / 2));
      body.push(box(W + 0.04, 0.6, rearZ - roofZ0 - 0.9, GLASS, 0, top - 0.55, (roofZ0 + rearZ) / 2 + 0.25));
      body.push(slope(W, 0.8, 1.32, top, GLASS, roofZ0 - 0.3));
    } else {
      body.push(slope(W - 0.1, Math.max(0.6, roofZ0 - (-L / 2 + 0.9)), 1.32, 1.45, WHITE, (-L / 2 + 0.9 + roofZ0) / 2 - 0.1)); // hood
      body.push(slope(W - 0.2, 0.75, 1.32, top - 0.05, GLASS, roofZ0 - 0.35)); // windscreen
      body.push(box(W - 0.2, top - 1.4, rearZ - roofZ0, GLASS, 0, (1.32 + top) / 2 - 0.03, (roofZ0 + rearZ) / 2));
      body.push(box(W, 0.18, rearZ - roofZ0 + 0.1, WHITE, 0, top, (roofZ0 + rearZ) / 2)); // roof plate
    }
    body.push(...studs(2, Math.max(1, Math.round((rearZ - roofZ0) / 0.8)), 0.8, top + 0.09, 0, (roofZ0 + rearZ) / 2, WHITE));
    if (c.bed) body.push(box(W - 0.4, 0.2, 2.3, DARK, 0, 1.36, 1.75), box(0.2, 0.45, 2.4, WHITE, -W / 2 + 0.1, 1.55, 1.75), box(0.2, 0.45, 2.4, WHITE, W / 2 - 0.1, 1.55, 1.75));
    body.push(box(W + 0.12, 0.3, 0.25, DARK, 0, 0.62, -L / 2 - 0.08), box(W + 0.12, 0.3, 0.25, DARK, 0, 0.62, L / 2 + 0.08)); // bumpers
    body.push(box(W * 0.4, 0.25, 0.08, CHROME, 0, 1.0, -L / 2 - 0.03)); // grille tile
    for (const s of [-1, 1]) body.push(box(0.2, 0.2, 0.3, WHITE, s * (W / 2 + 0.1), 1.6, roofZ0));
  }
  if (c.sign) body.push(box(0.9, 0.35, 0.3, 0xffd21f, 0, Math.max(...c.sil.map(([, y]) => y)) + 0.2, 0.2));
  // Lamps: headlights at the front corners, tail lights at the back.
  const ly = style === 'real' ? 0.95 : 1.05;
  for (const s of [-1, 1]) {
    lamps.push(box(0.45, 0.2, 0.08, HEAD, s * (W / 2 - 0.35), ly, -L / 2 - 0.02));
    lamps.push(box(0.4, 0.2, 0.08, TAIL, s * (W / 2 - 0.3), ly, L / 2 + 0.02));
  }
  return { body: mergeGeometries(body), lamps: mergeGeometries(lamps) };
}

/** A wheel: tyre, hubcap and (Lego) a little axle pin. Lies along X, centred at 0. */
export function wheelGeometry(r, style) {
  const parts = [cylX(r, 0.42, TYRE, 0, 0, 0, 16), cylX(r * 0.55, 0.46, HUB, 0, 0, 0, 12)];
  if (style !== 'real') parts.push(cylX(r * 0.18, 0.5, DARK, 0, 0, 0, 8));
  else for (let k = 0; k < 5; k++) parts.push(box(0.48, r * 0.12, r * 0.6, 0x9aa1a7, 0, 0, 0).rotateX((k / 5) * Math.PI));
  return mergeGeometries(parts);
}

// ------------------------------------------------------------------ bigger vehicles and boats
/** A school bus, trucks, boats, a parked plane: [geometries] with wheels included (for props). */
export function otherModel(kind, style) {
  const real = style === 'real';
  const P = [];
  const wheelsAt = (list, r) => {
    const w = wheelGeometry(r, style);
    for (const [x, z] of list) P.push(w.clone().translate(x, r, z));
  };
  if (kind === 'bus') {
    P.push(real ? profile([[-5.6, 0.7], [-5.6, 3.3], [-5.3, 3.7], [5.6, 3.7], [5.6, 0.7]], 3.1, LEGO.yellow, 0.2) : box(3.1, 3.0, 11.2, LEGO.yellow, 0, 2.2, 0));
    for (const s of [-1, 1]) for (let k = 0; k < 7; k++) P.push(box(0.06, 0.95, 1.1, GLASS, s * 1.57, 2.75, -3.9 + k * 1.35));
    P.push(box(2.8, 1.1, 0.06, GLASS, 0, 2.75, -5.63), box(3.25, 0.25, 11.3, LEGO.black, 0, 1.6, 0), box(3.25, 0.4, 0.3, DARK, 0, 0.8, -5.7));
    P.push(colour(new THREE.CylinderGeometry(0.35, 0.35, 0.05, 8).rotateZ(Math.PI / 2).translate(-1.75, 2.4, -3.8), LEGO.red)); // stop sign
    if (!real) P.push(...studs(3, 9, 0.9, 3.7, 0, 0, LEGO.yellow));
    wheelsAt([[-1.45, -3.8], [1.45, -3.8], [-1.45, 3.6], [1.45, 3.6]], 0.75);
    P.push(box(0.4, 0.25, 0.08, 0xff8a00, -1.2, 3.55, -5.62), box(0.4, 0.25, 0.08, 0xff8a00, 1.2, 3.55, -5.62)); // flashers
  } else if (kind === 'tanker') {
    P.push(real ? profile([[-4.8, 0.8], [-4.8, 2.8], [-4.2, 3.2], [-2.6, 3.2], [-2.4, 0.8]], 2.7, LEGO.red, 0.18) : box(2.7, 2.4, 2.4, LEGO.red, 0, 2.0, -3.6));
    P.push(box(2.75, 0.8, 0.06, GLASS, 0, 2.6, -4.82));
    P.push(colour(new THREE.CylinderGeometry(1.4, 1.4, 6.2, real ? 20 : 10).rotateX(Math.PI / 2).translate(0, 2.25, 0.9), CHROME));
    P.push(box(2.6, 0.45, 9.6, DARK, 0, 0.95, 0));
    for (const z of [-1.5, 0.9, 3.3]) P.push(colour(new THREE.TorusGeometry(1.42, 0.07, 6, 18).translate(0, 2.25, z), DARK));
    wheelsAt([[-1.3, -3.5], [1.3, -3.5], [-1.3, 1.6], [1.3, 1.6], [-1.3, 3.4], [1.3, 3.4]], 0.65);
  } else if (kind === 'truck') {
    P.push(real ? profile([[-3.4, 0.6], [-3.4, 1.9], [-2.5, 2.4], [-2.4, 3.8], [3.4, 3.8], [3.4, 0.6]], 2.8, LEGO.white, 0.18) : box(2.8, 3.0, 6.6, LEGO.white, 0, 2.2, 0.2));
    P.push(box(2.85, 0.9, 1.6, 0xff8fc7, 0, 3.4, 0.6), box(0.06, 1.0, 2.4, GLASS, 1.42, 2.6, 0.8), box(2.4, 0.8, 0.06, GLASS, 0, 2.7, -2.5));
    P.push(colour(new THREE.ConeGeometry(0.7, 1.6, 10).rotateX(Math.PI).translate(0, 4.6, 0.6), LEGO.tan), colour(new THREE.SphereGeometry(0.8, 10, 8).translate(0, 5.6, 0.6), 0xff8fc7));
    wheelsAt([[-1.35, -2.3], [1.35, -2.3], [-1.35, 2.3], [1.35, 2.3]], 0.6);
  } else if (kind === 'cart') {
    P.push(box(1.7, 0.6, 3.0, LEGO.white, 0, 0.85, 0), box(1.5, 0.5, 0.8, LEGO.black, 0, 1.35, 0.4), box(1.8, 0.12, 2.6, LEGO.green, 0, 2.6, 0.1));
    for (const [x, z] of [[-0.8, -0.9], [0.8, -0.9], [-0.8, 1.2], [0.8, 1.2]]) P.push(box(0.1, 1.6, 0.1, LEGO.black, x, 1.8, z));
    P.push(box(1.5, 0.7, 0.05, GLASS, 0, 2.1, -1.0));
    wheelsAt([[-0.85, -1.1], [0.85, -1.1], [-0.85, 1.1], [0.85, 1.1]], 0.38);
  } else if (kind === 'boat') {
    // Speedboat: a pointed hull, a windscreen and seats.
    const hull = new THREE.Shape();
    hull.moveTo(-1.35, 3.4);
    hull.lineTo(1.35, 3.4);
    hull.lineTo(1.35, -1.2);
    hull.quadraticCurveTo(1.2, -3.2, 0, -4.6);
    hull.quadraticCurveTo(-1.2, -3.2, -1.35, -1.2);
    hull.closePath();
    const hg = new THREE.ExtrudeGeometry(hull, { depth: 1.2, bevelEnabled: true, bevelThickness: 0.15, bevelSize: real ? 0.2 : 0.05, bevelSegments: real ? 3 : 1, curveSegments: real ? 10 : 4 });
    hg.rotateX(Math.PI / 2).translate(0, 1.3, 0);
    P.push(colour(hg, WHITE));
    P.push(box(2.3, 0.15, 5.2, LEGO.tan, 0, 1.35, 0.6), box(2.0, 0.7, 0.08, GLASS, 0, 1.75, -0.6), box(0.8, 0.5, 0.8, LEGO.white, -0.5, 1.6, 0.6), box(0.8, 0.5, 0.8, LEGO.white, 0.5, 1.6, 0.6));
    P.push(box(0.5, 0.9, 0.5, DARK, 0, 1.1, 3.6)); // outboard motor
  } else if (kind === 'plane') {
    // A small high-wing plane like the one you fly: fuselage, wing with struts, tail, propeller.
    const fus = new THREE.CylinderGeometry(0.75, 0.45, 7.2, real ? 14 : 8).rotateX(Math.PI / 2).translate(0, 1.9, 0.4);
    P.push(colour(fus, WHITE), box(1.25, 0.9, 1.8, GLASS, 0, 2.55, -1.1));
    P.push(box(11.5, 0.22, 1.7, WHITE, 0, 3.05, -1.0), box(4.2, 0.18, 1.1, WHITE, 0, 2.05, 3.7), box(0.18, 1.7, 1.3, WHITE, 0, 2.85, 3.8));
    for (const s of [-1, 1]) P.push(box(0.08, 1.4, 0.08, DARK, s * 1.6, 2.35, -1.0).rotateZ(s * -0.6));
    P.push(box(0.15, 2.6, 0.22, DARK, 0, 1.9, -3.35), cylY(0.25, 0.4, DARK, 0, 1.9, -3.2));
    P.push(box(0.9, 0.25, 0.04, LEGO.black, 1.2, 1.9, 2.5)); // tail number
    wheelsAt([[-1.1, -1.3], [1.1, -1.3]], 0.42);
    P.push(wheelGeometry(0.22, style).translate(0, 0.22, 3.4));
  }
  return P;
}

/** Car kinds that drive in a city (a few local ones where it helps). */
export function trafficKinds(city) {
  const base = ['sedan', 'sedan', 'suv', 'pickup', 'van', 'sports', 'sedan', 'suv'];
  if (city === 'tokyo') return [...base, 'kei', 'kei', 'taxi'];
  if (city === 'hongkong' || city === 'singapore') return [...base, 'taxi', 'van'];
  if (city === 'sanfrancisco' || city === 'stlouis' || city === 'denver') return [...base, 'taxi'];
  return base;
}

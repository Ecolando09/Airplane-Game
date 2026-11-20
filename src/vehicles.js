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

/**
 * Size and seats of every drivable kind (scale 1), for lights and the driver's
 * view: L length, W width, eye = driver's eye [x, y, z], dash = dashboard style.
 */
const OTHER = {
  bus: { L: 11.2, W: 3.1, eye: [-0.9, 3.0, -4.6], lampY: 1.2, dash: 'car' },
  truck: { L: 6.8, W: 2.8, eye: [-0.6, 2.7, -2.0], lampY: 1.1, dash: 'car' },
  tanker: { L: 9.6, W: 2.7, eye: [-0.6, 2.8, -3.9], lampY: 1.2, dash: 'car' },
  cart: { L: 3.0, W: 1.7, eye: [-0.4, 1.9, 0.3], lampY: 0.9, dash: 'car' },
  boat: { L: 8.0, W: 2.7, eye: [0, 2.85, 0.5], lampY: 1.6, dash: 'boat' }, // standing, eyes over the windscreen
  pontoon: { L: 9.4, W: 3.6, eye: [1.0, 3.05, -0.9], lampY: 1.5, dash: 'boat' }, // Nan's pontoon: seated at the helm, under the canopy
  police: { L: 5.6, W: 2.3, eye: [-0.5, 1.55, -0.1], lampY: 1.0, dash: 'police' },
  ambulance: { L: 7.0, W: 2.6, eye: [-0.6, 2.05, -2.2], lampY: 1.0, dash: 'ambulance' },
  firetruck: { L: 10.0, W: 2.8, eye: [-0.65, 2.5, -3.7], lampY: 1.1, dash: 'fire' },
  bat: { L: 9.4, W: 3.0, eye: [0, 1.35, -0.2], lampY: 0.45, dash: 'bat' }, // the Batmobile (your own vehicle, not a prop)
};

/**
 * The flashing emergency lights of a kind, at scale 1: [[x, y, z, colour, phase], ...].
 * phase 0 and 1 flash in turn (wig-wag).
 */
const RED = 0xff1e1e;
const BLUE = 0x2a6bff;
const WHITE_L = 0xffffff;
export const EMERGENCY = {
  police: [[-0.45, 2.24, 0.1, RED, 0], [-0.15, 2.24, 0.1, RED, 1], [0.15, 2.24, 0.1, BLUE, 0], [0.45, 2.24, 0.1, BLUE, 1],
    [-0.45, 0.92, -2.88, RED, 1], [0.45, 0.92, -2.88, BLUE, 0], [-0.6, 1.25, 2.9, RED, 0], [0.6, 1.25, 2.9, BLUE, 1]],
  ambulance: [[-0.55, 2.72, -1.95, RED, 0], [0, 2.72, -1.95, WHITE_L, 1], [0.55, 2.72, -1.95, RED, 1],
    [-1.2, 3.32, -1.5, RED, 1], [1.2, 3.32, -1.5, RED, 0], [-1.2, 3.32, 3.52, RED, 0], [1.2, 3.32, 3.52, RED, 1], [0, 3.32, 3.52, WHITE_L, 0],
    [-1.0, 1.0, -3.55, RED, 0], [1.0, 1.0, -3.55, RED, 1]],
  firetruck: [[-0.8, 3.28, -3.5, RED, 0], [-0.25, 3.28, -3.5, WHITE_L, 1], [0.25, 3.28, -3.5, RED, 1], [0.8, 3.28, -3.5, RED, 0],
    [-1.3, 2.95, 4.95, RED, 1], [1.3, 2.95, 4.95, RED, 0], [-1.42, 1.6, -2.2, RED, 1], [1.42, 1.6, -2.2, RED, 0],
    [-1.0, 1.05, -5.05, RED, 0], [1.0, 1.05, -5.05, RED, 1]],
};
// The ice cream truck: a string of pastel bulbs along the roof edges that blink in turns.
{
  const cols = [0xff6fd0, 0xffe14a, 0x4fe3ff, 0x8dff6a];
  const bulbs = [];
  let i = 0;
  for (const z of [-2.8, -1.7, -0.6, 0.5, 1.6, 2.7]) for (const x of [-1.38, 1.38]) bulbs.push([x, 3.78, z, cols[i % 4], i++ % 2]);
  for (const x of [-0.7, 0, 0.7]) bulbs.push([x, 3.78, -2.85, cols[i % 4], i++ % 2]), bulbs.push([x, 3.78, 3.25, cols[i % 4], i++ % 2]);
  EMERGENCY.truck = bulbs;
}
export function vehicleInfo(kind) {
  if (CARS[kind]) {
    const c = CARS[kind];
    const roof = Math.max(...c.sil.map(([, y]) => y));
    return { L: c.L, W: c.W, eye: [-c.W * 0.2, roof - 0.42, (c.cab?.[0] ?? -0.5) + 0.55], lampY: 1.0, dash: 'car' };
  }
  return OTHER[kind] || null;
}

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
/** opts.noProp: leave out the propeller blade (a flown parked plane has its own, spinning). */
export function otherModel(kind, style, opts = {}) {
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
  } else if (kind === 'pontoon') {
    // Nan's pontoon: two silver tubes, a flat deck, a fence all round, a striped
    // canopy over the couches, a helm console and a big outboard on the back.
    const TUBE = real ? 0xc4cad0 : LEGO.lightGray;
    const FENCE = LEGO.white;
    const STRIPE = LEGO.blue;
    const CANOPY = 0x1f3a6b;
    const SEAT = LEGO.tan;
    const seg = real ? 18 : 8;
    for (const sx of [-1.2, 1.2]) {
      P.push(colour(new THREE.CylinderGeometry(0.48, 0.48, 7.8, seg).rotateX(Math.PI / 2).translate(sx, 0.4, 0.35), TUBE));
      P.push(colour(new THREE.ConeGeometry(0.48, 1.1, seg).rotateX(-Math.PI / 2).translate(sx, 0.4, -4.1), TUBE)); // pointed noses
      P.push(colour(new THREE.CylinderGeometry(0.48, 0.48, 0.06, seg).rotateX(Math.PI / 2).translate(sx, 0.4, 4.27), DARK)); // end caps
    }
    P.push(box(3.6, 0.2, 8.6, real ? 0x6d6a64 : LEGO.darkGray, 0, 0.98, 0.1)); // deck
    P.push(box(3.66, 0.12, 8.66, LEGO.black, 0, 0.84, 0.1)); // deck edge trim
    // The fence: side panels, and front and back panels with a gate in the middle.
    const fy = 1.5;
    for (const s of [-1, 1]) {
      P.push(box(0.08, 0.8, 7.4, FENCE, s * 1.76, fy, 0.1), box(0.1, 0.16, 7.4, STRIPE, s * 1.77, fy - 0.12, 0.1));
      P.push(box(0.14, 0.08, 7.5, CHROME, s * 1.76, fy + 0.44, 0.1)); // top rail
      P.push(box(1.0, 0.8, 0.08, FENCE, s * 1.3, fy, -3.6), box(1.0, 0.08, 0.14, CHROME, s * 1.3, fy + 0.44, -3.6)); // bow panels
      P.push(box(1.0, 0.8, 0.08, FENCE, s * 1.3, fy, 3.8), box(1.0, 0.08, 0.14, CHROME, s * 1.3, fy + 0.44, 3.8)); // stern panels
    }
    // Couches: a U at the back and a bench at the bow.
    P.push(box(3.0, 0.45, 0.8, SEAT, 0, 1.3, 3.2), box(3.0, 0.6, 0.2, SEAT, 0, 1.75, 3.55));
    for (const s of [-1, 1]) P.push(box(0.8, 0.45, 2.6, SEAT, s * 1.2, 1.3, 1.6), box(0.2, 0.6, 2.6, SEAT, s * 1.55, 1.75, 1.6));
    P.push(box(3.0, 0.45, 0.8, SEAT, 0, 1.3, -2.9));
    // The helm: a console on the starboard side with a wheel and a little windscreen, and a captain's chair.
    P.push(box(0.8, 0.95, 0.75, FENCE, 1.1, 1.55, -1.5), box(0.7, 0.06, 0.6, DARK, 1.1, 2.04, -1.5));
    P.push(colour(new THREE.TorusGeometry(0.22, 0.04, 6, real ? 16 : 8).rotateX(-0.9).translate(1.1, 2.15, -1.15), DARK));
    P.push(box(0.8, 0.22, 0.05, GLASS, 1.1, 2.15, -1.86)); // windscreen
    P.push(box(0.6, 0.4, 0.6, SEAT, 1.1, 1.4, -0.45), box(0.6, 0.55, 0.12, SEAT, 1.1, 1.85, -0.18));
    // The canopy (bimini top) on four posts, over the back couches.
    for (const [x, z] of [[-1.6, 0.2], [1.6, 0.2], [-1.6, 3.7], [1.6, 3.7]]) P.push(box(0.08, 1.9, 0.08, CHROME, x, 2.0, z));
    P.push(box(3.4, 0.14, 3.8, CANOPY, 0, 3.0, 1.95), box(3.44, 0.2, 0.12, FENCE, 0, 2.88, 0.05), box(3.44, 0.2, 0.12, FENCE, 0, 2.88, 3.85));
    if (!real) P.push(...studs(4, 4, 0.8, 3.07, 0, 1.95, CANOPY));
    // The outboard: a cowling on the transom, the leg down into the water, a propeller.
    P.push(box(0.7, 0.8, 0.8, DARK, 0, 1.55, 4.75), box(0.72, 0.12, 0.82, LEGO.white, 0, 1.75, 4.75));
    P.push(box(0.22, 1.1, 0.3, DARK, 0, 0.75, 4.85), box(0.08, 0.6, 0.18, DARK, 0, 0.25, 5.05));
  } else if (kind === 'police') {
    // A black-and-white patrol car: the sedan, black doors and hood, a light bar, a gold star.
    const m = carModel('sedan', style);
    P.push(m.body, m.lamps);
    P.push(box(CARS.sedan.W + 0.05, 0.62, 2.7, LEGO.black, 0, 0.88, 0.2)); // black doors
    if (!real) P.push(box(CARS.sedan.W - 0.3, 0.12, 1.3, LEGO.black, 0, 1.46, -2.05)); // black hood
    for (const sx of [-1, 1]) P.push(box(0.06, 0.34, 0.34, LEGO.yellow, sx * (CARS.sedan.W / 2 + 0.04), 0.95, -0.35)); // star badge
    P.push(box(1.45, 0.1, 0.42, DARK, 0, 2.08, 0.1)); // light bar
    P.push(box(0.62, 0.2, 0.36, 0xd81b1b, -0.36, 2.22, 0.1), box(0.62, 0.2, 0.36, 0x1d4fd8, 0.36, 2.22, 0.1));
    P.push(box(1.0, 0.12, 0.06, 0x1d4fd8, 0.0, 0.92, -2.83)); // push bar flashers
    if (!real) P.push(...studs(1, 3, 0.4, 2.13, 0, 0.1, DARK));
    for (const [x, z, r] of carWheels('sedan')) P.push(wheelGeometry(r, style).translate(x, r, z));
  } else if (kind === 'ambulance') {
    // A box ambulance: a white cab and box body with a red stripe, red crosses and lights.
    if (real) P.push(profile([[-3.5, 0.55], [-3.5, 1.35], [-2.7, 1.55], [-2.0, 2.55], [-1.55, 2.55], [-1.55, 0.55]], 2.5, WHITE, 0.16));
    else P.push(box(2.5, 1.0, 2.0, WHITE, 0, 1.05, -2.5), slope(2.4, 0.8, 1.55, 2.55, GLASS, -2.2), box(2.5, 1.0, 0.8, WHITE, 0, 2.05, -1.95));
    P.push(box(2.6, 2.8, 5.1, WHITE, 0, 1.95, 0.98)); // box body
    P.push(box(2.55, 0.75, 0.06, GLASS, 0, 2.0, real ? -2.25 : -2.45), box(0.06, 0.6, 0.8, GLASS, -1.27, 2.0, -2.0), box(0.06, 0.6, 0.8, GLASS, 1.27, 2.0, -2.0));
    P.push(box(2.64, 0.3, 5.12, 0xd81b1b, 0, 1.45, 0.98), box(2.54, 0.3, 2.0, 0xd81b1b, 0, 1.0, -2.5)); // stripe
    for (const sx of [-1, 1]) P.push(box(0.05, 1.1, 0.34, 0xd81b1b, sx * 1.32, 2.5, 1.0), box(0.05, 0.34, 1.1, 0xd81b1b, sx * 1.32, 2.5, 1.0)); // crosses
    P.push(box(0.34, 1.0, 0.05, 0xd81b1b, 0, 2.4, 3.55), box(1.0, 0.34, 0.05, 0xd81b1b, 0, 2.4, 3.55));
    P.push(box(1.5, 0.12, 0.38, DARK, 0, 2.6, -1.95), box(1.3, 0.18, 0.32, 0xd81b1b, 0, 2.72, -1.95));
    P.push(box(2.7, 0.35, 0.3, DARK, 0, 0.6, -3.6), box(2.7, 0.35, 0.3, DARK, 0, 0.6, 3.6));
    for (const s of [-1, 1]) P.push(box(0.45, 0.22, 0.08, HEAD, s * 0.9, 1.0, -3.52), box(0.3, 0.6, 0.08, TAIL, s * 1.15, 1.0, 3.55));
    if (!real) P.push(...studs(3, 6, 0.8, 3.35, 0, 1.0, WHITE));
    wheelsAt([[-1.2, -2.4], [1.2, -2.4], [-1.2, 2.3], [1.2, 2.3]], 0.55);
  } else if (kind === 'firetruck') {
    // A fire engine: red cab and body, chrome lockers, a white stripe and a ladder on top.
    const red = 0xc8102e;
    P.push(real ? profile([[-5.0, 0.7], [-5.0, 2.2], [-4.6, 3.1], [-2.3, 3.1], [-2.3, 0.7]], 2.8, red, 0.18) : box(2.8, 2.4, 2.7, red, 0, 1.9, -3.65));
    P.push(box(2.85, 1.0, 0.06, GLASS, 0, 2.45, real ? -4.75 : -5.02), box(0.06, 0.8, 1.2, GLASS, -1.42, 2.45, -3.7), box(0.06, 0.8, 1.2, GLASS, 1.42, 2.45, -3.7));
    P.push(box(2.8, 2.0, 7.3, red, 0, 1.75, 1.35)); // body
    P.push(box(2.86, 0.18, 9.9, WHITE, 0, 1.25, 0.05)); // stripe
    for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) P.push(box(0.05, 0.75, 1.5, CHROME, sx * 1.43, 1.85, -1.4 + k * 1.75)); // lockers
    for (const sx of [-0.55, 0.55]) P.push(box(0.12, 0.18, 8.6, 0xd7dbe0, sx, 3.05, 0.9)); // ladder rails
    for (let k = 0; k < 15; k++) P.push(box(1.1, 0.08, 0.08, 0xd7dbe0, 0, 3.05, -3.3 + k * 0.6));
    P.push(box(1.7, 0.12, 0.4, DARK, 0, 3.15, -3.5), box(1.55, 0.18, 0.34, 0xff2a2a, 0, 3.28, -3.5));
    P.push(box(3.0, 0.4, 0.35, CHROME, 0, 0.75, -5.1), box(2.0, 0.6, 0.06, CHROME, 0, 1.4, -5.03)); // bumper, grille
    for (const s of [-1, 1]) P.push(box(0.45, 0.25, 0.08, HEAD, s * 1.0, 1.05, -5.06), box(0.3, 0.5, 0.08, TAIL, s * 1.2, 1.2, 5.02));
    if (!real) P.push(...studs(3, 3, 0.8, 3.1, 0, -3.65, red));
    wheelsAt([[-1.3, -3.6], [1.3, -3.6], [-1.3, 2.4], [1.3, 2.4], [-1.3, 3.9], [1.3, 3.9]], 0.7);
  } else if (kind === 'plane') {
    // A small high-wing plane like the one you fly: fuselage, wing with struts, tail, propeller.
    const fus = new THREE.CylinderGeometry(0.75, 0.45, 7.2, real ? 14 : 8).rotateX(Math.PI / 2).translate(0, 1.9, 0.4);
    P.push(colour(fus, WHITE), box(1.25, 0.9, 1.8, GLASS, 0, 2.55, -1.1));
    P.push(box(11.5, 0.22, 1.7, WHITE, 0, 3.05, -1.0), box(4.2, 0.18, 1.1, WHITE, 0, 2.05, 3.7), box(0.18, 1.7, 1.3, WHITE, 0, 2.85, 3.8));
    for (const s of [-1, 1]) P.push(box(0.08, 1.4, 0.08, DARK, s * 1.6, 2.35, -1.0).rotateZ(s * -0.6));
    if (!opts.noProp) P.push(box(0.15, 2.6, 0.22, DARK, 0, 1.9, -3.35));
    P.push(cylY(0.25, 0.4, DARK, 0, 1.9, -3.2));
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

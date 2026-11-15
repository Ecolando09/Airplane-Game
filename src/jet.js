import * as THREE from 'three';
import { LEGO, legoMaterial } from './lego.js';
import { createBoosters } from './boosters.js';

// The passenger shuttle: built after a real Lego model. A light grey wedge plate
// under the nose with a long clear-blue canopy (white with red stripes on top);
// behind it a red body with a tan deck, a green tile, dark grey plates, the
// yellow "21" tile and a dark grey wedge spoiler tilted up; a big red half-round
// wing plate at the back (straight edge forward, round edge behind) carrying a
// black frame, dark blue curved pieces, two red posts with a clear-blue rear
// window between them, white tiles and green slopes along the sides.
// Nose toward -Z, like the other vehicles. One stud = 0.75 m.

const U = 0.75; // one Lego stud, in metres
const GEAR = 0.95; // from the model's origin (bottom of the plates) down to the ground
const RED = 0xd3173f; // the model's bright red
const GREEN = 0x1f9a4a;
const BRIGHT_GREEN = 0x4fbf4f;
const TAN = 0xd9bb7b;
const NOUGAT = 0xb5763a;
const DARK_BLUE = 0x1f2d5c;
const GLASS = 0x9fdcec;

export const JET_ACCENT = RED; // the part that takes a paint job

export function createPassengerJet() {
  const jet = new THREE.Group();
  const mats = {};
  const mat = (hex, opts = {}) => (mats[`${hex}${opts.transparent ? 't' : ''}`] ||= legoMaterial({ color: hex, studs: U, ...opts }));
  const parts = []; // for the crash debris: { pos, size, color }
  const box = (w, h, d, hex, x, y, z, parent = jet, opts) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * U, h * U, d * U), mat(hex, opts));
    m.position.set(x * U, y * U, z * U);
    m.castShadow = true;
    parent.add(m);
    parts.push({ pos: m.position.clone(), size: new THREE.Vector3(w * U, h * U, d * U), color: hex });
    return m;
  };
  const roundBrick = (r, h, hex, x, y, z, opts) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * U, r * U, h * U, 14), mat(hex, opts));
    m.position.set(x * U, y * U, z * U);
    m.castShadow = true;
    jet.add(m);
    return m;
  };
  // A Lego slope or curved slope: rises from yLow at the front (-z) to yHigh at the back.
  const slope = (w, d, yLow, yHigh, hex, x, y, z, curved = false) => {
    const s = new THREE.Shape();
    s.moveTo(-d / 2, 0);
    s.lineTo(d / 2, 0);
    s.lineTo(d / 2, yHigh);
    if (curved) s.quadraticCurveTo(0, yHigh, -d / 2, yLow);
    else s.lineTo(-d / 2, yLow);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false, curveSegments: 8 });
    g.rotateY(-Math.PI / 2);
    g.translate(w / 2, 0, 0);
    g.scale(U, U, U);
    const m = new THREE.Mesh(g, mat(hex));
    m.position.set(x * U, y * U, z * U);
    m.castShadow = true;
    jet.add(m);
    parts.push({ pos: m.position.clone(), size: new THREE.Vector3(w * U, yHigh * U, d * U), color: hex });
    return m;
  };

  // A flat plate from an outline [[x, z], ...] (z toward the back), `t` thick, bottom at y.
  const plate = (pts, t, hex, y = 0, parent = jet) => {
    const sh = new THREE.Shape();
    pts.forEach(([x, z], i) => (i ? sh.lineTo(x, z) : sh.moveTo(x, z)));
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 20 });
    g.rotateX(Math.PI / 2); // outline y -> world z, thickness downward
    g.scale(U, U, U);
    g.translate(0, (y + t) * U, 0);
    const m = new THREE.Mesh(g, mat(hex));
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  // A shape drawn from the side [[z, y], ...], `w` wide across the body.
  const sideShape = (pts, w, hex, opts, x = 0) => {
    const sh = new THREE.Shape();
    pts.forEach(([z, y], i) => (i ? sh.lineTo(z, y) : sh.moveTo(z, y)));
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false });
    g.rotateY(-Math.PI / 2);
    g.translate(w / 2, 0, 0);
    g.scale(U, U, U);
    const m = new THREE.Mesh(g, mat(hex, opts));
    m.position.x = x * U;
    m.castShadow = true;
    jet.add(m);
    return m;
  };

  // ---- the plates: grey wedge under the nose, red half-round wing at the back
  plate([[-1.5, -10], [1.5, -10], [4.5, -2.5], [4.5, 1], [-4.5, 1], [-4.5, -2.5]], 0.4, LEGO.lightGray);
  parts.push({ pos: new THREE.Vector3(0, 0.2 * U, -4 * U), size: new THREE.Vector3(7 * U, 0.4 * U, 9 * U), color: LEGO.lightGray });
  const half = [[-8, 1], [8, 1]];
  for (let i = 1; i < 24; i++) half.push([8 * Math.cos((i / 24) * Math.PI), 1 + 8 * Math.sin((i / 24) * Math.PI)]);
  plate(half, 0.4, RED);
  parts.push({ pos: new THREE.Vector3(0, 0.2 * U, 4.5 * U), size: new THREE.Vector3(14 * U, 0.4 * U, 7 * U), color: RED });
  box(3, 0.3, 2, LEGO.black, 0, -0.15, -9.6); // black plate under the nose
  box(2, 0.25, 0.6, 0xc4d600, 0, -0.1, -10.7); // lime tile at the very front

  // ---- the canopy: clear blue, long and curved; white with red stripes over the back half
  const top = (z) => 0.5 + 2.15 * Math.sin((Math.min(1, (z + 10) / 6.5) * Math.PI) / 2) ** 0.8;
  const prof = (z0, z1, lift = 0) => {
    const pts = [[z0, 0.4]];
    for (let i = 0; i <= 14; i++) {
      const z = z0 + ((z1 - z0) * i) / 14;
      pts.push([z, top(z) + lift]);
    }
    pts.push([z1, 0.4]);
    return pts;
  };
  const canopy = sideShape(prof(-10, -3.5), 4.2, GLASS, { transparent: true, opacity: 0.45 });
  const cap = sideShape(prof(-7.2, -3.5, 0.05).map(([z, y], i, a) => (i === 0 || i === a.length - 1 ? [z, top(z) - 0.12] : [z, y])), 4.25, LEGO.white);
  const capBits = [cap];
  for (const sx of [-1, 1]) {
    const stripe = box(0.6, 0.08, 2.6, RED, sx * 1.35, top(-5) + 0.06, -5.1);
    stripe.rotation.x = 0.2;
    capBits.push(stripe);
  }
  const hatch = box(1.3, 0.08, 1.5, LEGO.darkGray, 0, top(-4.6) + 0.08, -4.7);
  hatch.rotation.x = 0.12;
  capBits.push(hatch);
  // Inside: a seat and a steering wheel you can see through the glass.
  box(1.4, 0.8, 1.2, LEGO.blue, 0, 0.9, -5.2);
  box(0.9, 0.5, 0.3, LEGO.black, 0, 1.2, -7.2);

  // ---- the body behind the canopy
  box(4, 1.6, 6.5, RED, 0, 1.2, -0.25); // red body, z -3.5 .. 3
  for (const sx of [-1, 1]) {
    slope(1, 4, 0.2, 1.1, RED, sx * 2.6, 0.4, -5.2, true); // red curved slopes low on the front sides
    box(0.9, 1.5, 2.2, NOUGAT, sx * 2.45, 1.15, 0.6); // nougat arch bricks
    const tile = box(0.9, 0.3, 6, LEGO.white, sx * 3.5, 0.55, -0.6); // white tiles along the sides
    tile.rotation.y = sx * -0.1;
    slope(1, 1.8, 0.3, 0.95, GREEN, sx * 4.3, 0.4, 0.3); // green slopes
  }
  box(4, 0.4, 4, 0x5c3a1e, 0, 2.2, -1.5); // brown layer
  box(4, 0.4, 4, TAN, 0, 2.6, -1.5); // tan deck
  box(2, 0.3, 3.6, BRIGHT_GREEN, 0, 2.95, -2.9); // green tile on top
  box(4, 0.4, 2, LEGO.darkGray, 0, 2.6, 1.5); // dark grey plates behind the deck
  // The yellow "21" tile.
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f5b82e';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#1e2a5a';
  g.beginPath();
  g.arc(34, 64, 20, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(34, 64, 9, 0, Math.PI * 2);
  g.fill();
  g.font = 'bold 64px sans-serif';
  g.fillStyle = '#c91a2f';
  g.fillText('21', 56, 88);
  box(2, 0.3, 2, 0xf5b82e, 0, 2.95, 0.4);
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(2 * U, 2 * U).rotateX(-Math.PI / 2).rotateY(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) }));
  tag.position.set(0, 3.11 * U, 0.4 * U);
  jet.add(tag);
  // The dark grey wedge spoiler, tilted up toward the back.
  const spoiler = new THREE.Group();
  spoiler.position.set(0, 2.85 * U, 1.2 * U);
  spoiler.rotation.x = 0.22;
  jet.add(spoiler);
  plate([[-1, 0], [1, 0], [3, 2.6], [3, 4.4], [-3, 4.4], [-3, 2.6]], 0.35, LEGO.darkGray, 0, spoiler);
  parts.push({ pos: new THREE.Vector3(0, 3.3 * U, 3.5 * U), size: new THREE.Vector3(6 * U, 0.35 * U, 4.4 * U), color: LEGO.darkGray });

  // ---- on the wing: black frame, dark blue curves, the rear window between red posts
  box(5, 1.0, 3.8, LEGO.black, 0, 0.9, 5.1);
  for (const sx of [-1, 1]) {
    box(1.2, 2.0, 1.2, RED, sx * 2.3, 1.4, 7.9);
    const curve = new THREE.Mesh(new THREE.TorusGeometry(1.6 * U, 0.5 * U, 6, 12, Math.PI / 2).rotateX(Math.PI / 2), mat(DARK_BLUE));
    curve.scale.y = 0.5;
    curve.position.set(sx * 4.3 * U, 0.6 * U, 5.6 * U);
    curve.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI;
    jet.add(curve);
  }
  box(5.8, 0.6, 1.6, RED, 0, 0.7, 8.1); // red base at the back
  const rearGlass = box(3.4, 1.8, 0.3, GLASS, 0, 1.5, 8.3, jet, { transparent: true, opacity: 0.5 });
  box(3.4, 0.3, 0.8, GLASS, 0, 2.5, 8.1, jet, { transparent: true, opacity: 0.5 });
  box(2, 0.3, 1, GREEN, 0, 0.45, 9.2); // green tile at the very back
  // Two round engine exhausts under the back of the wing.
  for (const sx of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.5 * U, 0.5 * U, 1.2 * U, 16).rotateX(Math.PI / 2), mat(LEGO.darkGray));
    ring.position.set(sx * 1.4 * U, -0.3 * U, 8.2 * U);
    jet.add(ring);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.36 * U, 16), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    hole.position.set(sx * 1.4 * U, -0.3 * U, 8.81 * U);
    jet.add(hole);
  }

  // ---- control surfaces: elevons on the wing's trailing edge (move with the stick)
  const elevon = (sx) => {
    const piv = new THREE.Group();
    piv.position.set(sx * 3.6 * U, 0.2 * U, 8.1 * U);
    const m = new THREE.Mesh(new THREE.BoxGeometry(2.4 * U, 0.2 * U, 0.7 * U), mat(RED));
    m.position.z = 0.35 * U;
    piv.add(m);
    jet.add(piv);
    return piv;
  };
  const ailerons = [elevon(-1), elevon(1)];
  const elevator = new THREE.Group(); // (the elevons do it; kept for the shared pose code)
  const rudder = new THREE.Group();

  // ---- tricycle landing gear (sits level on the ground, no tail-dragger tilt)
  const wheels = [];
  const wheelMat = mat(LEGO.black);
  for (const [x, z] of [[0, -7], [-3.2, 4], [3.2, 4]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, GEAR - 0.3, 0.18), mat(LEGO.lightGray));
    leg.position.set(x * U, -(GEAR - 0.3) / 2, z * U);
    jet.add(leg);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.3, 14).rotateZ(Math.PI / 2), wheelMat);
    w.position.set(x * U, -GEAR + 0.32, z * U);
    jet.add(w);
    wheels.push(leg, w);
  }

  // ---- hover thrusters (hovercraft mode): four nozzles fold out under the wing,
  // flames pointing down that grow with the thrust. They take the place of the
  // other planes' floats (shown and hidden the same way, also for friends).
  const floats = new THREE.Group();
  const flames = [];
  const flameGeo = new THREE.ConeGeometry(1, 1, 14, 1, true).rotateX(Math.PI).translate(0, -0.5, 0); // tip down
  const outer = new THREE.MeshBasicMaterial({ color: 0x4fc3ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const inner = new THREE.MeshBasicMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const [x, z] of [[-3, -3.2], [3, -3.2], [-5.2, 4.4], [5.2, 4.4]]) {
    const pod = new THREE.Group();
    pod.position.set(x * U, 0, z * U);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.42 * U, 0.55 * U, 0.6 * U, 16), mat(LEGO.darkGray));
    nozzle.position.y = -0.3 * U;
    pod.add(nozzle);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5 * U, 0.08 * U, 6, 16).rotateX(Math.PI / 2), mat(LEGO.lightGray));
    ring.position.y = -0.6 * U;
    pod.add(ring);
    const flame = new THREE.Group();
    flame.position.y = -0.62 * U;
    const fo = new THREE.Mesh(flameGeo, outer);
    fo.scale.set(0.42, 1, 0.42);
    const fi = new THREE.Mesh(flameGeo, inner);
    fi.scale.set(0.2, 0.6, 0.2);
    flame.add(fo, fi);
    pod.add(flame);
    floats.add(pod);
    flames.push(flame);
  }
  floats.scale.setScalar(0.001);
  floats.visible = false;
  jet.add(floats);
  /** Each frame in hover mode: power 0..1 sets the flames' length; t (seconds) makes them flicker. */
  const updateThrust = (power, t) => {
    flames.forEach((f, i) => {
      const flicker = 1 + 0.12 * Math.sin(t * 37 + i * 1.7) + 0.06 * Math.sin(t * 91 + i);
      f.scale.set(0.7 + 0.5 * power, (0.6 + 4.2 * power) * flicker, 0.7 + 0.5 * power);
    });
  };
  updateThrust(0.5, 0);

  // ---- turbo boosters come out of the two engine exhausts
  const updateBoosters = createBoosters(jet, mat, { x: 1.4 * U, y: -0.3 * U, z: 9.6 * U, scale: 1.0 });

  return {
    group: jet,
    kind: 'jet',
    jet: true, // jet engines: no propeller, more thrust, sits level on its nose wheel
    hovercraft: true, // can switch to hover mode (flies like the copter on its thrusters)
    updateThrust,
    level: true,
    thrustMul: 2.2, // top speed about 1.5x the bush plane's
    noProp: true,
    updateBoosters,
    floats,
    wheels,
    controls: { ailerons, elevator, rudder },
    parts,
    cockpitHidden: [canopy, ...capBits, rearGlass], // (the canopy and its printed top, from the pilot's seat)
    cockpitEye: new THREE.Vector3(0, 2.0 * U, -6.4 * U), // the pilot's seat, under the canopy
    gearHeight: GEAR,
    radius: 5,
  };
}

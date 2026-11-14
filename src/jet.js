import * as THREE from 'three';
import { LEGO, legoMaterial } from './lego.js';
import { createBoosters } from './boosters.js';

// The passenger jet: built after a real Lego model. A light grey delta wing
// (arrowhead plate, wide at the back) under a red fuselage; along the top two
// white stripes either side of a dark grey studded strip, with a yellow "21"
// tile at the front; red bricks and red curved slopes along the sides; a blue
// wedge windscreen at the nose between dark green and sand green pieces; tan
// panels; two round engine exhausts under the tail; orange lights at the wing
// corners. Nose toward -Z, like the other vehicles. One stud = 0.9 m.

const U = 0.9; // one Lego stud, in metres
const GEAR = 0.95; // from the model's origin (bottom of the wing plate) down to the ground
const SAND_GREEN = 0x789082;
const DARK_GREEN = 0x184632;
const TRANS_ORANGE = 0xf08f1c;

export const JET_ACCENT = LEGO.red; // the part that takes a paint job

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

  // ---- the delta wing: an arrowhead plate, wide at the back, with stepped wedge edges
  const wing = new THREE.Shape();
  // (shape x = across, shape y = along: +y toward the back)
  wing.moveTo(-1.6, -7);
  wing.lineTo(1.6, -7);
  wing.lineTo(6.2, 5.2);
  wing.lineTo(6.2, 6.6);
  wing.lineTo(-6.2, 6.6);
  wing.lineTo(-6.2, 5.2);
  wing.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wing, { depth: 0.4, bevelEnabled: false });
  wingGeo.rotateX(Math.PI / 2); // shape y -> world z (+ toward the back), thickness downward
  wingGeo.scale(U, U, U);
  wingGeo.translate(0, 0.4 * U, 0);
  const wingMesh = new THREE.Mesh(wingGeo, mat(LEGO.lightGray));
  wingMesh.castShadow = true;
  jet.add(wingMesh);
  parts.push({ pos: new THREE.Vector3(0, 0.2, 1), size: new THREE.Vector3(8, 0.4, 8), color: LEGO.lightGray });
  // Under the tail: a thicker grey block with two round engine exhausts.
  box(4.2, 1.0, 3.2, LEGO.lightGray, 0, -0.1, 4.9);
  for (const sx of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.42 * U, 0.42 * U, 0.3 * U, 16).rotateX(Math.PI / 2), mat(LEGO.darkGray));
    ring.position.set(sx * 1.1 * U, -0.1 * U, 6.52 * U);
    jet.add(ring);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.3 * U, 16), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    hole.position.set(sx * 1.1 * U, -0.1 * U, 6.68 * U);
    jet.add(hole);
  }

  // ---- the fuselage: red, with tan panels low on the sides at the back
  box(3.6, 1.6, 9.2, LEGO.red, 0, 1.2, 0.8); // body
  for (const sx of [-1, 1]) box(0.5, 1.4, 3.6, LEGO.tan, sx * 2.05, 1.1, 4.2); // tan side panels
  // The top: white stripes either side of the dark grey studded strip.
  for (const sx of [-1, 1]) box(1.0, 0.4, 8.2, LEGO.white, sx * 1.3, 2.2, 1.1);
  box(1.6, 0.4, 8.2, LEGO.darkGray, 0, 2.2, 1.1);
  // The yellow "21" tile at the front of the strip.
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#f2cd37';
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#1e3a8a';
  g.beginPath();
  g.arc(26, 32, 16, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(26, 32, 7, 0, Math.PI * 2);
  g.fill();
  g.font = 'bold 50px sans-serif';
  g.fillStyle = '#c91a09';
  g.fillText('21', 50, 50);
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(2.0 * U, 1.0 * U).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) }));
  tag.position.set(0, 2.41 * U, -3.6 * U);
  jet.add(tag);
  box(3.6, 0.4, 1.2, LEGO.yellow, 0, 2.2, -3.6);
  // Red bricks along the top sides at the back, and red curved slopes below them.
  for (const sx of [-1, 1]) {
    box(1.0, 0.8, 4.0, LEGO.red, sx * 2.3, 2.2, 3.2);
    slope(1.0, 5.0, 0.3, 1.2, LEGO.red, sx * 2.6, 0.4, 2.6, true);
    // A tan round brick with a clear 1x1 on top, half way along each side.
    roundBrick(0.4, 0.6, LEGO.tan, sx * 2.35, 0.7, -0.6);
    box(0.7, 0.6, 0.7, 0xd8e8f0, sx * 2.35, 1.3, -0.6, jet, { transparent: true, opacity: 0.55 });
  }

  // ---- the nose: a blue wedge windscreen between dark green plates and sand green curves
  box(3.0, 1.0, 2.2, LEGO.red, 0, 0.9, -4.6); // red nose block
  slope(1.8, 1.6, 0.2, 1.1, LEGO.blue, 0, 1.4, -5.0); // blue windscreen wedge
  for (const sx of [-1, 1]) {
    box(1.0, 0.4, 1.8, DARK_GREEN, sx * 1.3, 1.6, -4.7);
    slope(0.7, 2.0, 0.4, 1.4, SAND_GREEN, sx * 1.95, 0.4, -4.9, true);
  }
  for (let i = 0; i < 4; i++) roundBrick(0.38, 0.6, LEGO.red, -1.2 + i * 0.8, 0.7, -5.8); // red round bricks along the front

  // ---- orange lights at the back corners of the wing
  for (const sx of [-1, 1]) box(1.0, 0.4, 0.8, TRANS_ORANGE, sx * 5.6, 0.6, 5.9, jet, { transparent: true, opacity: 0.85 });

  // ---- control surfaces: elevons on the wing's trailing edge (move with the stick)
  const elevon = (sx) => {
    const piv = new THREE.Group();
    piv.position.set(sx * 3.8 * U, 0.2 * U, 6.6 * U);
    const m = new THREE.Mesh(new THREE.BoxGeometry(2.6 * U, 0.2 * U, 0.7 * U), mat(LEGO.lightGray));
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
  for (const [x, z] of [[0, -4.2], [-2.6, 3.4], [2.6, 3.4]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, GEAR - 0.3, 0.18), mat(LEGO.lightGray));
    leg.position.set(x * U, -(GEAR - 0.3) / 2, z * U);
    jet.add(leg);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.3, 14).rotateZ(Math.PI / 2), wheelMat);
    w.position.set(x * U, -GEAR + 0.32, z * U);
    jet.add(w);
    wheels.push(leg, w);
  }

  // ---- floats for landing on water (B), like the bush plane's
  const floats = new THREE.Group();
  for (const sx of [-1, 1]) {
    const pont = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 7, 6, 12).rotateX(Math.PI / 2), mat(LEGO.white));
    pont.position.set(sx * 2.4, -GEAR + 0.45, 0.6);
    floats.add(pont);
  }
  floats.scale.setScalar(0.001);
  floats.visible = false;
  jet.add(floats);

  // ---- turbo boosters come out of the two engine exhausts
  const updateBoosters = createBoosters(jet, mat, { x: 1.1 * U, y: -0.1 * U, z: 7.4 * U, scale: 1.0 });

  return {
    group: jet,
    kind: 'jet',
    jet: true, // jet engines: no propeller, more thrust, sits level on its nose wheel
    level: true,
    thrustMul: 2.2, // top speed about 1.5x the bush plane's
    noProp: true,
    updateBoosters,
    floats,
    wheels,
    controls: { ailerons, elevator, rudder },
    parts,
    cockpitHidden: [],
    cockpitEye: new THREE.Vector3(0, 2.75 * U, -4.0 * U), // just behind the windscreen wedge
    gearHeight: GEAR,
    radius: 5,
  };
}

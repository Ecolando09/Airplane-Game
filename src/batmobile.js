import * as THREE from 'three';
import { LEGO, legoMaterial, isLego } from './lego.js';
import { createBoosters } from './boosters.js';
import { BAT_ACCENT } from './robot.js';
import { vehicleLights } from './vehlights.js';

// The Batmobile: long, low and black, a dark canopy, two tall tail fins, four
// fat wheels with yellow hubs, a yellow emblem on the hood and a jet exhaust at
// the back. It has three forms: car (CarDrive in cardrive.js), flying car (the
// plane's flight model with jet thrust: wings swing out, the fins stand up, the
// wheels fold flat) and robot (robot.js, the 'bat' kit). setFlight(u) moves
// between car (0) and flying car (1). Built from bricks in the Lego look and
// smooth in the realistic one. Nose toward -Z, like the other vehicles.

export { BAT_ACCENT };
const BLACK = 0x1e2126;
const DARK = 0x111317;
const TRIM = 0x3b4048;
const GLASS = 0x22303e;
const GEAR = 0.72; // from the model's origin down to the ground

export function createBatmobile() {
  const car = new THREE.Group();
  const lego = isLego();
  const mats = {};
  const mat = (hex, o = {}) => (mats[`${hex}${o.transparent ? 't' : ''}`] ||= legoMaterial({ color: hex, studs: 0.8, ...o }));
  const parts = []; // for the crash debris: { pos, size, color }
  const box = (w, h, d, hex, x, y, z, parent = car) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(hex));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    parts.push({ pos: m.position.clone(), size: new THREE.Vector3(w, h, d), color: hex });
    return m;
  };
  /** A side profile (points [z, y]) extruded across the width w, centred. */
  const profile = (pts, w, hex, x = 0, parent = car, bevel = lego ? 0 : 0.12) => {
    const s = new THREE.Shape();
    pts.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: w - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6 });
    g.rotateY(-Math.PI / 2);
    g.translate(w / 2 - bevel + x, 0, 0);
    const m = new THREE.Mesh(g, hex.isMaterial ? hex : mat(hex));
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // ---- body: a long wedge hood, the cockpit, the rear deck.
  const body = profile([[-4.7, 0.05], [-4.7, 0.45], [-1.4, 0.95], [2.0, 1.0], [4.5, 0.95], [4.6, 0.05]], 3.3, BLACK);
  void body;
  parts.push({ pos: new THREE.Vector3(0, 0.5, 0), size: new THREE.Vector3(3.3, 1, 9), color: BLACK });
  box(3.5, 0.3, 8.8, DARK, 0, 0.05, 0); // underbody
  // Side intakes and yellow trim lines along the sides.
  for (const sx of [-1, 1]) {
    box(0.08, 0.12, 6.4, BAT_ACCENT, sx * 1.66, 0.62, 0.2);
    box(0.3, 0.45, 1.6, TRIM, sx * 1.6, 0.45, 1.3);
    box(0.32, 0.25, 1.2, DARK, sx * 1.62, 0.45, 1.3);
  }
  if (lego) {
    // A few stepped plates on the hood, like a brick build.
    box(2.2, 0.2, 2.0, BLACK, 0, 0.82, -2.4);
    box(1.4, 0.2, 1.4, TRIM, 0, 0.98, -2.0);
  } else box(0.12, 0.08, 3.2, TRIM, 0, 0.9, -2.8); // a crease down the hood
  // The canopy: a dark bubble over the cockpit.
  const canopy = profile([[-1.5, 0.9], [-0.4, 1.65], [1.0, 1.7], [1.8, 1.0]], 1.9, new THREE.MeshPhongMaterial({ color: GLASS, transparent: true, opacity: 0.88, shininess: 120 }));
  // The yellow emblem on the hood: an oval with a black bat shape.
  const emblem = new THREE.Group();
  emblem.position.set(0, 0.78, -3.4);
  emblem.rotation.x = -0.15;
  car.add(emblem);
  const oval = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 24), mat(BAT_ACCENT));
  oval.scale.set(1.4, 1, 0.8);
  emblem.add(oval);
  for (const [w, d, x] of [[0.9, 0.16, 0], [0.18, 0.3, 0]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), mat(DARK));
    b.position.set(x, 0.03, 0);
    emblem.add(b);
  }
  // Head and tail lamps (the night glow comes from vehlights).
  for (const sx of [-1, 1]) {
    box(0.55, 0.14, 0.08, 0xd8ecff, sx * 1.1, 0.4, -4.72);
    box(0.5, 0.18, 0.08, 0xd81b1b, sx * 1.15, 0.6, 4.62);
  }

  // ---- the two tall tail fins (lean out in car form, stand up to fly)
  const fins = [-1, 1].map((sx) => {
    const piv = new THREE.Group();
    piv.position.set(sx * 1.1, 0.95, 2.2);
    car.add(piv);
    const fin = profile([[0, 0], [2.6, 0], [2.9, 1.9], [2.2, 1.9]], 0.18, BLACK, 0, piv);
    void fin;
    box(0.2, 0.12, 0.8, BAT_ACCENT, 0, 1.92, 2.55, piv); // yellow tip
    return { piv, sx };
  });

  // ---- wings: folded along the sides in car form, swung out to fly
  const wings = [-1, 1].map((sx) => {
    const piv = new THREE.Group();
    piv.position.set(sx * 1.55, 0.55, 0.6);
    car.add(piv);
    const s = new THREE.Shape();
    s.moveTo(0, -1.4);
    s.lineTo(sx * 4.2, 0.9);
    s.lineTo(sx * 4.2, 1.7);
    s.lineTo(0, 1.9);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: false });
    g.rotateX(Math.PI / 2); // lying flat: shape X across, shape Y back along +Z
    const w = new THREE.Mesh(g, mat(BLACK));
    w.castShadow = true;
    piv.add(w);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.9), mat(BAT_ACCENT));
    edge.position.set(sx * 4.15, 0, 1.3);
    piv.add(edge);
    // Elevon on the trailing edge (moves with the stick).
    const ail = new THREE.Group();
    ail.position.set(sx * 2.4, 0, 1.75);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.4), mat(TRIM));
    flap.position.z = 0.2;
    ail.add(flap);
    piv.add(ail);
    return { piv, sx, ail };
  });

  // ---- four fat wheels with yellow hubs (fold flat under the body to fly)
  const wheels = [];
  const wheelGroups = [];
  for (const [x, z] of [[-1.55, -2.9], [1.55, -2.9], [-1.55, 2.8], [1.55, 2.8]]) {
    const mount = new THREE.Group();
    mount.position.set(x, 0, z);
    car.add(mount);
    const spin = new THREE.Group();
    mount.add(spin);
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.75, lego ? 16 : 24).rotateZ(Math.PI / 2), mat(0x141518));
    tyre.castShadow = true;
    spin.add(tyre);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.8, 12).rotateZ(Math.PI / 2), mat(BAT_ACCENT));
    spin.add(hub);
    for (let i = 0; i < 3; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.1, 0.62), mat(DARK));
      spoke.rotation.x = (i * Math.PI) / 3;
      spin.add(spoke);
    }
    wheelGroups.push({ mount, spin, sx: Math.sign(x), front: z < 0 });
  }

  // ---- the jet exhaust: a nozzle at the back with a flame that grows with the throttle
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 0.7, 18).rotateX(Math.PI / 2), mat(TRIM));
  nozzle.position.set(0, 0.55, 4.75);
  car.add(nozzle);
  const glowDisc = new THREE.Mesh(new THREE.CircleGeometry(0.42, 18), new THREE.MeshBasicMaterial({ color: 0xff7a2a }));
  glowDisc.position.set(0, 0.55, 5.11);
  car.add(glowDisc);
  const flameGeo = new THREE.ConeGeometry(1, 1, 14, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  const flame = new THREE.Group();
  flame.position.set(0, 0.55, 5.1);
  const fo = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false }));
  const fi = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  fi.scale.set(0.5, 0.5, 0.6);
  flame.add(fo, fi);
  car.add(flame);
  /** Each frame: power 0..1 (the throttle), turbo 1..3 (bigger flame), t seconds (flicker). */
  const updateThrust = (power, turbo, t) => {
    const flick = 1 + 0.12 * Math.sin(t * 41) + 0.06 * Math.sin(t * 97);
    const len = (0.4 + 2.6 * power) * (1 + 0.6 * (turbo - 1)) * flick;
    flame.visible = power > 0.02;
    fo.scale.set(0.38 + 0.1 * power, 0.38 + 0.1 * power, len);
    fi.scale.set(0.2, 0.2, len * 0.6);
  };
  updateThrust(0, 1, 0);

  // ---- turbo rockets beside the exhaust
  const boost = createBoosters(car, mat, { x: 1.05, y: 0.45, z: 4.0, scale: 0.8 });

  // ---- car (0) <-> flying car (1)
  let form = 0;
  const setFlight = (u) => {
    form = THREE.MathUtils.clamp(u, 0, 1);
    const e = form * form * (3 - 2 * form);
    for (const w of wings) {
      w.piv.rotation.y = -w.sx * (1 - e) * 1.25; // tucked back along the side
      w.piv.scale.setScalar(0.25 + 0.75 * e);
      w.piv.visible = e > 0.02;
    }
    for (const f of fins) f.piv.rotation.z = f.sx * -0.45 * (1 - e); // lean out, then stand up
    const nav = car.getObjectByName('navLights');
    if (nav) nav.visible = form > 0.5; // aircraft lights only when flying (parked, a friend's, yours)
    for (const g of wheelGroups) {
      g.mount.rotation.z = g.sx * e * (Math.PI / 2); // tyres turn flat
      g.mount.position.y = e * 0.35;
      g.mount.position.x = g.sx * (1.55 - 0.45 * e);
    }
  };
  setFlight(0);
  const lamps = vehicleLights('bat'); // head and tail lights at night
  if (lamps) car.add(lamps);
  /** Car form: wheels roll with the speed and the front ones steer. */
  const roll = (along, steer, dt) => {
    for (const g of wheelGroups) {
      g.spin.rotation.x -= (along * dt) / 0.72;
      if (g.front) g.mount.rotation.y = form < 0.5 ? steer : 0;
    }
  };

  return {
    group: car,
    kind: 'bat',
    batmobile: true,
    jet: true, // jet engine: no propeller, more thrust, sits level
    level: true,
    noProp: true,
    thrustMul: 2.6, // the flying car: faster than the shuttle
    setFlight,
    get flightForm() { return form; },
    roll,
    updateThrust,
    updateBoosters: (level, turbo, power, t) => {
      boost(level, turbo, power, t);
      updateThrust(power, level > 0.5 ? turbo : 1, t);
    },
    floats: new THREE.Group(), // (no floats: it can't land on water)
    wheels,
    controls: { ailerons: wings.map((w) => w.ail), elevator: new THREE.Group(), rudder: new THREE.Group() },
    parts,
    cockpitHidden: [canopy, emblem],
    cockpitEye: new THREE.Vector3(0, 1.35, -0.2), // in the cockpit, low, looking down the long hood
    gearHeight: GEAR,
    radius: 4.2,
  };
}

void LEGO;

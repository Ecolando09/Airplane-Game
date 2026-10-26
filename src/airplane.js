import * as THREE from 'three';
import { LEGO, legoMaterial, isLego } from './lego.js';
import { createBoosters } from './boosters.js';

/**
 * LEGO Technic 42198 Bush Plane, at roughly 40x scale.
 * Strut-braced high wing with zebra stripes and yellow tips, yellow engine with
 * gray cylinders, 3-blade propeller, tapered tail boom and tail-dragger gear.
 * Nose points toward -Z; origin near the center of mass. Technic is studless,
 * so surfaces get pin-hole beams instead of studs.
 */

const MAIN_WHEEL_Z = -3.5;
const GEAR_HEIGHT = 3.05; // origin height above ground on the main wheels (body level)
const TAIL_WHEEL = new THREE.Vector3(0, -0.35, 6.3); // bottom of the tail wheel
// Nose-up attitude when sitting on the ground (tail wheel and mains both touching).
export const GROUND_TILT = Math.atan2(TAIL_WHEEL.y + GEAR_HEIGHT, TAIL_WHEEL.z - MAIN_WHEEL_Z);
const ORIGIN = new THREE.Vector3();
export const MAIN_CONTACT = new THREE.Vector3(0, -GEAR_HEIGHT, MAIN_WHEEL_Z);

function canvasTexture(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** White with wavy black zebra stripes running across the texture's v axis. */
function zebraTexture(bands, seed = 1) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return canvasTexture(1024, 256, (g, W, H) => {
    g.fillStyle = '#f4f4f4';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#1b1b1b';
    for (const [u0, u1] of bands) {
      for (let x = u0 * W; x < u1 * W; x += 44 + r() * 22) {
        const w = 16 + r() * 12;
        const top = r() * H * 0.3;
        const bot = H - r() * H * 0.3;
        const wob = 10 + r() * 12;
        g.beginPath();
        g.moveTo(x, top);
        g.bezierCurveTo(x + wob, top + (bot - top) * 0.33, x - wob, top + (bot - top) * 0.66, x + wob * 0.4, bot);
        g.lineTo(x + wob * 0.4 + w * 0.4, bot);
        g.bezierCurveTo(x - wob + w, top + (bot - top) * 0.66, x + wob + w, top + (bot - top) * 0.33, x + w * 0.5, top);
        g.closePath();
        g.fill();
      }
    }
  });
}

/** Technic beam face: a row of pin holes. */
function holesTexture(base, hole, rim) {
  return canvasTexture(64, 64, (g, W) => {
    g.fillStyle = base;
    g.fillRect(0, 0, W, W);
    g.fillStyle = rim;
    g.beginPath();
    g.arc(W / 2, W / 2, W * 0.36, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = hole;
    g.beginPath();
    g.arc(W / 2, W / 2, W * 0.27, 0, Math.PI * 2);
    g.fill();
  });
}

export function createLegoPlane() {
  const plane = new THREE.Group();
  const parts = [];
  // Realistic look: same plane and paint scheme, but smooth painted surfaces
  // instead of Lego bricks and Technic beams.
  const real = !isLego();
  const cache = new Map();
  const make = (params) => (real ? new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.08, ...params }) : legoMaterial(params));
  const mat = (color, opts) => {
    if (opts) return make({ color, ...opts });
    if (!cache.has(color)) cache.set(color, make({ color }));
    return cache.get(color);
  };
  const glassMat = new THREE.MeshPhongMaterial({
    color: LEGO.transClear, transparent: true, opacity: 0.35, shininess: 100, depthWrite: false,
  });

  const whiteHoles = holesTexture('#f4f4f4', '#cfc5ae', '#e2dccb');
  const blackHoles = holesTexture('#1f1f1f', '#050505', '#2c2c2c');
  const yellowHoles = holesTexture('#f2cd37', '#a88a1c', '#dcb52c');
  const holed = (tex, len) => {
    if (real) return null;
    const t = tex.clone();
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(Math.max(1, Math.round(len / 0.45)), 1);
    t.needsUpdate = true;
    return t;
  };

  /** Box centered at (x,y,z). `faces` overrides materials: {px,nx,py,ny,pz,nz}. */
  const box = (w, h, d, x, y, z, color, faces = {}, parent = plane) => {
    const base = mat(color);
    const order = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), order.map((k) => faces[k] || base));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    parts.push({ color, size: new THREE.Vector3(w, h, d), pos: m.position.clone().add(parent === plane ? ORIGIN : parent.position) });
    return m;
  };

  /** Beam with pin holes running from a to b. */
  const beam = (a, b, thick, depth, color, tex, parent = plane) => {
    const len = a.distanceTo(b);
    const holesMat = mat(color, { map: holed(tex, len) });
    const m = new THREE.Mesh(new THREE.BoxGeometry(depth, thick, len),
      [holesMat, holesMat, mat(color), mat(color), mat(color), mat(color)]);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
    m.castShadow = true;
    parent.add(m);
    parts.push({ color, size: new THREE.Vector3(depth, thick, len), pos: m.position.clone() });
    return m;
  };

  const zebraSide = zebraTexture([[0.05, 0.95]], 3);
  const zebraWing = zebraTexture([[0.1, 0.42], [0.58, 0.9]], 7);
  const zebraTail = zebraTexture([[0.1, 0.4], [0.6, 0.9]], 11);
  const zSide = mat(LEGO.white, { map: zebraSide });

  let glass, head, cap;
  const posts = []; // cabin window posts, hidden in the cockpit view
  if (!real) {
    // ---------------------------------------------------------------- fuselage
    // Cabin/forward body: white zebra sides, black top frame.
    box(2.0, 1.4, 5.1, 0, -0.3, -1.05, LEGO.white, { px: zSide, nx: zSide, py: mat(LEGO.black) });
    // Tapered tail boom
    const boomGeo = new THREE.BoxGeometry(2.0, 1.4, 5.1);
    const bp = boomGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      if (bp.getZ(i) > 0) {
        bp.setX(i, bp.getX(i) * 0.3);
        bp.setY(i, bp.getY(i) * 0.36 + 0.75);
      }
    }
    boomGeo.computeVertexNormals();
    const boom = new THREE.Mesh(boomGeo, [zSide, zSide, mat(LEGO.white), mat(LEGO.white), mat(LEGO.white), mat(LEGO.white)]);
    boom.position.set(0, -0.3, 4.05);
    boom.castShadow = true;
    plane.add(boom);
    parts.push({ color: LEGO.white, size: new THREE.Vector3(1.4, 1, 4), pos: boom.position.clone() });
    // Yellow beams along the boom's top edges, converging at the tail
    for (const sx of [-1, 1]) {
      beam(new THREE.Vector3(sx * 0.95, 0.48, 1.2), new THREE.Vector3(sx * 0.32, 0.72, 6.5), 0.22, 0.2, LEGO.yellow, yellowHoles);
      // Long yellow stringer down the side
      beam(new THREE.Vector3(sx * 1.02, 0.25, -3.4), new THREE.Vector3(sx * 1.02, 0.25, 1.4), 0.22, 0.1, LEGO.yellow, yellowHoles);
    }
    // Black top frame behind the cabin with the gearbox showing through
    for (const sx of [-1, 1]) box(0.32, 0.3, 2.4, sx * 0.84, 0.55, 0.4, LEGO.black);
    box(1.36, 0.3, 0.3, 0, 0.55, 1.45, LEGO.black);
    const gear = (r, color, x, y, z) => {
      const g = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.12, 16), mat(color));
      g.rotation.z = Math.PI / 2;
      g.position.set(x, y, z);
      plane.add(g);
    };
    gear(0.32, LEGO.lightGray, -0.2, 0.55, 0.2);
    gear(0.22, LEGO.blue, 0.25, 0.55, 0.8);
    gear(0.16, LEGO.yellow, 0, 0.55, -0.4);

    // Cabin windows (trans-clear) with black posts, under the wing
    glass = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.05, 2.7), glassMat);
    glass.position.set(0, 0.93, -2.05);
    plane.add(glass);
    for (const sx of [-1, 1]) {
      for (const z of [-3.35, -2.05, -0.75]) posts.push(box(0.16, 1.05, 0.16, sx * 0.9, 0.93, z, LEGO.black));
    }
    // Pilot
    head = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.4, 16), mat(LEGO.yellow));
    head.position.set(-0.4, 0.75, -2.3);
    plane.add(head);
    cap = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.12, 16), mat(LEGO.darkTan));
    cap.position.set(-0.4, 1.0, -2.3);
    plane.add(cap);

    // ---------------------------------------------------------------- engine
    box(2.0, 1.3, 1.3, 0, 0.0, -4.25, LEGO.yellow);
    box(1.6, 0.9, 0.5, 0, -0.1, -4.95, LEGO.yellow);
    for (const sx of [-1, 1]) {
      for (const z of [-3.95, -4.55]) {
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.55, 12).rotateZ(Math.PI / 2), mat(LEGO.lightGray));
        cyl.position.set(sx * 1.25, 0.15, z);
        cyl.castShadow = true;
        plane.add(cyl);
        const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 12).rotateZ(Math.PI / 2), mat(LEGO.yellow));
        fin.position.set(sx * 1.45, 0.15, z);
        plane.add(fin);
      }
    }
    // Yellow bent intake pipe arching over the propeller shaft
    const pipe = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.15, 10, 20, Math.PI), mat(LEGO.yellow));
    pipe.position.set(0, 0.05, -5.25);
    plane.add(pipe);
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.6, 10).rotateX(Math.PI / 2), mat(LEGO.yellow));
      leg.position.set(sx * 0.62, 0.05, -4.95);
      plane.add(leg);
    }
    const backplate = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.16, 20).rotateX(Math.PI / 2), mat(LEGO.black));
    backplate.position.set(0, 0.05, -5.25);
    plane.add(backplate);
  } else {
    // ---------------------------------------------------------------- fuselage (realistic)
    // One smooth body from firewall to tail: round cabin tapering to a slim tail,
    // with the zebra livery wrapped around it and a yellow cowling.
    const L0 = -4.6;
    const L1 = 6.7;
    const body = new THREE.CylinderGeometry(1, 1, L1 - L0, 28, 30, true).rotateX(Math.PI / 2).translate(0, 0, (L0 + L1) / 2);
    const bpos = body.attributes.position;
    const buv = body.attributes.uv;
    for (let i = 0; i < bpos.count; i++) {
      const z = bpos.getZ(i);
      const t = Math.max(0, (z + 0.6) / (L1 + 0.6)); // 0 at the cabin, 1 at the tail
      const r = 1.02 * (1 - 0.74 * t * t * (1.6 - 0.6 * t));
      bpos.setX(i, bpos.getX(i) * r);
      bpos.setY(i, bpos.getY(i) * r * 1.12 - 0.25 + 0.75 * t);
      buv.setXY(i, buv.getY(i), buv.getX(i)); // stripes run around the body
    }
    body.computeVertexNormals();
    const bodyMesh = new THREE.Mesh(body, zSide);
    bodyMesh.castShadow = true;
    plane.add(bodyMesh);
    parts.push({ color: LEGO.white, size: new THREE.Vector3(2, 2, 5), pos: new THREE.Vector3(0, 0, 0) });
    // Yellow cheat line along each side
    for (const sx of [-1, 1]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 6.4), mat(LEGO.yellow));
      line.position.set(sx * 1.02, -0.05, -1.2);
      plane.add(line);
    }
    // Tinted cabin windows and windshield
    glass = new THREE.Group();
    const tint = new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.08, metalness: 0.5 });
    const sideWin = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.62, 2.3), tint);
    sideWin.position.set(0, 0.5, -2.1);
    const shield = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 1.15), tint);
    shield.position.set(0, 1.05, -3.55);
    shield.rotation.x = 0.55;
    glass.add(sideWin, shield);
    plane.add(glass);
    // Pilot
    head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), mat(0xe0b48c));
    head.position.set(-0.4, 0.75, -2.3);
    plane.add(head);
    cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x2b3a55));
    cap.position.set(-0.4, 0.82, -2.3);
    plane.add(cap);
    // Cowling and spinner
    const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 1.0, 0.95, 28).rotateX(-Math.PI / 2), mat(LEGO.yellow));
    cowl.position.set(0, -0.25, -5.05);
    cowl.castShadow = true;
    plane.add(cowl);
    for (const sx of [-1, 1]) {
      const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8), mat(0x555555));
      exhaust.position.set(sx * 0.55, -0.95, -4.7);
      plane.add(exhaust);
    }

  }

  // Propeller (3 blades, dark gray, yellow axle pin)
  const propeller = new THREE.Group();
  propeller.position.set(0, 0.05, -5.5);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.3, 16).rotateX(Math.PI / 2), mat(LEGO.darkGray));
  propeller.add(hub);
  const pin = real
    ? new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 20).rotateX(-Math.PI / 2), mat(LEGO.yellow))
    : new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.3, 12).rotateX(Math.PI / 2), mat(LEGO.yellow));
  pin.position.z = real ? -0.45 : -0.25;
  propeller.add(pin);
  for (let i = 0; i < 3; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI * 2) / 3;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.44, 2.3, 0.07), mat(LEGO.darkGray));
    blade.position.y = 1.45;
    blade.rotation.y = 0.3;
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.07, 12).rotateX(Math.PI / 2), mat(LEGO.darkGray));
    tip.position.y = 1.15;
    blade.add(tip);
    arm.add(blade);
    propeller.add(arm);
  }
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(2.65, 40),
    new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
  );
  propeller.add(disc);
  plane.add(propeller);

  // ---------------------------------------------------------------- wing
  const WING_Y = 1.62;
  const zWing = mat(LEGO.white, { map: zebraWing });
  box(11.8, 0.34, 2.4, 0, WING_Y, -2.15, LEGO.white, { py: zWing });
  // Leading-edge beam with holes, the most visible Technic detail from the front
  beam(new THREE.Vector3(-5.9, WING_Y, -3.45), new THREE.Vector3(5.9, WING_Y, -3.45), 0.34, 0.22, LEGO.white, whiteHoles);
  // Inner flaps (fixed) and ailerons (move with the stick)
  const ailerons = [];
  for (const sx of [-1, 1]) {
    box(1.9, 0.18, 0.6, sx * 1.95, WING_Y - 0.04, -0.65, LEGO.white);
    const hinge = new THREE.Group();
    hinge.position.set(sx * 4.4, WING_Y, -0.95);
    plane.add(hinge);
    box(3.0, 0.18, 0.6, 0, -0.04, 0.3, LEGO.white, {}, hinge);
    ailerons.push(hinge);
    // Yellow tips
    box(0.8, 0.4, 2.7, sx * 6.3, WING_Y, -2.2, LEGO.yellow);
    const tipCap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.7, 10).rotateX(Math.PI / 2), mat(LEGO.yellow));
    tipCap.position.set(sx * 6.7, WING_Y, -2.2);
    plane.add(tipCap);
    // Clear round lights under the leading edge
    for (const x of [2.1, 5.5]) {
      const light = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 14).rotateX(Math.PI / 2), glassMat);
      light.position.set(sx * x, WING_Y - 0.28, -3.55);
      plane.add(light);
    }
    // Black struts from the lower fuselage to the wing
    beam(new THREE.Vector3(sx * 1.0, -0.75, -2.1), new THREE.Vector3(sx * 4.6, WING_Y - 0.17, -2.1), 0.14, 0.32, LEGO.black, blackHoles);
    // Wing pylons
    box(0.3, 0.3, 2.2, sx * 0.85, WING_Y - 0.3, -2.1, LEGO.black);
  }

  // ---------------------------------------------------------------- tail
  const zTail = mat(LEGO.white, { map: zebraTail });
  box(4.2, 0.2, 1.1, 0, 0.62, 6.2, LEGO.white, { py: zTail, ny: zTail });
  const elevator = new THREE.Group();
  elevator.position.set(0, 0.62, 6.75);
  plane.add(elevator);
  box(4.2, 0.14, 0.5, 0, 0, 0.25, LEGO.white, {}, elevator);

  const finShape = new THREE.Shape([
    new THREE.Vector2(5.4, 0.7), new THREE.Vector2(6.75, 0.7), new THREE.Vector2(6.75, 2.75),
    new THREE.Vector2(6.25, 2.75), new THREE.Vector2(5.95, 1.6),
  ]);
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.22, bevelEnabled: false }).rotateY(-Math.PI / 2);
  finGeo.translate(0.11, 0, 0);
  const fin = new THREE.Mesh(finGeo, mat(LEGO.white));
  fin.castShadow = true;
  plane.add(fin);
  const rudder = new THREE.Group();
  rudder.position.set(0, 0, 6.75);
  plane.add(rudder);
  box(0.16, 1.9, 0.5, 0, 1.7, 0.25, LEGO.white, {}, rudder);
  // Red crosses on the fin
  for (const sx of [-1, 1]) {
    for (const [y, z] of [[2.35, 6.45], [1.95, 6.2]]) {
      box(0.02, 0.24, 0.07, sx * 0.12, y, z, LEGO.red);
      box(0.02, 0.07, 0.24, sx * 0.12, y, z, LEGO.red);
    }
  }

  // ---------------------------------------------------------------- landing gear
  const wheels = [];
  const wheel = (r, w, x, y, z, hubColor) => {
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 20).rotateZ(Math.PI / 2), mat(LEGO.black));
    tire.position.set(x, y, z);
    tire.castShadow = true;
    plane.add(tire);
    const hubM = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.58, r * 0.58, w + 0.04, 16).rotateZ(Math.PI / 2), mat(hubColor));
    hubM.position.set(x, y, z);
    plane.add(hubM);
    wheels.push(tire, hubM);
  };
  for (const sx of [-1, 1]) {
    beam(new THREE.Vector3(sx * 0.8, -0.95, -3.2), new THREE.Vector3(sx * 1.55, -2.4, MAIN_WHEEL_Z), 0.22, 0.22, LEGO.black, blackHoles);
    wheel(0.65, 0.42, sx * 1.75, -2.4, MAIN_WHEEL_Z, LEGO.yellow);
  }
  const tailR = 0.22;
  beam(new THREE.Vector3(0, 0.45, 6.0), new THREE.Vector3(0, TAIL_WHEEL.y + tailR, TAIL_WHEEL.z), 0.16, 0.16, LEGO.darkGray, blackHoles);
  wheel(tailR, 0.16, 0, TAIL_WHEEL.y + tailR, TAIL_WHEEL.z, LEGO.lightGray);

  // ---------------------------------------------------------------- floats (B key)
  // Twin pontoons for landing on water. The group's origin is at the belly so
  // scaling it from 0 to 1 looks like the floats extending downward.
  const floats = new THREE.Group();
  floats.position.set(0, -1.0, 0);
  plane.add(floats);
  for (const sx of [-1, 1]) {
    const x = sx * 1.7;
    const yB = -GEAR_HEIGHT + 1.0 + 0.45; // pontoon center; bottom touches the ground plane
    box(0.9, 0.9, 7.0, x, yB, -0.6, LEGO.white, { py: mat(LEGO.yellow) }, floats);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.6, 4).rotateX(-Math.PI / 2).rotateZ(Math.PI / 4), mat(LEGO.yellow));
    nose.scale.set(1, 0.72, 1);
    nose.position.set(x, yB, -4.9);
    floats.add(nose);
    for (const z of [-3.2, 0.6]) {
      beam(new THREE.Vector3(sx * 0.7, 0.05, z), new THREE.Vector3(x, yB + 0.45, z), 0.16, 0.2, LEGO.black, blackHoles, floats);
    }
  }
  floats.scale.setScalar(0.001);
  floats.visible = false;

  // ---------------------------------------------------------------- turbo boosters
  // Two big Lego rocket boosters strapped along the tail boom.
  const updateBoosters = createBoosters(plane, mat, { x: 1.86, y: -0.3, z: 2.0, scale: 1.8 });

  return {
    updateBoosters,
    group: plane,
    floats,
    wheels,
    propeller,
    propDisc: disc,
    controls: { ailerons, elevator, rudder },
    parts,
    cockpitHidden: [glass, head, cap, ...posts], // hidden in cockpit view so they don't block the camera
    cockpitEye: new THREE.Vector3(0, 2.3, -3.4),
    gearHeight: GEAR_HEIGHT,
    radius: 3.5, // collision radius
  };
}

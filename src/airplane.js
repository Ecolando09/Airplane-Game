import * as THREE from 'three';
import { LEGO, legoMaterial, studGeometry } from './lego.js';

// One Lego stud pitch in world meters (the plane is a 100x scale model).
const U = 0.8;
const PLATE = 0.32;
const BRICK = 0.96;

/**
 * Placeholder Lego propeller plane, built from brick-sized parts.
 * Nose points toward -Z, origin at the center of mass.
 * Swap this out once we model the real set from photos / set number.
 */
export function createLegoPlane() {
  const plane = new THREE.Group();
  const parts = [];
  const studs = [];
  const mats = new Map();
  const mat = (color, opts = {}) => {
    const key = color + JSON.stringify(opts);
    if (!mats.has(key)) mats.set(key, legoMaterial({ color, ...opts }));
    return mats.get(key);
  };

  /** Add a brick: size in studs (w, l) and height in meters, position of its bottom-center. */
  const brick = (w, h, l, x, y, z, color, { studTop = true, opts } = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * U - 0.02, h - 0.01, l * U - 0.02), mat(color, opts));
    m.position.set(x, y + h / 2, z);
    m.castShadow = true;
    plane.add(m);
    parts.push({ color, size: new THREE.Vector3(w * U, h, l * U), pos: m.position.clone() });
    if (studTop) {
      for (let i = 0; i < w; i++) {
        for (let j = 0; j < l; j++) {
          studs.push({ x: x + (i - (w - 1) / 2) * U, y: y + h, z: z + (j - (l - 1) / 2) * U, color });
        }
      }
    }
    return m;
  };

  // Fuselage (4 studs wide)
  brick(4, BRICK, 10, 0, -1.2, 0.4, LEGO.red, { studTop: false });
  brick(4, BRICK, 10, 0, -1.2 + BRICK, 0.4, LEGO.white, { studTop: false });
  brick(4, PLATE, 5, 0, -1.2 + 2 * BRICK, 2.4, LEGO.red); // top behind cockpit
  brick(4, BRICK * 0.6, 2, 0, -1.2 + 2 * BRICK, 4.0, LEGO.red); // hump before tail
  // Yellow cheat line
  brick(4.05, PLATE * 0.6, 10.05, 0, -1.2 + BRICK - 0.1, 0.4, LEGO.yellow, { studTop: false });

  // Nose block + cowling
  brick(4, BRICK * 2, 2, 0, -1.2, -4.8, LEGO.red, { studTop: false });
  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.55, 1.0, 16), mat(LEGO.lightGray));
  cowl.rotation.x = Math.PI / 2;
  cowl.position.set(0, -0.25, -6.05);
  plane.add(cowl);

  // Windscreen (trans-clear slope) and cockpit
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(4 * U - 0.1, 1.15, 0.15),
    new THREE.MeshPhongMaterial({ color: LEGO.transBlue, transparent: true, opacity: 0.55, shininess: 90 })
  );
  glass.position.set(0, -1.2 + 2 * BRICK + 0.48, -1.15);
  glass.rotation.x = -0.75;
  plane.add(glass);
  // Minifig pilot
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.6, 16), mat(LEGO.yellow));
  head.position.set(0, -1.2 + 2 * BRICK + 0.1, 0.2);
  plane.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.2, 16), mat(LEGO.blue));
  cap.position.set(0, -1.2 + 2 * BRICK + 0.48, 0.2);
  plane.add(cap);

  // Main wing (low wing, 18 studs span)
  brick(18, PLATE, 4, 0, -1.2 + BRICK * 0.5, -0.8, LEGO.white);
  brick(3, PLATE, 4, -6.0, -1.2 + BRICK * 0.5 + PLATE, -0.8, LEGO.red);
  brick(3, PLATE, 4, 6.0, -1.2 + BRICK * 0.5 + PLATE, -0.8, LEGO.red);
  // Tail
  brick(8, PLATE, 3, 0, -1.2 + BRICK * 1.4, 4.4, LEGO.white);
  brick(1, BRICK * 2.5, 3, 0, -1.2 + 2 * BRICK, 4.4, LEGO.red, { studTop: false });
  brick(1.05, PLATE, 3.05, 0, -1.2 + 2 * BRICK + BRICK * 1.6, 4.4, LEGO.white, { studTop: false });

  // Landing gear
  const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 16).rotateZ(Math.PI / 2);
  const hubMat = mat(LEGO.lightGray);
  for (const [x, z] of [[-1.9, -0.8], [1.9, -0.8], [0, -4.6]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.1, 0.25), hubMat);
    leg.position.set(x, -1.55, z);
    plane.add(leg);
    const wheel = new THREE.Mesh(wheelGeo, mat(LEGO.black));
    wheel.position.set(x, -2.1, z);
    wheel.castShadow = true;
    plane.add(wheel);
  }

  // Propeller (spins)
  const propeller = new THREE.Group();
  propeller.position.set(0, -0.25, -6.65);
  const hub = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.8, 16).rotateX(-Math.PI / 2), mat(LEGO.yellow));
  propeller.add(hub);
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.2, 0.08), mat(LEGO.black));
    blade.position.y = 1.1;
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI * 2) / 3;
    arm.add(blade);
    propeller.add(arm);
  }
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(2.3, 32),
    new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0, depthWrite: false })
  );
  propeller.add(disc);
  plane.add(propeller);

  // Studs as one instanced mesh
  const studMesh = new THREE.InstancedMesh(studGeometry(0.24, 0.17), legoMaterial({}), studs.length);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  studs.forEach((s, i) => {
    m.makeTranslation(s.x, s.y, s.z);
    studMesh.setMatrixAt(i, m);
    studMesh.setColorAt(i, c.setHex(s.color));
  });
  plane.add(studMesh);

  // Navigation lights
  for (const [x, color] of [[-7.2, 0xff2020], [7.2, 0x20ff40]]) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), new THREE.MeshBasicMaterial({ color }));
    light.position.set(x, -1.2 + BRICK * 0.5 + PLATE * 2, -0.4);
    plane.add(light);
  }

  return {
    group: plane,
    propeller,
    propDisc: disc,
    parts,
    cockpitHidden: [glass, head, cap], // hidden in cockpit view so they don't block the camera
    gearHeight: 2.6, // origin height above the ground when sitting on its wheels
    radius: 3.5, // collision radius
  };
}

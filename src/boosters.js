import * as THREE from 'three';
import { LEGO } from './lego.js';

const FLAME_COLORS = { 2: [0xff7a1a, 0xffe08a], 3: [0x2f7bff, 0xbfe9ff] };
const flameMat = (color, opacity) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
});
// Unit flame: base (nozzle end) at z = 0, tip at z = 1.
const flameGeo = new THREE.ConeGeometry(1, 1, 14, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);

/**
 * Two Lego rocket boosters for turbo mode, flames pointing backward (+Z):
 * orange for T2X, blue for T3X. Hidden at normal speed.
 * @param {THREE.Object3D} parent  vehicle group (nose toward -Z)
 * @param {(color:number)=>THREE.Material} mat  the vehicle's material maker
 * @param {object} opts.x, y, z  booster position (x mirrored for the left/right booster)
 * @param {number} opts.scale    overall booster size
 * @returns {(level:number, turbo:number, power:number, t:number) => void} update function:
 *   level 0..1 deploys them, turbo 2 or 3 picks the flame color, power 0..1 sets flame length
 */
export function createBoosters(parent, mat, { x, y, z, scale }) {
  const boosters = new THREE.Group();
  parent.add(boosters);
  const flames = [];
  for (const sx of [-1, 1]) {
    const b = new THREE.Group();
    b.position.set(sx * x, y, z);
    b.scale.setScalar(scale);
    boosters.add(b);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 3.2, 16).rotateX(Math.PI / 2), mat(LEGO.lightGray));
    body.castShadow = true;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 16).rotateX(-Math.PI / 2), mat(LEGO.red));
    nose.position.z = -2.05;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.35, 16).rotateX(Math.PI / 2), mat(LEGO.red));
    band.position.z = -0.6;
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.46, 0.5, 16, 1, true).rotateX(Math.PI / 2), mat(LEGO.darkGray));
    nozzle.position.z = 1.85;
    // Strut to the body
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 1.2), mat(LEGO.black));
    strut.position.set(-sx * 0.4, 0.2, 0);
    b.add(body, nose, band, nozzle, strut);
    const outer = new THREE.Mesh(flameGeo, flameMat(0xff7a1a, 0.75));
    const inner = new THREE.Mesh(flameGeo, flameMat(0xfff2a8, 0.95));
    outer.position.z = inner.position.z = 2.05;
    b.add(outer, inner);
    flames.push({ outer, inner });
  }
  boosters.scale.setScalar(0.001);
  boosters.visible = false;

  return function updateBoosters(level, turbo, power, t) {
    boosters.visible = level > 0.02;
    boosters.scale.setScalar(Math.max(0.001, level));
    if (!boosters.visible) return;
    const [outerC, innerC] = FLAME_COLORS[turbo] || FLAME_COLORS[2];
    flames.forEach(({ outer, inner }, i) => {
      outer.material.color.setHex(outerC);
      inner.material.color.setHex(innerC);
      const flicker = 0.85 + 0.15 * Math.sin(t * 47 + i * 2.1) + 0.1 * Math.sin(t * 91 + i);
      const len = (turbo === 3 ? 4.6 : 3.4) * (0.35 + 0.65 * power) * flicker;
      outer.scale.set(0.42, 0.42, len);
      inner.scale.set(0.22, 0.22, len * 0.6);
    });
  };
}

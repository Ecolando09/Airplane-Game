import * as THREE from 'three';
import { glowTexture } from './nightlights.js';

// Aircraft lights, like real ones: steady red (left wingtip), blue-green (right
// wingtip: aviation green looks teal-blue at night) and white (tail) navigation lights, a flashing red beacon, white
// double-flash strobes on the wingtips, and a white landing light on the nose.
// They are always on (as on a real aircraft) but small by day and bright at night.

const SPECS = {
  // The bush plane: nose toward -Z, wings at y 1.62, tips at x = +-6.95.
  plane: {
    left: [-6.95, 1.62, -2.2], right: [6.95, 1.62, -2.2], tail: [0, 2.8, 6.75],
    beacons: [[0, 2.15, 0.6], [0, -0.95, 0.4]], strobes: [[-6.95, 1.62, -1.6], [6.95, 1.62, -1.6]],
    landing: [[-2.1, 1.34, -3.6], [2.1, 1.34, -3.6]],
  },
  // The passenger shuttle: delta wing corners (U = 0.9 m per stud), top of the tail, nose.
  jet: {
    left: [-5.6, 0.45, 5.4], right: [5.6, 0.45, 5.4], tail: [0, 2.3, 4.9],
    beacons: [[0, 2.4, 0.5], [0, -0.6, 2.0]], strobes: [[-5.6, 0.45, 5.9], [5.6, 0.45, 5.9]],
    landing: [[0, 0.7, -5.6]],
  },
  // The helicopter: lights on the body sides, the tail and under the belly.
  heli: {
    left: [-1.15, 0.5, -0.2], right: [1.15, 0.5, -0.2], tail: [0, 0.75, 9.2],
    beacons: [[0, 2.35, 1.6], [0, -0.75, 0.2]], strobes: [[-0.85, 2.0, 8.0], [0.85, 2.0, 8.0]],
    landing: [[0, -0.45, -2.1]],
  },
};

/** The parked-plane model (props), placed with its wheels at y = -lift and scaled. */
export function parkedPlaneSpec(scale = 1, lift = 0) {
  const p = (x, y, z) => [x * scale, y * scale - lift, z * scale];
  return {
    left: p(-5.75, 3.05, -1.0), right: p(5.75, 3.05, -1.0), tail: p(0, 3.7, 3.8),
    beacons: [p(0, 2.75, 0.2), p(0, 1.15, 0.4)], strobes: [p(-5.75, 3.05, -0.4), p(5.75, 3.05, -0.4)],
    landing: [p(0, 1.6, -3.4)],
  };
}

const live = new Set(); // light sets to update each frame

function sprite(color, size) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  m.userData.size = size;
  m.scale.setScalar(size);
  m.renderOrder = 4;
  return m;
}

/**
 * Put lights on an aircraft model. kind: 'plane' | 'heli', or a spec object.
 * Replaces any lights it already had.
 */
export function addNavLights(model, kind) {
  removeNavLights(model);
  const spec = typeof kind === 'string' ? SPECS[kind] : kind;
  if (!spec) return null;
  const group = new THREE.Group();
  group.name = 'navLights';
  const at = (s, p) => (s.position.set(p[0], p[1], p[2]), group.add(s), s);
  const set = {
    model, group,
    steady: [at(sprite(0xff2a1a, 1.4), spec.left), at(sprite(0x1fe6d2, 1.4), spec.right), at(sprite(0xffffff, 1.2), spec.tail)],
    beacons: spec.beacons.map((p) => at(sprite(0xff1a0a, 2.2), p)),
    strobes: spec.strobes.map((p) => at(sprite(0xffffff, 2.4), p)),
    // Landing lights: a small white glow on the nose (no beam cones).
    landing: spec.landing.map((p) => at(sprite(0xfff1c8, 1.6), p)),
    phase: Math.random() * 2,
  };
  model.group.add(group);
  model.navLights = set;
  live.add(set);
  return set;
}

export function removeNavLights(model) {
  const set = model?.navLights;
  if (!set) return;
  set.group.removeFromParent();
  live.delete(set);
  model.navLights = null;
}

/**
 * Each frame: t = seconds, night = 0 (day) .. 1 (night), landing = landing lights on.
 * Beacon: one red pulse a second. Strobes: a quick white double flash every 1.2 s.
 */
export function updateNavLights(t, night) {
  const day = 1 - Math.min(1, night);
  for (const set of live) {
    if (!set.model.group.parent) {
      live.delete(set); // the model was thrown away
      continue;
    }
    const k = 0.45 + 0.55 * Math.min(1, night * 1.4); // brightness
    for (const s of set.steady) {
      s.material.opacity = k;
      s.scale.setScalar(s.userData.size * (0.6 + 0.6 * (1 - day)));
    }
    const ph = (t + set.phase) % 1.2;
    const strobe = ph < 0.05 || (ph > 0.14 && ph < 0.19);
    for (const s of set.strobes) {
      s.visible = strobe;
      s.scale.setScalar(s.userData.size * (0.7 + 0.8 * (1 - day)));
    }
    const pulse = Math.max(0, Math.sin(((t + set.phase) % 1) * Math.PI)) ** 6;
    for (const s of set.beacons) {
      s.material.opacity = pulse * k;
      s.visible = pulse > 0.02;
    }
  }
}

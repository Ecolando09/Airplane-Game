import * as THREE from 'three';
import { glowTexture } from './nightlights.js';
import { vehicleInfo, EMERGENCY } from './vehicles.js';
import { addNavLights, parkedPlaneSpec } from './navlights.js';

// Lights on the cars, trucks and boats the robot supersizes and drives (and on
// friends' rides): headlights and red tail lights, a boat's red/green bow lights
// and white stern light. Like the traffic, they only show after dark.
// All glows share a few materials, so turning night on or off is one switch.

const mats = {};
let nightNow = 0;
function mat(color) {
  if (!mats[color]) {
    mats[color] = new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
    shade(mats[color]);
  }
  return mats[color];
}
function shade(m) {
  m.visible = nightNow > 0.15;
  m.opacity = Math.min(1, nightNow * 1.2);
}
const HEAD = 0xfff1c8;
const TAIL = 0xff2a1a;
const PORT = 0xff2a1a;
const STARBOARD = 0x23e05a;

function glow(group, color, size, x, y, z) {
  const s = new THREE.Sprite(mat(color));
  s.scale.setScalar(size);
  s.position.set(x, y, z);
  s.renderOrder = 4;
  group.add(s);
  return s;
}

/**
 * A group of lights for a vehicle kind (props kind name, or car model name),
 * at scale 1 with the nose toward -Z, to add to its mesh. Null if it has none.
 * `model`: the car model behind a props kind (car -> sedan).
 */
export function vehicleLights(kind, model) {
  const v = vehicleInfo(model || kind);
  if (!v) return null;
  const g = new THREE.Group();
  g.name = 'vehLights';
  const fz = -v.L / 2 - 0.05;
  const bz = v.L / 2 + 0.05;
  const x = v.W / 2 - 0.35;
  if (kind === 'boat') {
    glow(g, PORT, 1.6, -v.W / 2 + 0.2, v.lampY, fz + 1.4);
    glow(g, STARBOARD, 1.6, v.W / 2 - 0.2, v.lampY, fz + 1.4);
    glow(g, 0xffffff, 1.4, 0, v.lampY + 1.6, bz - 1.2);
    return g;
  }
  for (const sx of [-x, x]) {
    glow(g, HEAD, 2.2, sx, v.lampY, fz);
    glow(g, TAIL, 1.2, sx, v.lampY, bz);
  }
  return g;
}

/** Lights for a ride model (a friend's car or plane): put on, sized with the model. */
export function addRideLights(model, kind, propsKinds) {
  if (kind === 'plane') return addNavLights(model, parkedPlaneSpec(1, 0));
  const l = vehicleLights(kind, propsKinds?.[kind]?.model);
  if (l) model.group.add(l);
  const em = emergencyLights(kind, false); // a friend's police car or fire engine: on when they switch it on
  if (em) {
    model.group.add(em);
    model.emLights = em;
  }
  return l;
}

/** 0 = day .. 1 = night: every vehicle's head and tail lights. */
export function setVehicleLightsNight(v) {
  nightNow = v;
  for (const m of Object.values(mats)) shade(m);
}

/**
 * Lights on the supersized vehicles lying around (they live in an instanced
 * mesh, so they get a few light sets moved onto the nearest ones).
 */
export class GrownLights {
  constructor(scene, props, max = 12) {
    this.scene = scene;
    this.props = props;
    this.max = max;
    this.sets = new Map(); // item -> group
    this.t = 0;
  }

  update(x, z, night) {
    const now = performance.now();
    if (now < this.t) return;
    this.t = now + 500; // the list only changes when something is grown, dropped or driven off
    const want = [];
    if (night > 0.15) {
      for (const it of this.props.items) {
        if (it.held || (it.scale || 1) < 2) continue;
        const def = this.props.kinds[it.kind];
        if (!def.drive || it.kind === 'plane') continue;
        const d = Math.hypot(it.x - x, it.z - z);
        if (d < 900) want.push([d, it]);
      }
      want.sort((a, b) => a[0] - b[0]);
      want.length = Math.min(want.length, this.max);
    }
    const keep = new Set(want.map((w) => w[1]));
    for (const [it, g] of this.sets) {
      if (!keep.has(it)) {
        g.removeFromParent();
        this.sets.delete(it);
      }
    }
    for (const it of keep) {
      let g = this.sets.get(it);
      if (!g) {
        g = vehicleLights(it.kind, this.props.kinds[it.kind].model);
        if (!g) continue;
        this.scene.add(g);
        this.sets.set(it, g);
      }
      g.position.set(it.x, it.y, it.z);
      g.rotation.set(0, it.yaw, 0);
      g.scale.setScalar(it.scale || 1);
    }
  }

  dispose() {
    for (const g of this.sets.values()) g.removeFromParent();
    this.sets.clear();
  }
}

// ---------------------------------------------------------------- emergency lights
// Police cars, ambulances and fire engines: flashing red/blue/white lights that
// show by day too (unlike head and tail lights). They take turns in two phases
// (wig-wag) with a quick double flash, like the real thing.

const emMats = {};
function emMat(color) {
  emMats[color] ||= new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, fog: true });
  return emMats[color];
}
const emLive = new Set();

/** Flashing lights for an emergency kind (scale 1, nose toward -Z), or null. on: flashing. */
export function emergencyLights(kind, on = true) {
  const spec = EMERGENCY[kind];
  if (!spec) return null;
  const g = new THREE.Group();
  g.name = 'emLights';
  g.userData.on = on;
  g.userData.phase = Math.random();
  g.userData.soft = kind === 'truck'; // the ice cream truck's bulbs: a slow blink in turns, smaller
  for (const [x, y, z, color, phase] of spec) {
    const sp = new THREE.Sprite(emMat(color));
    sp.position.set(x, y, z);
    sp.scale.setScalar(1.5);
    sp.renderOrder = 5;
    sp.userData.phase = phase;
    g.add(sp);
  }
  emLive.add(g);
  return g;
}

/** Each frame: t = seconds, night 0..1 (the glows are bigger after dark). */
export function updateEmergencyLights(t, night) {
  const size = 1.5 + 1.6 * Math.min(1, night);
  for (const g of emLive) {
    if (!g.parent) {
      emLive.delete(g);
      continue;
    }
    if (!g.userData.on) {
      g.visible = false;
      continue;
    }
    g.visible = true;
    if (g.userData.soft) {
      const half = Math.floor(t * 2 + g.userData.phase) % 2;
      for (const sp of g.children) {
        sp.visible = sp.userData.phase === half;
        sp.scale.setScalar(size * 0.55);
      }
      continue;
    }
    const p = (t * 1.6 + g.userData.phase) % 1; // one cycle: 0.62 s
    const half = p < 0.5 ? 0 : 1;
    const q = (p % 0.5) / 0.5;
    const lit = q < 0.28 || (q > 0.4 && q < 0.68); // double flash
    for (const sp of g.children) {
      sp.visible = lit && sp.userData.phase === half;
      sp.scale.setScalar(size);
    }
  }
}

/** Are a vehicle's flashing lights on? Emergency vehicles: unless switched off. The ice cream truck: once switched on. */
export const lightsOn = (it, info) => (info?.emergency ? it.lights !== false : !!info?.chime && it.lights === true);

/** Flashing lights on the emergency vehicles lying around (nearest few, any size). */
export class EmergencyProps {
  constructor(scene, props, max = 8) {
    this.scene = scene;
    this.props = props;
    this.max = max;
    this.sets = new Map();
    this.t = 0;
  }

  update(x, z) {
    const now = performance.now();
    if (now < this.t) return;
    this.t = now + 400;
    const want = [];
    for (const it of this.props.items) {
      if (it.held || !lightsOn(it, this.props.kinds[it.kind])) continue;
      const d = Math.hypot(it.x - x, it.z - z);
      if (d < 1200) want.push([d, it]);
    }
    want.sort((a, b) => a[0] - b[0]);
    want.length = Math.min(want.length, this.max);
    const keep = new Set(want.map((w) => w[1]));
    for (const [it, g] of this.sets) {
      if (!keep.has(it)) {
        g.removeFromParent();
        this.sets.delete(it);
      }
    }
    for (const it of keep) {
      let g = this.sets.get(it);
      if (!g) {
        g = emergencyLights(it.kind);
        this.scene.add(g);
        this.sets.set(it, g);
      }
      g.position.set(it.x, it.y, it.z);
      g.rotation.set(0, it.yaw, 0);
      g.scale.setScalar(it.scale || 1);
    }
  }

  dispose() {
    for (const g of this.sets.values()) g.removeFromParent();
    this.sets.clear();
  }
}

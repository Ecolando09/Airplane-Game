import * as THREE from 'three';
import { LEGO, legoMaterial } from './lego.js';
import { createBoosters } from './boosters.js';
import { JET_ACCENT } from './jet.js';
import { BALLOON_YELLOW } from './balloon.js';

// Robot mode: the vehicle unfolds into a 13 m robot that walks, jumps, smashes
// buildings and throws things. Every robot shares one skeleton (hips, legs,
// torso, arms, head: the walking, punching and carrying animation, and the
// height the game's collision and camera rely on). On top of it each vehicle
// has a kit (KITS below): the parts of that vehicle, placed where a
// transforming toy would put them, and its own proportions. Kit parts start
// folded flat against the body and swing out as the change finishes
// (setUnfold, 0 to 1).

export const BAT_ACCENT = 0xf5c518; // the Batmobile's yellow: the part that takes a paint job
const PALETTES = {
  plane: { main: LEGO.white, accent: LEGO.yellow, dark: LEGO.black, trim: LEGO.red, glass: LEGO.transBlue },
  heli: { main: LEGO.white, accent: 0xf0368f, dark: 0x6a2fc9, trim: 0x8ee3ef, glass: LEGO.transBlue },
  jet: { main: JET_ACCENT, accent: LEGO.white, dark: LEGO.darkGray, trim: LEGO.lightGray, glass: LEGO.blue },
  bat: { main: 0x1e2126, accent: BAT_ACCENT, dark: 0x111317, trim: 0x3b4048, glass: 0x22303e },
  balloon: { main: 0x9a6a35, accent: BALLOON_YELLOW, dark: 0x5e3d1c, trim: 0xd01712, glass: LEGO.transBlue },
};
// Proportions inside the same height: torso width, shoulder spread, limb
// thickness, hip spread, waist width, and the shoulder block's colour key.
const SHAPES = {
  plane: { torsoW: 5.4, shoulder: 3.6, limb: 1, hipX: 1.5, waistW: 2.4, shoulderKey: 'accent' },
  heli: { torsoW: 4.6, shoulder: 3.15, limb: 0.74, hipX: 1.25, waistW: 1.9, shoulderKey: 'trim' }, // slim, light on its feet
  jet: { torsoW: 6.4, shoulder: 4.25, limb: 1.3, hipX: 1.85, waistW: 3.6, shoulderKey: 'main' }, // broad and stocky
  bat: { torsoW: 6.4, shoulder: 4.35, limb: 1.0, hipX: 1.45, waistW: 1.7, shoulderKey: 'main', taper: true }, // tall shoulders, narrow waist
  balloon: { torsoW: 5.8, shoulder: 3.8, limb: 0.92, hipX: 1.45, waistW: 2.8, shoulderKey: 'accent' }, // a round wicker body
};
export const ROBOT_HEIGHT = 13;

/**
 * Build the robot for a vehicle kind ('plane', 'heli', 'jet', 'bat' or 'balloon'). Origin
 * at the feet, facing -Z. opts.tint: a parked plane you took (the bush-plane
 * kit in that plane's colour).
 */
export function createRobot(kind, opts = {}) {
  if (!KITS[kind]) kind = 'plane';
  const pal = { ...PALETTES[kind] };
  if (opts.tint != null) pal.accent = opts.tint;
  const P = SHAPES[kind];
  const group = new THREE.Group();
  const mats = {};
  const mat = (hex, o = {}) => (mats[`${hex}${o.transparent ? 't' : ''}`] ||= legoMaterial({ color: hex, studs: 1.2, ...o }));
  const box = (parent, w, h, d, hex, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(hex));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  /** A cylinder along an axis ('x', 'y' or 'z'). */
  const cyl = (parent, r, h, hex, x, y, z, axis = 'y', seg = 14, o) => {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(g, mat(hex, o));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const pivot = (parent, x, y, z) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  const glassMat = (hex, opacity = 0.7) => new THREE.MeshPhongMaterial({ color: hex, transparent: true, opacity, shininess: 90 });
  const body = new THREE.Group(); // everything above the feet, so it can bob and lean
  group.add(body);
  const L = P.limb;

  // Legs, pivoting at the hips.
  const legs = [-1, 1].map((sx) => {
    const leg = new THREE.Group();
    leg.position.set(sx * P.hipX, 6.6, 0);
    box(leg, 1.5 * L, 2.8, 1.6 * L, pal.dark, 0, -1.4, 0);
    box(leg, 1.9 * L, 3.0, 1.9 * L, pal.main, 0, -4.2, 0);
    box(leg, 2.0 * L, 0.5, 2.0 * L, pal.accent, 0, -2.8, 0); // knee band
    box(leg, 2.2 * Math.max(0.85, L), 1.0, 3.4, pal.trim, 0, -6.1, -0.5); // foot
    body.add(leg);
    return leg;
  });
  box(body, P.hipX * 2 + 1.6 * L, 1.2, 2.2, pal.dark, 0, 7.0, 0); // hips
  box(body, P.waistW, 1.0, 2.0, pal.accent, 0, 7.9, 0); // waist

  // Torso with the cockpit glass as a chest plate.
  const torso = new THREE.Group();
  torso.position.set(0, 8.4, 0);
  body.add(torso);
  if (P.taper) {
    // Narrow at the waist, wide at the shoulders.
    box(torso, P.waistW + 1.2, 1.4, 2.4, pal.main, 0, 0.7, 0);
    box(torso, (P.waistW + P.torsoW) / 2 + 0.4, 1.0, 2.6, pal.main, 0, 1.9, 0);
    box(torso, P.torsoW, 1.4, 2.8, pal.main, 0, 2.9, 0);
  } else box(torso, P.torsoW, 3.4, 2.8, pal.main, 0, 1.7, 0);
  const collar = box(torso, P.torsoW + 0.2, 0.6, 3.0, pal.accent, 0, 3.1, 0);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.6, 0.3), glassMat(pal.glass));
  glass.position.set(0, 2.0, -1.5);
  torso.add(glass);
  const chestTrim = box(torso, 3.6, 0.9, 0.4, pal.trim, 0, 0.6, -1.45);

  // Head.
  const head = new THREE.Group();
  head.position.set(0, 3.7, 0);
  torso.add(head);

  // Arms, pivoting at the shoulders.
  const arms = [-1, 1].map((sx) => {
    const arm = new THREE.Group();
    arm.position.set(sx * P.shoulder, 2.7, 0);
    box(arm, 1.9 * Math.max(1, L), 1.9 * Math.max(1, L), 2.2 * Math.max(1, L), pal[P.shoulderKey], 0, 0, 0); // shoulder
    box(arm, 1.3 * L, 2.4, 1.3 * L, pal.dark, 0, -1.9, 0);
    box(arm, 1.6 * L, 2.4, 1.6 * L, pal.main, 0, -4.1, 0);
    box(arm, 1.8 * Math.max(0.85, L), 1.5, 1.8 * Math.max(0.85, L), pal.trim, 0, -5.9, 0); // fist
    torso.add(arm);
    return arm;
  });

  // Kit parts that swing out at the end of the change: folded (rotated by
  // `by` and shrunk) at 0, in place at 1.
  const folds = [];
  const fold = (obj, by = {}, from = 0.35) => {
    folds.push({ obj, rot: obj.rotation.clone(), scale: obj.scale.clone(), by: { x: by.x || 0, y: by.y || 0, z: by.z || 0 }, from });
    return obj;
  };
  const spinners = []; // [object, axis, speed]
  const ctx = { pal, P, mat, box, cyl, pivot, glassMat, torso, head, arms, legs, body, glass, chestTrim, collar, fold, spinners, kind };
  const kit = KITS[kind](ctx) || {};

  // Turbo: the same twin rockets the vehicles get, worn as a jetpack with the
  // flames pointing down and back.
  const pack = new THREE.Group();
  pack.position.set(0, 2.4, 2.1);
  pack.rotation.x = 1.05;
  torso.add(pack);
  const updateBoosters = createBoosters(pack, (hex) => mat(hex), { x: 1.5, y: 0, z: 0, scale: 1.5 });

  // Where a carried object sits: above the head, between raised hands.
  const hands = new THREE.Group();
  hands.position.set(0, ROBOT_HEIGHT + 2.2, -1.2);
  group.add(hands);

  /** 0: kit parts folded flat against the body; 1: in place (with a little overshoot on the way). */
  function setUnfold(u) {
    u = THREE.MathUtils.clamp(u, 0, 1);
    const c = 1.70158;
    const e = u >= 1 ? 1 : 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; // ease out, slightly past and back
    for (const f of folds) {
      f.obj.rotation.set(f.rot.x + f.by.x * (1 - e), f.rot.y + f.by.y * (1 - e), f.rot.z + f.by.z * (1 - e));
      f.obj.scale.copy(f.scale).multiplyScalar(f.from + (1 - f.from) * Math.max(0, e));
    }
  }

  let phase = 0;
  let stepSide = 0;
  let punch = 0; // 1 -> 0 as the swing plays
  let carry = 0;
  /** Pose for this frame. s: { speed, onGround, vy, wading, carrying } */
  function animate(s, dt) {
    if (s.sitting) {
      // On the toilet: legs out in front, hands on knees.
      legs[0].rotation.x = legs[1].rotation.x = 1.45;
      arms[0].rotation.x = arms[1].rotation.x = 0.9;
      arms[0].rotation.z = arms[1].rotation.z = 0;
      torso.rotation.x = 0.08;
      body.position.y = -1.3;
      return;
    }
    const amount = Math.min(1, s.speed / 14);
    phase += dt * (3 + s.speed * 0.35) * (s.onGround ? 1 : 0.3);
    // A foot comes down twice per cycle.
    const side = Math.floor(phase / Math.PI) % 2;
    if (side !== stepSide && s.onGround && s.speed > 4) api.onStep?.();
    stepSide = side;
    const swing = s.onGround ? Math.sin(phase) * 0.7 * amount : 0.35;
    legs[0].rotation.x = swing;
    legs[1].rotation.x = s.onGround ? -swing : -0.5;
    body.position.y = (s.onGround ? Math.abs(Math.cos(phase)) * 0.35 * amount : 0) - (s.wading ? 2.6 : 0);
    torso.rotation.x = -0.12 * amount + (s.onGround ? 0 : THREE.MathUtils.clamp(-s.vy * 0.01, -0.3, 0.3));
    carry += ((s.carrying ? 1 : 0) - carry) * (1 - Math.exp(-dt * 10));
    punch = Math.max(0, punch - dt * 3.2);
    const jab = Math.sin(Math.min(1, (1 - punch) * 1.6) * Math.PI); // out and back
    arms[0].rotation.x = -swing * 0.8 * (1 - carry) - 3.0 * carry;
    arms[1].rotation.x = swing * 0.8 * (1 - carry) - 3.0 * carry - (punch > 0 ? jab * 1.9 : 0) * (1 - carry);
    arms[0].rotation.z = -0.25 * carry;
    arms[1].rotation.z = 0.25 * carry;
    for (const [o, axis, sp] of spinners) o.rotation[axis] += dt * sp;
    kit.animate?.(s, dt, phase, amount);
  }

  const api = {
    group,
    body,
    onStep: null,
    updateBoosters,
    kind: 'robot',
    robotKind: kind,
    tint: opts.tint ?? null,
    hands,
    animate,
    setUnfold,
    punch: () => (punch = 1),
    cockpitHidden: [head],
    cockpitEye: new THREE.Vector3(0, ROBOT_HEIGHT - 0.6, -1.4),
    gearHeight: 0,
    radius: 2.4,
  };
  return api;
}

// ------------------------------------------------------------------ the kits
// Each kit gets the skeleton (ctx) and adds the vehicle's parts. Colours and
// shapes follow the vehicle models (airplane.js, heli.js, jet.js,
// batmobile.js); parts in the accent colour take the paint job.

/** The skeleton's standard boxy head with a glowing visor. */
function boxHead({ head, box, pal }, band = true) {
  box(head, 1.9, 1.7, 1.9, pal.main, 0, 0.85, 0);
  if (band) box(head, 2.1, 0.5, 2.1, pal.accent, 0, 1.75, 0);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.4, 0.2), new THREE.MeshBasicMaterial({ color: 0x4fd8ff }));
  visor.position.set(0, 1.0, -0.98);
  head.add(visor);
  return visor;
}

/** A fat wheel (tyre and hub), axle along X. */
function wheel({ cyl, pivot }, parent, r, w, tyre, hub, x, y, z) {
  const g = pivot(parent, x, y, z);
  cyl(g, r, w, tyre, 0, 0, 0, 'x', 18);
  cyl(g, r * 0.55, w + 0.08, hub, 0, 0, 0, 'x', 14);
  cyl(g, r * 0.18, w + 0.16, 0x6c6e68, 0, 0, 0, 'x', 8);
  return g;
}

const KITS = {
  // Bush plane: wings folded on the back with yellow ailerons, the propeller
  // spinning on the chest, the main wheels on the shoulders, the tail as a
  // back fin, the yellow intake pipe over a shoulder, the floats as forearm
  // guards, the pilot's cap.
  plane(c) {
    const { pal, box, cyl, pivot, torso, head, arms, fold, spinners, mat } = c;
    boxHead(c, false);
    // Pilot's cap: crown and peak.
    cyl(head, 1.05, 0.5, LEGO.darkTan, 0, 1.95, 0.05, 'y', 18);
    box(head, 1.7, 0.14, 0.8, LEGO.darkTan, 0, 1.76, -1.15);
    box(head, 2.12, 0.2, 2.12, LEGO.black, 0, 1.68, 0); // band
    for (const sx of [-1, 1]) {
      // Wing, hinged at the shoulder blade: white with a yellow aileron and tip.
      const hinge = pivot(torso, sx * 1.4, 3.0, 1.6);
      hinge.rotation.set(0, sx * -0.25, sx * 0.9);
      box(hinge, 6.4, 0.3, 2.3, pal.main, sx * 3.3, 0, 0);
      box(hinge, 2.6, 0.32, 0.7, pal.accent, sx * 4.4, 0, 1.15); // aileron
      box(hinge, 0.7, 0.4, 2.4, pal.accent, sx * 6.5, 0, 0); // tip
      fold(hinge, { z: -sx * 1.3, y: sx * 0.25 });
      // Main wheel on the shoulder.
      const w = wheel(c, arms[sx < 0 ? 0 : 1], 0.85, 0.7, LEGO.black, LEGO.lightGray, sx * 1.3, 0.9, 0.2);
      fold(w, { z: -sx * 1.2 });
      // Float as a forearm guard: a white pontoon with a pointed front.
      const fl = pivot(arms[sx < 0 ? 0 : 1], sx * 0.95 * Math.max(1, c.P.limb), -4.4, 0);
      box(fl, 0.75, 2.8, 1.2, pal.main, 0, 0, 0);
      box(fl, 0.78, 0.25, 1.22, pal.accent, 0, 0.6, 0);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.9, 10), mat(pal.main));
      nose.position.set(0, -1.85, 0);
      nose.rotation.x = Math.PI;
      fl.add(nose);
      fold(fl, { z: sx * 0.9 });
    }
    // Tail fin and tailplane as a back fin.
    const tail = pivot(torso, 0, 3.2, 1.9);
    box(tail, 0.3, 2.8, 1.7, pal.main, 0, 1.2, 0.5);
    box(tail, 0.32, 0.6, 1.0, pal.trim, 0, 2.4, 0.9);
    box(tail, 3.4, 0.22, 1.1, pal.main, 0, 0.1, 0.8);
    fold(tail, { x: 1.2 });
    // The yellow intake pipe over the left shoulder.
    const pipe = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.2, 10, 20, Math.PI), mat(pal.accent));
    pipe.position.set(-2.2, 3.3, 0.2);
    pipe.rotation.y = Math.PI / 2;
    torso.add(pipe);
    fold(pipe, { y: 1.2 });
    // Three-blade propeller with its yellow spinner cone, on the chest.
    const prop = pivot(torso, 0, 0.9, -1.75);
    for (let i = 0; i < 3; i++) {
      const blade = box(prop, 0.42, 1.5, 0.08, LEGO.darkGray, 0, 0.8, 0);
      const arm = new THREE.Group();
      arm.rotation.z = (i * Math.PI * 2) / 3;
      arm.add(blade);
      prop.add(arm);
    }
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.8, 16).rotateX(-Math.PI / 2), mat(pal.accent));
    cone.position.z = -0.3;
    prop.add(cone);
    c.chestTrim.visible = false;
    c.glass.position.y = 2.25;
    spinners.push([prop, 'z', 18]);
    fold(prop, { x: -1.4 }, 0.2);
  },

  // Ghost-Spider copter: the rotor on a back mast, pink web lines on the chest,
  // four pink spider legs on the back that twitch as it walks, cyan intakes as
  // shoulders, the tail boom and shrouded tail rotor as a tail, a round white
  // head with big eyes like the copter's nose.
  heli(c) {
    const { pal, box, cyl, pivot, torso, head, arms, fold, spinners, mat } = c;
    // Round head with big eyes.
    const skull = new THREE.Mesh(new THREE.SphereGeometry(1.15, 20, 14), mat(pal.main));
    skull.position.y = 0.95;
    skull.scale.set(1, 0.92, 1);
    skull.castShadow = true;
    head.add(skull);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), new THREE.MeshBasicMaterial({ color: 0x1b1030 }));
      eye.scale.set(1, 1.35, 0.4);
      eye.position.set(sx * 0.45, 1.05, -1.02);
      eye.rotation.y = sx * 0.35;
      head.add(eye);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0x8ee3ef }));
      glint.position.set(sx * 0.38, 1.25, -1.2);
      head.add(glint);
    }
    box(head, 1.3, 0.12, 1.3, pal.accent, 0, 2.02, 0); // pink crown stripe
    // Pink web lines across the chest: spokes and two rings.
    const web = pivot(torso, 0, 1.9, -1.47);
    for (let i = 0; i < 6; i++) {
      const s = box(web, 0.09, 3.0, 0.06, pal.accent, 0, 0, 0);
      s.rotation.z = (i * Math.PI) / 6;
    }
    for (const r of [0.7, 1.35]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 4, 6), mat(pal.accent));
      web.add(ring);
    }
    c.glass.visible = false;
    c.chestTrim.visible = false;
    // Cyan intakes as shoulders (the shoulder blocks are cyan): a dark grille in front.
    for (const arm of arms) cyl(arm, 0.6, 0.3, pal.dark, 0, 0.1, -1.1, 'z', 12);
    // Rotor on a back mast.
    const mast = pivot(torso, 0, 3.4, 1.9);
    box(mast, 0.4, 2.2, 0.4, pal.dark, 0, 0.9, 0);
    cyl(mast, 0.45, 0.4, pal.trim, 0, 2.0, 0);
    const rotor = pivot(mast, 0, 2.2, 0);
    box(rotor, 11, 0.15, 0.7, pal.accent, 0, 0, 0);
    box(rotor, 0.7, 0.15, 11, pal.accent, 0, 0, 0);
    spinners.push([rotor, 'y', 18]);
    fold(mast, { x: 1.4 });
    // Tail boom and shrouded tail rotor, from the lower back.
    const tail = pivot(torso, 0, 0.6, 1.4);
    tail.rotation.x = 0.55;
    box(tail, 0.6, 0.6, 3.6, pal.main, 0, 0, 1.8);
    const shroud = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.22, 8, 18), mat(pal.accent));
    shroud.rotation.y = Math.PI / 2;
    shroud.position.set(0, 0, 3.9);
    tail.add(shroud);
    const tr = pivot(tail, 0, 0, 3.9);
    box(tr, 0.06, 1.4, 0.18, pal.dark, 0, 0, 0);
    box(tr, 0.06, 0.18, 1.4, pal.dark, 0, 0, 0);
    spinners.push([tr, 'x', 30]);
    fold(tail, { x: -0.9 });
    // Four pink spider legs on the back: up and out at the knee, then down.
    const spider = [];
    for (const sx of [-1, 1]) {
      for (const [y, a] of [[2.5, 0.35], [1.2, -0.25]]) {
        const hip = pivot(torso, sx * 1.4, y, 1.3);
        hip.rotation.set(0, sx * a, sx * 0.55);
        box(hip, 2.4, 0.32, 0.32, pal.accent, sx * 1.2, 0, 0);
        const knee = pivot(hip, sx * 2.4, 0, 0);
        knee.rotation.z = sx * -1.5;
        box(knee, 2.2, 0.26, 0.26, pal.accent, sx * 1.1, 0, 0);
        fold(hip, { z: -sx * 0.5 });
        spider.push({ hip, sx, base: hip.rotation.z, off: spider.length * 1.7 });
      }
    }
    return {
      // The spider legs twitch as it walks.
      animate(s, dt, phase, amount) {
        for (const l of spider) l.hip.rotation.z = l.base + l.sx * Math.sin(phase * 2 + l.off) * 0.18 * (0.3 + amount);
      },
    };
  },

  // Passenger shuttle: the clear-blue canopy with its white-and-red top as the
  // chest, the red half-round wing split as shoulder shields, the grey spoiler
  // as a head crest, the "21" tile on a shoulder, the rear window as a
  // backpack, and hover thrusters in the feet and hands (blue flames when it
  // jet-jumps).
  jet(c) {
    const { pal, box, cyl, pivot, torso, head, arms, legs, fold, mat, glassMat } = c;
    boxHead(c, false);
    box(head, 2.1, 0.4, 2.1, LEGO.white, 0, 1.75, 0);
    // Grey spoiler as a crest, tilted up toward the back.
    const crest = pivot(head, 0, 2.0, 0.2);
    crest.rotation.x = 0.35;
    box(crest, 2.6, 0.22, 1.8, LEGO.darkGray, 0, 0.1, 0.4);
    box(crest, 0.3, 0.8, 0.3, LEGO.darkGray, -0.9, -0.3, 0);
    box(crest, 0.3, 0.8, 0.3, LEGO.darkGray, 0.9, -0.3, 0);
    fold(crest, { x: -0.6 });
    // Chest: the clear-blue canopy with a white top and red stripes.
    c.glass.visible = false;
    c.chestTrim.visible = false;
    const can = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.2, 0.7), glassMat(0x9fdcec, 0.8));
    can.position.set(0, 1.6, -1.55);
    torso.add(can);
    box(torso, 4.6, 0.5, 1.0, LEGO.white, 0, 2.9, -1.4);
    for (const x of [-1.3, 1.3]) box(torso, 0.45, 0.52, 1.02, pal.main, x, 2.9, -1.4);
    box(torso, 4.0, 0.4, 0.5, LEGO.lightGray, 0, 0.35, -1.5); // grey nose plate
    // The red half-round wing, split in two: a shield on each shoulder, straight edge up.
    arms.forEach((arm, i) => {
      const sx = i ? 1 : -1;
      const sh = pivot(arm, sx * 1.35, 0.2, 0);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.4, 20, 1, false, 0, Math.PI), mat(pal.main));
      disc.rotation.set(0, 0, Math.PI / 2);
      disc.rotation.x = Math.PI / 2;
      disc.castShadow = true;
      sh.add(disc);
      box(sh, 0.42, 0.3, 3.9, LEGO.black, 0, 0.05, 0); // black frame along the straight edge
      fold(sh, { z: -sx * 1.4 });
      if (sx < 0) {
        // The yellow "21" tile on the left shield.
        const tag = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3).rotateY(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: tileTexture() }));
        tag.position.set(-0.22, -0.9, 0);
        sh.add(tag);
      }
    });
    // Rear window as a backpack: two red posts, the window, white tiles.
    const pack = pivot(torso, 0, 1.7, 1.55);
    for (const x of [-1.5, 1.5]) box(pack, 0.6, 2.8, 0.9, pal.main, x, 0, 0.3);
    const win = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.8, 0.2), glassMat(0x9fdcec, 0.75));
    win.position.set(0, 0.3, 0.6);
    pack.add(win);
    box(pack, 3.6, 0.3, 1.1, LEGO.white, 0, 1.5, 0.3);
    box(pack, 2.4, 0.5, 0.7, 0x1f2d5c, 0, -1.0, 0.5); // dark blue curved piece
    fold(pack, { x: 1.1 });
    // Hover thrusters: under each heel and each fist, with blue flames.
    const flames = [];
    const flameMat = new THREE.MeshBasicMaterial({ color: 0x58b8ff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    const thruster = (parent, x, y, z) => {
      cyl(parent, 0.55, 0.5, LEGO.darkGray, x, y, z, 'y', 14);
      cyl(parent, 0.38, 0.52, 0x2a2d31, x, y - 0.02, z, 'y', 12);
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.6, 12).rotateX(Math.PI).translate(0, -0.8, 0), flameMat);
      f.position.set(x, y - 0.25, z);
      f.visible = false;
      parent.add(f);
      flames.push(f);
    };
    for (const leg of legs) thruster(leg, 0, -6.45, 0.9);
    for (const arm of arms) thruster(arm, 0, -6.75, 0);
    return {
      animate(s) {
        const on = !s.onGround && s.vy > -8;
        for (const f of flames) {
          f.visible = on;
          if (on) f.scale.y = 0.7 + Math.min(1.2, Math.max(0, s.vy) / 15) + Math.random() * 0.25;
        }
      },
    };
  },

  // Batmobile: the long hood as chest armour with the yellow emblem, the two
  // tail fins as a cape-like pair on the back, the four fat wheels on the
  // shoulders and hips, the dark canopy as a visor, pointed ears, and the jet
  // exhaust on the back.
  // Hot air balloon: the wicker basket as the body, a little striped balloon
  // on its back (it bobs as it walks), the burner on its head (the flame roars
  // when it jet-jumps), striped shoulder pads, and ropes down to the hands.
  balloon(c) {
    const { pal, box, cyl, pivot, torso, head, arms, fold, mat } = c;
    boxHead(c, false);
    // Basket weave across the body.
    for (let i = 0; i < 4; i++) box(torso, c.P.torsoW + 0.06, 0.16, 2.86, pal.dark, 0, 0.45 + i * 0.75, 0);
    box(torso, c.P.torsoW + 0.3, 0.45, 3.1, pal.dark, 0, 3.15, 0); // padded rim
    // The burner on the head: a frame, two burners and a flame.
    const burner = pivot(head, 0, 2.0, 0);
    box(burner, 1.9, 0.16, 1.9, 0x9aa0a6, 0, 0, 0);
    for (const x of [-0.4, 0.4]) cyl(burner, 0.26, 0.55, 0x5a5f66, x, 0.3, 0, 'y', 10);
    const flameGeo = new THREE.ConeGeometry(1, 1, 12, 1, true).translate(0, 0.5, 0);
    const flame = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0xff8a1a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    flame.position.y = 0.55;
    burner.add(flame);
    fold(burner, { x: 0.8 });
    // A little striped balloon on the back, on a mast.
    const back = pivot(torso, 0, 3.4, 1.9);
    box(back, 0.35, 3.2, 0.35, 0x9aa0a6, 0, 1.6, 0);
    const env = pivot(back, 0, 3.4, 0.4);
    const pts = [[0.5, 0], [1.1, 0.6], [1.9, 1.7], [2.3, 2.9], [2.2, 3.9], [1.6, 4.7], [0.6, 5.1], [0.02, 5.2]].map(([r, y]) => new THREE.Vector2(r, y));
    const stripes = [0xd01712, 0x1e5aa8, 0x2b9e3e, 0x7a3fd0];
    const pair = (Math.PI * 2) / 8;
    for (let i = 0; i < 8; i++) {
      env.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 3, i * pair, pair * 0.64), mat(pal.accent)));
      env.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 2, i * pair + pair * 0.64, pair * 0.36), mat(stripes[i % 4])));
    }
    fold(back, { x: 1.3 });
    // Striped pads on the shoulders, and a rope from each down to the hand.
    arms.forEach((arm, i) => {
      const sx = i ? 1 : -1;
      const pad = pivot(arm, 0, 1.1, 0);
      box(pad, 2.3, 0.4, 2.4, pal.accent, 0, 0, 0);
      box(pad, 0.5, 0.42, 2.42, stripes[i], 0, 0, 0);
      fold(pad, { z: -sx * 0.9 });
      cyl(arm, 0.07, 5.6, 0x3a2a1a, sx * 1.0, -3.0, 0.9, 'y', 6);
    });
    let t = 0;
    return {
      // The balloon bobs as it walks; the flame roars when it jet-jumps.
      animate(s, dt, phase, amount) {
        t += dt;
        env.rotation.z = Math.sin(phase * 0.5) * 0.08 * (0.3 + amount);
        env.position.y = 3.4 + Math.sin(t * 2) * 0.12;
        const roar = !s.onGround && s.vy > -8 ? 1 : 0.15;
        const f = 1 + 0.15 * Math.sin(t * 31);
        flame.scale.set(0.25 + 0.3 * roar, (0.4 + 2.6 * roar) * f, 0.25 + 0.3 * roar);
      },
    };
  },

  bat(c) {
    const { pal, box, cyl, pivot, torso, head, arms, legs, fold, mat, glassMat } = c;
    box(head, 1.9, 1.7, 1.9, pal.main, 0, 0.85, 0);
    box(head, 1.6, 0.5, 0.4, pal.main, 0, 0.25, -1.05); // jaw
    const visor = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.65, 0.5), glassMat(pal.glass, 0.9));
    visor.position.set(0, 1.15, -0.95);
    head.add(visor);
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.16, 0.1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    eyes.position.set(0, 1.18, -1.22);
    head.add(eyes);
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.2, 4), mat(pal.main));
      ear.position.set(sx * 0.62, 2.2, 0);
      ear.castShadow = true;
      head.add(ear);
    }
    c.glass.visible = false;
    c.chestTrim.visible = false;
    // The long hood as chest armour: a wedge plate from the collar to the waist.
    const hood = pivot(torso, 0, 1.7, -1.55);
    hood.rotation.x = -0.12;
    box(hood, 4.2, 3.6, 0.5, pal.main, 0, 0, 0);
    box(hood, 0.3, 3.4, 0.56, pal.trim, -1.2, 0, 0);
    box(hood, 0.3, 3.4, 0.56, pal.trim, 1.2, 0, 0);
    // The yellow emblem: an oval with a black bat shape.
    const em = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.12, 24).rotateX(Math.PI / 2), mat(pal.accent));
    em.scale.set(1.25, 0.75, 1);
    em.position.set(0, 0.4, -0.3);
    hood.add(em);
    box(hood, 1.6, 0.28, 0.14, pal.dark, 0, 0.42, -0.38);
    box(hood, 0.36, 0.5, 0.14, pal.dark, 0, 0.45, -0.38);
    fold(hood, { x: -1.2 });
    // Two tall tail fins as a cape-like pair on the back.
    for (const sx of [-1, 1]) {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.lineTo(0, -6.5);
      s.lineTo(1.6, -5.2);
      s.lineTo(1.1, 0.6);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.25, bevelEnabled: false });
      g.rotateY(-Math.PI / 2); // in the Y-Z plane, sweeping back
      const fin = new THREE.Mesh(g, mat(pal.main));
      fin.castShadow = true;
      const hinge = pivot(torso, sx * 1.9, 3.2, 1.5);
      hinge.rotation.set(-0.12, 0, sx * 0.14);
      fin.position.x = 0.12;
      hinge.add(fin);
      box(hinge, 0.3, 0.3, 1.2, pal.accent, 0, -0.3, 0.8); // yellow trim at the top
      fold(hinge, { x: 0.9, z: -sx * 0.3 });
    }
    // Fat wheels with yellow hubs on the shoulders and hips.
    arms.forEach((arm, i) => {
      const sx = i ? 1 : -1;
      box(arm, 2.0, 0.6, 2.3, pal.accent, 0, 1.15, 0); // tall shoulder pad with yellow trim
      box(arm, 2.1, 1.0, 2.4, pal.main, 0, 1.75, 0);
      fold(wheel(c, arm, 1.0, 0.9, 0x111214, pal.accent, sx * 1.45, 0.2, 0), { z: -sx * 1.3 });
    });
    legs.forEach((leg, i) => {
      const sx = i ? 1 : -1;
      fold(wheel(c, leg, 0.95, 0.85, 0x111214, pal.accent, sx * 1.35, -0.9, 0), { z: -sx * 1.2 });
    });
    // The jet exhaust on the back.
    const ex = pivot(torso, 0, 1.4, 1.5);
    ex.rotation.x = 0.5;
    cyl(ex, 0.8, 1.4, pal.trim, 0, 0, 0.6, 'z', 16);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.58, 16), new THREE.MeshBasicMaterial({ color: 0xff8a2a }));
    glow.position.set(0, 0, 1.32);
    ex.add(glow);
    fold(ex, { x: -0.6 });
  },
};

/** The shuttle's yellow "21" tile (the same picture as on the shuttle). */
let tileTex = null;
function tileTexture() {
  if (tileTex) return tileTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
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
  return (tileTex = new THREE.CanvasTexture(c));
}

const Y = new THREE.Vector3(0, 1, 0);
const GRAVITY = 30;
const WALK = 20; // m/s
const RUN = 34;
const JET_CLIMB = 18; // m/s climb while jump is held (more with turbo)
const JET_CEILING = 600; // meters above the ground where the jets fade out
const FALL_MAX = 45; // m/s terminal speed (still fast enough to stomp)

/**
 * Walking physics, with the same fields the flight models have (pos, quat,
 * speed, heading, onGround...) so the camera, HUD, minimap and multiplayer
 * work unchanged.
 * Controls: stick/W-S forward and back, A-D turn, Q-E sidestep, Shift run,
 * Space jump (hold for jump jets).
 */
export class RobotWalk {
  constructor(world, model) {
    this.world = world;
    this.plane = model;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.yaw = 0;
    this.speed = 0;
    this.verticalSpeed = 0;
    this.onGround = false;
    this.onWater = false;
    this.crashed = false;
    this.crashReason = '';
    this.canStall = false;
    this.throttle = 0;
    this.turbo = 1;
    this.turboNow = 1;
    this.floats = false;
    this.ctrl = { pitch: 0, roll: 0, yaw: 0 };
    this.jet = 0;
    this.onSlam = null; // (impact speed) when landing hard
    this.driving = 0; // size of the supersized car being driven, or 0
    this.onRam = null; // (collider) while driving: return true if it was knocked down
    this.onExit = null; // jump pressed while driving
    this.blocker = null; // the unbreakable thing in the way, if any
    this.blockedT = 0; // how long it has been in the way (s)
    this.atEdge = false; // pressed against the edge of the map
    this.size = 1; // robot size: 1/4, 1/2, 1 (normal), 2, 4 or 8 (see setSize)
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  /** Grow or shrink the robot (1/4 .. 8): bigger walks faster, jumps higher, hits harder. */
  setSize(size) {
    this.size = size;
    this.plane.group.scale.setScalar(size);
  }

  get height() {
    return ROBOT_HEIGHT * this.size;
  }

  /** Put the robot somewhere: feet at `pos`, facing `yaw`, moving at `vel`. */
  place(pos, yaw, vel) {
    this.pos.copy(pos);
    this.yaw = yaw;
    this.vel.copy(vel || new THREE.Vector3());
    if (this.vel.length() > 70) this.vel.setLength(70);
    this.onGround = false;
    this.jet = 0;
    this.quat.setFromAxisAngle(Y, this.yaw);
  }

  get forward() {
    return this._fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  get right() {
    return this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  get up() {
    return Y.clone();
  }

  get heading() {
    return ((THREE.MathUtils.radToDeg(-this.yaw) % 360) + 360) % 360;
  }

  update(dt, input) {
    if (this.driving) return this._drive(dt, input);
    const w = this.world;
    const c = this.ctrl;
    const k = 1 - Math.exp(-dt * 10);
    c.pitch += (input.pitch - c.pitch) * k;
    c.roll += (input.roll - c.roll) * k;
    c.yaw += (input.yaw - c.yaw) * k;
    this.yaw -= c.roll * 2.3 * dt;
    this.quat.setFromAxisAngle(Y, this.yaw);
    this.turboNow += (this.turbo - this.turboNow) * (1 - Math.exp(-dt * 2));

    // Walk: ease toward the wanted speed (less grip in the air, slower in water).
    this.onWater = w.isWater(this.pos.x, this.pos.z) && this.pos.y - w.groundAt(this.pos.x, this.pos.z) < 1;
    // Jets give running speed in the air and much better steering, so holding
    // jump turns the robot into something that flies.
    const jets = !this.onGround && input.brake;
    const big = Math.sqrt(this.size); // a bigger robot takes bigger steps
    const top = ((input.run ?? input.throttle > 0) || jets ? RUN : WALK) * (this.onWater ? 0.6 : 1) * this.turboNow * big; // T2X, T3X: rocket-powered
    const f = this.forward;
    const r = this.right;
    // Side-stepping is sized with the robot too (it used to be full size always,
    // so a stick resting slightly off centre slid a shrunk robot sideways).
    const wantX = f.x * c.pitch * top + r.x * c.yaw * 12 * big;
    const wantZ = f.z * c.pitch * top + r.z * c.yaw * 12 * big;
    const grip = 1 - Math.exp(-dt * (this.onGround ? 7 : jets ? 4 : 1.2));
    this.vel.x += (wantX - this.vel.x) * grip;
    this.vel.z += (wantZ - this.vel.z) * grip;
    // Nothing pressed, on the ground: settle to a full stop instead of creeping.
    if (this.onGround && !input.pitch && !input.yaw && Math.abs(c.pitch) < 0.05 && Math.abs(c.yaw) < 0.05 && Math.hypot(this.vel.x, this.vel.z) < 0.6 * big) {
      c.pitch = c.yaw = 0;
      this.vel.x = this.vel.z = 0;
    }

    // Jump; holding the button keeps the jets burning for as long as it's held.
    // The climb rate eases toward JET_CLIMB (a tap is a hop, holding climbs, and
    // holding while falling cushions the landing) and fades out near the ceiling.
    if (input.brake && this.onGround) {
      this.vel.y = 24 * Math.sqrt(this.size) * (this.jumpBoost || 1); // soda in Potty Time jumps higher
      this.onGround = false;
    }
    this.jetting = !this.onGround && input.brake;
    if (this.jetting) {
      const agl = this.pos.y - w.groundAt(this.pos.x, this.pos.z);
      const climb = (JET_CLIMB + 10 * (this.turboNow - 1)) * Math.sqrt(this.size) * THREE.MathUtils.clamp((JET_CEILING - agl) / 100, -0.3, 1);
      this.vel.y += (climb - this.vel.y) * (1 - Math.exp(-dt * 2.5));
    } else if (!this.onGround) {
      this.vel.y = Math.max(-FALL_MAX, this.vel.y - GRAVITY * dt);
    }

    // Move in short steps; walls stop you (slide along them), roofs you can stand on.
    const dist = Math.hypot(this.vel.x, this.vel.z) * dt;
    const steps = Math.max(1, Math.ceil(dist / 1.5));
    const rad = this.plane.radius * this.size;
    // On the ground the robot never climbs onto things: anything in its way,
    // however low, is a wall to walk through (see below). Up on a roof, or
    // landing from a jump, low roofs can be stepped onto.
    const terrain = w.groundAt(this.pos.x, this.pos.z);
    const walking = this.onGround && this.pos.y - terrain < 1;
    const step = walking ? 0.3 : 2.5;
    const hit = (x, z) => w.blockedAt(x, z, this.pos.y, rad, this.height, step);
    let inside = hit(this.pos.x, this.pos.z);
    if (inside && this.onRam?.(inside)) inside = hit(this.pos.x, this.pos.z); // standing in something: break it
    const stuck = !!inside; // a landmark around the robot: let it walk out
    const wantSpeed = Math.hypot(this.vel.x, this.vel.z);
    let blocker = null;
    for (let i = 0; i < steps; i++) {
      const sx = (this.vel.x * dt) / steps;
      const sz = (this.vel.z * dt) / steps;
      const nx = this.pos.x + sx;
      const nz = this.pos.z + sz;
      // Walking into a building knocks it down (onRam); only landmarks stop the robot.
      let c = stuck ? null : hit(nx, nz);
      if (c && this.onRam?.(c)) {
        this.vel.x *= 0.7;
        this.vel.z *= 0.7;
        c = hit(nx, nz);
      }
      if (!c) {
        this.pos.x = nx;
        this.pos.z = nz;
        continue;
      }
      // Slide along the wall: keep only the part of the motion that runs along it.
      blocker = c;
      const n = w.wallNormal(c, this.pos.x, this.pos.z);
      const into = sx * n.x + sz * n.z;
      const ax = sx - n.x * Math.min(0, into);
      const az = sz - n.z * Math.min(0, into);
      if ((ax || az) && !hit(this.pos.x + ax, this.pos.z + az)) {
        this.pos.x += ax;
        this.pos.z += az;
        const vin = this.vel.x * n.x + this.vel.z * n.z;
        if (vin < 0) {
          this.vel.x -= n.x * vin;
          this.vel.z -= n.z * vin;
        }
      } else if (!hit(nx, this.pos.z)) {
        this.pos.x = nx;
        this.vel.z = 0;
      } else if (!hit(this.pos.x, nz)) {
        this.pos.z = nz;
        this.vel.x = 0;
      } else {
        this.vel.x = this.vel.z = 0;
        break;
      }
    }
    // Remember what's been holding the robot up, so the game can outline it.
    const slowed = wantSpeed > 3 && Math.hypot(this.vel.x, this.vel.z) < wantSpeed * 0.5;
    if (blocker && slowed) {
      this.blockedT = this.blocker === blocker ? this.blockedT + dt : dt;
      this.blocker = blocker;
    } else if (!blocker) {
      this.blockedT = 0;
      this.blocker = null;
    }
    // Stay on the map (the game says so when you reach the edge).
    const ex = w.halfX + 1400;
    const ez = w.halfZ + 1400;
    this.atEdge = Math.abs(this.pos.x) >= ex || Math.abs(this.pos.z) >= ez;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -ex, ex);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -ez, ez);

    // Head bump: flying up into a bridge deck or an arch stops at its underside.
    if (this.vel.y > 0) {
      const head = this.pos.y + this.height;
      const roof = w.ceilingAt(this.pos.x, this.pos.z, head, head + this.vel.y * dt, rad * 0.5);
      if (roof !== null) {
        this.pos.y = roof - this.height - 0.05;
        this.vel.y = 0;
      }
    }
    this.pos.y += this.vel.y * dt;
    // Walking up a bridge ramp follows the deck (a deck far overhead doesn't count).
    const deck = walking ? w.deckAt?.(this.pos.x, this.pos.z, this.pos.y) : null;
    const ground = walking ? Math.max(w.groundAt(this.pos.x, this.pos.z), deck ?? -Infinity)
      : w.standHeight(this.pos.x, this.pos.z, this.onGround ? this.pos.y : this.pos.y - this.vel.y * dt);
    if (this.pos.y <= ground) {
      if (!this.onGround && this.vel.y < -32) this.onSlam?.(-this.vel.y);
      this.pos.y = ground;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.onGround) {
      // Walked down a slope (follow it) or off an edge (fall).
      if (this.pos.y - ground < 2.5) this.pos.y = ground;
      else this.onGround = false;
    }
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.verticalSpeed = this.vel.y;
  }

  /**
   * Driving a supersized car: `this.driving` is its size (2 to 4). Stick or W/S
   * for gas and reverse, A/D steer, jump to get out. Nothing stops it: whatever
   * it runs into is handed to onRam (which knocks it down).
   */
  _drive(dt, input) {
    const w = this.world;
    const c = this.ctrl;
    const k = 1 - Math.exp(-dt * 8);
    c.pitch += (input.pitch - c.pitch) * k;
    c.roll += (input.roll - c.roll) * k;
    if (input.brake) return this.onExit?.();
    // Turbo and the horn's boost make the car faster too.
    this.turboNow += (this.turbo - this.turboNow) * (1 - Math.exp(-dt * 2));
    this.boost = Math.max(0, (this.boost || 0) - dt);
    const top = Math.min(75, 24 * this.driving) * (1 + 0.35 * (this.turboNow - 1)) * (this.boost > 0 ? 1.4 : 1);
    const f0 = this.forward;
    let along = this.vel.x * f0.x + this.vel.z * f0.z;
    along += (c.pitch * top - along) * (1 - Math.exp(-dt * 1.6));
    this.yaw -= c.roll * 1.5 * THREE.MathUtils.clamp(along / 10, -1, 1) * dt;
    this.quat.setFromAxisAngle(Y, this.yaw);
    const f = this.forward;
    const rad = 2 * this.driving;
    const steps = Math.max(1, Math.ceil((Math.abs(along) * dt) / 1.5));
    for (let i = 0; i < steps; i++) {
      const nx = this.pos.x + (f.x * along * dt) / steps;
      const nz = this.pos.z + (f.z * along * dt) / steps;
      // Boats stay on the water: on land they grind to a crawl.
      if (this.boat && !w.isWater(nx, nz)) along = THREE.MathUtils.clamp(along, -2, 2);
      // On a bridge deck the road is clear (map buildings sometimes overlap a bridge's end).
      const onDeck = !this.boat && w.deckAt?.(nx, nz, this.pos.y) != null;
      const hit = this.boat || onDeck ? null : w.blockedAt(nx, nz, this.pos.y, rad, 4 * this.driving);
      // A normal-size car can't knock buildings down (a supersized one can).
      if (hit && (this.driving < 2 || !this.onRam?.(hit))) {
        along *= -0.3; // bounce off
        break;
      }
      if (hit) along *= 0.9;
      this.pos.x = nx;
      this.pos.z = nz;
    }
    const ex = w.halfX + 1400;
    const ez = w.halfZ + 1400;
    this.atEdge = Math.abs(this.pos.x) >= ex || Math.abs(this.pos.z) >= ez;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -ex, ex);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -ez, ez);
    this.vel.set(f.x * along, 0, f.z * along);
    // Cars and trucks drive across bridges (a boat goes underneath).
    const deck = this.boat ? null : w.deckAt?.(this.pos.x, this.pos.z, this.pos.y);
    this.pos.y = deck ?? w.groundAt(this.pos.x, this.pos.z);
    this.onGround = true;
    this.onWater = !!this.boat && w.isWater(this.pos.x, this.pos.z);
    this.speed = Math.abs(along);
    this.verticalSpeed = 0;
  }

  // The flight models' API, for code that treats every vehicle alike.
  reset() {}
  resetAirborne() {}
}

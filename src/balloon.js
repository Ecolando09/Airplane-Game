import * as THREE from 'three';
import { LEGO, legoMaterial, isLego } from './lego.js';
import { createBoosters } from './boosters.js';
import { HeliFlight } from './heli.js';

// The hot air balloon: a yellow envelope with vertical stripes of alternating
// colours all the way round, a wicker basket, and a burner whose flame grows
// when you climb and shrinks to a pilot light when you sink.
//
// Flying it: the lift control (W/S, the touch LIFT slider, the right stick)
// is the burner: up to rise, centred to hold your height, down to vent and
// sink. Left and right turn it slowly (its turning vents). The throttle runs a
// small steering fan for a gentle push forward. The wind carries you too, and
// it blows a different way at different heights, like a real balloon.
// It flies with the copter's controls, so it uses the copter's flight model's
// API (HeliFlight) with its own physics.

export const BALLOON_YELLOW = 0xf5c518; // the envelope's yellow: the part that takes a paint job
// The stripes between the yellow panels, in turn all the way round.
const STRIPES = [0xd01712, 0x1e5aa8, 0x2b9e3e, 0x7a3fd0];
const WICKER = 0x9a6a35;
const WICKER_DARK = 0x5e3d1c;
const METAL = 0x9aa0a6;
const GEAR = 0.02; // the basket's floor sits on the ground
const THROAT = 6.2; // height of the envelope's open bottom above the basket floor
// The envelope's outline from the throat up: [radius, height above the throat].
const PROFILE = [[1.35, 0], [2.1, 1.1], [3.5, 2.9], [5.1, 5.1], [6.5, 7.7], [7.3, 10.2], [7.55, 12], [7.25, 13.8], [6.35, 15.4], [4.8, 16.7], [2.6, 17.5], [0.05, 17.8]];
export const BALLOON_TOP = THROAT + 17.8;

export function createHotAirBalloon() {
  const g = new THREE.Group();
  const lego = isLego();
  const mats = {};
  const mat = (hex, o = {}) => (mats[`${hex}${o.side || ''}`] ||= legoMaterial({ color: hex, studs: o.studs ?? 0.8, ...o }));
  const parts = [];
  const box = (w, h, d, hex, x, y, z, parent = g, o) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(hex, o));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    parts.push({ pos: m.position.clone(), size: new THREE.Vector3(w, h, d), color: hex });
    return m;
  };

  // ---- the basket: woven wicker with a dark rim
  box(2.4, 1.15, 2.4, WICKER, 0, 0.6, 0);
  box(2.56, 0.26, 2.56, WICKER_DARK, 0, 1.28, 0); // padded rim
  for (let i = 0; i < 4; i++) box(2.42, 0.07, 2.42, WICKER_DARK, 0, 0.2 + i * 0.27, 0, g, { studs: 0 }); // weave bands
  box(2.1, 0.1, 2.1, WICKER_DARK, 0, 1.12, 0, g, { studs: 0 }); // floor seen from inside

  // ---- the burner frame on four poles, the burners, and the flame
  for (const [x, z] of [[-1.05, -1.05], [1.05, -1.05], [-1.05, 1.05], [1.05, 1.05]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 6), mat(METAL, { studs: 0 }));
    pole.position.set(x * 0.85, 2.35, z * 0.85);
    pole.rotation.set(z * -0.08, 0, x * 0.08);
    g.add(pole);
  }
  box(1.7, 0.12, 1.7, METAL, 0, 3.32, 0, g, { studs: 0 });
  for (const x of [-0.32, 0.32]) {
    const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.6, 12), mat(0x5a5f66, { studs: 0 }));
    burner.position.set(x, 3.6, 0);
    burner.castShadow = true;
    g.add(burner);
  }
  // Flame: an orange outer cone and a bright yellow-white core, pointing up.
  const flame = new THREE.Group();
  flame.position.set(0, 3.9, 0);
  g.add(flame);
  const flameGeo = new THREE.ConeGeometry(1, 1, 14, 1, true).translate(0, 0.5, 0);
  const add = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const outer = new THREE.Mesh(flameGeo, add(0xff7a1a, 0.7));
  const inner = new THREE.Mesh(flameGeo, add(0xfff2a8, 0.9));
  flame.add(outer, inner);
  const pilot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), add(0x4fa8ff, 0.9)); // the pilot light, always on
  pilot.position.set(0, 3.92, 0);
  g.add(pilot);

  // ---- the envelope: yellow panels with a coloured stripe between each pair
  const pts = PROFILE.map(([r, y]) => new THREE.Vector2(r, y));
  const GORES = 12; // yellow panels (and as many stripes)
  const pair = (Math.PI * 2) / GORES;
  const stripeW = pair * 0.36;
  const envelope = new THREE.Group();
  envelope.position.y = THROAT;
  g.add(envelope);
  const fabric = [];
  for (let i = 0; i < GORES; i++) {
    const a = i * pair;
    const yellow = new THREE.Mesh(new THREE.LatheGeometry(pts, 4, a, pair - stripeW), mat(BALLOON_YELLOW, { studs: 0, side: THREE.DoubleSide }));
    const stripe = new THREE.Mesh(new THREE.LatheGeometry(pts, 2, a + pair - stripeW, stripeW), mat(STRIPES[i % STRIPES.length], { studs: 0, side: THREE.DoubleSide }));
    for (const m of [yellow, stripe]) {
      m.castShadow = true;
      envelope.add(m);
      fabric.push(m);
    }
  }
  parts.push({ pos: new THREE.Vector3(0, THROAT + 10, 0), size: new THREE.Vector3(8, 6, 8), color: BALLOON_YELLOW });
  parts.push({ pos: new THREE.Vector3(0, THROAT + 6, 0), size: new THREE.Vector3(7, 5, 7), color: STRIPES[0] });
  // Crown at the very top, and the dark load ring around the throat.
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 0.35, 16), mat(STRIPES[0], { studs: 0 }));
  crown.position.y = 17.7;
  envelope.add(crown);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.38, 0.09, 6, 20).rotateX(Math.PI / 2), mat(0x3a2a1a, { studs: 0 }));
  envelope.add(ring);
  // Load tapes down the seams (Lego look: a little chunkier, like studded bars).
  if (lego) {
    for (let i = 0; i < 6; i++) {
      const a = i * ((Math.PI * 2) / 6);
      const tape = new THREE.Mesh(new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p.x + 0.04, p.y)), 1, a - 0.012, 0.024), mat(0xf2f2f2, { studs: 0, side: THREE.DoubleSide }));
      envelope.add(tape);
    }
  }

  // ---- ropes from the basket's corners up to the throat
  const rope = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const cx = Math.sign(Math.cos(a)) * 1.15; // the nearest basket corner
    const cz = Math.sign(Math.sin(a)) * 1.15;
    rope.push(cx, 1.4, cz, Math.cos(a) * 1.35, THROAT, Math.sin(a) * 1.35);
  }
  const ropes = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(rope, 3)), new THREE.LineBasicMaterial({ color: 0x3a2a1a }));
  g.add(ropes);

  // ---- turbo: the usual twin rockets, strapped to the basket's sides
  const updateBoosters = createBoosters(g, mat, { x: 1.55, y: 0.7, z: 0.2, scale: 0.75 });

  let burn = 0.3;
  let flick = 0;
  /**
   * Each frame (the game calls this with the flight model; a friend's balloon
   * gets no flight model): the flame grows with the burner, and the envelope
   * glows from inside while it burns, which shows at night.
   */
  function animate(flight, dt) {
    const want = flight?.burner ?? 0.35;
    burn += (want - burn) * (1 - Math.exp(-(dt || 0.016) * 8));
    flick += (dt || 0.016) * 31;
    const f = 1 + 0.12 * Math.sin(flick) + 0.07 * Math.sin(flick * 2.7 + 1);
    const len = (0.25 + 5.2 * burn) * f;
    const wide = 0.18 + 0.42 * burn;
    outer.scale.set(wide, len, wide);
    inner.scale.set(wide * 0.5, len * 0.7, wide * 0.5);
    outer.visible = inner.visible = burn > 0.08;
    const glow = Math.max(0, burn - 0.2) * 0.45;
    for (const m of Object.values(mats)) if (m.side === THREE.DoubleSide && m.emissive) m.emissive.setRGB(glow, glow * 0.55, glow * 0.15);
  }
  animate(null, 0);

  return {
    group: g,
    kind: 'balloon',
    balloon: true,
    level: true, // sits level on its basket (no tail-dragger tilt)
    noProp: true,
    camK: 1.9, // the chase camera stands farther back...
    camLookY: 9, // ...and looks up toward the middle of the balloon
    animate,
    flame: outer, // (the flame's outer cone: its height shows how hard the burner is going)
    updateBoosters,
    get burner() { return burn; },
    floats: new THREE.Group(), // (the basket floats on water by itself)
    wheels: [],
    controls: { ailerons: [new THREE.Group(), new THREE.Group()], elevator: new THREE.Group(), rudder: new THREE.Group() },
    parts,
    cockpitHidden: [],
    cockpitEye: new THREE.Vector3(0, 2.05, -0.55), // standing in the basket, looking out over the rim
    gearHeight: GEAR,
    radius: 7.5,
    fabric,
  };
}

void LEGO;

/** How the balloon flies. Same controls and API as the copter (HeliFlight), its own physics. */
export class BalloonFlight extends HeliFlight {
  constructor(world, model) {
    super(world, model);
    this.balloon = true;
    // The wind: the same in every game in a city, turning with height.
    let h = 0;
    for (const ch of String(world.data?.name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    this.windBase = ((h % 628) / 100);
    this.t = 0;
  }

  /** Start beside the start of the runway: the helipad is too tight for an envelope 15 m wide. */
  reset() {
    const rw = this.world.runway;
    const back = rw.length / 2 - 90;
    const side = rw.width / 2 + 30;
    this.pos.set(rw.x - rw.fx * back - rw.fz * side, 0, rw.z - rw.fz * back + rw.fx * side);
    this.yaw = -THREE.MathUtils.degToRad(rw.heading);
    this.pos.y = this.world.heightAt(this.pos.x, this.pos.z) + this.plane.gearHeight;
    this._commonReset();
    this.onGround = true;
  }

  _commonReset() {
    super._commonReset();
    this.floats = true;
    this.burner = 0.3;
    this.wind = new THREE.Vector2();
  }

  /** Wind at a height above the ground: a gentle breeze near the ground, stronger and turning higher up. */
  windAt(agl) {
    const a = this.windBase + agl / 260 + Math.sin(this.t / 90) * 0.3;
    const s = Math.min(7, 1.2 + agl / 110);
    return this._w.set(Math.cos(a) * s, Math.sin(a) * s);
  }

  get _w() {
    return (this.__w ||= new THREE.Vector2());
  }

  update(dt, input) {
    if (this.crashed) return;
    this.t += dt;
    const c = this.ctrl;
    const k = 1 - Math.exp(-dt * 4);
    c.pitch += (input.pitch - c.pitch) * k;
    c.roll += (input.roll - c.roll) * k;
    c.yaw += (input.yaw - c.yaw) * k;
    // The steering fan: set and left, like the copter's speed.
    if (input.throttleSet !== undefined) this.throttle = input.throttleSet;
    else this.throttle = THREE.MathUtils.clamp(this.throttle + input.throttle * dt * 0.6, 0, 1);
    if (input.brake) this.throttle = Math.max(0, this.throttle - dt * 1.2);
    this.turboNow += (this.turbo - this.turboNow) * (1 - Math.exp(-dt * 1.5));
    // The burner: the lift control. Up burns hard, centred holds the height with
    // a steady flame, down lets it cool to the pilot light and vents.
    const climb = THREE.MathUtils.clamp(input.liftSet !== undefined ? input.liftSet : c.pitch, -1, 1);
    const wantBurn = climb > 0.05 ? 0.45 + 0.55 * climb : climb < -0.05 ? 0.04 : 0.24;
    this.burner += (wantBurn - this.burner) * (1 - Math.exp(-dt * 3));

    const ground = this.world.heightAt(this.pos.x, this.pos.z);
    const agl = this.pos.y - this.plane.gearHeight - ground;
    // Up and down: slow and floaty, as a balloon is.
    let wantVy = climb * (climb > 0 ? 6.5 : 5) * (0.75 + 0.25 * this.turboNow);
    if (agl > 1400) wantVy = Math.min(wantVy, (1500 - agl) * 0.05); // it can't climb for ever
    if (agl < 18) wantVy = Math.max(wantVy, -(0.7 + agl * 0.3)); // a soft landing near the ground
    this.vel.y += (wantVy - this.vel.y) * (1 - Math.exp(-dt * 0.9));
    if (this.onGround && this.vel.y < 0) this.vel.y = 0;

    // Turning (the turning vents) and the push of the fan and the wind.
    this.yaw -= c.roll * 0.5 * dt;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const fan = (this.onGround ? 0 : 1) * this.throttle * 11 * this.turboNow;
    const side = c.yaw * 3;
    const w = this.onGround ? this._w.set(0, 0) : this.windAt(agl);
    this.wind.copy(w);
    const tx = fx * fan - fz * side + w.x;
    const tz = fz * fan + fx * side + w.y;
    const ax = (tx - this.vel.x) * (1 - Math.exp(-dt * 0.55));
    const az = (tz - this.vel.z) * (1 - Math.exp(-dt * 0.55));
    this.vel.x += ax;
    this.vel.z += az;
    // The basket sways a little.
    const tk = 1 - Math.exp(-dt * 2);
    this.tilt.pitch += (THREE.MathUtils.clamp(-(ax * fx + az * fz) / Math.max(dt, 1e-3) * 0.02, -0.06, 0.06) - this.tilt.pitch) * tk;
    this.tilt.roll += ((this.onGround ? 0 : Math.sin(this.t * 0.8) * 0.015 - c.roll * 0.03) - this.tilt.roll) * tk;
    this._updateQuat();
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.verticalSpeed = this.vel.y;

    // Move in small steps; the basket and the big envelope can both hit things.
    const steps = Math.max(1, Math.ceil((this.vel.length() * dt) / 2));
    const env = new THREE.Vector3();
    for (let i = 0; i < steps; i++) {
      this.pos.addScaledVector(this.vel, dt / steps);
      if (this.world.hitsObstacle(this.pos, 1.4)) return this.crash('The basket hit a building!');
      env.copy(this.pos).y += THROAT + 10;
      if (this.world.hitsObstacle(env, 6.5)) return this.crash('Popped! The balloon hit a building 🎈');
    }

    // Ground and water: the basket comes down gently anywhere (it floats on water).
    const g2 = this.world.heightAt(this.pos.x, this.pos.z);
    const minY = g2 + this.plane.gearHeight;
    if (this.pos.y <= minY) {
      if (!this.onGround && this.vel.y < -8) return this.crash('Crash landing! The basket came down too hard');
      this.onWater = this.world.isWater(this.pos.x, this.pos.z);
      this.pos.y = minY;
      this.onGround = true;
      this.vel.y = Math.max(0, this.vel.y);
      this.vel.x *= Math.exp(-dt * 4);
      this.vel.z *= Math.exp(-dt * 4);
    } else if (this.onGround && this.pos.y > minY + 0.3) {
      if (this.vel.y <= 0.05) this.pos.y = minY;
      else {
        this.onGround = false;
        this.onWater = false;
      }
    }
  }
}

import * as THREE from 'three';
import { LEGO, legoMaterial } from './lego.js';
import { createBoosters } from './boosters.js';

// Robot mode: the vehicle unfolds into a 13 m robot that walks, jumps, smashes
// buildings and throws things. The robot is built in the vehicle's colors and
// wears its parts (the plane's wings and propeller, the copter's rotor).

const PALETTES = {
  plane: { main: LEGO.white, accent: LEGO.yellow, dark: LEGO.black, trim: LEGO.red, glass: LEGO.transBlue },
  heli: { main: LEGO.white, accent: 0xf0368f, dark: 0x6a2fc9, trim: 0x8ee3ef, glass: LEGO.transBlue },
};
export const ROBOT_HEIGHT = 13;

/** Build the robot for a vehicle kind ('plane' or 'heli'). Origin at the feet, facing -Z. */
export function createRobot(kind) {
  const pal = PALETTES[kind] || PALETTES.plane;
  const group = new THREE.Group();
  const mats = {};
  const mat = (hex, opts = {}) => (mats[hex] ||= legoMaterial({ color: hex, studs: 1.2, ...opts }));
  const box = (parent, w, h, d, hex, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(hex));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const body = new THREE.Group(); // everything above the feet, so it can bob and lean
  group.add(body);

  // Legs, pivoting at the hips.
  const legs = [-1, 1].map((sx) => {
    const leg = new THREE.Group();
    leg.position.set(sx * 1.5, 6.6, 0);
    box(leg, 1.5, 2.8, 1.6, pal.dark, 0, -1.4, 0);
    box(leg, 1.9, 3.0, 1.9, pal.main, 0, -4.2, 0);
    box(leg, 2.0, 0.5, 2.0, pal.accent, 0, -2.8, 0); // knee band
    box(leg, 2.2, 1.0, 3.4, pal.trim, 0, -6.1, -0.5); // foot
    body.add(leg);
    return leg;
  });
  box(body, 4.6, 1.2, 2.2, pal.dark, 0, 7.0, 0); // hips
  box(body, 2.4, 1.0, 2.0, pal.accent, 0, 7.9, 0); // waist

  // Torso with the cockpit glass as a chest plate.
  const torso = new THREE.Group();
  torso.position.set(0, 8.4, 0);
  body.add(torso);
  box(torso, 5.4, 3.4, 2.8, pal.main, 0, 1.7, 0);
  box(torso, 5.6, 0.6, 3.0, pal.accent, 0, 3.1, 0);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.6, 0.3),
    new THREE.MeshPhongMaterial({ color: pal.glass, transparent: true, opacity: 0.7, shininess: 90 }));
  glass.position.set(0, 2.0, -1.5);
  torso.add(glass);
  box(torso, 3.6, 0.9, 0.4, pal.trim, 0, 0.6, -1.45);

  // Head with a glowing visor.
  const head = new THREE.Group();
  head.position.set(0, 3.7, 0);
  torso.add(head);
  box(head, 1.9, 1.7, 1.9, pal.main, 0, 0.85, 0);
  box(head, 2.1, 0.5, 2.1, pal.accent, 0, 1.75, 0);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.4, 0.2), new THREE.MeshBasicMaterial({ color: 0x4fd8ff }));
  visor.position.set(0, 1.0, -0.98);
  head.add(visor);
  for (const sx of [-1, 1]) box(head, 0.25, 1.3, 0.25, pal.trim, sx * 1.05, 1.5, 0);

  // Arms, pivoting at the shoulders.
  const arms = [-1, 1].map((sx) => {
    const arm = new THREE.Group();
    arm.position.set(sx * 3.6, 2.7, 0);
    box(arm, 1.9, 1.9, 2.2, pal.accent, 0, 0, 0); // shoulder
    box(arm, 1.3, 2.4, 1.3, pal.dark, 0, -1.9, 0);
    box(arm, 1.6, 2.4, 1.6, pal.main, 0, -4.1, 0);
    box(arm, 1.8, 1.5, 1.8, pal.trim, 0, -5.9, 0); // fist
    torso.add(arm);
    return arm;
  });

  // The vehicle's parts, worn on the back and chest.
  let spinner;
  if (kind === 'heli') {
    const boom = box(torso, 0.7, 0.7, 4.2, pal.accent, 0, 2.6, 3.2);
    boom.rotation.x = 0.5;
    spinner = new THREE.Group();
    spinner.position.set(0, 5.2, 2.4);
    box(spinner, 11, 0.15, 0.7, pal.accent, 0, 0, 0);
    box(spinner, 0.7, 0.15, 11, pal.accent, 0, 0, 0);
    box(torso, 0.4, 1.6, 0.4, pal.dark, 0, 4.3, 2.4);
    torso.add(spinner);
    spinner.userData.axis = 'y';
  } else {
    for (const sx of [-1, 1]) {
      const wing = box(torso, 6.5, 0.3, 2.4, pal.accent, sx * 3.6, 3.0, 1.9);
      wing.rotation.z = sx * 0.9;
      wing.rotation.y = sx * -0.25;
    }
    box(torso, 0.3, 2.6, 1.6, pal.trim, 0, 3.6, 2.2); // tail fin
    spinner = new THREE.Group();
    spinner.position.set(0, 0.6, -1.75);
    box(spinner, 0.3, 2.8, 0.15, pal.dark, 0, 0, 0);
    box(spinner, 2.8, 0.3, 0.15, pal.dark, 0, 0, 0);
    torso.add(spinner);
    spinner.userData.axis = 'z';
  }

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
    spinner.rotation[spinner.userData.axis] += dt * 18;
  }

  const api = {
    group,
    body,
    onStep: null,
    updateBoosters,
    kind: 'robot',
    hands,
    animate,
    punch: () => (punch = 1),
    cockpitHidden: [head],
    cockpitEye: new THREE.Vector3(0, ROBOT_HEIGHT - 0.6, -1.4),
    gearHeight: 0,
    radius: 2.4,
  };
  return api;
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
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
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
    this.onWater = w.isWater(this.pos.x, this.pos.z) && this.pos.y - w.heightAt(this.pos.x, this.pos.z) < 1;
    // Jets give running speed in the air and much better steering, so holding
    // jump turns the robot into something that flies.
    const jets = !this.onGround && input.brake;
    const top = ((input.run ?? input.throttle > 0) || jets ? RUN : WALK) * (this.onWater ? 0.6 : 1) * this.turboNow; // T2X, T3X: rocket-powered
    const f = this.forward;
    const r = this.right;
    const wantX = f.x * c.pitch * top + r.x * c.yaw * 12;
    const wantZ = f.z * c.pitch * top + r.z * c.yaw * 12;
    const grip = 1 - Math.exp(-dt * (this.onGround ? 7 : jets ? 4 : 1.2));
    this.vel.x += (wantX - this.vel.x) * grip;
    this.vel.z += (wantZ - this.vel.z) * grip;

    // Jump; holding the button keeps the jets burning for as long as it's held.
    // The climb rate eases toward JET_CLIMB (a tap is a hop, holding climbs, and
    // holding while falling cushions the landing) and fades out near the ceiling.
    if (input.brake && this.onGround) {
      this.vel.y = 24;
      this.onGround = false;
    }
    this.jetting = !this.onGround && input.brake;
    if (this.jetting) {
      const agl = this.pos.y - w.heightAt(this.pos.x, this.pos.z);
      const climb = (JET_CLIMB + 10 * (this.turboNow - 1)) * THREE.MathUtils.clamp((JET_CEILING - agl) / 100, -0.3, 1);
      this.vel.y += (climb - this.vel.y) * (1 - Math.exp(-dt * 2.5));
    } else if (!this.onGround) {
      this.vel.y = Math.max(-FALL_MAX, this.vel.y - GRAVITY * dt);
    }

    // Move in short steps; walls stop you (slide along them), roofs you can stand on.
    const dist = Math.hypot(this.vel.x, this.vel.z) * dt;
    const steps = Math.max(1, Math.ceil(dist / 1.5));
    const rad = this.plane.radius;
    // On the ground the robot never climbs onto things: anything in its way,
    // however low, is a wall to walk through (see below). Up on a roof, or
    // landing from a jump, low roofs can be stepped onto.
    const terrain = w.heightAt(this.pos.x, this.pos.z);
    const walking = this.onGround && this.pos.y - terrain < 1;
    const step = walking ? 0.3 : 2.5;
    const hit = (x, z) => w.blockedAt(x, z, this.pos.y, rad, ROBOT_HEIGHT, step);
    let inside = hit(this.pos.x, this.pos.z);
    if (inside && this.onRam?.(inside)) inside = hit(this.pos.x, this.pos.z); // standing in something: break it
    const stuck = !!inside; // a landmark around the robot: let it walk out
    for (let i = 0; i < steps; i++) {
      const nx = this.pos.x + (this.vel.x * dt) / steps;
      const nz = this.pos.z + (this.vel.z * dt) / steps;
      // Walking into a building knocks it down (onRam); only landmarks stop the robot.
      const c = stuck ? null : hit(nx, nz);
      if (c && this.onRam?.(c)) {
        this.vel.x *= 0.7;
        this.vel.z *= 0.7;
      }
      if (stuck || !hit(nx, nz)) {
        this.pos.x = nx;
        this.pos.z = nz;
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
    // Stay on the map.
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -w.halfX - 1400, w.halfX + 1400);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -w.halfZ - 1400, w.halfZ + 1400);

    // Head bump: flying up into a bridge deck or an arch stops at its underside.
    if (this.vel.y > 0) {
      const head = this.pos.y + ROBOT_HEIGHT;
      const roof = w.ceilingAt(this.pos.x, this.pos.z, head, head + this.vel.y * dt, rad * 0.5);
      if (roof !== null) {
        this.pos.y = roof - ROBOT_HEIGHT - 0.05;
        this.vel.y = 0;
      }
    }
    this.pos.y += this.vel.y * dt;
    const ground = walking ? w.heightAt(this.pos.x, this.pos.z)
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
      const hit = w.blockedAt(nx, nz, this.pos.y, rad, 4 * this.driving);
      if (hit && !this.onRam?.(hit)) {
        along *= -0.3; // a landmark: bounce off
        break;
      }
      if (hit) along *= 0.9;
      this.pos.x = nx;
      this.pos.z = nz;
    }
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -w.halfX - 1400, w.halfX + 1400);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -w.halfZ - 1400, w.halfZ + 1400);
    this.vel.set(f.x * along, 0, f.z * along);
    this.pos.y = w.heightAt(this.pos.x, this.pos.z);
    this.onGround = true;
    this.onWater = false;
    this.speed = Math.abs(along);
    this.verticalSpeed = 0;
  }

  // The flight models' API, for code that treats every vehicle alike.
  reset() {}
  resetAirborne() {}
}

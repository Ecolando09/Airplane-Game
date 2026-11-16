import * as THREE from 'three';

// Driving the Batmobile in car form. The same fields and methods the flight
// models have (pos, quat, vel, speed, throttle, ctrl, onGround, crashed,
// forward, right, up, heading, reset, resetAirborne, update, crash), so the
// camera, HUD, minimap, multiplayer and the rest treat it like any vehicle.
// The feel follows the robot's car (RobotWalk._drive): stick or W/S for gas
// and reverse, left and right steer, it follows the ground and bridge decks and
// stops at walls. It is fast (about 160 mph, more in turbo), the brake is a
// handbrake, it bounces off buildings (smashing is the robot's job) and it
// sinks in water.

const Y = new THREE.Vector3(0, 1, 0);
const TOP = 71.5; // m/s, about 160 mph
const REVERSE = 14;
const ACCEL = 12; // m/s² flat out (0 to 160 mph in about 7 s)
const BRAKE = 28; // handbrake
const COAST = 0.35; // rolling slow-down per second (fraction)

export class CarDrive {
  constructor(world, model) {
    this.world = world;
    this.plane = model;
    this.isCar = true;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.ctrl = { pitch: 0, roll: 0, yaw: 0 };
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this.reset();
  }

  /** At the start of the city's runway, like the planes. */
  reset() {
    const rw = this.world.runway;
    const back = rw.length / 2 - 70;
    this.pos.set(rw.x - rw.fx * back, 0, rw.z - rw.fz * back);
    this.yaw = -THREE.MathUtils.degToRad(rw.heading);
    this.quat.setFromAxisAngle(Y, this.yaw);
    this.pos.y = this._ground() + this.plane.gearHeight;
    this.speed = 0;
    this.along = 0;
    this.throttle = 0;
    this.vel.set(0, 0, 0);
    this.onGround = true;
    this.onWater = false;
    this.crashed = false;
    this.crashReason = '';
    this.verticalSpeed = 0;
    this.ctrl = { pitch: 0, roll: 0, yaw: 0 };
    this.barrel = null;
    this.floats = false;
    this.turbo ||= 1;
    this.turboNow = this.turbo;
  }

  /** (A car never starts in the air: the game uses the flying car for that.) */
  resetAirborne() {
    this.reset();
  }

  get forward() {
    return this._fwd.set(0, 0, -1).applyQuaternion(this.quat);
  }

  get right() {
    return this._right.set(1, 0, 0).applyQuaternion(this.quat);
  }

  get up() {
    return this._up.set(0, 1, 0).applyQuaternion(this.quat);
  }

  /** Heading in degrees, 0 = north, clockwise. */
  get heading() {
    const f = this.forward;
    return (THREE.MathUtils.radToDeg(Math.atan2(f.x, -f.z)) + 360) % 360;
  }

  /** Put it somewhere, facing yaw, with a speed (from the flying car or the robot). */
  place(pos, yaw, speed = 0) {
    this.reset();
    this.yaw = yaw;
    this.quat.setFromAxisAngle(Y, yaw);
    this.pos.set(pos.x, 0, pos.z);
    this.pos.y = this._ground(pos.y) + this.plane.gearHeight;
    this.along = speed;
    this.speed = Math.abs(speed);
    this.vel.copy(this.forward).multiplyScalar(speed);
  }

  _ground(y = this.pos.y) {
    const w = this.world;
    return w.deckAt?.(this.pos.x, this.pos.z, y) ?? w.groundAt(this.pos.x, this.pos.z);
  }

  barrelRoll() {
    return false;
  }

  crash(reason) {
    this.crashed = true;
    this.crashReason = reason;
    this.speed = 0;
    this.along = 0;
    this.vel.set(0, 0, 0);
  }

  update(dt, input) {
    if (this.crashed) return;
    const w = this.world;
    const c = this.ctrl;
    const k = 1 - Math.exp(-dt * 8);
    c.pitch += (input.pitch - c.pitch) * k;
    c.roll += (input.roll - c.roll) * k;
    this.turboNow += (this.turbo - this.turboNow) * (1 - Math.exp(-dt * 2));
    const top = TOP * (1 + 0.35 * (this.turboNow - 1));
    let along = this.along;
    const gas = c.pitch;
    if (input.brake) {
      along -= Math.sign(along) * Math.min(Math.abs(along), BRAKE * dt); // handbrake
    } else if (Math.abs(gas) > 0.05) {
      const want = gas > 0 ? gas * top : gas * REVERSE;
      const rate = ACCEL * (gas > 0 ? this.turboNow : 1) * dt;
      // Pushing against the way it rolls brakes first.
      along += THREE.MathUtils.clamp(want - along, -rate * (Math.sign(want) !== Math.sign(along) ? 2.2 : 1), rate);
    } else along *= Math.exp(-dt * COAST);
    this.throttle = Math.max(0, gas) * (input.brake ? 0 : 1);
    // Steering: sharp when slow, gentler at speed; reversing turns the other way.
    const steerRate = 1.7 / (1 + Math.abs(along) / 35);
    this.yaw -= c.roll * steerRate * THREE.MathUtils.clamp(along / 8, -1, 1) * dt;
    this.quat.setFromAxisAngle(Y, this.yaw);
    const f = this.forward;
    const rad = 2.2;
    const steps = Math.max(1, Math.ceil((Math.abs(along) * dt) / 1.5));
    this.bounced = null;
    for (let i = 0; i < steps; i++) {
      const nx = this.pos.x + (f.x * along * dt) / steps;
      const nz = this.pos.z + (f.z * along * dt) / steps;
      const y = this.pos.y - this.plane.gearHeight;
      const onDeck = w.deckAt?.(nx, nz, y) != null;
      const hit = onDeck ? null : w.blockedAt(nx, nz, y, rad, 3);
      if (hit) {
        this.bounced = hit; // bounces off: no smashing in the car
        along *= -0.3;
        break;
      }
      this.pos.x = nx;
      this.pos.z = nz;
    }
    const ex = w.halfX + 1400;
    const ez = w.halfZ + 1400;
    this.atEdge = Math.abs(this.pos.x) >= ex || Math.abs(this.pos.z) >= ez;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -ex, ex);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -ez, ez);
    this.along = along;
    this.vel.set(f.x * along, 0, f.z * along);
    const y0 = this.pos.y - this.plane.gearHeight;
    const deck = w.deckAt?.(this.pos.x, this.pos.z, y0);
    this.pos.y = (deck ?? w.groundAt(this.pos.x, this.pos.z)) + this.plane.gearHeight;
    this.onGround = true;
    this.speed = Math.abs(along);
    this.verticalSpeed = 0;
    // Water (and no bridge over it): it sinks.
    if (deck == null && w.isWater(this.pos.x, this.pos.z)) this.crash("Splash! The Batmobile can't swim. Take off first!");
  }
}

import * as THREE from 'three';

// Arcade flight model tuned to feel like a light propeller plane.
const THRUST = 7; // m/s² at full throttle
const DRAG = 0.00143; // top level speed ≈ 70 m/s (≈136 kt)
const STALL = 22; // m/s; below this the wings stop flying
const LIFT_RAMP = 10; // m/s above stall until the wings fully fly
const ROTATE = 27; // m/s; can lift off above this
const MAX_BANK = THREE.MathUtils.degToRad(60);
const MAX_PITCH = THREE.MathUtils.degToRad(35);
const G = 9.81;

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

export class Flight {
  constructor(world, plane) {
    this.world = world;
    this.plane = plane;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.speed = 0;
    this.throttle = 0;
    this.onGround = true;
    this.crashed = false;
    this.crashReason = '';
    this.verticalSpeed = 0;
    this.ctrl = { pitch: 0, roll: 0, yaw: 0 };
    this._tmpQ = new THREE.Quaternion();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this.reset();
  }

  /** Line up on runway 5 at Spartanburg Downtown Memorial Airport. */
  reset() {
    const rw = this.world.runway;
    const back = rw.length / 2 - 70;
    this.pos.set(rw.x - rw.fx * back, 0, rw.z - rw.fz * back);
    this.pos.y = this.world.heightAt(this.pos.x, this.pos.z) + this.plane.gearHeight;
    this.quat.setFromAxisAngle(Y, -THREE.MathUtils.degToRad(rw.heading));
    this.speed = 0;
    this.throttle = 0;
    this.vel.set(0, 0, 0);
    this.onGround = true;
    this.crashed = false;
    this.crashReason = '';
    this.ctrl = { pitch: 0, roll: 0, yaw: 0 };
    this.floats = false;
    this.onWater = false;
  }

  /** Start in the air above downtown, heading north-east. */
  resetAirborne() {
    this.reset();
    // 2 km south-west of Morgan Square, pointed at it.
    const sq = this.world.landmarks[0];
    const hdg = 40;
    const h = THREE.MathUtils.degToRad(hdg);
    this.pos.set(sq.x - Math.sin(h) * 2000, 0, sq.z + Math.cos(h) * 2000);
    this.pos.y = sq.y + 220;
    this.quat.setFromAxisAngle(Y, -h);
    this.speed = 55;
    this.throttle = 0.7;
    this.onGround = false;
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

  update(dt, input) {
    if (this.crashed) return;
    const c = this.ctrl;
    // Smooth the stick so keyboard input feels analog.
    const k = 1 - Math.exp(-dt * 6);
    c.pitch += (input.pitch - c.pitch) * k;
    c.roll += (input.roll - c.roll) * k;
    c.yaw += (input.yaw - c.yaw) * k;
    this.throttle = THREE.MathUtils.clamp(this.throttle + input.throttle * dt * 0.6, 0, 1);
    if (input.throttleSet !== undefined) this.throttle = input.throttleSet;

    const fwd = this.forward.clone();
    const right = this.right.clone();
    const auth = THREE.MathUtils.clamp(this.speed / 45, 0.15, 1); // control authority

    // ---- rotation
    // The stick commands a climb/dive angle (up to 35°); centered stick flies level.
    const pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
    let targetPitch = c.pitch * MAX_PITCH;
    const aglNow = this.pos.y - this.plane.gearHeight - this.world.heightAt(this.pos.x, this.pos.z);
    if (!this.onGround) {
      const lift = THREE.MathUtils.clamp((this.speed - STALL) / LIFT_RAMP, 0, 1);
      if (lift < 1) targetPitch = Math.min(targetPitch, -0.15 * (1 - lift)); // stall: nose drops
      // Auto-flare: just above the ground the nose comes up for a gentle touchdown.
      if (aglNow < 18) targetPitch = Math.max(targetPitch, -0.07 + (18 - aglNow) * 0.005);
    }
    let pitchRate = THREE.MathUtils.clamp((targetPitch - pitch) * 2.2, -1.1, 1.1) * auth;
    // The stick commands a bank angle (up to 60°); centered stick levels the wings.
    const bank = Math.asin(THREE.MathUtils.clamp(right.y, -1, 1)); // + = right wing up (left bank)
    const targetBank = -c.roll * MAX_BANK;
    let rollRate = THREE.MathUtils.clamp((targetBank - bank) * 3, -1.6, 1.6) * auth;
    let yawRate = -c.yaw * 0.45 * auth;

    if (this.onGround) {
      rollRate = 0;
      yawRate = -(c.yaw + c.roll) * 0.6 * Math.min(1, this.speed / 8); // nose-wheel steering
      if (this.speed < ROTATE * 0.85) pitchRate = Math.min(pitchRate, 0);
    }

    this._tmpQ.setFromAxisAngle(X, pitchRate * dt);
    this.quat.multiply(this._tmpQ);
    this._tmpQ.setFromAxisAngle(Z, rollRate * dt);
    this.quat.multiply(this._tmpQ);
    this._tmpQ.setFromAxisAngle(Y, yawRate * dt);
    this.quat.multiply(this._tmpQ);
    if (!this.onGround) {
      // Banked turn: the lift vector pulls the nose around.
      const turn = -Math.tan(THREE.MathUtils.clamp(bank, -1.3, 1.3)) * G / Math.max(this.speed, 20);
      this._tmpQ.setFromAxisAngle(Y, -turn * dt);
      this.quat.premultiply(this._tmpQ);
    }
    this.quat.normalize();

    // ---- speed
    const f = this.forward;
    let accel = this.throttle * THRUST - DRAG * this.speed * this.speed - G * f.y;
    if (this.onGround) accel -= input.brake ? 8 : 0.4;
    if (this.floats) accel -= 0.002 * this.speed * this.speed; // floats add drag
    this.speed = Math.max(0, this.speed + accel * dt);

    // ---- velocity: along the nose, plus sink when slow
    const lift = THREE.MathUtils.clamp((this.speed - STALL) / LIFT_RAMP, 0, 1);
    this.vel.copy(f).multiplyScalar(this.speed);
    if (!this.onGround) this.vel.y -= (1 - lift) * 8;

    // Landing assist: close to the ground with the wings roughly level, the
    // plane floats on a cushion of air so touchdowns are gentle.
    const bankNow = Math.abs(Math.asin(THREE.MathUtils.clamp(this.right.y, -1, 1)));
    const agl = this.pos.y - this.plane.gearHeight - this.world.heightAt(this.pos.x, this.pos.z);
    if (!this.onGround && agl < 15 && bankNow < 0.6 && f.y > -0.35) {
      this.vel.y = Math.max(this.vel.y, -(1.2 + agl * 0.3));
    }
    this.verticalSpeed = this.vel.y;
    this.pos.addScaledVector(this.vel, dt);

    // ---- ground contact
    const ground = this.world.heightAt(this.pos.x, this.pos.z);
    const minY = ground + this.plane.gearHeight;
    if (this.pos.y <= minY) {
      const pitchDeg = THREE.MathUtils.radToDeg(Math.asin(f.y));
      const bankDeg = Math.abs(THREE.MathUtils.radToDeg(bank));
      if (!this.onGround && (this.vel.y < -9 || bankDeg > 35 || pitchDeg < -20)) {
        return this.crash(
          pitchDeg < -20 || this.vel.y < -15 ? 'Crashed into the ground!'
            : bankDeg > 35 ? 'Wing hit the ground!' : 'Landed too hard!'
        );
      }
      this.onWater = this.world.isWater(this.pos.x, this.pos.z);
      if (this.onWater && !this.floats) {
        return this.crash('Splash! Press B for floats before landing on water.');
      }
      this.pos.y = minY;
      if (!this.onGround) this.onGround = true;
      // Level wings and keep the nose from digging in.
      const yaw = Math.atan2(-f.x, -f.z);
      const keepPitch = Math.max(0, Math.asin(f.y));
      this.quat.setFromEuler(new THREE.Euler(keepPitch, yaw, 0, 'YXZ'));
      if (keepPitch > 0) this.quat.multiply(this._tmpQ.setFromAxisAngle(X, -Math.min(keepPitch, dt * 0.5)));
    } else if (this.onGround && this.pos.y > minY + 0.5) {
      this.onGround = false;
    }
    if (!this.onGround) this.onWater = false;
    if (this.onGround && this.onWater) {
      this.speed = Math.max(0, this.speed - 3 * dt); // water drag
    } else if (this.onGround && this.speed > 15 && !this.world.isOnRunway(this.pos.x, this.pos.z)) {
      // Rough grass slows you down.
      this.speed = Math.max(0, this.speed - 6 * dt);
    }

    if (this.world.hitsObstacle(this.pos, this.plane.radius * 0.8)) {
      return this.crash('Crashed into the city!');
    }
  }

  crash(reason) {
    this.crashed = true;
    this.crashReason = reason;
    this.throttle = 0;
  }
}

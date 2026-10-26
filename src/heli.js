import * as THREE from 'three';
import { LEGO, legoMaterial, isLego } from './lego.js';

/**
 * Ghost-Spider's helicopter: white rounded body with magenta spider-web trim,
 * a lavender canopy frame, pink rotor blades on a cyan hub, a cyan shrouded tail
 * rotor with pink tail fins, and four pink spider-leg feet for landing gear.
 * Nose points toward -Z; origin at the center of the body.
 */
const PINK = 0xf0368f;
const CYAN = 0x8ee3ef;
const PURPLE = 0x6a2fc9;
const SKID = 2.7; // origin height above the ground when standing on its feet

export function createGhostSpiderHeli() {
  const heli = new THREE.Group();
  const parts = [];
  const real = !isLego();
  const cache = new Map();
  const mat = (color, extra = {}) => {
    const key = color + JSON.stringify(extra);
    if (!cache.has(key)) {
      cache.set(key, real
        ? new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.05, ...extra })
        : legoMaterial({ color, ...extra }));
    }
    return cache.get(key);
  };
  const add = (mesh, color, size) => {
    mesh.castShadow = true;
    heli.add(mesh);
    parts.push({ color, size: size || new THREE.Vector3(1, 1, 1), pos: mesh.position.clone() });
    return mesh;
  };

  // Body: a rounded pod, slightly flattened.
  const body = add(new THREE.Mesh(new THREE.SphereGeometry(2.3, 32, 24), mat(LEGO.white)), LEGO.white, new THREE.Vector3(3, 2.5, 4));
  body.scale.set(1, 0.95, 1.55);
  // Canopy: tinted bubble at the front with a purple frame.
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(1.75, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color: 0x7fd4e8, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.55 })
  );
  canopy.rotation.x = -Math.PI / 2.4;
  canopy.position.set(0, 0.55, -2.2);
  heli.add(canopy);
  const frame = add(new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.17, 10, 32, Math.PI), mat(PURPLE)), PURPLE);
  frame.position.set(0, 0.55, -2.15);
  frame.rotation.x = -0.35;
  // Magenta oval "web" outline on each side, plus web lines over the body.
  for (const sx of [-1, 1]) {
    const oval = add(new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.11, 8, 36), mat(PINK)), PINK);
    oval.scale.set(1.35, 0.85, 1);
    oval.rotation.y = Math.PI / 2;
    oval.position.set(sx * 2.15, -0.15, 0.4);
    // Cyan engine intake on each side of the rotor mast
    const intake = add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 1.3, 16).rotateX(Math.PI / 2), mat(CYAN)), CYAN);
    intake.position.set(sx * 0.9, 1.75, 0.6);
  }
  for (let i = 0; i < 5; i++) {
    const web = new THREE.Mesh(new THREE.TorusGeometry(2.33 - Math.abs(i - 2) * 0.12, 0.05, 6, 40, Math.PI), mat(PINK));
    web.rotation.y = Math.PI / 2;
    web.scale.set(1.55, 0.95, 1);
    web.rotation.z = -0.25 + i * 0.12;
    web.position.set(0, 0.05, 0.6 + (i - 2) * 0.55);
    heli.add(web);
  }

  // Tail boom tapering back to a shrouded (fenestron) tail rotor.
  const boom = add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.75, 5.2, 16).rotateX(Math.PI / 2), mat(LEGO.white)), LEGO.white);
  boom.position.set(0, 0.45, 5.4);
  const shroud = add(new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.32, 12, 28), mat(CYAN)), CYAN);
  shroud.rotation.y = Math.PI / 2;
  shroud.position.set(0, 0.75, 8.1);
  const tailRotor = new THREE.Group();
  tailRotor.position.copy(shroud.position);
  for (let i = 0; i < 5; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.85, 0.22), mat(LEGO.blue));
    blade.position.y = 0.42;
    const arm = new THREE.Group();
    arm.rotation.x = (i * Math.PI * 2) / 5;
    arm.add(blade);
    tailRotor.add(arm);
  }
  heli.add(tailRotor);
  // Pink V tail fins
  for (const sx of [-1, 1]) {
    const fin = add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.9, 0.75), mat(PINK)), PINK);
    fin.position.set(sx * 0.5, 1.85, 8.0);
    fin.rotation.z = sx * 0.5;
    fin.rotation.x = -0.25;
  }

  // Main rotor: cyan hub, two long pink blades with a slight upward V.
  const mast = add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.9, 12), mat(PURPLE)), PURPLE);
  mast.position.set(0, 2.45, 0.2);
  const rotor = new THREE.Group();
  rotor.position.set(0, 2.95, 0.2);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), mat(CYAN));
  rotor.add(hub);
  for (const sx of [-1, 1]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.1, 0.55), mat(PINK));
    blade.position.x = sx * 3.0;
    blade.rotation.z = sx * 0.08;
    rotor.add(blade);
  }
  heli.add(rotor);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(5.9, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: PINK, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
  );
  rotor.add(disc);

  // Four pink spider-leg feet.
  const legs = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const upper = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.6, 6, 12), mat(PINK)), PINK);
    upper.position.set(sx * 1.75, -1.25, sz * 1.5);
    upper.rotation.z = sx * 0.6;
    const foot = add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), mat(PINK)), PINK);
    foot.scale.set(1, 0.85, 1.4);
    foot.position.set(sx * 2.25, -SKID + 0.36, sz * 1.5);
    legs.push(upper, foot);
  }

  // Floats (B key): two white pontoons with pink stripes.
  const floats = new THREE.Group();
  heli.add(floats);
  for (const sx of [-1, 1]) {
    const pont = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 5.2, 8, 16).rotateX(Math.PI / 2), mat(LEGO.white));
    pont.position.set(sx * 2.3, -SKID + 0.55, 0);
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.57, 0.06, 6, 20), mat(PINK));
    stripe.position.copy(pont.position);
    floats.add(pont, stripe);
  }
  floats.visible = false;
  floats.scale.setScalar(0.001);

  /** Spin the rotors; tilt is handled by the flight model. */
  function animate(flight, dt) {
    const spin = 18 + flight.throttle * 20;
    rotor.rotation.y += spin * dt;
    tailRotor.rotation.x += spin * 1.6 * dt;
    disc.material.opacity = flight.onGround ? 0.04 : 0.1;
  }

  return {
    group: heli,
    kind: 'heli',
    propeller: rotor,
    propDisc: disc,
    parts,
    floats,
    wheels: legs,
    animate,
    updateBoosters() {},
    cockpitHidden: [canopy, frame],
    cockpitEye: new THREE.Vector3(0, 0.9, -1.7),
    gearHeight: SKID,
    radius: 3.2,
  };
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/**
 * Arcade helicopter flight. Same interface as Flight so the rest of the game
 * (HUD, camera, crash, floats, turbo) works unchanged.
 *   joystick left/right (A/D)         -> steer (turn)
 *   throttle (Shift/Ctrl, slider)     -> forward speed; stays where you leave it
 *   lift (W/S held, or LIFT slider)   -> climb / descend; centered holds height
 *   rudder (Q/E)                      -> slide sideways
 *   brake (Space)                     -> wind the throttle back to a stop
 */
export class HeliFlight {
  constructor(world, heli) {
    this.world = world;
    this.plane = heli;
    this.canStall = false;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.tilt = { pitch: 0, roll: 0 };
    this.turbo = 1;
    this.turboNow = 1;
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this.reset();
  }

  /** Start on the city's hospital helipad (or the runway if there isn't one), facing downtown. */
  reset() {
    const hp = this.world.data.helipad;
    const rw = this.world.runway;
    if (hp) {
      const sq = this.world.landmarks[0];
      this.pos.set(hp.x, 0, hp.z);
      this.yaw = Math.atan2(-(sq.x - hp.x), -(sq.z - hp.z));
    } else {
      const back = rw.length / 2 - 70;
      this.pos.set(rw.x - rw.fx * back, 0, rw.z - rw.fz * back);
      this.yaw = -THREE.MathUtils.degToRad(rw.heading);
    }
    this.pos.y = this.world.heightAt(this.pos.x, this.pos.z) + this.plane.gearHeight;
    this._commonReset();
    this.onGround = true;
  }

  resetAirborne() {
    const sq = this.world.landmarks[0];
    const h = THREE.MathUtils.degToRad(40);
    this.pos.set(sq.x - Math.sin(h) * 1500, sq.y + 160, sq.z + Math.cos(h) * 1500);
    this.yaw = -h;
    this._commonReset();
    this.onGround = false;
  }

  _commonReset() {
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.verticalSpeed = 0;
    this.throttle = 0;
    this.crashed = false;
    this.crashReason = '';
    this.ctrl = { pitch: 0, roll: 0, yaw: 0 };
    this.tilt = { pitch: 0, roll: 0 };
    this.floats = false;
    this.onWater = false;
    this._updateQuat();
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

  get heading() {
    return ((THREE.MathUtils.radToDeg(-this.yaw) % 360) + 360) % 360;
  }

  _updateQuat() {
    const q = new THREE.Quaternion().setFromAxisAngle(Y, this.yaw);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(X, this.tilt.pitch));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(Z, this.tilt.roll));
    this.quat.copy(q);
  }

  update(dt, input) {
    if (this.crashed) return;
    const c = this.ctrl;
    const k = 1 - Math.exp(-dt * 5);
    c.pitch += (input.pitch - c.pitch) * k;
    c.roll += (input.roll - c.roll) * k;
    c.yaw += (input.yaw - c.yaw) * k;

    // Throttle sets forward speed and stays where it is left (Shift/Ctrl nudge it,
    // a slider sets it directly). Brake winds it back to a stop.
    if (input.throttleSet !== undefined) this.throttle = input.throttleSet;
    else this.throttle = THREE.MathUtils.clamp(this.throttle + input.throttle * dt * 0.6, 0, 1);
    if (input.brake) this.throttle = Math.max(0, this.throttle - dt * 1.2);
    // Lift: the LIFT slider (touch / phone controller) or W/S held; centered holds height.
    const climb = input.liftSet !== undefined ? input.liftSet : c.pitch;
    this.turboNow += (this.turbo - this.turboNow) * (1 - Math.exp(-dt * 1.5));

    // Steering: the joystick (or A/D) turns, a little faster when slow.
    const turnRate = 1.1 / (1 + this.speed / 60);
    this.yaw -= c.roll * turnRate * dt;

    // Target velocity in the helicopter's heading frame.
    const maxFwd = 38 * this.turboNow;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = -fz;
    const rz = fx;
    const wantF = (this.onGround ? 0.15 : 1) * this.throttle * maxFwd;
    const wantS = c.yaw * 14;
    const tx = fx * wantF + rx * wantS;
    const tz = fz * wantF + rz * wantS;
    const accel = 1 - Math.exp(-dt * (0.9 + 0.4 * this.turboNow));
    const ax = (tx - this.vel.x) * accel;
    const az = (tz - this.vel.z) * accel;
    this.vel.x += ax;
    this.vel.z += az;
    let wantVy = climb * 11;
    // Landing cushion: close to the ground the descent slows down by itself.
    const agl = this.pos.y - this.plane.gearHeight - this.world.heightAt(this.pos.x, this.pos.z);
    if (agl < 25) wantVy = Math.max(wantVy, -(1.2 + agl * 0.35));
    this.vel.y += (wantVy - this.vel.y) * (1 - Math.exp(-dt * 2.5));
    if (this.onGround && this.vel.y < 0) this.vel.y = 0;

    // Tilt the body into the motion: nose down when speeding up, bank into turns.
    const fwdAcc = (ax * fx + az * fz) / Math.max(dt, 1e-3);
    const sideAcc = (ax * rx + az * rz) / Math.max(dt, 1e-3);
    const tk = 1 - Math.exp(-dt * 4);
    const wantPitch = this.onGround ? 0 : THREE.MathUtils.clamp(-fwdAcc * 0.035 - (wantF / maxFwd) * 0.12, -0.45, 0.35);
    const wantRoll = this.onGround ? 0 : THREE.MathUtils.clamp(-sideAcc * 0.035 + c.roll * -0.25 * Math.min(1, this.speed / 20), -0.5, 0.5);
    this.tilt.pitch += (wantPitch - this.tilt.pitch) * tk;
    this.tilt.roll += (wantRoll - this.tilt.roll) * tk;
    this._updateQuat();

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.verticalSpeed = this.vel.y;

    // Move in small steps so fast flight can't skip through buildings.
    const steps = Math.max(1, Math.ceil((this.vel.length() * dt) / 3));
    for (let i = 0; i < steps; i++) {
      this.pos.addScaledVector(this.vel, dt / steps);
      if (this.world.hitsObstacle(this.pos, this.plane.radius * 0.8)) return this.crash('Crashed into the city!');
    }

    // Ground: land gently anywhere flat-ish; water needs floats.
    const ground = this.world.heightAt(this.pos.x, this.pos.z);
    const minY = ground + this.plane.gearHeight;
    if (this.pos.y <= minY) {
      if (!this.onGround && this.vel.y < -8) return this.crash('Landed too hard!');
      if (!this.onGround && this.speed > 30) return this.crash('Skidded into the ground!');
      this.onWater = this.world.isWater(this.pos.x, this.pos.z);
      if (this.onWater && !this.floats) return this.crash('Splash! Press B for floats before landing on water.');
      this.pos.y = minY;
      this.onGround = true;
      this.vel.y = Math.max(0, this.vel.y);
      // Friction while sitting on the ground.
      this.vel.x *= Math.exp(-dt * 3);
      this.vel.z *= Math.exp(-dt * 3);
    } else if (this.onGround && this.pos.y > minY + 0.3) {
      this.onGround = false;
      this.onWater = false;
    }
  }

  crash(reason) {
    this.crashed = true;
    this.crashReason = reason;
    this.throttle = 0;
  }
}

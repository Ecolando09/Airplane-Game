import * as THREE from 'three';
import { legoMaterial } from './lego.js';
import { ROBOT_HEIGHT } from './robot.js';

// What the robot does to the city: punching buildings down, stomping, kicking
// and throwing loose objects and cars, and the flying bricks that follow.

const BRICKS = 500;
const REACH = 10; // meters around the fist that a punch breaks
const GRAB = 9; // meters from the robot an object can be picked up

export class Rampage {
  /**
   * @param hooks.message(text)  short on-screen line
   * @param hooks.sound(kind)    'break' | 'load' | 'throw'
   * @param hooks.canBreak()     false where buildings can't be knocked down (Google 3D)
   */
  constructor(scene, world, traffic, props, hooks) {
    Object.assign(this, { scene, world, traffic, props, hooks });
    this.stats = { buildings: 0, trees: 0, cars: 0, thrown: 0 };
    this.held = null; // { item, mesh }
    this.flying = []; // thrown or kicked objects
    this.pending = []; // punches about to land

    // Flying bricks: one instanced mesh, recycled.
    this.bricks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), legoMaterial({ studs: 0.8 }), BRICKS);
    this.bricks.frustumCulled = false;
    this.bricks.castShadow = true;
    this.bricks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.brick = Array.from({ length: BRICKS }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), s: 1, spin: 0 }));
    this.nextBrick = 0;
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < BRICKS; i++) {
      this.bricks.setMatrixAt(i, m);
      this.bricks.setColorAt(i, new THREE.Color(0xffffff));
    }
    scene.add(this.bricks);
  }

  get total() {
    return this.stats.buildings + this.stats.trees + this.stats.cars;
  }

  // ---------------------------------------------------------------- bricks
  burst(x, y, z, size, hex, n) {
    const col = new THREE.Color(hex);
    for (let k = 0; k < n; k++) {
      const b = this.brick[this.nextBrick];
      this.bricks.setColorAt(this.nextBrick, col);
      this.nextBrick = (this.nextBrick + 1) % BRICKS;
      b.life = 2.2 + Math.random() * 1.5;
      b.s = 0.6 + Math.random() * Math.min(1.6, size * 0.06);
      b.p.set(x + (Math.random() - 0.5) * size, y + Math.random() * size * 0.8, z + (Math.random() - 0.5) * size);
      b.v.set((Math.random() - 0.5) * 30, 8 + Math.random() * 22, (Math.random() - 0.5) * 30);
      b.spin = Math.random() * 6;
    }
    this.bricks.instanceColor.needsUpdate = true;
  }

  _updateBricks(dt) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const axis = new THREE.Vector3(0.6, 0.5, 0.62).normalize();
    let any = false;
    this.brick.forEach((b, i) => {
      if (b.life <= 0) return;
      any = true;
      b.life -= dt;
      b.v.y -= 30 * dt;
      b.p.addScaledVector(b.v, dt);
      const g = this.world.heightAt(b.p.x, b.p.z) + b.s / 2;
      if (b.p.y < g) {
        b.p.y = g;
        b.v.y *= -0.35;
        b.v.x *= 0.6;
        b.v.z *= 0.6;
        b.spin *= 0.5;
      }
      const k = b.life <= 0 ? 0 : Math.min(1, b.life * 2) * b.s;
      this.bricks.setMatrixAt(i, m.compose(b.p, q.setFromAxisAngle(axis, b.spin * b.life), s.set(k, k * 0.6, k * 1.6)));
    });
    if (any) this.bricks.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- breaking
  /** Knock down one collider. Returns true if it broke. */
  wreck(c, dir) {
    const w = this.world;
    if (!this.hooks.canBreak()) return false;
    if (!w.destroy(c, dir)) return false;
    if (c.t === 'tree') {
      this.stats.trees++;
      this.burst(c.x, c.base + 6, c.z, 5, c.color, 5);
    } else {
      this.stats.buildings++;
      const size = c.t === 'box' ? Math.max(c.hw, c.hd) * 2 : Math.max(c.maxx - c.minx, c.maxz - c.minz);
      const n = Math.round(THREE.MathUtils.clamp(size * 0.5 + c.h * 0.3, 10, 60));
      for (let k = 0; k < 3; k++) this.burst(c.x, c.base + (c.h * k) / 3, c.z, Math.min(size, 40), k === 1 ? 0x9a9a94 : c.color, Math.ceil(n / 3));
    }
    return true;
  }

  /** Break everything within `r` of a point (a punch, a stomp, a thrown bus). */
  blast(x, y, z, r, from) {
    const w = this.world;
    let n = 0;
    let tough = false;
    for (const c of w.collidersNear(x, z, r)) {
      if (!w.inFootprint(c, x, z, r)) continue;
      if (c.top < y - r - 3 || (c.base ?? c.bottom ?? -1e9) > y + r) continue;
      const dir = { x: c.x - from.x || 1, z: c.z - from.z };
      if (this.wreck(c, dir)) n++;
      else if (c.t !== 'tree') tough = true;
    }
    for (const car of this.traffic.near(x, z, r + 3)) {
      this.traffic.remove(car);
      this.stats.cars++;
      const it = this.props.add('car', car.x, car.z, car.yaw, car.color);
      if (it) this._launch(it, new THREE.Vector3(car.x - from.x, 0, car.z - from.z).setLength(22).setY(18));
      n++;
    }
    for (const it of this.props.within(x, z, r)) {
      this._launch(it, new THREE.Vector3(it.x - from.x, 0, it.z - from.z).setLength(26).setY(16));
    }
    if (n) this.hooks.sound('break');
    else if (tough) this.hooks.message(this.hooks.canBreak() ? "That one's too tough to break!" : 'Buildings only break in the Lego and Realistic looks');
    return n;
  }

  // ---------------------------------------------------------------- actions
  /** Punch: the hit lands a moment after the swing starts. */
  smash(bot) {
    if (this.held || this.pending.length) return;
    bot.plane.punch();
    this.pending.push({ t: 0.16, bot });
  }

  /** Landing hard from a jump shakes down everything around the feet. */
  slam(bot, speed) {
    const r = THREE.MathUtils.clamp(speed * 0.3, 10, 22);
    this.burst(bot.pos.x, bot.pos.y, bot.pos.z, 8, 0xb5b0a4, 14);
    this.hooks.sound('break');
    return this.blast(bot.pos.x, bot.pos.y + 3, bot.pos.z, r, bot.pos);
  }

  /** Pick up the nearest loose object or car, or throw the one being carried. */
  grabOrThrow(bot) {
    if (this.held) return this._throw(bot);
    const f = bot.forward;
    const cx = bot.pos.x + f.x * 4;
    const cz = bot.pos.z + f.z * 4;
    let it = this.props.nearest(cx, cz, GRAB);
    const car = this.traffic.near(cx, cz, GRAB + 2)[0];
    if (car && (!it || Math.hypot(car.x - cx, car.z - cz) < Math.hypot(it.x - cx, it.z - cz))) {
      this.traffic.remove(car);
      it = this.props.add('car', car.x, car.z, car.yaw, car.color) || it;
    }
    if (!it || Math.abs(it.y - bot.pos.y) > ROBOT_HEIGHT) {
      this.hooks.message('Nothing to grab here. Look for cars, boats, boulders…');
      return false;
    }
    const mesh = this.props.lift(it);
    bot.plane.hands.add(mesh);
    mesh.position.set(0, 0, 0);
    this.held = { item: it, mesh };
    this.hooks.sound('load');
    const name = this.props.info(it.kind).name;
    this.hooks.message(`Picked up ${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}!`);
    return true;
  }

  _throw(bot) {
    const { item, mesh } = this.held;
    this.held = null;
    const f = bot.forward;
    this.scene.add(mesh);
    mesh.position.set(bot.pos.x + f.x * 1.2, bot.pos.y + ROBOT_HEIGHT + 2.2, bot.pos.z + f.z * 1.2);
    mesh.quaternion.copy(bot.quat);
    const v = new THREE.Vector3(f.x * 52 + bot.vel.x, 20 + Math.max(0, bot.vel.y), f.z * 52 + bot.vel.z);
    this.flying.push({ item, mesh, v, spin: 4, thrown: true, from: bot.pos.clone(), hits: 0 });
    this.stats.thrown++;
    this.hooks.sound('throw');
    return true;
  }

  /** Let go of whatever is carried (when changing back into the vehicle). */
  release(bot) {
    if (!this.held) return;
    const { item, mesh } = this.held;
    this.held = null;
    mesh.removeFromParent();
    const f = bot.forward;
    this.props.drop(item, bot.pos.x + f.x * 7, bot.pos.z + f.z * 7, bot.yaw);
  }

  _launch(it, v) {
    if (it.held) return;
    const mesh = this.props.lift(it);
    mesh.position.set(it.x, it.y + 1, it.z);
    mesh.rotation.y = it.yaw;
    this.scene.add(mesh);
    this.flying.push({ item: it, mesh, v, spin: 3 + Math.random() * 3, from: new THREE.Vector3(it.x, it.y, it.z), hits: 0 });
  }

  // ---------------------------------------------------------------- per frame
  update(dt, bot) {
    this._updateBricks(dt);
    // Punches landing.
    for (const p of [...this.pending]) {
      p.t -= dt;
      if (p.t > 0) continue;
      this.pending.splice(this.pending.indexOf(p), 1);
      const f = p.bot.forward;
      const x = p.bot.pos.x + f.x * 7;
      const z = p.bot.pos.z + f.z * 7;
      this.blast(x, p.bot.pos.y + 8, z, REACH, p.bot.pos);
    }
    if (bot) {
      // Walking through trees knocks them over; walking into things kicks them.
      if (bot.speed > 3 || !bot.onGround) {
        for (const c of this.world.collidersNear(bot.pos.x, bot.pos.z, 4)) {
          if (c.t === 'tree' && c.top > bot.pos.y && Math.hypot(c.x - bot.pos.x, c.z - bot.pos.z) < 4.5) {
            this.wreck(c, { x: bot.vel.x || 1, z: bot.vel.z });
          }
        }
      }
      if (bot.onGround && bot.speed > 6) {
        for (const it of this.props.within(bot.pos.x, bot.pos.z, 2.5)) {
          if (Math.abs(it.y - bot.pos.y) < 4) this._launch(it, new THREE.Vector3(bot.vel.x, 0, bot.vel.z).multiplyScalar(1.5).setY(10 + bot.speed * 0.3));
        }
        for (const car of this.traffic.near(bot.pos.x, bot.pos.z, 4.5)) {
          if (Math.abs(car.y - bot.pos.y) > 4) continue;
          this.traffic.remove(car);
          this.stats.cars++;
          const it = this.props.add('car', car.x, car.z, car.yaw, car.color);
          if (it) this._launch(it, new THREE.Vector3(bot.vel.x, 0, bot.vel.z).multiplyScalar(1.5).setY(14));
        }
      }
    }
    // Things in the air.
    const w = this.world;
    for (const o of [...this.flying]) {
      const info = this.props.info(o.item.kind);
      o.v.y -= 30 * dt;
      const steps = Math.max(1, Math.ceil((o.v.length() * dt) / 2.5));
      let done = false;
      for (let i = 0; i < steps && !done; i++) {
        o.mesh.position.addScaledVector(o.v, dt / steps);
        const p = o.mesh.position;
        // Thrown things smash what they hit and lose most of their speed.
        if (o.thrown && w.hitsObstacle({ x: p.x, y: p.y + info.r, z: p.z }, info.r)) {
          const n = this.blast(p.x, p.y + info.r, p.z, info.r + 3, o.from);
          o.hits += n;
          if (!n || o.hits > 3) {
            o.v.multiplyScalar(-0.15);
            o.thrown = false;
          } else {
            o.v.multiplyScalar(0.55);
          }
        }
        const g = w.heightAt(p.x, p.z);
        if (p.y <= g) {
          p.y = g;
          if (o.thrown) this.blast(p.x, p.y + 2, p.z, info.r + 2, o.from); // cars and props it lands on
          o.thrown = false;
          if (Math.abs(o.v.y) > 9 && (o.bounces = (o.bounces || 0) + 1) < (info.bouncy ? 6 : 2)) {
            o.v.y *= info.bouncy ? -0.7 : -0.3;
            o.v.x *= 0.6;
            o.v.z *= 0.6;
          } else {
            done = true;
          }
        }
      }
      o.mesh.rotation.x += o.spin * dt;
      o.mesh.rotation.z += o.spin * 0.6 * dt;
      if (done || Math.abs(o.mesh.position.x) > w.halfX + 2000 || Math.abs(o.mesh.position.z) > w.halfZ + 2000) {
        this.scene.remove(o.mesh);
        this.flying.splice(this.flying.indexOf(o), 1);
        this.props.drop(o.item, o.mesh.position.x, o.mesh.position.z, o.mesh.rotation.y);
      }
    }
  }

  /** Put the city back together and forget the score. */
  reset() {
    this.world.repair();
    this.traffic.restore();
    for (const o of this.flying) {
      this.scene.remove(o.mesh);
      this.props.drop(o.item, o.mesh.position.x, o.mesh.position.z, 0);
    }
    this.flying = [];
    this.pending = [];
    this.stats = { buildings: 0, trees: 0, cars: 0, thrown: 0 };
  }

  dispose() {
    this.scene.remove(this.bricks);
  }
}

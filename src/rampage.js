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

    // Fireballs: a few glowing spheres, recycled.
    const ballGeo = new THREE.SphereGeometry(1, 14, 10);
    this.balls = Array.from({ length: 12 }, () => {
      const m = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, depthWrite: false, fog: false }));
      m.visible = false;
      m.renderOrder = 3;
      scene.add(m);
      return { m, t: 1, size: 1 };
    });
    this.nextBall = 0;
    // A bouncing arrow over the nearest thing the robot can grab.
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(2.2, 5, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0xffe14d, fog: false }));
    this.marker.visible = false;
    scene.add(this.marker);
    this.driving = null; // { item, mesh } while in a supersized car
    this.time = 0;
  }

  // ---------------------------------------------------------------- explosions
  /** A fireball with flying bricks, a boom and a camera shake. */
  explode(x, y, z, size) {
    const b = this.balls[this.nextBall];
    this.nextBall = (this.nextBall + 1) % this.balls.length;
    Object.assign(b, { t: 0, size });
    b.m.position.set(x, y, z);
    b.m.visible = true;
    this.burst(x, y, z, size * 0.6, 0xff8a1f, 6);
    this.burst(x, y, z, size * 0.6, 0x3a3a3a, 5);
    this.hooks.boom?.(size, x, z);
  }

  _updateBalls(dt) {
    for (const b of this.balls) {
      if (!b.m.visible) continue;
      b.t += dt / 0.5;
      if (b.t >= 1) {
        b.m.visible = false;
        continue;
      }
      b.m.scale.setScalar(b.size * (0.35 + 0.85 * Math.sqrt(b.t)));
      b.m.material.opacity = 0.75 * (1 - b.t) ** 1.5;
      b.m.material.color.setHSL(0.11 - 0.09 * b.t, 1, 0.6 - 0.25 * b.t); // yellow to deep red
    }
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
      this.score(2, 'tree');
      this.burst(c.x, c.base + 6, c.z, 5, c.color, 5);
    } else {
      this.stats.buildings++;
      const size = c.t === 'box' ? Math.max(c.hw, c.hd) * 2 : Math.max(c.maxx - c.minx, c.maxz - c.minz);
      const n = Math.round(THREE.MathUtils.clamp(size * 0.5 + c.h * 0.3, 10, 60));
      for (let k = 0; k < 3; k++) this.burst(c.x, c.base + (c.h * k) / 3, c.z, Math.min(size, 40), k === 1 ? 0x9a9a94 : c.color, Math.ceil(n / 3));
      this.explode(c.x, c.base + Math.min(c.h, 30) * 0.5, c.z, THREE.MathUtils.clamp(size * 0.6, 7, 20));
      this.score(Math.round(10 + c.h * 1.5), 'building');
      this.hooks.wrecked?.(c);
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
      this.score(15, 'car');
      this.explode(car.x, car.y + 2, car.z, 7);
      const it = this.props.add('car', car.x, car.z, car.yaw, car.color);
      if (it) this._launch(it, new THREE.Vector3(car.x - from.x, 0, car.z - from.z).setLength(22).setY(18));
      n++;
    }
    for (const it of this.props.within(x, z, r)) {
      this._launch(it, new THREE.Vector3(it.x - from.x, 0, it.z - from.z).setLength(26).setY(16));
    }
    if (n) this.hooks.hit?.(n);
    else if (tough) this.hooks.message(this.hooks.canBreak() ? "That one's too tough to break!" : 'Buildings only break in the Lego and Realistic looks');
    return n;
  }

  /** Points for the Rampage game (the game adds combos); always counted. */
  score(points, what) {
    this.points = (this.points || 0) + points;
    this.hooks.scored?.(points, what);
  }

  // ---------------------------------------------------------------- supersizer
  /** What the supersizer is pointed at: the thing in hand, else the nearest object or car ahead. */
  _aim(bot) {
    if (this.held) return this.held.item;
    if (this.driving) return this.driving.item;
    const f = bot.forward;
    const cx = bot.pos.x + f.x * 8;
    const cz = bot.pos.z + f.z * 8;
    let it = this.props.nearest(cx, cz, 16);
    const car = this.traffic.near(cx, cz, 16)[0];
    if (car && (!it || Math.hypot(car.x - cx, car.z - cz) < Math.hypot(it.x - cx, it.z - cz))) {
      this.traffic.remove(car);
      it = this.props.add('car', car.x, car.z, car.yaw, car.color) || it;
    }
    return it;
  }

  /** Grow (factor 2) or shrink (factor 0.5) what the supersizer is pointed at. */
  resize(bot, factor) {
    const it = this._aim(bot);
    if (!it) return this.hooks.message('Point the supersizer at a car or another object nearby');
    const scale = THREE.MathUtils.clamp((it.scale || 1) * factor, 0.25, 4);
    const info = this.props.info(it.kind);
    if (scale === (it.scale || 1)) return this.hooks.message(factor > 1 ? `The ${info.name} can't get any bigger!` : `The ${info.name} can't get any smaller!`);
    this.props.resize(it, scale);
    for (const h of [this.held, this.driving]) if (h?.item === it) h.mesh.scale.setScalar(scale);
    if (this.driving) bot.driving = scale;
    if (this.driving && scale < 2) this.exitCar(bot);
    this.hooks.sound(factor > 1 ? 'grow' : 'shrink');
    const y = it.held ? bot.pos.y + 8 : it.y + 2;
    this.burst(it.held ? bot.pos.x : it.x, y, it.held ? bot.pos.z : it.z, 4 * scale, factor > 1 ? 0x4fd8ff : 0xc06bff, 8);
    const size = scale === 1 ? 'normal size' : scale > 1 ? `${scale}× bigger` : `${1 / scale}× smaller`;
    const tip = info.drive && scale >= 2 && !it.held && !this.driving ? ' Big enough to drive: GRAB it to get in!' : '';
    this.hooks.message(`${factor > 1 ? '🔍 Supersized' : '🔬 Shrunk'} the ${info.name}: ${size}.${tip}`);
    return true;
  }

  // ---------------------------------------------------------------- driving
  enterCar(bot, it) {
    const mesh = this.props.lift(it);
    bot.plane.group.add(mesh);
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    bot.plane.body.visible = false;
    this.driving = { item: it, mesh };
    bot.driving = it.scale;
    bot.yaw = it.yaw;
    bot.pos.set(it.x, it.y, it.z);
    bot.vel.set(0, 0, 0);
    bot.onRam = (c) => this.wreck(c, { x: bot.vel.x || 1, z: bot.vel.z });
    bot.onExit = () => this.exitCar(bot);
    this.hooks.sound('load');
    this.hooks.message(`🚗 Driving the ${this.props.info(it.kind).name}! Nothing can stop you. JUMP to get out`);
  }

  exitCar(bot) {
    if (!this.driving) return;
    const { item, mesh } = this.driving;
    this.driving = null;
    mesh.removeFromParent();
    bot.driving = 0;
    bot.plane.body.visible = true;
    this.props.drop(item, bot.pos.x, bot.pos.z, bot.yaw);
    const r = bot.right;
    bot.pos.x += r.x * (this.props.radius(item) + 4);
    bot.pos.z += r.z * (this.props.radius(item) + 4);
    bot.vel.set(0, 0, 0);
  }

  /** The nearest thing lying around, for the "nothing here" hint: { name, dist, side }. */
  nearestHint(bot) {
    const it = this.props.nearest(bot.pos.x, bot.pos.z, 4000);
    if (!it) return null;
    const dx = it.x - bot.pos.x;
    const dz = it.z - bot.pos.z;
    const f = bot.forward;
    const r = bot.right;
    const ahead = dx * f.x + dz * f.z;
    const right = dx * r.x + dz * r.z;
    const side = Math.abs(ahead) > Math.abs(right) ? (ahead > 0 ? 'ahead' : 'behind you') : right > 0 ? 'to your right' : 'to your left';
    return { name: this.props.info(it.kind).name, dist: Math.round(Math.hypot(dx, dz)), side };
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
    this.explode(bot.pos.x, bot.pos.y + 2, bot.pos.z, r * 0.8);
    return this.blast(bot.pos.x, bot.pos.y + 3, bot.pos.z, r, bot.pos);
  }

  /** Pick up the nearest loose object or car, or throw the one being carried. */
  grabOrThrow(bot) {
    if (this.driving) return this.exitCar(bot);
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
      const h = this.nearestHint(bot);
      this.hooks.message(h ? `Nothing in reach. Nearest: ${h.name}, ${h.dist} m ${h.side} (yellow arrow)` : 'Nothing to grab here');
      return false;
    }
    if (this.props.info(it.kind).drive && it.scale >= 2) return this.enterCar(bot, it);
    if (it.scale > 2) {
      this.hooks.message(`That ${this.props.info(it.kind).name} is too big to lift now. Shrink it first!`);
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
    this.hooks.threw?.();
    this.stats.thrown++;
    this.hooks.sound('throw');
    return true;
  }

  /** Let go of whatever is carried (when changing back into the vehicle). */
  release(bot) {
    this.exitCar(bot);
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
    if ((it.scale || 1) > 1) v.multiplyScalar(1 / Math.sqrt(it.scale)); // big things don't fly as far
    this.scene.add(mesh);
    this.flying.push({ item: it, mesh, v, spin: 3 + Math.random() * 3, from: new THREE.Vector3(it.x, it.y, it.z), hits: 0 });
  }

  // ---------------------------------------------------------------- per frame
  update(dt, bot) {
    this.time += dt;
    this._updateBricks(dt);
    this._updateBalls(dt);
    // Point out the nearest thing to grab (within 150 m) while the robot's hands are free.
    const near = bot && !this.held && !this.driving ? this.props.nearest(bot.pos.x, bot.pos.z, 150) : null;
    this.marker.visible = !!near;
    if (near) {
      this.marker.position.set(near.x, near.y + this.props.radius(near) * 2 + 6 + Math.sin(this.time * 4) * 1.2, near.z);
      this.marker.rotation.y = this.time * 2;
    }
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
        const reach = bot.driving ? 2 * bot.driving : 0;
        for (const it of this.props.within(bot.pos.x, bot.pos.z, 2.5 + reach)) {
          if (it === this.driving?.item) continue;
          if (Math.abs(it.y - bot.pos.y) < 4) this._launch(it, new THREE.Vector3(bot.vel.x, 0, bot.vel.z).multiplyScalar(1.5).setY(10 + bot.speed * 0.3));
        }
        for (const car of this.traffic.near(bot.pos.x, bot.pos.z, 4.5 + reach)) {
          if (Math.abs(car.y - bot.pos.y) > 4) continue;
          this.traffic.remove(car);
          this.stats.cars++;
          this.score(15, 'car');
          this.explode(car.x, car.y + 2, car.z, 6);
          const it = this.props.add('car', car.x, car.z, car.yaw, car.color);
          if (it) this._launch(it, new THREE.Vector3(bot.vel.x, 0, bot.vel.z).multiplyScalar(1.5).setY(14));
        }
      }
    }
    // Things in the air.
    const w = this.world;
    for (const o of [...this.flying]) {
      const info = { ...this.props.info(o.item.kind), r: this.props.radius(o.item) };
      o.v.y -= 30 * dt;
      const steps = Math.max(1, Math.ceil((o.v.length() * dt) / 2.5));
      let done = false;
      for (let i = 0; i < steps && !done; i++) {
        o.mesh.position.addScaledVector(o.v, dt / steps);
        const p = o.mesh.position;
        // Thrown things smash what they hit and lose most of their speed.
        if (o.thrown && w.hitsObstacle({ x: p.x, y: p.y + info.r, z: p.z }, info.r)) {
          this.explode(p.x, p.y + info.r, p.z, info.r * 2.2 + 4);
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
          if (o.thrown) {
            this.explode(p.x, p.y + 2, p.z, info.r * 2 + 3);
            this.blast(p.x, p.y + 2, p.z, info.r + 2, o.from); // cars and props it lands on
          }
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
    this.points = 0;
    for (const it of this.props.items) if (it.scale !== 1) this.props.resize(it, 1);
    this.stats = { buildings: 0, trees: 0, cars: 0, thrown: 0 };
  }

  /** Things lying around near (x, z), for the minimap in robot mode. */
  mapMarks(x, z, r) {
    return this.props.items.filter((it) => !it.held && Math.abs(it.x - x) < r && Math.abs(it.z - z) < r);
  }

  dispose() {
    this.scene.remove(this.bricks);
  }
}

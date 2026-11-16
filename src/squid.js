import * as THREE from 'three';
import { isLego, legoMaterial, NIGHT } from './lego.js';
import { glowTexture } from './nightlights.js';
import { SQUID, isOut } from './squidbrain.js';

// The giant squid (plan 07): where squids live in each city, and how one looks
// and moves. The rules (when it wakes, strikes, lets go) are in squidbrain.js;
// squidplay.js connects the two to the game.

// ------------------------------------------------------------------ where
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Distance from (px, pz) to the segment a-b. */
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const L = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

/**
 * Deep-water spots in a city. The map has no depth data, only the water mask,
 * so "deep" means far from shore: on a 40 m grid, each water cell's distance to
 * the nearest land. Spots are at least 150 m from shore, 1.5 km apart, 800 m
 * from the runway start, the helipad and the toilets, and 150 m from bridges.
 * Big cities get up to three, small ones one (the owner's choice). Every player
 * computes the same spots (a fixed seed breaks ties).
 * Returns { spots: [{ i, x, z, y, deep }], deepArea } (deepArea in km²).
 */
export function findSquidSpots(world, { big = false } = {}) {
  const C = 40;
  const nx = Math.ceil(world.sizeX / C);
  const nz = Math.ceil(world.sizeZ / C);
  const N = nx * nz;
  const dist = new Float32Array(N);
  const x0 = -world.halfX + C / 2;
  const z0 = -world.halfZ + C / 2;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) dist[j * nx + i] = world.isWater(x0 + i * C, z0 + j * C) ? 1e9 : 0;
  }
  // Two-pass chamfer distance (in cells), 8 neighbours.
  const D = Math.SQRT2;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!dist[k]) continue;
      let d = dist[k];
      if (i > 0) d = Math.min(d, dist[k - 1] + 1);
      if (j > 0) {
        d = Math.min(d, dist[k - nx] + 1);
        if (i > 0) d = Math.min(d, dist[k - nx - 1] + D);
        if (i < nx - 1) d = Math.min(d, dist[k - nx + 1] + D);
      }
      dist[k] = d;
    }
  }
  for (let j = nz - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (!dist[k]) continue;
      let d = dist[k];
      if (i < nx - 1) d = Math.min(d, dist[k + 1] + 1);
      if (j < nz - 1) {
        d = Math.min(d, dist[k + nx] + 1);
        if (i < nx - 1) d = Math.min(d, dist[k + nx + 1] + D);
        if (i > 0) d = Math.min(d, dist[k + nx - 1] + D);
      }
      dist[k] = d;
    }
  }
  const avoid = [];
  const rw = world.runway;
  const back = rw.length / 2 - 70;
  avoid.push({ x: rw.x - rw.fx * back, z: rw.z - rw.fz * back });
  if (world.data.helipad) avoid.push(world.data.helipad);
  for (const t of world.toilets || []) avoid.push(t);
  const bridges = world.bridges?.list || [];
  const nearBridge = (x, z) => {
    for (const b of bridges) {
      const p = b.pts;
      for (let k = 1; k < p.length; k++) if (segDist(x, z, p[k - 1][0], p[k - 1][1], p[k][0], p[k][1]) < 150 + (b.w || 0) / 2) return true;
    }
    return false;
  };
  const r = rng(7007);
  const cand = [];
  let deepCells = 0;
  const edge = 300;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const d = dist[j * nx + i] * C;
      if (d < 150 || d > 1e8) continue;
      deepCells++;
      const x = x0 + i * C;
      const z = z0 + j * C;
      if (Math.abs(x) > world.halfX - edge || Math.abs(z) > world.halfZ - edge) continue;
      cand.push({ x, z, deep: Math.min(d, 1200) + r() * 30 });
    }
  }
  const deepArea = (deepCells * C * C) / 1e6;
  const max = big ? 3 : 1;
  cand.sort((a, b) => b.deep - a.deep);
  const spots = [];
  for (const c of cand) {
    if (spots.length >= max) break;
    if (avoid.some((a) => Math.hypot(a.x - c.x, a.z - c.z) < 800)) continue;
    if (spots.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < 1500)) continue;
    if (nearBridge(c.x, c.z)) continue;
    spots.push({ i: spots.length, x: c.x, z: c.z, y: world.groundAt(c.x, c.z), deep: Math.round(c.deep) });
  }
  return { spots, deepArea: +deepArea.toFixed(2) };
}

/** The nearest dry land to (x, z): 32 directions, out to 3 km. Returns { x, z } or null. */
export function nearestShore(world, x, z) {
  let best = null;
  for (let a = 0; a < 32; a++) {
    const dx = Math.cos((a / 32) * Math.PI * 2);
    const dz = Math.sin((a / 32) * Math.PI * 2);
    for (let d = 10; d < 3000 && (!best || d < best.d); d += 10) {
      if (!world.isWater(x + dx * d, z + dz * d)) {
        // A few metres inland, so it isn't standing in the surf.
        const e = d + 18;
        if (!best || d < best.d) best = { d, x: x + dx * e, z: z + dz * e };
        break;
      }
    }
  }
  return best;
}

/** Water within `r` of (x, z) (on it, or on the shore close by). */
export function nearWater(world, x, z, r = SQUID.SHORE_R) {
  if (world.isWater(x, z)) return true;
  for (let a = 0; a < 8; a++) {
    const dx = Math.cos((a / 8) * Math.PI * 2) * r;
    const dz = Math.sin((a / 8) * Math.PI * 2) * r;
    if (world.isWater(x + dx, z + dz)) return true;
  }
  return false;
}

// ------------------------------------------------------------------ looks
const BODY = 0xc8412b; // brick red
const TIP = 0xf08a5d;
const SPOT = 0x55e0ff;
const UPV = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();

/**
 * One squid: a mantle, two big eyes, eight arms and two longer tentacles (twelve
 * arms for the Squid Hunt boss). The arms are chains of segments, all drawn by
 * one InstancedMesh and posed each frame by a curl-and-reach function. Lego
 * bricks in the Lego look, smooth in the realistic ones. Added straight to the
 * scene (not the map's meshes), so it shows in Google 3D too.
 */
export class SquidModel {
  constructor(scene, spot, { light = false, boss = false } = {}) {
    this.scene = scene;
    this.spot = spot;
    this.lego = isLego();
    this.arms = boss ? SQUID.BOSS.ARMS : SQUID.ARMS;
    this.segs = light ? 6 : 10;
    this.boss = boss;
    const k = boss ? 1.25 : 1; // the boss is bigger
    this.k = k;
    const g = (this.group = new THREE.Group());
    g.position.set(spot.x, spot.y, spot.z);
    scene.add(g);
    const mat = (hex, extra = {}) => (this.lego ? legoMaterial({ color: hex, studs: 0.8, ...extra }) : new THREE.MeshStandardMaterial({ color: hex, roughness: 0.45, metalness: 0.05, ...extra }));
    this.mat = mat(BODY);
    // The body: mantle pointing up and a little back, head below it.
    const body = (this.body = new THREE.Group());
    g.add(body);
    if (this.lego) {
      // Stacked bricks narrowing to a point, with two fins.
      const rows = 9;
      for (let i = 0; i < rows; i++) {
        const w = (6.4 - i * 0.55) * k;
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, 2.4 * k, w), this.mat);
        b.position.y = (4 + i * 2.4) * k;
        b.castShadow = true;
        body.add(b);
      }
      const fin = new THREE.BoxGeometry(5 * k, 3.2 * k, 0.8 * k);
      for (const s of [-1, 1]) {
        const f = new THREE.Mesh(fin, this.mat);
        f.position.set(s * 4 * k, 22 * k, 0);
        f.rotation.z = s * 0.5;
        body.add(f);
      }
      const head = new THREE.Mesh(new THREE.BoxGeometry(7.2 * k, 4.4 * k, 7.2 * k), this.mat);
      head.position.y = 1.2 * k;
      body.add(head);
    } else {
      const pts = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        pts.push(new THREE.Vector2(Math.max(0.05, Math.sin(Math.PI * (0.08 + 0.92 * t)) * 3.6 * (1 - 0.55 * t) * k), t * 24 * k));
      }
      const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), this.mat);
      m.position.y = 1.5 * k;
      m.castShadow = true;
      body.add(m);
      const fin = new THREE.Mesh(new THREE.SphereGeometry(4.5 * k, 16, 8).scale(1.4, 0.7, 0.18), this.mat);
      fin.position.y = 22 * k;
      body.add(fin);
      const head = new THREE.Mesh(new THREE.SphereGeometry(4 * k, 18, 12).scale(1, 0.75, 1), this.mat);
      head.position.y = 1 * k;
      body.add(head);
    }
    body.rotation.x = -0.25; // leaning back
    // Eyes: white with a black pupil, glowing yellow at night.
    this.glows = [];
    const eyeGeo = this.lego ? new THREE.BoxGeometry(2.6 * k, 2.6 * k, 1) : new THREE.SphereGeometry(1.5 * k, 14, 10);
    const pupGeo = this.lego ? new THREE.BoxGeometry(1.2 * k, 1.6 * k, 1) : new THREE.SphereGeometry(0.8 * k, 10, 8);
    const white = new THREE.MeshLambertMaterial({ color: 0xfff8d6, emissive: 0x000000 });
    this.eyeMat = white;
    const black = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(eyeGeo, white);
      e.position.set(s * 3.3 * k, 2.6 * k, -2.6 * k);
      e.lookAt(s * 10 * k, 2.6 * k, -10 * k);
      const p = new THREE.Mesh(pupGeo, black);
      p.position.z = this.lego ? 0.55 : 1.0 * k;
      e.add(p);
      body.add(e);
      this.glows.push(this._glow(e, 0xffe066, 7 * k));
    }
    // Glowing spots along the mantle (night).
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.Object3D();
      const a = (i / 6) * Math.PI * 2;
      sp.position.set(Math.cos(a) * 3.2 * k, (8 + (i % 3) * 5) * k, Math.sin(a) * 3.2 * k);
      body.add(sp);
      this.glows.push(this._glow(sp, SPOT, 4 * k));
    }
    // Arms: one instanced mesh, a segment per instance.
    const segGeo = this.lego ? new THREE.BoxGeometry(1, 1, 1) : new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
    const n = this.arms * this.segs;
    this.armMesh = new THREE.InstancedMesh(segGeo, mat(0xffffff), n);
    this.armMesh.frustumCulled = false;
    this.armMesh.castShadow = true;
    this.armMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const cBody = new THREE.Color(BODY);
    const cTip = new THREE.Color(TIP);
    for (let a = 0; a < this.arms; a++) {
      for (let i = 0; i < this.segs; i++) this.armMesh.setColorAt(a * this.segs + i, cBody.clone().lerp(cTip, (i / this.segs) * 0.8 + (i % 2) * 0.12));
    }
    g.add(this.armMesh);
    this.pts = Array.from({ length: this.segs + 1 }, () => new THREE.Vector3());
    // On the water: a ripple ring and a dark shadow (all you see of a sleeping squid).
    const flat = (geo, hex, op) => {
      const m = new THREE.Mesh(geo.rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: op, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
      m.renderOrder = 2;
      m.position.y = 0.35;
      scene.add(m);
      return m;
    };
    this.shadow = flat(new THREE.CircleGeometry(16 * k, 28), 0x0b1a2e, 0.28);
    this.ripple = flat(new THREE.RingGeometry(14, 16, 40), 0xe8f6ff, 0.5);
    this.ripple2 = flat(new THREE.RingGeometry(14, 15.2, 40), 0xe8f6ff, 0.35);
    this.ink = flat(new THREE.CircleGeometry(1, 28), 0x140a24, 0);
    // The bulge before a strike: a low dome of water.
    this.bulge = new THREE.Mesh(new THREE.SphereGeometry(14 * k, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x3f8fc8, transparent: true, opacity: 0.75 }));
    this.bulge.scale.y = 0.01;
    this.bulge.visible = false;
    scene.add(this.bulge);
    for (const m of [this.shadow, this.ripple, this.ripple2, this.ink, this.bulge]) m.position.x = spot.x, m.position.z = spot.z;
    this.ripple.position.y = this.ripple2.position.y = this.shadow.position.y = this.ink.position.y = spot.y + 0.35;
    this.bulge.position.y = spot.y;
    this.inkT = 9;
    this.rise = -30; // body height relative to the water, eased
    this.flash = 0; // electrocuted: blue flicker
    this.flinch = 0;
  }

  _glow(parent, hex, size) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: hex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    s.scale.setScalar(size);
    parent.add(s);
    return s;
  }

  /** Squirt ink: a dark cloud spreading on the water. */
  squirt() {
    this.inkT = 0;
  }

  /**
   * Pose for this frame. view: { phase, age (s in this phase), target (world
   * Vector3 or null), time (s), near (camera within detail range) }.
   */
  update(dt, view) {
    const { phase, age, time } = view;
    const k = this.k;
    const y0 = this.spot.y;
    // How high the body sits (relative to the water).
    const want = {
      asleep: -32, rest: -34, aware: -15, windup: -7, strike: 1, hold: 1, recover: 0, stunned: 1, eat: 0,
      drag: -34, sink: -30, flee: -40, beaten: -40,
    }[phase] ?? -32;
    const speed = phase === 'strike' ? 14 : phase === 'drag' || phase === 'flee' ? 3 : 2.2;
    this.rise += (want - this.rise) * (1 - Math.exp(-dt * speed));
    this.flinch = Math.max(0, this.flinch - dt * 2.5);
    const out = isOut(phase) || this.rise > -12;
    const showBody = view.near && this.rise > -30;
    this.body.visible = showBody;
    this.armMesh.visible = view.near && this.rise > -26;
    const g = this.group;
    g.position.y = y0 + this.rise;
    // Turn toward the target, sway a little.
    if (view.target) {
      const yaw = Math.atan2(view.target.x - this.spot.x, view.target.z - this.spot.z);
      let dy = yaw - g.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      g.rotation.y += dy * (1 - Math.exp(-dt * 3));
    }
    this.body.rotation.z = Math.sin(time * 0.9) * 0.06 + this.flinch * 0.3 * Math.sin(time * 40);
    this.body.rotation.x = -0.25 - this.flinch * 0.35;
    // Surface marks: the shadow darkens and the ripples spread when it's near the top.
    const up = THREE.MathUtils.clamp((this.rise + 34) / 30, 0, 1);
    this.shadow.material.opacity = 0.12 + 0.28 * up;
    const rr = (time * 0.35) % 1;
    const rr2 = (time * 0.35 + 0.5) % 1;
    this.ripple.scale.setScalar((0.6 + rr * 1.4) * k);
    this.ripple.material.opacity = (1 - rr) * (0.25 + 0.4 * up) * (phase === 'rest' ? 0.4 : 1);
    this.ripple2.scale.setScalar((0.6 + rr2 * 1.4) * k);
    this.ripple2.material.opacity = (1 - rr2) * (0.2 + 0.35 * up) * (phase === 'rest' ? 0.4 : 1);
    // Wind-up: the water bulges.
    const bulge = phase === 'windup' ? Math.min(1, age / (view.len || SQUID.WINDUP)) : phase === 'strike' ? Math.max(0, 1 - age / 0.3) : 0;
    this.bulge.visible = bulge > 0.01;
    this.bulge.scale.set(1, Math.max(0.01, bulge * 0.45), 1);
    // Ink cloud.
    this.inkT += dt;
    this.ink.material.opacity = this.inkT < 6 ? Math.min(1, this.inkT * 4) * 0.8 * (1 - this.inkT / 6) : 0;
    this.ink.scale.setScalar(4 + Math.min(this.inkT, 6) * 9 * k);
    // Glow at night (eyes and spots), and the blue flicker when electrocuted.
    this.flash = Math.max(0, this.flash - dt);
    const night = NIGHT.value;
    for (const s of this.glows) s.material.opacity = showBody ? night * 0.9 : 0;
    this.eyeMat.emissive.setHex(night > 0.3 ? 0x6a5a10 : 0x000000);
    const zap = this.flash > 0 && Math.sin(time * 60) > 0;
    this.mat.emissive?.setHex(zap ? 0x2266ff : 0x000000);
    this.armMesh.material.emissive?.setHex(zap ? 0x2266ff : 0x000000);
    if (this.armMesh.visible) this._poseArms(view, out);
  }

  /** Each arm: a planar chain curling and waving, blended toward a reach or a wrap around the target. */
  _poseArms(view, out) {
    const { phase, age, time } = view;
    const k = this.k;
    const n = this.segs;
    const g = this.group;
    g.updateMatrixWorld();
    const inv = _m.copy(g.matrixWorld).invert();
    const tgt = view.target ? _p.copy(view.target).applyMatrix4(inv) : null;
    const grabbers = [0, Math.floor(this.arms / 2)]; // the two long tentacles
    const reach = phase === 'strike' ? Math.min(1, age / (SQUID.STRIKE * 0.8)) : phase === 'hold' ? 1 : phase === 'drag' ? 1 : 0;
    const wrap = phase === 'hold' || phase === 'drag' ? Math.min(1, age / 0.4) : 0;
    const lift = out ? 1 : phase === 'windup' ? 0.75 : 0.35; // arms raised high when out
    let idx = 0;
    for (let a = 0; a < this.arms; a++) {
      const long = grabbers.includes(a);
      const L = (long ? 46 : 28) * k;
      const ang = (a / this.arms) * Math.PI * 2;
      const dx = Math.sin(ang);
      const dz = Math.cos(ang);
      const bx = dx * 3 * k;
      const bz = dz * 3 * k;
      const by = -0.5 * k;
      // Rest/wave pose: a chain in the vertical plane through this arm's direction.
      let th = 0.25 + lift * 0.9; // angle above horizontal at the root
      const segL = L / n;
      let px = bx;
      let py = by;
      let pz = bz;
      this.pts[0].set(px, py, pz);
      for (let i = 1; i <= n; i++) {
        const s = i / n;
        th += (0.05 + 0.22 * s * lift) * (out ? 1 : 0.6) + Math.sin(time * (1.4 + a * 0.07) + i * 0.7 + a * 1.3) * 0.12 * (0.5 + s);
        const h = Math.cos(th) * segL;
        px += dx * h;
        pz += dz * h;
        py += Math.sin(th) * segL;
        this.pts[i].set(px, py, pz);
      }
      // Reaching for the target (the long tentacles), or wrapping around it.
      if (long && tgt && reach > 0) {
        const mx = (bx + tgt.x) / 2;
        const mz = (bz + tgt.z) / 2;
        const my = Math.max(by, tgt.y) + 10 * k;
        const side = a === grabbers[0] ? 1 : -1;
        for (let i = 1; i <= n; i++) {
          const s = i / n;
          const u = 1 - s;
          // Quadratic curve root → arch → target.
          const qx = u * u * bx + 2 * u * s * mx + s * s * tgt.x;
          const qy = u * u * by + 2 * u * s * my + s * s * tgt.y;
          const qz = u * u * bz + 2 * u * s * mz + s * s * tgt.z;
          let wx = qx;
          let wy = qy;
          let wz = qz;
          const start = 0.62;
          if (wrap > 0 && s > start) {
            const f = (s - start) / (1 - start);
            const phi = f * Math.PI * 3.2 * side + time * 2 * side;
            const r = 3.2 * k;
            wx = tgt.x + Math.cos(phi) * r;
            wz = tgt.z + Math.sin(phi) * r;
            wy = tgt.y + (f - 0.5) * 3 * k;
            const b = wrap * Math.min(1, f * 3);
            wx = qx + (wx - qx) * b;
            wy = qy + (wy - qy) * b;
            wz = qz + (wz - qz) * b;
          }
          this.pts[i].lerp(_d.set(wx, wy, wz), reach);
        }
      } else if (!long && phase === 'hold' && tgt) {
        // The other arms reach a little toward the struggle.
        for (let i = 1; i <= n; i++) this.pts[i].lerp(_d.copy(tgt).multiplyScalar(i / n * 0.35).add(this.pts[i]).multiplyScalar(0.5), 0.3);
      }
      // Segments between consecutive points, tapering toward the tip.
      for (let i = 0; i < n; i++) {
        const p0 = this.pts[i];
        const p1 = this.pts[i + 1];
        _d.subVectors(p1, p0);
        const len = Math.max(0.01, _d.length());
        _q.setFromUnitVectors(UPV, _d.multiplyScalar(1 / len));
        const w = (long ? 1.9 : 2.4) * k * (1 - 0.7 * (i / n));
        _s.set(w, len * 1.08, w);
        _m.compose(_d.copy(p0).add(p1).multiplyScalar(0.5), _q, _s);
        this.armMesh.setMatrixAt(idx++, _m);
      }
    }
    this.armMesh.instanceMatrix.needsUpdate = true;
  }

  /** The world position of a long tentacle's tip (for the grip). */
  tip(out) {
    return out.copy(this.pts[this.segs]).applyMatrix4(this.group.matrixWorld);
  }

  dispose() {
    for (const o of [this.group, this.shadow, this.ripple, this.ripple2, this.ink, this.bulge]) {
      this.scene.remove(o);
      o.traverse((c) => {
        c.geometry?.dispose();
        for (const m of [].concat(c.material || [])) m.dispose();
      });
    }
  }
}

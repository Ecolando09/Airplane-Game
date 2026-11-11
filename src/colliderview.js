import * as THREE from 'three';

// Draws collision shapes as wireframes, so nothing that blocks the robot is
// ever invisible.
//  - Debug view (?debug=colliders, or the backquote key): every shape within
//    `range` of the robot. Yellow: breakable buildings. Red: landmarks (can't
//    break). Green: trees. Shapes with open space underneath (bridges, arches)
//    are drawn between their bottom and top.
//  - flash(c): briefly outline one shape, used when something unbreakable has
//    been stopping the robot for a moment.

const COLORS = { building: 0xffd23f, landmark: 0xff3b3b, tree: 0x3ee06a, flash: 0xffffff };

/** Line segments outlining collider c as a prism from its bottom to its top. */
function outline(world, c, out) {
  const y0 = Math.max(c.bottom ?? -Infinity, c.base ?? world.heightAt(c.x ?? (c.minx + c.maxx) / 2, c.z ?? (c.minz + c.maxz) / 2) - 1);
  const y1 = c.top;
  let ring;
  if (c.t === 'box') {
    ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [c.x + a * c.hw * c.c - b * c.hd * c.s, c.z + a * c.hw * c.s + b * c.hd * c.c]);
  } else if (c.t === 'cyl' || c.t === 'tree') {
    const r = c.t === 'cyl' ? c.r : c.rad * 0.5;
    ring = Array.from({ length: 16 }, (_, i) => [c.x + Math.cos((i / 16) * Math.PI * 2) * r, c.z + Math.sin((i / 16) * Math.PI * 2) * r]);
  } else {
    ring = [];
    for (let i = 0; i < c.p.length; i += 2) ring.push([c.p[i], c.p[i + 1]]);
  }
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    out.push(ax, y0, az, bx, y0, bz, ax, y1, az, bx, y1, bz, ax, y0, az, ax, y1, az);
  }
}

export class ColliderView {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.on = false;
    this.range = 160;
    this.groups = {};
    for (const [k, color] of Object.entries(COLORS)) {
      const geo = new THREE.BufferGeometry();
      const m = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, depthTest: k !== 'flash', transparent: true, fog: false }));
      m.frustumCulled = false;
      m.renderOrder = 5;
      m.visible = false;
      scene.add(m);
      this.groups[k] = m;
    }
    this.flashT = 0;
    this.next = 0;
  }

  kind(c) {
    if (c.t === 'tree') return 'tree';
    return this.world.breakable(c) ? 'building' : 'landmark';
  }

  /** Outline one collider for a moment. */
  flash(c, secs = 1.2) {
    const pts = [];
    outline(this.world, c, pts);
    this.groups.flash.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.groups.flash.visible = true;
    this.flashT = secs;
  }

  update(dt, pos) {
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.groups.flash.material.opacity = 0.5 + 0.5 * Math.abs(Math.sin(this.flashT * 10));
      if (this.flashT <= 0) this.groups.flash.visible = false;
    }
    for (const k of ['building', 'landmark', 'tree']) this.groups[k].visible = this.on;
    if (!this.on || (this.next -= dt) > 0) return;
    this.next = 0.4;
    const pts = { building: [], landmark: [], tree: [] };
    for (const c of this.world.collidersNear(pos.x, pos.z, this.range)) {
      const cx = c.x ?? (c.minx + c.maxx) / 2;
      const cz = c.z ?? (c.minz + c.maxz) / 2;
      if (Math.hypot(cx - pos.x, cz - pos.z) > this.range + 60) continue;
      outline(this.world, c, pts[this.kind(c)]);
    }
    for (const k of Object.keys(pts)) this.groups[k].geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts[k], 3));
  }

  dispose() {
    for (const m of Object.values(this.groups)) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}

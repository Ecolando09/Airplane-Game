import * as THREE from 'three';
import { LEGO, legoMaterial, isLego } from './lego.js';

// Road bridges. The map has roads but doesn't say which are bridges, so any
// stretch of road that crosses water is one: from the last bit of land before
// the water to the first bit after it. Each gets a deck (ramping up from the
// banks to clear the water: more for big roads), railings and pillars, and a
// fast lookup, deckAt(x, z), so cars, trucks and the robot can drive across
// and things thrown onto it land on it. Aircraft ignore it (fly underneath).

const WIDTH = { motorway: 22, trunk: 18, primary: 14, secondary: 12, tertiary: 10, residential: 7, unclassified: 7, living_street: 6, service: 4.5, unknown: 6 };
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary']);
const STEP = 8; // metres between samples along a road
const CELL = 100; // lookup grid, metres
const MAX_LEN = 4000; // longer water crossings are left alone (ferry lines, map oddities)

export class Bridges {
  constructor(world) {
    this.world = world;
    this.list = []; // { w, pts: [[x, z, y], ...] }
    this.grid = new Map();
    this._find();
    this._index();
  }

  _find() {
    const w = this.world;
    for (const l of w.data.lines) {
      const width = WIDTH[l.k];
      if (!width) continue; // rail and footpaths: no deck
      // Sample the whole road at even steps.
      const pts = [];
      for (let i = 2; i < l.p.length; i += 2) {
        const x0 = l.p[i - 2];
        const z0 = l.p[i - 1];
        const x1 = l.p[i];
        const z1 = l.p[i + 1];
        const len = Math.hypot(x1 - x0, z1 - z0);
        const n = Math.max(1, Math.ceil(len / STEP));
        for (let k = i === 2 ? 0 : 1; k <= n; k++) pts.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
      }
      // Runs of samples over water, with the land sample on either side.
      let start = -1;
      for (let i = 0; i < pts.length; i++) {
        const wet = w.isWater(pts[i][0], pts[i][1]);
        if (wet && start < 0) start = i;
        if ((!wet || i === pts.length - 1) && start >= 0) {
          const a = Math.max(0, start - 1);
          const b = wet ? i : i; // the first dry sample (or the road's end)
          if (b - a >= 2 && (b - a) * STEP <= MAX_LEN && this._crosses(pts, a, b, width)) this._add(pts.slice(a, b + 1), width, MAJOR.has(l.k));
          start = -1;
        }
      }
    }
  }

  /**
   * Does the road cross the water between samples a and b (a river, a lake),
   * rather than run alongside it (a road beside a creek)? Under a real bridge
   * the water carries on to both sides of the road.
   */
  _crosses(pts, a, b, width) {
    const w = this.world;
    const off = width / 2 + 18;
    let both = 0;
    let n = 0;
    for (let i = a + 1; i < b; i++) {
      const [x0, z0] = pts[i - 1];
      const [x1, z1] = pts[i + 1] || pts[i];
      const len = Math.hypot(x1 - x0, z1 - z0) || 1;
      const px = -(z1 - z0) / len;
      const pz = (x1 - x0) / len;
      const [x, z] = pts[i];
      n++;
      if (w.isWater(x + px * off, z + pz * off) && w.isWater(x - px * off, z - pz * off)) both++;
    }
    return n > 0 && both / n >= 0.5;
  }

  /** One bridge over the sampled points: deck heights ramp up from both banks to clear the water. */
  _add(pts, width, major) {
    const w = this.world;
    const total = (pts.length - 1) * STEP;
    const gA = w.groundAt(pts[0][0], pts[0][1]);
    const gB = w.groundAt(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    let water = -Infinity;
    for (const [x, z] of pts) if (w.isWater(x, z)) water = Math.max(water, w.groundAt(x, z));
    const clear = (major ? 12 : 6) + Math.min(10, total / 120); // longer bridges stand taller
    const top = Math.max(gA, gB, water + clear);
    const ramp = Math.min(total * 0.35, 60 + clear * 5);
    const out = pts.map(([x, z], i) => {
      const s = i * STEP;
      const base = gA + ((gB - gA) * s) / total;
      const u = Math.min(1, Math.min(s, total - s) / ramp);
      const f = u * u * (3 - 2 * u); // smooth ramps
      return [x, z, base + (Math.max(base, top) - base) * f];
    });
    this.list.push({ w: width + 2, pts: out, water });
  }

  _index() {
    this.list.forEach((b, bi) => {
      for (let i = 1; i < b.pts.length; i++) {
        const [x0, z0] = b.pts[i - 1];
        const [x1, z1] = b.pts[i];
        const r = b.w / 2 + 2;
        for (let cx = Math.floor((Math.min(x0, x1) - r) / CELL); cx <= Math.floor((Math.max(x0, x1) + r) / CELL); cx++) {
          for (let cz = Math.floor((Math.min(z0, z1) - r) / CELL); cz <= Math.floor((Math.max(z0, z1) + r) / CELL); cz++) {
            const key = cx * 100000 + cz;
            let cell = this.grid.get(key);
            if (!cell) this.grid.set(key, (cell = []));
            cell.push(bi, i);
          }
        }
      }
    });
  }

  /**
   * The bridge deck's height at (x, z), or null off every bridge. With `nearY`,
   * only a deck within reach of that height counts (so something under the
   * bridge, a boat say, isn't lifted onto it).
   */
  deckAt(x, z, nearY = null) {
    const cell = this.grid.get(Math.floor(x / CELL) * 100000 + Math.floor(z / CELL));
    if (!cell) return null;
    let best = null;
    for (let k = 0; k < cell.length; k += 2) {
      const b = this.list[cell[k]];
      const [x0, z0, y0] = b.pts[cell[k + 1] - 1];
      const [x1, z1, y1] = b.pts[cell[k + 1]];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / l2));
      const d = Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t));
      if (d > b.w / 2) continue;
      const y = y0 + (y1 - y0) * t;
      if (nearY !== null && Math.abs(y - nearY) > 4) continue;
      if (best === null || y > best) best = y;
    }
    return best;
  }

  /** Decks, railings and pillars, as three instanced meshes. */
  build(scene, meshes) {
    const decks = [];
    const rails = [];
    const piers = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);
    const qp = new THREE.Quaternion();
    for (const b of this.list) {
      let sincePier = 30;
      // Straight, even stretches are drawn as one long piece (far fewer pieces to draw).
      const keep = [b.pts[0]];
      for (let i = 1; i < b.pts.length - 1; i++) {
        const a0 = keep[keep.length - 1];
        const a1 = b.pts[i];
        const a2 = b.pts[i + 1];
        const d1 = [a1[0] - a0[0], a1[2] - a0[2], a1[1] - a0[1]];
        const d2 = [a2[0] - a1[0], a2[2] - a1[2], a2[1] - a1[1]];
        const l1 = Math.hypot(...d1) || 1;
        const l2 = Math.hypot(...d2) || 1;
        const dot = (d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]) / (l1 * l2);
        if (dot < 0.998 || l1 > 200) keep.push(a1);
      }
      keep.push(b.pts[b.pts.length - 1]);
      const light = this.world.light; // PSG1 / Low graphics: no railings, fewer pillars
      const railed = !light && b.w >= 20; // railings on motorway and highway bridges
      for (let i = 1; i < keep.length; i++) {
        const [x0, z0, y0] = keep[i - 1];
        const [x1, z1, y1] = keep[i];
        const len = Math.hypot(x1 - x0, z1 - z0);
        const yaw = Math.atan2(x1 - x0, z1 - z0);
        const pitch = -Math.atan2(y1 - y0, len);
        e.set(pitch, yaw, 0, 'YXZ');
        q.setFromEuler(e);
        const cx = (x0 + x1) / 2;
        const cz = (z0 + z1) / 2;
        const cy = (y0 + y1) / 2;
        decks.push(m.compose(v.set(cx, cy - 0.6, cz), q, s.set(b.w, 1.2, len + 0.3)).clone());
        if (railed) for (const side of [-1, 1]) {
          const ox = Math.cos(yaw) * side * (b.w / 2 - 0.3);
          const oz = -Math.sin(yaw) * side * (b.w / 2 - 0.3);
          rails.push(m.compose(v.set(cx + ox, cy + 0.5, cz + oz), q, s.set(0.4, 1.0, len + 0.3)).clone());
        }
        // Pillars down to the water (or ground) every 40 m where the deck is up.
        sincePier += len;
        const ground = this.world.groundAt(cx, cz);
        if (sincePier >= (this.world.light ? 90 : 40) && cy - ground > 4) {
          sincePier = 0;
          const h = cy - 1.2 - ground + 2;
          piers.push(m.compose(v.set(cx, ground - 2 + h / 2, cz), qp.setFromAxisAngle(UP, yaw), s.set(b.w * 0.55, h, 2.2)).clone());
        }
      }
    }
    const lego = isLego();
    const box = new THREE.BoxGeometry(1, 1, 1);
    const material = legoMaterial({ color: 0xffffff, studs: lego ? 0.8 : 0 }); // each box gets its own colour
    // Decks, railings and pillars together, one instanced mesh per 3.2 km square,
    // so bridges out of view (or past the fog) aren't drawn.
    const chunks = new Map();
    const p = new THREE.Vector3();
    const put = (list, hex) => {
      for (const mm of list) {
        p.setFromMatrixPosition(mm);
        const key = Math.floor(p.x / 3200) * 100000 + Math.floor(p.z / 3200);
        if (!chunks.has(key)) chunks.set(key, []);
        chunks.get(key).push([mm, hex]);
      }
    };
    put(decks, lego ? LEGO.darkGray : 0x55595e);
    put(rails, lego ? LEGO.lightGray : 0xb9bec4);
    put(piers, lego ? LEGO.lightGray : 0x9a9fa5);
    const c = new THREE.Color();
    for (const part of chunks.values()) {
      const im = new THREE.InstancedMesh(box, material, part.length);
      part.forEach(([mm, hex], i) => {
        im.setMatrixAt(i, mm);
        im.setColorAt(i, c.setHex(hex));
      });
      im.computeBoundingSphere();
      im.receiveShadow = true; // (no shadow of their own: a second drawing of every bridge each frame)
      scene.add(im);
      meshes.push(im);
    }
  }
}

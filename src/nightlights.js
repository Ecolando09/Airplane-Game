import * as THREE from 'three';

// City lights at night, drawn as soft glowing points:
//  - street lamps along the roads (every look);
//  - lit windows on the buildings, for the Google 3D look, whose photo mesh has
//    no night version: the map's building outlines say where the windows are.
// Shown only after dark, fading in with the night amount.

let glowTex = null;
/** A soft round glow (drawn once on a canvas). */
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/** A Points cloud of glows from flat position and colour arrays. */
export function glowPoints(pos, col, size) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: true,
  });
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  p.renderOrder = 2;
  return p;
}

const LAMP_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified']);

export class NightLights {
  /** @param opts.windows draw lit windows (Google 3D) */
  constructor(scene, world, { windows = false, budget = 1 } = {}) {
    this.scene = scene;
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // Street lamps: every 45 m along the roads, orange sodium and white LED.
    const lp = [];
    const lc = [];
    const maxLamps = Math.round(30000 * budget);
    for (const l of world.data.lines) {
      if (!LAMP_ROADS.has(l.k) || lp.length / 3 >= maxLamps) continue;
      let carry = 0;
      for (let i = 2; i < l.p.length; i += 2) {
        const x0 = l.p[i - 2];
        const z0 = l.p[i - 1];
        const dx = l.p[i] - x0;
        const dz = l.p[i + 1] - z0;
        const len = Math.hypot(dx, dz);
        for (let s = 45 - carry; s < len; s += 45) {
          const x = x0 + (dx * s) / len;
          const z = z0 + (dz * s) / len;
          lp.push(x, world.groundAt(x, z) + 7, z);
          const warm = rand() < 0.7;
          lc.push(1, warm ? 0.62 : 0.92, warm ? 0.25 : 0.8);
        }
        carry = (len + carry) % 45;
      }
    }
    this.lamps = glowPoints(lp, lc, 9);
    scene.add(this.lamps);
    // Lit windows (Google 3D): random spots on each building's walls, more on taller ones.
    this.windows = null;
    if (windows) {
      const wp = [];
      const wc = [];
      const maxWin = Math.round(90000 * budget);
      for (const c of world.byId) {
        if (wp.length / 3 >= maxWin) break;
        if (c.t === 'tree' || c.lm || !(c.h > 6)) continue;
        // The footprint's outline: a rotated box, or the polygon itself.
        let ring;
        if (c.t === 'box') ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [c.x + a * c.hw * c.c - b * c.hd * c.s, c.z + a * c.hw * c.s + b * c.hd * c.c]);
        else if (c.p) {
          ring = [];
          for (let i = 0; i < c.p.length; i += 2) ring.push([c.p[i], c.p[i + 1]]);
        } else continue;
        let per = 0;
        for (let i = 0; i < ring.length; i++) per += Math.hypot(ring[(i + 1) % ring.length][0] - ring[i][0], ring[(i + 1) % ring.length][1] - ring[i][1]);
        const n = Math.min(60, Math.round((per * c.h) / 900));
        const base = c.base ?? world.groundAt(ring[0][0], ring[0][1]);
        for (let k = 0; k < n; k++) {
          if (rand() > 0.55) continue; // only some windows are lit
          // A point along the outline, pushed out a little so it shows on the wall.
          let d = rand() * per;
          let i = 0;
          let seg = 0;
          for (; i < ring.length; i++) {
            seg = Math.hypot(ring[(i + 1) % ring.length][0] - ring[i][0], ring[(i + 1) % ring.length][1] - ring[i][1]);
            if (d <= seg) break;
            d -= seg;
          }
          const a = ring[i % ring.length];
          const b = ring[(i + 1) % ring.length];
          const t = seg ? d / seg : 0;
          const x = a[0] + (b[0] - a[0]) * t;
          const z = a[1] + (b[1] - a[1]) * t;
          const nx = b[1] - a[1];
          const nz = -(b[0] - a[0]);
          const nl = Math.hypot(nx, nz) || 1;
          const y = base + 3 + Math.floor((rand() * Math.max(1, c.h - 4)) / 3.2) * 3.2;
          wp.push(x + (nx / nl) * 0.8, y, z + (nz / nl) * 0.8);
          const tone = rand();
          if (tone < 0.65) wc.push(1, 0.82, 0.5); // warm
          else if (tone < 0.9) wc.push(0.85, 0.9, 1); // cool white
          else wc.push(0.55, 0.75, 1); // TV blue
        }
      }
      this.windows = glowPoints(wp, wc, 5);
      scene.add(this.windows);
    }
    this.setNight(0);
  }

  /** 0 = day (hidden) .. 1 = full night. */
  setNight(v) {
    for (const p of [this.lamps, this.windows]) {
      if (!p) continue;
      p.visible = v > 0.15;
      p.material.opacity = Math.min(1, v * 1.2);
    }
  }

  dispose() {
    for (const p of [this.lamps, this.windows]) {
      if (!p) continue;
      this.scene.remove(p);
      p.geometry.dispose();
      p.material.dispose();
    }
  }
}

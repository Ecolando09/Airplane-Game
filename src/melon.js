import * as THREE from 'three';
import { SQUID } from './squidbrain.js';

// Giant watermelons (plan 07, the owner's idea): the robot and every aircraft
// carry an endless supply, one throw every 1.5 s. One that hits the giant squid
// bursts and electrocutes it (stunned, hurt, it drops whoever it holds). A miss
// splashes on water or splats on land and breaks nothing: watermelons are a
// squid tool, not a second smash button. Nobody explains why they're electric.

const G = 30; // the same gravity as thrown cars
const LIFE = 6; // seconds in the air at most
export const MELON_COOLDOWN = 1.5;
const R = 1.4; // a beach-ball-sized melon (in this giant world)

let melonTex = null;
function stripes() {
  if (melonTex) return melonTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#3f9b3a';
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#1f5e22';
  for (let i = 0; i < 8; i++) {
    g.beginPath();
    for (let y = 0; y <= 64; y += 4) g.lineTo(i * 16 + 4 + Math.sin(y * 0.3 + i) * 2.5, y);
    for (let y = 64; y >= 0; y -= 4) g.lineTo(i * 16 + 10 + Math.sin(y * 0.3 + i) * 2.5, y);
    g.fill();
  }
  melonTex = new THREE.CanvasTexture(c);
  melonTex.colorSpace = THREE.SRGBColorSpace;
  return melonTex;
}

export class Melons {
  /**
   * hooks: squid() → the SquidPlay (or null), burst(x, y, z, size, hex, n),
   *        noise(kind, size), sound(kind), message(html, s)
   */
  constructor(scene, world, hooks) {
    Object.assign(this, { scene, world, hooks });
    this.geo = new THREE.SphereGeometry(R, 16, 12).scale(1, 0.82, 0.82);
    this.mat = new THREE.MeshLambertMaterial({ map: stripes() });
    this.flying = [];
    this.arcs = []; // lightning on stunned squids: { sq, t, line }
    this.thrown = 0;
  }

  /** Throw one from p with velocity v. mine: this player's (decides hits); else a friend's (just for show). */
  launch(p, v, { mine = true, at = null } = {}) {
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.position.copy(p);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.flying.push({ mesh, v: v.clone(), t: 0, mine, at, spin: 4 + Math.random() * 3 });
    if (mine) this.thrown++;
    this.hooks.sound('melon');
  }

  update(dt) {
    const w = this.world;
    for (const m of [...this.flying]) {
      m.t += dt;
      const p = m.mesh.position;
      let done = m.t > LIFE;
      // Thrown from the squid's own grip: it flies straight at the squid and always hits.
      if (m.at) {
        const tgt = new THREE.Vector3(m.at.spot.x, m.at.spot.y + 8, m.at.spot.z);
        const d = tgt.clone().sub(p);
        const step = 60 * dt;
        if (d.length() <= step) {
          p.copy(tgt);
          if (m.mine) this._hit(m, m.at);
          else this._remove(m);
          continue;
        }
        p.addScaledVector(d.normalize(), step);
      } else {
        m.v.y -= G * dt;
        const steps = Math.max(1, Math.ceil((m.v.length() * dt) / 3));
        for (let i = 0; i < steps && !done; i++) {
          p.addScaledVector(m.v, dt / steps);
          // A hit on the squid (anywhere within its body or raised arms).
          const sq = m.mine ? this.hooks.squid()?.melonHit(p) : null;
          if (sq) {
            this._hit(m, sq);
            done = 'hit';
            break;
          }
          const ground = w.heightAt(p.x, p.z);
          if (p.y - R * 0.6 <= ground) {
            p.y = ground;
            if (w.isWater(p.x, p.z)) {
              this.hooks.burst(p.x, p.y + 0.5, p.z, 4, 0xe8f6ff, 10); // splash
              this.hooks.noise('splash', 0.3);
            } else {
              this.hooks.burst(p.x, p.y + 0.5, p.z, 3, 0xe63946, 8); // harmless splat
              this.hooks.burst(p.x, p.y + 0.5, p.z, 2, 0x3f9b3a, 4);
            }
            done = true;
          }
        }
        if (done === 'hit') continue;
      }
      m.mesh.rotation.x += m.spin * dt;
      m.mesh.rotation.z += m.spin * 0.7 * dt;
      if (done) this._remove(m);
    }
    this._updateArcs(dt);
  }

  _hit(m, sq) {
    const p = m.mesh.position;
    // Red chunks and seeds.
    this.hooks.burst(p.x, p.y, p.z, 6, 0xe63946, 16);
    this.hooks.burst(p.x, p.y, p.z, 3, 0x1b1b1b, 8);
    this.hooks.burst(p.x, p.y, p.z, 4, 0x3f9b3a, 6);
    this._remove(m);
    if (m.mine) this.hooks.squid()?.hit(sq, 'melon', SQUID.MELON);
  }

  _remove(m) {
    this.scene.remove(m.mesh);
    this.flying.splice(this.flying.indexOf(m), 1);
  }

  /** Blue lightning crawling over a stunned squid for 3 seconds, with a crackle. */
  zap(sq) {
    const line = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x8fd8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    line.frustumCulled = false;
    line.renderOrder = 4;
    this.scene.add(line);
    this.arcs.push({ sq, t: 0, line, next: 0 });
    this.hooks.noise('crackle', 1);
  }

  _updateArcs(dt) {
    for (const a of [...this.arcs]) {
      a.t += dt;
      if (a.t > 3) {
        this.scene.remove(a.line);
        a.line.geometry.dispose();
        this.arcs.splice(this.arcs.indexOf(a), 1);
        continue;
      }
      a.next -= dt;
      if (a.next > 0) continue;
      a.next = 0.07; // new jagged bolts several times a second
      if (Math.random() < 0.3) this.hooks.noise('crackle', 0.4);
      const sp = a.sq.spot;
      const k = a.sq.s.boss ? 1.25 : 1;
      const top = (a.sq.model?.group.position.y ?? sp.y) - sp.y;
      const pts = [];
      for (let b = 0; b < 7; b++) {
        // A bolt from the mantle out along an arm, in jagged steps.
        const ang = Math.random() * Math.PI * 2;
        let x = sp.x + (Math.random() - 0.5) * 6 * k;
        let y = sp.y + top + (4 + Math.random() * 20) * k;
        let z = sp.z + (Math.random() - 0.5) * 6 * k;
        for (let s = 0; s < 6; s++) {
          const nx = x + Math.cos(ang) * 5 * k + (Math.random() - 0.5) * 5;
          const ny = y + (Math.random() - 0.6) * 5;
          const nz = z + Math.sin(ang) * 5 * k + (Math.random() - 0.5) * 5;
          pts.push(x, y, z, nx, ny, nz);
          x = nx;
          y = ny;
          z = nz;
        }
      }
      a.line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      a.line.material.opacity = 0.6 + Math.random() * 0.4;
    }
  }

  dispose() {
    for (const m of this.flying) this.scene.remove(m.mesh);
    for (const a of this.arcs) this.scene.remove(a.line);
    this.flying = [];
    this.arcs = [];
  }
}

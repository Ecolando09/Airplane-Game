import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LEGO, legoMaterial, isLego } from './lego.js';
import { buildLandmark } from './landmarks.js';

const CHUNK = 1600; // meters per culling chunk
const GRID = 200; // meters per collision cell
const RUBBLE = 2.2; // height of the slab a knocked-down building leaves, above its base

const canvasTex = (w, h, draw) => {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const pick = (arr, r) => arr[Math.floor(r * arr.length) % arr.length];

// Deterministic random so the city looks the same every load.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class World {
  /**
   * @param {object} opts.satImage  satellite photo of the map area (realistic look)
   */
  constructor(scene, data, { satImage = null } = {}) {
    this.scene = scene;
    this.data = data;
    this.satImage = satImage;
    this.meshes = []; // everything a Google 3D-tiles world replaces
    [this.sizeX, this.sizeZ] = data.size;
    this.halfX = this.sizeX / 2;
    this.halfZ = this.sizeZ / 2;
    this.rand = rng(42);
    this.colliders = new Map();
    this.animate = []; // per-frame updates for moving landmarks: fn(time)
    this._collapses = []; // buildings on their way down

    this._setupElevation();
    this._buildWaterMask();
    this.mapCanvas = this._drawMap();
    this._buildTerrain();
    this._buildRunway();
    this._buildBuildings();
    this._buildTrees();
    this._buildCustom();
    this._buildHelipad();
    this._buildClouds();
    this.landmarks = data.landmarks.map((l) => ({ ...l, y: this.heightAt(l.x, l.z) }));
    this.locators = this._buildLocators(data.locators || []);
  }

  // ------------------------------------------------------------ water & pins
  _buildWaterMask() {
    const S = (this.waterRes = 2048);
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const sx = S / this.sizeX;
    const sz = S / this.sizeZ;
    const path = (p) => {
      g.beginPath();
      for (let i = 0; i < p.length; i += 2) {
        const X = (p[i] + this.halfX) * sx;
        const Y = (p[i + 1] + this.halfZ) * sz;
        i ? g.lineTo(X, Y) : g.moveTo(X, Y);
      }
    };
    g.fillStyle = g.strokeStyle = '#fff';
    for (const w of this.data.water) {
      waterPath(g, w, (x, z) => [(x + this.halfX) * sx, (z + this.halfZ) * sz]);
      g.fill('evenodd');
    }
    g.lineCap = 'round';
    for (const st of this.data.streams) {
      // Generous widths so floatplanes can set down on the creeks and river.
      g.lineWidth = Math.max(2, (st.k === 'river' ? 40 : 18) * sx);
      path(st.p);
      g.stroke();
    }
    const px = g.getImageData(0, 0, S, S).data;
    this.waterMask = new Uint8Array(S * S);
    for (let i = 0; i < S * S; i++) this.waterMask[i] = px[i * 4] > 100 ? 1 : 0;
  }

  isWater(x, z) {
    const S = this.waterRes;
    const i = Math.floor(((x + this.halfX) / this.sizeX) * S);
    const j = Math.floor(((z + this.halfZ) / this.sizeZ) * S);
    if (i < 0 || j < 0 || i >= S || j >= S) return false;
    return this.waterMask[j * S + i] === 1;
  }

  _buildLocators(list) {
    const COLORS = { home: LEGO.blue, pin: LEGO.red, park: LEGO.green };
    return list.map((l) => {
      const color = COLORS[l.kind] ?? LEGO.red;
      const y = this.heightAt(l.x, l.z);
      const group = new THREE.Group();
      group.position.set(l.x, y, l.z);
      // Light beam so the spot can be found from far away.
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(6, 6, 700, 16, 1, true).translate(0, 350, 0),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, fog: false })
      );
      group.add(beam);
      // Map pin made of round Lego parts: a ball on a cone, pointing at the spot.
      const pin = new THREE.Group();
      pin.position.y = 110;
      const ballMat = legoMaterial({ color, emissive: color, emissiveIntensity: 0.25 });
      const ball = new THREE.Mesh(new THREE.SphereGeometry(20, 24, 16), ballMat);
      ball.position.y = 26;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(15, 46, 20).rotateX(Math.PI), ballMat);
      const dot = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 4, 16).rotateX(Math.PI / 2), legoMaterial({ color: LEGO.white }));
      dot.position.set(0, 26, 18.5);
      pin.add(ball, cone, dot);
      group.add(pin);
      // Ring on the ground marking the exact spot.
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(18, 26, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false })
      );
      ring.position.y = 1.5;
      group.add(ring);
      this.scene.add(group);
      return { ...l, y, color, pin, group };
    });
  }

  /** Animate the map pins. */
  update(t) {
    for (const l of this.locators) {
      l.pin.rotation.y = t * 1.2;
      l.pin.position.y = 110 + Math.sin(t * 2) * 5;
    }
    for (const fn of this.animate) fn(t);
    this._updateCollapses(t);
  }

  // ---------------------------------------------------------------- terrain
  _setupElevation() {
    const { n, h } = this.data.elev;
    this.n = n;
    this.dx = this.sizeX / (n - 1);
    this.dz = this.sizeZ / (n - 1);
    let min = Infinity;
    for (const v of h) min = Math.min(min, v);
    this.baseElevation = min; // meters above sea level at y = 0
    this.h = Float32Array.from(h, (v) => v - min);

    // Flatten the airfield around the runway.
    const rw = this.data.runway;
    const hd = THREE.MathUtils.degToRad(rw.heading);
    rw.fx = Math.sin(hd);
    rw.fz = -Math.cos(hd);
    let sum = 0;
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20 - 0.5) * rw.length;
      sum += this._rawHeight(rw.x + rw.fx * a, rw.z + rw.fz * a);
    }
    rw.y = sum / 21;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -this.halfX + i * this.dx;
        const z = -this.halfZ + j * this.dz;
        const ox = x - rw.x;
        const oz = z - rw.z;
        const along = Math.abs(ox * rw.fx + oz * rw.fz) - rw.length / 2 - 120;
        const across = Math.abs(-ox * rw.fz + oz * rw.fx) - rw.width / 2 - 90;
        const d = Math.max(along, across, 0);
        const t = smoothstep(0, 300, d);
        this.h[j * n + i] = rw.y * (1 - t) + this.h[j * n + i] * t;
      }
    }
    this.runway = rw;
  }

  _rawHeight(x, z) {
    const { n } = this;
    const fi = THREE.MathUtils.clamp((x + this.halfX) / this.dx, 0, n - 1.001);
    const fj = THREE.MathUtils.clamp((z + this.halfZ) / this.dz, 0, n - 1.001);
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const u = fi - i;
    const v = fj - j;
    const h = this.h;
    const a = h[j * n + i];
    const b = h[j * n + i + 1];
    const c = h[(j + 1) * n + i];
    const d = h[(j + 1) * n + i + 1];
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }

  /** Ground height (meters above the lowest point of the map). */
  heightAt(x, z) {
    // Matches the triangulated terrain mesh closely enough for gameplay.
    return this._rawHeight(x, z);
  }

  isOnRunway(x, z) {
    const rw = this.runway;
    const ox = x - rw.x;
    const oz = z - rw.z;
    return (
      Math.abs(ox * rw.fx + oz * rw.fz) < rw.length / 2 + 30 &&
      Math.abs(-ox * rw.fz + oz * rw.fx) < rw.width / 2 + 10
    );
  }

  _drawMap() {
    const S = 4096;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const sx = S / this.sizeX;
    const sz = S / this.sizeZ;
    const path = (p, close) => {
      g.beginPath();
      for (let i = 0; i < p.length; i += 2) {
        const X = (p[i] + this.halfX) * sx;
        const Y = (p[i + 1] + this.halfZ) * sz;
        i ? g.lineTo(X, Y) : g.moveTo(X, Y);
      }
      if (close) g.closePath();
    };
    const hex = (c) => '#' + c.toString(16).padStart(6, '0');

    g.fillStyle = this.data.ground || '#58ab41';
    g.fillRect(0, 0, S, S);
    const LAND = {
      campus: '#8fc27a', paved: '#b5b8b6', park: '#6cbf55', forest: '#2f8a45',
      golf: '#9ccf4a', pitch: '#3e9a48', track: '#b4543c', sand: hex(LEGO.tan),
    };
    for (const l of this.data.land) {
      g.fillStyle = LAND[l.k];
      path(l.p, true);
      g.fill();
    }
    g.fillStyle = hex(LEGO.lightBlue);
    for (const w of this.data.water) {
      waterPath(g, w, (x, z) => [(x + this.halfX) * sx, (z + this.halfZ) * sz]);
      g.fill('evenodd');
    }
    g.lineCap = g.lineJoin = 'round';
    g.strokeStyle = hex(LEGO.lightBlue);
    for (const s of this.data.streams) {
      g.lineWidth = (s.k === 'river' ? 30 : 9) * sx;
      path(s.p);
      g.stroke();
    }

    const W = { motorway: 22, trunk: 18, primary: 14, secondary: 12, tertiary: 10, residential: 7,
      unclassified: 7, living_street: 6, service: 4.5, unknown: 6, rail: 4 };
    const order = ['rail', 'service', 'unknown', 'living_street', 'unclassified', 'residential',
      'tertiary', 'secondary', 'primary', 'trunk', 'motorway'];
    const byKind = new Map(order.map((k) => [k, []]));
    for (const l of this.data.lines) byKind.get(l.k)?.push(l);
    // Curbs first (wider, lighter), then asphalt on top so roads look joined.
    for (const pass of ['curb', 'road']) {
      for (const k of order) {
        if (k === 'rail' && pass === 'curb') continue;
        g.lineWidth = (W[k] + (pass === 'curb' ? 3 : 0)) * sx;
        g.strokeStyle = pass === 'curb' ? '#c9c4b5' : k === 'rail' ? hex(LEGO.reddishBrown)
          : k === 'motorway' || k === 'trunk' ? '#4d4f4b' : hex(LEGO.darkGray);
        for (const l of byKind.get(k)) {
          path(l.p);
          g.stroke();
        }
      }
    }
    g.setLineDash([6 * sx, 6 * sx]);
    g.lineWidth = 0.8 * sx;
    g.strokeStyle = hex(LEGO.yellow);
    for (const k of ['motorway', 'trunk', 'primary']) {
      for (const l of byKind.get(k)) {
        path(l.p);
        g.stroke();
      }
    }
    g.setLineDash([]);
    return cv;
  }

  _buildTerrain() {
    const { n } = this;
    const geo = new THREE.PlaneGeometry(this.sizeX, this.sizeZ, n - 1, n - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let k = 0; k < pos.count; k++) pos.setY(k, this.h[k]);
    geo.computeVertexNormals();

    // Lego look: the drawn map; realistic look: the satellite photo.
    const tex = this.satImage ? new THREE.Texture(this.satImage) : new THREE.CanvasTexture(this.mapCanvas);
    tex.needsUpdate = true;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const ground = new THREE.Mesh(geo, legoMaterial({ map: tex, studs: 6 }));
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.meshes.push(ground);

    // Ground beyond the mapped area: continues the edge heights outward (so hills
    // at the edge don't end in a cliff) and fades into the fog. It sits a little
    // below the map so the detailed terrain always wins where they overlap.
    const og = new THREE.PlaneGeometry(120000, 120000, 240, 240).rotateX(-Math.PI / 2);
    const op = og.attributes.position;
    // Where the map's edge is sea (or a big lake), the ground beyond it is water too.
    const land = new THREE.Color(isLego() ? (this.data.ground || 0x58ab41) : 0x6f7f4f);
    const sea = new THREE.Color(isLego() ? LEGO.lightBlue : 0x2f5d73);
    const colors = new Float32Array(op.count * 3);
    for (let k = 0; k < op.count; k++) {
      const x = op.getX(k);
      const z = op.getZ(k);
      const inside = Math.abs(x) < this.halfX - 10 && Math.abs(z) < this.halfZ - 10;
      op.setY(k, this._rawHeight(x, z) - (inside ? 60 : 6));
      const ex = THREE.MathUtils.clamp(x, -this.halfX + 30, this.halfX - 30);
      const ez = THREE.MathUtils.clamp(z, -this.halfZ + 30, this.halfZ - 30);
      (this.isWater(ex, ez) ? sea : land).toArray(colors, k * 3);
    }
    og.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    og.computeVertexNormals();
    const outer = new THREE.Mesh(og, legoMaterial({ vertexColors: true, studs: 6 }));
    this.scene.add(outer);
    this.meshes.push(outer);
  }

  _buildRunway() {
    const rw = this.runway;
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 8192;
    const g = cv.getContext('2d');
    const ky = cv.height / rw.length;
    g.fillStyle = '#55575a';
    g.fillRect(0, 0, 256, 8192);
    g.fillStyle = '#f4f4f4';
    g.fillRect(8, 0, 6, 8192);
    g.fillRect(242, 0, 6, 8192);
    for (let y = 60 * ky; y < 8192 - 60 * ky; y += 60 * ky) g.fillRect(124, y, 8, 36 * ky);
    for (const end of [0, 1]) {
      for (let i = 0; i < 8; i++) {
        const x = 24 + i * 26 + (i >= 4 ? 12 : 0);
        g.fillRect(x, end ? 8192 - 24 - 30 * ky : 24, 14, 30 * ky);
      }
    }
    g.font = 'bold 110px sans-serif';
    g.textAlign = 'center';
    g.save();
    g.translate(128, 8192 - 40 * ky);
    g.fillText(rw.names?.[0] ?? '', 0, 0);
    g.restore();
    g.save();
    g.translate(128, 40 * ky);
    g.rotate(Math.PI);
    g.fillText(rw.names?.[1] ?? '', 0, 0);
    g.restore();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(rw.width, rw.length).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2 })
    );
    mesh.position.set(rw.x, rw.y + 0.15, rw.z);
    mesh.rotation.y = -THREE.MathUtils.degToRad(rw.heading);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.meshes.push(mesh);

    // Hangar row and windsock-style beacon so the airport reads from the air.
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 2, 18, 8),
      legoMaterial({ color: LEGO.orange, studs: 0.8 })
    );
    const bx = rw.x + rw.fz * -80;
    const bz = rw.z - rw.fx * -80;
    beacon.position.set(bx, this.heightAt(bx, bz) + 9, bz);
    this.scene.add(beacon);
    this.meshes.push(beacon);
  }

  // -------------------------------------------------------------- buildings
  _chunkKey(x, z) {
    return `${Math.floor((x + this.halfX) / CHUNK)},${Math.floor((z + this.halfZ) / CHUNK)}`;
  }

  _addCollider(c, minx, minz, maxx, maxz) {
    for (let gx = Math.floor(minx / GRID); gx <= Math.floor(maxx / GRID); gx++) {
      for (let gz = Math.floor(minz / GRID); gz <= Math.floor(maxz / GRID); gz++) {
        const k = gx * 100000 + gz;
        let list = this.colliders.get(k);
        if (!list) this.colliders.set(k, (list = []));
        list.push(c);
      }
    }
  }

  _buildBuildings() {
    const r = this.rand;
    const lego = isLego();
    // Lego look: bright brick colors. Realistic look: siding, brick, concrete, shingles.
    const WALLS = lego
      ? [LEGO.white, LEGO.tan, LEGO.lightGray, LEGO.yellow, LEGO.lightBlue, LEGO.sandGreen, LEGO.white, LEGO.tan, LEGO.medAzure]
      : [0xe8e2d4, 0xd9cfbb, 0xc9c3b6, 0xb8a58a, 0xe2dccf, 0x9c6b52, 0xcfd3d0, 0xa9b4b0];
    const BIG = lego
      ? [LEGO.lightGray, LEGO.white, LEGO.tan, LEGO.darkTan, LEGO.red, LEGO.blue, LEGO.darkGray, LEGO.lightGray, LEGO.sandGreen]
      : [0xb9b6ae, 0xd3cec3, 0x8f8a80, 0xa0533f, 0xc4b59a, 0x9aa3a8, 0x7a7b78, 0xbfb8aa];
    const ROOFS = lego
      ? [LEGO.red, LEGO.darkRed, LEGO.black, LEGO.darkGray, LEGO.reddishBrown, LEGO.blue]
      : [0x4a4a48, 0x5b4d44, 0x3d3f42, 0x6b5a4c, 0x55504a, 0x2f3236];

    const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const roofGeo = prismGeometry();
    const wallMat = legoMaterial({ studs: 2.4, windows: true });
    const roofMat = legoMaterial({});

    const chunks = new Map();
    const chunk = (x, z) => {
      const k = this._chunkKey(x, z);
      if (!chunks.has(k)) chunks.set(k, { boxes: [], roofs: [], polys: [], polyCols: [] });
      return chunks.get(k);
    };

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();

    for (const [x, z, w, d, h, ang, house] of this.data.boxes) {
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      let gmin = Infinity;
      let gmax = -Infinity;
      for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [0, 0]]) {
        const gy = this.heightAt(x + (a * w * c - b * d * s) / 2, z + (a * w * s + b * d * c) / 2);
        gmin = Math.min(gmin, gy);
        gmax = Math.max(gmax, gy);
      }
      const base = gmin - 1;
      const top = gmax + h;
      q.setFromAxisAngle(up, -ang);
      m.compose(new THREE.Vector3(x, base, z), q, new THREE.Vector3(w, top - base, d));
      const ch = chunk(x, z);
      const cl = { t: 'box', x, z, c, s, hw: w / 2, hd: d / 2, base, h: top - base };
      ch.boxes.push([m.clone(), col.setHex(pick(house ? WALLS : BIG, r())).clone(), cl, 'wall']);
      let roofTop = top;
      if (house) {
        const rh = Math.min(w, d) * 0.42;
        // Ridge runs along the longer side.
        const ridgeAlongW = w >= d;
        q.setFromAxisAngle(up, -ang + (ridgeAlongW ? 0 : Math.PI / 2));
        m.compose(new THREE.Vector3(x, top, z), q,
          new THREE.Vector3(ridgeAlongW ? w + 0.6 : d + 0.6, rh, ridgeAlongW ? d + 0.6 : w + 0.6));
        ch.roofs.push([m.clone(), col.setHex(pick(ROOFS, r())).clone(), cl, 'roof']);
        roofTop += rh;
      }
      const R = Math.hypot(w, d) / 2;
      cl.top = roofTop;
      this._addCollider(cl, x - R + this.halfX, z - R + this.halfZ, x + R + this.halfX, z + R + this.halfZ);
    }

    for (const { p, h } of this.data.polys) {
      const pts = [];
      let gmin = Infinity;
      let gmax = -Infinity;
      let minx = Infinity;
      let minz = Infinity;
      let maxx = -Infinity;
      let maxz = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        pts.push(new THREE.Vector2(p[i], -p[i + 1]));
        const gy = this.heightAt(p[i], p[i + 1]);
        gmin = Math.min(gmin, gy);
        gmax = Math.max(gmax, gy);
        minx = Math.min(minx, p[i]);
        maxx = Math.max(maxx, p[i]);
        minz = Math.min(minz, p[i + 1]);
        maxz = Math.max(maxz, p[i + 1]);
      }
      const base = gmin - 1;
      const top = gmax + h;
      const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: top - base, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, base, 0);
      geo.deleteAttribute('uv');
      col.setHex(pick(BIG, r()));
      const colors = new Float32Array(geo.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) col.toArray(colors, i);
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const cl = { t: 'poly', p, top, base, h: top - base, minx, minz, maxx, maxz, color: col.getHex(),
        x: (minx + maxx) / 2, z: (minz + maxz) / 2 };
      const pc = chunk(cl.x, cl.z);
      pc.polys.push(geo);
      pc.polyCols.push(cl);
      this._addCollider(cl, minx + this.halfX, minz + this.halfZ, maxx + this.halfX, maxz + this.halfZ);
    }

    const polyMat = legoMaterial({ studs: 2.4, windows: true, vertexColors: true });
    for (const ch of chunks.values()) {
      for (const [list, geo, mat] of [[ch.boxes, boxGeo, wallMat], [ch.roofs, roofGeo, roofMat]]) {
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach(([mm, cc, cl, part], i) => {
          im.setMatrixAt(i, mm);
          im.setColorAt(i, cc);
          cl[part] = [im, i]; // so the building can be knocked down later
          if (part === 'wall') cl.color = cc.getHex();
        });
        im.computeBoundingSphere();
        im.castShadow = im.receiveShadow = true;
        this.scene.add(im);
        this.meshes.push(im);
      }
      if (ch.polys.length) {
        const mesh = new THREE.Mesh(mergeGeometries(ch.polys), polyMat);
        let v0 = 0;
        ch.polys.forEach((g, i) => {
          Object.assign(ch.polyCols[i], { mesh, v0, vn: g.attributes.position.count });
          v0 += g.attributes.position.count;
        });
        mesh.castShadow = mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.meshes.push(mesh);
      }
    }
  }

  _buildTrees() {
    const r = this.rand;
    const LEAVES = isLego()
      ? [LEGO.green, LEGO.brightGreen, LEGO.green, 0x2f6b3a, LEGO.sandGreen, 0x7fa83a]
      : [0x3f5e2c, 0x4a6b33, 0x355228, 0x56713a, 0x2f4a24];
    const trunkGeo = new THREE.CylinderGeometry(0.7, 0.9, 5, 6).translate(0, 2.5, 0);
    const roundGeo = new THREE.CylinderGeometry(4, 4, 7, 8).translate(0, 7.5, 0);
    const topGeo = new THREE.CylinderGeometry(2.6, 2.6, 2.4, 8).translate(0, 12.2, 0);
    const pineGeo = new THREE.ConeGeometry(4, 13, 8).translate(0, 10.5, 0);
    const leafMat = legoMaterial({ studs: 1.6 });
    const trunkMat = legoMaterial({ color: LEGO.reddishBrown });

    const chunks = new Map();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    for (const [x, z, pine, s] of this.data.trees) {
      const k = this._chunkKey(x, z);
      if (!chunks.has(k)) chunks.set(k, { trunk: [], round: [], pine: [] });
      const ch = chunks.get(k);
      const y = this.heightAt(x, z) - 0.5;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
      const c = col.setHex(pick(LEAVES, r())).clone();
      const cl = { t: 'tree', x, z, rad: 3.5 * s, top: y + 13 * s, base: y, h: 13 * s, color: c.getHex(), parts: [] };
      ch.trunk.push([m.clone(), null, cl]);
      (pine ? ch.pine : ch.round).push([m.clone(), c, cl]);
      this._addCollider(cl, x - 4 + this.halfX, z - 4 + this.halfZ, x + 4 + this.halfX, z + 4 + this.halfZ);
    }
    for (const ch of chunks.values()) {
      const parts = [[ch.trunk, trunkGeo, trunkMat], [ch.round, roundGeo, leafMat],
        [ch.round, topGeo, leafMat], [ch.pine, pineGeo, leafMat]];
      for (const [list, geo, mat] of parts) {
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach(([mm, cc, cl], i) => {
          im.setMatrixAt(i, mm);
          if (cc) im.setColorAt(i, cc);
          cl.parts.push([im, i]);
        });
        im.computeBoundingSphere();
        im.castShadow = true;
        this.scene.add(im);
        this.meshes.push(im);
      }
    }
  }

  _buildClouds() {
    const r = this.rand;
    const list = [];
    const m = new THREE.Matrix4();
    for (let c = 0; c < 70; c++) {
      const cx = (r() - 0.5) * this.sizeX * 1.6;
      const cz = (r() - 0.5) * this.sizeZ * 1.6;
      const cy = 450 + r() * 350;
      const parts = 4 + Math.floor(r() * 6);
      for (let i = 0; i < parts; i++) {
        const w = 40 + r() * 90;
        const d = 30 + r() * 70;
        m.compose(
          new THREE.Vector3(cx + (r() - 0.5) * 140, cy + Math.floor(r() * 3) * 19, cz + (r() - 0.5) * 100),
          new THREE.Quaternion(),
          new THREE.Vector3(w, 19, d)
        );
        list.push(m.clone());
      }
    }
    // Lego look: brick clouds. Realistic look: soft puffs.
    const im = new THREE.InstancedMesh(
      isLego() ? new THREE.BoxGeometry(1, 1, 1) : new THREE.SphereGeometry(0.75, 14, 10),
      legoMaterial({ color: 0xffffff, studs: 8, emissive: isLego() ? 0x555555 : 0x8a8a8a }),
      list.length
    );
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.computeBoundingSphere();
    this.scene.add(im);
  }

  /** Hospital helipad where the helicopter starts: a painted pad with a big H. */
  _buildHelipad() {
    const hp = this.data.helipad;
    if (!hp) return;
    hp.y = this.heightAt(hp.x, hp.z);
    const tex = canvasTex(256, 256, (g) => {
      g.fillStyle = '#5a5d61';
      g.fillRect(0, 0, 256, 256);
      g.strokeStyle = '#f4f4f4';
      g.lineWidth = 12;
      g.beginPath();
      g.arc(128, 128, 104, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#f4f4f4';
      g.font = 'bold 150px Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('H', 128, 136);
      g.strokeStyle = '#f2cd37';
      g.lineWidth = 8;
      g.strokeRect(6, 6, 244, 244);
    });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(22, 22).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2 }));
    pad.position.set(hp.x, hp.y + 0.25, hp.z);
    pad.receiveShadow = true;
    this.scene.add(pad);
    this.meshes.push(pad);
  }

  // ------------------------------------------------------- custom buildings
  _buildCustom() {
    for (const c of this.data.custom || []) {
      if (c.kind === 'dennys') this._buildDennys(c);
      else buildLandmark(this, c);
    }
    for (const s of this.data.structures || []) buildLandmark(this, s);
  }

  /**
   * Denny's Tower (203 E Main St): a tall tan slab with a deep window grid, a
   * darker set-back section on one end, a rounded top with a round porthole,
   * a recessed band of fins near the top and the yellow Denny's sign.
   */
  _buildDennys({ x, z, w, d, ang, h }) {
    const g = new THREE.Group();
    const base = Math.min(...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) =>
      this.heightAt(x + (a * w * Math.cos(ang) - b * d * Math.sin(ang)) / 2, z + (a * w * Math.sin(ang) + b * d * Math.cos(ang)) / 2))) - 1;
    g.position.set(x, base, z);
    g.rotation.y = -ang; // local X runs along the long side
    const tan = isLego() ? LEGO.tan : 0xd8c49a;
    const tanDark = isLego() ? LEGO.darkTan : 0xb39f78;
    const box = (sx, sy, sz, px, py, pz, color, windows = true) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), legoMaterial({ color, windows, studs: 2.4 }));
      m.position.set(px, py + sy / 2, pz);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      return m;
    };
    const left = w * 0.3; // darker, set-back section on the left end
    const main = w - left;
    box(main, h, d, left / 2, 0, 0, tan);
    box(left, h - 3, d * 0.92, -main / 2, 0, -d * 0.02, tanDark);
    // Rounded top over the left section with a round porthole in its face.
    const r = left / 2;
    const depth = d * 0.92;
    const arch = new THREE.Shape();
    arch.absarc(0, 0, r, 0, Math.PI, false);
    arch.closePath();
    const archGeo = new THREE.ExtrudeGeometry(arch, { depth, bevelEnabled: false, curveSegments: 24 }).translate(0, 0, -depth / 2);
    const archMesh = new THREE.Mesh(archGeo, legoMaterial({ color: tanDark }));
    archMesh.position.set(-w / 2 + r, h - 3, -d * 0.02);
    archMesh.castShadow = true;
    g.add(archMesh);
    for (const sz of [-1, 1]) {
      const hole = new THREE.Mesh(new THREE.CircleGeometry(r * 0.32, 24), new THREE.MeshBasicMaterial({ color: 0x1e1a14 }));
      hole.position.set(-w / 2 + r, h - 3 + r * 0.42, sz * (depth / 2 + 0.05) - d * 0.02);
      hole.rotation.y = sz > 0 ? 0 : Math.PI;
      g.add(hole);
    }
    // Parapet along the top of the main section.
    box(main, 2.5, d, left / 2, h, 0, tan, false);
    // Recessed band of fins near the top on the right, on both broad faces.
    for (const sz of [-1, 1]) {
      const band = box(main * 0.62, 7, 1.2, left / 2 + main * 0.12, h - 15, sz * (d / 2 + 0.6), tanDark, false);
      for (let i = 0; i < 14; i++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.8), legoMaterial({ color: tan }));
        fin.position.set(band.position.x - main * 0.29 + i * (main * 0.58 / 13), h - 11.5, sz * (d / 2 + 1.3));
        g.add(fin);
      }
    }
    // Denny's signs: the yellow six-sided sign with an orange bottom edge and red
    // outlined lettering, at the top of the tower and lower down above
    // "CORPORATE HEADQUARTERS", on both broad faces.
    const signTex = canvasTex(512, 200, (cx) => {
      const hex = (inset) => {
        cx.beginPath();
        cx.moveTo(40 + inset, 14 + inset);
        cx.lineTo(472 - inset, 14 + inset);
        cx.lineTo(504 - inset, 96);
        cx.lineTo(472 - inset, 186 - inset);
        cx.lineTo(40 + inset, 186 - inset);
        cx.lineTo(8 + inset, 96);
        cx.closePath();
      };
      cx.fillStyle = '#f28c1c'; // orange edge (shows along the bottom)
      hex(0);
      cx.fill();
      cx.save();
      cx.translate(0, -12);
      cx.fillStyle = '#f3d21f';
      hex(6);
      cx.fill();
      cx.restore();
      cx.font = 'italic 900 112px Georgia, "Times New Roman", serif';
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.lineJoin = 'round';
      cx.lineWidth = 10;
      cx.strokeStyle = '#fff6e0';
      cx.strokeText("Denny's", 256, 90);
      cx.fillStyle = '#c0182f';
      cx.fillText("Denny's", 256, 90);
    });
    const hqTex = canvasTex(1024, 96, (cx) => {
      cx.font = '700 64px Helvetica, Arial, sans-serif';
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.fillStyle = '#3a3c42';
      cx.letterSpacing = '6px';
      cx.fillText('CORPORATE HEADQUARTERS', 512, 50);
    });
    const signMat = new THREE.MeshBasicMaterial({ map: signTex, transparent: true });
    const hqMat = new THREE.MeshBasicMaterial({ map: hqTex, transparent: true });
    for (const sz of [-1, 1]) {
      const place = (geo, material, px, py) => {
        const m = new THREE.Mesh(geo, material);
        m.position.set(px, py, sz * (d / 2 + 0.2));
        m.rotation.y = sz > 0 ? 0 : Math.PI;
        g.add(m);
      };
      place(new THREE.PlaneGeometry(10, 3.9), signMat, -w / 2 + left + 6.5, h - 4.5); // top of the tower
      place(new THREE.PlaneGeometry(11, 4.3), signMat, left / 2, 16); // lower sign
      place(new THREE.PlaneGeometry(22, 2.1), hqMat, left / 2, 12.6);
    }
    // Antenna mast.
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 12, 8), legoMaterial({ color: LEGO.lightGray }));
    mast.position.set(left / 2 - main * 0.1, h + 2.5 + 6, 0);
    g.add(mast);
    this.scene.add(g);
    this.meshes.push(g);
    const R = Math.hypot(w, d) / 2;
    this._addCollider({ t: 'box', x, z, c: Math.cos(ang), s: Math.sin(ang), hw: w / 2, hd: d / 2, top: base + h + 2.5 },
      x - R + this.halfX, z - R + this.halfZ, x + R + this.halfX, z + R + this.halfZ);
  }

  /**
   * Where "Start in the air" begins: `dist` meters out from the first landmark
   * and `alt` above it, pointed at it (each city can set its own approach),
   * raised until the first 1.5 km ahead clears the hills and buildings.
   */
  airStart(dist, alt) {
    const sq = this.landmarks[0];
    const cfg = this.data.airStart || {};
    const heading = cfg.heading ?? 40;
    const h = THREE.MathUtils.degToRad(heading);
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    const d = cfg.distance ?? dist;
    const p = { x: sq.x - fx * d, y: sq.y + (cfg.alt ?? alt), z: sq.z - fz * d };
    const clear = () => {
      for (let s = 0; s <= 1500; s += 50) {
        const q = { x: p.x + fx * s, y: p.y, z: p.z + fz * s };
        if (q.y < this.heightAt(q.x, q.z) + 100 || this.hitsObstacle(q, 40)) return false;
      }
      return true;
    };
    for (let i = 0; i < 40 && !clear(); i++) p.y += 25;
    return { ...p, heading };
  }

  // -------------------------------------------------------------- knocking things down
  // Buildings and trees from the map data can be destroyed (robot mode, thrown
  // objects). A building sinks into a low slab of rubble; a tree falls over.
  // Hand-modeled landmarks have no entry here and always stand.

  /** Can this collider be knocked down? */
  breakable(c) {
    return !c.dead && !!(c.wall || c.mesh || c.parts);
  }

  /** Live colliders whose grid cells are within `r` of (x, z). */
  collidersNear(x, z, r) {
    const out = new Set();
    const gx0 = Math.floor((x - r + this.halfX) / GRID);
    const gx1 = Math.floor((x + r + this.halfX) / GRID);
    const gz0 = Math.floor((z - r + this.halfZ) / GRID);
    const gz1 = Math.floor((z + r + this.halfZ) / GRID);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        for (const c of this.colliders.get(gx * 100000 + gz) || []) if (!c.dead) out.add(c);
      }
    }
    return out;
  }

  /** Is (x, z) within `rad` of the collider's footprint? */
  inFootprint(c, x, z, rad = 0) {
    if (c.t === 'box') {
      const dx = x - c.x;
      const dz = z - c.z;
      return Math.abs(dx * c.c + dz * c.s) < c.hw + rad && Math.abs(-dx * c.s + dz * c.c) < c.hd + rad;
    }
    if (c.t === 'tree') return Math.hypot(x - c.x, z - c.z) < c.rad * 0.5 + rad;
    if (x < c.minx - rad || x > c.maxx + rad || z < c.minz - rad || z > c.maxz + rad) return false;
    if (pointInPoly(x, z, c.p)) return true;
    if (!rad) return false;
    return [[rad, 0], [-rad, 0], [0, rad], [0, -rad]].some(([a, b]) => pointInPoly(x + a, z + b, c.p));
  }

  /** For walking: a wall in the way at (x, z) for something whose feet are at feetY? */
  blockedAt(x, z, feetY, rad, height) {
    for (const c of this.colliders.get(Math.floor((x + this.halfX) / GRID) * 100000 + Math.floor((z + this.halfZ) / GRID)) || []) {
      if (c.dead || c.t === 'tree') continue;
      if (c.top < feetY + 2.5 || (c.bottom ?? -Infinity) > feetY + height) continue; // low enough to step on, or overhead
      if (this.inFootprint(c, x, z, rad)) return c;
    }
    return null;
  }

  /** For walking: the height to stand at, counting roofs that are at or below step height. */
  standHeight(x, z, feetY) {
    let y = this.heightAt(x, z);
    for (const c of this.colliders.get(Math.floor((x + this.halfX) / GRID) * 100000 + Math.floor((z + this.halfZ) / GRID)) || []) {
      if (c.dead || c.t === 'tree' || c.bottom !== undefined) continue;
      if (c.top > y && c.top <= feetY + 2.5 && this.inFootprint(c, x, z)) y = c.top;
    }
    return y;
  }

  /**
   * Knock down a building or tree. `dir` (x, z) is the way a tree falls.
   * Returns false for things that can't break (landmarks).
   */
  destroy(c, dir = { x: 1, z: 0 }) {
    if (!this.breakable(c)) return false;
    c.dead = true;
    this.destroyed ||= [];
    const saved = { c, instances: [] };
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const keep = (im, i) => {
      im.getMatrixAt(i, m);
      saved.instances.push([im, i, m.clone()]);
      m.decompose(pos, quat, scale);
    };
    if (c.t === 'tree') {
      // Fall flat, away from whatever hit it.
      const fall = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(dir.z, 0, -dir.x).normalize(), Math.PI / 2 - 0.08);
      for (const [im, i] of c.parts) {
        keep(im, i);
        im.setMatrixAt(i, m.compose(pos, fall.clone().multiply(quat), scale));
        im.instanceMatrix.needsUpdate = true;
      }
    } else if (c.t === 'box') {
      keep(...c.wall);
      this._collapses.push({ im: c.wall[0], i: c.wall[1], pos: pos.clone(), quat: quat.clone(), scale: scale.clone(), t0: null });
      if (c.roof) {
        keep(...c.roof);
        c.roof[0].setMatrixAt(c.roof[1], m.makeScale(0, 0, 0));
        c.roof[0].instanceMatrix.needsUpdate = true;
      }
    } else {
      // Part of a merged mesh: squash its vertices down to a rubble slab.
      const attr = c.mesh.geometry.attributes.position;
      saved.ys = new Float32Array(c.vn);
      const top = c.base + RUBBLE;
      for (let k = 0; k < c.vn; k++) {
        const y = attr.getY(c.v0 + k);
        saved.ys[k] = y;
        if (y > top) attr.setY(c.v0 + k, top);
      }
      attr.needsUpdate = true;
    }
    this.destroyed.push(saved);
    return true;
  }

  /** Buildings sink into their rubble slab over half a second. */
  _updateCollapses(t) {
    if (!this._collapses.length) return;
    const m = new THREE.Matrix4();
    const s = new THREE.Vector3();
    this._collapses = this._collapses.filter((k) => {
      k.t0 ??= t;
      const u = Math.min(1, (t - k.t0) / 0.5);
      const h = k.scale.y + (RUBBLE - k.scale.y) * u * u;
      k.im.setMatrixAt(k.i, m.compose(k.pos, k.quat, s.set(k.scale.x, Math.min(k.scale.y, h), k.scale.z)));
      k.im.instanceMatrix.needsUpdate = true;
      return u < 1 && !k.cancel;
    });
  }

  /** Put every knocked-down building and tree back. */
  repair() {
    for (const k of this._collapses) k.cancel = true;
    this._collapses = [];
    for (const { c, instances, ys } of this.destroyed || []) {
      c.dead = false;
      for (const [im, i, m] of instances) {
        im.setMatrixAt(i, m);
        im.instanceMatrix.needsUpdate = true;
      }
      if (ys) {
        const attr = c.mesh.geometry.attributes.position;
        for (let k = 0; k < c.vn; k++) attr.setY(c.v0 + k, ys[k]);
        attr.needsUpdate = true;
      }
    }
    this.destroyed = [];
  }

  // -------------------------------------------------------------- collision
  /** True if a sphere at `p` with radius `rad` touches a building or tree. */
  hitsObstacle(p, rad) {
    const list = this.colliders.get(
      Math.floor((p.x + this.halfX) / GRID) * 100000 + Math.floor((p.z + this.halfZ) / GRID)
    );
    if (!list) return false;
    for (const c of list) {
      if (c.dead) continue; // knocked down
      if (p.y - rad > c.top || p.y + rad < c.bottom) continue; // bottom: open space under bridges and arches
      if (c.t === 'box') {
        const dx = p.x - c.x;
        const dz = p.z - c.z;
        if (Math.abs(dx * c.c + dz * c.s) < c.hw + rad && Math.abs(-dx * c.s + dz * c.c) < c.hd + rad) return true;
      } else if (c.t === 'tree') {
        // Only the solid middle of a tree counts (clipping the leaves is fine),
        // and the treetop is a few meters forgiving.
        if (p.y - rad > c.top - 3) continue;
        if (Math.hypot(p.x - c.x, p.z - c.z) < c.rad * 0.5 + rad) return true;
      } else if (p.x > c.minx - rad && p.x < c.maxx + rad && p.z > c.minz - rad && p.z < c.maxz + rad) {
        if (pointInPoly(p.x, p.z, c.p)) return true;
      }
    }
    return false;
  }
}

/** Path for a water area: one outline, or [outline, ...islands] (filled even-odd). */
function waterPath(g, w, toXY) {
  g.beginPath();
  for (const ring of typeof w[0] === 'number' ? [w] : w) {
    for (let i = 0; i < ring.length; i += 2) {
      const [X, Y] = toXY(ring[i], ring[i + 1]);
      i ? g.lineTo(X, Y) : g.moveTo(X, Y);
    }
    g.closePath();
  }
}

function pointInPoly(x, z, p) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i];
    const zi = p[i + 1];
    const xj = p[j];
    const zj = p[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Unit gable roof: footprint [-0.5,0.5]², ridge along X at y = 1. */
function prismGeometry() {
  const v = [];
  const tri = (a, b, c) => v.push(...a, ...b, ...c);
  const A = [-0.5, 0, -0.5];
  const B = [0.5, 0, -0.5];
  const C = [0.5, 0, 0.5];
  const D = [-0.5, 0, 0.5];
  const R1 = [-0.5, 1, 0];
  const R2 = [0.5, 1, 0];
  tri(A, R1, R2); tri(A, R2, B); // north slope
  tri(D, C, R2); tri(D, R2, R1); // south slope
  tri(A, D, R1); // west gable
  tri(B, R2, C); // east gable
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

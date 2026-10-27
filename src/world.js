import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LEGO, legoMaterial, isLego } from './lego.js';

const CHUNK = 1600; // meters per culling chunk
const GRID = 200; // meters per collision cell

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

    this._setupElevation();
    this.mapCanvas = this._drawMap();
    this._buildTerrain();
    this._buildRunway();
    this._buildBuildings();
    this._buildTrees();
    this._buildCustom();
    this._buildHelipad();
    this._buildClouds();
    this._buildWaterMask();
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
      path(w);
      g.fill();
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
      path(w, true);
      g.fill();
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
    for (let k = 0; k < op.count; k++) {
      const x = op.getX(k);
      const z = op.getZ(k);
      const inside = Math.abs(x) < this.halfX - 10 && Math.abs(z) < this.halfZ - 10;
      op.setY(k, this._rawHeight(x, z) - (inside ? 60 : 6));
    }
    og.computeVertexNormals();
    const outer = new THREE.Mesh(og, legoMaterial({ color: isLego() ? (this.data.ground || 0x58ab41) : 0x6f7f4f, studs: 6 }));
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
      if (!chunks.has(k)) chunks.set(k, { boxes: [], roofs: [], polys: [] });
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
      ch.boxes.push([m.clone(), col.setHex(pick(house ? WALLS : BIG, r())).clone()]);
      let roofTop = top;
      if (house) {
        const rh = Math.min(w, d) * 0.42;
        // Ridge runs along the longer side.
        const ridgeAlongW = w >= d;
        q.setFromAxisAngle(up, -ang + (ridgeAlongW ? 0 : Math.PI / 2));
        m.compose(new THREE.Vector3(x, top, z), q,
          new THREE.Vector3(ridgeAlongW ? w + 0.6 : d + 0.6, rh, ridgeAlongW ? d + 0.6 : w + 0.6));
        ch.roofs.push([m.clone(), col.setHex(pick(ROOFS, r())).clone()]);
        roofTop += rh;
      }
      const R = Math.hypot(w, d) / 2;
      this._addCollider({ t: 'box', x, z, c, s, hw: w / 2, hd: d / 2, top: roofTop },
        x - R + this.halfX, z - R + this.halfZ, x + R + this.halfX, z + R + this.halfZ);
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
      chunk((minx + maxx) / 2, (minz + maxz) / 2).polys.push(geo);
      this._addCollider({ t: 'poly', p, top, minx, minz, maxx, maxz },
        minx + this.halfX, minz + this.halfZ, maxx + this.halfX, maxz + this.halfZ);
    }

    const polyMat = legoMaterial({ studs: 2.4, windows: true, vertexColors: true });
    for (const ch of chunks.values()) {
      for (const [list, geo, mat] of [[ch.boxes, boxGeo, wallMat], [ch.roofs, roofGeo, roofMat]]) {
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach(([mm, cc], i) => {
          im.setMatrixAt(i, mm);
          im.setColorAt(i, cc);
        });
        im.computeBoundingSphere();
        im.castShadow = im.receiveShadow = true;
        this.scene.add(im);
        this.meshes.push(im);
      }
      if (ch.polys.length) {
        const mesh = new THREE.Mesh(mergeGeometries(ch.polys), polyMat);
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
      ch.trunk.push([m.clone()]);
      (pine ? ch.pine : ch.round).push([m.clone(), c]);
      this._addCollider({ t: 'tree', x, z, rad: 3.5 * s, top: y + 13 * s },
        x - 4 + this.halfX, z - 4 + this.halfZ, x + 4 + this.halfX, z + 4 + this.halfZ);
    }
    for (const ch of chunks.values()) {
      const parts = [[ch.trunk, trunkGeo, trunkMat], [ch.round, roundGeo, leafMat],
        [ch.round, topGeo, leafMat], [ch.pine, pineGeo, leafMat]];
      for (const [list, geo, mat] of parts) {
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach(([mm, cc], i) => {
          im.setMatrixAt(i, mm);
          if (cc) im.setColorAt(i, cc);
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
    }
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

  // -------------------------------------------------------------- collision
  /** True if a sphere at `p` with radius `rad` touches a building or tree. */
  hitsObstacle(p, rad) {
    const list = this.colliders.get(
      Math.floor((p.x + this.halfX) / GRID) * 100000 + Math.floor((p.z + this.halfZ) / GRID)
    );
    if (!list) return false;
    for (const c of list) {
      if (p.y - rad > c.top) continue;
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

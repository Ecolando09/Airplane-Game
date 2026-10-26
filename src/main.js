import * as THREE from 'three';
import { World } from './world.js';
import { createLegoPlane, GROUND_TILT, MAIN_CONTACT } from './airplane.js';
import { createGhostSpiderHeli, HeliFlight } from './heli.js';
import { GoogleWorld } from './google3d.js';
import { setLook } from './lego.js';
import { Flight } from './flight.js';
import { Input } from './input.js';
import { EngineSound } from './sound.js';
import { legoMaterial } from './lego.js';
import { RemoteLink } from './remote.js';
import { Traffic } from './traffic.js';
import { Multiplayer, randomRoomCode } from './multiplayer.js';

const $ = (id) => document.getElementById(id);
const SKY = 0x9fd0ff;

// ------------------------------------------------------------------ settings
// City, vehicle and look come from the URL (?city=&vehicle=&look=) or the last
// choice on this device. Changing one in the menu rebuilds the preview in place.
const CITIES = { spartanburg: 'Spartanburg, SC', fortcollins: 'Fort Collins, CO' };
const VEHICLE_NAMES = { plane: 'Bush Plane', heli: 'Ghost-Spider Copter' };
const LOOK_NAMES = { lego: 'Lego', real: 'Realistic', google: 'Google 3D' };
const CONFIG = window.LEGOSKY_CONFIG || {};
const HAS_GOOGLE = !!CONFIG.googleMapsKey;
const settings = (() => {
  const q = new URLSearchParams(location.search);
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('legosky.settings') || '{}');
  } catch {}
  const pick = (k, ok, def) => (ok(q.get(k)) ? q.get(k) : ok(saved[k]) ? saved[k] : def);
  return {
    city: pick('city', (v) => v in CITIES, 'spartanburg'),
    vehicle: pick('vehicle', (v) => v in VEHICLE_NAMES, 'plane'),
    look: pick('look', (v) => v in LOOK_NAMES && (v !== 'google' || HAS_GOOGLE), 'lego'),
  };
})();
function saveSettings() {
  try {
    localStorage.setItem('legosky.settings', JSON.stringify(settings));
  } catch {}
  const q = new URLSearchParams(location.search);
  for (const k of ['city', 'vehicle', 'look']) q.set(k, settings[k]);
  history.replaceState(null, '', `?${q}`);
}

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true, logarithmicDepthBuffer: true });
// Phones get a lighter render (lower resolution, smaller shadow map) to keep the frame rate up.
const IS_TOUCH = matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_TOUCH ? 1.25 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 2500, 11000);

const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.3, 40000);

scene.add(new THREE.HemisphereLight(0xdff0ff, 0x6a8a50, 1.6));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(IS_TOUCH ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -160, right: 160, top: 160, bottom: -160, near: 1, far: 2000 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.5;
const SUN_DIR = new THREE.Vector3(-0.45, 0.8, 0.35).normalize();
scene.add(sun, sun.target);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------ city, look and vehicle
// Everything that depends on the menu choices lives in these variables and is
// rebuilt in place when a choice changes, so the menu shows a live preview.
let data;
let world;
let traffic;
let google = null;
let isHeli;
let plane;
let flight;
let labelEls = [];
let pinEls = [];
let worldObjects = [];
const input = new Input();
const sound = new EngineSound();
const mp = new Multiplayer({
  scene,
  makeVehicle: (v) => (v === 'heli' ? createGhostSpiderHeli() : createLegoPlane()),
  onChange: () => updateMpUi(),
  onJoin: (p) => toast(`👋 ${p.name} joined${p.city !== settings.city ? ` (in ${CITIES[p.city] || 'another city'})` : ''}`, p.color),
  onLeave: (p) => toast(`${p.name} left the room`, '#868e96'),
});
/** Small notification in the top-right corner (who joined/left the room). */
function toast(text, color) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.setProperty('--c', color);
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 4000);
  setTimeout(() => el.remove(), 4600);
}
const cityCache = new Map();
const satCache = new Map();

async function fetchCity(city) {
  if (cityCache.has(city)) return cityCache.get(city);
  const res = await fetch(`./cities/${city}.json`);
  const total = Number(res.headers.get('content-length')) || 9e6;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    $('loadBar').style.width = `${Math.min(90, (got / total) * 90)}%`;
  }
  const json = JSON.parse(await new Blob(chunks).text());
  cityCache.set(city, json);
  return json;
}

function fetchSat(city) {
  if (!satCache.has(city)) {
    satCache.set(city, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = `./cities/${city}-sat.jpg`;
    }));
  }
  return satCache.get(city);
}

/** Remove objects from the scene and free their GPU memory. */
function disposeObjects(list) {
  for (const obj of list) {
    scene.remove(obj);
    obj.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material || [])) {
        m.map?.dispose();
        m.dispose();
      }
    });
  }
}

async function buildWorld() {
  const [cityData, satImage] = await Promise.all([
    fetchCity(settings.city),
    settings.look === 'real' ? fetchSat(settings.city) : null,
  ]);
  $('loadText').textContent = settings.look === 'lego' ? 'Building the city out of bricks…' : 'Building the city…';
  await new Promise((r) => setTimeout(r, 30));

  // Tear down the previous city.
  disposeObjects(worldObjects);
  if (google) {
    google.tiles.dispose();
    scene.remove(google.tiles.group);
    google = null;
  }
  for (const el of [...labelEls, ...pinEls]) el.remove();

  setLook(settings.look);
  data = cityData;
  const before = new Set(scene.children);
  world = new World(scene, data, { satImage });
  traffic = new Traffic(scene, world, IS_TOUCH ? 900 : 2500);

  // Google Photorealistic 3D Tiles replace the built city: real buildings and terrain.
  if (settings.look === 'google') {
    google = new GoogleWorld({
      scene, camera, renderer, apiKey: CONFIG.googleMapsKey,
      lat: data.origin[1], lon: data.origin[0], height: world.baseElevation + (data.geoid || 0),
    });
    for (const m of world.meshes) m.visible = false;
    for (const m of [traffic.body, traffic.cabin, traffic.wheels]) m.visible = false;
    // Fly over the real surface where it has loaded, the elevation grid elsewhere.
    const gridHeight = world.heightAt.bind(world);
    world.heightAt = (x, z) => google.heightAt(x, z) ?? gridHeight(x, z);
  }
  camera.far = google ? 60000 : 40000;
  camera.updateProjectionMatrix();
  scene.fog.near = google ? 6000 : 2500;
  scene.fog.far = google ? 30000 : 11000;
  worldObjects = scene.children.filter((o) => !before.has(o) && o !== google?.tiles.group);

  labelEls = world.landmarks.map((l) => {
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = l.name;
    $('labels').appendChild(el);
    return el;
  });
  pinEls = world.locators.map((l) => {
    const el = document.createElement('div');
    el.className = 'label pin';
    el.style.setProperty('--pin', '#' + l.color.toString(16).padStart(6, '0'));
    $('labels').appendChild(el);
    return el;
  });
  majorRoads = computeMajorRoads();
  mp.resetModels(); // rebuild other players' vehicles in the new look
  $('loadBar').style.width = '100%';
}

function buildVehicle() {
  if (plane) disposeObjects([plane.group]);
  clearDebris();
  isHeli = settings.vehicle === 'heli';
  plane = isHeli ? createGhostSpiderHeli() : createLegoPlane();
  scene.add(plane.group);
  flight = isHeli ? new HeliFlight(world, plane) : new Flight(world, plane);
  input.heliMode = isHeli;
  document.body.classList.toggle('heli', isHeli);
  $('throttleLabel').textContent = isHeli ? 'SPEED' : 'THROTTLE';
  tilt = flight.onGround && !isHeli ? GROUND_TILT : 0;
  floatsAnim = 0;
  boosterLevel = 0;
  camInit = false;
  if (window.__game) Object.assign(window.__game, { world, flight, plane, google });
}

// ------------------------------------------------------------------ floats
let floatsAnim = 0;
function toggleFloats() {
  if (!running || flight.crashed) return;
  if (flight.onGround && flight.floats && flight.onWater) {
    message("Can't raise the floats while on the water!", 2);
    return;
  }
  flight.floats = !flight.floats;
  message(flight.floats ? 'Floats down 🛶 — you can land on water' : `Floats up — ${isHeli ? 'legs' : 'wheels'} only`, 2);
}
function updateFloats(dt) {
  floatsAnim += ((flight.floats ? 1 : 0) - floatsAnim) * (1 - Math.exp(-dt * 4));
  plane.floats.visible = floatsAnim > 0.02;
  plane.floats.scale.setScalar(Math.max(0.001, floatsAnim));
  for (const w of plane.wheels) w.visible = floatsAnim < 0.6;
}

// ------------------------------------------------------------------ turbo boosters
// Rockets slide out when turbo is on: orange flames for T2X, blue for T3X.
let boosterLevel = 0;
let boosterColor = 2;
function updateBoosters(dt) {
  const on = flight.turbo > 1 && !flight.crashed;
  if (on) boosterColor = flight.turbo;
  boosterLevel += ((on ? 1 : 0) - boosterLevel) * (1 - Math.exp(-dt * 5));
  plane.updateBoosters(boosterLevel, boosterColor, flight.throttle, timer.getElapsed());
}

// ------------------------------------------------------------------ crash debris
let debris = [];
function explode() {
  const q = plane.group.quaternion;
  for (const p of plane.parts) {
    for (let i = 0; i < 3; i++) {
      const s = p.size.clone().multiplyScalar(0.35 + Math.random() * 0.3);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.x, s.y, s.z), legoMaterial({ color: p.color }));
      mesh.position.copy(p.pos).add(new THREE.Vector3().randomDirection().multiplyScalar(1.5));
      mesh.position.applyQuaternion(q).add(plane.group.position);
      mesh.castShadow = true;
      const v = flight.vel.clone().multiplyScalar(0.25).add(new THREE.Vector3().randomDirection().multiplyScalar(10));
      v.y = Math.abs(v.y) + 6;
      const spin = new THREE.Vector3().randomDirection().multiplyScalar(6);
      scene.add(mesh);
      debris.push({ mesh, v, spin });
    }
  }
  plane.group.visible = false;
}
function updateDebris(dt) {
  for (const d of debris) {
    d.v.y -= 9.81 * dt;
    d.mesh.position.addScaledVector(d.v, dt);
    const g = world.heightAt(d.mesh.position.x, d.mesh.position.z) + 0.3;
    if (d.mesh.position.y < g) {
      d.mesh.position.y = g;
      d.v.y *= -0.35;
      d.v.x *= 0.7;
      d.v.z *= 0.7;
      d.spin.multiplyScalar(0.7);
    }
    d.mesh.rotation.x += d.spin.x * dt;
    d.mesh.rotation.y += d.spin.y * dt;
    d.mesh.rotation.z += d.spin.z * dt;
  }
}
function clearDebris() {
  for (const d of debris) {
    scene.remove(d.mesh);
    d.mesh.geometry.dispose();
  }
  debris = [];
  if (plane) plane.group.visible = true;
}

// ------------------------------------------------------------------ camera
const CAMS = ['chase', 'far', 'cockpit'];
let camMode = 0;
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const camOff = new THREE.Vector3();
const camLookOff = new THREE.Vector3();
let camInit = false;
function updateCamera(dt) {
  const mode = CAMS[camMode];
  const p = plane.group.position;
  const f = flight.forward.clone();
  const up = flight.up.clone();
  const flatF = new THREE.Vector3(f.x, 0, f.z).normalize();
  let want;
  let look;
  if (window.__game?.photo) {
    const ph = window.__game.photo; // test hook: fixed camera relative to the plane
    camera.position.copy(p).add(ph.offset);
    camera.up.set(0, 1, 0);
    camera.lookAt(p);
    return;
  }
  for (const m of plane.cockpitHidden) m.visible = mode !== 'cockpit';
  // From the cockpit only the spinning-prop blur shows, not the solid blades.
  if (!isHeli) for (const c of plane.propeller.children) if (c !== plane.propDisc) c.visible = mode !== 'cockpit';
  if (mode === 'cockpit') {
    plane.group.updateMatrixWorld();
    camera.position.copy(plane.cockpitEye).applyMatrix4(plane.group.matrixWorld);
    camera.quaternion.copy(plane.group.quaternion);
    camera.up.copy(up);
    camInit = false;
    return;
  }
  if (mode === 'chase') {
    want = p.clone().addScaledVector(f, -24).addScaledVector(flatF, -2).add(new THREE.Vector3(0, 7, 0));
    look = p.clone().addScaledVector(f, 12);
  } else {
    want = p.clone().addScaledVector(flatF, -70).add(new THREE.Vector3(0, 28, 0));
    look = p.clone().addScaledVector(f, 25);
  }
  if (flight.crashed) {
    // Pull back and up so the whole wreck is in view.
    look = debris.length ? debris[0].mesh.position.clone() : p.clone();
    const away = camPos.clone().sub(look).setY(0);
    if (away.lengthSq() < 1) away.set(0, 0, 1);
    want = look.clone().addScaledVector(away.normalize(), 45).add(new THREE.Vector3(0, 22, 0));
  }
  const ground = world.heightAt(want.x, want.z) + 3;
  want.y = Math.max(want.y, ground);
  // Smooth the camera's offset from the vehicle (not its world position), so the
  // camera stays the same distance behind at any speed, turbo included.
  const wantOff = want.clone().sub(p);
  const lookOff = look.clone().sub(p);
  if (!camInit) {
    camOff.copy(wantOff);
    camLookOff.copy(lookOff);
    camInit = true;
  }
  const k = 1 - Math.exp(-dt * (mode === 'chase' ? 7 : 3));
  camOff.lerp(wantOff, k);
  camLookOff.lerp(lookOff, 1 - Math.exp(-dt * 12));
  if (flight.crashed) {
    camPos.lerp(want, k);
    camLook.lerp(look, k);
  } else {
    camPos.copy(p).add(camOff);
    camLook.copy(p).add(camLookOff);
    camPos.y = Math.max(camPos.y, ground);
  }
  camera.position.copy(camPos);
  camera.up.set(0, 1, 0).lerp(up, 0.25).normalize();
  camera.lookAt(camLook);
}

// ------------------------------------------------------------------ minimap
// Map in the lower right: the city's ground texture, with major streets drawn on
// top in map colors and labeled with their names. Tap it (or press N) to enlarge.
const mm = $('minimap');
const mctx = mm.getContext('2d');
let bigMap = false;
const toggleMap = () => {
  bigMap = !bigMap;
  mm.classList.toggle('big', bigMap);
};
mm.addEventListener('click', toggleMap);

const ROAD_STYLE = {
  motorway: { color: '#e8590c', w: 7, rank: 0 },
  trunk: { color: '#f59f00', w: 6, rank: 1 },
  primary: { color: '#f2cd37', w: 5, rank: 2 },
  secondary: { color: '#ffffff', w: 4, rank: 3 },
  tertiary: { color: '#ffffff', w: 2.5, rank: 4 },
};
let majorRoads = [];
function computeMajorRoads() {
  return world.data.lines
    .filter((l) => ROAD_STYLE[l.k])
    .map((l) => {
      let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity, len = 0;
      for (let i = 0; i < l.p.length; i += 2) {
        minx = Math.min(minx, l.p[i]); maxx = Math.max(maxx, l.p[i]);
        minz = Math.min(minz, l.p[i + 1]); maxz = Math.max(maxz, l.p[i + 1]);
        if (i) len += Math.hypot(l.p[i] - l.p[i - 2], l.p[i + 1] - l.p[i - 1]);
      }
      return { ...l, style: ROAD_STYLE[l.k], minx, minz, maxx, maxz, len };
    })
    .sort((a, b) => b.style.rank - a.style.rank); // draw big roads last (on top)
}

function drawMinimap() {
  const W = mm.width;
  const range = bigMap ? 11000 : 3500; // meters shown across
  const k = W / range;
  const src = world.mapCanvas;
  const sx = src.width / world.sizeX;
  const sz = src.height / world.sizeZ;
  const p = plane.group.position;
  const toMap = (x, z) => [(x - p.x) * k + W / 2, (z - p.z) * k + W / 2];
  const inView = (r) => r.maxx > p.x - range / 2 && r.minx < p.x + range / 2 && r.maxz > p.z - range / 2 && r.minz < p.z + range / 2;

  mctx.save();
  mctx.fillStyle = '#58ab41';
  mctx.fillRect(0, 0, W, W);
  mctx.drawImage(src, (p.x + world.halfX - range / 2) * sx, (p.z + world.halfZ - range / 2) * sz,
    range * sx, range * sz, 0, 0, W, W);
  mctx.fillStyle = 'rgba(244, 244, 236, 0.45)'; // wash out the ground so streets stand out
  mctx.fillRect(0, 0, W, W);

  // Major streets: dark casing, then color.
  const visible = majorRoads.filter(inView);
  const scale = bigMap ? 0.7 : 1;
  mctx.lineCap = mctx.lineJoin = 'round';
  for (const pass of [0, 1]) {
    for (const r of visible) {
      mctx.lineWidth = (r.style.w + (pass ? 0 : 2.5)) * scale;
      mctx.strokeStyle = pass ? r.style.color : 'rgba(27, 42, 52, 0.55)';
      mctx.beginPath();
      for (let i = 0; i < r.p.length; i += 2) {
        const [x, y] = toMap(r.p[i], r.p[i + 1]);
        i ? mctx.lineTo(x, y) : mctx.moveTo(x, y);
      }
      mctx.stroke();
    }
  }

  // Runway
  const rw = world.runway;
  mctx.strokeStyle = '#1b2a34';
  mctx.lineWidth = Math.max(5, rw.width * k);
  mctx.beginPath();
  mctx.moveTo(...toMap(rw.x - rw.fx * rw.length / 2, rw.z - rw.fz * rw.length / 2));
  mctx.lineTo(...toMap(rw.x + rw.fx * rw.length / 2, rw.z + rw.fz * rw.length / 2));
  mctx.stroke();

  // Street names, biggest roads first, skipping any that would overlap.
  const placed = [];
  const named = new Set();
  const labels = visible.filter((r) => r.n && r.style.rank <= (bigMap ? 2 : 4))
    .sort((a, b) => a.style.rank - b.style.rank || b.len - a.len);
  mctx.font = `700 ${bigMap ? 13 : 15}px system-ui, sans-serif`;
  mctx.textAlign = 'center';
  mctx.textBaseline = 'middle';
  for (const r of labels) {
    if (named.has(r.n) || placed.length >= (bigMap ? 24 : 12)) continue;
    const mid = Math.floor(r.p.length / 4) * 2;
    if (mid + 3 >= r.p.length) continue;
    const [x1, y1] = toMap(r.p[mid], r.p[mid + 1]);
    const [x2, y2] = toMap(r.p[mid + 2], r.p[mid + 3]);
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    if (cx < 30 || cy < 30 || cx > W - 30 || cy > W - 30) continue;
    const tw = mctx.measureText(r.n).width + 8;
    let ang = Math.atan2(y2 - y1, x2 - x1);
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang < -Math.PI / 2) ang += Math.PI;
    // Bounding box of the rotated label, for the overlap test.
    const hw = (Math.abs(Math.cos(ang)) * tw + Math.abs(Math.sin(ang)) * 22) / 2;
    const hh = (Math.abs(Math.sin(ang)) * tw + Math.abs(Math.cos(ang)) * 22) / 2;
    const box = [cx - hw, cy - hh, cx + hw, cy + hh];
    if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    placed.push(box);
    named.add(r.n);
    mctx.save();
    mctx.translate(cx, cy);
    mctx.rotate(ang);
    mctx.lineWidth = 4;
    mctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    mctx.strokeText(r.n, 0, 0);
    mctx.fillStyle = '#1b2a34';
    mctx.fillText(r.n, 0, 0);
    mctx.restore();
  }

  // Landmarks
  for (const l of world.landmarks) {
    const [x, y] = toMap(l.x, l.z);
    if (x < -10 || y < -10 || x > W + 10 || y > W + 10) continue;
    mctx.fillStyle = '#f2cd37';
    mctx.strokeStyle = '#1b2a34';
    mctx.lineWidth = 2;
    mctx.beginPath();
    mctx.arc(x, y, 6, 0, Math.PI * 2);
    mctx.fill();
    mctx.stroke();
  }

  // Pins (address, Denny's) and the runway; arrows at the edge when off the map.
  const pins = [...world.locators.map((l) => ({ x: l.x, z: l.z, color: '#' + l.color.toString(16).padStart(6, '0'), name: l.name })),
    { x: rw.x, z: rw.z, color: '#1b2a34', name: 'Airport' }];
  mctx.font = '700 14px system-ui, sans-serif';
  for (const pin of pins) {
    let [x, y] = toMap(pin.x, pin.z);
    const off = x < 14 || y < 14 || x > W - 14 || y > W - 14;
    if (off) {
      const dx = x - W / 2;
      const dy = y - W / 2;
      const a = Math.atan2(dy, dx);
      const f = (W / 2 - 16) / Math.max(Math.abs(dx), Math.abs(dy));
      x = W / 2 + dx * f;
      y = W / 2 + dy * f;
      mctx.save();
      mctx.translate(x, y);
      mctx.rotate(a);
      mctx.fillStyle = pin.color;
      mctx.strokeStyle = '#fff';
      mctx.lineWidth = 2;
      mctx.beginPath();
      mctx.moveTo(12, 0);
      mctx.lineTo(-7, -8);
      mctx.lineTo(-7, 8);
      mctx.closePath();
      mctx.fill();
      mctx.stroke();
      mctx.restore();
      continue;
    }
    mctx.fillStyle = pin.color;
    mctx.strokeStyle = '#fff';
    mctx.lineWidth = 3;
    mctx.beginPath();
    mctx.arc(x, y - 14, 9, Math.PI * 0.8, Math.PI * 2.2);
    mctx.lineTo(x, y);
    mctx.closePath();
    mctx.fill();
    mctx.stroke();
    if (pin.name !== 'Airport') {
      mctx.lineWidth = 4;
      mctx.strokeStyle = '#fff';
      const leftSide = x + 12 + mctx.measureText(pin.name).width > W - 6;
      mctx.textAlign = leftSide ? 'right' : 'left';
      const tx = leftSide ? x - 12 : x + 12;
      mctx.strokeText(pin.name, tx, y - 14);
      mctx.fillStyle = pin.color;
      mctx.fillText(pin.name, tx, y - 14);
      mctx.textAlign = 'center';
    }
  }

  // Other players
  for (const pl of mp.visible(settings.city)) {
    let [x, y] = toMap(pl.pos.x, pl.pos.z);
    const off = x < 12 || y < 12 || x > W - 12 || y > W - 12;
    if (off) {
      const dx = x - W / 2;
      const dy = y - W / 2;
      const f = (W / 2 - 14) / Math.max(Math.abs(dx), Math.abs(dy));
      x = W / 2 + dx * f;
      y = W / 2 + dy * f;
    }
    mctx.fillStyle = pl.color;
    mctx.strokeStyle = '#fff';
    mctx.lineWidth = 3;
    mctx.beginPath();
    mctx.arc(x, y, off ? 7 : 10, 0, Math.PI * 2);
    mctx.fill();
    mctx.stroke();
  }

  // Plane arrow
  mctx.translate(W / 2, W / 2);
  mctx.rotate(THREE.MathUtils.degToRad(flight.heading));
  mctx.fillStyle = '#c91a09';
  mctx.strokeStyle = '#fff';
  mctx.lineWidth = 3;
  mctx.beginPath();
  mctx.moveTo(0, -16);
  mctx.lineTo(12, 13);
  mctx.lineTo(0, 6);
  mctx.lineTo(-12, 13);
  mctx.closePath();
  mctx.fill();
  mctx.stroke();
  mctx.restore();
  mctx.font = '800 18px system-ui, sans-serif';
  mctx.lineWidth = 4;
  mctx.strokeStyle = '#1b2a34';
  mctx.strokeText('N', W / 2, 18);
  mctx.fillStyle = '#fff';
  mctx.fillText('N', W / 2, 18);
}

// ------------------------------------------------------------------ HUD
let msgTimer = 0;
function message(html, seconds = 3) {
  $('message').innerHTML = html;
  msgTimer = seconds;
}
const wasOnGround = { v: true };
function updateHud(dt) {
  const p = plane.group.position;
  $('spd').textContent = Math.round(flight.speed * 2.237); // m/s -> mph
  $('alt').textContent = Math.round((p.y - plane.gearHeight + world.baseElevation) * 3.281).toLocaleString();
  const hdg = Math.round(flight.heading) % 360;
  $('hdg').textContent = compass(hdg);
  $('hdgDeg').textContent = `${String(hdg).padStart(3, '0')}°`;
  updateBuddies();

  let best = null;
  let bestD = 700;
  for (const l of world.landmarks) {
    const d = Math.hypot(l.x - p.x, l.z - p.z);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  $('over').textContent = best ? `Over ${best.name}` : '';

  if (!flight.crashed) {
    const agl = p.y - plane.gearHeight - world.heightAt(p.x, p.z);
    if (wasOnGround.v && !flight.onGround && agl > 1) message('Airborne! 🛫', 2);
    if (!wasOnGround.v && flight.onGround) {
      const hp = data.helipad;
      const onPad = isHeli && hp && Math.hypot(p.x - hp.x, p.z - hp.z) < 14;
      message(onPad ? 'Right on the helipad! 🚁' : flight.onWater ? 'Splashdown! 🌊 Nice water landing!'
        : world.isOnRunway(p.x, p.z) ? 'Nice landing! 🛬' : 'Landed in a field!', 3);
    }
    if (flight.canStall !== false && !flight.onGround && flight.speed < 26 && flight.forward.y > -0.3) {
      message('STALL — lower the nose!', 0.3);
    }
    if (Math.abs(p.x) > world.halfX + 1500 || Math.abs(p.z) > world.halfZ + 1500) {
      message('Leaving Spartanburg — turn back!', 0.3);
    }
  }
  wasOnGround.v = flight.onGround;
  if (msgTimer > 0) {
    msgTimer -= dt;
    if (msgTimer <= 0) $('message').innerHTML = '';
  }

}

// ------------------------------------------------------------------ other players
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg) => COMPASS[Math.round(deg / 45) % 8];
const fmtDist = (m) => (m < 300 ? `${Math.round(m * 3.281)} ft` : `${(m / 1609).toFixed(m < 16000 ? 1 : 0)} mi`);
/** One chip per other player: an arrow pointing to them (relative to where you're
 *  heading) and how far away they are. Players in the other city show where they are. */
function updateBuddies() {
  const box = $('buddies');
  const players = [...mp.players.values()];
  while (box.children.length > players.length) box.lastChild.remove();
  while (box.children.length < players.length) {
    const el = document.createElement('div');
    el.className = 'buddy';
    el.innerHTML = '<span class="arrow">➤</span><span class="txt"></span>';
    box.appendChild(el);
  }
  const p = plane.group.position;
  players.forEach((pl, i) => {
    const el = box.children[i];
    el.style.setProperty('--c', pl.color);
    const arrow = el.querySelector('.arrow');
    const txt = el.querySelector('.txt');
    if (pl.city !== settings.city) {
      arrow.style.transform = '';
      arrow.textContent = '✈';
      txt.innerHTML = `${pl.name} <span class="far">in ${CITIES[pl.city] || 'another city'}</span>`;
      return;
    }
    const dx = pl.pos.x - p.x;
    const dz = pl.pos.z - p.z;
    const bearing = (THREE.MathUtils.radToDeg(Math.atan2(dx, -dz)) + 360) % 360; // 0 = north
    const rel = bearing - flight.heading;
    arrow.textContent = '▲';
    arrow.style.transform = `rotate(${rel}deg)`;
    const up = pl.pos.y - p.y;
    const alt = Math.abs(up) > 30 ? ` ${up > 0 ? '↑' : '↓'}${Math.round(Math.abs(up) * 3.281)} ft` : '';
    txt.innerHTML = `${pl.name} <span class="far">${fmtDist(Math.hypot(dx, dz))} ${compass(bearing)}${alt}</span>`;
  });
}

// ------------------------------------------------------------------ labels
// Landmark labels and map pins, placed over the 3D view. They never cover the
// vehicle (they fade out where it is) and never stack on top of each other:
// map pins win, then the nearest landmarks.
const _v = new THREE.Vector3();
function vehicleScreenRect() {
  const p = plane.group.position;
  _v.copy(p).project(camera);
  if (_v.z > 1) return null;
  const dist = camera.position.distanceTo(p);
  const focal = innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const r = (5 / Math.max(dist, 1)) * focal + 8; // vehicle radius in pixels, plus a margin
  const x = (_v.x * 0.5 + 0.5) * innerWidth;
  const y = (-_v.y * 0.5 + 0.5) * innerHeight;
  return [x - r, y - r, x + r, y + r];
}
function updateLabels() {
  const p = plane.group.position;
  const maxDist = innerHeight < 500 ? 2500 : 5000;
  const items = [];
  world.locators.forEach((l, i) => {
    const d = Math.hypot(l.x - p.x, l.z - p.z);
    pinEls[i].textContent = `📍 ${l.name} · ${d < 1000 ? Math.round(d) + ' m' : (d / 1609).toFixed(1) + ' mi'}`;
    items.push({ el: pinEls[i], x: l.x, y: l.y + 170, z: l.z, d, pin: true });
  });
  world.landmarks.forEach((l, i) => {
    const d = Math.hypot(l.x - p.x, l.z - p.z);
    items.push({ el: labelEls[i], x: l.x, y: l.y + 40 + d * 0.01, z: l.z, d, pin: false, hide: d > maxDist });
  });
  for (const pl of mp.visible(settings.city)) {
    if (!pl.label) {
      pl.label = document.createElement('div');
      pl.label.className = 'label player';
      $('labels').appendChild(pl.label);
    }
    pl.label.style.setProperty('--pin', pl.color);
    pl.label.textContent = pl.name;
    const d = Math.hypot(pl.pos.x - p.x, pl.pos.z - p.z);
    items.push({ el: pl.label, x: pl.pos.x, y: pl.pos.y + 6, z: pl.pos.z, d, pin: true });
  }
  for (const el of document.querySelectorAll('.label.player')) {
    if (![...mp.players.values()].some((pl) => pl.label === el && pl.city === settings.city)) el.style.display = 'none';
  }
  items.sort((a, b) => (b.pin - a.pin) || a.d - b.d);
  const placed = [];
  const veh = running && CAMS[camMode] !== 'cockpit' ? vehicleScreenRect() : null;
  const hit = (r, q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1];
  for (const it of items) {
    _v.set(it.x, it.y, it.z).project(camera);
    if (it.hide || _v.z > 1 || Math.abs(_v.x) > 1.15 || Math.abs(_v.y) > 1.15) {
      it.el.style.display = 'none';
      continue;
    }
    const x = (_v.x * 0.5 + 0.5) * innerWidth;
    const y = (-_v.y * 0.5 + 0.5) * innerHeight;
    it.el.style.display = '';
    const w = it.el.offsetWidth;
    const h = it.el.offsetHeight + 6;
    const rect = [x - w / 2, y - h, x + w / 2, y]; // labels sit above their point
    if (placed.some((q) => hit(rect, q))) {
      it.el.style.display = 'none';
      continue;
    }
    placed.push(rect);
    it.el.style.left = `${x}px`;
    it.el.style.top = `${y}px`;
    const fade = it.pin ? 1 : THREE.MathUtils.clamp(1.4 - it.d / 4000, 0.3, 1);
    it.el.style.opacity = String(veh && hit(rect, veh) ? 0.08 : fade);
  }
}

// ------------------------------------------------------------------ game flow
let running = false;
let crashTimer = 0;
// On a phone: choose tilt or touch-stick steering before starting.
let phoneSteering = 'tilt';
try {
  phoneSteering = localStorage.getItem('legosky.steering') || 'tilt';
} catch {}
function setPhoneSteering(mode) {
  phoneSteering = mode;
  for (const [id, m] of [['ctlTilt', 'tilt'], ['ctlStick', 'stick']]) {
    $(id).classList.toggle('on', m === mode);
    $(id).setAttribute('aria-pressed', String(m === mode));
  }
  try {
    localStorage.setItem('legosky.steering', mode);
  } catch {}
}
if (input.isTouch) {
  document.body.classList.add('is-touch');
  $('phoneControls').hidden = false;
  $('phoneBtn').hidden = true; // you're already on the phone
  setPhoneSteering(phoneSteering);
  $('ctlTilt').onclick = () => setPhoneSteering('tilt');
  $('ctlStick').onclick = () => setPhoneSteering('stick');
}

function start(airborne) {
  // Runs inside the tap, so the motion-sensor permission prompt is allowed here.
  if (input.isTouch) input.setTilt(phoneSteering === 'tilt').then((on) => on && message('Tilt to steer — tap CENTER to re-center', 3));
  clearDebris();
  airborne ? flight.resetAirborne() : flight.reset();
  snapToGoogleGround();
  input.syncThrottle(flight.throttle);
  tilt = flight.onGround && !isHeli ? GROUND_TILT : 0;
  floatsAnim = 0;
  wasOnGround.v = flight.onGround;
  crashTimer = 0;
  camInit = false;
  pausedFlight = false;
  camera.clearViewOffset();
  $('menu').hidden = true;
  $('hud').hidden = $('labels').hidden = false;
  $('touch').hidden = !input.isTouch;
  $('crashBox').hidden = true;
  input.syncThrottle(flight.throttle); // again now that the slider is visible and has a size
  // Helicopter on a touch screen: the stick only steers; LIFT starts at hold height.
  if (isHeli && input.isTouch) input.touchLift = 0;
  input.resetLift();
  if (input.isTouch) {
    document.body.classList.add('touch-play');
    // Go fullscreen and hold landscape where the browser allows it (Android Chrome).
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => {});
  }
  sound.start();
  running = true;
  message(airborne ? `Welcome to ${data.name.split(',')[0]}!`
    : isHeli ? (input.isTouch ? 'Push LIFT up to take off!' : 'Hold W to lift off, Shift for speed!')
      : `Runway ${world.runway.names?.[0] ?? ''} — full throttle to take off!`, 3);
}
// ------------------------------------------------------------------ menu
// The menu sits on the left; the rest of the screen is a live preview of the
// chosen vehicle, look and city. Choices apply right away (no page reload).
let building = false;
let pausedFlight = false; // a flight is waiting behind the menu (Resume)
const SEGS = [['segCity', 'city'], ['segVehicle', 'vehicle'], ['segLook', 'look']];
function updateMenu() {
  document.title = `Lego Sky · ${data.name}`;
  $('subtitle').textContent = `${VEHICLE_NAMES[settings.vehicle]} over ${data.name}`;
  const base = isHeli && data.helipad ? data.helipad.name : data.airport;
  $('startRunway').textContent = pausedFlight
    ? `Restart at the ${isHeli && data.helipad ? 'helipad' : 'runway'}`
    : `${isHeli ? 'Lift off from' : 'Take off from'} ${base}`;
  $('startAir').textContent = pausedFlight ? 'Restart in the air' : 'Start in the air over downtown';
  $('resumeBtn').hidden = !pausedFlight;
  for (const [id, key] of SEGS) {
    for (const b of $(id).querySelectorAll('button')) {
      const on = b.dataset.v === settings[key];
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.disabled = building || (b.dataset.v === 'google' && !HAS_GOOGLE);
    }
  }
  $('previewText').textContent = `${VEHICLE_NAMES[settings.vehicle]} · ${LOOK_NAMES[settings.look]} · ${CITIES[settings.city]}`;
  $('previewBusy').hidden = !building;
  $('startRunway').disabled = $('startAir').disabled = building;
  $('attrib').hidden = !google;
}
async function applySetting(key, value) {
  if (building || settings[key] === value) return;
  settings[key] = value;
  saveSettings();
  building = true;
  pausedFlight = false;
  updateMenu();
  if (key !== 'vehicle') {
    $('loadBar').style.width = '0%';
    $('loadText').textContent = `Loading ${CITIES[settings.city]}…`;
    $('loading').hidden = false;
  }
  try {
    if (key !== 'vehicle') await buildWorld();
    buildVehicle();
  } finally {
    building = false;
    $('loading').hidden = true;
    updateMenu();
  }
}
for (const [id, key] of SEGS) {
  for (const b of $(id).querySelectorAll('button')) b.onclick = () => applySetting(key, b.dataset.v);
}
if (!HAS_GOOGLE) $('lookNote').hidden = false;
setInterval(() => {
  if (!google) return;
  const a = google.tiles.getAttributions?.() || [];
  $('attribText').textContent = a.filter((x) => x.type === 'string').map((x) => x.value).join(' · ');
}, 2000);
// ------------------------------------------------------------------ fly together (menu)
const MP_OK = !/claude\.ai|claudeusercontent/.test(location.host) && location.protocol !== 'file:';
let mpName = '';
try {
  mpName = localStorage.getItem('legosky.name') || '';
} catch {}
$('mpName').value = mpName;
function joinRoom(code) {
  const name = $('mpName').value.trim() || 'Pilot';
  try {
    localStorage.setItem('legosky.name', name);
  } catch {}
  mp.join(code, name);
  const q = new URLSearchParams(location.search);
  q.set('room', code);
  history.replaceState(null, '', `?${q}`);
}
// Open rooms on the server, listed with a Join button (the "lobby").
let openRooms = [];
let lobbyOk = true;
function watchLobby() {
  if (!MP_OK) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?role=lobby`);
  ws.onopen = () => {
    lobbyOk = true;
    updateMpUi();
  };
  ws.onmessage = (e) => {
    try {
      const m = JSON.parse(e.data);
      if (m.t === 'rooms') openRooms = m.rooms;
    } catch {}
    updateMpUi();
  };
  ws.onclose = () => {
    lobbyOk = false;
    openRooms = [];
    updateMpUi();
    setTimeout(watchLobby, 5000);
  };
}
function updateMpUi() {
  $('mpOff').hidden = !!mp.room;
  $('mpOn').hidden = !mp.room;
  $('mpNote').hidden = MP_OK;
  $('mpErr').hidden = !MP_OK || (lobbyOk && mp.status !== 'error');
  const rooms = $('mpRooms');
  const listed = mp.room ? [] : openRooms;
  rooms.hidden = !listed.length;
  rooms.innerHTML = '';
  for (const r of listed) {
    const li = document.createElement('li');
    const who = r.players.map((p) => p.name).join(', ');
    const where = [...new Set(r.players.map((p) => CITIES[p.city] || p.city))].join(' & ');
    li.innerHTML = '<div><b></b><span></span></div><button class="small-btn">Join</button>';
    li.querySelector('b').textContent = `${who}`;
    li.querySelector('span').textContent = `Room ${r.code} · ${where}`;
    li.querySelector('button').onclick = async () => {
      // Fly where they are.
      const city = r.players[0]?.city;
      if (city in CITIES && city !== settings.city) await applySetting('city', city);
      joinRoom(r.code);
    };
    rooms.appendChild(li);
  }
  if (!mp.room) return;
  $('mpRoomCode').textContent = mp.room;
  $('mpStatus').textContent = { connecting: '· connecting…', on: '· connected', error: "· can't reach the server" }[mp.status] || '';
  $('mpStatus').classList.toggle('bad', mp.status === 'error');
  const list = $('mpList');
  list.innerHTML = '';
  const me = document.createElement('li');
  me.textContent = `${mp.name} (you)`;
  list.appendChild(me);
  for (const pl of mp.players.values()) {
    const li = document.createElement('li');
    li.style.setProperty('--c', pl.color);
    li.textContent = `${pl.name || 'Pilot'} · ${VEHICLE_NAMES[pl.vehicle] || ''} · ${CITIES[pl.city] || ''}`;
    list.appendChild(li);
  }
}
$('mpCreate').onclick = () => joinRoom(randomRoomCode());
$('mpJoin').onclick = () => {
  const code = $('mpCode').value.trim().toUpperCase();
  if (/^[A-Z]{4}$/.test(code)) joinRoom(code);
  else $('mpCode').focus();
};
$('mpCode').addEventListener('keydown', (e) => e.key === 'Enter' && $('mpJoin').onclick());
$('mpLeave').onclick = () => {
  mp.leave();
  const q = new URLSearchParams(location.search);
  q.delete('room');
  history.replaceState(null, '', `?${q}`);
};
$('mpCopy').onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${mp.room}&city=${settings.city}`;
  try {
    await navigator.clipboard.writeText(url);
    $('mpCopy').textContent = 'Copied!';
  } catch {
    prompt('Send this link:', url);
  }
  setTimeout(() => ($('mpCopy').textContent = 'Copy invite link'), 2000);
};
{
  const code = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  if (MP_OK && /^[A-Z]{4}$/.test(code)) joinRoom(code);
  watchLobby();
  updateMpUi();
}

$('crashRetry').onclick = () => start(false);
$('crashMenu').onclick = () => $('helpBtn').onclick();
$('resumeBtn').onclick = () => {
  pausedFlight = false;
  $('menu').hidden = true;
  $('hud').hidden = $('labels').hidden = false;
  $('touch').hidden = !input.isTouch;
  camera.clearViewOffset();
  running = true;
};
$('startRunway').onclick = () => start(false);
$('startAir').onclick = () => start(true);
$('helpBtn').onclick = () => {
  running = false;
  pausedFlight = !flight.crashed;
  $('menu').hidden = false;
  $('hud').hidden = $('touch').hidden = $('labels').hidden = true;
  updateMenu();
};

// ------------------------------------------------------------------ phone controller
const STATUS = {
  waiting: ['Waiting for your phone…', ''],
  connected: ['Phone connected! ✅', 'ok'],
  offline: ["Can't reach the phone relay. It only works when the game is hosted on your server.", 'bad'],
};
const remote = new RemoteLink(input, {
  onStatus(state) {
    const [text, cls] = STATUS[state];
    $('phoneStatus').textContent = state === 'connected' && remote.pads > 1 ? `${remote.pads} phones connected ✅` : text;
    $('phoneStatus').className = `status ${cls}`;
    $('phoneChip').classList.toggle('on', state === 'connected');
    if (state === 'connected' && !$('phonePanel').hidden) setTimeout(() => ($('phonePanel').hidden = true), 1500);
  },
});
async function showPhonePanel() {
  remote.connect();
  $('roomCode').textContent = remote.code;
  $('padUrl').textContent = remote.padUrl;
  $('qr').src = await remote.qrDataUrl();
  $('phonePanel').hidden = false;
}
$('phoneBtn').onclick = showPhonePanel;
$('phoneChip').onclick = showPhonePanel;
$('phoneDone').onclick = () => ($('phonePanel').hidden = true);
setInterval(() => {
  if (!plane) return;
  const p = plane.group.position;
  remote.sendTelemetry({
    menu: !running,
    spd: Math.round(flight.speed * 1.944),
    alt: Math.round((p.y - plane.gearHeight + world.baseElevation) * 3.281),
    gear: flight.floats ? 'FLOATS' : isHeli ? 'LEGS' : 'WHEELS',
    turbo: flight.turbo,
    vehicle: isHeli ? 'heli' : 'plane',
    crashed: flight.crashed,
    thr: flight.throttle,
  });
}, 200);

input.on('cam', () => (camMode = (camMode + 1) % CAMS.length));
input.on('floats', toggleFloats);
// Turbo modes: 1X normal, T2X and T3X multiply top speed by 2 and 3.
const turboName = (t) => (t === 1 ? '1X' : `T${t}X`);
function setTurbo(t) {
  if (!running) return;
  flight.turbo = t;
  $('turboChip').textContent = t === 1 ? 'TURBO' : turboName(t);
  $('turboChip').classList.toggle('on', t > 1);
  message(t === 1 ? 'Turbo off — normal speed' : `🚀 ${turboName(t)} — ${t}× speed!`, 1.8);
}
input.on('turbo', () => setTurbo((flight.turbo % 3) + 1));
input.on('turbo1', () => setTurbo(1));
input.on('turbo2', () => setTurbo(2));
input.on('turbo3', () => setTurbo(3));
input.on('map', toggleMap);
input.on('menuStart', () => !running && start(false));
input.on('menuAir', () => !running && start(true));
input.on('reset', () => running && start(false));
input.on('air', () => running && start(true));
input.on('mute', () => sound.toggle());
input.on('pause', () => (running ? $('helpBtn').onclick() : pausedFlight && $('resumeBtn').onclick()));
input.on('invert', () => message(input.invertPitch ? 'Pitch inverted (flight-sim style)' : 'Pitch normal', 1.5));

// ------------------------------------------------------------------ airplane pose
// Tail-dragger: sits nose-up on the ground and lifts its tail as it speeds up.
// The tilt pivots around the main wheels' contact point so they stay on the ground.
let tilt = 0;
const tiltQ = new THREE.Quaternion();
const AXIS_X = new THREE.Vector3(1, 0, 0);
function poseAirplane(dt) {
  if (isHeli) {
    plane.group.position.copy(flight.pos);
    plane.group.quaternion.copy(flight.quat);
    plane.animate(flight, dt);
    return;
  }
  const want = flight.onGround && !flight.floats ? GROUND_TILT * THREE.MathUtils.clamp(1 - flight.speed / 24, 0, 1) : 0;
  tilt += (want - tilt) * (1 - Math.exp(-dt * 5));
  tiltQ.setFromAxisAngle(AXIS_X, tilt);
  const offset = MAIN_CONTACT.clone().sub(MAIN_CONTACT.clone().applyQuaternion(tiltQ)).applyQuaternion(flight.quat);
  plane.group.position.copy(flight.pos).add(offset);
  plane.group.quaternion.copy(flight.quat).multiply(tiltQ);

  const c = flight.ctrl;
  const [left, right] = plane.controls.ailerons;
  left.rotation.x = c.roll * 0.35;
  right.rotation.x = -c.roll * 0.35;
  plane.controls.elevator.rotation.x = -c.pitch * 0.4;
  plane.controls.rudder.rotation.y = c.yaw * 0.4;
}

// ------------------------------------------------------------------ Google 3D ground
// The start position comes from the elevation grid, which can be a few meters
// off from Google's real 3D ground (and the tiles load after the start). While
// the vehicle is parked or rolling (not climbing), keep it on the real surface.
function snapToGoogleGround() {
  if (!google || flight.crashed || !flight.onGround || flight.verticalSpeed > 0.05) return;
  const g = google.heightAt(flight.pos.x, flight.pos.z);
  if (g !== null) flight.pos.y = g + plane.gearHeight;
}

// ------------------------------------------------------------------ loop
const timer = new THREE.Timer();
function frame() {
  requestAnimationFrame(frame);
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  input.pollButtons(!running);
  world.update(timer.getElapsed());
  if (google) google.update(renderer);
  else traffic.update(dt);
  if (plane && mp.room) {
    mp.update(dt, {
      group: plane.group, city: settings.city, vehicle: settings.vehicle, speed: flight.speed,
      turbo: flight.turbo || 1, floats: !!flight.floats, crashed: flight.crashed,
    });
  }
  if (running) {
    const ctl = input.read();
    if (!flight.crashed) {
      flight.update(dt, ctl);
      if (flight.crashed) {
        explode();
        crashTimer = 0;
        $('crashReason').textContent = `💥 ${flight.crashReason}`;
        $('crashBox').hidden = false;
        message('', 0.01);
      }
    } else {
      crashTimer += dt;
    }
    snapToGoogleGround();
    updateDebris(dt);
    updateFloats(dt);
    updateBoosters(dt);
    poseAirplane(dt);
    if (!isHeli) {
      const rpm = 8 + flight.throttle * 60;
      plane.propeller.rotation.z += rpm * dt;
      plane.propDisc.material.opacity = flight.throttle * 0.25;
    }
    sound.update(flight.crashed ? 0 : flight.throttle, flight.speed);
    updateCamera(dt);
    updateHud(dt);
    updateLabels();
    drawMinimap();
  } else {
    // Live preview behind the menu: the vehicle parked where it is, with the
    // camera slowly circling it. The view is shifted right, clear of the menu.
    if (!building && plane) {
      snapToGoogleGround();
      poseAirplane(dt);
      if (!isHeli) plane.propeller.rotation.z += 10 * dt;
      const t = timer.getElapsed() * 0.18;
      const p = plane.group.position;
      const r = isHeli ? 22 : 26;
      camera.position.set(p.x + Math.cos(t) * r, p.y + 7, p.z + Math.sin(t) * r);
      const ground = world.heightAt(camera.position.x, camera.position.z) + 2;
      camera.position.y = Math.max(camera.position.y, ground);
      camera.up.set(0, 1, 0);
      camera.lookAt(p.x, p.y + 1, p.z);
      const side = $('menuPanel').getBoundingClientRect().width;
      const wide = innerWidth > side * 1.6;
      if (wide) camera.setViewOffset(innerWidth, innerHeight, -side / 2, 0, innerWidth, innerHeight);
      else camera.clearViewOffset();
    }
  }
  sun.target.position.copy(running ? plane.group.position : camera.position);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 800);
  renderer.render(scene, camera);
}

// ------------------------------------------------------------------ start up
$('loadText').textContent = `Loading ${CITIES[settings.city]}…`;
building = true;
await buildWorld();
buildVehicle();
building = false;
$('loading').hidden = true;
$('startButtons').hidden = false;
updateMenu();
frame();

// Test hook: ?debug exposes the simulation for automated checks.
if (new URLSearchParams(location.search).has('debug')) {
  window.__game = { world, flight, plane, start, google, mp, camera, step: (dt, ctl) => flight.update(dt, ctl) };
  window.__tilt = input.tilt;
  window.__traffic = traffic;
}

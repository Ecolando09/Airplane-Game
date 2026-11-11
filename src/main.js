import * as THREE from 'three';
import { World } from './world.js';
import { createLegoPlane, GROUND_TILT, MAIN_CONTACT } from './airplane.js';
import { createGhostSpiderHeli, HeliFlight } from './heli.js';
import { GoogleWorld } from './google3d.js';
import { setLook, NIGHT } from './lego.js';
import { Flight } from './flight.js';
import { Input } from './input.js';
import { EngineSound } from './sound.js';
import { legoMaterial } from './lego.js';
import { RemoteLink } from './remote.js';
import { Traffic } from './traffic.js';
import { Multiplayer, randomRoomCode } from './multiplayer.js';
import { BeerRun } from './beerrun.js';
import { createRobot, RobotWalk } from './robot.js';
import { Props } from './props.js';
import { Rampage } from './rampage.js';
import { RingRace, RampageGame } from './games.js';

const $ = (id) => document.getElementById(id);
const SKY = 0x9fd0ff;

// ------------------------------------------------------------------ settings
// City, vehicle and look come from the URL (?city=&vehicle=&look=) or the last
// choice on this device. Changing one in the menu rebuilds the preview in place.
const CITIES = {
  spartanburg: 'Spartanburg, SC', fortcollins: 'Fort Collins, CO', carbondale: 'Carbondale–Marble, CO',
  denver: 'Denver, CO', stlouis: 'St. Louis, MO',
  sanfrancisco: 'San Francisco, CA', hongkong: 'Hong Kong & Shenzhen', tokyo: 'Tokyo, Japan', singapore: 'Singapore',
};
const VEHICLE_NAMES = { plane: 'Bush Plane', heli: 'Ghost-Spider Copter' };
const LOOK_NAMES = { lego: 'Lego', real: 'Realistic', google: 'Google 3D' };
const MODES = { free: 'Free flight', rings: 'Ring Race', rampage: 'Rampage', beer: 'Beer Run' }; // Beer Run: only in Fort Collins
// Preferences that stay on this device (not shared with a room).
const prefs = { sens: 100, invert: false, sound: true, music: false, low: false, sky: 'day', paint: 'classic', potty: 'some', ...(() => {
  try {
    return JSON.parse(localStorage.getItem('legosky.prefs') || '{}');
  } catch {
    return {};
  }
})() };
function savePrefs() {
  try {
    localStorage.setItem('legosky.prefs', JSON.stringify(prefs));
  } catch {}
}
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
    mode: pick('mode', (v) => v in MODES, 'free'),
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

const hemi = new THREE.HemisphereLight(0xdff0ff, 0x6a8a50, 1.6);
scene.add(hemi);
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
let beerRun = null; // the Beer Run game, in cities that have one
let props = null; // loose objects lying around the city
let rampage = null; // robot-mode destruction
// Robot mode: `plane` and `flight` point at the robot while it's out, and the
// vehicle waits in `vehicle` until you change back.
let isBot = false;
let bot = null; // { model, walk }
let vehicle = null; // { model, flight } while in robot mode
let morph = null; // shape change in progress: { t, from, to }
let shake = 0; // camera shake, fading
let hitStop = 0; // seconds the action freezes after a punch lands
let game = null; // the game being played (Ring Race, Rampage), if any
let mpSendSmash = () => {}; // set by the multiplayer code: tell the room what broke
const input = new Input();
const sound = new EngineSound();
const mp = new Multiplayer({
  scene,
  makeVehicle: (v) => (v.startsWith('bot-') ? createRobot(v.slice(4)) : v === 'heli' ? createGhostSpiderHeli() : createLegoPlane()),
  onChange: () => updateMpUi(),
  onJoin: (p) => toast(`👋 ${p.name} joined${p.city !== settings.city ? ` (in ${CITIES[p.city] || 'another city'})` : ''}`, p.color),
  onLeave: (p) => toast(`${p.name} left the room`, '#868e96'),
  getSettings: () => settings,
  onRoomSettings: (r) => applyRoomSettings(r),
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
  traffic = new Traffic(scene, world, prefs.low ? 350 : IS_TOUCH ? 900 : 2500);
  props = new Props(scene, world);
  rampage = new Rampage(scene, world, traffic, props, {
    message: (t) => message(t, 2.5),
    sound: (k) => sound.blip(k),
    canBreak: () => !google,
    driving: () => {
      setBotUi();
      $('driveBtn').hidden = true;
    },
    // Every explosion: a boom and a camera shake, both fading with distance.
    boom: (size, x, z) => {
      const d = Math.hypot(x - flight.pos.x, z - flight.pos.z);
      const k = Math.min(1, size / 20) / (1 + d / 120);
      sound.noiseHit('boom', 0.3 + k);
      shake = Math.min(1.6, shake + k * 1.2);
    },
    hit: () => (hitStop = 0.07), // a punch that connects freezes the action for a beat
    scored: (pts, what) => {
      game?.onScore?.(pts, what);
      if (++logbook.smashed % 10 === 0) {
        saveLogbook();
        checkUnlocks();
      }
    },
    wrecked: (c) => mpSendSmash(c),
    threw: () => {},
  });
  game?.dispose();
  game = null;
  beerRun?.dispose();
  beerRun = data.beerRun ? new BeerRun(scene, world, $('labels'), {
    toast,
    sound: (k) => sound.blip(k),
    onEnd: endShift,
  }) : null;

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
  scene.fog.near = google ? 6000 : data.fog?.[0] ?? 2500;
  scene.fog.far = (google ? 30000 : data.fog?.[1] ?? 11000) * (prefs.low ? 0.6 : 1);
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
  leaveBot();
  if (bot) disposeObjects([bot.model.group]);
  if (plane) disposeObjects([plane.group]);
  clearDebris();
  isHeli = settings.vehicle === 'heli';
  plane = isHeli ? createGhostSpiderHeli() : createLegoPlane();
  scene.add(plane.group);
  flight = isHeli ? new HeliFlight(world, plane) : new Flight(world, plane);
  const model = createRobot(settings.vehicle);
  model.group.visible = false;
  scene.add(model.group);
  applyPaint(plane);
  applyPaint(model);
  bot = { model, walk: new RobotWalk(world, model) };
  bot.walk.onSlam = (speed) => rampage.slam(bot.walk, speed) && updateBotHud();
  // Walking (or driving) into a building knocks it down.
  bot.walk.onRam = (c) => rampage.wreck(c, { x: bot.walk.vel.x || 1, z: bot.walk.vel.z });
  model.onStep = () => {
    if (!running || !isBot) return;
    sound.noiseHit('step', 0.5 + flight.speed / 40);
    shake = Math.min(1, shake + 0.08);
  };
  input.heliMode = isHeli;
  document.body.classList.toggle('heli', isHeli);
  $('throttleLabel').textContent = isHeli ? 'SPEED' : 'THROTTLE';
  tilt = flight.onGround && !isHeli ? GROUND_TILT : 0;
  floatsAnim = 0;
  boosterLevel = 0;
  camInit = false;
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
  if (isBot) return;
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
  // The pack shows with turbo, and whenever the robot's jets are burning.
  const jets = isBot && flight.jetting;
  const on = (flight.turbo > 1 || jets) && !flight.crashed;
  if (on) boosterColor = Math.max(flight.turbo, 2);
  sound.jet?.(jets && running ? 1 + 0.25 * (flight.turboNow - 1) : 0);
  boosterLevel += ((on ? 1 : 0) - boosterLevel) * (1 - Math.exp(-dt * 5));
  // The robot's rockets burn hardest while running or jet-jumping.
  const power = isBot ? (flight.jetting ? 1 : Math.min(1, flight.speed / 40)) : flight.throttle;
  plane.updateBoosters(boosterLevel, boosterColor, power, timer.getElapsed());
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
const camFwd = new THREE.Vector3(0, 0, -1);
let camInit = false;
let botAir = 0; // eases to 1 while the robot is airborne (camera pulls back)
function updateCamera(dt) {
  const mode = CAMS[camMode];
  const p = plane.group.position;
  const up = flight.up.clone();
  const flatF = flight.forward.clone().setY(0).normalize();
  // The chase camera follows a smoothed nose direction, so a quick pitch change
  // glides instead of jerking the view. The copter's lean is just for show: its
  // camera stays level and only follows the heading.
  const wantF = isHeli || isBot ? flatF : flight.forward;
  if (!camInit) camFwd.copy(wantF);
  camFwd.lerp(wantF, 1 - Math.exp(-dt * 3)).normalize();
  const f = camFwd.clone();
  let want;
  let look;
  if (window.__game?.photo) {
    const ph = window.__game.photo; // test hook: fixed camera relative to the plane (or anywhere)
    if (ph.pos) camera.position.copy(ph.pos);
    else camera.position.copy(p).add(ph.offset);
    camera.up.set(0, 1, 0);
    if (ph.target) camera.lookAt(ph.target.x, ph.target.y, ph.target.z);
    else camera.lookAt(p);
    return;
  }
  for (const m of plane.cockpitHidden) m.visible = mode !== 'cockpit';
  // From the cockpit the propeller is hidden (up close, its blur disc filled the sky).
  if (!isHeli && !isBot) for (const c of plane.propeller.children) c.visible = mode !== 'cockpit';
  if (mode === 'cockpit') {
    plane.group.updateMatrixWorld();
    camera.position.copy(plane.cockpitEye).applyMatrix4(plane.group.matrixWorld);
    camera.quaternion.copy(plane.group.quaternion);
    camera.up.copy(up);
    camInit = false;
    return;
  }
  if (isBot) {
    // Over the robot's shoulder, far enough back to see what it's about to hit.
    // Pull back a little while flying on the jets, to see where you're going.
    botAir += ((isBot && !flight.onGround ? 1 : 0) - botAir) * (1 - Math.exp(-dt * 1.5));
    const back = (mode === 'chase' ? 36 : 80) * (1 + 0.35 * (flight.driving || 0)) * (1 + 0.5 * botAir);
    want = p.clone().addScaledVector(flatF, -back).add(new THREE.Vector3(0, mode === 'chase' ? 19 : 42, 0));
    look = p.clone().addScaledVector(flatF, 14).add(new THREE.Vector3(0, 9, 0));
    if (potty.sitting > 0) {
      // On the toilet: look from the front, so the tank isn't in the way.
      want = p.clone().addScaledVector(flatF, 30).addScaledVector(flight.right, 12).add(new THREE.Vector3(0, 13, 0));
      look = p.clone().add(new THREE.Vector3(0, 7, 0));
    }
  } else if (mode === 'chase') {
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
  if (shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * shake * 2.4;
    camera.position.y += (Math.random() - 0.5) * shake * 2.4;
    camera.position.z += (Math.random() - 0.5) * shake * 2.4;
    shake *= Math.exp(-dt * 6);
  }
  camera.up.set(0, 1, 0).lerp(up, isHeli ? 0.08 : 0.25).normalize();
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
  // (During a Beer Run shift only the delivery target is marked.)
  const pins = play() ? [] : [...world.locators.map((l) => ({ x: l.x, z: l.z, color: '#' + l.color.toString(16).padStart(6, '0'), name: l.name })),
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

  // Robot mode: things to grab show as small yellow squares.
  if (isBot) {
    mctx.fillStyle = '#ffe14d';
    mctx.strokeStyle = '#1b2a34';
    mctx.lineWidth = 1.5;
    for (const it of rampage.mapMarks(p.x, p.z, range / 2)) {
      const [x, y] = toMap(it.x, it.z);
      mctx.fillRect(x - 4, y - 4, 8, 8);
      mctx.strokeRect(x - 4, y - 4, 8, 8);
    }
  }

  // Beer Run: the followed order's route as a dashed line, then each stop in
  // its order's color with the letter (squares load, circles deliver).
  const route = play()?.mapRoute();
  if (route) {
    mctx.setLineDash([10, 8]);
    mctx.lineWidth = 4;
    mctx.strokeStyle = route.color;
    mctx.beginPath();
    mctx.moveTo(W / 2, W / 2);
    for (const pt of route.points) mctx.lineTo(...toMap(pt.x, pt.z));
    mctx.stroke();
    mctx.setLineDash([]);
  }
  for (const m of play()?.mapMarks() || []) {
    let [x, y] = toMap(m.x, m.z);
    const off = x < 14 || y < 14 || x > W - 14 || y > W - 14;
    if (off && !m.guide) continue;
    if (off) {
      const dx = x - W / 2;
      const dy = y - W / 2;
      const f = (W / 2 - 16) / Math.max(Math.abs(dx), Math.abs(dy));
      x = W / 2 + dx * f;
      y = W / 2 + dy * f;
    }
    const r = m.guide ? 15 : 11;
    mctx.globalAlpha = m.later ? 0.6 : 1;
    mctx.fillStyle = m.color;
    mctx.strokeStyle = m.guide ? '#fff' : '#1b2a34';
    mctx.lineWidth = 3;
    mctx.beginPath();
    if (m.kind === 'brewery') mctx.rect(x - r, y - r, r * 2, r * 2);
    else mctx.arc(x, y, r, 0, Math.PI * 2);
    mctx.fill();
    mctx.stroke();
    mctx.globalAlpha = 1;
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
const touch = { vy: 0 }; // sink rate just before touching down
function updateHud(dt) {
  const p = plane.group.position;
  $('spd').textContent = Math.round(flight.speed * 2.237); // m/s -> mph
  $('alt').textContent = Math.round((p.y - plane.gearHeight + world.baseElevation) * 3.281).toLocaleString();
  const hdg = Math.round(flight.heading) % 360;
  $('hdg').textContent = compass(hdg);
  $('hdgDeg').textContent = `${String(hdg).padStart(3, '0')}°`;
  $('thrFill').style.width = `${Math.round((flight.throttle || 0) * 100)}%`;
  updateBuddies();
  updateAutoLandButton();
  updateDriveButton();

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
  // Logbook: flying (or walking) within 250 m of a landmark finds it.
  if (best && bestD < 250 && !logbook.landmarks[`${settings.city}:${best.name}`]) {
    logbook.landmarks[`${settings.city}:${best.name}`] = 1;
    saveLogbook();
    const here = world.landmarks.filter((l) => logbook.landmarks[`${settings.city}:${l.name}`]).length;
    if (!play()) toast(`📍 Found ${best.name} (${here} of ${world.landmarks.length} here)`, '#f2cd37');
    checkUnlocks();
  }

  if (!flight.onGround) touch.vy = flight.verticalSpeed;
  if (!flight.crashed) {
    const agl = p.y - plane.gearHeight - world.heightAt(p.x, p.z);
    if (isBot) wasOnGround.v = flight.onGround; // a robot jumping isn't a takeoff or a landing
    if (wasOnGround.v && !flight.onGround && agl > 1) message('Airborne! 🛫', 2);
    if (!wasOnGround.v && flight.onGround) {
      const hp = data.helipad;
      const onPad = isHeli && hp && Math.hypot(p.x - hp.x, p.z - hp.z) < 14;
      // Rate the touchdown: how gently, and (on the runway) how close to the centerline.
      const rw = world.runway;
      const onRunway = world.isOnRunway(p.x, p.z);
      const off = Math.abs(-(p.x - rw.x) * rw.fz + (p.z - rw.z) * rw.fx);
      const sink = Math.abs(touch.vy);
      let stars = sink < 2 ? 3 : sink < 5 ? 2 : 1;
      if (onRunway && off > rw.width * 0.3 && stars > 1) stars--;
      const word = ['', 'Firm one!', 'Smooth!', 'Butter!'][stars];
      const where = onPad ? 'Right on the helipad! 🚁' : flight.onWater ? 'Splashdown! 🌊' : onRunway ? 'On the runway 🛬' : 'Landed in a field';
      message(`${where} ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)} ${word}<small>${(sink * 197).toFixed(0)} ft/min${onRunway ? ` · ${off.toFixed(0)} m off the centerline` : ''}</small>`, 4);
      if (flight.onWater) sound.noiseHit('splash');
      if (stars === 3) {
        logbook.butter++;
        saveLogbook();
        sound.blip('star');
        checkUnlocks();
      }
    }
    if (flight.canStall !== false && !flight.onGround && flight.speed < 26 && flight.forward.y > -0.3) {
      message('STALL — lower the nose!', 0.3);
    }
    if (Math.abs(p.x) > world.halfX + 1500 || Math.abs(p.z) > world.halfZ + 1500) {
      message(`Leaving ${data.name.split(',')[0]} — turn back!`, 0.3);
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
    el.innerHTML = '<span class="arrow">➤</span><span class="txt"><span class="who"></span> <span class="far"></span></span>';
    box.appendChild(el);
  }
  const p = plane.group.position;
  players.forEach((pl, i) => {
    const el = box.children[i];
    el.style.setProperty('--c', pl.color);
    const arrow = el.querySelector('.arrow');
    // Names come from other players: set as text, never as HTML.
    el.querySelector('.who').textContent = pl.name;
    const far = el.querySelector('.far');
    if (pl.city !== settings.city) {
      arrow.style.transform = '';
      arrow.textContent = '✈';
      far.textContent = `in ${CITIES[pl.city] || 'another city'}`;
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
    far.textContent = `${fmtDist(Math.hypot(dx, dz))} ${compass(bearing)}${alt}${pl.cash != null ? ` · 💰$${pl.cash.toLocaleString()}` : ''}`;
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
  const shift = !!play() && gameMode() !== 'rampage'; // during a game the target is the only place tagged
  world.locators.forEach((l, i) => {
    if (shift) return void (pinEls[i].style.display = 'none');
    const d = Math.hypot(l.x - p.x, l.z - p.z);
    pinEls[i].textContent = `📍 ${l.name} · ${d < 1000 ? Math.round(d) + ' m' : (d / 1609).toFixed(1) + ' mi'}`;
    items.push({ el: pinEls[i], x: l.x, y: l.y + 170, z: l.z, d, pin: true });
  });
  world.landmarks.forEach((l, i) => {
    if (shift) return void (labelEls[i].style.display = 'none');
    const d = Math.hypot(l.x - p.x, l.z - p.z);
    items.push({ el: labelEls[i], x: l.x, y: l.y + 40 + d * 0.01, z: l.z, d, pin: false, hide: d > maxDist });
  });
  if (beerRun) items.push(...beerRun.labelItems(p));
  if (game) items.push(...game.labelItems(p));
  if (race) {
    const d = Math.hypot(race.target.x - p.x, race.target.z - p.z);
    raceLabel.textContent = `🏁 ${race.target.name} · ${fmtDist(d)}`;
    items.push({ el: raceLabel, x: race.target.x, y: race.target.y + 120, z: race.target.z, d, pin: true });
  } else {
    raceLabel.style.display = 'none';
  }
  if (potty.need) {
    const t = nearestToilet();
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    pottyLabel.textContent = `🚽 Toilet · ${fmtDist(d)}`;
    items.push({ el: pottyLabel, x: t.x, y: t.y + 60, z: t.z, d, pin: true });
  } else {
    pottyLabel.style.display = 'none';
  }
  for (const pl of mp.visible(settings.city)) {
    if (!pl.label) {
      pl.label = document.createElement('div');
      pl.label.className = 'label player';
      $('labels').appendChild(pl.label);
    }
    pl.label.style.setProperty('--pin', pl.color);
    pl.label.textContent = pl.name;
    const d = Math.hypot(pl.pos.x - p.x, pl.pos.z - p.z);
    items.push({ el: pl.label, x: pl.pos.x, y: pl.pos.y + 4.5, z: pl.pos.z, d, pin: true, player: true });
  }
  for (const el of document.querySelectorAll('.label.player')) {
    if (![...mp.players.values()].some((pl) => pl.label === el && pl.city === settings.city)) el.style.display = 'none';
  }
  // Other players' name tags first (always shown), then map pins, then nearest landmarks.
  items.sort((a, b) => (!!b.player - !!a.player) || (b.pin - a.pin) || a.d - b.d);
  const placed = [];
  if (msgTimer > 0 && $('message').textContent) {
    const r = $('message').getBoundingClientRect(); // keep tags out from under the big message
    placed.push([r.left, r.top, r.right, r.bottom]);
  }
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
    if (!it.player && placed.some((q) => hit(rect, q))) {
      it.el.style.display = 'none';
      continue;
    }
    placed.push(rect);
    it.el.style.left = `${x}px`;
    it.el.style.top = `${y}px`;
    const fade = it.pin ? 1 : THREE.MathUtils.clamp(1.4 - it.d / 4000, 0.3, 1);
    it.el.style.opacity = String(!it.player && veh && hit(rect, veh) ? 0.08 : fade);
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

/** Reset the flight to an airborne state (used by respawn); keeps the session running. */
function airborneRestart() {
  autoLand = null;
  flight.resetAirborne();
  tilt = 0;
  boosterLevel = 0;
}

function start(airborne, { lesson = false } = {}) {
  // Runs inside the tap, so the motion-sensor permission prompt is allowed here.
  if (input.isTouch) input.setTilt(phoneSteering === 'tilt').then((on) => on && !isBot && !coach && message('Tilt to steer — tap CENTER to re-center', 3));
  leaveBot();
  potty.sitting = 0;
  rampage.reset(); // a fresh start puts the city back together
  updateBotHud();
  clearDebris();
  autoLand = null;
  trail = [];
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
  $('beerEnd').hidden = true;
  logbook.cities[settings.city] = 1;
  saveLogbook();
  if (startGame()) {
    if (coach) endCoach(false);
    return;
  }
  // First time (or from Settings): the flying lesson walks you through it.
  let seen = true;
  try {
    seen = !!localStorage.getItem('legosky.lesson');
  } catch {}
  if (lesson || (!seen && !airborne && !new URLSearchParams(location.search).has('debug'))) return startCoach();
  if (coach) endCoach(false);
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
      const locked = mp.room && mp.settings && key !== 'vehicle';
      b.disabled = building || locked || (b.dataset.v === 'google' && !HAS_GOOGLE);
      b.title = locked ? 'Set by the room. Leave the room to change it.' : '';
    }
  }
  $('roomLock').hidden = !(mp.room && mp.settings);
  // Games: Beer Run only where the city has it.
  const mode = gameMode();
  for (const b of $('segMode').querySelectorAll('button')) {
    const on = b.dataset.v === mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.disabled = building;
    if (b.dataset.v === 'beer') b.hidden = !data.beerRun;
  }
  $('beerIntro').hidden = mode === 'free';
  $('modeIntro').innerHTML = MODE_INTRO[mode] || '';
  $('startAir').hidden = mode === 'rampage' || mode === 'rings';
  if (mode !== 'free' && !pausedFlight) {
    $('startRunway').textContent = { beer: `🍺 Start a shift from ${base}`, rings: '⭕ Start the Ring Race', rampage: '🤖 Start the Rampage' }[mode];
    $('startAir').textContent = '🍺 Start a shift in the air';
  }
  if (mode !== 'free') watchBoard();
  renderLogbook();
  for (const b of $('segSky').querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.v === prefs.sky);
    b.setAttribute('aria-pressed', String(b.dataset.v === prefs.sky));
  }
  $('segCity').querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  $('previewText').textContent = `${VEHICLE_NAMES[settings.vehicle]} · ${LOOK_NAMES[settings.look]} · ${CITIES[settings.city]}`;
  $('previewBusy').hidden = !building;
  $('startRunway').disabled = $('startAir').disabled = building;
  $('attrib').hidden = !google;
}
async function applySetting(key, value) {
  return applySettings({ [key]: value });
}
/** Change one or more settings and rebuild once. City and look are locked while in a room. */
/** Joined a room: switch to its city and look, then lock them. */
async function applyRoomSettings(r) {
  const changes = {};
  if (r.city in CITIES) changes.city = r.city;
  if (r.look in LOOK_NAMES && (r.look !== 'google' || HAS_GOOGLE)) changes.look = r.look;
  if (building) await new Promise((res) => { const iv = setInterval(() => !building && (clearInterval(iv), res()), 100); });
  if (running && Object.entries(changes).some(([k, v]) => settings[k] !== v)) {
    running = false; // a different world loads under you: back to the menu
    $('menu').hidden = false;
    $('hud').hidden = $('touch').hidden = $('labels').hidden = true;
  }
  await applySettings(changes, { force: true });
  updateMenu();
  if (Object.keys(changes).length) toast(`Room settings: ${CITIES[settings.city]} · ${LOOK_NAMES[settings.look]}`, '#2f8a45');
}
async function applySettings(changes, { force = false } = {}) {
  const roomLocked = mp.room && mp.settings && !force;
  const next = Object.entries(changes).filter(([k, v]) => settings[k] !== v && !(roomLocked && k !== 'vehicle'));
  if (building || !next.length) return;
  for (const [k, v] of next) settings[k] = v;
  saveSettings();
  const key = next.length === 1 && next[0][0] === 'vehicle' ? 'vehicle' : 'world';
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
// City cards show a satellite picture of their downtown.
for (const b of $('segCity').querySelectorAll('button')) {
  b.style.setProperty('--img', `url("${new URL(`cities/thumbs/${b.dataset.v}.jpg`, location.href).href}")`);
}
for (const b of $('segMode').querySelectorAll('button')) {
  b.onclick = () => {
    settings.mode = b.dataset.v;
    saveSettings();
    pausedFlight = false; // a different game: start fresh
    updateMenu();
  };
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
  if (data) updateMenu();
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
    const where = r.city ? `${CITIES[r.city] || r.city} · ${LOOK_NAMES[r.look] || ''}`
      : [...new Set(r.players.map((p) => CITIES[p.city] || p.city))].join(' & ');
    li.innerHTML = '<div><b></b><span></span></div><button class="small-btn">Join</button>';
    li.querySelector('b').textContent = `${who}`;
    li.querySelector('span').textContent = `Room ${r.code} · ${where}`;
    li.querySelector('button').onclick = () => joinRoom(r.code);
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
$('crashRespawn').onclick = () => respawnHere();
input.on('respawn', () => respawnHere());
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

// ------------------------------------------------------------------ games
// Beer Run (Fort Collins, src/beerrun.js), Ring Race and Rampage (src/games.js).
// Here: starting them, the shared HUD strip, the end card, personal bests and
// the leaderboards kept on the relay server (one per game and city).
const gameMode = () => (settings.mode === 'beer' && !data?.beerRun ? 'free' : settings.mode);
const beerOn = () => !!beerRun && gameMode() === 'beer';
/** The game in progress, if any. */
const play = () => (beerRun?.active ? beerRun : game?.active ? game : null);
const gameKey = (mode = gameMode()) => (mode === 'beer' ? 'beer' : `${mode}:${settings.city}`);
const GAME_UI = {
  beer: { over: "🍺 Shift's over!", fmt: (n) => `$${n.toLocaleString()}`, again: 'Run another shift' },
  rings: { over: '⭕ Race finished!', fmt: (n) => `${n.toLocaleString()} pts`, again: 'Race again' },
  rampage: { over: '🤖 Rampage over!', fmt: (n) => `${n.toLocaleString()} pts`, again: 'Rampage again' },
};
const MODE_INTRO = {
  beer: `Five-minute shift, one delivery at a time. Fly low through the brewery's <b class="amber">amber beam</b> (or land in it) to
    load kegs, then drop them at the shop's <b class="green">green beam</b> before the timer runs out. Early deliveries and
    on-time streaks pay more; crashing breaks your kegs.`,
  rings: `Fly through every ring in order, as fast as you can. The course runs from the airport around the city's landmarks.
    Beat the par time for ★★★.`,
  rampage: `Two minutes as a giant robot downtown. Smash buildings (taller pays more), throw cars, stomp from jet-jumps, and
    keep hitting things to build your combo.`,
};

/** Start the chosen game right after a normal start (called from start()). */
function startGame() {
  game?.stop();
  game?.dispose();
  game = null;
  const mode = gameMode();
  const hooks = { toast, sound: (k) => sound.blip(k) };
  document.body.classList.toggle('beer', mode !== 'free');
  $('beerHud').hidden = mode === 'free';
  if (mode === 'beer') {
    beerRun.start(isHeli ? 4 : 6);
    message(`🍺 Shift started! Head for the <span style="color:#ffb300">amber beam</span><small>${isHeli ? 4 : 6} kegs fit in your ${isHeli ? 'copter' : 'plane'}</small>`, 4);
    return true;
  }
  beerRun?.stop();
  if (mode === 'rings') {
    game = new RingRace(scene, world, $('labels'), { ...hooks, onEnd: (r) => endGame('rings', r.score, {
      title: r.stars ? `${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}` : 'Not finished', stars: r.stars,
      chips: [`⏱ ${fmtClock(r.time)} (par ${fmtClock(r.par)})`, `⭕ ${r.rings}/${r.total} rings`], note: fmtClock(r.time),
    }) });
    game.start(flight.pos, flight.heading, !isHeli);
    message(`⭕ Ring Race! ${game.rings.length} rings<small>Fly through the yellow ring, then the next. Par ${fmtClock(game.par)}</small>`, 4);
    return true;
  }
  if (mode === 'rampage') {
    game = new RampageGame(rampage, { ...hooks, onEnd: (r) => endGame('rampage', r.score, {
      title: r.stars ? `${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}` : 'Nothing smashed!', stars: r.stars,
      chips: [`🏢 ${r.buildings} buildings`, `🚗 ${r.cars} cars`, `🌲 ${r.trees} trees`, `🎯 ${r.thrown} thrown`, `🔥 best combo ×${r.bestCombo.toFixed(1)}`],
      note: `${r.buildings} buildings`,
    }) });
    // Drop in downtown as the robot.
    const sq = world.landmarks[0];
    transform();
    finishMorph();
    flight.place(new THREE.Vector3(sq.x + 20, world.heightAt(sq.x + 20, sq.z + 20), sq.z + 20), 0, null);
    camInit = false;
    game.start();
    message('🤖 RAMPAGE! Two minutes: smash everything<small>Taller buildings pay more. Keep hitting to build your combo</small>', 4);
    return true;
  }
  return false;
}
const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function updateBeerHud() {
  const g = play();
  if (!g) return;
  const h = g.hud(flight.pos, flight.heading);
  const hold = h.hold ? `🛢️ ${h.hold.loaded}/${h.hold.capacity}` : '';
  const stats = [h.cash, `⏱ ${h.clock}`, hold].filter(Boolean).join(' · ');
  $('beerCash').textContent = h.cash;
  $('beerClock').textContent = `⏱ ${h.clock}`;
  $('beerClock').classList.toggle('hurry', h.hurry);
  $('beerHold').textContent = hold;
  $('beerCombo').textContent = h.combo && `🔥${h.combo}`;
  $('beerHappy').textContent = h.happy;
  // What to do now: the step, where, which way and how long it has left.
  const m = h.mission;
  const mi = $('beerMission');
  mi.classList.toggle('waiting', !m);
  if (m) {
    mi.style.setProperty('--c', m.color);
    mi.querySelector('.beer-letter').textContent = m.icon;
    mi.querySelector('.step').textContent = m.step;
    mi.querySelector('.where').textContent = m.where;
    mi.querySelector('.next').textContent = m.next;
    mi.querySelector('.mini').textContent = `${stats}${m.next ? ` · ${m.next}` : ''}`;
    mi.querySelector('.arrow').style.transform = `rotate(${m.rel}deg)`;
    mi.querySelector('.dist').textContent = m.dist;
    mi.querySelector('.time').textContent = m.time;
    mi.querySelector('.time').classList.toggle('hurry', m.hurry);
    mi.querySelector('.beer-mbar').style.width = `${Math.max(0, m.frac) * 100}%`;
  } else {
    const idle = h.idle || { icon: '📋', step: 'NEXT DELIVERY', where: 'Coming in…' };
    mi.style.setProperty('--c', h.idle ? '#ff5fa2' : '#868e96');
    mi.querySelector('.beer-letter').textContent = idle.icon;
    mi.querySelector('.step').textContent = idle.step;
    mi.querySelector('.where').textContent = idle.where;
    mi.querySelector('.next').textContent = '';
    mi.querySelector('.mini').textContent = stats;
    mi.querySelector('.dist').textContent = mi.querySelector('.time').textContent = '';
    mi.querySelector('.beer-mbar').style.width = '0';
  }
  $('beerDwell').hidden = !h.dwell;
  if (h.dwell) {
    $('beerDwellArc').style.strokeDashoffset = String(119.4 * (1 - Math.min(1, h.dwell)));
    $('beerDwellArc').style.stroke = m?.color || '#ffb300';
    $('beerDwellText').textContent = h.dwellText;
  }
}

let lastShift = null;
/** Beer Run's end of shift. */
function endShift(stats) {
  const chips = [
    `🚚 ${stats.deliveries} deliver${stats.deliveries === 1 ? 'y' : 'ies'}`, `🛢️ ${stats.kegs} kegs`, `🔥 best streak ×${stats.bestCombo.toFixed(2).replace(/0$/, '')}`,
    stats.rush && `⚡ ${stats.rush} rush`, stats.vip && `⭐ ${stats.vip} VIP ($${stats.tips} tips)`,
    stats.missed && `⌛ ${stats.missed} missed`, stats.broken && `💥 ${stats.broken} kegs broken`,
  ].filter(Boolean);
  endGame('beer', stats.cash, { title: `🏅 ${stats.title}`, chips, note: `${stats.deliveries} deliveries`, stars: stats.cash >= 1500 ? 3 : stats.cash >= 600 ? 2 : stats.cash > 0 ? 1 : 0 });
}
/** The end card for any game: score, stars, personal best, the room, the leaderboard. */
function endGame(mode, score, { title, chips, note, stars = 0 }) {
  const ui = GAME_UI[mode];
  const key = gameKey(mode);
  lastShift = { cash: score, note, vehicle: settings.vehicle, posted: false, key, mode };
  running = false;
  pausedFlight = false;
  leaveBot();
  $('hud').hidden = $('touch').hidden = $('labels').hidden = true;
  $('beerHud').hidden = $('beerDwell').hidden = true;
  document.body.classList.remove('beer');
  sound.blip(stars ? 'star' : 'cash');
  $('beerEnd').querySelector('h2').textContent = ui.over;
  $('beerEndCash').textContent = ui.fmt(score);
  $('beerEndTitle').textContent = title;
  $('beerAgain').textContent = ui.again;
  const best = logbook.best[key] || 0;
  if (score > best) logbook.best[key] = score;
  if (stars > (logbook.stars[key] || 0)) logbook.stars[key] = stars;
  saveLogbook();
  $('beerEndBest').textContent = score > best ? (best ? `New personal best! (was ${ui.fmt(best)})` : 'Your first try: now beat it!')
    : `Personal best: ${ui.fmt(best)}`;
  $('beerEndBest').classList.toggle('new', score > best);
  $('beerEndStats').replaceChildren(...chips.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
  // Flying with others: how everyone playing is doing right now.
  const others = [...mp.players.values()].filter((pl) => pl.cash != null);
  $('beerEndRoom').hidden = !others.length;
  $('beerEndRoom').replaceChildren(...[{ name: `${mp.name || 'You'} (you)`, cash: score, color: '#c91a09' }, ...others]
    .sort((x, y) => y.cash - x.cash)
    .map((pl, i) => {
      const li = document.createElement('li');
      li.style.setProperty('--c', pl.color);
      li.textContent = `${i + 1}. ${pl.name} · ${ui.fmt(pl.cash)}`;
      return li;
    }));
  $('beerName').value = mp.name || mpName || '';
  $('beerPost').hidden = !BOARD_OK || score <= 0;
  $('beerSubmit').disabled = false;
  $('beerSubmit').textContent = 'Post my score';
  $('beerPlaced').hidden = true;
  watchBoard();
  renderBoard();
  $('beerEnd').hidden = false;
  checkUnlocks();
}
$('beerAgain').onclick = () => start(false);
$('beerMenu').onclick = () => {
  $('beerEnd').hidden = true;
  $('menu').hidden = false;
  updateMenu();
};

// Leaderboards: this week's and all-time best, shared by everyone on the server.
const BOARD_OK = !/claude\.ai|claudeusercontent/.test(location.host) && location.protocol !== 'file:';
let board = null;
let boardTab = 'week';
let boardWs = null;
let boardKey = null;
function watchBoard() {
  const key = lastShift && !$('beerEnd').hidden ? lastShift.key : gameKey();
  if (!BOARD_OK || (boardWs && boardKey === key)) return;
  if (boardWs) {
    boardWs.onclose = null;
    boardWs.close();
  }
  board = null;
  boardKey = key;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = (boardWs = new WebSocket(`${proto}://${location.host}/ws?role=board&game=${encodeURIComponent(key)}`));
  ws.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m.t === 'board') {
      board = m;
      renderBoard();
    } else if (m.t === 'placed') {
      const r = m.week || m.all;
      $('beerPlaced').hidden = false;
      $('beerPlaced').textContent = m.week ? `🏆 You're #${m.week} this week${m.all ? ` and #${m.all} of all time` : ''}!`
        : r ? `🏆 #${r} of all time!` : 'Posted! Not in the top 10 yet. Try again!';
    }
  };
  ws.onclose = () => {
    boardWs = null;
    setTimeout(() => (!$('beerEnd').hidden || gameMode() !== 'free' ? watchBoard() : null), 5000);
  };
}
function renderBoard() {
  const fmt = GAME_UI[(boardKey || 'beer').split(':')[0]]?.fmt || ((n) => String(n));
  const list = board?.[boardTab] || [];
  const me = lastShift?.posted && lastShift;
  $('beerBoard').replaceChildren(...(list.length ? list.map((e) => {
    const li = document.createElement('li');
    const sc = document.createElement('span');
    sc.className = 'sc';
    sc.textContent = fmt(e.score);
    li.append(`${e.name} ${e.vehicle === 'heli' ? '🕷️' : '✈️'}${e.note ? ` · ${e.note}` : e.deliveries ? ` · ${e.deliveries} deliveries` : ''}`, sc);
    if (me && e.name === me.postedName && e.score === me.cash) li.className = 'me';
    return li;
  }) : [Object.assign(document.createElement('li'), { className: 'muted', textContent: board ? 'No scores yet. Be the first!' : 'Leaderboard needs the game server.' })]));
  const top = board?.week?.slice(0, 3) || [];
  $('beerTop3').textContent = top.length ? `🏆 This week: ${top.map((e, i) => `${i + 1}. ${e.name} ${fmt(e.score)}`).join('  ')}` : '';
}
for (const b of document.querySelectorAll('.beer-tabs button')) {
  b.onclick = () => {
    boardTab = b.dataset.b;
    for (const x of document.querySelectorAll('.beer-tabs button')) {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    }
    renderBoard();
  };
}
$('beerSubmit').onclick = () => {
  const name = $('beerName').value.trim().slice(0, 16) || 'Pilot';
  if (!lastShift || lastShift.posted || boardWs?.readyState !== 1) return;
  boardWs.send(JSON.stringify({ t: 'score', name, score: lastShift.cash, note: lastShift.note, vehicle: lastShift.vehicle }));
  lastShift.posted = true;
  lastShift.postedName = name;
  try {
    localStorage.setItem('legosky.name', name);
  } catch {}
  $('beerSubmit').disabled = true;
  $('beerSubmit').textContent = 'Posted ✓';
};

// ------------------------------------------------------------------ logbook and paint jobs
// The logbook remembers (on this device) where you've been and what you've done;
// its totals unlock paint jobs for the vehicle and its robot.
const logbook = { cities: {}, landmarks: {}, stars: {}, best: {}, smashed: 0, butter: 0, ...(() => {
  try {
    return JSON.parse(localStorage.getItem('legosky.log') || '{}');
  } catch {
    return {};
  }
})() };
function saveLogbook() {
  try {
    localStorage.setItem('legosky.log', JSON.stringify(logbook));
  } catch {}
}
const logCount = () => ({
  cities: Object.keys(logbook.cities).length, landmarks: Object.keys(logbook.landmarks).length,
  stars: Object.values(logbook.stars).reduce((a, n) => a + n, 0), smashed: logbook.smashed, butter: logbook.butter,
});
const PAINTS = [
  { id: 'classic', name: 'Classic', color: null, need: () => true, how: '' },
  { id: 'red', name: 'Fire Red', color: 0xd01712, need: (c) => c.landmarks >= 5, how: 'Find 5 landmarks' },
  { id: 'blue', name: 'Sky Blue', color: 0x2f7fe0, need: (c) => c.cities >= 3, how: 'Fly in 3 cities' },
  { id: 'green', name: 'Racing Green', color: 0x1f8a43, need: (c) => c.stars >= 5, how: 'Earn 5 ★ in games' },
  { id: 'black', name: 'Stealth', color: 0x23272b, need: (c) => c.smashed >= 100, how: 'Smash 100 things as the robot' },
  { id: 'silver', name: 'Chrome', color: 0xc9d0d6, need: (c) => c.butter >= 1, how: 'Make a ★★★ butter landing' },
  { id: 'purple', name: 'Royal Purple', color: 0x7a3fd0, need: (c) => c.landmarks >= 25, how: 'Find 25 landmarks' },
  { id: 'gold', name: 'Gold', color: 0xe8b923, need: (c) => c.stars >= 15, how: 'Earn 15 ★ in games' },
];
const ACCENT = { plane: 0xf2cd37, heli: 0xf0368f }; // the part of each vehicle that takes the paint
/** Repaint a model's accent-colored parts. */
function applyPaint(model) {
  const paint = PAINTS.find((x) => x.id === prefs.paint);
  if (!paint?.color || !paint.need(logCount())) return;
  const from = new THREE.Color(ACCENT[settings.vehicle]);
  model.group.traverse((o) => {
    for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) {
      if (m.color && Math.abs(m.color.r - from.r) + Math.abs(m.color.g - from.g) + Math.abs(m.color.b - from.b) < 0.02) m.color.setHex(paint.color);
    }
  });
}
let unlockedBefore = null;
/** Announce paint jobs that just unlocked, and refresh the menu's logbook. */
function checkUnlocks() {
  const c = logCount();
  const now = PAINTS.filter((x) => x.need(c)).map((x) => x.id);
  if (unlockedBefore) {
    for (const id of now) {
      if (!unlockedBefore.includes(id)) {
        toast(`🎨 New paint job unlocked: ${PAINTS.find((x) => x.id === id).name}! (Menu → Fly)`, '#e8b923');
        sound.blip('star');
      }
    }
  }
  unlockedBefore = now;
}
function renderLogbook() {
  const c = logCount();
  const here = world.landmarks.filter((l) => logbook.landmarks[`${settings.city}:${l.name}`]).length;
  $('logSummary').textContent = `· ${c.stars} ★ · ${c.landmarks} landmarks`;
  const rows = [
    ['Cities flown', `${c.cities} of ${Object.keys(CITIES).length}`], [`Landmarks found in ${CITIES[settings.city]}`, `${here} of ${world.landmarks.length}`],
    ['Landmarks found everywhere', c.landmarks], ['Stars earned in games', `${c.stars} ★`], ['Things smashed as the robot', c.smashed.toLocaleString()],
    ['Butter landings (★★★)', c.butter], ['Potty breaks taken 🚽', logbook.potty || 0],
  ];
  $('logbook').replaceChildren(...rows.map(([k, v]) => {
    const d = document.createElement('div');
    d.className = 'row';
    d.append(Object.assign(document.createElement('span'), { textContent: k }), Object.assign(document.createElement('b'), { textContent: String(v) }));
    return d;
  }));
  $('paints').replaceChildren(...PAINTS.map((x) => {
    const b = document.createElement('button');
    const ok = x.need(c);
    b.disabled = !ok || building;
    b.title = ok ? x.name : `Locked: ${x.how}`;
    b.classList.toggle('on', prefs.paint === x.id);
    b.style.setProperty('--c', x.color ? `#${x.color.toString(16).padStart(6, '0')}` : `#${ACCENT[settings.vehicle].toString(16)}`);
    b.append(document.createElement('i'), ok ? x.name : `🔒 ${x.how}`);
    b.onclick = () => {
      prefs.paint = x.id;
      savePrefs();
      buildVehicle();
      updateMenu();
    };
    return b;
  }));
}

// ------------------------------------------------------------------ room games
// In a multiplayer room: races to a landmark, tag, and robots' destruction
// shown to everyone. All of it rides on the room's connection as small messages.
let race = null; // { target (landmark), by }
let tagIt = null; // id of the player who is "it" ('me' for this player)
let tagCool = 0;
const raceLabel = document.createElement('div');
raceLabel.className = 'label pin';
raceLabel.style.setProperty('--pin', '#e8590c');
raceLabel.style.display = 'none';
$('labels').appendChild(raceLabel);
const nameOf = (id) => mp.players.get(id)?.name || 'Someone';

// Smashing: tell the room which buildings and trees went down (batched).
let smashQueue = [];
mpSendSmash = (c) => mp.room && smashQueue.push(c.id);
setInterval(() => {
  if (!smashQueue.length) return;
  mp.send({ t: 'smash', city: settings.city, ids: smashQueue.splice(0, 60) });
}, 300);

function startRace(index, by) {
  const target = world.landmarks[index];
  if (!target) return;
  race = { target, by };
  toast(`🏁 ${by} started a race to ${target.name}! First one there wins`, '#e8590c');
  sound.blip('load');
}
function endRace(winner) {
  if (!race) return;
  toast(`🏆 ${winner} won the race to ${race.target.name}!`, '#e8b923');
  sound.blip('star');
  race = null;
}
mp.onEvent = (m) => {
  if (m.t === 'smash' && m.city === settings.city && Array.isArray(m.ids)) {
    for (const id of m.ids.slice(0, 60)) {
      const c = world.byId[id];
      if (!c || !world.breakable(c) || google) continue;
      world.destroy(c);
      if (c.t !== 'tree' && Math.hypot(c.x - flight.pos.x, c.z - flight.pos.z) < 3000) rampage.explode(c.x, c.base + Math.min(c.h, 30) / 2, c.z, 14);
    }
  } else if (m.t === 'race') {
    startRace(Number(m.lm), nameOf(m.id));
  } else if (m.t === 'won') {
    endRace(nameOf(m.id));
  } else if (m.t === 'tag') {
    tagIt = m.it === mp.myId ? 'me' : m.it;
    tagCool = 3;
    toast(tagIt === 'me' ? `🏷️ ${nameOf(m.id)} tagged you. You're IT!` : `🏷️ ${nameOf(tagIt)} is IT!`, '#c06bff');
    sound.blip(tagIt === 'me' ? 'potty' : 'load');
  }
};
$('mpRace').onclick = () => {
  const p = flight.pos;
  const far = world.landmarks.map((l, i) => [l, i]).filter(([l]) => Math.hypot(l.x - p.x, l.z - p.z) > 2500);
  const pick = (far.length ? far : world.landmarks.map((l, i) => [l, i]))[Math.floor(Math.random() * (far.length || world.landmarks.length))];
  mp.send({ t: 'race', lm: pick[1] });
  startRace(pick[1], 'You');
};
$('mpTag').onclick = () => {
  tagIt = 'me';
  tagCool = 3;
  mp.send({ t: 'tag', it: mp.myId });
  toast("🏷️ Tag started. You're IT! Fly close to someone to tag them", '#c06bff');
};
/** Each frame while flying: has someone won the race, or been tagged? */
function updateRoomGames(dt) {
  if (!mp.room) race = tagIt = null;
  const p = flight.pos;
  const chip = [];
  if (race) {
    const d = Math.hypot(race.target.x - p.x, race.target.z - p.z);
    chip.push(`🏁 Race to ${race.target.name}: ${fmtDist(d)}`);
    if (d < 150) {
      mp.send({ t: 'won' });
      endRace('You');
    }
  }
  if (tagIt) {
    tagCool -= dt;
    if (tagIt !== 'me' && !mp.players.has(tagIt)) tagIt = null; // they left
    else if (tagIt === 'me') {
      chip.push("🏷️ You're IT! Get within 200 ft of someone");
      const near = tagCool <= 0 && mp.visible(settings.city).find((pl) => pl.pos.distanceTo(p) < 60);
      if (near) {
        tagIt = near.id;
        tagCool = 3;
        mp.send({ t: 'tag', it: near.id });
        toast(`🏷️ You tagged ${near.name}!`, '#c06bff');
        sound.blip('star');
      }
    } else {
      const it = mp.players.get(tagIt);
      chip.push(`🏷️ ${it.name} is IT (${fmtDist(it.pos.distanceTo(p))} away). Run!`);
    }
  }
  $('roomGame').hidden = !chip.length;
  $('roomGame').textContent = chip.join('  ·  ');
}

// ------------------------------------------------------------------ Android app
// The app (android/) is a window onto this page and adds "LegoSkyApp/<version>" to
// its user agent. Phone Back while flying opens the menu; from the menu it leaves the app.
window.legoSkyBack = () => {
  if (!$('phonePanel').hidden) $('phonePanel').hidden = true;
  else if (running) $('helpBtn').onclick();
  else return false;
  return true;
};
{
  const appVersion = +(navigator.userAgent.match(/LegoSkyApp\/(\d+)/)?.[1] || 0);
  const link = $('androidLink');
  if (appVersion) {
    // In the app: offer the newer APK when the server has one.
    fetch('/downloads/lego-sky.json', { cache: 'no-store' })
      .then((r) => r.json())
      .then((latest) => {
        if (latest.versionCode > appVersion) {
          link.textContent = `📲 Update the app (version ${latest.versionName})`;
          link.href = '/downloads/lego-sky.apk';
          link.hidden = false;
        }
      })
      .catch(() => {});
  } else if (/Android/i.test(navigator.userAgent)) {
    link.hidden = false;
  }
}

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
// Phones in a browser: a button to go fullscreen again (the address bar eats the screen).
const goFullscreen = () => document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })
  .then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
$('fsChip').onclick = goFullscreen;
const updateFsChip = () => ($('fsChip').hidden = !input.isTouch || !document.fullscreenEnabled || !!document.fullscreenElement);
document.addEventListener('fullscreenchange', updateFsChip);
updateFsChip();
$('phoneDone').onclick = () => ($('phonePanel').hidden = true);
setInterval(() => {
  if (!plane) return;
  const p = plane.group.position;
  remote.sendTelemetry({
    menu: !running,
    spd: Math.round(flight.speed * 1.944),
    alt: Math.round((p.y - plane.gearHeight + world.baseElevation) * 3.281),
    gear: isBot ? 'ROBOT' : flight.floats ? 'FLOATS' : isHeli ? 'LEGS' : 'WHEELS',
    bot: isBot,
    turbo: flight.turbo,
    vehicle: isHeli ? 'heli' : 'plane',
    crashed: flight.crashed,
    thr: flight.throttle,
  });
}, 200);

input.on('cam', () => (camMode = (camMode + 1) % CAMS.length));
input.on('autoland', () => running && !isBot && startAutoLand());
$('autoLandBtn').onclick = () => startAutoLand();
input.on('floats', () => (isBot ? botGrab() : toggleFloats()));
// Turbo modes: 1X normal, T2X and T3X multiply top speed by 2 and 3.
const turboName = (t) => (t === 1 ? '1X' : `T${t}X`);
function setTurbo(t) {
  if (!running) return;
  flight.turbo = t;
  if (!isBot) $('turboChip').textContent = t === 1 ? 'TURBO' : turboName(t); // (the robot's is SMASH)
  if (!isBot) $('turboChip').classList.toggle('on', t > 1);
  $('botTurboChip').textContent = t === 1 ? 'TURBO' : turboName(t);
  $('botTurboChip').classList.toggle('on', t > 1);
  message(t === 1 ? 'Turbo off — normal speed' : isBot ? `🚀 ${turboName(t)} — rocket legs, ${t}× speed and higher jumps!` : `🚀 ${turboName(t)} — ${t}× speed!`, 1.8);
}
input.on('turbo', () => (isBot ? botSmash() : setTurbo((flight.turbo % 3) + 1)));
input.on('turbo1', () => setTurbo(1));
input.on('turbo2', () => setTurbo(2));
input.on('turbo3', () => setTurbo(3));
input.on('map', toggleMap);
input.on('menuStart', () => !running && start(false));
input.on('menuAir', () => !running && start(true));
input.on('reset', () => running && start(false));
input.on('air', () => running && start(true));
input.on('pause', () => (running ? $('helpBtn').onclick() : pausedFlight && $('resumeBtn').onclick()));

// ------------------------------------------------------------------ robot mode
// F (or the 🤖 button) unfolds the vehicle into a giant robot and back. On the
// ground the robot walks; changing in the air drops it, and it lands with a
// stomp. Changing back on the ground parks the vehicle there; in the air (off a
// jump or a rooftop) it flies off.
const Y_AXIS = new THREE.Vector3(0, 1, 0);
function transform() {
  if (!running || autoLand || (!isBot && flight.crashed)) return;
  if (morph) finishMorph(); // changing again mid-change: skip to the end of the first
  const from = plane.group;
  if (!isBot) {
    const p = flight.pos;
    const yaw = -THREE.MathUtils.degToRad(flight.heading);
    bot.walk.place(new THREE.Vector3(p.x, p.y - plane.gearHeight, p.z), yaw, flight.vel);
    bot.walk.turbo = bot.walk.turboNow = flight.turbo || 1; // turbo carries over
    vehicle = { model: plane, flight };
    plane = bot.model;
    flight = bot.walk;
    isBot = true;
    message(input.isTouch ? '🤖 Robot mode! SMASH buildings, GRAB things and throw them'
      : '🤖 Robot mode!<small>X smash · G grab and throw · Space jump (hold to fly) · Shift run · F change back</small>', 4);
  } else {
    rampage.release(flight);
    const p = flight.pos;
    const yaw = flight.yaw;
    const parked = flight.onGround && p.y - world.heightAt(p.x, p.z) < 1.5;
    const { turbo } = flight; // turbo carries back
    plane = vehicle.model;
    flight = vehicle.flight;
    vehicle = null;
    isBot = false;
    parked ? flight.reset() : flight.resetAirborne();
    flight.turbo = turbo || 1;
    flight.pos.set(p.x, p.y + plane.gearHeight + (parked ? 0 : 3), p.z);
    if (isHeli) {
      flight.yaw = yaw;
      flight._updateQuat();
    } else {
      flight.quat.setFromAxisAngle(Y_AXIS, yaw);
      tilt = parked ? GROUND_TILT : 0;
    }
    if (parked && world.isWater(p.x, p.z)) flight.floats = true; // changing back in a lake: floats out
    input.syncThrottle(flight.throttle);
    input.resetLift();
    wasOnGround.v = flight.onGround;
    message(parked ? 'Back to the vehicle. Ready for takeoff!' : 'Back to the vehicle. Fly!', 2);
  }
  morph = { t: 0, from, to: plane.group };
  plane.group.visible = true;
  camInit = false;
  trail = [];
  sound.blip('transform');
  setBotUi();
}

function finishMorph() {
  if (!morph) return;
  morph.from.visible = false;
  morph.from.scale.setScalar(1);
  morph.to.scale.setScalar(1);
  morph = null;
}

/** Back to the vehicle at once, with no animation (restarts, menu changes). */
function leaveBot() {
  finishMorph();
  if (!isBot) return;
  rampage?.release(flight);
  bot.model.group.visible = false;
  plane = vehicle.model;
  flight = vehicle.flight;
  plane.group.visible = true;
  vehicle = null;
  isBot = false;
  setBotUi();
}

/** The shape change: the old shape spins and shrinks while the new one grows. */
function updateMorph(dt) {
  morph.t = Math.min(1, morph.t + dt / 0.55);
  const u = morph.t * morph.t * (3 - 2 * morph.t);
  morph.from.position.copy(plane.group.position);
  morph.from.scale.setScalar(Math.max(0.001, 1 - u));
  morph.from.rotation.y += dt * 14;
  morph.to.scale.setScalar(Math.max(0.001, u));
  if (morph.t >= 1) finishMorph();
}

function setBotUi() {
  document.body.classList.toggle('bot', isBot);
  input.botMode = isBot;
  // While driving a supersized car: JUMP and GRAB get out, SMASH honks (and boosts).
  const car = isBot && !!rampage?.driving;
  for (const [act, label] of [['brake', ['BRAKE', 'JUMP', 'EXIT']], ['floats', ['FLOATS', 'GRAB', 'EXIT']]]) {
    document.querySelector(`#touchButtons [data-act=${act}]`).textContent = label[car ? 2 : +isBot];
  }
  $('turboChip').textContent = car ? 'HORN' : isBot ? 'SMASH' : flight.turbo > 1 ? turboName(flight.turbo) : 'TURBO';
  $('turboChip').classList.toggle('on', !isBot && flight.turbo > 1);
  $('botChip').classList.toggle('on', isBot);
  $('botTurboChip').textContent = flight.turbo > 1 ? turboName(flight.turbo) : 'TURBO';
  $('botTurboChip').classList.toggle('on', flight.turbo > 1);
  updateBotHud();
}

function updateBotHud() {
  const n = rampage?.total || 0;
  $('botHud').hidden = !isBot && !n;
  $('botHud').textContent = `🤖 💥 ${n} smashed${rampage?.held ? ` · holding ${props.info(rampage.held.item.kind).name}` : ''}${rampage?.driving ? ` · driving ${props.info(rampage.driving.item.kind).name}` : ''}`;
}
function botSmash() {
  if (!running || !isBot) return;
  rampage.smash(flight);
  setTimeout(updateBotHud, 300);
}
function botGrab() {
  if (!running || !isBot) return;
  rampage.grabOrThrow(flight);
  updateBotHud();
}
input.on('transform', transform);
// The T key and the robot's own TURBO button cycle turbo in either shape
// (the vehicle's TURBO button doubles as SMASH for the robot).
input.on('turboKey', () => setTurbo((flight.turbo % 3) + 1));
input.on('botTurbo', () => setTurbo((flight.turbo % 3) + 1));
input.on('bigger', () => running && isBot && rampage.resize(flight, 2) && updateBotHud());
input.on('smaller', () => running && isBot && rampage.resize(flight, 0.5) && updateBotHud());
input.on('smash', botSmash);
input.on('grab', botGrab);
setInterval(() => isBot && updateBotHud(), 500);

// ------------------------------------------------------------------ settings, sky, quality
// Time of day: sky and fog color, light color and direction, and how lit the windows are.
const SKIES = {
  day: { sky: SKY, hemi: [0xdff0ff, 0x6a8a50, 1.6], sun: [0xfff4e0, 2.2], dir: [-0.45, 0.8, 0.35], night: 0 },
  sunset: { sky: 0xf0a56c, hemi: [0xffd9b0, 0x6a5a48, 1.0], sun: [0xff9a4a, 1.9], dir: [-0.85, 0.22, 0.3], night: 0.35 },
  night: { sky: 0x0b1430, hemi: [0x8fa8ff, 0x1c2433, 0.45], sun: [0xaab8ff, 0.55], dir: [0.4, 0.75, -0.3], night: 1 },
};
function applySky() {
  const k = SKIES[prefs.sky] || SKIES.day;
  scene.background.setHex(k.sky);
  scene.fog.color.setHex(k.sky);
  hemi.color.setHex(k.hemi[0]);
  hemi.groundColor.setHex(k.hemi[1]);
  hemi.intensity = k.hemi[2];
  sun.color.setHex(k.sun[0]);
  sun.intensity = k.sun[1];
  SUN_DIR.set(...k.dir).normalize();
  NIGHT.value = k.night;
}
for (const b of $('segSky').querySelectorAll('button')) {
  b.onclick = () => {
    prefs.sky = b.dataset.v;
    savePrefs();
    applySky();
    updateMenu();
  };
}
/** Low graphics: lower resolution, no shadows, nearer fog (and fewer cars from the next city load). */
function applyQuality() {
  renderer.setPixelRatio(prefs.low ? Math.min(window.devicePixelRatio, 1) * 0.8 : Math.min(window.devicePixelRatio, IS_TOUCH ? 1.25 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = !prefs.low;
  sun.castShadow = !prefs.low;
  if (world) scene.fog.far = (google ? 30000 : data.fog?.[1] ?? 11000) * (prefs.low ? 0.6 : 1);
  scene.traverse((o) => o.material && (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true)));
}
function applyPrefs() {
  input.sens = prefs.sens / 100;
  input.invertPitch = prefs.invert;
  sound.muted = !prefs.sound;
  sound.setMusic?.(prefs.music);
  $('setSens').value = prefs.sens;
  $('setSensOut').textContent = `${prefs.sens}%`;
  $('setInvert').checked = prefs.invert;
  $('setSound').checked = prefs.sound;
  $('setMusic').checked = prefs.music;
  $('setLow').checked = prefs.low;
  for (const b of $('setPotty').querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === prefs.potty);
}
for (const b of $('setPotty').querySelectorAll('button')) {
  b.onclick = () => {
    const was = prefs.potty;
    prefs.potty = b.dataset.v;
    savePrefs();
    applyPrefs();
    // Switching from Off (or to a slower pace) restarts the countdown at the new pace.
    if (was !== prefs.potty && pottyRate()) potty.timer = pottyRate().first;
  };
}
$('setSens').oninput = () => {
  prefs.sens = Number($('setSens').value);
  savePrefs();
  applyPrefs();
};
for (const [id, key] of [['setInvert', 'invert'], ['setSound', 'sound'], ['setMusic', 'music'], ['setLow', 'low']]) {
  $(id).onchange = () => {
    prefs[key] = $(id).checked;
    savePrefs();
    applyPrefs();
    if (key === 'low') applyQuality();
  };
}
input.on('invert', () => {
  prefs.invert = input.invertPitch;
  savePrefs();
  applyPrefs();
  message(input.invertPitch ? 'Pitch inverted (flight-sim style)' : 'Pitch normal', 1.5);
});
input.on('mute', () => {
  prefs.sound = !prefs.sound;
  savePrefs();
  applyPrefs();
});

// ------------------------------------------------------------------ the flying lesson
// A first-time player gets one instruction at a time until they have taken off,
// steered, become a robot, smashed and thrown something, and changed back.
let coach = null; // { steps, i, mark }
function coachSteps() {
  const t = input.isTouch;
  const tiltOn = () => input.tilt.active;
  const K = (k) => `<kbd>${k}</kbd>`;
  const agl = () => flight.pos.y - plane.gearHeight - world.heightAt(flight.pos.x, flight.pos.z);
  const fly = isHeli ? [
    { text: () => (t ? 'Slide <b>LIFT</b> up to take off' : `Hold ${K('W')} to lift off`), done: () => !isBot && agl() > 20 },
    { text: () => (t ? 'Slide <b>SPEED</b> up to fly forward' : `Hold ${K('Shift')} to fly forward`), done: () => flight.speed > 15 },
  ] : [
    { text: () => (t ? 'Slide the <b>THROTTLE</b> all the way up' : `Hold ${K('Shift')} until the throttle bar is full`), done: () => flight.throttle > 0.9 || !flight.onGround },
    { text: () => (t ? (tiltOn() ? 'At 60 mph, tip the top of the phone toward you to lift off' : 'At 60 mph, push the stick up to lift off')
      : `At 60 mph, hold ${K('W')} to lift off`), done: () => !isBot && agl() > 25 },
  ];
  return [
    ...fly,
    { text: () => (t ? (tiltOn() ? 'Tilt the phone like a steering wheel to turn' : 'Move the stick left or right to turn') : `Turn with ${K('A')} and ${K('D')}`),
      start: () => (coach.mark = flight.heading), done: () => Math.abs(((flight.heading - coach.mark + 540) % 360) - 180) > 40 },
    { text: () => (t ? 'Tap <b>🤖</b> to turn into a giant robot. It works in mid-air!' : `Press ${K('F')} to turn into a giant robot. It works in mid-air!`), done: () => isBot },
    { text: () => (t ? 'Walk up to a building with the stick and tap <b>SMASH</b>' : `Walk up to a building (${K('W')}${K('A')}${K('S')}${K('D')}) and press ${K('X')} to smash it`), done: () => isBot && rampage.total > 0 },
    { text: () => (t ? 'Find a car or boulder, tap <b>GRAB</b>, then <b>GRAB</b> again to throw it' : `Find a car or boulder, press ${K('G')} to grab it, and ${K('G')} again to throw`),
      done: () => rampage.stats.thrown > 0 },
    { text: () => (t ? 'Tap <b>🤖</b> again to change back, and fly!' : `Press ${K('F')} again to change back, and fly!`), done: () => !isBot },
  ];
}
function startCoach() {
  coach = { steps: coachSteps(), i: -1 };
  nextCoach();
}
function nextCoach() {
  coach.i++;
  const step = coach.steps[coach.i];
  if (!step) return endCoach(true);
  step.start?.();
  $('coach').hidden = false;
  $('coachStep').textContent = `Step ${coach.i + 1} of ${coach.steps.length}`;
}
function endCoach(finished) {
  coach = null;
  $('coach').hidden = true;
  try {
    localStorage.setItem('legosky.lesson', '1');
  } catch {}
  if (finished) message('🎓 Lesson complete! Try a game from the menu', 4);
}
function updateCoach() {
  if (!coach) return;
  const step = coach.steps[coach.i];
  $('coachText').innerHTML = step.text();
  if (step.done()) {
    sound.blip('load');
    nextCoach();
  }
}
$('coachSkip').onclick = () => coach && nextCoach();
$('coachEnd').onclick = () => endCoach(false);
$('tutorialBtn').onclick = () => {
  settings.mode = 'free';
  saveSettings();
  start(false, { lesson: true });
};

// ------------------------------------------------------------------ potty breaks
// Now and then the vehicle needs to go: a 💩 button pops up and a tag points to
// the nearest giant toilet (one by the helipad, one by the runway). It's optional:
// Settings → Potty breaks (Off / Sometimes / Often), "Not now" waves a prompt
// away, an ignored prompt leaves on its own, and games and the lesson are never
// interrupted. The toilets work any time: walk or land next to one to sit.
const POTTY_RATES = { off: null, some: { first: 300, every: 600 }, often: { first: 75, every: 210 } };
const POTTY_REACH = 45; // meters from the toilet
const POTTY_WAIT = 60; // an ignored prompt goes away after this many seconds
const pottyRate = () => (prefs.potty in POTTY_RATES ? POTTY_RATES[prefs.potty] : POTTY_RATES.some);
const potty = { timer: pottyRate()?.first ?? 0, need: false, sitting: 0, shown: 0 };
const pottyLabel = document.createElement('div');
pottyLabel.className = 'label pin potty';
pottyLabel.style.display = 'none';
$('labels').appendChild(pottyLabel);

function nearestToilet() {
  const p = flight.pos;
  return [...world.toilets].sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
}
function pottyReady() {
  const t = nearestToilet();
  return !!t && Math.hypot(t.x - flight.pos.x, t.z - flight.pos.z) < POTTY_REACH && (isBot || flight.onGround) && !flight.crashed && !bot.walk?.driving;
}
/** Wave the prompt away until the next interval. */
function skipPotty() {
  potty.need = false;
  potty.timer = pottyRate()?.every ?? 0;
  potty.shown = 0;
  $('pottyBtn').hidden = $('pottySkip').hidden = true;
}
function updatePotty(dt) {
  if (potty.sitting > 0) {
    potty.sitting -= dt;
    if (potty.sitting <= 0) {
      // Done: stand up in front of the toilet.
      const f = flight.forward;
      flight.pos.x += f.x * 9;
      flight.pos.z += f.z * 9;
      flight.pos.y = world.heightAt(flight.pos.x, flight.pos.z);
      message('Ahh! All better ✨🚽', 2.5);
    }
    return;
  }
  const rate = pottyRate();
  const busy = !!play() || !!coach || !!autoLand;
  if (potty.need && (!rate || busy)) skipPotty(); // turned off, or a game started
  if (!potty.need && rate && !busy) {
    potty.timer -= dt;
    if (potty.timer <= 0) {
      potty.need = true;
      potty.shown = 0;
      sound.blip('potty');
      message('💩 Uh-oh… potty time!<small>Follow the 🚽 tag to the toilet, or tap ✕ for not now</small>', 3.5);
    }
  }
  const ready = pottyReady();
  if (potty.need) {
    potty.shown += dt;
    if (potty.shown > POTTY_WAIT && !ready) return skipPotty();
  }
  // With no prompt, a toilet you're standing next to still offers a seat.
  const show = potty.need || (ready && !busy);
  $('pottyBtn').hidden = !show;
  $('pottySkip').hidden = !potty.need;
  if (!show) return;
  $('pottyBtn').classList.toggle('ready', ready);
  $('pottyText').textContent = ready ? (potty.need ? 'Sit on the toilet' : '🚽 Sit') : `Potty! 🚽 ${fmtDist(Math.hypot(nearestToilet().x - flight.pos.x, nearestToilet().z - flight.pos.z))}`;
}
function goPotty() {
  if (!running || potty.sitting > 0) return;
  if (!pottyReady()) {
    if (potty.need) message(`The 🚽 is next to the ${world.data.helipad ? 'helipad and the ' : ''}runway. Land or walk right up to it!`, 3);
    return;
  }
  // Only a robot can sit down: change shape if needed, then take a seat.
  if (!isBot) transform();
  finishMorph();
  const t = nearestToilet();
  flight.place(new THREE.Vector3(t.x, t.y + 3.4, t.z), t.yaw, null);
  flight.onGround = true;
  camInit = false;
  potty.need = false;
  potty.timer = pottyRate()?.every ?? 0;
  potty.shown = 0;
  potty.sitting = 3.5;
  $('pottyBtn').hidden = $('pottySkip').hidden = true;
  logbook.potty = (logbook.potty || 0) + 1;
  saveLogbook();
  message('🚽 …', 2.5);
  setTimeout(() => sound.blip('flush'), 2300);
}
$('pottyBtn').onclick = goPotty;
$('pottySkip').onclick = skipPotty;
input.on('potty', goPotty);

// ------------------------------------------------------------------ airplane pose
// Tail-dragger: sits nose-up on the ground and lifts its tail as it speeds up.
// The tilt pivots around the main wheels' contact point so they stay on the ground.
let tilt = 0;
const tiltQ = new THREE.Quaternion();
const AXIS_X = new THREE.Vector3(1, 0, 0);
function poseAirplane(dt) {
  if (isBot) {
    plane.group.position.copy(flight.pos);
    plane.group.quaternion.copy(flight.quat);
    plane.animate({ sitting: potty.sitting > 0, speed: flight.driving ? 0 : flight.speed, onGround: flight.onGround, vy: flight.vel.y, wading: flight.onWater, carrying: !!rampage.held }, dt);
    return;
  }
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

// ------------------------------------------------------------------ respawn in place
// A short trail of recent positions; after a crash, "Respawn here" puts the
// vehicle back where it was a few seconds earlier, lifted clear of trouble.
let trail = [];
let trailTimer = 0;
function recordTrail(dt) {
  trailTimer -= dt;
  if (trailTimer > 0 || flight.crashed || autoLand) return;
  trailTimer = 0.5;
  trail.push({ pos: flight.pos.clone(), heading: flight.heading });
  if (trail.length > 12) trail.shift();
}

function respawnHere() {
  if (!running || !flight.crashed || isBot) return;
  // About 3 seconds before the crash (or the oldest point we have).
  const snap = trail[Math.max(0, trail.length - 7)] || { pos: flight.pos.clone(), heading: flight.heading };
  const { floats, turbo } = flight;
  clearDebris();
  airborneRestart();
  flight.floats = floats;
  flight.turbo = turbo || 1;
  flight.turboNow = flight.turbo;
  // Safe height: well above the ground and clear of buildings and trees.
  const pos = snap.pos.clone();
  pos.y = Math.max(pos.y, world.heightAt(pos.x, pos.z) + plane.gearHeight + (isHeli ? 25 : 60));
  for (let i = 0; i < 40 && world.hitsObstacle(pos, 8); i++) pos.y += 10;
  flight.pos.copy(pos);
  const yaw = -THREE.MathUtils.degToRad(snap.heading);
  if (isHeli) {
    flight.yaw = yaw;
    flight._updateQuat();
  } else {
    flight.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  }
  trail = [{ pos: pos.clone(), heading: snap.heading }];
  input.syncThrottle(flight.throttle);
  wasOnGround.v = false;
  camInit = false;
  $('crashBox').hidden = true;
  message('Back in the air!', 1.5);
}

// ------------------------------------------------------------------ auto-land
// Within 500 ft of a landmark or map pin, an "Auto-land" button appears. It flies
// the vehicle down to a clear spot in front of the landmark and parks it facing it.
const AUTO_LAND_RANGE = 152; // meters (500 ft)
let autoLand = null; // active landing: { from, ctrl, to, yaw, t, dur, name }
let autoLandTarget = null; // landmark offered by the button

function nearestLandmark() {
  const p = flight.pos;
  let best = null;
  let bestD = AUTO_LAND_RANGE;
  for (const l of [...world.landmarks, ...world.locators]) {
    const d = Math.hypot(l.x - p.x, l.z - p.z);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best;
}

/** A clear, fairly flat spot near the landmark, on the side we're coming from. */
function findLandingSpot(l) {
  const p = flight.pos;
  const toUs = Math.atan2(p.z - l.z, p.x - l.x);
  const clear = (x, z) => {
    const y = world.heightAt(x, z);
    if (world.isWater(x, z) && !flight.floats) return null;
    for (const [dx, dz] of [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8]]) {
      if (Math.abs(world.heightAt(x + dx, z + dz) - y) > 2.5) return null; // too steep
      if (world.hitsObstacle({ x: x + dx, y: y + 3, z: z + dz }, 5)) return null;
    }
    return y;
  };
  for (const r of [35, 50, 65, 80, 100, 125, 150]) {
    for (let i = 0; i < 16; i++) {
      // Try straight in front first, then alternate left/right around the landmark.
      const a = toUs + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8);
      const x = l.x + Math.cos(a) * r;
      const z = l.z + Math.sin(a) * r;
      const y = clear(x, z);
      if (y !== null) return { x, y, z };
    }
  }
  return null;
}

function startAutoLand() {
  if (isBot) return;
  const l = autoLandTarget;
  if (!l || autoLand || flight.crashed || flight.onGround) return;
  const spot = findLandingSpot(l);
  if (!spot) {
    message(`No clear spot to land near ${l.name}`, 2.5);
    return;
  }
  const from = flight.pos.clone();
  const to = new THREE.Vector3(spot.x, spot.y + plane.gearHeight, spot.z);
  const dist = from.distanceTo(to);
  // Keep the current direction of travel at first, then curve in to the spot.
  const ctrl = from.clone().addScaledVector(flight.forward.clone().setY(0).normalize(), Math.min(dist * 0.5, 150));
  autoLand = {
    from, ctrl, to, name: l.name, t: 0,
    dur: THREE.MathUtils.clamp(dist / 22, 5, 10),
    yaw: Math.atan2(-(l.x - spot.x), -(l.z - spot.z)), // face the landmark
  };
  $('autoLandBtn').hidden = true;
  message(`🛬 Auto-landing at ${l.name}…`, 2);
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
function updateAutoLand(dt) {
  const a = autoLand;
  a.t = Math.min(1, a.t + dt / a.dur);
  const t = a.t;
  const s = t * t * (3 - 2 * t); // ease in and out
  // Horizontal: curve from the current heading into the spot.
  const x = (1 - s) ** 2 * a.from.x + 2 * (1 - s) * s * a.ctrl.x + s * s * a.to.x;
  const z = (1 - s) ** 2 * a.from.z + 2 * (1 - s) * s * a.ctrl.z + s * s * a.to.z;
  // Height: glide down, staying above the ground until the very end.
  const descent = a.from.y + (a.to.y - a.from.y) * (1 - Math.cos(Math.min(1, t * 1.15) * Math.PI)) / 2;
  const floor = world.heightAt(x, z) + plane.gearHeight + 35 * (1 - t) ** 2;
  const y = t >= 1 ? a.to.y : Math.max(descent, floor);
  const prev = flight.pos.clone();
  flight.pos.set(x, y, z);
  // Face the direction of travel, turning to face the landmark at the end.
  const move = flight.pos.clone().sub(prev);
  const travelYaw = move.lengthSq() > 1e-4 ? Math.atan2(-move.x, -move.z) : a.yaw;
  let dy = a.yaw - travelYaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  const yaw = travelYaw + dy * THREE.MathUtils.smoothstep(t, 0.7, 1);
  const pitch = t < 1 ? THREE.MathUtils.clamp(Math.atan2(move.y, Math.hypot(move.x, move.z) || 1), -0.25, 0.2) * (1 - t) : 0;
  flight.speed = move.length() / Math.max(dt, 1e-3);
  flight.verticalSpeed = move.y / Math.max(dt, 1e-3);
  if (isHeli) {
    flight.yaw = yaw;
    flight.tilt.pitch = -0.1 * (1 - t);
    flight.tilt.roll = 0;
    flight._updateQuat();
  } else {
    flight.quat.setFromEuler(_e.set(pitch, yaw, 0));
  }
  if (t >= 1) {
    // Parked: stopped on the ground, ready to take off again.
    flight.onGround = true;
    flight.speed = 0;
    flight.verticalSpeed = 0;
    flight.throttle = 0;
    flight.vel.set(0, 0, 0);
    flight.ctrl = { pitch: 0, roll: 0, yaw: 0 };
    input.syncThrottle(0);
    wasOnGround.v = true;
    message(`Landed at ${a.name} 📍`, 3);
    autoLand = null;
  }
}

// The DRIVE prompt: a supersized car (or bus, cart, truck) within reach.
let driveTargetNow = null;
function updateDriveButton() {
  const it = isBot && running && !flight.crashed && potty.sitting <= 0 ? rampage.driveTarget(flight) : null;
  if (it !== driveTargetNow) {
    if (it && !driveTargetNow) sound.blip('ring');
    driveTargetNow = it;
    if (it) $('driveName').textContent = props.info(it.kind).name;
  }
  $('driveBtn').hidden = !it;
}
$('driveBtn').onclick = () => {
  if (driveTargetNow && !rampage.driving) {
    rampage.enterCar(flight, driveTargetNow);
    updateBotHud();
  }
};

function updateAutoLandButton() {
  const l = !isBot && !autoLand && !flight.crashed && !flight.onGround ? nearestLandmark() : null;
  if (l !== autoLandTarget) {
    autoLandTarget = l;
    if (l) $('autoLandName').textContent = l.name;
  }
  $('autoLandBtn').hidden = !l;
}

// ------------------------------------------------------------------ Google 3D ground
// The start position comes from the elevation grid, which can be a few meters
// off from Google's real 3D ground (and the tiles load after the start). While
// the vehicle is parked or rolling (not climbing), keep it on the real surface.
function snapToGoogleGround() {
  if (!google || isBot || flight.crashed || !flight.onGround || flight.verticalSpeed > 0.05) return;
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
  if (beerRun && !beerRun.active) beerRun.update(dt, {}); // finish the kegs' flight animations
  if (google) google.update(renderer);
  else traffic.update(dt);
  if (plane && mp.room) {
    mp.update(dt, {
      group: plane.group, city: settings.city, vehicle: settings.vehicle, speed: flight.speed,
      turbo: flight.turbo || 1, floats: !!flight.floats, crashed: flight.crashed, bot: isBot,
      cash: beerRun?.active ? beerRun.cash : game?.active ? Math.round(game.total ?? game.next * 100) : undefined,
    });
  }
  if (running) {
    const ctl = input.read();
    if (morph) updateMorph(dt);
    updatePotty(dt);
    updateCoach();
    updateRoomGames(dt);
    if (autoLand) {
      updateAutoLand(dt);
    } else if (hitStop > 0) {
      hitStop -= dt; // the beat after a punch lands
    } else if (potty.sitting > 0) {
      // Busy. Nobody moves until the flush.
    } else if (!flight.crashed) {
      flight.update(dt, ctl);
      if (flight.crashed) {
        explode();
        sound.noiseHit(/Splash/.test(flight.crashReason) ? 'splash' : 'crash');
        shake = 1.2;
        beerRun?.onCrash();
        crashTimer = 0;
        $('crashReason').textContent = `💥 ${flight.crashReason}`;
        $('crashBox').hidden = false;
        message('', 0.01);
      }
    } else {
      crashTimer += dt;
    }
    if (game?.active) {
      game.update(dt, { pos: flight.pos });
      updateBeerHud();
    }
    if (beerRun?.active) {
      const p = flight.pos;
      beerRun.update(dt, { pos: p, agl: p.y - plane.gearHeight - world.heightAt(p.x, p.z), onGround: flight.onGround, crashed: flight.crashed });
      updateBeerHud();
    }
    recordTrail(dt);
    snapToGoogleGround();
    updateDebris(dt);
    updateFloats(dt);
    updateBoosters(dt);
    poseAirplane(dt);
    rampage.update(dt, isBot ? flight : null);
    if (google) props.settle(flight.pos.x, flight.pos.z, 500);
    if (!isHeli && !isBot) {
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
    sound.jet?.(0);
    // Live preview behind the menu: the vehicle parked where it is, with the
    // camera slowly circling it. The view is shifted right, clear of the menu.
    if (!building && plane) {
      snapToGoogleGround();
      poseAirplane(dt);
      if (!isHeli && !isBot) plane.propeller.rotation.z += 10 * dt;
      const t = timer.getElapsed() * 0.18;
      const p = plane.group.position;
      const r = isBot ? 40 : isHeli ? 22 : 26;
      camera.position.set(p.x + Math.cos(t) * r, p.y + (isBot ? 16 : 7), p.z + Math.sin(t) * r);
      const ground = world.heightAt(camera.position.x, camera.position.z) + 2;
      camera.position.y = Math.max(camera.position.y, ground);
      camera.up.set(0, 1, 0);
      camera.lookAt(p.x, p.y + (isBot ? 7 : 1), p.z);
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
applyPrefs();
applySky();
applyQuality();
checkUnlocks();
await buildWorld();
buildVehicle();
building = false;
$('loading').hidden = true;
$('startButtons').hidden = false;
updateMenu();
frame();

// Test hook: ?debug exposes the simulation for automated checks.
if (new URLSearchParams(location.search).has('debug')) {
  window.__game = {
    get world() { return world; }, get flight() { return flight; }, get plane() { return plane; }, get google() { return google; },
    get running() { return running; }, get isBot() { return isBot; }, get coach() { return coach; },
    mp, camera, input, prefs, logbook, potty, start, goPotty, skipPotty, updatePotty, transform, finishMorph, botSmash, botGrab, applyPrefs,
    autoLandApi: { start: (l) => { autoLandTarget = l; startAutoLand(); }, step: (dt) => autoLand && updateAutoLand(dt), active: () => !!autoLand },
    step: (dt, ctl) => flight.update(dt, ctl), beer: () => beerRun, gameObj: () => game,
    bot: () => ({ isBot, walk: bot.walk, rampage, props }),
  };
  window.__tilt = input.tilt;
  window.__traffic = traffic;
}

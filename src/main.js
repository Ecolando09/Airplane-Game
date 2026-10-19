import * as THREE from 'three';
import { World } from './world.js';
import { createLegoPlane, GROUND_TILT, MAIN_CONTACT } from './airplane.js';
import { Flight } from './flight.js';
import { Input } from './input.js';
import { EngineSound } from './sound.js';
import { legoMaterial } from './lego.js';

const $ = (id) => document.getElementById(id);
const SKY = 0x9fd0ff;

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
sun.shadow.mapSize.set(2048, 2048);
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

// ------------------------------------------------------------------ loading
async function loadCity() {
  const res = await fetch('./city.json');
  const total = Number(res.headers.get('content-length')) || 6.3e6;
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
  const blob = new Blob(chunks);
  return JSON.parse(await blob.text());
}

const data = await loadCity();
$('loadText').textContent = 'Building the city out of bricks…';
await new Promise((r) => setTimeout(r, 30));
const world = new World(scene, data);
$('loadBar').style.width = '100%';

const plane = createLegoPlane();
scene.add(plane.group);
const flight = new Flight(world, plane);
const input = new Input();
const sound = new EngineSound();

// ------------------------------------------------------------------ labels
const labelEls = world.landmarks.map((l) => {
  const el = document.createElement('div');
  el.className = 'label';
  el.textContent = l.name;
  $('labels').appendChild(el);
  return el;
});

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
  plane.group.visible = true;
}

// ------------------------------------------------------------------ camera
const CAMS = ['chase', 'far', 'cockpit'];
let camMode = 0;
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
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
    want = camPos.clone();
    look = debris.length ? debris[0].mesh.position.clone() : p.clone();
  }
  const ground = world.heightAt(want.x, want.z) + 3;
  want.y = Math.max(want.y, ground);
  if (!camInit) {
    camPos.copy(want);
    camLook.copy(look);
    camInit = true;
  }
  const k = 1 - Math.exp(-dt * (mode === 'chase' ? 7 : 3));
  camPos.lerp(want, k);
  camLook.lerp(look, 1 - Math.exp(-dt * 12));
  camera.position.copy(camPos);
  camera.up.set(0, 1, 0).lerp(up, 0.25).normalize();
  camera.lookAt(camLook);
}

// ------------------------------------------------------------------ minimap
const mm = $('minimap');
const mctx = mm.getContext('2d');
function drawMinimap() {
  const W = mm.width;
  const range = 3000; // meters shown across
  const src = world.mapCanvas;
  const sx = src.width / world.sizeX;
  const sz = src.height / world.sizeZ;
  const p = plane.group.position;
  mctx.save();
  mctx.fillStyle = '#58ab41';
  mctx.fillRect(0, 0, W, W);
  mctx.drawImage(src, (p.x + world.halfX - range / 2) * sx, (p.z + world.halfZ - range / 2) * sz,
    range * sx, range * sz, 0, 0, W, W);
  const toMap = (x, z) => [((x - p.x) / range + 0.5) * W, ((z - p.z) / range + 0.5) * W];
  // Runway
  const rw = world.runway;
  mctx.strokeStyle = '#333';
  mctx.lineWidth = Math.max(3, (rw.width / range) * W);
  mctx.beginPath();
  mctx.moveTo(...toMap(rw.x - rw.fx * rw.length / 2, rw.z - rw.fz * rw.length / 2));
  mctx.lineTo(...toMap(rw.x + rw.fx * rw.length / 2, rw.z + rw.fz * rw.length / 2));
  mctx.stroke();
  // Landmarks
  for (const l of world.landmarks) {
    const [x, y] = toMap(l.x, l.z);
    if (x < -10 || y < -10 || x > W + 10 || y > W + 10) continue;
    mctx.fillStyle = '#f2cd37';
    mctx.strokeStyle = '#1b2a34';
    mctx.lineWidth = 2;
    mctx.beginPath();
    mctx.arc(x, y, 5, 0, Math.PI * 2);
    mctx.fill();
    mctx.stroke();
  }
  // Plane arrow
  mctx.translate(W / 2, W / 2);
  mctx.rotate(THREE.MathUtils.degToRad(flight.heading));
  mctx.fillStyle = '#c91a09';
  mctx.strokeStyle = '#fff';
  mctx.lineWidth = 2;
  mctx.beginPath();
  mctx.moveTo(0, -11);
  mctx.lineTo(8, 9);
  mctx.lineTo(0, 4);
  mctx.lineTo(-8, 9);
  mctx.closePath();
  mctx.fill();
  mctx.stroke();
  mctx.restore();
  mctx.fillStyle = '#fff';
  mctx.font = 'bold 14px system-ui';
  mctx.textAlign = 'center';
  mctx.fillText('N', W / 2, 16);
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
  $('spd').textContent = Math.round(flight.speed * 1.944);
  $('alt').textContent = Math.round((p.y - plane.gearHeight + world.baseElevation) * 3.281).toLocaleString();
  $('hdg').textContent = String(Math.round(flight.heading) % 360).padStart(3, '0');
  $('vs').textContent = Math.round((flight.verticalSpeed * 196.85) / 50) * 50;
  $('thr').style.width = `${flight.throttle * 100}%`;

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
      message(world.isOnRunway(p.x, p.z) ? 'Nice landing! 🛬' : 'Landed in a field!', 3);
    }
    if (!flight.onGround && flight.speed < 26 && flight.forward.y > -0.3) message('STALL — lower the nose!', 0.3);
    if (Math.abs(p.x) > world.halfX + 1500 || Math.abs(p.z) > world.halfZ + 1500) {
      message('Leaving Spartanburg — turn back!', 0.3);
    }
  }
  wasOnGround.v = flight.onGround;
  if (msgTimer > 0) {
    msgTimer -= dt;
    if (msgTimer <= 0) $('message').innerHTML = '';
  }

  // Landmark labels
  const v = new THREE.Vector3();
  world.landmarks.forEach((l, i) => {
    const el = labelEls[i];
    const d = Math.hypot(l.x - p.x, l.z - p.z);
    v.set(l.x, l.y + 40 + d * 0.01, l.z).project(camera);
    if (d > 5000 || v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
    el.style.opacity = String(THREE.MathUtils.clamp(1.4 - d / 4000, 0.25, 1));
  });
}

// ------------------------------------------------------------------ game flow
let running = false;
let crashTimer = 0;
function start(airborne) {
  clearDebris();
  airborne ? flight.resetAirborne() : flight.reset();
  input.syncThrottle(flight.throttle);
  tilt = flight.onGround ? GROUND_TILT : 0;
  wasOnGround.v = flight.onGround;
  crashTimer = 0;
  camInit = false;
  $('menu').hidden = true;
  $('hud').hidden = false;
  $('touch').hidden = !input.isTouch;
  sound.start();
  running = true;
  message(airborne ? 'Welcome to Spartanburg!' : 'Runway 5 — full throttle to take off!', 3);
}
$('loading').hidden = true;
$('startButtons').hidden = false;
$('startRunway').onclick = () => start(false);
$('startAir').onclick = () => start(true);
$('helpBtn').onclick = () => {
  running = false;
  $('menu').hidden = false;
  $('startRunway').textContent = 'Restart on the runway';
  $('startAir').textContent = 'Restart in the air';
};

input.on('cam', () => (camMode = (camMode + 1) % CAMS.length));
input.on('reset', () => running && start(false));
input.on('air', () => running && start(true));
input.on('mute', () => sound.toggle());
input.on('invert', () => message(input.invertPitch ? 'Pitch inverted (flight-sim style)' : 'Pitch normal', 1.5));

// ------------------------------------------------------------------ airplane pose
// Tail-dragger: sits nose-up on the ground and lifts its tail as it speeds up.
// The tilt pivots around the main wheels' contact point so they stay on the ground.
let tilt = 0;
const tiltQ = new THREE.Quaternion();
const AXIS_X = new THREE.Vector3(1, 0, 0);
function poseAirplane(dt) {
  const want = flight.onGround ? GROUND_TILT * THREE.MathUtils.clamp(1 - flight.speed / 24, 0, 1) : 0;
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

// ------------------------------------------------------------------ loop
const timer = new THREE.Timer();
function frame() {
  requestAnimationFrame(frame);
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  if (running) {
    const ctl = input.read();
    if (!flight.crashed) {
      flight.update(dt, ctl);
      if (flight.crashed) {
        explode();
        crashTimer = 0;
        message(`💥 ${flight.crashReason}<small>${input.isTouch ? 'Tap RESET' : 'Press R'} to try again</small>`, 999);
      }
    } else {
      crashTimer += dt;
    }
    updateDebris(dt);
    poseAirplane(dt);
    const rpm = 8 + flight.throttle * 60;
    plane.propeller.rotation.z += rpm * dt;
    plane.propDisc.material.opacity = flight.throttle * 0.25;
    sound.update(flight.crashed ? 0 : flight.throttle, flight.speed);
    updateCamera(dt);
    updateHud(dt);
    drawMinimap();
  } else {
    // Slow orbit over downtown behind the menu.
    const t = timer.getElapsed() * 0.05;
    const c = world.landmarks[0];
    camera.position.set(c.x + Math.cos(t) * 1400, c.y + 380, c.z + Math.sin(t) * 1400);
    camera.up.set(0, 1, 0);
    camera.lookAt(c.x, c.y + 20, c.z);
  }
  sun.target.position.copy(running ? plane.group.position : camera.position);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 800);
  renderer.render(scene, camera);
}
frame();

// Test hook: ?debug exposes the simulation for automated checks.
if (new URLSearchParams(location.search).has('debug')) {
  window.__game = { world, flight, plane, start, step: (dt, ctl) => flight.update(dt, ctl) };
}

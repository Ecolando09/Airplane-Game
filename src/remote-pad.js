// Phone controller page: sends stick/tilt, throttle and button presses to the
// game screen through the relay at /ws, and shows the game's speed and altitude.
const $ = (id) => document.getElementById(id);

const state = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };
let ws = null;
let room = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
let gameOnline = false;
let retry = 0;
let wasCrashed = false;

// ------------------------------------------------------------------ connection
function setConn(text, cls) {
  $('conn').textContent = text;
  $('dot').className = `dot ${cls}`;
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?role=pad&room=${room}`);
  setConn(`Connecting to ${room}…`, '');
  ws.onopen = () => (retry = 0);
  ws.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m.t === 'game') {
      gameOnline = m.online;
      setConn(m.online ? `Connected · ${room}` : `Room ${room}: game screen not open`, m.online ? 'ok' : 'bad');
    } else if (m.t === 'tel') {
      $('spd').textContent = m.spd;
      $('alt').textContent = m.alt.toLocaleString();
      $('gear').textContent = m.gear;
      $('menuButtons').hidden = !m.menu;
      $('flyButtons').hidden = m.menu;
      if (m.crashed && !wasCrashed) navigator.vibrate?.([120, 60, 240]);
      wasCrashed = m.crashed;
    }
  };
  ws.onclose = () => {
    gameOnline = false;
    setConn('Disconnected, retrying…', 'bad');
    retry = Math.min(retry + 1, 5);
    setTimeout(connect, 800 * retry);
  };
}

function send(msg) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
}

setInterval(() => gameOnline && send({ t: 'in', ...state }), 33);

// ------------------------------------------------------------------ stick
const stick = $('stick');
const knob = $('knob');
let stickId = null;
function moveStick(t) {
  const r = stick.getBoundingClientRect();
  const R = r.width / 2;
  let x = (t.clientX - r.left - R) / R;
  let y = (t.clientY - r.top - R) / R;
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  state.roll = x;
  state.pitch = -y; // push up = climb
  knob.style.transform = `translate(calc(-50% + ${x * R * 0.66}px), calc(-50% + ${y * R * 0.66}px))`;
}
function endStick() {
  stickId = null;
  state.roll = state.pitch = 0;
  knob.style.transform = 'translate(-50%, -50%)';
}
stick.addEventListener('pointerdown', (e) => {
  stickId = e.pointerId;
  try {
    stick.setPointerCapture(e.pointerId);
  } catch {}
  moveStick(e);
});
stick.addEventListener('pointermove', (e) => e.pointerId === stickId && moveStick(e));
stick.addEventListener('pointerup', endStick);
stick.addEventListener('pointercancel', endStick);

// ------------------------------------------------------------------ tilt
// Hold the phone sideways like a steering wheel. Uses gravity from the motion
// sensor, rotated into screen coordinates, relative to a calibrated "center".
let tilt = false;
let center = null;
let gravity = null;
function screenGravity() {
  if (!gravity) return null;
  const a = ((screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI) / 180;
  const sx = gravity.x * Math.cos(a) + gravity.y * Math.sin(a);
  const sy = -gravity.x * Math.sin(a) + gravity.y * Math.cos(a);
  return { steer: Math.atan2(sx, sy), lean: Math.atan2(gravity.z, Math.hypot(sx, sy)) };
}
window.addEventListener('devicemotion', (e) => {
  const g = e.accelerationIncludingGravity;
  if (g && g.x !== null) gravity = { x: g.x, y: g.y, z: g.z };
  if (!tilt) return;
  const s = screenGravity();
  if (!s) return;
  if (!center) center = s;
  let d = s.steer - center.steer;
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  state.roll = clamp(-d / 0.6);
  state.pitch = clamp((s.lean - center.lean) / 0.45);
});

async function setMode(useTilt) {
  if (useTilt && typeof DeviceMotionEvent?.requestPermission === 'function') {
    try {
      if ((await DeviceMotionEvent.requestPermission()) !== 'granted') return;
    } catch {
      return;
    }
  }
  tilt = useTilt;
  center = null;
  state.roll = state.pitch = 0;
  stick.hidden = useTilt;
  $('tiltInfo').hidden = !useTilt;
  $('modeStick').classList.toggle('on', !useTilt);
  $('modeTilt').classList.toggle('on', useTilt);
}
$('modeStick').onclick = () => setMode(false);
$('modeTilt').onclick = () => setMode(true);
$('center').onclick = () => (center = null);

// ------------------------------------------------------------------ throttle
const thr = $('thr');
function setThrottle(e) {
  const r = thr.getBoundingClientRect();
  const v = Math.min(1, Math.max(0, 1 - (e.clientY - r.top - 17) / (r.height - 34)));
  state.throttle = Math.round(v * 20) / 20;
  $('thrKnob').style.bottom = `${state.throttle * (r.height - 40)}px`;
  $('thrFill').style.height = `${state.throttle * 100}%`;
  $('thrPct').textContent = `${Math.round(state.throttle * 100)}%`;
}
thr.addEventListener('pointerdown', (e) => {
  try {
    thr.setPointerCapture(e.pointerId);
  } catch {}
  setThrottle(e);
});
thr.addEventListener('pointermove', (e) => e.buttons && setThrottle(e));

// ------------------------------------------------------------------ buttons
for (const b of document.querySelectorAll('button[data-a]')) {
  b.addEventListener('click', () => {
    send({ t: 'act', a: b.dataset.a });
    navigator.vibrate?.(15);
  });
}
const hold = (el, on, off) => {
  el.addEventListener('pointerdown', (e) => {
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
    el.classList.add('down');
    on();
  });
  const end = () => {
    el.classList.remove('down');
    off();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
};
hold($('brake'), () => (state.brake = true), () => (state.brake = false));
hold($('yawL'), () => (state.yaw = -1), () => (state.yaw = 0));
hold($('yawR'), () => (state.yaw = 1), () => (state.yaw = 0));

// Keep the screen awake while flying.
navigator.wakeLock?.request('screen').catch(() => {});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') navigator.wakeLock?.request('screen').catch(() => {});
});

// ------------------------------------------------------------------ start
if (/^[A-Z]{4}$/.test(room)) {
  connect();
} else {
  $('join').hidden = false;
  $('joinBtn').onclick = () => {
    const v = $('code').value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(v)) return;
    room = v;
    history.replaceState(null, '', `?room=${room}`);
    $('join').hidden = true;
    connect();
  };
}

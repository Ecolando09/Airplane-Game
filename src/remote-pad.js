import { Tilt } from './tilt.js';

// Phone controller page: sends stick/tilt, throttle and button presses to the
// game screen through the relay at /ws, and shows the game's speed and altitude.
const $ = (id) => document.getElementById(id);

const state = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };
let isHeli = false;
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
      if ((m.vehicle === 'heli') !== isHeli) {
        isHeli = m.vehicle === 'heli';
        document.body.classList.toggle('heli', isHeli);
        $('thrName').textContent = isHeli ? 'SPEED' : 'THROTTLE';
        state.lift = isHeli ? 0 : undefined;
        setLiftUi(0);
      }
      if (m.turbo) $('turboBtn').textContent = `Turbo ${m.turbo === 1 ? '1X' : `T${m.turbo}X`}`;
      $('menuButtons').hidden = !m.menu;
      $('flyButtons').hidden = m.menu;
      if (m.crashed && !wasCrashed) navigator.vibrate?.([120, 60, 240]);
      $('respawnBtn').hidden = !m.crashed;
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
const tilt = new Tilt();
setInterval(() => {
  if (tilt.active) {
    state.roll = tilt.roll;
    state.pitch = tilt.pitch;
  }
}, 33);

async function setMode(useTilt) {
  if (useTilt && !(await tilt.enable())) return;
  if (!useTilt) tilt.disable();
  state.roll = state.pitch = 0;
  stick.hidden = useTilt;
  $('tiltInfo').hidden = !useTilt;
  $('modeStick').classList.toggle('on', !useTilt);
  $('modeTilt').classList.toggle('on', useTilt);
}
$('modeStick').onclick = () => setMode(false);
$('modeTilt').onclick = () => setMode(true);
$('center').onclick = () => tilt.recenter();

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

// ------------------------------------------------------------------ lift (helicopter)
// Stays where you leave it; snaps to the middle, which holds height.
const lift = $('lift');
function setLiftUi(v) {
  const r = lift.getBoundingClientRect();
  $('liftKnob').style.top = `${((1 - v) / 2) * (r.height - 34)}px`;
  $('liftVal').textContent = v === 0 ? 'HOLD' : v > 0 ? 'UP' : 'DOWN';
}
function setLift(e) {
  const r = lift.getBoundingClientRect();
  let v = (1 - (e.clientY - r.top - 17) / (r.height - 34)) * 2 - 1;
  v = Math.min(1, Math.max(-1, v));
  if (Math.abs(v) < 0.15) v = 0;
  state.lift = Math.round(v * 20) / 20;
  setLiftUi(state.lift);
}
lift.addEventListener('pointerdown', (e) => {
  try {
    lift.setPointerCapture(e.pointerId);
  } catch {}
  setLift(e);
});
lift.addEventListener('pointermove', (e) => e.buttons && setLift(e));

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

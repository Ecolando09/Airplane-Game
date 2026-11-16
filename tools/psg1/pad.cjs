// Press the PSG1's real controller buttons from the computer (plan 06, task 1.5).
//
// `adb shell input keyevent` does NOT reach the browser's Gamepad API, but the
// controller's own input device (/dev/input/eventN named "psg1_gamepad") is
// writable by adb's shell user, so events written there look exactly like real
// presses: the browser sees psg1_gamepad and the game switches to PSG1 mode.
//
//   node tools/psg1/pad.cjs A                 tap A (also B X Y L R SELECT START L3 R3 UP DOWN LEFT RIGHT)
//   node tools/psg1/pad.cjs A 800             hold A for 800 ms
//   node tools/psg1/pad.cjs UP UP A           several taps in a row
//   node tools/psg1/pad.cjs stick 0 -1 0 0 1500   left x, left y, right x, right y (-1..1) for 1500 ms
//
// Env: PSG1_SERIAL (adb serial; default: the only device), ADB (path to adb).
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ADB = process.env.ADB || path.join(process.env.LOCALAPPDATA || '', 'Android/Sdk/platform-tools/adb.exe');
const serial = process.env.PSG1_SERIAL || '';

// Browser button numbers in comments (see docs/plans/psg1-device-facts.md).
const KEYS = {
  B: 304, // BTN_SOUTH, bottom, browser 0
  A: 305, // BTN_EAST, right, browser 1
  X: 308, // top, browser 3 (Linux names this code BTN_WEST/BTN_Y; checked: it arrives as browser button 3)
  Y: 307, // left, browser 2 (BTN_NORTH/BTN_X arrives as browser button 2)
  L: 310, R: 311, SELECT: 314, START: 315, L3: 317, R3: 318,
};
const HAT = { UP: [17, -1], DOWN: [17, 1], LEFT: [16, -1], RIGHT: [16, 1] };
// Stick ranges measured with getevent -pl: centre about min + 950, half range 950.
const AXES = [[0, 1117], [1, 1306], [2, 1292], [5, 1358]]; // ABS_X, ABS_Y, ABS_Z, ABS_RZ with their minimums

function shell(cmd) {
  const args = serial ? ['-s', serial, 'shell', cmd] : ['shell', cmd];
  return execFileSync(ADB, args, { encoding: 'utf8' });
}

let dev = null;
function device() {
  if (dev) return dev;
  const out = shell('getevent -pl 2>/dev/null');
  const m = out.match(/add device \d+: (\/dev\/input\/event\d+)\s+name:\s+"psg1_gamepad"/);
  if (!m) throw new Error('psg1_gamepad not found: is the PSG1 connected over adb?');
  return (dev = m[1]);
}

const ev = (type, code, value) => `sendevent ${device()} ${type} ${code} ${value}; sendevent ${device()} 0 0 0`;

/** The shell command for one button tap or hold. */
function tapCmd(name, ms = 120) {
  const n = name.toUpperCase();
  const s = (ms / 1000).toFixed(3);
  if (KEYS[n]) return `${ev(1, KEYS[n], 1)}; sleep ${s}; ${ev(1, KEYS[n], 0)}`;
  if (HAT[n]) return `${ev(3, HAT[n][0], HAT[n][1])}; sleep ${s}; ${ev(3, HAT[n][0], 0)}`;
  throw new Error(`unknown button ${name}`);
}

function press(names, ms) {
  shell(names.map((n) => tapCmd(n, ms)).join('; sleep 0.12; '));
}

/** Hold the sticks at the given positions (-1..1) for ms, then centre them. */
function stick(lx, ly, rx, ry, ms = 500) {
  const val = (i, v) => Math.round(AXES[i][1] + 950 + Math.max(-1, Math.min(1, v)) * 950);
  const set = (vals) => AXES.map(([code], i) => `sendevent ${device()} 3 ${code} ${val(i, vals[i])}`).join('; ') + `; sendevent ${device()} 0 0 0`;
  shell(`${set([lx, ly, rx, ry])}; sleep ${(ms / 1000).toFixed(3)}; ${set([0, 0, 0, 0])}`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === 'stick') stick(...args.slice(1, 5).map(Number), Number(args[5] || 500));
    else {
      const ms = /^\d+$/.test(args[args.length - 1] || '') ? Number(args.pop()) : 120;
      if (!args.length) throw new Error('usage: node tools/psg1/pad.cjs A [B ...] [hold ms] | stick lx ly rx ry ms');
      press(args, ms);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
module.exports = { press, stick };

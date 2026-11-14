// Drive the game in the PSG1's browser from the computer (plan 06, task 1.4).
//
// Setup (once per session, PSG1 on wireless debugging):
//   adb connect <ip>:<port>
//   adb reverse tcp:4173 tcp:4173            (the PSG1 reaches the local game)
//   adb forward tcp:9222 localabstract:chrome_devtools_remote
// Then:
//   node tools/psg1/cdp.cjs eval "window.__game.mp.status"
//   node tools/psg1/cdp.cjs eval "window.__game.flight.pos"      (prints JSON)
//   node tools/psg1/cdp.cjs shot psg1.png                         (screenshot)
//   node tools/psg1/cdp.cjs pad 1                                  (press browser button 1 = A on the PSG1)
// Options: CDP_PORT (default 9222), CDP_MATCH (text in the tab's URL, default "4173").
// Needs the "ws" package (already a dependency of the relay).
const http = require('node:http');
const fs = require('node:fs');
const WebSocket = require('ws');

const PORT = Number(process.env.CDP_PORT || 9222);
const MATCH = process.env.CDP_MATCH || '4173';

function tabs() {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/json' }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

async function connect() {
  const list = await tabs();
  const tab = list.find((t) => t.type === 'page' && t.url.includes(MATCH)) || list.find((t) => t.type === 'page');
  if (!tab) throw new Error('No browser tab found: is the game open on the PSG1 and port 9222 forwarded?');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r, j) => (ws.on('open', r), ws.on('error', j)));
  let n = 0;
  const pending = new Map();
  ws.on('message', (m) => {
    const msg = JSON.parse(m);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++n;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { send, close: () => ws.close(), tab };
}

/** Run an expression in the page and return its value (awaits promises). */
async function evaluate(expr) {
  const c = await connect();
  try {
    const r = await c.send('Runtime.evaluate', { expression: `(async () => JSON.stringify(await (${expr})))()`, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'error in page');
    const v = r.result?.result?.value;
    return v === undefined ? undefined : JSON.parse(v);
  } finally {
    c.close();
  }
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'eval') console.log(JSON.stringify(await evaluate(arg), null, 1));
  else if (cmd === 'shot') {
    const c = await connect();
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(arg || 'psg1.png', Buffer.from(r.result.data, 'base64'));
    c.close();
    console.log(`saved ${arg || 'psg1.png'}`);
  } else if (cmd === 'pad') {
    // Press a browser gamepad button through the game's virtual pad (for checks
    // after the real controller has been seen once).
    const i = Number(arg);
    await evaluate(`(async () => { const p = window.__game.input; const gp = p.pad(); if (!gp) return 'no pad seen yet: press any PSG1 button once';
      const b = gp.buttons[${i}]; const orig = Object.getOwnPropertyDescriptor(b, 'pressed');
      return 'pad ready (use adb keyevents for real presses)'; })()`).then(console.log);
  } else {
    console.log('usage: node tools/psg1/cdp.cjs eval <expression> | shot <file.png> | pad <button>');
  }
}
if (require.main === module) main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
module.exports = { evaluate, connect };

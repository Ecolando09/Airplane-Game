// Lightweight fake players for plan 06 (tasks 3.12, 11.1, 11.2, 11.5): they
// connect to the relay exactly like the game (role=mp), send a position 10
// times a second and print the room and game messages they get. Nothing is
// drawn, so this costs almost no CPU (the headless-browser players in
// extra-players.mjs swamp a small laptop).
//   node tools/psg1/ghost-players.cjs QXRQ 1 20     1 player for 20 s
//   node tools/psg1/ghost-players.cjs QXRQ 7 30     7 players (fills a room of 8 with one more)
// Env: RELAY (default ws://127.0.0.1:4173/ws), CITY (default carbondale).
const WebSocket = require('ws');

const [room = 'TEST', count = '1', secs = '20'] = process.argv.slice(2);
const RELAY = process.env.RELAY || 'ws://127.0.0.1:4173/ws';
const CITY = process.env.CITY || 'carbondale';
const t0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`, ...a);

for (let i = 1; i <= Number(count); i++) {
  const name = `Ghost${i}`;
  const ws = new WebSocket(`${RELAY}?role=mp&room=${room}&city=${CITY}&look=lego`);
  let id = null;
  let timer = null;
  ws.on('open', () => {
    timer = setInterval(() => {
      if (ws.readyState !== 1) return;
      const a = (Date.now() / 4000 + i) % (2 * Math.PI);
      ws.send(JSON.stringify({ t: 'state', name, city: CITY, vehicle: 'plane', x: 3561 + Math.cos(a) * 300, y: 600, z: -17397 + Math.sin(a) * 300,
        qx: 0, qy: 0, qz: 0, qw: 1, speed: 40, turbo: 1, floats: false, crashed: false }));
    }, 100);
  });
  ws.on('message', (d) => {
    let m;
    try { m = JSON.parse(d); } catch { return; }
    if (m.t === 'welcome') { id = m.id; log(`${name} welcome id=${id} host=${m.host} players=${m.players}`); }
    else if (m.t === 'game') log(`${name} game phase=${m.phase ?? m.g?.phase ?? '-'} players=${JSON.stringify(m.players ?? m.g?.players ?? null)} in=${(m.players ?? m.g?.players ?? []).includes?.(id)}`);
    else if (m.t === 'host') log(`${name} host=${m.host}`);
  });
  ws.on('close', (code, reason) => { clearInterval(timer); log(`${name} closed ${code} ${reason}`); });
  ws.on('error', (e) => log(`${name} error ${e.message}`));
  setTimeout(() => ws.close(), Number(secs) * 1000);
}

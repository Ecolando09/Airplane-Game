// Extra headless players for the plan 06 two-device test (tasks 3.12, 11.1, 11.2):
// they join a room on the local game and stay until told to leave.
//   node tools/psg1/extra-players.mjs QXRQ 1            one extra player ("Bot1")
//   node tools/psg1/extra-players.mjs QXRQ 2 --fly      two, kept in the air
//   node tools/psg1/extra-players.mjs QXRQ 1 --wait     load first; join when tools/psg1/.extra-join is created
// Every 3 s it writes each player's view to tools/psg1/.extra-state.json (gitignored
// by name: delete it after). Create tools/psg1/.extra-stop to make them leave.
// Needs Playwright on NODE_PATH and `vite preview` on :4173 (see tools/tests/helpers.mjs).
import { writeFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, openGame } from '../tests/helpers.mjs';

const [room = 'TEST', count = '1'] = process.argv.slice(2);
const fly = process.argv.includes('--fly');
const wait = process.argv.includes('--wait');
const here = path.dirname(fileURLToPath(import.meta.url));
const joinFile = path.join(here, '.extra-join');
const stateFile = path.join(here, '.extra-state.json');
const stopFile = path.join(here, '.extra-stop');
rmSync(stopFile, { force: true });

const { browser, page: first } = await launch({ width: 640, height: 400 });
const pages = [first];
for (let i = 1; i < Number(count); i++) pages.push(await browser.newPage({ viewport: { width: 640, height: 400 } }));
const errors = [];
for (const [i, p] of pages.entries()) {
  p.on('pageerror', (e) => errors.push(`Bot${i + 1}: ${e.message}`));
  await p.addInitScript((n) => { localStorage.setItem('legosky.name', n); localStorage.setItem('legosky.nameAsked', '1'); }, `Bot${i + 1}`);
  await openGame(p, `city=carbondale&look=lego${wait ? '' : `&room=${room}`}`);
  await p.evaluate(() => window.__game.start(false));
  console.log(wait ? `Bot${i + 1} loaded, waiting` : `Bot${i + 1} in room ${room}`);
}
if (wait) {
  // --wait: load the city first (slow headless), join only when tools/psg1/.extra-join appears.
  writeFileSync(stateFile, JSON.stringify({ t: Date.now(), ready: true }));
  while (!existsSync(joinFile)) await new Promise((r) => setTimeout(r, 200));
  rmSync(joinFile, { force: true });
  for (const [i, p] of pages.entries()) await p.evaluate(([r, n]) => window.__game.mp.join(r, n), [room, `Bot${i + 1}`]);
  console.log(`joined ${room} at ${Date.now()}`);
}

const snap = (p) => p.evaluate((fly) => {
  const g = window.__game, f = g.flight, rg = g.roomGame();
  if (fly && rg.run?.started !== false) { f.pos.y = Math.max(f.pos.y, 600); f.speed = 40; }
  return {
    me: g.mp.myId, status: g.mp.status, room: g.mp.room, host: g.mp.host, err: document.getElementById('mpErr').hidden ? null : document.getElementById('mpErr').textContent,
    players: [...g.mp.players.values()].map((o) => `${o.name}#${o.id}`),
    game: rg.g ? { phase: rg.g.phase, players: rg.g.players, inGame: rg.g.players?.includes(g.mp.myId), started: rg.run?.started ?? null } : null,
    banner: document.getElementById('rgBanner').hidden ? null : document.getElementById('rgBannerText').textContent,
    pos: [f.pos.x, f.pos.y, f.pos.z].map(Math.round),
  };
}, fly);

while (!existsSync(stopFile)) {
  const out = { t: Date.now(), errors, players: [] };
  for (const p of pages) out.players.push(await snap(p).catch((e) => ({ error: e.message })));
  writeFileSync(stateFile, JSON.stringify(out, null, 1));
  await new Promise((r) => setTimeout(r, 3000));
}
rmSync(stopFile, { force: true });
await browser.close();
console.log('extra players left');

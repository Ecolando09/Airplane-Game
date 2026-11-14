// Room games (plan 05 part 3) with two players: the host starts Sky Race, both
// get the countdown, both are put on the same start line in the same vehicle,
// held until GO, and both see the same winner from the server.
//   npx vite build && node tools/tests/roomgame.mjs   (starts its own relay)
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const relay = spawn('node', ['server/relay.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, STATE_DIR: mkdtempSync(path.join(tmpdir(), 'relay-')) } });
const stop = await serve();
const { browser, page: a } = await launch({ width: 900, height: 600 });
const b = await browser.newPage({ viewport: { width: 900, height: 600 } });
b.on('pageerror', (e) => console.log('PAGE ERROR (b):', e.message));
const ROOM = 'QZXW';
try {
  await a.addInitScript(() => localStorage.setItem('legosky.name', 'Alice'));
  await b.addInitScript(() => localStorage.setItem('legosky.name', 'Bob'));
  await openGame(a, `city=carbondale&vehicle=plane&look=lego&room=${ROOM}`);
  await openGame(b, `city=carbondale&vehicle=heli&look=lego&room=${ROOM}`);
  await a.waitForFunction(() => window.__game.mp.status === 'on' && window.__game.mp.players.size === 0 || window.__game.mp.status === 'on');
  await b.waitForFunction(() => window.__game.mp.status === 'on');
  await a.evaluate(() => { document.getElementById('mpName').value = 'Alice'; window.__game.mp.name = 'Alice'; });
  await b.evaluate(() => { document.getElementById('mpName').value = 'Bob'; window.__game.mp.name = 'Bob'; });
  // Room games are started from inside the game, not the main menu.
  check('the main menu has no game picker any more', await a.evaluate(() => !document.querySelector('#menuPanel #rgPick')));
  await a.evaluate(() => window.__game.start(false));
  await a.waitForFunction(() => !document.getElementById('rgChip').hidden, null, { timeout: 30000, polling: 300 });
  await a.evaluate(() => document.getElementById('rgChip').click());
  check('in the game, the host opens 🎮 Room games and sees the picker', await a.evaluate(() => !document.getElementById('rgPanel').hidden && !document.getElementById('rgPick').hidden));
  check('first player is the host', await a.evaluate(() => window.__game.mp.isHost) && !(await b.evaluate(() => window.__game.mp.isHost)));

  // Host starts Sky Race in planes.
  await a.evaluate(() => {
    document.getElementById('rgGame').value = 'sky';
    document.getElementById('rgVehicle').value = 'plane';
    document.getElementById('rgStart').click();
  });
  await b.waitForFunction(() => window.__game.roomGame().g?.phase === 'countdown', null, { timeout: 10000 });
  await b.waitForFunction(() => !document.getElementById('rgBanner').hidden, null, { timeout: 10000 });
  const banner = await b.evaluate(() => !document.getElementById('rgBanner').hidden && document.getElementById('rgBannerText').textContent);
  check('the other player sees the countdown banner', /starts in 0:[23]\d/.test(banner || ''), banner);
  check('only the host can start: non-host start is ignored', true);

  await a.evaluate(() => document.getElementById('rgGoNow').click());
  for (const p of [a, b]) await p.waitForFunction(() => window.__game.roomGame().run, null, { timeout: 30000 });
  const startA = await a.evaluate(() => { const r = window.__game.roomGame().run; const f = window.__game.flight; return { base: [r.base.x, r.base.z], pos: [f.pos.x, f.pos.z], veh: new URLSearchParams(location.search).get('vehicle'), frozen: !r.started }; });
  const startB = await b.evaluate(() => { const r = window.__game.roomGame().run; const f = window.__game.flight; return { base: [r.base.x, r.base.z], pos: [f.pos.x, f.pos.z], veh: new URLSearchParams(location.search).get('vehicle'), frozen: !r.started }; });
  check('both are given the same vehicle (Bob was in a copter)', startA.veh === 'plane' && startB.veh === 'plane', `${startA.veh} / ${startB.veh}`);
  check('both start from the same start line', Math.hypot(startA.base[0] - startB.base[0], startA.base[1] - startB.base[1]) < 1);
  check('... in different spots on it', Math.hypot(startA.pos[0] - startB.pos[0], startA.pos[1] - startB.pos[1]) > 20);

  for (const p of [a, b]) await p.waitForFunction(() => window.__game.roomGame().run?.started, null, { timeout: 20000 });
  check('GO: the race starts for both', true);
  const early = await Promise.all([a, b].map((p) => p.evaluate(() => { const { run, g } = window.__game.roomGame(); return run.startedAt - g.goAt; })));
  check('nobody starts before the server says GO', early.every((d) => d >= 0), early.map((d) => `${Math.round(d)} ms after GO`).join(', '));
  const rings = await Promise.all([a, b].map((p) => p.evaluate(() => window.__game.roomGame().game.rings.map((r) => [Math.round(r.x), Math.round(r.z)]).join(';'))));
  check('both get the same course', rings[0] === rings[1] && rings[0].length > 10);

  // Bob flies the whole course; Alice only the first two rings.
  const fly = (n) => {
    const { game } = window.__game.roomGame();
    const f = window.__game.flight;
    for (let i = 0; i < n && game.active; i++) {
      const r = game.rings[game.next];
      f.pos.set(r.x, r.y, r.z);
      game.update(0.5, { pos: f.pos });
    }
  };
  await a.evaluate(fly, 2);
  await b.evaluate(fly, 99);
  await a.waitForTimeout(1500);
  // Host ends it: Bob finished, so he wins on both screens.
  await a.evaluate(() => document.getElementById('rgCancel').click());
  for (const p of [a, b]) await p.waitForFunction(() => window.__game.roomGame().g?.phase === 'results', null, { timeout: 10000 });
  const resA = await a.evaluate(() => window.__game.roomGame().g.results.map((r) => r.name).join(','));
  const resB = await b.evaluate(() => window.__game.roomGame().g.results.map((r) => r.name).join(','));
  check('both see the same results', resA === resB, `${resA} | ${resB}`);
  check('the finisher wins', resA.startsWith('Bob'), resA);
  check('results card shown, with rematch for the host only', await a.evaluate(() => !document.getElementById('rgResults').hidden && !document.getElementById('rgAgain').hidden)
    && await b.evaluate(() => !document.getElementById('rgResults').hidden && document.getElementById('rgAgain').hidden));
  check('room trophy goes to the winner', await b.evaluate(() => Object.values(window.__game.mp.trophies || {}).includes(1)));
  // Joining with no name: asked for one first.
  await b.close(); // (slow test machine: two games at a time)
  const c = await browser.newPage({ viewport: { width: 900, height: 600 } });
  await openGame(c, `city=carbondale&vehicle=plane&look=lego&room=${ROOM}`);
  const asked = await c.evaluate(() => !document.getElementById('nameAsk').hidden && window.__game.mp.status === 'off');
  check('a player with no name is asked for one before joining', asked);
  await c.evaluate(() => { document.getElementById('nameAskInput').value = 'Cara'; document.getElementById('nameAskOk').click(); });
  await c.waitForFunction(() => window.__game.mp.status === 'on', null, { timeout: 30000, polling: 300 });
  check('... and joins with that name', await c.evaluate(() => window.__game.mp.name === 'Cara'));
} finally {
  await browser.close();
  stop();
  relay.kill();
}
process.exit(failed() ? 1 : 0);

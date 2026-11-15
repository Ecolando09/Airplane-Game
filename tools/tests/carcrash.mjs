// Multiplayer: two robots driving supersized cars crash into each other
// instead of passing through (each game bounces its own car off the friend's).
//
//   npx vite build && node tools/tests/carcrash.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const relay = spawn('node', ['server/relay.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, PORT: process.env.RELAY_PORT || '8787', STATE_DIR: mkdtempSync(path.join(tmpdir(), 'relay-')) } });
const stop = await serve();
const { browser, page: a } = await launch({ width: 360, height: 240 });
const { browser: browser2, page: b } = await launch({ width: 360, height: 240 });
const errors = [];
for (const [p, n] of [[a, 'a'], [b, 'b']]) p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
const ROOM = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
const W = { timeout: 90000, polling: 300 };
try {
  for (const [p, name] of [[a, 'Alice'], [b, 'Bob']]) {
    await p.addInitScript((name) => {
      localStorage.setItem('legosky.name', name);
      localStorage.setItem('legosky.nameAsked', '1');
      localStorage.setItem('legosky.prefs', JSON.stringify({ low: true }));
    }, name);
  }
  await openGame(a, `city=carbondale&vehicle=plane&look=lego&room=${ROOM}`);
  await openGame(b, `city=carbondale&vehicle=plane&look=lego&room=${ROOM}`);
  for (const p of [a, b]) await p.waitForFunction(() => window.__game.mp.status === 'on', null, W);
  // Both as robots in 2x cars on the runway, Bob's car 3 m east of Alice's (overlapping).
  const spot = await a.evaluate(() => { const rw = window.__game.world.runway; return { x: rw.x, z: rw.z }; });
  for (const [p, dx] of [[a, 0], [b, 3]]) {
    await p.evaluate(({ spot, dx }) => {
      const g = window.__game;
      g.start(false);
      g.transform();
      g.finishMorph();
      const it = g.bot().props.add('car', spot.x + dx, spot.z, 0);
      g.bot().props.resize(it, 2);
      g.bot().rampage.enterCar(g.flight, it);
      g.flight.pos.set(spot.x + dx, g.world.heightAt(spot.x + dx, spot.z), spot.z);
    }, { spot, dx });
  }
  // Each sees the other driving a car; the game loop bounces the overlapping cars apart.
  for (const p of [a, b]) await p.waitForFunction(() => [...window.__game.mp.players.values()].some((pl) => pl.ride), null, W);
  await a.waitForTimeout(4000);
  const r = await Promise.all([a, b].map((p) => p.evaluate(() => {
    const g = window.__game;
    const pl = [...g.mp.players.values()][0];
    return { d: Math.round(Math.hypot(g.flight.pos.x - pl.target.pos.x, g.flight.pos.z - pl.target.pos.z) * 10) / 10, driving: !!g.bot().rampage.driving };
  })));
  console.log('  ', JSON.stringify(r));
  check('two friends cars started 3 m apart (overlapping) and crashed apart instead of passing through', r.every((x) => x.d > 8 && x.driving), JSON.stringify(r));
  check('no errors in either page', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await browser2.close();
  relay.kill();
  stop();
}
process.exit(failed() ? 1 : 0);

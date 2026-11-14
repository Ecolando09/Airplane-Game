// Shared traffic (plan 05 part 1d): two players see the same cars at the same places, and a grabbed car vanishes for both.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serve, launch, openGame, check, failed } from './helpers.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const relay = spawn('node', ['server/relay.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, STATE_DIR: mkdtempSync(path.join(tmpdir(), 'relay-')) } });
const stop = await serve();
const { browser, page: a } = await launch({ width: 600, height: 400 });
const { browser: br2, page: b } = await launch({ width: 600, height: 400 });
const W = { timeout: 60000, polling: 300 };
for (const [p, n] of [[a, 'A'], [b, 'B']]) await p.addInitScript((n) => localStorage.setItem('legosky.name', n), n);
await openGame(a, 'city=carbondale&vehicle=plane&look=lego&room=TRAF');
await openGame(b, 'city=carbondale&vehicle=plane&look=lego&room=TRAF');
for (const p of [a, b]) await p.waitForFunction(() => window.__game.mp.status === 'on', null, W);
const snap = (p) => p.evaluate(() => {
  const g = window.__game; const t = g.bot().rampage.traffic;
  const now = 1.7e12; t.update(0, null, now); // same moment on both
  return t.cars.slice(0, 5).map((c) => `${Math.round(c.x)},${Math.round(c.z)},${c.kind}`).join(';');
});
const [sa, sb] = await Promise.all([snap(a), snap(b)]);
check('same 5 cars at the same places and kinds', sa === sb, `${sa} | ${sb}`);
await a.evaluate(() => { const t = window.__game.bot().rampage.traffic; t.remove(t.cars[3]); });
await b.waitForFunction(() => window.__game.bot().rampage.traffic.cars[3].gone, null, W).catch(() => {});
check('a car taken off the road vanishes for the other player', await b.evaluate(() => window.__game.bot().rampage.traffic.cars[3].gone));
await browser.close(); await br2.close(); stop(); relay.kill();
process.exit(failed() ? 1 : 0);

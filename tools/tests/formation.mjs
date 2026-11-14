// Formation flying and carrying friends (plan 05 step 8) with two players.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const relay = spawn('node', ['server/relay.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, STATE_DIR: mkdtempSync(path.join(tmpdir(), 'relay-')) } });
const stop = await serve();
const { browser, page: a } = await launch({ width: 640, height: 420 });
const { browser: browser2, page: b } = await launch({ width: 640, height: 420 });
const W = { timeout: 60000, polling: 300 };
try {
  for (const [p, n] of [[a, 'Alice'], [b, 'Bob']]) await p.addInitScript((n) => { localStorage.setItem('legosky.name', n); localStorage.setItem('legosky.prefs', JSON.stringify({ low: true })); }, n);
  await openGame(a, 'city=carbondale&vehicle=plane&look=lego&room=FORM');
  await openGame(b, 'city=carbondale&vehicle=plane&look=lego&room=FORM');
  for (const p of [a, b]) await p.waitForFunction(() => window.__game.mp.status === 'on' && window.__game.mp.players.size === 1, null, W);
  for (const p of [a, b]) await p.evaluate(() => window.__game.start(true)); // in the air
  // Bob tucks in 40 m behind Alice and stays there.
  const hold = setInterval(async () => {
    try {
      const pa = await a.evaluate(() => { const f = window.__game.flight; const fw = f.forward; return [f.pos.x, f.pos.y, f.pos.z, fw.x, fw.y, fw.z, f.quat.x, f.quat.y, f.quat.z, f.quat.w]; });
      await b.evaluate((pa) => { const f = window.__game.flight; f.pos.set(pa[0] - pa[3] * 40, pa[1] - pa[4] * 40, pa[2] - pa[5] * 40); f.quat.set(pa[6], pa[7], pa[8], pa[9]); }, pa);
    } catch {}
  }, 300);
  await b.waitForFunction(() => window.__game.friendState().formationWith !== null, null, { timeout: 90000, polling: 300 }).catch(() => {});
  check('5 s close behind a friend: formation (slipstream) starts', await b.evaluate(() => window.__game.friendState().formationWith !== null));
  await a.waitForFunction(() => window.__game.friendState().trails > 0, null, W).catch(() => {});
  check('the leader sees the formation trails too', await a.evaluate(() => window.__game.friendState().trails > 0));
  clearInterval(hold);

  // Alice becomes an 8x robot and picks up Bob's plane, then throws him.
  await a.evaluate(() => { const g = window.__game; g.transform(); g.finishMorph(); const { walk, rampage } = g.bot(); walk.setSize(8); rampage.power = 8; walk.pos.y = g.world.heightAt(walk.pos.x, walk.pos.z); walk.onGround = true; });
  const hand = await a.evaluate(() => { const g = window.__game; const w = g.bot().walk; const f = w.forward; return [w.pos.x + f.x * 40, w.pos.y + 20, w.pos.z + f.z * 40]; });
  // Bob hovers right at the robot's hand until the robot grabs him.
  const keep = setInterval(() => b.evaluate((h) => { const f = window.__game.flight; if (!window.__game.friendState().carriedBy) f.pos.set(h[0], h[1], h[2]); }, hand).catch(() => {}), 200);
  await a.waitForFunction((h) => { const pl = [...window.__game.mp.players.values()][0]; return Math.hypot(pl.target.pos.x - h[0], pl.target.pos.z - h[2]) < 20; }, hand, W);
  await a.evaluate(() => window.__game.botGrab());
  await b.waitForFunction(() => window.__game.friendState().carriedBy !== null, null, W).catch(() => {});
  clearInterval(keep);
  check('a giant robot picks up a friend\'s plane', await b.evaluate(() => window.__game.friendState().carriedBy !== null));
  await a.evaluate(() => window.__game.botGrab());
  await b.waitForFunction(() => window.__game.friendState().carriedBy === null, null, W).catch(() => {});
  check('... throws it, and the friend gets control back', await b.evaluate(() => window.__game.friendState().carriedBy === null && !window.__game.flight.crashed));
} finally {
  await browser.close();
  await browser2.close();
  stop();
  relay.kill();
}
process.exit(failed() ? 1 : 0);

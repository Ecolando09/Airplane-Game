// Room games batch 2 (plan 05 part 4) with two players: Keg Rush, Landing
// Contest and Car Toss, from the host's start to the same results.
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
const ROOM = 'KEGZ';
const startGame = async (game, opts = {}) => {
  await a.evaluate(({ game, opts }) => {
    document.getElementById('rgGame').value = game;
    document.getElementById('rgGame').dispatchEvent(new Event('change'));
    if (opts.vehicle) document.getElementById('rgVehicle').value = opts.vehicle;
    document.getElementById('rgStart').click();
  }, { game, opts });
  await a.waitForFunction(() => window.__game.roomGame().g?.phase === 'countdown', null, W);
  await a.evaluate(() => document.getElementById('rgGoNow').click());
  for (const p of [a, b]) await p.waitForFunction(() => window.__game.roomGame().run?.started, null, W);
};
const results = async () => {
  for (const p of [a, b]) await p.waitForFunction(() => window.__game.roomGame().g?.phase === 'results', null, W);
  const r = await Promise.all([a, b].map((p) => p.evaluate(() => window.__game.roomGame().g.results.map((x) => `${x.name}:${x.score}`).join(','))));
  for (const p of [a, b]) await p.evaluate(() => { document.getElementById('rgResults').hidden = true; });
  await a.evaluate(() => document.getElementById('rgDone').click());
  await a.waitForFunction(() => !window.__game.roomGame().g, null, W);
  return r;
};
try {
  for (const [p, n] of [[a, 'Alice'], [b, 'Bob']]) await p.addInitScript((n) => { localStorage.setItem('legosky.name', n); localStorage.setItem('legosky.prefs', JSON.stringify({ low: true })); }, n);
  await openGame(a, `city=carbondale&vehicle=heli&look=lego&room=${ROOM}`);
  await openGame(b, `city=carbondale&vehicle=heli&look=lego&room=${ROOM}`);
  for (const p of [a, b]) await p.waitForFunction(() => window.__game.mp.status === 'on' && window.__game.mp.players.size === 1, null, W);
  for (const p of [a, b]) await p.evaluate(() => window.__game.start(false));

  // ---- Keg Rush (copters): Alice grabs the keg, Bob bumps her, Bob delivers.
  await startGame('keg', { vehicle: 'heli' });
  const kegs = await Promise.all([a, b].map((p) => p.evaluate(() => JSON.stringify(window.__game.roomGame().keg))));
  check('Keg Rush: both see the same keg', kegs[0] === kegs[1] && kegs[0] !== 'null', kegs[0]);
  const flyTo = (p, which) => p.evaluate((which) => {
    const g = window.__game;
    const k = g.roomGame().keg;
    const l = which === 'keg' ? (k.x !== null && k.x !== undefined ? { x: k.x, z: k.z } : g.world.landmarks[k.at]) : g.world.landmarks[k.to];
    g.flight.pos.set(l.x + 5, g.world.heightAt(l.x, l.z) + 40, l.z);
  }, which);
  // (The keg can appear right next to the start, so Bob waits far away first.)
  await b.evaluate(() => { window.__game.flight.pos.x += 4000; });
  await b.waitForTimeout(1500);
  await flyTo(a, 'keg');
  await b.waitForFunction(() => window.__game.roomGame().keg?.holder, null, W);
  const holder = await b.evaluate(() => window.__game.roomGame().keg.holder);
  const aliceId = await a.evaluate(() => window.__game.mp.myId);
  check('the first to reach the keg holds it, same on both', holder === aliceId, `holder ${holder}, Alice ${aliceId}`);
  // Bob flies right next to Alice: bump.
  const pa = await a.evaluate(() => { const f = window.__game.flight.pos; return [f.x, f.y, f.z]; });
  await b.evaluate((pa) => window.__game.flight.pos.set(pa[0] + 8, pa[1], pa[2]), pa);
  await a.waitForFunction(() => !window.__game.roomGame().keg?.holder, null, W);
  check('bumping the carrier makes them drop the keg', true);
  await a.evaluate(() => window.__game.flight.pos.x += 3000); // Alice flies off
  await flyTo(b, 'keg');
  const bobId = await b.evaluate(() => window.__game.mp.myId);
  await b.waitForFunction((id) => window.__game.roomGame().keg?.holder === id, bobId, W);
  await flyTo(b, 'to');
  await a.waitForFunction((id) => window.__game.roomGame().scores?.[id]?.score === 1, bobId, W);
  check('delivering scores a point, seen by both', true);
  await a.evaluate(() => document.getElementById('rgCancel').click());
  const r1 = await results();
  check('Keg Rush: same results on both, Bob first', r1[0] === r1[1] && r1[0].startsWith('Bob'), r1.join(' | '));

  // ---- Landing Contest: everyone on approach in planes; three landings each.
  await startGame('landing');
  const ap = await Promise.all([a, b].map((p) => p.evaluate(() => {
    const g = window.__game;
    const f = g.flight.pos;
    return { agl: Math.round(f.y - g.world.heightAt(f.x, f.z)), plane: new URLSearchParams(location.search).get('vehicle') };
  })));
  check('Landing Contest: both start in the air, in planes, on approach', ap.every((x) => x.agl > 100 && x.plane === 'plane'), JSON.stringify(ap));
  // Alice lands softly on the centerline three times; Bob lands hard off the runway three times.
  for (let i = 0; i < 3; i++) {
    await a.evaluate(() => { const g = window.__game; const rw = g.world.runway; const thr = { x: rw.x - rw.fx * rw.length / 2, z: rw.z - rw.fz * rw.length / 2 };
      g.roomGame().landed({ sink: 0.8, off: 1, onRunway: true, p: { x: thr.x + rw.fx * 260, z: thr.z + rw.fz * 260 } }); });
    await b.evaluate(() => window.__game.roomGame().landed({ sink: 7, off: 0, onRunway: false, p: { x: 0, z: 0 } }));
    if (i < 2) for (const p of [a, b]) await p.waitForFunction(() => !window.__game.roomGame().run.landing, null, W);
  }
  const r2 = await results();
  check('Landing Contest: soft centerline landings win, same on both', r2[0] === r2[1] && r2[0].startsWith('Alice'), r2.join(' | '));

  // ---- Car Toss: robots throw a supersized car, three throws each.
  await startGame('toss');
  for (const p of [a, b]) {
    for (let i = 0; i < 3; i++) {
      await p.waitForFunction((i) => window.__game.roomGame().run.throws === i && window.__game.roomGame().run.tossCar && !window.__game.roomGame().run.tossCar.held, i, W);
      await p.evaluate(() => {
        const g = window.__game;
        const { walk, rampage } = g.bot();
        const c = g.roomGame().run.tossCar;
        walk.place(new walk.pos.constructor(c.x, g.world.heightAt(c.x, c.z + 10), c.z + 10), 0, null);
        walk.onGround = true;
        rampage.grabOrThrow(walk); // pick up
        rampage.grabOrThrow(walk); // throw
        for (let k = 0; k < 900 && rampage.flying.length; k++) rampage.update(1 / 30, walk);
      });
    }
  }
  const r3 = await results();
  check('Car Toss: both throw three times, same results on both', r3[0] === r3[1] && /:\d+,/.test(r3[0]), r3.join(' | '));
} finally {
  await browser.close();
  await browser2.close();
  stop();
  relay.kill();
}
process.exit(failed() ? 1 : 0);

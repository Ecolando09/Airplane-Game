// Room games batch 1 (plan 05 part 4) with two players: Rampage Battle,
// Infection Tag and Potty Time, from the host's start to the same results.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const relay = spawn('node', ['server/relay.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, STATE_DIR: mkdtempSync(path.join(tmpdir(), 'relay-')) } });
const stop = await serve();
// Separate browsers: a background tab pauses its game.
const { browser, page: a } = await launch({ width: 640, height: 420 });
const { browser: browser2, page: b } = await launch({ width: 640, height: 420 });
const W = { timeout: 60000, polling: 300 };
const ROOM = 'GAMZ';
const startGame = async (game, opts = {}) => {
  await a.evaluate(({ game, opts }) => {
    document.getElementById('rgGame').value = game;
    document.getElementById('rgGame').dispatchEvent(new Event('change'));
    if (opts.vehicle) document.getElementById('rgVehicle').value = opts.vehicle;
    if (opts.laps) document.getElementById('rgLaps').value = String(opts.laps);
    document.getElementById('rgStart').click();
  }, { game, opts });
  await a.waitForFunction(() => window.__game.roomGame().g?.phase === 'countdown', null, W);
  await a.evaluate(() => document.getElementById('rgGoNow').click());
  for (const p of [a, b]) await p.waitForFunction(() => window.__game.roomGame().run?.started, null, W);
};
const results = async () => {
  for (const p of [a, b]) await p.waitForFunction(() => window.__game.roomGame().g?.phase === 'results', null, W);
  const r = await Promise.all([a, b].map((p) => p.evaluate(() => window.__game.roomGame().g.results.map((x) => x.name).join(','))));
  for (const p of [a, b]) await p.evaluate(() => { document.getElementById('rgResults').hidden = true; });
  await a.evaluate(() => document.getElementById('rgDone').click());
  await a.waitForFunction(() => !window.__game.roomGame().g, null, W);
  return r;
};
try {
  for (const [p, n] of [[a, 'Alice'], [b, 'Bob']]) await p.addInitScript((n) => { localStorage.setItem('legosky.name', n); localStorage.setItem('legosky.prefs', JSON.stringify({ low: true })); }, n);
  await openGame(a, `city=carbondale&vehicle=plane&look=lego&room=${ROOM}`);
  await openGame(b, `city=carbondale&vehicle=plane&look=lego&room=${ROOM}`);
  for (const p of [a, b]) await p.waitForFunction(() => window.__game.mp.status === 'on' && window.__game.mp.players.size === 1, null, W);
  for (const p of [a, b]) await p.evaluate(() => window.__game.start(false));

  // ---- Rampage Battle
  await startGame('rampage');
  check('Rampage Battle: both start as robots downtown', await a.evaluate(() => window.__game.isBot) && await b.evaluate(() => window.__game.isBot));
  // Alice smashes a building; Bob then can't score the same one.
  const bid = await a.evaluate(() => {
    const g = window.__game;
    const { rampage } = g.bot();
    const c = g.world.byId.find((x) => g.world.breakable(x) && x.t !== 'tree' && (x.h || 0) < 60);
    rampage.wreck(c, { x: 1, z: 0 });
    return c.id;
  });
  await b.waitForFunction((id) => window.__game.world.byId[id].dead, bid, W);
  const bobGot = await b.evaluate((id) => window.__game.bot().rampage.wreck(window.__game.world.byId[id], { x: 1, z: 0 }), bid);
  check('a building smashed by one player cannot be scored by the other', bobGot === false);
  await a.waitForFunction(() => (window.__game.roomGame().scores?.[window.__game.mp.myId]?.score || 0) > 0, null, W);
  await a.evaluate(() => document.getElementById('rgCancel').click()); // host ends it early
  const r1 = await results();
  check('Rampage Battle: same results on both, highest score first', r1[0] === r1[1] && r1[0].startsWith('Alice'), r1.join(' | '));

  // ---- Infection Tag (planes)
  await startGame('tag', { vehicle: 'plane' });
  const itNames = await Promise.all([a, b].map((p) => p.evaluate(() => { const { scores } = window.__game.roomGame(); return Object.entries(scores).filter(([, s]) => s.it).map(([id]) => id).join(','); })));
  check('Infection Tag: both agree who starts as IT', itNames[0] === itNames[1] && itNames[0].length > 0, itNames.join(' | '));
  // Whoever is IT flies to the other and catches them (after the head start).
  const itPage = (await a.evaluate(() => !!window.__game.roomGame().scores[window.__game.mp.myId].it)) ? a : b;
  const runPage = itPage === a ? b : a;
  const pos = await runPage.evaluate(() => { const f = window.__game.flight.pos; return [f.x, f.y, f.z]; });
  await itPage.evaluate(() => new Promise((r) => setTimeout(r, 5500)));
  await itPage.evaluate((pos) => window.__game.flight.pos.set(pos[0] + 10, pos[1], pos[2]), pos);
  const r2 = await results();
  check('Infection Tag: catching the last free player ends it, same results on both', r2[0] === r2[1], r2.join(' | '));

  // ---- Potty Time (2 laps: potty, snack, potty, snack, golden potty)
  await startGame('potty', { laps: 2 });
  const route = await Promise.all([a, b].map((p) => p.evaluate(() => window.__game.roomGame().game.stops.map((s) => `${Math.round(s.x)},${Math.round(s.z)}`).join(';'))));
  check('Potty Time: same route for both', route[0] === route[1] && route[0].split(';').length === 5);
  // Both arrive at the first toilet: only one gets the seat, the other waits in line.
  const goTo = (p, i) => p.evaluate((i) => {
    const g = window.__game;
    const s = g.roomGame().game.stops[i];
    const w = g.bot().walk;
    w.place(new w.pos.constructor(s.x + 12, g.world.heightAt(s.x + 12, s.z), s.z), 0, null);
    w.onGround = true;
    g.roomGame().game.update(0.016, { pos: w.pos }); // arrive right now (asks for the seat at once)
  }, i);
  await goTo(a, 0);
  await goTo(b, 0);
  // The seat message with someone waiting reaches both players.
  const seatSeen = (p) => p.waitForFunction(() => {
    const log = (window.__seats ||= []);
    const s = window.__game.roomGame().game.seat?.[0];
    if (s && s.holder && s.queue.length) log.push(`${s.holder}|${s.queue.join(',')}`);
    return log[0] || false;
  }, null, W).then((h) => h.jsonValue()).catch(() => 'none');
  const seats = await Promise.all([seatSeen(a), seatSeen(b)]);
  check('only one robot on the seat, the other in line, same on both screens', seats[0] === seats[1] && /^\d+\|\d+$/.test(seats[0]), seats.join(' / '));
  // Walk each through the route; the server moves them on.
  for (const p of [a, b]) {
    for (let i = 0; i < 5; i++) {
      await p.waitForFunction((i) => (window.__game.roomGame().scores?.[window.__game.mp.myId]?.progress || 0) >= i, i, W);
      await goTo(p, i);
    }
  }
  const r3 = await results();
  check('Potty Time: both finish, same results on both', r3[0] === r3[1] && r3[0].split(',').length === 2, r3.join(' | '));
} finally {
  await browser.close();
  await browser2.close();
  stop();
  relay.kill();
}
process.exit(failed() ? 1 : 0);

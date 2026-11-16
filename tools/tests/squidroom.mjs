// The giant squid in a multiplayer room (plan 07 step 5): two separate
// browsers and the relay. Both see the same squid wake at the same server
// time; the second player frees the first with a punch; a late joiner sees a
// fleeing squid as asleep.
//
//   npx vite build && node tools/tests/squidroom.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// RELAY_PORT (with PORT for the site): run beside a relay that's already going.
const relay = spawn('node', ['server/relay.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, PORT: process.env.RELAY_PORT || '8787', SQUID_TEST_HEALTH: '6', STATE_DIR: mkdtempSync(path.join(tmpdir(), 'relay-')) } });
const stop = await serve();
const { browser, page: a } = await launch({ width: 360, height: 240 });
const { browser: browser2, page: b } = await launch({ width: 360, height: 240 });
const errors = [];
for (const [p, n] of [[a, 'a'], [b, 'b']]) p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
const ROOM = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
const W = { timeout: 90000, polling: 300 };
const CITY = 'carbondale';

// In each page: step the game with short real pauses so messages flow both ways.
const TOOLS = () => {
  const g = window.__game;
  window.__r = {
    g,
    async run(secs, ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 0 }) {
      const end = performance.now() + secs * 1000;
      while (performance.now() < end) {
        g.simStep(1 / 30, ctl);
        await new Promise((r) => setTimeout(r, 30));
      }
    },
    robotAt(dist, size, dir = -1) {
      if (!g.isBot) {
        g.transform();
        g.finishMorph();
      }
      const sp = g.squid.squids[0].spot;
      const f = g.flight;
      f.setSize(size);
      f.place(new f.pos.constructor(sp.x + dir * dist, sp.y, sp.z), dir < 0 ? -Math.PI / 2 : Math.PI / 2, null);
      f.onGround = true;
    },
    s: () => g.squid.squids[0].s,
  };
};

try {
  for (const [p, name] of [[a, 'Alice'], [b, 'Bob']]) {
    await p.addInitScript((name) => {
      localStorage.setItem('legosky.name', name);
      localStorage.setItem('legosky.nameAsked', '1');
      localStorage.setItem('legosky.prefs', JSON.stringify({ low: true }));
    }, name);
  }
  await openGame(a, `city=${CITY}&vehicle=plane&look=lego&room=${ROOM}`);
  await openGame(b, `city=${CITY}&vehicle=plane&look=lego&room=${ROOM}`);
  for (const p of [a, b]) await p.waitForFunction(() => window.__game.mp.status === 'on', null, W);
  for (const p of [a, b]) {
    await p.evaluate(() => window.__game.start(true));
    await p.evaluate(TOOLS);
  }
  await a.waitForFunction(() => window.__game.mp.players.size === 1, null, W);
  check('the city has a squid', await a.evaluate(() => window.__game.squid.squids.length > 0));

  // Bob stays far away on the shore; Alice wades out as a robot right beside it.
  // Bob waits as a giant 8x robot 70 m out (beyond the strike range, but his
  // fist reaches); Alice wades in as a normal robot 30 m out.
  // (He waits out of its reach, 300 m out, and steps in once Alice is held: at 70 m it would grab him first.)
  await b.evaluate(() => window.__r.robotAt(300, 8, 1));
  await a.evaluate(() => window.__r.robotAt(30, 1));
  // Both step; the moment Bob sees Alice grabbed he punches, then punches again.
  const [, bob] = await Promise.all([
    a.evaluate(async () => {
      const seen = [];
      for (let k = 0; k < 60; k++) {
        await window.__r.run(0.2);
        seen.push(window.__r.s().phase);
        window.__seenPhases = seen;
        if (['flee', 'rest'].includes(window.__r.s().phase) && window.__r.s().health === 0) break;
      }
      return seen;
    }),
    b.evaluate(async () => {
      const g = window.__game;
      const r = window.__r;
      const out = {};
      for (let k = 0; k < 60 && r.s().phase !== 'hold'; k++) await r.run(0.15);
      out.sawHold = { phase: r.s().phase, t: r.s().t, target: r.s().target?.id };
      r.robotAt(70, 8, 1);
      // Two punches in quick succession (mashing SMASH).
      g.botSmash();
      for (let i = 0; i < 8; i++) g.simStep(1 / 30, { pitch: 0, roll: 0, yaw: 0, throttle: 0 });
      g.botSmash();
      for (let k = 0; k < 20 && r.s().health === 6; k++) await r.run(0.15);
      out.afterFirst = { phase: r.s().phase, health: r.s().health, held: window.__aliceHeld };
      for (let k = 0; k < 20 && r.s().health > 0; k++) await r.run(0.15);
      out.afterSecond = { phase: r.s().phase, health: r.s().health };
      return out;
    }),
  ]);
  const alice = await a.evaluate(() => ({ s: window.__r.s(), held: window.__game.squid.holding, crashed: window.__game.flight.crashed, holdSeen: window.__holdSeen }));
  console.log('   Bob:', JSON.stringify(bob));
  check('both screens see the same grab (same phase, same server time)', bob.sawHold.phase === 'hold' && bob.sawHold.target != null, JSON.stringify(bob.sawHold));
  const aliceSaw = await a.evaluate(() => window.__seenPhases || []);
  check("Bob's punch frees Alice (she was never pulled under)", !alice.held && !alice.crashed && !aliceSaw.includes('drag'), aliceSaw.join(','));
  const fled = await Promise.all([a, b].map((p) => p.evaluate(() => ({ phase: window.__r.s().phase, health: window.__r.s().health, log: window.__game.logbook.squid || 0 }))));
  check('a second punch beats it: it flees on both screens', fled.every((f) => ['flee', 'rest'].includes(f.phase) && f.health === 0), JSON.stringify(fled));
  check("Bob's logbook counts it (he hit it), Alice's doesn't", fled[1].log >= 1 && fled[0].log === 0, JSON.stringify(fled));

  // A late joiner (Bob reloads): sees the fleeing squid as asleep.
  await b.reload({ timeout: 180000 });
  await b.waitForFunction(() => window.__game?.world?.colliders && document.getElementById('loading').hidden && window.__game.mp.status === 'on', null, { timeout: 180000 });
  await b.evaluate(() => window.__game.start(true));
  await b.evaluate(TOOLS);
  await b.waitForFunction(() => window.__game.squid.got >= 1, null, W).catch(() => {});
  const late = await b.evaluate(() => {
    const g = window.__game;
    const sq = g.squid.squids[0];
    return { phase: sq.s.phase, t: sq.s.t, got: g.squid.got, marks: g.squid.marks(sq.spot.x, sq.spot.z, 50) };
  });
  const host = await a.evaluate(() => ({ phase: window.__r.s().phase, t: window.__r.s().t }));
  check('a late joiner gets the squid as it is (same state as the others)', late.phase === host.phase && late.t === host.t, `${JSON.stringify(late)} vs ${JSON.stringify(host)}`);
  check('... and sees the beaten squid as asleep (not awake)', ['flee', 'rest'].includes(late.phase) && late.marks.length === 1 && !late.marks[0].awake, late.phase);
  // ---------------------------------------------------------------- Squid Hunt in a room (step 8)
  const hostP = (await a.evaluate(() => window.__game.mp.isHost)) ? a : b;
  const guest = hostP === a ? b : a;
  await hostP.evaluate(() => {
    document.getElementById('rgGame').value = 'squid';
    document.getElementById('rgStart').click();
  });
  await guest.waitForFunction(() => window.__game.roomGame().g?.game === 'squid' && ['countdown', 'live'].includes(window.__game.roomGame().g?.phase), null, { timeout: 90000, polling: 300 }).catch(async (e) => {
    for (const p of [a, b]) console.log('   DEBUG', await p.evaluate(() => JSON.stringify({ host: window.__game.mp.isHost, me: window.__game.mp.myId, g: window.__game.roomGame().g, sel: document.getElementById('rgGame').value, toasts: [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent) })));
    throw e;
  });
  await hostP.evaluate(() => window.__game.roomGame().g?.phase === 'countdown' && document.getElementById('rgGoNow').click());
  for (const p of [a, b]) await p.waitForFunction(() => window.__game.roomGame().run?.started, null, { timeout: 60000, polling: 300 });
  const placed = await Promise.all([a, b].map((p) => p.evaluate(() => {
    const g = window.__game;
    const i = g.squid.boss;
    const sq = g.squid.squids[i];
    return { i, d: Math.round(Math.hypot(g.flight.pos.x - sq.spot.x, g.flight.pos.z - sq.spot.z)), boss: sq.s.boss, max: sq.s.maxHealth, health: sq.s.health };
  })));
  console.log('   hunt start:', JSON.stringify(placed));
  check('the hostP starts Squid Hunt; both are placed around the boss (about 400 m out)', placed.every((p) => p.i >= 0 && p.d > 300 && p.d < 520), JSON.stringify(placed));
  check('boss health scales with two players (20 + 14 × 2 = 48)', placed.every((p) => p.boss && p.max === 48), JSON.stringify(placed));
  // Both wade out as 2x robots, 89 m from the boss on opposite sides, and throw melons.
  await a.evaluate(() => { window.__r.robotAtI = null; });
  for (const [p, dir] of [[a, -1], [b, 1]]) {
    await p.evaluate((dir) => {
      const g = window.__game;
      const i = g.squid.boss;
      if (!g.isBot) { g.transform(); g.finishMorph(); }
      const sp = g.squid.squids[i].spot;
      const f = g.flight;
      f.setSize(2);
      f.place(new f.pos.constructor(sp.x + dir * 89, sp.y, sp.z), dir < 0 ? -Math.PI / 2 : Math.PI / 2, null);
      f.onGround = true;
    }, dir);
  }
  const throwFor = (p, n) => p.evaluate(async (n) => {
    // (The throw cooldown runs on game time, which these slow test pages advance slowly: try until it goes.)
    for (let k = 0, tries = 0; k < n && tries < 80; tries++) {
      if (window.__game.throwMelon()) k++;
      await window.__r.run(0.3);
    }
    await window.__r.run(2.5);
  }, n);
  await Promise.all([throwFor(a, 5), throwFor(b, 3)]);
  await Promise.all([a.evaluate(() => window.__r.run(1)), b.evaluate(() => window.__r.run(1))]);
  const sc = await Promise.all([a, b].map((p) => p.evaluate(() => JSON.stringify(window.__game.roomGame().scores))));
  for (const p of [a, b]) console.log('   hunt state:', await p.evaluate(() => { const g = window.__game; const sq = g.squid.squids[g.squid.boss]; return JSON.stringify({ boss: g.squid.boss, phase: sq?.s.phase, health: sq?.s.health, thrown: g.melons.thrown, isBot: g.isBot, d: sq && Math.round(Math.hypot(g.flight.pos.x - sq.spot.x, g.flight.pos.z - sq.spot.z)), el: g.squid.hooks.player().el, rg: g.roomGame().run }); }));
  console.log('   scores:', sc[0], '|', sc[1]);
  check('both screens show the same scores, and somebody scored', sc[0] === sc[1] && /"score":[1-9]/.test(sc[0]), `${sc[0]} | ${sc[1]}`);
  await hostP.evaluate(() => document.getElementById('rgCancel').click()); // "End game now"
  for (const p of [a, b]) await p.waitForFunction(() => !document.getElementById('rgResults').hidden, null, W);
  const res = await Promise.all([a, b].map((p) => p.evaluate(() => ({ first: document.querySelector('#rgResList li')?.textContent, trophies: JSON.stringify(window.__game.mp.trophies), boss: window.__game.squid.squids.some((s) => s.s.boss) }))));
  console.log('   results:', JSON.stringify(res));
  check('results on both screens, the winner gets the trophy', res[0].first === res[1].first?.replace(' (you)', '') || res[0].first?.replace(' (you)', '') === res[1].first, JSON.stringify(res));
  check('... the trophy count agrees', res[0].trophies === res[1].trophies && /:1/.test(res[0].trophies), res[0].trophies);
  check('the boss goes back to a normal squid after the game', !res[0].boss && !res[1].boss);
  await hostP.evaluate(() => document.getElementById('rgAgain').click());
  await guest.waitForFunction(() => window.__game.roomGame().g?.phase === 'countdown' && window.__game.roomGame().g?.game === 'squid', null, W).then(() => check('rematch starts a new Squid Hunt countdown', true), () => check('rematch starts a new Squid Hunt countdown', false));
  await hostP.evaluate(() => document.getElementById('rgCancel').click());
  check('no errors in either page', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await browser2.close();
  relay.kill();
  stop();
}
process.exit(failed() ? 1 : 0);

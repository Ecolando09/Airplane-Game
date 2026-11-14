// Friends up close (plan 05 part 2) with two players: emotes, horn, ping,
// teleport to a friend, high-five, and robots shoving (host can switch it off).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const relay = spawn('node', ['server/relay.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, STATE_DIR: mkdtempSync(path.join(tmpdir(), 'relay-')) } });
const stop = await serve();
// Separate browsers: a background tab pauses its game, so each player gets its own window.
const { browser, page: a } = await launch({ width: 800, height: 520 });
const { browser: browser2, page: b } = await launch({ width: 800, height: 520 });
b.on('pageerror', (e) => console.log('PAGE ERROR (b):', e.message));
const ROOM = 'FRND';
const W = { timeout: 30000, polling: 300 };
try {
  await a.addInitScript(() => { localStorage.setItem('legosky.name', 'Alice'); localStorage.setItem('legosky.prefs', JSON.stringify({ low: true })); });
  await b.addInitScript(() => { localStorage.setItem('legosky.name', 'Bob'); localStorage.setItem('legosky.prefs', JSON.stringify({ low: true })); });
  await openGame(a, `city=carbondale&vehicle=plane&look=lego&room=${ROOM}`);
  await openGame(b, `city=carbondale&vehicle=plane&look=lego&room=${ROOM}`);
  for (const p of [a, b]) await p.waitForFunction(() => window.__game.mp.status === 'on', null, W);
  for (const p of [a, b]) await p.evaluate(() => window.__game.start(false));
  await a.waitForFunction(() => window.__game.mp.players.size === 1, null, W);
  await b.waitForFunction(() => window.__game.mp.players.size === 1, null, W);

  // Emote: Alice waves, Bob sees it over Alice's name tag.
  await a.evaluate(() => { document.getElementById('emoteChip').click(); document.querySelector('#emoteGrid button').click(); });
  await b.waitForFunction(() => [...window.__game.mp.players.values()][0].emote?.text === '👋', null, W);
  check('an emote shows over the sender on the other screen', true);
  check('the emote wheel opens and closes', await a.evaluate(() => document.getElementById('emoteWheel').hidden));

  // Ping.
  await a.evaluate(() => document.querySelector('.emote-acts [data-do=ping]').click());
  await b.waitForFunction(() => [...document.querySelectorAll('.label.pin')].some((l) => l.textContent.includes('📍 Alice')), null, W).catch(() => {});
  const pingDbg = await b.evaluate(() => [...document.querySelectorAll('.label.pin')].map((l) => l.textContent).filter((t) => t.includes('📍')).join(' | '));
  check('a ping marker appears for the other player', /📍 Alice/.test(pingDbg), pingDbg || 'none');

  // Teleport: Bob goes to Alice (on the runway, on the ground).
  await a.waitForTimeout(1500);
  const tp = await b.evaluate(() => {
    const g = window.__game;
    const pl = [...g.mp.players.values()][0];
    g.flight.pos.x += 3000; // far away first
    document.querySelector('#buddies .buddy').click();
    return { d: g.flight.pos.distanceTo(pl.pos), inside: g.world.hitsObstacle({ x: g.flight.pos.x, y: g.flight.pos.y + 5, z: g.flight.pos.z }, 6) };
  });
  check('tapping a friend chip teleports next to them', tp.d > 5 && tp.d < 80 && !tp.inside, `${Math.round(tp.d)} m away`);

  // High-five: both press within 3 seconds.
  // Each presses the moment their 🙌 prompt shows (they've seen the other close by).
  const pressWhenPrompted = (p) => p.waitForFunction(() => {
    if (document.getElementById('hi5Btn').hidden) return false;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ' }));
    return true;
  }, null, W);
  await pressWhenPrompted(a);
  await pressWhenPrompted(b);
  await a.waitForFunction(() => /High five with Bob/.test(document.getElementById('message').textContent), null, W).catch(() => {});
  const hiA = await a.evaluate(() => document.getElementById('message').textContent);
  const hiB = await b.evaluate(() => document.getElementById('message').textContent);
  check('high-five happens on both screens', /High five/.test(hiA) && /High five/.test(hiB), `${hiA} | ${hiB}`);

  // Shoving: both robots; Alice punches Bob, Bob gets knocked back.
  for (const p of [a, b]) await p.evaluate(() => { const g = window.__game; g.transform(); g.finishMorph(); });
  const shove = async () => {
    const pos = await b.evaluate(() => { const w = window.__game.bot().walk; return [w.pos.x, w.pos.y, w.pos.z]; });
    await a.evaluate((pos) => {
      const g = window.__game;
      const w = g.bot().walk;
      w.place(new w.pos.constructor(pos[0], pos[1], pos[2] + 7), 0, null); // facing -Z, Bob just ahead
      w.onGround = true;
    }, pos);
    await a.waitForFunction((pos) => { const pl = [...window.__game.mp.players.values()][0]; return pl.bot && Math.hypot(pl.target.pos.x - pos[0], pl.target.pos.z - pos[2]) < 3; }, pos, W); // Alice sees Bob there
    await b.evaluate(() => { window.__shoved = 0; const w = window.__game.bot().walk; window.__v0 = Math.hypot(w.vel.x, w.vel.z); });
    const sent = await a.evaluate(() => {
      const ws = window.__game.mp.ws;
      const orig = ws.send.bind(ws);
      window.__sent = [];
      ws.send = (d) => (window.__sent.push(JSON.parse(d).t), orig(d));
      window.__game.botSmash();
      return new Promise((r) => setTimeout(() => r(window.__sent.join(',')), 600));
    });
    await b.waitForFunction(() => /shoved you/.test(document.getElementById('message').textContent), null, { timeout: 8000, polling: 200 }).catch(() => {});
    return b.evaluate(() => /shoved you/.test(document.getElementById('message').textContent));
  };
  check('a punch shoves the friend\'s robot back', await shove());
  // Host switches shoving off.
  await a.evaluate(() => { document.getElementById('rgShove').checked = false; document.getElementById('rgShove').dispatchEvent(new Event('change')); });
  await b.waitForTimeout(1500);
  await b.evaluate(() => { document.getElementById('message').textContent = ''; });
  check('with shoving switched off by the host, a punch does nothing', !(await shove()));
} finally {
  await browser.close();
  await browser2.close();
  stop();
  relay.kill();
}
process.exit(failed() ? 1 : 0);

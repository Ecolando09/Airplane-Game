// Split screen: a second controller presses ☰ and gets a full copy of the game
// in its half of the screen, reading only its own controller, in the same room
// as player 1 (who sees them). Player 2 can do what player 1 can (robot mode);
// player 1, the room's host, changes the city for both; holding ☰ leaves.
//
//   npx vite build && node tools/tests/splitscreen.mjs
//
// Uses its own relay on RELAY_PORT (default 8790), so it doesn't matter what
// else is running on 8787.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.RELAY_PORT ||= '8790';
process.env.PORT ||= '4180';
const { serve, launch, openGame, check, failed } = await import('./helpers.mjs');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const relay = spawn('node', ['server/relay.js'], {
  cwd: root, stdio: 'ignore',
  env: { ...process.env, PORT: process.env.RELAY_PORT, STATE_DIR: mkdtempSync(path.join(tmpdir(), 'relay-')) },
});
const stop = await serve();
const { browser, page } = await launch({ width: 1280, height: 720 });
const W = { timeout: 120000, polling: 300 };
// Four fake controllers on the main page (the copies read them through it).
await page.addInitScript(() => {
  if (window.parent !== window) return;
  const mk = (i) => ({ id: `fake xbox ${i}`, index: i, connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });
  window.__pads = [mk(0), mk(1), mk(2), mk(3)];
  window.__press = (p, b, on) => Object.assign(window.__pads[p].buttons[b], { pressed: on, value: on ? 1 : 0 });
  navigator.getGamepads = () => window.__pads;
  localStorage.setItem('legosky.prefs', JSON.stringify({ low: true }));
  localStorage.setItem('legosky.prefs.p2', JSON.stringify({ low: true }));
  localStorage.setItem('legosky.name', 'Pat');
});
const press = async (p, b, ms = 500) => {
  await page.evaluate(([p, b]) => window.__press(p, b, true), [p, b]);
  await page.waitForTimeout(ms);
  await page.evaluate(([p, b]) => window.__press(p, b, false), [p, b]);
  await page.waitForTimeout(400);
};
const child = () => page.frames().find((f) => f.url().includes('player=2'));
try {
  await openGame(page, 'city=carbondale&vehicle=plane&look=lego');
  await page.evaluate(() => window.__game.start(true));
  // Player 1's controller: the first one used.
  await page.evaluate(() => (window.__pads[0].axes[0] = 0.9));
  await page.waitForTimeout(500);
  await page.evaluate(() => (window.__pads[0].axes[0] = 0));
  check('player 1 is pinned to controller 0', (await page.evaluate(() => window.__game.input.padIndex)) === 0);

  // Player 2 joins with ☰.
  await press(1, 9);
  await page.waitForFunction(() => window.__game.split.guests.length === 1, null, W);
  check('screen splits in two', await page.evaluate(() => document.body.dataset.split === '2'));
  await page.waitForFunction(() => window.__game.mp.status === 'on', null, W);
  const room = await page.evaluate(() => window.__game.mp.room);
  check('player 1 is put in a room', /^[A-Z]{4}$/.test(room || ''), room);

  const f = child();
  check('player 2 gets a copy of the game', !!f, f?.url());
  await f.waitForFunction(() => window.__game?.world?.colliders && document.getElementById('loading').hidden, null, W);
  await f.waitForFunction(() => window.__game.mp.status === 'on', null, W);
  check('player 2 is in the same room', (await f.evaluate(() => window.__game.mp.room)) === room);
  check('player 2 reads only controller 1', (await f.evaluate(() => window.__game.input.pad()?.id)) === 'fake xbox 1');
  check('player 2 has no map or speed panel', await f.evaluate(() => getComputedStyle(document.getElementById('minimap')).display === 'none' && getComputedStyle(document.getElementById('instruments')).display === 'none'));
  check("player 1's controller isn't player 2's", (await page.evaluate(() => window.__game.input.pad()?.id)) === 'fake xbox 0');

  // Player 2 starts with A from their own menu and turns into the robot.
  await press(1, 0);
  await f.waitForFunction(() => window.__game.running, null, { timeout: 30000 });
  check('player 2 starts from their own menu with A', true);
  await f.evaluate(() => { window.__game.transform(); window.__game.finishMorph(); });
  check('player 2 can turn into the robot', await f.evaluate(() => window.__game.isBot));
  await page.waitForFunction(() => [...window.__game.mp.players.values()].some((p) => p.name === 'Player 2' && p.bot), null, W);
  check('player 1 sees player 2 (as a robot)', true);
  await page.screenshot({ path: path.join(tmpdir(), 'splitscreen-2p.png'), timeout: 90000 })
    .then(() => console.log('screenshot:', path.join(tmpdir(), 'splitscreen-2p.png')))
    .catch(() => console.log('(no screenshot: the software renderer was too slow)'));

  // Player 1 (the host) picks a new city: both go there.
  await page.evaluate(() => document.querySelector('#segCity [data-v=fortcollins]').click());
  await page.waitForFunction(() => window.__game.settings.city === 'fortcollins', null, W);
  await f.waitForFunction(() => window.__game.settings.city === 'fortcollins', null, W);
  check('player 1 changes the city for player 2 too', true);
  for (const p of [page, f]) await p.waitForFunction(() => document.getElementById('loading').hidden && window.__game.world?.colliders, null, W);

  // Player 2 holds ☰ to leave.
  await press(1, 9, 6000); // (long: the software renderer draws a frame every second or two) // (long: the software renderer draws a frame every second or two)
  await page.waitForFunction(() => window.__game.split.guests.length === 0, null, { timeout: 30000 });
  await page.waitForFunction(() => !document.body.classList.contains('split'), null, { timeout: 30000 });
  check('holding ☰ leaves, screen back to one', true);
  check('the split-screen room is left again', await page.evaluate(() => !window.__game.mp.room));
} catch (e) {
  check('no errors', false, e.message);
} finally {
  await browser.close();
  stop();
  relay.kill();
}
process.exit(failed() ? 1 : 0);

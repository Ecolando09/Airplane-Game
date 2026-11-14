// The phone controller on a computer: the 📱 chip shows a code and QR, the phone
// page connects through the relay, steers the game and gets its speed back.
// The chip stays on a computer even after a game controller was used.
//   npx vite build && node tools/tests/phone.mjs   (starts its own relay)
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serve, launch, openGame, check, failed, BASE } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const relay = spawn('node', ['server/relay.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, STATE_DIR: mkdtempSync(path.join(tmpdir(), 'relay-')) } });
const stop = await serve();
const { browser, page } = await launch({ width: 900, height: 600 });
const { browser: phoneBrowser, page: phone } = await launch({ width: 800, height: 380 });
try {
  await openGame(page, 'city=spartanburg&vehicle=plane&look=lego&mode=free');
  await page.evaluate(() => window.__game.start(false));
  const chip = await page.evaluate(() => {
    const visible = () => getComputedStyle(document.getElementById('phoneChip')).display !== 'none';
    const before = visible();
    document.body.classList.add('pad-play'); // as after using a game controller
    const after = visible();
    document.body.classList.remove('pad-play');
    return { before, after };
  });
  check('the 📱 phone chip shows on a computer', chip.before);
  check('... and stays after a game controller was used', chip.after);
  await page.evaluate(() => document.getElementById('phoneChip').click());
  await page.waitForFunction(() => !document.getElementById('phonePanel').hidden && /^[A-Z]{4}$/.test(document.getElementById('roomCode').textContent), null, { timeout: 15000, polling: 300 });
  const code = await page.evaluate(() => document.getElementById('roomCode').textContent);
  const qr = await page.evaluate(() => document.getElementById('qr').src.startsWith('data:image'));
  check('it shows a code and a QR for the phone', !!code && qr, code);
  await phone.goto(`${BASE}remote.html?room=${code}`);
  await page.waitForFunction(() => document.getElementById('phoneChip').classList.contains('on'), null, { timeout: 30000, polling: 300 });
  check('the phone connects (the game says so)', true);
  await phone.waitForFunction(() => document.getElementById('spd').textContent !== '' && document.body.textContent.includes('Connected'), null, { timeout: 30000, polling: 300 });
  check('the phone shows it is connected and gets the game\'s speed', true);
  // A phone button reaches the game: the robot button turns the plane into a robot.
  await phone.evaluate(() => document.getElementById('botBtn').click());
  await page.waitForFunction(() => window.__game.isBot, null, { timeout: 30000, polling: 300 });
  check('a phone button works in the game (🤖 Robot)', true);
  const steer = await page.evaluate(() => !!window.__game.input.remote && performance.now() - window.__game.input.remote.time < 3000);
  check('the phone\'s steering reaches the game', steer);
} finally {
  await browser.close();
  await phoneBrowser.close();
  stop();
  relay.kill();
}
process.exit(failed() ? 1 : 0);

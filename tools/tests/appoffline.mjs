// The phone app's offline copy (dist-app/, from `npm run build:app`), opened the
// way the app opens it when the phone has no internet: served from
// https://appassets.androidplatform.net/ with every other address blocked.
// It must play like the website (touch controls, not PSG1 mode), in every city.
//
//   npm run build:app && node tools/tests/appoffline.mjs [screenshot dir]
import { launch, openApp, check, failed } from './helpers.mjs';

const OUT = process.argv[2] || '';
const { browser, page } = await launch({ width: 900, height: 420 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const asked = [];
page.on('request', (r) => asked.push(r.url()));
try {
  await openApp(page, 'city=spartanburg&vehicle=bat&look=lego', { dir: 'dist-app' });
  const s = await page.evaluate(() => ({
    psg1: document.body.classList.contains('psg1'), touchUi: !!document.getElementById('touch'), online: navigator.onLine,
    noKey: !document.querySelector('script[src*="config.js"]'), cards: document.querySelectorAll('#segVehicle button').length,
    net: document.getElementById('netNote')?.textContent || '',
  }));
  check('the offline copy opens with no internet', !s.online && s.cards === 4, JSON.stringify(s));
  check('it is the phone game (touch controls), not PSG1 mode', !s.psg1 && s.touchUi);
  check('no Google key file in the app', s.noKey);
  // Play: the Batmobile drives, changes into the flying car and the robot.
  const play = await page.evaluate(() => {
    const g = window.__game;
    g.start(false);
    const f0 = g.flight;
    for (let t = 0; t < 3; t += 1 / 60) g.step(1 / 60, { pitch: 1, roll: 0, yaw: 0, brake: false });
    const car = { isCar: !!f0.isCar, mph: Math.round(f0.speed * 2.237) };
    g.transform();
    g.transform();
    g.finishMorph();
    return { ...car, bot: g.isBot };
  });
  check('it plays offline (the Batmobile drives and transforms)', play.isCar && play.mph > 40 && play.bot, JSON.stringify(play));
  if (OUT) {
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/app-offline-spartanburg.png` });
  }
  // Another city loads from inside the app.
  await openApp(page, 'city=sanfrancisco&vehicle=plane&look=real', { dir: 'dist-app' });
  const sf = await page.evaluate(() => ({ landmarks: window.__game.world.landmarks.length, sat: !!window.__game.world.colliders }));
  check('another city (San Francisco, realistic look) loads offline', sf.landmarks > 3 && sf.sat, JSON.stringify(sf));
  const outside = [...new Set(asked.map((u) => new URL(u).host))].filter((h) => h !== 'appassets.androidplatform.net');
  check('nothing else was needed (only the server for rooms, which is skipped offline)', outside.every((h) => /latlas\.lol|google|gstatic/.test(h)), outside.join(', ') || 'none');
  check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}
console.log(failed() ? `${failed()} FAILED` : 'ALL PASSED');
process.exit(failed() ? 1 : 0);

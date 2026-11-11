// The PSG1 app's built-in game (npm run build:psg1), opened the way the app
// serves it, with no internet: it must load and play offline, lay out at
// 620 x 540, and play with only the PSG1 buttons. Buttons are pressed through
// the app bridge (window.legoSkyPad), the same path the PSG1 app uses.
//   npm run build:psg1 && node tools/tests/psg1.mjs
import { launch, openApp, check, failed } from './helpers.mjs';

const stop = () => {};
const { browser, page } = await launch({ width: 620, height: 540 });
// Standard gamepad order: 0 B (bottom), 1 A (right), 2 Y (left), 3 X (top), 4 L1, 5 R1, 9 START, 12-15 D-pad.
const press = async (i, hold = 700) => {
  await page.evaluate((i) => {
    const b = Array(17).fill(0);
    b[i] = 1;
    window.legoSkyPad.set(b, [0, 0, 0, 0]);
  }, i);
  await page.waitForTimeout(hold);
  await page.evaluate(() => window.legoSkyPad.set(Array(17).fill(0), [0, 0, 0, 0]));
  await page.waitForTimeout(500);
};
const focused = () => page.evaluate(() => document.querySelector('.padfocus')?.id || document.querySelector('.padfocus')?.textContent.trim().slice(0, 30) || null);
try {
  await openApp(page, 'city=spartanburg&vehicle=plane&look=lego&mode=free');
  check('the built-in game loads and builds a city with no internet', true);
  const layout = await page.evaluate(() => ({
    psg1: document.body.classList.contains('psg1'),
    touchHidden: getComputedStyle(document.getElementById('touch')).display === 'none',
    fov: window.__game.camera.fov,
    tips: getComputedStyle(document.querySelector('.controls.psg1-only')).display !== 'none',
    net: document.getElementById('netNote')?.textContent,
    diag: !!document.getElementById('diagLink'),
  }));
  check('menu says it is offline, and what still works', /Offline/.test(layout.net || ''), layout.net);
  check('device check page is in the menu', layout.diag);
  check('PSG1 mode is on', layout.psg1);
  check('touch controls hidden', layout.touchHidden);
  check('wider camera (72°)', layout.fov === 72, `${layout.fov}°`);
  check('PSG1 controls guide shown in the menu', layout.tips);

  // Wake the bridge (any input), then the highlight lands on the main button.
  await page.evaluate(() => window.legoSkyPad.set(Array(17).fill(0), [0, 0, 0, 0]));
  await page.waitForTimeout(800);
  check('menu highlight starts on the Play button', (await focused()) === 'startRunway', await focused());
  await press(13, 80); // D-pad down
  check('D-pad down moves the highlight', (await focused()) === 'startAir', await focused());
  await press(12, 80); // D-pad up
  check('D-pad up moves it back', (await focused()) === 'startRunway', await focused());
  // Up/down go row by row, so small items under wide ones are reached too: open
  // Settings and step through it; every checkbox gets the highlight.
  const settings = await page.evaluate(() => {
    const d = document.getElementById('settingsBox');
    if (d) d.open = true;
    return !!d;
  });
  const seen = [];
  for (let i = 0; i < 60 && settings; i++) {
    const f = await focused();
    seen.push(f);
    if (f === 'setLow') break;
    await press(13, 80);
  }
  check('D-pad down reaches every Settings checkbox', ['setInvert', 'setSound', 'setMusic', 'setLow'].every((id) => seen.includes(id)), seen.join(' > '));
  while ((await focused()) !== 'startRunway') {
    const before = await focused();
    await press(12, 80);
    if ((await focused()) === before) break;
  }
  check('D-pad up returns to the Play button', (await focused()) === 'startRunway', await focused());
  await press(1); // A
  check('A presses the highlighted button (starts flying)', await page.evaluate(() => window.__game.running));

  await press(2); // Y
  check('Y turns into the robot', await page.evaluate(() => window.__game.isBot));
  await press(2);
  check('Y again changes back', await page.evaluate(() => !window.__game.isBot));
  await press(9); // START
  check('START opens the menu', await page.evaluate(() => !window.__game.running && !document.getElementById('menu').hidden));
  await press(0); // B
  check('B in the menu resumes', await page.evaluate(() => window.__game.running));

  // No triggers on the PSG1: the right stick works the throttle in the plane,
  // and the left stick's up/down is forward speed in the helicopter.
  const stickThrottle = await page.evaluate(() => {
    const inp = window.__game.input;
    const read = (axes) => {
      window.legoSkyPad.set(Array(17).fill(0), axes);
      return inp.read().throttle;
    };
    const heli = inp.heliMode;
    inp.heliMode = false;
    const plane = { up: read([0, 0, 0, -1]), down: read([0, 0, 0, 1]), idle: read([0, 0, 0, 0]) };
    inp.heliMode = true;
    const copter = { up: read([0, -1, 0, 0]), lift: read([0, 0, 0, -1]) };
    // A robot made from the helicopter walks with the left stick like any robot.
    const bot = inp.botMode;
    inp.botMode = true;
    window.legoSkyPad.set(Array(17).fill(0), [0, -1, 0, 0]);
    const copterRobot = inp.read().pitch;
    inp.botMode = bot;
    inp.heliMode = heli;
    read([0, 0, 0, 0]);
    return { plane, copter, copterRobot };
  });
  check('plane: right stick up raises the throttle, down lowers it',
    stickThrottle.plane.up > 0.9 && stickThrottle.plane.down < -0.9 && stickThrottle.plane.idle === 0, JSON.stringify(stickThrottle.plane));
  check('copter: left stick up is forward speed, right stick stays lift',
    stickThrottle.copter.up > 0.9 && stickThrottle.copter.lift === 0, JSON.stringify(stickThrottle.copter));
  check('robot made from the copter walks with the left stick', stickThrottle.copterRobot > 0.9, String(stickThrottle.copterRobot));

  // A pop-up: the crash box takes the highlight, and START respawns.
  await page.evaluate(() => {
    document.getElementById('crashBox').hidden = false;
    window.legoSkyPad.set(Array(17).fill(0), [0, 0, 0, 0]);
  });
  await page.waitForTimeout(1500);
  check('a pop-up takes the highlight', (await focused()) === 'crashRespawn', await focused());
  await page.evaluate(() => {
    document.getElementById('crashBox').hidden = true;
  });

  // Hints use PSG1 button names.
  const hints = await page.evaluate(() => ({
    auto: document.querySelector('#autoLandBtn kbd')?.textContent,
    drive: document.querySelector('#driveBtn kbd')?.textContent,
  }));
  check('pop-up buttons show PSG1 button names', hints.auto === 'L1' && hints.drive === 'A', `${hints.auto}, ${hints.drive}`);

  // L1 / R1 in the menu change city.
  await press(9);
  const before = await page.evaluate(() => new URLSearchParams(location.search).get('city'));
  await press(5); // R1
  await page.waitForFunction(() => document.getElementById('loading').hidden && window.__game.world, null, { timeout: 180000 });
  const after = await page.evaluate(() => new URLSearchParams(location.search).get('city'));
  check('R1 in the menu picks the next city (loaded offline)', before !== after, `${before} -> ${after}`);
  // The Realistic look's satellite picture is built in too.
  await page.evaluate(() => document.querySelector('#segLook [data-v=real]').click());
  await page.waitForFunction(() => document.getElementById('loading').hidden && window.__game.world, null, { timeout: 180000 });
  check('Realistic look loads offline', await page.evaluate(() => new URLSearchParams(location.search).get('look') === 'real' && !!window.__game.world));
} finally {
  await browser.close();
  stop();
}
process.exit(failed() ? 1 : 0);

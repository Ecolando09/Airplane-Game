// PSG1 mode (docs/plans/02-psg1-port-plan.md phases 1, 2 and 4): the layout at
// 620 x 540, and playing with only the PSG1 buttons. Buttons are pressed through
// the app bridge (window.legoSkyPad), the same path the PSG1 app uses.
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const stop = await serve();
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
  await openGame(page, 'psg1&city=spartanburg&vehicle=plane&look=lego&mode=free');
  const layout = await page.evaluate(() => ({
    psg1: document.body.classList.contains('psg1'),
    touchHidden: getComputedStyle(document.getElementById('touch')).display === 'none',
    fov: window.__game.camera.fov,
    tips: getComputedStyle(document.querySelector('.controls.psg1-only')).display !== 'none',
  }));
  check('?psg1 turns on PSG1 mode', layout.psg1);
  check('touch controls hidden', layout.touchHidden);
  check('wider camera (72°)', layout.fov === 72, `${layout.fov}°`);
  check('PSG1 controls guide shown in the menu', layout.tips);

  // Wake the bridge (any input), then the highlight lands on the main button.
  await page.evaluate(() => window.legoSkyPad.set(Array(17).fill(0), [0, 0, 0, 0]));
  await page.waitForTimeout(800);
  check('menu highlight starts on the Play button', (await focused()) === 'startRunway', await focused());
  await press(13); // D-pad down
  check('D-pad down moves the highlight', (await focused()) === 'startAir', await focused());
  await press(12); // D-pad up
  check('D-pad up moves it back', (await focused()) === 'startRunway', await focused());
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
    inp.heliMode = heli;
    read([0, 0, 0, 0]);
    return { plane, copter };
  });
  check('plane: right stick up raises the throttle, down lowers it',
    stickThrottle.plane.up > 0.9 && stickThrottle.plane.down < -0.9 && stickThrottle.plane.idle === 0, JSON.stringify(stickThrottle.plane));
  check('copter: left stick up is forward speed, right stick stays lift',
    stickThrottle.copter.up > 0.9 && stickThrottle.copter.lift === 0, JSON.stringify(stickThrottle.copter));

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
  check('R1 in the menu picks the next city', before !== after, `${before} -> ${after}`);
} finally {
  await browser.close();
  stop();
}
process.exit(failed() ? 1 : 0);

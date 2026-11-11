// A controller on a phone (e.g. a GameSir X2): once it's used, the touch
// buttons disappear, hints name controller buttons, and it plays the game.
// The controller is faked by replacing navigator.getGamepads.
import { serve, openGame, check, failed } from './helpers.mjs';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const stop = await serve();
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.addInitScript(() => {
  const pad = { id: 'GameSir-X2 (fake)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  window.__pad = pad;
  window.__press = (i, on) => Object.assign(pad.buttons[i], { pressed: on, value: on ? 1 : 0 });
  navigator.getGamepads = () => [pad];
});
const press = async (i) => {
  await page.evaluate((i) => window.__press(i, true), i);
  await page.waitForTimeout(700);
  await page.evaluate((i) => window.__press(i, false), i);
  await page.waitForTimeout(500);
};
const shown = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none' && !e.closest('[hidden]'); }, sel);
try {
  await openGame(page, 'city=carbondale&vehicle=plane&look=lego&mode=free');
  await page.evaluate(() => window.__game.start(false));
  await page.waitForTimeout(1500);
  check('phone shows touch buttons before the controller is used', await shown('#touch'));
  await press(3); // Y: camera (any press wakes it up)
  check('touch buttons hidden once the controller is used', !(await shown('#touch')));
  check('controls guide lists controller buttons', await page.evaluate(() => getComputedStyle(document.querySelector('.controls.pad-only')).display !== 'none'));
  check('auto-land hint names LB', await page.evaluate(() => document.querySelector('#autoLandBtn kbd').textContent === 'LB'));
  await press(2); // X: robot
  check('X turns into the robot', await page.evaluate(() => window.__game.isBot));
  await press(9); // MENU: pause
  check('MENU pauses (opens the menu)', await page.evaluate(() => !window.__game.running));
  await press(9);
  check('MENU again resumes', await page.evaluate(() => window.__game.running));
  await page.evaluate(() => window.dispatchEvent(new Event('gamepaddisconnected')));
  await page.evaluate(() => { navigator.getGamepads = () => []; window.dispatchEvent(new Event('gamepaddisconnected')); });
  await page.waitForTimeout(500);
  check('unplugging brings the touch buttons back', await shown('#touch'));

  // The PSG1's built-in controller in the PSG1's browser: PSG1 layout and names.
  const p2 = await browser.newPage({ viewport: { width: 730, height: 492 }, isMobile: true, hasTouch: true });
  p2.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await p2.addInitScript(() => {
    const pad = { id: 'psg1_gamepad (Vendor: 1234 Product: 5678)', index: 0, connected: true, mapping: '', axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
    window.__press = (i, on) => Object.assign(pad.buttons[i], { pressed: on, value: on ? 1 : 0 });
    navigator.getGamepads = () => [pad];
  });
  await openGame(p2, 'city=carbondale&vehicle=plane&look=lego&mode=free');
  const press2 = async (i) => {
    await p2.evaluate((i) => window.__press(i, true), i);
    await p2.waitForTimeout(700);
    await p2.evaluate((i) => window.__press(i, false), i);
    await p2.waitForTimeout(700);
  };
  check('website has no PSG1 mode before the PSG1 controller is used', await p2.evaluate(() => !document.body.classList.contains('psg1')));
  await press2(13); // D-pad down (wakes the pad, moves the menu highlight)
  const st = await p2.evaluate(() => ({ psg1: document.body.classList.contains('psg1'), fov: window.__game.camera.fov,
    guide: getComputedStyle(document.querySelector('.controls.psg1-only')).display !== 'none',
    xbox: getComputedStyle(document.querySelector('.controls.xbox-guide')).display !== 'none',
    touch: getComputedStyle(document.getElementById('touch')).display !== 'none' }));
  check('PSG1 controller in the browser turns on PSG1 mode', st.psg1 && st.fov === 72, JSON.stringify(st));
  check('PSG1 controls guide shown (not the Xbox one)', st.guide && !st.xbox);
  await press2(12); // back up to Play
  await press2(1); // A (right button) presses
  check('PSG1 A button (right) presses the highlighted menu button', await p2.evaluate(() => window.__game.running));
  check('auto-land hint names L1', await p2.evaluate(() => document.querySelector('#autoLandBtn kbd').textContent === 'L1'));
} finally {
  await browser.close();
  stop();
}
process.exit(failed() ? 1 : 0);

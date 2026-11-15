// The passenger shuttle's hover mode: B switches it; it then rises and sinks in
// place like the copter, hovers over water, and shows thrusters whose flames
// grow with the thrust; B again flies it as a plane.
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const OUT = process.argv[2];
const stop = await serve();
const { browser, page } = await launch({ width: 900, height: 560 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await openGame(page, 'city=spartanburg&vehicle=jet&look=lego&mode=free');
  check('the menu calls it the Passenger Shuttle', await page.evaluate(() => document.querySelector('#segVehicle [data-v="jet"]').textContent.includes('Passenger Shuttle')));
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    g.start(false);
    const key = (code) => { dispatchEvent(new KeyboardEvent('keydown', { code })); dispatchEvent(new KeyboardEvent('keyup', { code })); };
    key('KeyB');
    await sleep(300);
    const out = { hoverOn: g.flight.canStall === false, label: document.querySelector('#touchButtons [data-act=floats]').textContent };
    // Rise in place: lift held up, no speed.
    const f = g.flight;
    const x0 = f.pos.x, z0 = f.pos.z, y0 = f.pos.y;
    for (let i = 0; i < 240; i++) g.step(1 / 60, { pitch: 0, roll: 0, yaw: 0, throttle: 0, liftSet: 1 });
    out.rose = f.pos.y - y0;
    out.drift = Math.hypot(f.pos.x - x0, f.pos.z - z0);
    // Hold: lift centred keeps the height.
    for (let i = 0; i < 240; i++) g.step(1 / 60, { pitch: 0, roll: 0, yaw: 0, throttle: 0, liftSet: 0 }); // ease out of the climb
    const yHold = f.pos.y;
    for (let i = 0; i < 240; i++) g.step(1 / 60, { pitch: 0, roll: 0, yaw: 0, throttle: 0, liftSet: 0 });
    out.held = Math.abs(f.pos.y - yHold);
    // Flames: bigger when climbing than when sinking.
    const flame = () => g.plane.floats.children[0].children[2].scale.y;
    f.vel.y = 11; await sleep(1500); out.flameUp = flame();
    f.vel.y = -8; f.onGround = false; await sleep(1500); out.flameDown = flame();
    out.thrustersShown = g.plane.floats.visible;
    // Over water it hovers down onto the surface without a splash.
    let wx = null, wz = null;
    for (let i = 0; i < 4000 && wx === null; i++) {
      const x = (Math.random() - 0.5) * 6000, z = (Math.random() - 0.5) * 6000;
      if (g.world.isWater(x, z) && g.world.isWater(x + 20, z) && g.world.isWater(x - 20, z)) { wx = x; wz = z; }
    }
    if (wx !== null) {
      f.pos.set(wx, g.world.heightAt(wx, wz) + 12, wz);
      f.vel.set(0, 0, 0);
      f.onGround = false;
      for (let i = 0; i < 600; i++) g.step(1 / 60, { pitch: 0, roll: 0, yaw: 0, throttle: 0, liftSet: -1 });
      out.water = { crashed: f.crashed, down: f.onGround };
    }
    // B again: flight mode, carried on at flying speed.
    f.pos.y += 200;
    f.onGround = false;
    key('KeyB');
    await sleep(300);
    out.flightAgain = g.flight.canStall !== false && g.flight.speed > 30;
    g.cam('cockpit');
    await sleep(1200);
    out.mode = document.getElementById('tMode')?.textContent;
    g.cam('chase');
    return out;
  });
  check('B switches the shuttle to hover mode (button says FLY)', r.hoverOn && r.label === 'FLY', JSON.stringify(r));
  check('it rises in place with the lift control', r.rose > 15 && r.drift < 2, `rose ${r.rose?.toFixed(1)} m, moved ${r.drift?.toFixed(2)} m`);
  check('... and holds its height with the lift centred', r.held < 1, `${r.held?.toFixed(2)} m`);
  check('thrusters show underneath, flames longer climbing than sinking', r.thrustersShown && r.flameUp > r.flameDown * 1.5, `${r.flameUp?.toFixed(2)} vs ${r.flameDown?.toFixed(2)}`);
  if (r.water) check('it settles onto water without a splash', !r.water.crashed && r.water.down, JSON.stringify(r.water));
  check('B again flies it as a plane, at flying speed', r.flightAgain);
  check('the cockpit shows FLIGHT / HOVER', r.mode === 'FLIGHT', r.mode);
  if (OUT) {
    await page.evaluate(() => { const g = window.__game; const k = (c) => { dispatchEvent(new KeyboardEvent('keydown', { code: c })); dispatchEvent(new KeyboardEvent('keyup', { code: c })); }; g.start(false); k('KeyB'); g.flight.pos.y += 25; g.flight.onGround = false; g.flight.vel.y = 6; });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const g = window.__game; const T = g.camera.position.constructor; g.photo = { offset: new T(14, 4, 12) }; });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/hover-close.png` });
    await page.evaluate(() => { delete window.__game.photo; });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/hover-chase.png` });
  }
  check('no errors in the page', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  stop();
}
process.exit(failed() ? 1 : 0);

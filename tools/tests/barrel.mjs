// Barrel roll: tapping right (or left) twice quickly rolls the plane all the way
// around and back to level flight; not on the ground.
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const stop = await serve();
const { browser, page } = await launch({ width: 640, height: 420 });
try {
  await openGame(page, 'city=spartanburg&vehicle=plane&look=lego&mode=free');
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.start(false);
    const f = g.flight;
    const out = { groundRefused: !f.barrelRoll(1) };
    f.pos.y += 300;
    f.speed = 55;
    f.onGround = false;
    f.throttle = 0.8;
    const ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
    for (let i = 0; i < 60; i++) g.step(1 / 60, ctl); // settle level
    const y0 = f.pos.y;
    out.started = f.barrelRoll(1);
    let minUp = 1;
    let firstRight = null;
    for (let i = 0; i < 90; i++) {
      g.step(1 / 60, ctl);
      minUp = Math.min(minUp, f.up.y);
      if (i === 5) firstRight = f.right.y; // rolling right: the right wing dips first
    }
    out.minUp = minUp;
    out.rightFirst = firstRight;
    out.endUp = f.up.y;
    out.done = !f.barrel;
    out.drop = y0 - f.pos.y;
    out.crashed = f.crashed;
    return out;
  });
  check('no barrel roll on the ground', r.groundRefused);
  check('a barrel roll goes upside down and all the way round', r.started && r.minUp < -0.9 && r.done, JSON.stringify(r));
  check('... to the right when asked (right wing first)', r.rightFirst < -0.2);
  check('... and ends level, still flying', r.endUp > 0.95 && !r.crashed && r.drop < 40, `up ${r.endUp}, dropped ${r.drop}`);
  // Two quick taps of D (right) start one from the keyboard.
  await page.evaluate(() => { const f = window.__game.flight; f.barrel = null; });
  // (Sent from inside the page: the slow test browser takes longer than 0.4 s per simulated key press.)
  const started = await page.evaluate(() => {
    const key = (type) => dispatchEvent(new KeyboardEvent(type, { code: 'KeyD', key: 'd' }));
    key('keydown'); key('keyup'); key('keydown'); key('keyup');
    return !!window.__game.flight.barrel;
  });
  const single = await page.evaluate(async () => {
    const f = window.__game.flight;
    f.barrel = null;
    await new Promise((r) => setTimeout(r, 2500)); // well past the double-tap window, frames in between
    const key = (type) => dispatchEvent(new KeyboardEvent(type, { code: 'KeyA', key: 'a' }));
    key('keydown');
    await new Promise((r) => setTimeout(r, 1500)); // held through a frame or two
    key('keyup');
    await new Promise((r) => setTimeout(r, 1500));
    return !f.barrel;
  });
  check('a single tap does not', single);
  const st = await page.evaluate(() => { const f = window.__game.flight; return { speed: f.speed, ground: f.onGround, crashed: f.crashed, y: f.pos.y, h: window.__game.world.heightAt(f.pos.x, f.pos.z), running: window.__game.running, msg: document.getElementById('message').textContent }; });
  check('tapping D twice quickly does a barrel roll', started, JSON.stringify(st));
} finally {
  await browser.close();
  stop();
}
process.exit(failed() ? 1 : 0);

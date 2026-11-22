// The hot air balloon: in the menu; flies with the copter's controls (lift up
// and down); the flame grows when climbing and shrinks when sinking; it holds
// its height with the lift centred, turns slowly, drifts with the wind, lands
// softly; changes into its own robot; has its own cockpit instruments.
// Pass a folder to also save screenshots.
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const OUT = process.argv[2];
const stop = await serve();
const { browser, page } = await launch({ width: 1000, height: 600 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = (n) => OUT && page.screenshot({ path: `${OUT}/${n}.png` });
try {
  await openGame(page, 'city=spartanburg&vehicle=plane&look=lego&mode=free');
  check('the menu offers the Hot Air Balloon', await page.evaluate(() => !!document.querySelector('#segVehicle [data-v="balloon"]')));
  await page.evaluate(() => document.querySelector('#segVehicle [data-v="balloon"]').click());
  await page.waitForFunction(() => window.__game.plane?.balloon, null, { timeout: 60000, polling: 300 });
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.start(false);
    const f = g.flight;
    const p = g.plane;
    const out = { liftControls: g.input.heliMode === true, startOk: f.onGround && !f.crashed };
    const step = (secs, ctl) => {
      for (let i = 0; i < secs * 30; i++) g.step(1 / 30, { pitch: 0, roll: 0, yaw: 0, throttle: 0, ...ctl });
      p.animate(f, 1); // (the flame follows the burner each frame in the game)
    };
    const agl = () => f.pos.y - p.gearHeight - g.world.heightAt(f.pos.x, f.pos.z);
    // Burner on: up it goes, flame big.
    step(14, { liftSet: 1 });
    out.rose = agl();
    out.flameUp = p.flame.scale.y;
    out.burnUp = f.burner;
    // Lift centred: holds its height (after easing out of the climb).
    step(8, { liftSet: 0 });
    const h0 = agl();
    step(6, { liftSet: 0 });
    out.held = Math.abs(agl() - h0);
    out.flameHold = p.flame.scale.y;
    // Turning.
    const hd0 = f.heading;
    step(4, { liftSet: 0, roll: 1 });
    out.turned = Math.abs(((f.heading - hd0 + 540) % 360) - 180);
    // The wind carries it along with no throttle.
    const x0 = f.pos.x, z0 = f.pos.z;
    step(10, { liftSet: 0 });
    out.drift = Math.hypot(f.pos.x - x0, f.pos.z - z0);
    // The fan pushes it forward.
    step(10, { liftSet: 0, throttleSet: 1 });
    const fwd = f.forward;
    out.fanSpeed = f.vel.x * fwd.x + f.vel.z * fwd.z - (f.wind.x * fwd.x + f.wind.y * fwd.z);
    // Venting: down it comes, flame small, and it lands softly.
    step(3, { liftSet: -1, throttleSet: 0 });
    out.flameDown = p.flame.scale.y;
    out.burnDown = f.burner;
    out.sinking = f.vel.y < -1;
    step(90, { liftSet: -1 });
    out.landed = f.onGround && !f.crashed;
    out.crashed = f.crashed ? f.crashReason : '';
    return out;
  });
  check('it flies with the lift controls (like the copter)', r.liftControls && r.startOk, JSON.stringify(r));
  check('burner on: it rises', r.rose > 40, `${r.rose?.toFixed(0)} m up`);
  check('the flame is big going up, small going down', r.flameUp > r.flameHold && r.flameHold > r.flameDown && r.flameUp > r.flameDown * 3, `${r.flameUp?.toFixed(2)} / ${r.flameHold?.toFixed(2)} / ${r.flameDown?.toFixed(2)}`);
  check('with the lift centred it holds its height', r.held < 1.5, `${r.held?.toFixed(2)} m`);
  check('left and right turn it slowly', r.turned > 30 && r.turned < 179, `${r.turned?.toFixed(0)}°`);
  check('the wind carries it along', r.drift > 15, `${r.drift?.toFixed(0)} m in 10 s`);
  check('the throttle runs a fan that pushes it forward', r.fanSpeed > 6, `${r.fanSpeed?.toFixed(1)} m/s`);
  check('venting: it sinks, and lands softly', r.sinking && r.landed, r.crashed);
  await shot('balloon-landed');
  // Up again for pictures, the cockpit and the robot.
  const d = await page.evaluate(async () => {
    const g = window.__game;
    const f = g.flight;
    f.pos.y += 60;
    f.onGround = false;
    f.vel.set(0, 0, 0);
    g.cam('cockpit');
    await new Promise((res) => setTimeout(res, 2000));
    const dash = { type: g.dashboard.type, agl: document.getElementById('tAgl')?.textContent };
    g.cam('chase');
    return dash;
  });
  check('its own instruments in first person', d.type === 'balloon' && /FT/.test(d.agl || ''), JSON.stringify(d));
  await shot('balloon-cockpit-x');
  await page.waitForTimeout(1500);
  await shot('balloon-chase');
  const b = await page.evaluate(async () => {
    const g = window.__game;
    g.transform();
    g.finishMorph();
    const robot = g.isBot && g.plane.robotKind === 'balloon';
    await new Promise((res) => setTimeout(res, 1500));
    return { robot };
  });
  check('it changes into its own robot', b.robot);
  await shot('balloon-robot');
  const back = await page.evaluate(() => {
    const g = window.__game;
    g.transform();
    g.finishMorph();
    return !g.isBot && !!g.plane.balloon && g.input.heliMode;
  });
  check('... and back into the balloon', back);
  check('no errors in the page', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  stop();
}
process.exit(failed() ? 1 : 0);

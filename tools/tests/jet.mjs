// The passenger jet: a third vehicle in the menu, faster than the bush plane,
// level on its nose wheel, with its own robot, cockpit display, and the usual
// leave-it-behind and parked-plane rules.
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const stop = await serve();
const { browser, page } = await launch({ width: 900, height: 560 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await openGame(page, 'city=spartanburg&vehicle=plane&look=lego&mode=free');
  check('the menu offers the Passenger Jet', await page.evaluate(() => !!document.querySelector('#segVehicle [data-v="jet"]')));
  // Top speed: the bush plane, then the jet, flown level at full throttle.
  const top = async () => page.evaluate(() => {
    const g = window.__game;
    g.start(false);
    const f = g.flight;
    f.pos.y += 400;
    f.onGround = false;
    f.speed = 40;
    f.throttle = 1;
    for (let i = 0; i < 60 * 60; i++) g.step(1 / 60, { pitch: 0, roll: 0, yaw: 0, throttle: 0.5 });
    return f.speed;
  });
  const plane = await top();
  await page.evaluate(() => document.querySelector('#segVehicle [data-v="jet"]').click());
  await page.waitForFunction(() => window.__game.plane?.jet, null, { timeout: 60000, polling: 300 });
  const jet = await top();
  check('the jet is faster than the bush plane', jet > plane * 1.3, `${(jet * 2.237).toFixed(0)} vs ${(plane * 2.237).toFixed(0)} mph`);
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    g.start(false);
    await sleep(1500);
    const level = Math.abs(new g.camera.up.constructor(0, 0, -1).applyQuaternion(g.plane.group.quaternion).y) < 0.02; // sits level, not tail-down
    g.cam('cockpit');
    await sleep(1500);
    const dash = g.dashboard.type;
    g.cam('chase');
    g.transform();
    g.finishMorph();
    const robot = g.isBot;
    const { walk, rampage, props } = g.bot();
    const car = props.items.find((x) => x.kind === 'car' && !x.held);
    walk.place(new walk.pos.constructor(car.x + 10, g.world.heightAt(car.x + 10, car.z), car.z), 0, null);
    rampage.enterCar(walk, car);
    const left = g.leftBehind?.vehicle;
    rampage.exitCar(walk);
    // Take a parked plane: you fly it (the bush plane's shape, its colour), your jet waits.
    const pp = props.items.find((x) => x.kind === 'plane' && !x.held);
    walk.place(new walk.pos.constructor(pp.x + 12, g.world.heightAt(pp.x + 12, pp.z), pp.z), 0, null);
    walk.onGround = true;
    await sleep(1500);
    document.getElementById('driveBtn').click();
    await sleep(300);
    const parked = !!g.plane.parked && !g.plane.jet;
    // Back to the robot, then F: your jet again.
    g.transform(); g.finishMorph();
    const car2 = props.items.find((x) => x.kind === 'car' && !x.held);
    walk.place(new walk.pos.constructor(car2.x + 10, g.world.heightAt(car2.x + 10, car2.z), car2.z), 0, null);
    rampage.enterCar(walk, car2);
    rampage.exitCar(walk);
    g.transform(); g.finishMorph();
    return { level, dash, robot, left, parked, jetAgain: !g.isBot && !!g.plane.jet };
  });
  check('it sits level on the ground (nose wheel, no tail-down tilt)', r.level);
  check('its own airliner display in first person', r.dash === 'jet', r.dash);
  check('it changes into a robot', r.robot);
  check('getting into a car leaves the jet parked', r.left === 'jet', r.left);
  check('from the jet you can take a parked plane', r.parked);
  check('... and changing back afterwards gives you your jet', r.jetAgain, JSON.stringify(r));
  check('no errors in the page', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  stop();
}
process.exit(failed() ? 1 : 0);

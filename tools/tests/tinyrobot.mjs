// A shrunk robot: stands still with nothing pressed, gets into a normal car with
// GRAB (the car keeps its real size), and has its own robot display in first person.
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
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    g.start(false);
    g.transform();
    g.finishMorph();
    const { walk, rampage, props } = g.bot();
    const key = (code) => { dispatchEvent(new KeyboardEvent('keydown', { code })); dispatchEvent(new KeyboardEvent('keyup', { code })); };
    key('BracketLeft');
    key('BracketLeft'); // 1/4x
    // A stick resting a little off centre (sideways): sized with the robot now, and
    // inside the dead zone it does nothing at all.
    const p0 = walk.pos.clone();
    for (let i = 0; i < 120; i++) walk.update(1 / 60, { pitch: 0, roll: 0, yaw: 0.3, brake: false, run: false });
    const side = walk.pos.distanceTo(p0) / 2; // m/s
    walk.setSize(1);
    const p1 = walk.pos.clone();
    for (let i = 0; i < 120; i++) walk.update(1 / 60, { pitch: 0, roll: 0, yaw: 0.3, brake: false, run: false });
    const side1 = walk.pos.distanceTo(p1) / 2;
    walk.setSize(0.25);
    for (let i = 0; i < 120; i++) walk.update(1 / 60, { pitch: 0, roll: 0, yaw: 0, brake: false, run: false });
    const p2 = walk.pos.clone();
    for (let i = 0; i < 120; i++) walk.update(1 / 60, { pitch: 0, roll: 0, yaw: 0, brake: false, run: false });
    const still = walk.pos.distanceTo(p2);
    // Next to a normal car: GRAB gets in.
    const car = props.items.find((x) => x.kind === 'car' && !x.held && (x.scale || 1) === 1);
    walk.place(new walk.pos.constructor(car.x + 4, g.world.heightAt(car.x + 4, car.z), car.z), Math.PI / 2, null);
    walk.onGround = true;
    await sleep(800);
    rampage.grabOrThrow(walk);
    const dr = rampage.driving;
    const ws = new walk.pos.constructor();
    dr?.mesh.getWorldScale(ws);
    return { side, side1, still, driving: dr?.item === car, carScale: ws.x };
  });
  check('with nothing pressed, a ¼× robot stays put', r.still < 0.01, `moved ${r.still}`);
  check('side-stepping is sized with the robot (¼× steps half as fast as 1×)', r.side < r.side1 * 0.6, `${r.side.toFixed(2)} vs ${r.side1.toFixed(2)} m/s`);
  check('a ¼× robot gets into a normal-size car with GRAB', r.driving);
  check('... and the car keeps its real size (not shrunk with the robot)', Math.abs(r.carScale - 1) < 0.01, `scale ${r.carScale}`);
  await page.waitForTimeout(1200);
  await shot('tiny-in-car');
  const d = await page.evaluate(async () => {
    const g = window.__game;
    const { walk, rampage } = g.bot();
    rampage.exitCar(walk);
    g.cam('cockpit');
    await new Promise((res) => setTimeout(res, 1500));
    return { type: g.dashboard.type, visible: g.dashboard.visible, size: document.getElementById('tSize')?.textContent };
  });
  check('robot first person: a robot display', d.visible && d.type === 'robot', JSON.stringify(d));
  check('... showing its size', d.size === 'SIZE ¼×');
  await shot('robot-dash');
  await page.evaluate(() => window.__game.cam('chase'));
  check('no errors in the page', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  stop();
}
process.exit(failed() ? 1 : 0);

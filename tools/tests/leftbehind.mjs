// Getting into another vehicle leaves the one you came in behind: your own
// plane (or copter) waits where you left it and you can walk back and fly it;
// a parked plane you'd been flying is parked again; changing back gives you
// your own vehicle.
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const stop = await serve();
const { browser, page } = await launch({ width: 800, height: 500 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const sleep = (ms) => page.waitForTimeout(ms);
try {
  await openGame(page, 'city=spartanburg&vehicle=plane&look=lego&mode=free');
  // Plane -> robot -> a car.
  const a = await page.evaluate(async () => {
    const g = window.__game;
    g.start(false);
    g.transform();
    g.finishMorph();
    const { walk, rampage, props } = g.bot();
    const car = props.items.find((x) => x.kind === 'car' && !x.held);
    props.resize(car, 2);
    walk.place(new walk.pos.constructor(car.x + 14, g.world.heightAt(car.x + 14, car.z), car.z), 0, null);
    walk.onGround = true;
    await new Promise((r) => setTimeout(r, 600));
    rampage.enterCar(walk, car);
    const lb = g.leftBehind;
    return { driving: !!rampage.driving, left: lb?.vehicle, near: lb && Math.hypot(lb.x - car.x, lb.z - car.z), shown: !!lb?.model.group.parent };
  });
  check('getting into a car leaves your plane parked beside it', a.driving && a.left === 'plane' && a.near < 40 && a.shown, JSON.stringify(a));
  // Drive off, get out far away, walk back: FLY your plane.
  const b = await page.evaluate(async () => {
    const g = window.__game;
    const { walk, rampage } = g.bot();
    walk.pos.x += 300;
    rampage.exitCar(walk);
    const lb = g.leftBehind;
    walk.place(new walk.pos.constructor(lb.x + 14, g.world.heightAt(lb.x + 14, lb.z), lb.z), 0, null);
    walk.onGround = true;
    await new Promise((r) => setTimeout(r, 2500));
    const btn = document.getElementById('driveBtn');
    const label = btn.hidden ? '(hidden)' : btn.textContent;
    btn.click();
    await new Promise((r) => setTimeout(r, 400));
    return { label, flying: !g.isBot, gone: !g.leftBehind, at: Math.hypot(g.flight.pos.x - lb.x, g.flight.pos.z - lb.z), parked: !!g.plane.parked };
  });
  check('walking back to it offers "FLY your plane"', /FLY/.test(b.label) && /your plane/.test(b.label), b.label);
  check('... and gets you back in it, right there', b.flying && b.gone && b.at < 2 && !b.parked, JSON.stringify(b));
  // Parked plane: take it, then a car: it's parked again, and changing back gives your own plane.
  const c = await page.evaluate(async () => {
    const g = window.__game;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    g.start(false);
    g.transform();
    g.finishMorph();
    const { walk, rampage, props } = g.bot();
    const pp = props.items.find((x) => x.kind === 'plane' && !x.held);
    walk.place(new walk.pos.constructor(pp.x + 12, g.world.heightAt(pp.x + 12, pp.z), pp.z), 0, null);
    walk.onGround = true;
    await sleep(1500);
    document.getElementById('driveBtn').click();
    await sleep(300);
    const tookIt = !!g.plane.parked && pp.held;
    const ownLeft = g.leftBehind?.vehicle;
    g.transform();
    g.finishMorph();
    const car = props.items.find((x) => x.kind === 'car' && !x.held);
    walk.place(new walk.pos.constructor(car.x + 10, g.world.heightAt(car.x + 10, car.z), car.z), 0, null);
    rampage.enterCar(walk, car);
    const parkedAgain = !pp.held && Math.hypot(pp.x - car.x, pp.z - car.z) < 40;
    rampage.exitCar(walk);
    g.transform();
    g.finishMorph();
    return { tookIt, ownLeft, parkedAgain, own: !g.isBot && !g.plane.parked, cleared: !g.leftBehind };
  });
  check('taking a parked plane leaves your own plane where you were', c.tookIt && c.ownLeft === 'plane', JSON.stringify(c));
  check('then getting into a car parks that plane again (anyone can take it)', c.parkedAgain);
  check('... and changing back gives you your own plane, not that one', c.own && c.cleared);
  // The copter is left behind too.
  await openGame(page, 'city=spartanburg&vehicle=heli&look=lego&mode=free');
  const d = await page.evaluate(() => {
    const g = window.__game;
    g.start(false);
    g.transform();
    g.finishMorph();
    const { walk, rampage, props } = g.bot();
    const car = props.items.find((x) => x.kind === 'police' && !x.held);
    walk.place(new walk.pos.constructor(car.x + 10, g.world.heightAt(car.x + 10, car.z), car.z), 0, null);
    rampage.enterCar(walk, car);
    return g.leftBehind?.vehicle;
  });
  check('your copter is left behind too', d === 'heli', d);
  check('no errors in the page', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  stop();
}
process.exit(failed() ? 1 : 0);

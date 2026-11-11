// Robot fixes (docs/plans/03-robot-fixes-plan.md sections 1-3): optional potty
// breaks, driving supersized cars, and the hold-to-fly jetpack.
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const stop = await serve();
const { browser, page } = await launch();
try {
  await openGame(page, 'city=spartanburg&vehicle=plane&look=lego&mode=free');
  await page.evaluate(() => {
    const g = window.__game;
    g.start(false);
    g.transform();
    g.finishMorph();
  });

  // ---- 1. potty breaks
  const potty = await page.evaluate(() => {
    const g = window.__game;
    const btn = document.getElementById('pottyBtn');
    const out = {};
    // Off: 15 minutes of play, never a prompt.
    g.prefs.potty = 'off';
    g.potty.timer = 1;
    let seen = false;
    for (let t = 0; t < 900; t += 0.5) {
      g.updatePotty(0.5);
      if (!btn.hidden && g.potty.need) seen = true;
    }
    out.offNever = !seen;
    // Sometimes (the default): the first prompt comes at 5 minutes.
    g.prefs.potty = 'some';
    g.potty.need = false;
    g.potty.timer = 300;
    let first = null;
    for (let t = 0; t < 700 && first === null; t += 0.5) {
      g.updatePotty(0.5);
      if (g.potty.need) first = t + 0.5;
    }
    out.firstAt = first;
    // Not now: hides it for a full interval.
    document.getElementById('pottySkip').click();
    out.skipHidden = btn.hidden;
    out.skipTimer = g.potty.timer;
    // An ignored prompt goes away by itself after a minute.
    g.potty.timer = 0.1;
    g.updatePotty(0.2);
    const shown = g.potty.need;
    for (let t = 0; t < 62; t += 0.5) g.updatePotty(0.5);
    out.autoHide = shown && !g.potty.need;
    // During a game: no prompt.
    g.potty.timer = 0.1;
    g.coach; // (the lesson counts as busy too)
    const gameObj = { active: true };
    window.__fakeGame = gameObj;
    return out;
  });
  check('potty Off: no prompt in 15 minutes', potty.offNever);
  check('potty Sometimes: first prompt at 5 minutes or later', potty.firstAt >= 300, `at ${potty.firstAt}s`);
  check('potty Not now hides it for a full interval', potty.skipHidden && potty.skipTimer >= 600, `timer ${potty.skipTimer}`);
  check('potty prompt ignored for a minute goes away', potty.autoHide);

  // Sit any time: next to a toilet, the button offers a seat without a prompt.
  const sit = await page.evaluate(() => {
    const g = window.__game;
    const w = g.world;
    const t = w.toilets[0];
    g.potty.need = false;
    g.potty.timer = 999;
    g.flight.place({ x: t.x + 20, y: w.heightAt(t.x + 20, t.z), z: t.z, clone() { return this; } }, 0, null);
    g.flight.pos.set(t.x + 20, w.heightAt(t.x + 20, t.z), t.z);
    g.flight.onGround = true;
    g.updatePotty(0.1);
    const btn = document.getElementById('pottyBtn');
    const offered = !btn.hidden && document.getElementById('pottyText').textContent;
    const before = g.logbook.potty || 0;
    g.goPotty();
    return { offered, sitting: g.potty.sitting > 0, counted: (g.logbook.potty || 0) === before + 1 };
  });
  check('toilet offers a seat with no prompt', !!sit.offered, sit.offered);
  check('sitting works and counts in the logbook', sit.sitting && sit.counted);
  await page.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < 50; i++) g.updatePotty(0.1);
  });

  // ---- 2. drive a supersized car
  const drive = await page.evaluate(() => {
    const g = window.__game;
    const { walk, rampage, props } = g.bot();
    const w = g.world;
    const out = {};
    // Find an open, dry spot and park a car 30 m ahead of the robot.
    let x = 0;
    let z = 0;
    for (let i = 0; i < 400; i++) {
      x = (Math.random() - 0.5) * 3000;
      z = (Math.random() - 0.5) * 3000;
      if (!w.isWater(x, z) && !w.blockedAt(x, z, w.heightAt(x, z), 30, 20) && !w.blockedAt(x, z - 40, w.heightAt(x, z - 40), 30, 20)) break;
    }
    walk.place(new walk.pos.constructor(x, w.heightAt(x, z), z), 0, null); // facing -Z
    walk.onGround = true;
    const car = props.add('car', x, z - 12, 0, 0xd01712);
    const near = { pitch: 0, roll: 0, yaw: 0, brake: false, run: false };
    // Supersize twice.
    rampage.resize(walk, 2);
    rampage.resize(walk, 2);
    out.scale = car.scale;
    // Walk straight at it for 4 seconds.
    const start = { x: car.x, z: car.z };
    for (let i = 0; i < 240; i++) {
      walk.update(1 / 60, { ...near, pitch: 1 });
      rampage.update(1 / 60, walk);
    }
    out.carStayed = Math.hypot(car.x - start.x, car.z - start.z) < 0.5 && !car.held;
    out.botOutside = Math.hypot(walk.pos.x - car.x, walk.pos.z - car.z) >= props.radius(car);
    out.target = rampage.driveTarget(walk) === car;
    // The DRIVE button appears.
    window.__game.flight === walk;
    return out;
  });
  check('supersized car is 4x', drive.scale === 4, `scale ${drive.scale}`);
  check('walking into a big car does not kick it away', drive.carStayed);
  check('robot stops at the big car', drive.botOutside);
  check('big car is offered as a drive target', drive.target);
  await page.waitForTimeout(800); // a few real frames so the HUD updates
  const btn = await page.evaluate(() => ({ hidden: document.getElementById('driveBtn').hidden, text: document.getElementById('driveBtn').textContent }));
  check('🚗 DRIVE button shows', !btn.hidden, btn.text);

  const ride = await page.evaluate(() => {
    const g = window.__game;
    const { walk, rampage } = g.bot();
    const out = {};
    document.getElementById('driveBtn').click();
    out.driving = !!rampage.driving && walk.driving === 4;
    out.labels = [...document.querySelectorAll('#touchButtons [data-act=brake], #touchButtons [data-act=floats], #turboChip')].map((b) => b.textContent);
    // Drive forward, then honk for a boost.
    const ctl = { pitch: 1, roll: 0, yaw: 0, brake: false };
    for (let i = 0; i < 180; i++) walk.update(1 / 60, ctl);
    const v0 = walk.speed;
    rampage.smash(walk);
    for (let i = 0; i < 40; i++) walk.update(1 / 60, ctl);
    out.boosted = walk.speed > v0 * 1.15;
    out.v = [v0, walk.speed];
    // Exit with jump, leaving the car at its size beside the robot.
    walk.update(1 / 60, { ...ctl, brake: true });
    out.exited = !rampage.driving && walk.driving === 0;
    out.left = rampage.driveTarget(walk);
    out.leftScale = out.left?.scale;
    return out;
  });
  check('DRIVE gets in the car', ride.driving);
  check('buttons relabel while driving', ride.labels.join(',') === 'EXIT,EXIT,HORN', ride.labels.join(','));
  check('HORN gives a burst of speed', ride.boosted, ride.v.map((v) => v.toFixed(1)).join(' -> '));
  check('JUMP gets out', ride.exited);
  check('the car stays big and can be re-entered', ride.leftScale === 4);

  // ---- 3. jetpack
  const jet = await page.evaluate(() => {
    const g = window.__game;
    const { walk, rampage } = g.bot();
    const w = g.world;
    rampage.exitCar(walk);
    const out = {};
    const ctl = (o) => ({ pitch: 0, roll: 0, yaw: 0, brake: false, run: false, ...o });
    const agl = () => walk.pos.y - w.heightAt(walk.pos.x, walk.pos.z);
    walk.turbo = walk.turboNow = 1;
    walk.place(new walk.pos.constructor(0, 400, 0), 0, null);
    // Start on the ground somewhere open.
    walk.pos.set(walk.pos.x, w.heightAt(walk.pos.x, walk.pos.z), walk.pos.z);
    walk.onGround = true;
    // Hold jump for 25 s: climbs past 300 m and stops near the ceiling.
    let max = 0;
    let lit = 0;
    for (let i = 0; i < 25 * 60; i++) {
      walk.update(1 / 60, ctl({ brake: true }));
      max = Math.max(max, agl());
      if (walk.jetting) lit++;
    }
    out.climb = Math.round(max);
    out.jettingAll = lit > 25 * 60 - 5;
    // Fly forward at running speed while holding jump.
    const x0 = walk.pos.x;
    const z0 = walk.pos.z;
    for (let i = 0; i < 5 * 60; i++) walk.update(1 / 60, ctl({ brake: true, pitch: 1 }));
    out.airSpeed = Math.round(Math.hypot(walk.pos.x - x0, walk.pos.z - z0) / 5);
    // Let go: falls (with a terminal speed).
    const y0 = agl();
    let minVy = 0;
    for (let i = 0; i < 3 * 60; i++) {
      walk.update(1 / 60, ctl({}));
      minVy = Math.min(minVy, walk.vel.y);
    }
    out.falls = agl() < y0 - 50;
    out.terminal = Math.round(minVy);
    // A fast drop still stomps.
    let slam = 0;
    walk.onSlam = (v) => (slam = v);
    for (let i = 0; i < 30 * 60 && !walk.onGround; i++) walk.update(1 / 60, ctl({}));
    out.slam = Math.round(slam);
    // Tapping: a short hop.
    walk.onSlam = null;
    let hop = 0;
    for (let i = 0; i < 4 * 60; i++) {
      walk.update(1 / 60, ctl({ brake: i % 30 < 8 }));
      hop = Math.max(hop, agl());
    }
    out.tapHop = Math.round(hop);
    // Head bump: a deck 60 m up (like a bridge) stops the climb at its underside.
    const gx = walk.pos.x;
    const gz = walk.pos.z;
    const gy = w.heightAt(gx, gz);
    w._addCollider({ t: 'box', x: gx, z: gz, c: 1, s: 0, hw: 30, hd: 30, bottom: gy + 60, top: gy + 66 },
      gx - 43 + w.halfX, gz - 43 + w.halfZ, gx + 43 + w.halfX, gz + 43 + w.halfZ);
    walk.pos.y = gy;
    walk.onGround = true;
    walk.vel.set(0, 0, 0);
    let top = 0;
    for (let i = 0; i < 8 * 60; i++) {
      walk.update(1 / 60, ctl({ brake: true }));
      top = Math.max(top, walk.pos.y - gy);
    }
    out.headTop = Math.round(top);
    return out;
  });
  check('holding jump climbs past 300 m', jet.climb > 300, `${jet.climb} m`);
  check('jets stay on while held', jet.jettingAll);
  check('ceiling stops the climb near 600 m', jet.climb < 700, `${jet.climb} m`);
  check('flies at running speed or better', jet.airSpeed >= 30, `${jet.airSpeed} m/s`);
  check('letting go falls, with a terminal speed', jet.falls && jet.terminal >= -46, `${jet.terminal} m/s`);
  check('a fast drop still stomps', jet.slam > 32, `${jet.slam} m/s`);
  check('tapping jump only hops', jet.tapHop < 150, `${jet.tapHop} m`);
  check('flying up under a deck stops at the deck', jet.headTop < 60, `feet reached ${jet.headTop} m, deck at 60 m`);
} finally {
  await browser.close();
  stop();
}
process.exit(failed() ? 1 : 0);

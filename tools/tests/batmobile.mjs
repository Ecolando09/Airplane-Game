// Plan 08 part B: the Batmobile. Car, flying car, robot on the transform button.
// The car drives along a road and across a bridge, bounces off a building and
// sinks in water; it takes off as the flying car, becomes the robot, and the
// robot becomes the car again on the ground (the flying car from a jet-jump);
// its dashboard; a friend in a second browser sees each form. Pass a folder to
// save screenshots of the three forms, front and back, day and night.
//
//   npx vite build && node tools/tests/batmobile.mjs [screenshot dir]
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, openGame, check, failed, BASE } from './helpers.mjs';

const OUT = process.argv[2] || '';
if (OUT) mkdirSync(OUT, { recursive: true });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stop = await serve();
const { browser, page } = await launch({ width: 960, height: 600 });
const W = { timeout: 30000, polling: 300 };

/** Fixed camera on you from the front (side 1) or the back (-1). */
async function photo(name, side, p = page) {
  if (!OUT) return;
  await p.evaluate((side) => {
    const g = window.__game;
    const f = g.flight;
    const T = f.pos.constructor;
    const fw = f.forward.clone().setY(0).normalize();
    const rt = new T(-fw.z, 0, fw.x);
    const bot = g.isBot;
    const c = f.pos.clone().add(new T(0, bot ? 6.8 : 0.6, 0));
    const d = bot ? 23 : 13;
    g.photo = { pos: c.clone().addScaledVector(fw, side * d).addScaledVector(rt, side * -d * 0.45).add(new T(0, bot ? 2.5 : 3.2, 0)), target: c };
  }, side);
  await p.waitForTimeout(2600);
  await p.screenshot({ path: `${OUT}/${name}.png` });
  await p.evaluate(() => (window.__game.photo = null));
}
/** Step the simulation (what moves you) for t seconds with these controls. */
const drive = (t, ctl) => page.evaluate(({ t, ctl }) => {
  const g = window.__game;
  for (let s = 0; s < t; s += 1 / 60) g.step(1 / 60, { pitch: 0, roll: 0, yaw: 0, brake: false, throttle: 0, ...ctl });
  const f = g.flight;
  return { speed: f.speed, mph: f.speed * 2.237, x: f.pos.x, y: f.pos.y, z: f.pos.z, car: !!f.isCar, ground: f.onGround, crashed: f.crashed, why: f.crashReason, bounced: !!f.bounced };
}, { t, ctl });

try {
  await page.goto(BASE);
  await page.evaluate(() => localStorage.setItem('legosky.prefs', JSON.stringify({ low: false })));
  await openGame(page, 'city=stlouis&vehicle=bat&look=lego&mode=free');
  const menu = await page.evaluate(() => ({
    card: !!document.querySelector('#segVehicle [data-v=bat]'), on: document.querySelector('#segVehicle [data-v=bat]')?.classList.contains('on'),
    cards: document.querySelectorAll('#segVehicle button').length, room: !!document.querySelector('#rgVehicle option[value=bat]'),
  }));
  check('the menu offers the Batmobile (among the vehicle cards)', menu.card && menu.on && menu.cards >= 4, JSON.stringify(menu));
  check('room games can pick the Batmobile', menu.room);

  // ---- car form: starts as the car at the runway, drives fast along it.
  const s0 = await page.evaluate(() => {
    const g = window.__game;
    g.start(false);
    return { car: !!g.flight.isCar, bat: !!g.plane.batmobile, chip: document.getElementById('botChip').textContent, x: g.flight.pos.x, z: g.flight.pos.z };
  });
  check('it starts as a car', s0.car && s0.bat, JSON.stringify(s0));
  check('the transform button names the next form (Fly)', s0.chip === '🛫', s0.chip);
  await photo('bat-car-front', 1);
  await photo('bat-car-back', -1);
  const r1 = await drive(4, { pitch: 1 });
  check('the gas pedal (stick forward) drives it off', r1.car && r1.speed > 25 && Math.hypot(r1.x - s0.x, r1.z - s0.z) > 50, `${r1.mph.toFixed(0)} mph`);
  const r2 = await drive(1.5, { brake: true });
  check('the handbrake stops it', r2.speed < r1.speed - 25, `${r2.mph.toFixed(0)} mph`);
  const top = await page.evaluate(() => {
    const g = window.__game;
    g.start(false);
    let max = 0;
    for (let s = 0; s < 14; s += 1 / 60) {
      g.step(1 / 60, { pitch: 1, roll: 0, yaw: 0, brake: false });
      g.flight.pos.set(g.flight.pos.x, g.flight.pos.y, g.flight.pos.z); // (stays on the runway long enough)
      max = Math.max(max, g.flight.speed);
      if (g.flight.bounced) break;
    }
    return max * 2.237;
  });
  check('top speed on the road is about 160 mph', top > 140 && top < 175, `${top.toFixed(0)} mph`);
  const steer = await page.evaluate(() => {
    const g = window.__game;
    g.start(false);
    const h0 = g.flight.heading;
    for (let s = 0; s < 3; s += 1 / 60) g.step(1 / 60, { pitch: 0.5, roll: 1, yaw: 0, brake: false });
    return ((g.flight.heading - h0 + 540) % 360) - 180;
  });
  check('right on the stick steers right', steer > 20, `${steer.toFixed(0)}°`);

  // ---- across a bridge (stays on the deck, never in the river).
  const br = await page.evaluate(() => {
    const g = window.__game;
    const w = g.world;
    const b = w.bridges.list.reduce((a, c) => (c.pts.length > a.pts.length ? c : a));
    g.start(false);
    const f = g.flight;
    const [x0, z0] = b.pts[0];
    const [x1, z1] = b.pts[1];
    f.place(new f.pos.constructor(x0, w.deckAt(x0, z0) ?? w.groundAt(x0, z0), z0), Math.atan2(-(x1 - x0), -(z1 - z0)), 10);
    let minClear = Infinity;
    let steps = 0;
    const end = b.pts[b.pts.length - 1];
    for (; steps < 60 * 60 && !f.crashed; steps++) {
      const p = f.pos;
      let k = 0;
      let best = Infinity;
      b.pts.forEach((q, i) => { const d = Math.hypot(q[0] - p.x, q[1] - p.z); if (d < best) { best = d; k = i; } });
      const tgt = b.pts[Math.min(b.pts.length - 1, k + 2)];
      const want = Math.atan2(-(tgt[0] - p.x), -(tgt[1] - p.z));
      const dy = ((want - f.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      g.step(1 / 60, { pitch: 0.35, roll: -Math.max(-1, Math.min(1, dy * 3)), yaw: 0, brake: false });
      if (k > b.pts.length / 3 && k < (b.pts.length * 2) / 3) minClear = Math.min(minClear, p.y - f.plane.gearHeight - b.water); // over the middle of the river
      if (Math.hypot(end[0] - p.x, end[1] - p.z) < 12) break;
    }
    return { len: (b.pts.length - 1) * 8, made: Math.hypot(end[0] - f.pos.x, end[1] - f.pos.z) < 15, crashed: f.crashed, why: f.crashReason, clear: +minClear.toFixed(1), s: steps / 60 };
  });
  check('it drives across a bridge on the deck', br.made && !br.crashed && br.clear > 2, JSON.stringify(br));

  // ---- a building: it bounces off and the building stays up.
  const bd = await page.evaluate(() => {
    const g = window.__game;
    const w = g.world;
    g.start(false);
    const f = g.flight;
    let c = null;
    for (const list of w.colliders.values()) {
      c = list.find((k) => k.t === 'poly' && k.h > 15 && k.maxx - k.minx > 20 && k.maxz - k.minz > 20 && !k.dead);
      if (c) break;
    }
    // 60 m to its west, facing east, on open ground.
    const T = f.pos.constructor;
    let x = c.minx - 60;
    const z = c.z;
    f.place(new T(x, w.groundAt(x, z), z), -Math.PI / 2, 30);
    let bounced = false;
    for (let s = 0; s < 6 && !f.crashed; s += 1 / 60) {
      g.step(1 / 60, { pitch: 1, roll: 0, yaw: 0, brake: false });
      if (f.bounced) bounced = true;
    }
    return { bounced, standing: !c.dead, inside: w.inFootprint(c, f.pos.x, f.pos.z, 0), crashed: f.crashed, along: f.along };
  });
  check('it bounces off a building, which stays standing', bd.bounced && bd.standing && !bd.inside && !bd.crashed, JSON.stringify(bd));

  // ---- water: it sinks, with its own message on the crash screen.
  const wet = await page.evaluate(async () => {
    const g = window.__game;
    const w = g.world;
    g.start(false);
    const f = g.flight;
    const T = f.pos.constructor;
    // Find water near the river's edge: a land point with water 40 m east.
    let at = null;
    for (let i = 0; i < 4000 && !at; i++) {
      const x = (Math.random() - 0.5) * w.halfX * 1.6;
      const z = (Math.random() - 0.5) * w.halfZ * 1.6;
      if (!w.isWater(x, z) && w.isWater(x + 40, z) && w.isWater(x + 80, z) && w.deckAt(x + 40, z) == null) at = { x, z };
    }
    f.place(new T(at.x, w.groundAt(at.x, at.z), at.z), -Math.PI / 2, 20);
    for (let s = 0; s < 5 && !f.crashed; s += 1 / 60) g.step(1 / 60, { pitch: 1, roll: 0, yaw: 0, brake: false });
    if (f.crashed) {
      // what the game loop does on a crash
      document.getElementById('crashBox').hidden = true;
    }
    return { crashed: f.crashed, why: f.crashReason };
  });
  check('it sinks in water: "the Batmobile can\'t swim"', wet.crashed && /can't swim/.test(wet.why), wet.why);
  // The float button does nothing to the car (no floats).
  const fl = await page.evaluate(() => {
    const g = window.__game;
    g.start(false);
    g.input.emit('floats');
    return { floats: !!g.flight.floats, msg: document.getElementById('message').textContent };
  });
  check('the float button gives no floats', !fl.floats, fl.msg);

  // ---- car -> flying car (takes off) -> robot -> car.
  const fly = await page.evaluate(async () => {
    const g = window.__game;
    g.start(false);
    g.transform();
    // The wings swing out over half a second of game time (the test browser draws about a frame a second).
    for (let i = 0; i < 40 && g.plane.flightForm < 0.99; i++) await new Promise((res) => setTimeout(res, 500));
    return { car: !!g.flight.isCar, bot: g.isBot, form: g.plane.flightForm, chip: document.getElementById('botChip').textContent };
  });
  check('transform makes the car a flying car (wings out)', !fly.car && !fly.bot && fly.form > 0.9, JSON.stringify(fly));
  check('... and the button now says Robot', fly.chip === '🤖', fly.chip);
  await photo('bat-fly-front', 1);
  await photo('bat-fly-back', -1);
  const air = await page.evaluate(() => {
    const g = window.__game;
    const f = g.flight;
    const y0 = f.pos.y;
    for (let s = 0; s < 14; s += 1 / 60) g.step(1 / 60, { pitch: s > 7 ? 0.6 : 0, roll: 0, yaw: 0, brake: false, throttleSet: 1, throttle: 0 });
    return { up: f.pos.y - y0, ground: f.onGround, crashed: f.crashed, mph: f.speed * 2.237 };
  });
  check('the flying car takes off from the runway', !air.ground && !air.crashed && air.up > 30, JSON.stringify(air));
  await page.evaluate(() => { window.__game.cam('cockpit'); });
  await page.waitForTimeout(1200);
  const dashF = await page.evaluate(() => ({ type: window.__game.dashboard.type, on: window.__game.dashboard.visible, mode: document.querySelector('#dash #tMode')?.textContent }));
  check('first person in the flying car: its own dashboard, FORM: FLIGHT', dashF.type === 'bat' && dashF.on && dashF.mode === 'FLIGHT', JSON.stringify(dashF));
  if (OUT) await page.screenshot({ path: `${OUT}/bat-dash-flight.png` });
  const barrel = await page.evaluate(() => {
    const g = window.__game;
    g.cam('chase');
    const f = g.flight;
    for (let s = 0; s < 6; s += 1 / 60) g.step(1 / 60, { pitch: 0.4, roll: 0, yaw: 0, brake: false, throttleSet: 1 });
    return f.barrelRoll(1);
  });
  check('the flying car barrel-rolls', barrel);
  const bot = await page.evaluate(() => {
    const g = window.__game;
    g.transform();
    g.finishMorph();
    return { bot: g.isBot, kind: g.bot().walk.plane.robotKind, chip: document.getElementById('botChip').textContent };
  });
  check('then a robot (the Batmobile robot)', bot.bot && bot.kind === 'bat', JSON.stringify(bot));
  // From a jet-jump in the air: the flying car, never a car.
  const jump = await page.evaluate(() => {
    const g = window.__game;
    const w = g.bot().walk;
    w.onGround = false;
    w.pos.y += 40;
    g.transform();
    g.finishMorph();
    return { bot: g.isBot, car: !!g.flight.isCar, ground: g.flight.onGround };
  });
  check('a robot changing in the air becomes the flying car', !jump.bot && !jump.car && !jump.ground, JSON.stringify(jump));
  // Robot standing on the ground: the car.
  const back = await page.evaluate(async () => {
    const g = window.__game;
    g.start(false);
    g.transform(); // fly
    g.transform(); // robot
    g.finishMorph();
    const w = g.bot().walk;
    w.onGround = true;
    await new Promise((res) => setTimeout(res, 2500)); // a frame or two: the button updates
    const chip = document.getElementById('botChip').textContent;
    g.transform();
    g.finishMorph();
    return { bot: g.isBot, car: !!g.flight.isCar, chip };
  });
  check('a robot standing on the ground changes back into the car', !back.bot && back.car && back.chip === '🚗', JSON.stringify(back));
  await page.evaluate(() => window.__game.cam('cockpit'));
  await page.waitForTimeout(1200);
  const dashC = await page.evaluate(() => ({ type: window.__game.dashboard.type, on: window.__game.dashboard.visible, mode: document.querySelector('#dash #tMode')?.textContent }));
  check('first person in the car: its own dashboard, FORM: CAR', dashC.type === 'bat' && dashC.on && dashC.mode === 'CAR', JSON.stringify(dashC));
  if (OUT) await page.screenshot({ path: `${OUT}/bat-dash-car.png` });
  await page.evaluate(() => window.__game.cam('chase'));
  // "Start in the air" is the flying car.
  const airStart = await page.evaluate(() => {
    const g = window.__game;
    g.start(true);
    return { car: !!g.flight.isCar, ground: g.flight.onGround };
  });
  check('"Start in the air" starts as the flying car', !airStart.car && !airStart.ground, JSON.stringify(airStart));

  // ---- the robot, for the owner (front and back), and night shots of all three forms.
  if (OUT) {
    await page.evaluate(() => { const g = window.__game; g.start(false); g.transform(); g.transform(); g.finishMorph(); });
    await photo('robot-bat-classic-front', 1);
    await photo('robot-bat-classic-back', -1);
    await page.evaluate(() => { const g = window.__game; g.prefs.sky = 'night'; g.applySky(); g.start(false); });
    await photo('bat-car-night', 1);
    await page.evaluate(() => window.__game.transform());
    await page.waitForFunction(() => window.__game.plane.flightForm > 0.99, null, { timeout: 30000, polling: 500 });
    await photo('bat-fly-night', -1);
    await page.evaluate(() => { const g = window.__game; g.transform(); g.finishMorph(); });
    await photo('robot-bat-night', 1);
    await page.evaluate(() => { const g = window.__game; g.prefs.sky = 'day'; g.applySky(); });
  }
  // Paint: the yellow takes the paint job (car and robot).
  await page.evaluate(() => localStorage.setItem('legosky.prefs', JSON.stringify({ low: false, paint: 'redorange' })));
  await openGame(page, 'city=stlouis&vehicle=bat&look=lego&mode=free');
  const pt = await page.evaluate(() => {
    const g = window.__game;
    g.start(false);
    let car = 0;
    g.plane.group.traverse((o) => o.material?.color?.getHex?.() === 0xff5a1f && car++);
    g.transform(); g.transform(); g.finishMorph();
    let rb = 0;
    g.bot().walk.plane.group.traverse((o) => o.material?.color?.getHex?.() === 0xff5a1f && rb++);
    return { car, rb };
  });
  check('a paint job recolours the Batmobile\'s yellow (car and robot)', pt.car > 3 && pt.rb > 3, JSON.stringify(pt));
  if (OUT) await photo('robot-bat-redorange-front', 1);
} finally {
  await browser.close();
}

// ---- a friend in a second browser sees each form.
const relay = spawn('node', ['server/relay.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, STATE_DIR: mkdtempSync(path.join(tmpdir(), 'relay-')) } });
const { browser: b1, page: a } = await launch({ width: 800, height: 520 });
const { browser: b2, page: b } = await launch({ width: 800, height: 520 });
try {
  await a.addInitScript(() => { localStorage.setItem('legosky.name', 'Alice'); localStorage.setItem('legosky.prefs', JSON.stringify({ low: true })); });
  await b.addInitScript(() => { localStorage.setItem('legosky.name', 'Bob'); localStorage.setItem('legosky.prefs', JSON.stringify({ low: true })); });
  await openGame(a, 'city=carbondale&vehicle=bat&look=lego&room=BATS');
  await openGame(b, 'city=carbondale&vehicle=plane&look=lego&room=BATS');
  for (const p of [a, b]) await p.waitForFunction(() => window.__game.mp.status === 'on', null, W);
  for (const p of [a, b]) await p.evaluate(() => window.__game.start(false));
  const seen = (fn) => b.waitForFunction(fn, null, W).then(() => true, () => false);
  check('a friend sees your Batmobile as a car', await seen(() => { const pl = [...window.__game.mp.players.values()][0]; return pl?.vehicle === 'bat' && pl.model?.batmobile && pl.form === 'car' && pl.model.flightForm === 0; }));
  const shotFriend = async (name) => {
    if (!OUT) return;
    await b.evaluate(() => {
      const g = window.__game;
      const pl = [...g.mp.players.values()][0];
      const T = pl.pos.constructor;
      const up = pl.bot ? 6 : 1;
      g.photo = { pos: pl.pos.clone().add(new T(-14, up + 6, -18)), target: pl.pos.clone().add(new T(0, up, 0)) };
    });
    await b.waitForTimeout(3000);
    await b.screenshot({ path: `${OUT}/${name}.png` });
    await b.evaluate(() => (window.__game.photo = null));
  };
  await shotFriend('friend-sees-bat-car');
  await a.evaluate(() => window.__game.transform());
  check('... then as the flying car', await seen(() => { const pl = [...window.__game.mp.players.values()][0]; return pl?.form === 'fly' && pl.model?.flightForm === 1; }));
  await shotFriend('friend-sees-bat-fly');
  await a.evaluate(() => { const g = window.__game; g.transform(); g.finishMorph(); });
  check('... then as the Batmobile robot', await seen(() => { const pl = [...window.__game.mp.players.values()][0]; return pl?.bot && pl.model?.robotKind === 'bat'; }));
  await shotFriend('friend-sees-bat-robot');
} finally {
  await b1.close();
  await b2.close();
  relay.kill();
  stop();
}
console.log(failed() ? `${failed()} FAILED` : 'ALL PASSED');
process.exit(failed() ? 1 : 0);

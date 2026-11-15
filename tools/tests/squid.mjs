// The giant squid (plan 07). Steps the simulation directly (the test browser
// draws about one frame a second). Run parts by name, or everything:
//
//   npx vite build && node tools/tests/squid.mjs [spots] [attack] [struggle] [fight] [melon] [hunt] [OUT=dir]
//
// The multiplayer checks (two browsers, the relay) are in squidroom.mjs.
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const args = process.argv.slice(2);
const OUT = (args.find((a) => a.startsWith('OUT=')) || '').slice(4) || null;
const parts = args.filter((a) => !a.startsWith('OUT='));
const want = (p) => !parts.length || parts.includes(p);
const CITIES = ['spartanburg', 'fortcollins', 'carbondale', 'denver', 'stlouis', 'sanfrancisco', 'hongkong', 'tokyo', 'singapore'];

const stop = await serve();
const { browser, page } = await launch({ width: 1000, height: 640 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// Shared page helpers, installed once per page load.
const HELPERS = () => {
  const g = window.__game;
  window.__sq = {
    g,
    still: { pitch: 0, roll: 0, yaw: 0, throttle: 0 },
    /** Step `secs` of simulation with controls `ctl` (or a function of the step number). */
    run(secs, ctl = window.__sq.still, dt = 1 / 30) {
      for (let i = 0; i < secs / dt; i++) g.simStep(dt, typeof ctl === 'function' ? ctl(i) : ctl);
    },
    sq: (i = 0) => g.squid.squids[i],
    phase: (i = 0) => g.squid.squids[i].s.phase,
    /** Put the aircraft at (dx, dz) from squid i, `alt` metres above the water, flying toward it. */
    placeAir(i, dist, alt, speed = 50) {
      const sp = g.squid.squids[i].spot;
      const f = g.flight;
      const T = f.pos.constructor;
      f.pos.set(sp.x - dist, sp.y + alt, sp.z);
      f.onGround = false;
      f.crashed = false;
      f.barrel = null;
      if (f.canStall === false) {
        f.yaw = -Math.PI / 2; // copter / hover: nose east
        f._updateQuat?.();
      } else f.quat.setFromAxisAngle(new T(0, 1, 0), -Math.PI / 2);
      f.speed = speed;
      f.throttle = 0.7;
      f.vel?.set(speed, 0, 0);
    },
    /** The robot (size s) standing in the water `dist` west of squid i, facing it. */
    robotAt(i, dist, s = 1) {
      if (!g.isBot) {
        g.transform();
        g.finishMorph();
      }
      const sp = g.squid.squids[i].spot;
      const f = g.flight;
      f.setSize(s);
      f.place(new f.pos.constructor(sp.x - dist, sp.y, sp.z), -Math.PI / 2, null);
      f.onGround = true;
    },
    /** Run until the squid holds us (or `max` seconds). Returns the seconds it took, or -1. */
    untilHeld(max = 6, ctl) {
      for (let t = 0; t < max; t += 1 / 30) {
        g.simStep(1 / 30, ctl || window.__sq.still);
        if (g.squid.holding) return t;
      }
      return -1;
    },
    /** Phases seen while running. */
    watch(secs, ctl, i = 0) {
      const seen = new Set();
      for (let t = 0; t < secs; t += 1 / 30) {
        g.simStep(1 / 30, typeof ctl === 'function' ? ctl(t) : ctl || window.__sq.still);
        seen.add(g.squid.squids[i].s.phase);
      }
      return [...seen];
    },
    reset() {
      for (const s of g.squid.squids) s.s = { ...s.s, phase: 'asleep', t: 0, until: 0, target: null, near: {}, health: s.s.maxHealth, hitBy: [] };
      g.squid._release(false);
    },
  };
};

async function open(city, vehicle = 'plane') {
  await openGame(page, `city=${city}&vehicle=${vehicle}&look=lego&mode=free`);
  await page.evaluate(HELPERS);
}

try {
  // ---------------------------------------------------------------- 1. spots
  if (want('spots')) {
    const all = {};
    for (const city of CITIES) {
      await open(city);
      const r = await page.evaluate(() => ({ spots: window.__game.squid.spots.map((s) => [Math.round(s.x), Math.round(s.z), s.deep]), area: window.__game.squid.deepArea }));
      all[city] = r;
      console.log(`  ${city}: ${r.spots.length} squid${r.spots.length === 1 ? '' : 's'} ${JSON.stringify(r.spots)} (deep water ${r.area} km²)`);
    }
    check('spots chosen in the cities with deep water (SF, Hong Kong, St. Louis at least)', ['sanfrancisco', 'hongkong', 'stlouis'].every((c) => all[c].spots.length > 0));
    const BIG = ['sanfrancisco', 'hongkong', 'tokyo', 'singapore'];
    check('big cities get up to three, the rest one', Object.entries(all).every(([c, r]) => r.spots.length <= (BIG.includes(c) ? 3 : 1)));
    // Same spots on a second load (fixed seed).
    await open('sanfrancisco');
    const again = await page.evaluate(() => window.__game.squid.spots.map((s) => [Math.round(s.x), Math.round(s.z), s.deep]));
    check('two page loads give the same spots', JSON.stringify(again) === JSON.stringify(all.sanfrancisco.spots), JSON.stringify(again));
    const rules = await page.evaluate(() => {
      const g = window.__game;
      const w = g.world;
      const sp = g.squid.spots;
      const rw = w.runway;
      const back = rw.length / 2 - 70;
      const start = { x: rw.x - rw.fx * back, z: rw.z - rw.fz * back };
      return {
        water: sp.every((s) => w.isWater(s.x, s.z)),
        far: sp.every((s) => Math.hypot(s.x - start.x, s.z - start.z) > 800),
        apart: sp.every((a, i) => sp.every((b, j) => i === j || Math.hypot(a.x - b.x, a.z - b.z) >= 1500)),
        deck: sp.every((s) => w.deckAt(s.x, s.z) == null),
      };
    });
    check('spots are on water, 1.5 km apart, far from the runway, off bridges', rules.water && rules.far && rules.apart && rules.deck, JSON.stringify(rules));
    if (OUT) {
      for (const night of [false, true]) {
        await page.evaluate((night) => {
          const g = window.__game;
          g.start(true);
          const sp = g.squid.spots[0];
          const f = g.flight;
          f.pos.set(sp.x - 140, sp.y + 70, sp.z + 40);
          f.speed = 0;
          g.prefs.sky = night ? 'night' : 'day';
          g.applySky();
          // Awake (aware): the shadow and the ripples, bubbles rising.
          g.squid.squids[0].s = { ...g.squid.squids[0].s, phase: 'aware', t: g.squid.now(), quiet: g.squid.now() + 999 };
          g.photo = { pos: new f.pos.constructor(sp.x - 90, sp.y + 45, sp.z + 60), target: new f.pos.constructor(sp.x, sp.y, sp.z) };
        }, night);
        await page.waitForTimeout(2500);
        await page.screenshot({ path: `${OUT}/squid-spot-${night ? 'night' : 'day'}.png` });
      }
      await page.evaluate(() => {
        delete window.__game.photo;
        window.__game.prefs.sky = 'day';
        window.__game.applySky();
      });
    }
  }
  // ---------------------------------------------------------------- 2. the attack on a plane
  if (want('attack')) {
    await open('sanfrancisco');
    const r = await page.evaluate(() => {
      const S = window.__sq;
      const g = S.g;
      g.start(true);
      S.reset();
      const cruise = { pitch: 0, roll: 0, yaw: 0, throttle: 0, throttleSet: 0.7 };
      const out = {};
      // High pass: 100 m above the water, straight over it.
      S.placeAir(0, 400, 100);
      out.high = S.watch(14, cruise);
      out.highCrashed = g.flight.crashed;
      // Low pass: 20 m up, straight at it, no escape.
      S.reset();
      S.placeAir(0, 300, 20);
      out.low = S.watch(12, cruise);
      out.reason = g.flight.crashReason;
      out.crashBox = !document.getElementById('crashBox').hidden;
      // Respawn: back in the air close by. The squid is resting and doesn't grab again.
      g.respawnHere();
      out.afterRespawn = S.phase();
      S.placeAir(0, 300, 20);
      out.again = S.watch(10, cruise);
      out.againCrashed = g.flight.crashed;
      out.restLeft = Math.round(S.sq().s.until - g.squid.now());
      // A pass at 50 m: it winds up and strikes, but the tentacle can't reach that high.
      S.reset();
      S.placeAir(0, 300, 50);
      out.mid = S.watch(10, cruise);
      out.midCrashed = g.flight.crashed;
      return out;
    });
    console.log('  ', JSON.stringify(r));
    check('a pass 100 m above the water is ignored', r.high.length === 1 && r.high[0] === 'asleep' && !r.highCrashed, r.high.join(','));
    check('a low pass: wake, wind-up, strike, hold, pulled under', ['aware', 'windup', 'strike', 'hold', 'drag'].every((p) => r.low.includes(p)), r.low.join(','));
    check('... ends in the squid crash and the crash screen', /giant squid/.test(r.reason) && r.crashBox, r.reason);
    check('after a respawn the squid is resting and does not grab again at once', ['drag', 'rest'].includes(r.afterRespawn) && !r.againCrashed && !r.again.includes('hold'), `${r.again.join(',')} (rest ${r.restLeft} s left)`);
    check('flying at 50 m: it strikes and misses', r.mid.includes('strike') && !r.mid.includes('hold') && !r.midCrashed, r.mid.join(','));
  }

  // ---------------------------------------------------------------- 3. the struggle, every vehicle
  if (want('struggle')) {
    await open('sanfrancisco');
    const r = await page.evaluate(() => {
      const S = window.__sq;
      const g = S.g;
      g.start(true);
      const out = {};
      const plane = (name, ctl, during) => {
        S.reset();
        g.start(true);
        S.placeAir(0, 200, 20);
        const t = S.untilHeld(8, { pitch: 0, roll: 0, yaw: 0, throttle: 0, throttleSet: 0.7 });
        during?.();
        S.run(6, ctl);
        out[name] = { held: t >= 0, crashed: g.flight.crashed, phase: S.phase() };
      };
      // Plane: full throttle fills slowly, turbo fast, a barrel roll at once; nothing: pulled under.
      plane('planeNothing', { pitch: 0, roll: 0, yaw: 0, throttle: 0, throttleSet: 0.7 });
      plane('planeFull', { pitch: 0, roll: 0, yaw: 0, throttle: 0, throttleSet: 1 });
      plane('planeTurbo', { pitch: 0, roll: 0, yaw: 0, throttle: 0, throttleSet: 1 }, () => (g.flight.turbo = 3));
      g.flight.turbo = 1;
      plane('planeRoll', { pitch: 0, roll: 0, yaw: 0, throttle: 0, throttleSet: 0.7 }, () => {
        g.rollTap(1);
        g.rollTap(1);
      });
      // Boat: mash the horn boost; or don't.
      const boat = (name, presses) => {
        S.reset();
        g.start(true);
        S.robotAt(0, 120, 1);
        const sp = S.sq().spot;
        const it = g.bot().props.add('boat', sp.x - 45, sp.z, -Math.PI / 2);
        g.bot().props.resize(it, 2);
        g.bot().rampage.enterCar(g.flight, it);
        const t = S.untilHeld(8);
        for (let k = 0; k < presses; k++) {
          g.botSmash();
          S.run(0.15);
        }
        S.run(5);
        const p = g.flight.pos;
        out[name] = { held: t >= 0, driving: !!g.bot().rampage.driving, phase: S.phase(), onShore: !g.world.isWater(p.x, p.z), kind: it.kind };
      };
      boat('boatMash', 10);
      boat('boatNothing', 0);
      // Robot: SMASH punches the tentacle: 1x needs three, 2x two, 4x one; 1/2x can't.
      const robot = (name, size, punches) => {
        S.reset();
        g.start(true);
        g.bot().rampage.release(g.flight);
        S.robotAt(0, 35, size);
        const t = S.untilHeld(8);
        for (let k = 0; k < punches; k++) {
          g.botSmash();
          S.run(0.3);
        }
        S.run(5);
        const p = g.flight.pos;
        out[name] = { held: t >= 0, phase: S.phase(), onShore: !g.world.isWater(p.x, p.z), free: !g.squid.holding };
      };
      robot('bot1x3', 1, 3);
      robot('bot1x2', 1, 2);
      robot('bot2x2', 2, 2);
      robot('bot2x1', 2, 1);
      robot('bot4x1', 4, 1);
      robot('botHalf', 0.5, 6);
      return out;
    });
    for (const [k, v] of Object.entries(r)) console.log(`   ${k}: ${JSON.stringify(v)}`);
    const freed = (x) => x.held && x.phase !== 'drag' && !x.crashed && ['recover', 'sink', 'rest'].includes(x.phase) && x.onShore !== true;
    check('plane, no escape: pulled under (crash)', r.planeNothing.held && r.planeNothing.crashed);
    check('plane, full throttle: pulls free (slowly)', freed(r.planeFull), JSON.stringify(r.planeFull));
    check('plane, turbo: pulls free', freed(r.planeTurbo), JSON.stringify(r.planeTurbo));
    check('plane, barrel roll: snaps the tentacle', freed(r.planeRoll), JSON.stringify(r.planeRoll));
    check('boat, horn mashed: breaks free and keeps the boat', freed(r.boatMash) && r.boatMash.driving, JSON.stringify(r.boatMash));
    check('boat, nothing: capsized, robot thrown out on the shore', r.boatNothing.held && !r.boatNothing.driving && r.boatNothing.onShore, JSON.stringify(r.boatNothing));
    check('robot 1x: three punches free it', freed(r.bot1x3), JSON.stringify(r.bot1x3));
    check('robot 1x: two punches are not enough (dunked, spat out ashore)', r.bot1x2.held && r.bot1x2.onShore, JSON.stringify(r.bot1x2));
    check('robot 2x: two punches free it, one does not', freed(r.bot2x2) && r.bot2x1.onShore, `${JSON.stringify(r.bot2x2)} ${JSON.stringify(r.bot2x1)}`);
    check('robot 4x: one punch frees it', freed(r.bot4x1), JSON.stringify(r.bot4x1));
    check('robot 1/2x: punches cannot free it (dunked)', r.botHalf.held && r.botHalf.onShore, JSON.stringify(r.botHalf));

    // Copter (and the shuttle in hover mode): hold lift up.
    for (const v of ['heli', 'jet']) {
      await open('sanfrancisco', v);
      const h = await page.evaluate((v) => {
        const S = window.__sq;
        const g = S.g;
        const out = {};
        const run = (name, lift) => {
          S.reset();
          g.start(true);
          if (v === 'jet') {
            dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB' }));
            dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyB' }));
          }
          S.placeAir(0, 150, 20, 30);
          const t = S.untilHeld(8, { pitch: 0, roll: 0, yaw: 0, throttle: 0, throttleSet: 0.8, liftSet: 0 });
          S.run(6, { pitch: 0, roll: 0, yaw: 0, throttle: 0, liftSet: lift });
          out[name] = { held: t >= 0, crashed: g.flight.crashed, phase: S.phase(), hover: g.flight.canStall === false };
        };
        run('lift', 1);
        run('nothing', 0);
        return out;
      }, v);
      console.log(`   ${v}: ${JSON.stringify(h)}`);
      const name = v === 'heli' ? 'copter' : 'shuttle (hover)';
      check(`${name}, lift held up: pulls free`, h.lift.held && !h.lift.crashed && h.lift.hover, JSON.stringify(h.lift));
      check(`${name}, nothing: pulled under`, h.nothing.held && h.nothing.crashed, JSON.stringify(h.nothing));
    }
  }

  // ---------------------------------------------------------------- 4. fighting and feeding
  if (want('fight')) {
    await open('sanfrancisco');
    const r = await page.evaluate(() => {
      const S = window.__sq;
      const g = S.g;
      g.start(true);
      S.reset();
      g.logbook.squid = 0;
      const out = {};
      // A 2x robot right beside it: three punches before it can strike.
      S.robotAt(0, 13, 2);
      S.run(0.2);
      out.woke = S.phase();
      for (let k = 0; k < 3; k++) {
        g.botSmash();
        S.run(0.3);
        out[`hp${k}`] = S.sq().s.health;
      }
      out.after = S.phase();
      S.run(4);
      out.later = S.phase();
      out.restLeft = Math.round(S.sq().s.until - g.squid.now());
      out.logbook = g.logbook.squid;
      out.held = g.squid.holding;
      // Feeding: a car thrown in the water beside an awake squid is taken instead of you.
      S.reset();
      g.start(true);
      S.robotAt(0, 140, 1);
      const sp = S.sq().spot;
      g.bot().props.add('car', sp.x - 134, sp.z, 0);
      S.run(0.5);
      out.feedWoke = S.phase();
      g.botGrab();
      out.holdingCar = !!g.bot().rampage.held;
      g.botGrab(); // throw
      S.run(3);
      out.fedPhase = S.phase();
      out.fedHealth = S.sq().s.health;
      // Walk right up to it: it's busy eating (then resting), no grab.
      g.flight.place(new g.flight.pos.constructor(sp.x - 30, sp.y, sp.z), -Math.PI / 2, null);
      out.afterFeed = S.watch(15);
      out.grabbedAfterFeed = g.squid.holding;
      return out;
    });
    console.log('  ', JSON.stringify(r));
    check('a 2x robot: each punch hurts it (2 of 6 health)', r.hp0 === 4 && r.hp1 === 2, [r.hp0, r.hp1, r.hp2].join(', '));
    check('three punches from a 2x robot make it flee', r.after === 'flee' || r.later === 'rest', [r.after, r.later, r.restLeft].join(' / '));
    check('beaten, it rests three minutes', r.restLeft > 170, String(r.restLeft));
    check('the logbook counts it', r.logbook === 1, String(r.logbook));
    check('a car thrown in the water is taken instead of the player', r.holdingCar && (r.fedPhase === 'eat' || r.fedPhase === 'rest') && !r.grabbedAfterFeed && !r.afterFeed.includes('hold'), [r.feedWoke, r.fedPhase, r.afterFeed.join(',')].join(' / '));
  }
  // ---------------------------------------------------------------- 6. watermelons and the prize
  if (want('melon')) {
    await open('sanfrancisco');
    const r = await page.evaluate(() => {
      const S = window.__sq;
      const g = S.g;
      const out = {};
      const cruise = { pitch: 0, roll: 0, yaw: 0, throttle: 0, throttleSet: 0.7 };
      // From a plane flying at it, 60 m up (above its reach): lobbed 112 m out, it lands on the squid.
      g.start(true);
      S.reset();
      S.placeAir(0, 112, 60);
      S.run(0.05, cruise);
      out.planeThrew = g.throwMelon();
      let stunned = false;
      for (let t = 0; t < 4; t += 1 / 30) {
        g.simStep(1 / 30, cruise);
        if (S.phase() === 'stunned') stunned = true;
      }
      out.planeStun = stunned;
      out.planeHealth = S.sq().s.health;
      out.planeCrashed = g.flight.crashed;
      // Held: a melon from the squid's own grip always hits, and it lets go.
      g.start(true);
      S.reset();
      S.placeAir(0, 200, 20);
      out.held = S.untilHeld(8, cruise) >= 0;
      S.run(1.6, cruise); // (the throw cooldown)
      out.heldThrew = g.throwMelon();
      S.run(2, cruise);
      out.heldFree = !g.squid.holding && !g.flight.crashed;
      out.heldPhase = S.phase();
      // On land (downtown, as the robot): breaks nothing.
      g.start(false);
      g.transform();
      g.finishMorph();
      const sq = g.world.landmarks[0];
      g.flight.place(new g.flight.pos.constructor(sq.x + 20, g.world.heightAt(sq.x + 20, sq.z + 20), sq.z + 20), 0, null);
      const before = { smashed: g.bot().rampage.total, dead: [...g.world.colliders.values()].flat().filter((c) => c.dead).length };
      for (let k = 0; k < 3; k++) {
        g.throwMelon();
        S.run(1.6);
      }
      S.run(3);
      const after = { smashed: g.bot().rampage.total, dead: [...g.world.colliders.values()].flat().filter((c) => c.dead).length };
      out.land = { before, after, thrown: g.melons.thrown };
      // The controls: Z, the touch chip, and L1 when the prompt shows (near an awake squid).
      const n0 = g.melons.thrown;
      dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ' }));
      dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyZ' }));
      out.keyZ = g.melons.thrown - n0;
      S.run(1.6);
      document.getElementById('melonChip').click();
      out.chip = g.melons.thrown - n0 - out.keyZ;
      S.run(1.6);
      out.promptFar = g.melonPrompt();
      S.reset();
      S.robotAt(0, 100, 1);
      S.run(0.5);
      out.promptNear = g.melonPrompt();
      out.promptShown = !document.getElementById('melonBtn').hidden;
      const n1 = g.melons.thrown;
      g.input.emit('l1');
      out.l1 = g.melons.thrown - n1;
      out.turboAfterL1 = g.flight.turbo; // (L1 threw instead of cycling the robot's turbo)
      // Beat it with watermelons (66 m out, beyond its strike): the Squid Ink paint job unlocks.
      S.run(5);
      S.reset();
      g.logbook.squid = 0;
      S.robotAt(0, 66, 1);
      S.run(0.3);
      for (let k = 0; k < 3; k++) {
        g.throwMelon();
        S.run(1.6);
      }
      S.run(1);
      out.beatPhase = S.phase();
      out.beatHealth = S.sq().s.health;
      out.logbook = g.logbook.squid;
      out.toast = [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).filter((t) => /Squid Ink/.test(t));
      out.paint = [...document.querySelectorAll('#paints button')].map((b) => b.textContent).filter((t) => /Squid Ink/.test(t));
      return out;
    });
    console.log('  ', JSON.stringify(r));
    check('a melon from a plane flying at the squid hits and stuns it (2 damage)', r.planeThrew && r.planeStun && r.planeHealth === 4 && !r.planeCrashed, JSON.stringify({ stun: r.planeStun, hp: r.planeHealth }));
    check("a held player's melon frees them", r.held && r.heldThrew && r.heldFree, `${r.heldPhase}`);
    check('melons on land break nothing', r.land.before.smashed === r.land.after.smashed && r.land.before.dead === r.land.after.dead, JSON.stringify(r.land));
    check('Z throws a melon', r.keyZ === 1);
    check('the 🍉 touch chip throws a melon', r.chip === 1);
    check('the L1 prompt shows only near an awake squid, and L1 throws', !r.promptFar && r.promptNear && r.promptShown && r.l1 === 1 && r.turboAfterL1 === 1, JSON.stringify({ far: r.promptFar, near: r.promptNear, l1: r.l1 }));
    check('three melon hits beat it', ['flee', 'rest'].includes(r.beatPhase) && r.beatHealth === 0, `${r.beatPhase} ${r.beatHealth}`);
    check('beating the squid unlocks Squid Ink (announced, and in the paint list)', r.logbook === 1 && r.toast.length > 0, JSON.stringify(r.toast));
  }
  // ---------------------------------------------------------------- 7. Squid Hunt, solo
  if (want('hunt')) {
    await open('sanfrancisco');
    const r = await page.evaluate(async () => {
      const S = window.__sq;
      const g = S.g;
      const out = {};
      document.querySelector('#segMode [data-v=squid]').click();
      out.cardShown = !document.querySelector('#segMode [data-v=squid]').hidden;
      g.start(false);
      const hunt = g.game;
      out.isHunt = !!hunt && hunt.hits === 0 && hunt.active && typeof hunt.onBeaten === 'function';
      const i = g.squid.boss;
      const b = g.squid.squids[i];
      out.boss = { i, boss: b.s.boss, health: b.s.health, arms: b.s.boss };
      out.start = { d: Math.round(Math.hypot(g.flight.pos.x - b.spot.x, g.flight.pos.z - b.spot.z)), alt: Math.round(g.flight.pos.y - b.spot.y) };
      // Scripted fight: a 2x robot 89 m out (beyond its strike), a watermelon every 1.6 s.
      S.robotAt(i, 89, 2);
      let throws = 0;
      for (let t = 0; t < 240 && hunt.active; t += 1.6) {
        if (g.throwMelon()) throws++;
        S.run(1.6);
      }
      out.throws = throws;
      out.hits = hunt.hits;
      out.lost = hunt.lost;
      out.beaten = hunt.beaten;
      out.score = hunt.total;
      out.endShown = !document.getElementById('beerEnd').hidden;
      out.endText = document.getElementById('beerEndCash').textContent;
      out.bossAfter = g.squid.boss;
      // Post to the leaderboard and read it back.
      document.getElementById('beerName').value = 'SquidTest';
      const board = await new Promise((resolve) => {
        const ws = new WebSocket(`ws://${location.host}/ws?role=board&game=${encodeURIComponent('squid:sanfrancisco')}`);
        let posted = false;
        ws.onmessage = (e) => {
          const m = JSON.parse(e.data);
          if (m.t !== 'board') return;
          if (!posted) {
            posted = true;
            setTimeout(() => document.getElementById('beerSubmit').click(), 1500);
          } else if (m.week.some((x) => x.name === 'SquidTest')) {
            ws.close();
            resolve(m.week.filter((x) => x.name === 'SquidTest').map((x) => x.score));
          }
        };
        setTimeout(() => resolve(null), 20000);
      });
      out.board = board;
      return out;
    });
    console.log('  ', JSON.stringify(r));
    const expected = r.hits * 2 + (r.beaten ? 20 : 0) - r.lost * 3;
    check('Squid Hunt is a game mode in a city with a squid', r.cardShown && r.isHunt);
    check('the boss: the squid nearest downtown, 30 health', r.boss.boss && r.boss.health === 30, JSON.stringify(r.boss));
    check('you start 400 m out, 120 m up', Math.abs(r.start.d - 400) < 5 && Math.abs(r.start.alt - 120) < 5, JSON.stringify(r.start));
    check('the scripted fight beats it and ends the game', r.beaten && r.endShown && r.bossAfter === -1, `${r.hits} hits of ${r.throws} throws`);
    check('the score is right (2 per melon hit + 10 final blow + 10 for beating it)', r.score === expected && r.endText === `${expected} pts`, `${r.score} vs ${expected}, card "${r.endText}"`);
    check('the score posts to the squid:<city> leaderboard', Array.isArray(r.board) && r.board.includes(r.score), JSON.stringify(r.board));
  }
  // ---------------------------------------------------------------- 9. speed, Low graphics, the marker
  if (want('perf')) {
    for (const city of ['hongkong', 'sanfrancisco']) {
      await open(city);
      const r = await page.evaluate(async () => {
        const g = window.__game;
        g.start(true);
        const sq = g.squid.squids[0];
        const sp = sq.spot;
        const f = g.flight;
        const T = f.pos.constructor;
        const frames = (secs) => new Promise((res) => {
          const t = [];
          const tick = (now) => {
            t.push(now);
            if (now - t[0] < secs * 1000) requestAnimationFrame(tick);
            else res((t[t.length - 1] - t[0]) / (t.length - 1));
          };
          requestAnimationFrame(tick);
        });
        const view = () => {
          f.pos.set(sp.x - 150, sp.y + 60, sp.z);
          f.speed = 0;
          g.photo = { pos: new T(sp.x - 110, sp.y + 40, sp.z + 70), target: new T(sp.x, sp.y + 10, sp.z) };
        };
        // Same view both times: the squid switched off (hidden), then out of the water holding still.
        g.prefs.monster = 'off';
        g.applyPrefs();
        view();
        await frames(2);
        const off = await frames(10);
        g.prefs.monster = 'on';
        g.applyPrefs();
        view();
        sq.s = { ...sq.s, phase: 'recover', t: g.squid.now(), until: g.squid.now() + 1e5 };
        await frames(2);
        const on = await frames(10);
        delete g.photo;
        return { off: Math.round(off), on: Math.round(on), segs: sq.model?.segs, label: [...document.querySelectorAll('.label.squid')].map((l) => ({ text: l.textContent, color: l.style.getPropertyValue('--pin') })) };
      });
      const extra = ((r.on - r.off) / r.off) * 100;
      console.log(`   ${city}: frame ${r.off} ms without the squid, ${r.on} ms with it out of the water (${extra.toFixed(1)} %), ${r.segs} segments per arm`);
      check(`${city}: an awake squid adds no more than about 3% frame time`, extra <= 5, `${extra.toFixed(1)} % (software rendering: noisy)`);
      if (city === 'sanfrancisco') check('the deep navy "Giant squid" marker shows on screen', r.label.some((l) => /Giant squid/.test(l.text) && l.color === '#0b1f4d'), JSON.stringify(r.label));
    }
    // Low graphics (and the PSG1): fewer arm segments.
    await page.addInitScript(() => localStorage.setItem('legosky.prefs', JSON.stringify({ low: true, pottyOffOnce: 1 })));
    await open('sanfrancisco');
    const segs = await page.evaluate(async () => {
      const g = window.__game;
      g.start(true);
      const sp = g.squid.squids[0].spot;
      g.flight.pos.set(sp.x - 150, sp.y + 60, sp.z);
      g.simStep(1 / 30, { pitch: 0, roll: 0, yaw: 0, throttle: 0 });
      return g.squid.squids[0].model?.segs;
    });
    check('on Low graphics (as on the PSG1) the squid uses fewer arm segments (6 instead of 10)', segs === 6, String(segs));
  }
} finally {
  check('no errors in the page', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  stop();
}
process.exit(failed() ? 1 : 0);

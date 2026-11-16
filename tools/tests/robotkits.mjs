// Plan 08 part A: a different robot for each vehicle (its parts worn as a
// transforming toy would), same height and collision for all, kit parts that
// swing out as the change finishes, a taken parked plane's robot in its colour.
// Pass a folder to save screenshots (front and back, classic and a paint job).
//
//   npx vite build && node tools/tests/robotkits.mjs [screenshot dir]
import { mkdirSync } from 'node:fs';
import { serve, launch, openGame, check, failed, BASE } from './helpers.mjs';

const OUT = process.argv[2] || '';
if (OUT) mkdirSync(OUT, { recursive: true });
const KINDS = (process.env.KINDS || 'plane,heli,jet').split(',');
const stop = await serve();
const { browser, page } = await launch({ width: 900, height: 620 });

/** Fixed camera on the robot, from the front or the back. */
async function photo(name, side) {
  if (!OUT) return;
  await page.evaluate((side) => {
    const g = window.__game;
    const f = g.flight;
    const T = f.pos.constructor;
    const fw = f.forward.clone().setY(0).normalize();
    const rt = new T(-fw.z, 0, fw.x);
    const c = f.pos.clone().add(new T(0, 6.8, 0));
    g.photo = { pos: c.clone().addScaledVector(fw, side * 22).addScaledVector(rt, side * -9).add(new T(0, 2.5, 0)), target: c };
  }, side);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.evaluate(() => (window.__game.photo = null));
}

/** Measure the robot standing at size 1. */
const measure = () => page.evaluate(() => {
  const g = window.__game;
  const m = g.bot().walk.plane;
  const T = g.flight.pos.constructor;
  m.group.updateMatrixWorld(true);
  // (Box3 isn't exposed: measure by hand from the meshes' vertices.)
  let minY = Infinity;
  let maxY = -Infinity;
  let meshes = 0;
  const v = new T();
  m.group.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.geometry?.attributes?.position) return;
    let vis = true;
    for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
    if (!vis) return;
    meshes++;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 3) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
  });
  const head = m.cockpitHidden[0].getWorldPosition(new T()).y - m.group.position.y; // the skeleton's head: the same on every robot
  const colors = new Set();
  m.group.traverse((o) => o.isMesh && o.material?.color && colors.add(o.material.color.getHexString()));
  return { h: maxY - Math.min(minY, m.group.position.y), head: +head.toFixed(3), meshes, sig: [...colors].sort().join(","), radius: m.radius, kind: m.robotKind, eye: m.cockpitEye.y };
});

const results = {};
try {
  await page.goto(BASE); // (storage needs the site open)
  for (const kind of KINDS) {
    for (const paint of ['classic', kind === 'plane' ? 'blue' : 'redorange']) {
      await page.evaluate((p) => localStorage.setItem('legosky.prefs', JSON.stringify({ low: false, paint: p })), paint);
      // (Fire Red, Sky Blue... need the logbook: give it the cities.)
      await page.evaluate(() => localStorage.setItem('legosky.log', JSON.stringify({ cities: { a: 1, b: 1, c: 1 } })));
      await openGame(page, `city=carbondale&vehicle=${kind}&look=lego`);
      // Change, and catch the kit half unfolded.
      const half = await page.evaluate(() => {
        const g = window.__game;
        g.start(false);
        g.transform();
        g.bot().walk.plane.setUnfold(0.15);
        return true;
      });
      if (paint === 'classic') await photo(`robot-${kind}-unfolding`, 1);
      await page.evaluate(() => window.__game.finishMorph());
      if (paint === 'classic') {
        results[kind] = await measure();
        check(`${kind}: a ${kind} robot`, results[kind].kind === kind, JSON.stringify(results[kind]));
      }
      await photo(`robot-${kind}-${paint}-front`, 1);
      await photo(`robot-${kind}-${paint}-back`, -1);
      void half;
    }
  }
  const hs = Object.values(results).map((r) => r.head);
  check('every robot stands the same height (head and eyes in the same place on the skeleton)', Math.max(...hs) - Math.min(...hs) < 0.01 && new Set(Object.values(results).map((r) => r.eye)).size === 1, Object.entries(results).map(([k, r]) => `${k} head at ${r.head} m, tallest part ${r.h.toFixed(1)} m`).join(', '));
  check('every robot keeps the same collision radius', Object.values(results).every((r) => r.radius === 2.4));
  const sigs = Object.values(results).map((r) => r.sig);
  check('each robot has its own parts and colours', new Set(sigs).size === sigs.length, Object.entries(results).map(([k, r]) => `${k}: ${r.meshes} parts`).join(', '));

  // A parked plane you took: its robot is the bush-plane robot in that plane's colour.
  if (KINDS.includes('plane')) {
    await page.evaluate(() => localStorage.setItem('legosky.prefs', JSON.stringify({ low: false, paint: 'classic' })));
    await openGame(page, 'city=spartanburg&vehicle=heli&look=lego&mode=free');
    const r = await page.evaluate(async () => {
      const g = window.__game;
      g.start(false);
      g.transform();
      g.finishMorph();
      const { walk, props } = g.bot();
      const it = props.items.find((x) => x.kind === 'plane' && !x.held && x.tint !== 0xf2cd37);
      walk.place(new walk.pos.constructor(it.x + 16, g.world.heightAt(it.x + 16, it.z), it.z), 0, null);
      walk.onGround = true;
      await new Promise((res) => setTimeout(res, 1500));
      document.getElementById('driveBtn').click();
      await new Promise((res) => setTimeout(res, 300));
      g.transform();
      g.finishMorph();
      const m = g.bot().walk.plane;
      let tinted = 0;
      m.group.traverse((o) => o.material?.color?.getHex?.() === it.tint && tinted++);
      return { kind: m.robotKind, tint: m.tint === it.tint, tinted, hex: it.tint.toString(16) };
    });
    check('a taken parked plane turns into the bush-plane robot in its own colour', r.kind === 'plane' && r.tint && r.tinted > 3, JSON.stringify(r));
    await photo('robot-parked-plane-front', 1);
    // Back to your own copter after a restart: the copter robot again.
    const own = await page.evaluate(() => {
      const g = window.__game;
      g.start(false);
      g.transform();
      g.finishMorph();
      return g.bot().walk.plane.robotKind;
    });
    check('after a restart, your own vehicle\'s robot again', own === 'heli', own);
  }
} finally {
  await browser.close();
  stop();
}
console.log(failed() ? `${failed()} FAILED` : 'ALL PASSED');
process.exit(failed() ? 1 : 0);

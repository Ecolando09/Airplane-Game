// Invisible blockers (docs/plans/03-robot-fixes-plan.md section 4): fitted
// landmark collision, sliding along walls, the collision view, Google 3D
// walking, and the map edge.
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const stop = await serve();
const { browser, page } = await launch();
try {
  await openGame(page, 'city=tokyo&vehicle=plane&look=lego&mode=free');
  await page.evaluate(() => {
    const g = window.__game;
    g.start(false);
    g.transform();
    g.finishMorph();
  });

  // Walk from outside Tokyo Tower straight to its middle, between two legs.
  const tower = await page.evaluate(() => {
    const g = window.__game;
    const { walk, rampage } = g.bot();
    const w = g.world;
    rampage.power = 4; // strong enough to clear any building on the way (only the legs should matter)
    const t = w.data.custom.find((c) => c.kind === 'tokyotower');
    const a = -t.ang;
    const at = (lx, lz) => [t.x + lx * Math.cos(a) - lz * Math.sin(a), t.z + lx * Math.sin(a) + lz * Math.cos(a)];
    const [sx, sz] = at(90, 0);
    walk.place(new walk.pos.constructor(sx, w.heightAt(sx, sz), sz), 0, null);
    walk.onGround = true;
    // Face the tower's middle.
    walk.yaw = Math.atan2(-(t.x - sx), -(t.z - sz));
    let best = 1e9;
    for (let i = 0; i < 8 * 60; i++) {
      walk.update(1 / 60, { pitch: 1, roll: 0, yaw: 0, brake: false, run: false });
      best = Math.min(best, Math.hypot(walk.pos.x - t.x, walk.pos.z - t.z));
    }
    return { closest: Math.round(best) };
  });
  check('robot walks between Tokyo Tower\'s legs to the middle', tower.closest < 8, `got within ${tower.closest} m of the center`);

  // Slide: walk diagonally into an unbreakable wall; the robot keeps moving along it.
  const slide = await page.evaluate(() => {
    const g = window.__game;
    const { walk } = g.bot();
    const w = g.world;
    // A clear spot, then a 200 m wall (rotated 30 degrees) just ahead.
    let x = 0;
    let z = 0;
    for (let i = 0; i < 500; i++) {
      x = (Math.random() - 0.5) * 4000;
      z = (Math.random() - 0.5) * 4000;
      if (!w.isWater(x, z) && !w.blockedAt(x, z, w.heightAt(x, z), 120, 30)) break;
    }
    const ang = 0.5;
    w._addCollider({ t: 'box', x, z: z - 40, c: Math.cos(ang), s: Math.sin(ang), hw: 100, hd: 5, bottom: -1e4, top: w.heightAt(x, z) + 50 },
      x - 110 + w.halfX, z - 150 + w.halfZ, x + 110 + w.halfX, z + 70 + w.halfZ);
    walk.place(new walk.pos.constructor(x, w.heightAt(x, z), z), 0.35, null); // facing mostly -Z, into the wall at an angle
    walk.onGround = true;
    const p0 = walk.pos.clone();
    let moved = 0;
    let last = walk.pos.clone();
    for (let i = 0; i < 6 * 60; i++) {
      walk.update(1 / 60, { pitch: 1, roll: 0, yaw: 0, brake: false, run: false });
      moved += walk.pos.distanceTo(last);
      last = walk.pos.clone();
    }
    return { moved: Math.round(moved), net: Math.round(walk.pos.distanceTo(p0)), blockedT: walk.blockedT };
  });
  check('walking diagonally into a wall slides along it', slide.net > 60, `moved ${slide.net} m in 6 s`);

  // Collision view: toggling draws outlines near the robot.
  const view = await page.evaluate(async () => {
    const g = window.__game;
    // Back next to Tokyo Tower, where there is plenty to outline.
    const { walk } = g.bot();
    const t = g.world.data.custom.find((c) => c.kind === 'tokyotower');
    walk.place(new walk.pos.constructor(t.x + 70, g.world.heightAt(t.x + 70, t.z), t.z), 0, null);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backquote' }));
    await new Promise((r) => setTimeout(r, 1500));
    const scene = g.camera.parent || null;
    return true;
  });
  await page.waitForTimeout(1500);
  const lines = await page.evaluate(() => {
    let n = 0;
    window.__game.world.scene.traverse((o) => {
      if (o.isLineSegments && o.visible && o.geometry.attributes.position) n += o.geometry.attributes.position.count;
    });
    return n;
  });
  check('collision view draws outlines', view && lines > 100, `${lines} points`);
  await page.screenshot({ path: process.env.SHOT || '/tmp/colliders.png' });

  // Google 3D rules (simulated, no key here): walk on bare ground, pass through buildings.
  const ghost = await page.evaluate(() => {
    const g = window.__game;
    const { walk } = g.bot();
    const w = g.world;
    const real = w.heightAt.bind(w);
    let c = null;
    for (const k of w.colliders.values()) {
      c = k.find((x) => x.t === 'box' && w.breakable(x) && x.h > 30);
      if (c) break;
    }
    w.bareHeightAt = real;
    w.heightAt = (x, z) => real(x, z) + 40; // pretend Google's mesh has a 40 m rooftop everywhere
    w.ghost = true;
    walk.place(new walk.pos.constructor(c.x, real(c.x, c.z) + 1, c.z), 0, null);
    for (let i = 0; i < 120; i++) walk.update(1 / 60, { pitch: 1, roll: 0, yaw: 0, brake: false, run: false });
    const onBare = Math.abs(walk.pos.y - real(walk.pos.x, walk.pos.z)) < 1.5;
    const through = !w.blockedAt(c.x, c.z, real(c.x, c.z), 3, 13);
    w.heightAt = real;
    delete w.bareHeightAt;
    w.ghost = false;
    return { onBare, through };
  });
  check('Google 3D: robot walks on the bare ground, not rooftops', ghost.onBare);
  check('Google 3D: buildings do not block the robot', ghost.through);

  // Map edge.
  const edge = await page.evaluate(() => {
    const g = window.__game;
    const { walk } = g.bot();
    const w = g.world;
    const x = w.halfX + 1390;
    walk.place(new walk.pos.constructor(x, w.heightAt(x, 0), 0), -Math.PI / 2, null); // facing +X
    walk.onGround = true;
    for (let i = 0; i < 120; i++) walk.update(1 / 60, { pitch: 1, roll: 0, yaw: 0, brake: false, run: false });
    return walk.atEdge;
  });
  check('reaching the map edge is detected (shows "Edge of the map")', edge);
} finally {
  await browser.close();
  stop();
}
process.exit(failed() ? 1 : 0);

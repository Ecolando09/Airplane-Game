// Robot growth: 1x to 8x. A bigger robot breaks taller buildings, and at 8x
// the hand-built landmarks. Tested in San Francisco (tall towers, landmarks).
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const stop = await serve();
const { browser, page } = await launch();
try {
  await openGame(page, 'city=sanfrancisco&vehicle=plane&look=lego&mode=free');
  await page.evaluate(() => {
    const g = window.__game;
    g.start(false);
    g.transform();
    g.finishMorph();
  });
  // Grow with the ] key, twice; shrink with [.
  const grow = await page.evaluate(async () => {
    const g = window.__game;
    const { walk } = g.bot();
    const key = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    const out = { start: walk.size };
    key('BracketRight');
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'BracketRight' }));
    out.one = walk.size;
    key('BracketRight');
    out.two = walk.size;
    out.model = walk.plane.group.scale.x;
    key('BracketLeft');
    out.back = walk.size;
    return out;
  });
  check('] grows the robot (1x -> 2x -> 4x)', grow.start === 1 && grow.one === 2 && grow.two === 4, JSON.stringify(grow));
  check('the robot model is drawn bigger', grow.model === 4);
  check('[ shrinks it again', grow.back === 2);

  const smash = await page.evaluate(() => {
    const g = window.__game;
    const { rampage, walk } = g.bot();
    const w = g.world;
    const all = w.byId.filter((c) => c.t !== 'tree' && !c.dead);
    const mid = all.find((c) => w.breakable(c) && c.h > 90 && c.h < 190);
    const tall = all.find((c) => w.breakable(c) && c.h > 210);
    const lmPart = all.find((c) => c.lm);
    const out = { mid: mid?.h, tall: tall?.h, lm: !!lmPart };
    const tryAt = (size, c) => {
      walk.setSize(size);
      rampage.power = size;
      return rampage.wreck(c, { x: 1, z: 0 });
    };
    out.mid1 = tryAt(1, mid);
    out.mid2 = tryAt(2, mid);
    out.tall2 = tryAt(2, tall);
    out.tall4 = tryAt(4, tall);
    out.lm4 = tryAt(4, lmPart);
    out.lm8 = tryAt(8, lmPart);
    out.lmAllDown = w.byId.filter((c) => c.lm === lmPart.lm).every((c) => c.dead);
    rampage.reset();
    out.repaired = !lmPart.dead && !mid.dead;
    return out;
  });
  check('a 90-190 m building is too strong for a 1x robot', smash.mid1 === false, `h ${Math.round(smash.mid)} m`);
  check('... and falls to a 2x robot', smash.mid2 === true);
  check('a 210 m+ tower is too strong at 2x', smash.tall2 === false, `h ${Math.round(smash.tall)} m`);
  check('... and falls at 4x', smash.tall4 === true);
  check('a landmark stands up to a 4x robot', smash.lm4 === false);
  check('a landmark falls to an 8x robot', smash.lm8 === true && smash.lmAllDown);
  check('restarting puts it back up', smash.repaired);

  const speed = await page.evaluate(() => {
    const g = window.__game;
    const { walk } = g.bot();
    const run = (size) => {
      walk.setSize(size);
      walk.place(new walk.pos.constructor(0, g.world.heightAt(0, 0), 0), 0, null);
      walk.onGround = true;
      for (let i = 0; i < 90; i++) walk.update(1 / 60, { pitch: 1, roll: 0, yaw: 0, brake: false, run: false });
      return walk.speed;
    };
    return { s1: run(1), s8: run(8) };
  });
  check('a bigger robot walks faster', speed.s8 > speed.s1 * 2, `${speed.s1.toFixed(1)} vs ${speed.s8.toFixed(1)} m/s`);
} finally {
  await browser.close();
  stop();
}
process.exit(failed() ? 1 : 0);

// A grown robot can't sit on a robot-sized toilet: it has to supersize the toilet first.
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const stop = await serve();
const { browser, page } = await launch({ width: 640, height: 420 });
try {
  await openGame(page, 'city=spartanburg&vehicle=plane&look=lego&mode=free');
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    g.start(false);
    g.transform();
    g.finishMorph();
    const { walk, rampage } = g.bot();
    const t = g.world.toilets[0];
    const out = {};
    // A 1x robot next to a 1x toilet can sit.
    const stand = (k) => {
      walk.place(new walk.pos.constructor(t.x, g.world.heightAt(t.x, t.z + 14 * k), t.z + 14 * k), 0, null); // facing -Z: toward the toilet
      walk.onGround = true;
    };
    stand(1);
    g.goPotty();
    out.smallSits = g.potty.sitting > 0;
    g.potty.sitting = 0;
    // Grow the robot to 4x: the 1x toilet is too small.
    walk.setSize(4);
    stand(4);
    await sleep(200);
    g.goPotty();
    out.bigRefused = !(g.potty.sitting > 0);
    // Point the supersizer at the toilet and grow it twice (1 -> 2 -> 4).
    out.grow1 = !!rampage.resize(walk, 2);
    out.scale1 = t.scale;
    rampage.resize(walk, 2);
    out.scale2 = t.scale;
    out.groupScale = t.group.scale.x;
    stand(4);
    g.goPotty();
    out.bigSits = g.potty.sitting > 0;
    out.seatY = walk.pos.y - t.y;
    g.potty.sitting = 0;
    // Biggest is 8x.
    rampage.resize(walk, 2); rampage.resize(walk, 2);
    out.max = t.scale;
    return out;
  });
  check('a 1x robot sits on the normal toilet', r.smallSits, JSON.stringify(r));
  check('a 4x robot is turned away from the 1x toilet', r.bigRefused);
  check('the supersizer grows the toilet (1x -> 2x -> 4x)', r.grow1 && r.scale1 === 2 && r.scale2 === 4 && r.groupScale === 4);
  check('the 4x robot sits on the 4x toilet, at its grown seat height', r.bigSits && r.seatY > 12, `seat ${r.seatY}`);
  check('toilets top out at 8x', r.max === 8);
} finally {
  await browser.close();
  stop();
}
process.exit(failed() ? 1 : 0);

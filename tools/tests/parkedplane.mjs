// Getting into a parked plane flies that plane as it is (shape, colour, size),
// through robot changes, until a restart gives your own vehicle back.
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const stop = await serve();
const { browser, page } = await launch({ width: 640, height: 420 });
try {
  await openGame(page, 'city=spartanburg&vehicle=heli&look=lego&mode=free');
  const r = await page.evaluate(async () => {
    const g = window.__game;
    g.start(false);
    g.transform();
    g.finishMorph();
    const { walk, rampage, props } = g.bot();
    const it = props.items.find((x) => x.kind === 'plane' && !x.held);
    // Supersize it first (2x), then get in.
    walk.place(new walk.pos.constructor(it.x, g.world.heightAt(it.x, it.z + 12), it.z + 12), 0, null);
    walk.onGround = true;
    props.resize(it, 2);
    walk.place(new walk.pos.constructor(it.x + 16, g.world.heightAt(it.x + 16, it.z), it.z), 0, null);
    walk.onGround = true;
    await new Promise((res) => setTimeout(res, 1500));
    document.getElementById('driveBtn').click();
    await new Promise((res) => setTimeout(res, 300));
    const p = g.plane;
    const out = {
      flying: !g.isBot, parked: !!p.parked, tint: p.parked?.tint === it.tint, scale: p.parked?.scale,
      ownHidden: p.group.children.filter((c) => c !== p.parked?.mesh && c !== p.floats).every((c) => !c.visible),
      meshShown: !!p.parked?.mesh.visible,
    };
    // Change to the robot and back: still that plane.
    g.transform(); g.finishMorph();
    g.transform(); g.finishMorph();
    out.afterRobot = !!g.plane.parked && g.plane.parked.tint === it.tint;
    // Restart: your own vehicle (the copter) is back.
    g.start(false);
    out.restart = !g.plane.parked && new URLSearchParams(location.search).get('vehicle') === 'heli' && !it.held;
    return out;
  });
  check('getting in flies the parked plane itself (not the bush plane)', r.flying && r.parked && r.ownHidden && r.meshShown, JSON.stringify(r));
  check('... in its own colour', r.tint);
  check('... at its supersized size', r.scale === 2, `scale ${r.scale}`);
  check('... and stays that plane through robot changes', r.afterRobot);
  check('a restart puts the parked plane back and gives your own vehicle (copter) back', r.restart);
} finally {
  await browser.close();
  stop();
}
process.exit(failed() ? 1 : 0);

// Screenshots of the camera views (chase from above, first person with dashboards) and grown-vehicle lights at night.
import { serve, launch, openGame } from './helpers.mjs';
const OUT = process.argv[2] || '.';
const stop = await serve();
const { browser, page } = await launch({ width: 900, height: 560 });
const wait = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
try {
  await openGame(page, 'city=spartanburg&vehicle=plane&look=lego&mode=free');
  await page.evaluate(() => { const g = window.__game; g.start(false); g.flight.pos.y += 120; g.flight.speed = 50; g.flight.onGround = false; g.flight.throttle = 0.7; });
  await wait(1200); await shot('plane-chase');
  await page.evaluate(() => window.__game.cam('cockpit')); await wait(600); await shot('plane-cockpit');
  await page.evaluate(() => { const g = window.__game; g.cam('chase'); });
  // Robot drives a supersized car
  const drive = async (kind, name) => {
    const r = await page.evaluate(async (kind) => {
      const g = window.__game;
      g.start(false);
      if (!g.isBot) { g.transform(); g.finishMorph(); }
      const { walk, rampage, props } = g.bot();
      const it = props.items.find((x) => x.kind === kind && !x.held);
      if (!it) return 'no ' + kind;
      props.resize(it, 2);
      rampage.enterCar(walk, it);
      return 'ok';
    }, kind);
    console.log(name, r);
    await wait(1500); await shot(`${name}-chase`);
    await page.evaluate(() => window.__game.cam('cockpit')); await wait(600); await shot(`${name}-cockpit`);
    await page.evaluate(() => { window.__game.cam('chase'); const { rampage, walk } = window.__game.bot(); rampage.exitCar(walk); });
  };
  await drive('car', 'car');
  await drive('boat', 'boat');
  await drive('bus', 'bus');
  // Night: a driven car and a grown car parked nearby
  await page.evaluate(() => { const g = window.__game; g.prefs.sky = 'night'; g.applySky(); });
  await drive('suv', 'night-suv');
  const n = await page.evaluate(async () => {
    const g = window.__game; const { walk, props } = g.bot();
    const it = props.items.find((x) => x.kind === 'van' && !x.held);
    props.resize(it, 4);
    walk.place(new walk.pos.constructor(it.x + 40, g.world.heightAt(it.x + 40, it.z + 40), it.z + 40), Math.atan2(40, 40), null);
    await new Promise((r) => setTimeout(r, 1500));
    return g.grownLights.sets.size;
  });
  console.log('grown light sets', n);
  await shot('night-grown-van');
  // Heli
  await openGame(page, 'city=spartanburg&vehicle=heli&look=real&mode=free');
  await page.evaluate(() => { const g = window.__game; g.start(false); g.flight.pos.y += 60; g.flight.onGround = false; });
  await wait(1200); await shot('heli-chase');
  await page.evaluate(() => window.__game.cam('cockpit')); await wait(600); await shot('heli-cockpit');
} finally { await browser.close(); stop(); }

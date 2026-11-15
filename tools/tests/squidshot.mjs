// Screenshots of the giant squid attacking (for the owner): a plane in its grip
// over San Francisco Bay, in the Lego and realistic looks.
//
//   npx vite build && node tools/tests/squidshot.mjs <out dir>
import { serve, launch, openGame } from './helpers.mjs';

const OUT = process.argv[2] || '.';
const stop = await serve();
const { browser, page } = await launch({ width: 1280, height: 760 });
try {
  for (const look of ['lego', 'real']) {
    await openGame(page, `city=sanfrancisco&vehicle=plane&look=${look}&mode=free`);
    await page.evaluate(() => {
      const g = window.__game;
      g.start(true);
      const sq = g.squid.squids[0];
      const sp = sq.spot;
      const f = g.flight;
      const T = f.pos.constructor;
      f.pos.set(sp.x - 200, sp.y + 20, sp.z);
      f.quat.setFromAxisAngle(new T(0, 1, 0), -Math.PI / 2);
      f.speed = 50;
      f.throttle = 0.7;
      const ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 0, throttleSet: 0.7 };
      for (let t = 0; t < 8 && !g.squid.holding; t += 1 / 30) g.simStep(1 / 30, ctl);
      for (let t = 0; t < 0.8; t += 1 / 30) g.simStep(1 / 30, ctl);
      // Keep it in the grip for the photo (the struggle clock paused).
      g.squid.held.since = g.squid.now() - 1.2; // (the test page runs slowly: the struggle barely moves during the photo)

      const p = f.pos;
      g.photo = { pos: new T(p.x - 55, p.y + 16, p.z + 62), target: new T((p.x + sp.x) / 2, sp.y + 12, (p.z + sp.z) / 2) };
    });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${OUT}/squid-attack-${look}.png` });
  }
} finally {
  await browser.close();
  stop();
}

// Bridges: roads over water get a deck; traffic drives on it, a car the robot
// drives goes across on it (not through the river), and a dropped car stays on it.
// Pass a folder to also save screenshots.
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const OUT = process.argv[2];
const stop = await serve();
const { browser, page } = await launch({ width: 1000, height: 600 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  for (const city of OUT ? ['spartanburg', 'stlouis'] : ['stlouis']) {
    await openGame(page, `city=${city}&vehicle=plane&look=lego&mode=free`);
    const r = await page.evaluate(async () => {
      const g = window.__game;
      const w = g.world;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const list = w.bridges.list;
      if (!list.length) return { n: 0 };
      // The longest bridge.
      const b = list.reduce((a, c) => (c.pts.length > a.pts.length ? c : a));
      const mid = b.pts[Math.floor(b.pts.length / 2)];
      const out = { n: list.length, len: (b.pts.length - 1) * 8, clear: +(mid[2] - b.water).toFixed(1) };
      g.start(false);
      g.transform();
      g.finishMorph();
      const { walk, rampage, props } = g.bot();
      // A car at the start of the bridge, facing along it; drive across.
      const [x0, z0] = b.pts[0];
      const [x1, z1] = b.pts[1];
      const yaw = Math.atan2(-(x1 - x0), -(z1 - z0));
      const car = props.add('car', x0, z0, yaw);
      walk.place(new walk.pos.constructor(x0, w.groundAt(x0, z0), z0), yaw, null);
      walk.onGround = true;
      rampage.enterCar(walk, car);
      walk.yaw = yaw;
      let maxOff = 0;
      let wet = 0;
      let steps = 0;
      const end = b.pts[b.pts.length - 1];
      for (; steps < 60 * 90; steps++) {
        // Steer toward the next point on the bridge, like a driver would.
        const p = walk.pos;
        let k = 0;
        let bestD = Infinity;
        b.pts.forEach((q, i) => { const d = Math.hypot(q[0] - p.x, q[1] - p.z); if (d < bestD) { bestD = d; k = i; } });
        const tgt = b.pts[Math.min(b.pts.length - 1, k + 2)];
        const want = Math.atan2(-(tgt[0] - p.x), -(tgt[1] - p.z));
        let dy = ((want - walk.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        g.step(1 / 60, { pitch: 0.5, roll: -Math.max(-1, Math.min(1, dy * 3)), yaw: 0, brake: false });
        const deck = w.deckAt(p.x, p.z);
        if (deck !== null) maxOff = Math.max(maxOff, Math.abs(p.y - deck));
        if (w.isWater(p.x, p.z) && deck === null) wet++; // off the bridge, in the river
        if (Math.hypot(p.x - end[0], p.z - end[1]) < 10) break;
      }
      out.crossed = Math.hypot(walk.pos.x - end[0], walk.pos.z - end[1]) < 12;
      out.maxOff = +maxOff.toFixed(2);
      out.wet = wet;
      out.secs = +(steps / 60).toFixed(1);
      // Get out in the middle: the car stays on the deck.
      const mi = Math.floor(b.pts.length / 2);
      walk.pos.set(b.pts[mi][0], b.pts[mi][2], b.pts[mi][1]);
      rampage.exitCar(walk);
      out.carOnDeck = Math.abs(car.y - w.deckAt(car.x, car.z) ?? 0) < 0.5 && car.y > b.water + 2;
      // Traffic on bridges rides on the deck.
      const onBridge = g.traffic.cars?.filter?.((c) => w.deckAt(c.x, c.z) !== null) || [];
      out.traffic = onBridge.length;
      out.trafficOnDeck = onBridge.every((c) => Math.abs(c.y - 0.2 - w.deckAt(c.x, c.z)) < 0.6);
      out.mid = mid;
      return out;
    });
    console.log(city, JSON.stringify({ ...r, mid: undefined }));
    if (city === 'stlouis') {
      check('St. Louis has bridges over the river', r.n > 3, `${r.n} bridges, longest ${r.len} m, ${r.clear} m above the water`);
      check('a car the robot drives goes all the way across on the deck', r.crossed && r.maxOff < 0.6 && r.wet === 0, JSON.stringify(r));
      check('getting out on the bridge leaves the car on the deck', r.carOnDeck);
      check('traffic on bridges drives on the deck', r.trafficOnDeck, `${r.traffic} cars on bridges`);
    }
    if (OUT && r.mid) {
      await page.evaluate((m) => { const g = window.__game; const T = g.camera.position.constructor; g.photo = { pos: new T(m[0] + 160, m[2] + 70, m[1] + 160), target: new T(m[0], m[2], m[1]) }; }, r.mid);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/bridge-${city}.png` });
      await page.evaluate(() => { delete window.__game.photo; });
    }
  }
  check('no errors in the page', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  stop();
}
process.exit(failed() ? 1 : 0);

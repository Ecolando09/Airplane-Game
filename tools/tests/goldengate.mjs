// The Golden Gate: drive a car across its own (hand-built) deck, 67 m over the water.
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const OUT = process.argv[2];
const stop = await serve();
const { browser, page } = await launch({ width: 1000, height: 600 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await openGame(page, 'city=sanfrancisco&vehicle=plane&look=lego&mode=free');
  const r = await page.evaluate(() => {
    const g = window.__game;
    const w = g.world;
    const b = w.bridges.list[0]; // the hand-built one comes first
    const pts = b.pts;
    const out = { custom: w.bridges.custom, high: Math.max(...pts.map((p) => p[2])) - b.water };
    g.start(false);
    g.transform();
    g.finishMorph();
    const { walk, rampage, props } = g.bot();
    const [x0, z0] = pts[0];
    const [x1, z1] = pts[1];
    const yaw = Math.atan2(-(x1 - x0), -(z1 - z0));
    const car = props.add('car', x0, z0, yaw);
    walk.place(new walk.pos.constructor(x0, w.groundAt(x0, z0), z0), yaw, null);
    walk.onGround = true;
    rampage.enterCar(walk, car);
    walk.yaw = yaw;
    let maxY = -Infinity;
    let off = 0;
    const end = pts[pts.length - 1];
    let steps = 0;
    for (; steps < 60 * 180; steps++) {
      const p = walk.pos;
      let k = 0;
      let bestD = Infinity;
      pts.forEach((q, i) => { const d = Math.hypot(q[0] - p.x, q[1] - p.z); if (d < bestD) { bestD = d; k = i; } });
      const tgt = pts[Math.min(pts.length - 1, k + 2)];
      const want = Math.atan2(-(tgt[0] - p.x), -(tgt[1] - p.z));
      const dy = ((want - walk.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      g.step(1 / 60, { pitch: 1, roll: -Math.max(-1, Math.min(1, dy * 3)), yaw: 0, brake: false });
      maxY = Math.max(maxY, p.y - b.water);
      const d = w.deckAt(p.x, p.z);
      if (d === null && w.isWater(p.x, p.z)) off++;
      if (Math.hypot(p.x - end[0], p.z - end[1]) < 15) break;
    }
    out.crossed = Math.hypot(walk.pos.x - end[0], walk.pos.z - end[1]) < 20;
    out.maxY = +maxY.toFixed(1);
    out.off = off;
    out.secs = +(steps / 60).toFixed(1);
    out.traffic = (g.traffic.cars || []).filter((c) => { const d = w.deckAt(c.x, c.z); return d !== null && Math.abs(c.y - 0.2 - d) < 0.6 && d - b.water > 50; }).length;
    out.mid = pts[Math.floor(pts.length / 2)];
    return out;
  });
  check('the Golden Gate is a drivable bridge (its own deck, about 63 m up)', r.custom >= 1 && r.high > 55, JSON.stringify({ ...r, mid: undefined }));
  check('a car the robot drives goes all the way across it, up on the deck', r.crossed && r.maxY > 55 && r.off === 0, JSON.stringify({ ...r, mid: undefined }));
  console.log(`traffic up on the Golden Gate deck: ${r.traffic}`);
  if (OUT) {
    await page.evaluate((m) => { const g = window.__game; const T = g.camera.position.constructor; g.photo = { pos: new T(m[0] + 120, m[2] + 40, m[1] + 60), target: new T(m[0], m[2], m[1]) }; }, r.mid);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/goldengate.png` });
  }
  check('no errors in the page', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  stop();
}
process.exit(failed() ? 1 : 0);

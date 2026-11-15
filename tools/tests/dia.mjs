// Denver: a runway start is on Denver International (runway 8/26), the runway is
// clear, a plane takes off from it, and the city is still there.
//
//   npx vite build && node tools/tests/dia.mjs [screenshot dir]
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const OUT = process.argv[2];
const stop = await serve();
const { browser, page } = await launch({ width: 1280, height: 760 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await openGame(page, 'city=denver&vehicle=plane&look=lego&mode=free');
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.start(false);
    const w = g.world;
    const [lon0, lat0] = w.data.origin;
    const mx = 111320 * Math.cos((lat0 * Math.PI) / 180);
    const at = (x, z) => ({ lon: lon0 + x / mx, lat: lat0 - z / 110574 });
    const f = g.flight;
    const startLL = at(f.pos.x, f.pos.z);
    const startY = f.pos.y;
    // Is anything standing on the runway?
    const rw = w.runway;
    let blocked = 0;
    for (let s = -1700; s <= 1700; s += 50) {
      const q = { x: rw.x + s, y: w.heightAt(rw.x + s, rw.z) + 8, z: rw.z };
      if (w.hitsObstacle(q, 10)) blocked++;
    }
    // Full throttle, pull up gently once fast.
    let maxH = 0;
    for (let t = 0; t < 60 && !f.crashed; t += 1 / 30) {
      g.simStep(1 / 30, { pitch: f.speed > 45 ? 0.35 : 0, roll: 0, yaw: 0, throttle: 0, throttleSet: 1 });
      maxH = Math.max(maxH, f.pos.y - w.heightAt(f.pos.x, f.pos.z));
    }
    const capitol = w.landmarks.find((l) => /Capitol/.test(l.name));
    return {
      start: startLL, startY: Math.round(startY), blocked, maxH: Math.round(maxH), crashed: !!f.crashed,
      airport: w.data.airport, size: w.data.size,
      capitolKm: capitol ? Math.round(Math.hypot(capitol.x - rw.x, capitol.z - rw.z) / 100) / 10 : null,
      landmarks: w.landmarks.length,
    };
  });
  console.log('  ', JSON.stringify(r));
  check('a runway start in Denver is at Denver International (DIA)', Math.abs(r.start.lat - 39.8408) < 0.01 && Math.abs(r.start.lon + 104.7053) < 0.03, JSON.stringify(r.start));
  check('the airport is called Denver International', /Denver International/.test(r.airport || ''), r.airport);
  check('nothing stands on the runway', r.blocked === 0, `${r.blocked} blocked spots`);
  check('a plane takes off from it and climbs', !r.crashed && r.maxH > 150, `${r.maxH} m up`);
  check('downtown Denver is still on the map (Capitol about 25 km away)', r.capitolKm > 20 && r.capitolKm < 35, `${r.capitolKm} km`);
  if (OUT) {
    await page.evaluate(() => {
      const g = window.__game;
      g.start(false);
      const f = g.flight;
      const T = f.pos.constructor;
      const p = f.pos;
      g.photo = { pos: new T(p.x - 70, p.y + 25, p.z + 30), target: new T(p.x + 200, p.y, p.z) };
    });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${OUT}/denver-dia-runway.png` });
  }
  check('no errors in the page', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  stop();
}
process.exit(failed() ? 1 : 0);

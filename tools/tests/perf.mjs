// Frame time in every city, Lego and Realistic looks, day and night, at the
// PSG1's screen size. This machine renders in software, so the numbers are far
// slower than a real device: compare them with each other (day vs night, city
// vs city), not with a frame-rate target. Prints a table and flags night costs
// over 25 % of day.
//   npx vite build && node tools/tests/perf.mjs [city ...]
import { serve, launch, openGame } from './helpers.mjs';

const CITIES = process.argv.slice(2).length ? process.argv.slice(2)
  : ['spartanburg', 'fortcollins', 'carbondale', 'denver', 'stlouis', 'sanfrancisco', 'hongkong', 'tokyo', 'singapore'];
const stop = await serve();
const { browser, page } = await launch({ width: 620, height: 540 });
const rows = [];
let worst = 0;
try {
  for (const city of CITIES) {
    for (const look of ['lego', 'real']) {
      await openGame(page, `city=${city}&vehicle=plane&look=${look}&mode=free`);
      const res = {};
      for (const sky of ['day', 'night']) {
        res[sky] = await page.evaluate(async (sky) => {
          const g = window.__game;
          g.prefs.sky = sky;
          g.applySky();
          if (!g.running) g.start(true);
          await new Promise((r) => setTimeout(r, 2500)); // settle
          // Average frame time over a few seconds, and what one frame draws.
          const t0 = performance.now();
          let frames = 0;
          await new Promise((r) => {
            const tick = () => {
              frames++;
              if (performance.now() - t0 > 5000) r();
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
          const info = g.renderer.info.render;
          return { ms: Math.round((performance.now() - t0) / frames), calls: info.calls, tris: info.triangles, points: info.points };
        }, sky);
      }
      const extra = (res.night.ms - res.day.ms) / res.day.ms;
      worst = Math.max(worst, extra);
      rows.push({ city, look, dayMs: res.day.ms, nightMs: res.night.ms, nightCost: `${Math.round(extra * 100)}%`, nightCalls: res.night.calls, dayCalls: res.day.calls, nightPoints: res.night.points });
      console.log(JSON.stringify(rows[rows.length - 1]));
    }
  }
} finally {
  await browser.close();
  stop();
}
console.table(rows);
console.log(worst > 0.25 ? `WARN  night adds up to ${Math.round(worst * 100)}% frame time somewhere` : `OK  night adds at most ${Math.round(worst * 100)}% frame time`);

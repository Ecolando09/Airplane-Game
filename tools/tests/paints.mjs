// Plan 08 part C: the Red-Orange and Rainbow paint jobs, free from the start,
// and friends see your paint job in a room.
//
//   npx vite build && node tools/tests/paints.mjs [screenshot dir]
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const OUT = process.argv[2] || '';
if (OUT) mkdirSync(OUT, { recursive: true });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stop = await serve();
const { browser, page } = await launch({ width: 960, height: 600 });
const W = { timeout: 30000, polling: 300 };

/** Fixed camera on the vehicle (or robot) from the front-left. */
const photo = (p, name) => (OUT ? (async () => {
  await p.evaluate(() => {
    const g = window.__game;
    const f = g.flight;
    const T = f.pos.constructor;
    const bot = g.isBot;
    const fw = f.forward.clone().setY(0).normalize();
    const rt = new T(-fw.z, 0, fw.x);
    const c = f.pos.clone().add(new T(0, bot ? 6.5 : 1.5, 0));
    const d = bot ? 26 : 16;
    g.photo = { pos: c.clone().addScaledVector(fw, d * 0.8).addScaledVector(rt, -d * 0.6).add(new T(0, bot ? 2 : 4, 0)), target: c };
  });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${OUT}/${name}.png` });
  await p.evaluate(() => (window.__game.photo = null));
})() : null);

try {
  // A fresh browser profile: both new paint jobs are unlocked.
  await openGame(page, 'city=carbondale&vehicle=plane&look=lego');
  const swatches = await page.evaluate(() => [...document.querySelectorAll('#paints button')].map((b) => ({ t: b.textContent, off: b.disabled, c: b.style.getPropertyValue('--c') })));
  const ro = swatches.find((s) => /Red-Orange/.test(s.t));
  const rb = swatches.find((s) => /Rainbow/.test(s.t));
  check('Red-Orange is unlocked on a fresh profile', ro && !ro.off);
  check('Rainbow is unlocked on a fresh profile', rb && !rb.off);
  check('the rainbow swatch is a gradient', /gradient/.test(rb?.c || ''), rb?.c);

  for (const v of ['plane', 'heli', 'jet']) {
    await page.evaluate(() => localStorage.setItem('legosky.prefs', JSON.stringify({ low: false, paint: 'rainbow' })));
    await openGame(page, `city=carbondale&vehicle=${v}&look=lego`);
    const r = await page.evaluate(() => {
      const g = window.__game;
      g.start(false);
      return { bands: g.plane.rainbow?.length || 0, colors: new Set((g.plane.rainbow || []).map((x) => x.m.color.getHexString())).size };
    });
    check(`${v}: rainbow paints its accent parts in bands`, r.bands >= 3 && r.colors >= 3, `${r.bands} parts, ${r.colors} colours`);
    // The colours drift.
    const drift = await page.evaluate(async () => {
      const m = window.__game.plane.rainbow[0].m;
      const a = m.color.getHexString();
      await new Promise((res) => setTimeout(res, 2500));
      return a !== m.color.getHexString();
    });
    check(`${v}: rainbow colours drift`, drift);
    await photo(page, `rainbow-${v}`);
    await page.evaluate(() => { const g = window.__game; g.transform(); g.finishMorph(); });
    const rb2 = await page.evaluate(() => window.__game.bot().walk.plane.rainbow?.length || 0);
    check(`${v}: its robot wears the rainbow too`, rb2 >= 3, `${rb2} parts`);
    await photo(page, `rainbow-${v}-robot`);
  }
  // Red-Orange on the shuttle robot (its red parts take paint now).
  await page.evaluate(() => localStorage.setItem('legosky.prefs', JSON.stringify({ low: false, paint: 'redorange' })));
  await openGame(page, 'city=carbondale&vehicle=jet&look=lego');
  const ro2 = await page.evaluate(() => {
    const g = window.__game;
    g.start(false);
    g.transform();
    g.finishMorph();
    let n = 0;
    g.bot().walk.plane.group.traverse((o) => o.material?.color?.getHex?.() === 0xff5a1f && n++);
    return n;
  });
  check('Red-Orange recolours the shuttle robot', ro2 > 0, `${ro2} parts`);
  await photo(page, 'redorange-jet-robot');

  // Low graphics: the rainbow stays still.
  await page.evaluate(() => localStorage.setItem('legosky.prefs', JSON.stringify({ low: true, paint: 'rainbow' })));
  await openGame(page, 'city=carbondale&vehicle=plane&look=lego');
  const still = await page.evaluate(async () => {
    const g = window.__game;
    g.start(false);
    const m = g.plane.rainbow[0].m;
    const a = m.color.getHexString();
    await new Promise((res) => setTimeout(res, 2500));
    return a === m.color.getHexString();
  });
  check('on Low graphics the rainbow stays still', still);
} finally {
  await browser.close();
}

// Two browsers in a room: Bob sees Alice's rainbow plane, then her rainbow robot.
const relay = spawn('node', ['server/relay.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, STATE_DIR: mkdtempSync(path.join(tmpdir(), 'relay-')) } });
const { browser: b1, page: a } = await launch({ width: 800, height: 520 });
const { browser: b2, page: b } = await launch({ width: 800, height: 520 });
try {
  await a.addInitScript(() => { localStorage.setItem('legosky.name', 'Alice'); localStorage.setItem('legosky.prefs', JSON.stringify({ low: true, paint: 'rainbow' })); });
  await b.addInitScript(() => { localStorage.setItem('legosky.name', 'Bob'); localStorage.setItem('legosky.prefs', JSON.stringify({ low: true })); });
  await openGame(a, 'city=carbondale&vehicle=jet&look=lego&room=PNTS');
  await openGame(b, 'city=carbondale&vehicle=plane&look=lego&room=PNTS');
  for (const p of [a, b]) await p.waitForFunction(() => window.__game.mp.status === 'on', null, W);
  for (const p of [a, b]) await p.evaluate(() => window.__game.start(false));
  await b.waitForFunction(() => [...window.__game.mp.players.values()][0]?.model?.rainbow?.length > 2, null, W).then(() => true, () => false)
    .then((ok) => check('a friend sees your rainbow shuttle', ok));
  await a.evaluate(() => { const g = window.__game; g.transform(); g.finishMorph(); });
  const seen = await b.waitForFunction(() => { const pl = [...window.__game.mp.players.values()][0]; return pl?.bot && pl.model?.rainbow?.length > 2; }, null, W).then(() => true, () => false);
  check('a friend sees your rainbow robot', seen);
  if (OUT) {
    await b.evaluate(() => {
      const g = window.__game;
      const pl = [...g.mp.players.values()][0];
      const T = pl.pos.constructor;
      g.photo = { pos: pl.pos.clone().add(new T(-18, 10, -22)), target: pl.pos.clone().add(new T(0, 6, 0)) };
    });
    await b.waitForTimeout(3000);
    await b.screenshot({ path: `${OUT}/friend-sees-rainbow-robot.png` });
  }
} finally {
  await b1.close();
  await b2.close();
  relay.kill();
  stop();
}
console.log(failed() ? `${failed()} FAILED` : 'ALL PASSED');
process.exit(failed() ? 1 : 0);

// Police cars, ambulances and fire trucks: placed in the city, flashing lights by day,
// lights and siren switched with keys (O, U) and buttons, their own dashboards.
// Pass a folder to also save screenshots.
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const OUT = process.argv[2];
const stop = await serve();
const { browser, page } = await launch({ width: 900, height: 560 });
const shot = (n) => OUT && page.screenshot({ path: `${OUT}/${n}.png` });
try {
  await openGame(page, `city=spartanburg&vehicle=plane&look=${OUT ? 'real' : 'lego'}&mode=free`);
  const counts = await page.evaluate(() => {
    const g = window.__game;
    g.start(false);
    g.transform();
    g.finishMorph();
    const { props } = g.bot();
    const n = {};
    for (const it of props.items) if (['police', 'ambulance', 'firetruck'].includes(it.kind)) n[it.kind] = (n[it.kind] || 0) + 1;
    return n;
  });
  check('police cars, ambulances and fire trucks are parked around the city', counts.police >= 2 && counts.ambulance >= 1 && counts.firetruck >= 1, JSON.stringify(counts));
  for (const kind of ['police', 'ambulance', 'firetruck']) {
    const r = await page.evaluate(async (kind) => {
      const g = window.__game;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const { walk, rampage, props } = g.bot();
      if (rampage.driving) rampage.exitCar(walk);
      const it = props.items.find((x) => x.kind === kind && !x.held);
      // Parked: its lights flash (by day) before anyone gets in.
      walk.place(new walk.pos.constructor(it.x + 30, g.world.heightAt(it.x + 30, it.z), it.z), Math.PI / 2, null);
      await sleep(1200);
      const parkedLit = [...(g.emergencyProps?.sets.keys() || [])].includes(it);
      rampage.enterCar(walk, it);
      await sleep(400);
      const dr = rampage.driving;
      return { parkedLit, em: !!dr.em, on: dr.em?.userData.on, buttons: !document.getElementById('emBtns').hidden };
    }, kind);
    check(`${kind}: parked ones flash, and it has flashing lights once driven`, r.parkedLit && r.em && r.on, JSON.stringify(r));
    check(`${kind}: the lights and siren buttons show while driving it`, r.buttons);
    await page.waitForTimeout(800);
    await shot(`${kind}-chase`);
    await page.evaluate(() => window.__game.cam('cockpit'));
    await page.keyboard.press('KeyU'); // siren on
    await page.waitForTimeout(700);
    await shot(`${kind}-cockpit`);
    const s = await page.evaluate(() => {
      const g = window.__game;
      const dr = g.bot().rampage.driving;
      return { dash: g.dashboard.type, visible: g.dashboard.visible, siren: !!dr.item.siren, sirenBtn: document.getElementById('emSirenBtn').classList.contains('on') };
    });
    check(`${kind}: its own dashboard in first person`, s.visible && s.dash === { police: 'police', ambulance: 'ambulance', firetruck: 'fire' }[kind], JSON.stringify(s));
    check(`${kind}: U turns the siren on`, s.siren && s.sirenBtn);
    await page.keyboard.press('KeyO'); // lights off
    await page.evaluate(() => document.getElementById('emSirenBtn').click()); // siren off with the button
    const o = await page.evaluate(() => {
      const g = window.__game;
      const dr = g.bot().rampage.driving;
      g.cam('chase');
      return { lights: dr.item.lights, on: dr.em.userData.on, siren: !!dr.item.siren };
    });
    check(`${kind}: O turns the lights off, the button turns the siren off`, o.lights === false && !o.on && !o.siren, JSON.stringify(o));
    await page.keyboard.press('KeyO'); // back on for the next screenshot set
  }
  const after = await page.evaluate(() => {
    const { walk, rampage } = window.__game.bot();
    rampage.exitCar(walk);
    return document.getElementById('emBtns').hidden;
  });
  check('getting out hides the buttons', after);
} finally {
  await browser.close();
  stop();
}
process.exit(failed() ? 1 : 0);

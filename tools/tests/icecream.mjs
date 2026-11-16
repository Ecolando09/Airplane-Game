// The ice cream truck: lights (roof bulbs) and music, switched like an emergency
// vehicle's lights and siren (keys O and U, the buttons, the D-pad).
// Pass a folder to also save screenshots.
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const OUT = process.argv[2];
const stop = await serve();
const { browser, page } = await launch({ width: 900, height: 560 });
const shot = (n) => OUT && page.screenshot({ path: `${OUT}/${n}.png` });
try {
  await openGame(page, 'city=spartanburg&vehicle=plane&look=lego&mode=free');
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    g.start(false);
    g.transform();
    g.finishMorph();
    const { walk, rampage, props } = g.bot();
    const it = props.items.find((x) => x.kind === 'truck' && !x.held);
    if (!it) return { none: true };
    walk.place(new walk.pos.constructor(it.x + 30, g.world.heightAt(it.x + 30, it.z), it.z), Math.PI / 2, null);
    await sleep(1200);
    const parkedLit = [...(g.emergencyProps?.sets.keys() || [])].includes(it);
    rampage.enterCar(walk, it);
    await sleep(400);
    const dr = rampage.driving;
    return {
      parkedLit, em: !!dr.em, on: !!dr.em?.userData.on, buttons: !document.getElementById('emBtns').hidden,
      labels: document.getElementById('emLightsBtn').textContent + ' / ' + document.getElementById('emSirenBtn').textContent,
    };
  });
  check('there is an ice cream truck to drive', !r.none);
  check('a parked ice cream truck has its lights off', !r.parkedLit);
  check('driving it: its bulbs are there, off to start', r.em && !r.on, JSON.stringify(r));
  check('driving it: the Lights and Music buttons show', r.buttons && /Lights/.test(r.labels) && /Music/.test(r.labels), r.labels);
  await page.keyboard.press('KeyO');
  await page.keyboard.press('KeyU');
  await page.waitForTimeout(600);
  const on = await page.evaluate(() => {
    const dr = window.__game.bot().rampage.driving;
    return { lights: dr.item.lights, on: dr.em.userData.on, music: !!dr.item.siren, msg: document.getElementById('message').textContent,
      lb: document.getElementById('emLightsBtn').classList.contains('on'), mb: document.getElementById('emSirenBtn').classList.contains('on') };
  });
  check('O turns the lights on', on.lights === true && on.on && on.lb, JSON.stringify(on));
  check('U turns the ice cream music on', on.music && on.mb, on.msg);
  if (OUT) {
    await page.evaluate(() => {
      const g = window.__game;
      const dr = g.bot().rampage.driving;
      g.applySky?.('night');
      const p = dr.mesh.getWorldPosition(new g.flight.pos.constructor());
      const T = p.constructor;
      g.photo = { pos: p.clone().add(new T(-14, 9, -16)), target: p.clone().add(new T(0, 2, 0)) };
    });
    await page.waitForTimeout(3000);
    await shot('icecream-lights');
    await page.evaluate(() => (window.__game.photo = null));
  }
  // The D-pad does the same (left: lights, right: music); then the buttons.
  await page.evaluate(() => document.getElementById('emLightsBtn').click());
  await page.evaluate(() => document.getElementById('emSirenBtn').click());
  const off = await page.evaluate(() => {
    const dr = window.__game.bot().rampage.driving;
    return { lights: dr.item.lights, on: dr.em.userData.on, music: !!dr.item.siren };
  });
  check('the buttons turn lights and music off', off.lights === false && !off.on && !off.music, JSON.stringify(off));
  // Lights left on: the parked truck keeps blinking after you get out.
  const parked = await page.evaluate(async () => {
    const g = window.__game;
    const { walk, rampage } = g.bot();
    document.getElementById('emLightsBtn').click();
    const it = rampage.driving.item;
    rampage.exitCar(walk);
    await new Promise((res) => setTimeout(res, 1200));
    return { hidden: document.getElementById('emBtns').hidden, lit: [...(g.emergencyProps?.sets.keys() || [])].includes(it) };
  });
  check('getting out hides the buttons', parked.hidden);
  check('a truck left with its lights on keeps blinking', parked.lit);
} finally {
  await browser.close();
  stop();
}
console.log(failed() ? `${failed()} FAILED` : 'ALL PASSED');
process.exit(failed() ? 1 : 0);

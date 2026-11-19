// The ice cream truck: lights (roof bulbs) and music, switched like an emergency
// vehicle's lights and siren (keys O and U, the buttons, the D-pad). Plan 09:
// three songs (Song button, J, D-pad right steps through them), friends hear
// the same song, and the music's timing doesn't depend on the frame rate.
// Pass a folder to also save screenshots.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

  // ---- plan 09: songs.
  const songs = await page.evaluate(async () => {
    const g = window.__game;
    const { walk, rampage } = g.bot();
    const it = rampage.driving?.item || g.bot().props.items.find((x) => x.kind === 'truck' && !x.held);
    if (!rampage.driving) rampage.enterCar(walk, it);
    await new Promise((res) => setTimeout(res, 400));
    const dr = rampage.driving;
    dr.item.siren = false;
    const shown = !document.getElementById('emSongBtn').hidden;
    const seen = [];
    const press = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ' })) || window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ' }));
    for (let i = 0; i < 4; i++) {
      g.input.emit('song');
      seen.push({ song: dr.item.song, on: !!dr.item.siren, msg: document.getElementById('message').textContent, em: g.emState() });
    }
    void press;
    return { shown, seen, saved: JSON.parse(localStorage.getItem('legosky.settings')).song };
  });
  check('the Song button shows in the ice cream truck', songs.shown);
  check('J switches the music on and steps through songs 1 -> 2 -> 3 -> 1', songs.seen.map((x) => x.song).join() === '0,1,2,0' && songs.seen.every((x) => x.on), JSON.stringify(songs.seen.map((x) => x.song)));
  check('the message names the song', /Song 2 of 3: Pop Goes the Weasel/.test(songs.seen[1].msg) && /The Entertainer/.test(songs.seen[2].msg), songs.seen[1].msg);
  check('the state friends get carries the song', songs.seen.map((x) => (x.em >> 2) & 3).join() === '0,1,2,0', songs.seen.map((x) => x.em).join());
  check('the last song picked is remembered', songs.saved === 0);
  // The J key itself (through the real keyboard handler), and U still switches the music off and on.
  await page.keyboard.press('KeyJ');
  await page.keyboard.press('KeyU');
  const u1 = await page.evaluate(() => { const it = window.__game.bot().rampage.driving.item; return { song: it.song, on: !!it.siren }; });
  await page.keyboard.press('KeyU');
  const u2 = await page.evaluate(() => !!window.__game.bot().rampage.driving.item.siren);
  check('J picks the next song; U still switches the music off and on', u1.song === 1 && !u1.on && u2, JSON.stringify(u1));
  // D-pad right (a controller): off -> song 1 -> 2 -> 3 -> off.
  const pad = await page.evaluate(() => {
    const g = window.__game;
    const it = g.bot().rampage.driving.item;
    it.siren = false;
    const out = [];
    for (let i = 0; i < 4; i++) {
      g.input.emit('dRight');
      out.push(it.siren ? it.song + 1 : 'off');
    }
    return out.join(' ');
  });
  check('D-pad right in the truck: song 1, 2, 3, then off', pad === '1 2 3 off', pad);
  // Not in a police car.
  const cop = await page.evaluate(async () => {
    const g = window.__game;
    const { walk, rampage, props } = g.bot();
    rampage.exitCar(walk);
    const it = props.items.find((x) => x.kind === 'police' && !x.held);
    walk.place(new walk.pos.constructor(it.x + 30, g.world.heightAt(it.x + 30, it.z), it.z), Math.PI / 2, null);
    rampage.enterCar(walk, it);
    await new Promise((res) => setTimeout(res, 400));
    g.input.emit('dRight');
    const r = { song: !document.getElementById('emSongBtn').hidden, siren: !!it.siren };
    g.input.emit('dRight');
    r.off = !it.siren;
    rampage.exitCar(walk);
    return r;
  });
  check('no Song button in a police car, and D-pad right still just switches its siren', !cop.song && cop.siren && cop.off, JSON.stringify(cop));

  // ---- the music's timing doesn't depend on the frame rate (no ears needed).
  const sched = await page.evaluate(() => {
    const S = window.__game.sound.constructor;
    const run = (fps, song, lite) => {
      const s = new S();
      s.ctx = new AudioContext();
      s.lite = lite;
      let t = 0;
      s.clock = () => t;
      s.chimeLog = [];
      for (; t < 20; t += 1 / fps) s.chime(1, song);
      const log = s.chimeLog.filter((x) => x < 19);
      s.ctx.close();
      return log;
    };
    const out = [];
    for (const song of [0, 1, 2]) {
      const a = run(60, song, false);
      const b = run(5, song, false);
      const c = run(36, song, true);
      out.push({ song, n: a.length, same: a.join() === b.join(), samePsg1: a.join() === c.join(), first: a.slice(0, 4) });
    }
    // Switching off fades out and starts from the top next time; chime(0) makes no nodes.
    const s = new S();
    s.ctx = new AudioContext();
    let t = 0;
    s.clock = () => t;
    s.chime(0, 0);
    const cheap = !s.chimeGain;
    s.chimeLog = [];
    for (; t < 1; t += 1 / 60) s.chime(1, 2);
    for (; t < 1.5; t += 1 / 60) s.chime(0, 2);
    const before = s.chimeLog.length;
    for (; t < 1.6; t += 1 / 60) s.chime(1, 2);
    const restart = s.chimeLog.slice(before);
    // Falling behind: a 3-second gap, then no burst of missed notes.
    s.chimeLog = [];
    t += 3;
    s.chime(1, 2);
    const burst = s.chimeLog.filter((x) => x < t - 0.1).length;
    s.ctx.close();
    return { out, cheap, restart: restart[0] - 1.5, burst };
  });
  for (const r of sched.out) check(`song ${r.song + 1}: the same notes at the same times at 60 and at 5 frames a second`, r.same && r.samePsg1 && r.n > 40, `${r.n} notes, first at ${r.first.join(', ')}`);
  check('with the music off, nothing is made (cheap every frame)', sched.cheap);
  check('switched off and on, the song starts from the top', sched.restart > 0 && sched.restart < 0.15, String(sched.restart));
  check('after a long pause, no burst of missed notes', sched.burst === 0, String(sched.burst));
} finally {
  await browser.close();
}

// ---- a friend in the room hears the same song.
const relay = spawn('node', ['server/relay.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, STATE_DIR: mkdtempSync(path.join(tmpdir(), 'relay-')) } });
const { browser: b1, page: a } = await launch({ width: 800, height: 520 });
const { browser: b2, page: b } = await launch({ width: 800, height: 520 });
try {
  await a.addInitScript(() => { localStorage.setItem('legosky.name', 'Alice'); localStorage.setItem('legosky.prefs', JSON.stringify({ low: true })); });
  await b.addInitScript(() => { localStorage.setItem('legosky.name', 'Bob'); localStorage.setItem('legosky.prefs', JSON.stringify({ low: true })); });
  await openGame(a, 'city=spartanburg&vehicle=plane&look=lego&room=TUNE');
  await openGame(b, 'city=spartanburg&vehicle=plane&look=lego&room=TUNE');
  for (const p of [a, b]) await p.waitForFunction(() => window.__game.mp.status === 'on', null, { timeout: 30000, polling: 300 });
  for (const p of [a, b]) await p.evaluate(() => window.__game.start(false));
  await a.evaluate(async () => {
    const g = window.__game;
    g.transform();
    g.finishMorph();
    const { walk, rampage, props } = g.bot();
    const it = props.items.find((x) => x.kind === 'truck' && !x.held);
    walk.place(new walk.pos.constructor(it.x + 30, g.world.heightAt(it.x + 30, it.z), it.z), Math.PI / 2, null);
    rampage.enterCar(walk, it);
    await new Promise((res) => setTimeout(res, 400));
    g.input.emit('song');
    g.input.emit('song');
    g.input.emit('song'); // The Entertainer
  });
  const heard = await b.waitForFunction(() => { const pl = [...window.__game.mp.players.values()][0]; return pl?.ride?.kind === 'truck' && pl.ride.em; }, null, { timeout: 30000, polling: 300 })
    .then((h) => h.jsonValue(), () => 0);
  check('a friend gets your truck\'s music and song (The Entertainer)', (heard & 2) && ((heard >> 2) & 3) === 2, String(heard));
} finally {
  await b1.close();
  await b2.close();
  relay.kill();
  stop();
}
console.log(failed() ? `${failed()} FAILED` : 'ALL PASSED');
process.exit(failed() ? 1 : 0);

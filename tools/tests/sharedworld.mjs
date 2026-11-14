// Shared world (plan 05 part 1): with two players in a room, resizing, picking
// up, throwing and driving objects shows on both screens, and a player who
// joins later gets the same world. Also: getting into a normal-size car, a
// boat and a parked plane.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serve, launch, openGame, check, failed } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const relay = spawn('node', ['server/relay.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, STATE_DIR: mkdtempSync(path.join(tmpdir(), 'relay-')) } });
const stop = await serve();
const { browser, page: a } = await launch({ width: 800, height: 520 });
const b = await browser.newPage({ viewport: { width: 800, height: 520 } });
b.on('pageerror', (e) => console.log('PAGE ERROR (b):', e.message));
const ROOM = 'WXQZ';
for (const [p, n] of [[a, 'Alice'], [b, 'Bob']]) await p.addInitScript((n) => localStorage.setItem('legosky.name', n), n);
const robot = (p) => p.evaluate(() => { const g = window.__game; g.start(false); g.transform(); g.finishMorph(); });
try {
  await openGame(a, `city=carbondale&vehicle=plane&look=lego&room=${ROOM}`);
  await openGame(b, `city=carbondale&vehicle=plane&look=lego&room=${ROOM}`);
  for (const p of [a, b]) await p.waitForFunction(() => window.__game.mp.status === 'on');
  await robot(a);
  await robot(b);
  // A walks next to a car, supersizes it and picks... first the resize.
  const pid = await a.evaluate(() => {
    const g = window.__game;
    const { walk, rampage, props } = g.bot();
    const it = props.items.find((x) => x.kind === 'car' && !x.held);
    walk.place(new walk.pos.constructor(it.x, g.world.heightAt(it.x, it.z + 8), it.z + 8), 0, null);
    walk.onGround = true;
    rampage.resize(walk, 2);
    return String(props.items.find((x) => x.scale === 2).id); // the supersizer may pick a car off the road instead
  });
  await b.waitForFunction((pid) => window.__game.bot().props.byId.get(pid)?.scale === 2, pid, { timeout: 30000, polling: 300 });
  check('a supersized car is supersized on the other screen too', true);

  // A picks something up: it leaves the ground for B and shows in A's hands.
  const pick = await a.evaluate(() => {
    const g = window.__game;
    const { walk, rampage, props } = g.bot();
    const it = props.items.find((x) => x.kind === 'boulder' && !x.held);
    walk.place(new walk.pos.constructor(it.x, g.world.heightAt(it.x, it.z + 5), it.z + 5), 0, null);
    walk.onGround = true;
    rampage.grabOrThrow(walk);
    return { pid: String(rampage.held?.item.id), held: !!rampage.held }; // (it may grab a passing car instead)
  });
  check('robot A picks something up', pick.held);
  await b.waitForFunction((pid) => window.__game.bot().props.byId.get(pid)?.held, pick.pid, { timeout: 30000, polling: 300 }).catch(async (e) => {
    console.log('DEBUG pick', JSON.stringify(pick), await b.evaluate((pid) => JSON.stringify(window.__game.bot().props.byId.get(pid) || 'missing', ['id', 'kind', 'held', 'x', 'z']), pick.pid));
    throw e;
  });
  const carry = await b.evaluate(() => [...window.__game.mp.players.values()][0].carryId);
  check('B sees it lifted, and in A\'s hands', carry === pick.pid, carry);

  // A throws it: B sees it fly and land in the same place.
  await a.evaluate((pid) => {
    const { walk, rampage, props } = window.__game.bot();
    rampage.grabOrThrow(walk);
    for (let i = 0; i < 600 && props.byId.get(pid).held; i++) rampage.update(1 / 30, walk); // fly it to the ground
  }, pick.pid);
  await b.waitForFunction((pid) => !window.__game.bot().props.byId.get(pid).held, pick.pid, { timeout: 30000, polling: 300 });
  await b.waitForTimeout(800);
  const land = await Promise.all([a, b].map((p) => p.evaluate((pid) => { const it = window.__game.bot().props.byId.get(pid); return [it.x, it.z]; }, pick.pid)));
  check('the thrown object lands in the same spot for both', Math.hypot(land[0][0] - land[1][0], land[0][1] - land[1][1]) < 1, JSON.stringify(land));

  // Robot size and driving show for the other player.
  await a.evaluate(() => { const { walk, rampage } = window.__game.bot(); walk.setSize(4); rampage.power = 4; });
  await b.waitForFunction(() => [...window.__game.mp.players.values()][0]?.size === 4, null, { timeout: 30000, polling: 300 });
  check('a grown robot is grown on the other screen', true);

  // Normal-size car: DRIVE gets in (no supersizing needed).
  const drove = await a.evaluate(async () => {
    const g = window.__game;
    const { walk, rampage, props } = g.bot();
    walk.setSize(1);
    const it = props.items.find((x) => x.kind === 'car' && !x.held && (x.scale || 1) === 1);
    walk.place(new walk.pos.constructor(it.x, g.world.heightAt(it.x, it.z + 6), it.z + 6), 0, null);
    walk.onGround = true;
    await new Promise((r) => setTimeout(r, 1500));
    document.getElementById('driveBtn').click();
    return { driving: !!rampage.driving, kind: rampage.driving?.item.kind, pid: String(it.id) };
  });
  check('DRIVE gets into a normal-size car', drove.driving && drove.kind === 'car');
  await b.waitForFunction(() => [...window.__game.mp.players.values()][0]?.ride?.kind === 'car', null, { timeout: 30000, polling: 300 });
  check('the other player sees the robot driving the car', true);
  await a.evaluate(() => { const { walk } = window.__game.bot(); walk.update(1 / 60, { pitch: 0, roll: 0, yaw: 0, brake: true }); });

  // A boat (on water) and a parked plane.
  const boat = await a.evaluate(async () => {
    const g = window.__game;
    const { walk, rampage, props } = g.bot();
    const it = props.items.find((x) => x.kind === 'boat' && !x.held);
    if (!it) return 'no boat in this city';
    walk.place(new walk.pos.constructor(it.x + 5, g.world.heightAt(it.x + 5, it.z), it.z), 0, null);
    walk.onGround = true;
    await new Promise((r) => setTimeout(r, 1500));
    document.getElementById('driveBtn').click();
    const ok = rampage.driving?.item.kind === 'boat' && walk.boat;
    walk.update(1 / 60, { pitch: 0, roll: 0, yaw: 0, brake: true });
    return ok;
  });
  check('a boat can be driven', boat === true || boat === 'no boat in this city', String(boat));
  const flew = await a.evaluate(async () => {
    const g = window.__game;
    const { walk, props } = g.bot();
    const it = props.items.find((x) => x.kind === 'plane' && !x.held);
    walk.place(new walk.pos.constructor(it.x + 7, g.world.heightAt(it.x + 7, it.z), it.z), 0, null);
    walk.onGround = true;
    await new Promise((r) => setTimeout(r, 1500));
    document.getElementById('driveBtn').click();
    await new Promise((r) => setTimeout(r, 300));
    return { bot: g.isBot, held: it.held, d: Math.hypot(g.flight.pos.x - it.x, g.flight.pos.z - it.z), pid: String(it.id) };
  });
  check('getting into a parked plane gives a flyable plane right there', !flew.bot && flew.held && flew.d < 2, JSON.stringify(flew));
  await b.waitForFunction((pid) => window.__game.bot().props.byId.get(pid)?.held, flew.pid, { timeout: 30000, polling: 300 });
  check('the parked plane is gone for the other player', true);

  // A third player joins late and gets the same world.
  await b.close(); // (this test machine is slow: two games at a time)
  const c = await browser.newPage({ viewport: { width: 800, height: 520 } });
  await c.addInitScript(() => localStorage.setItem('legosky.name', 'Cara'));
  await openGame(c, `city=carbondale&vehicle=plane&look=lego&room=${ROOM}`);
  await c.waitForFunction((pid) => window.__game.bot().props.byId.get(pid)?.scale === 2, pid, { timeout: 30000, polling: 300 });
  const late = await c.evaluate(({ boulder, plane }) => {
    const { props } = window.__game.bot();
    return { boulder: [props.byId.get(boulder).x, props.byId.get(boulder).z], plane: props.byId.get(plane).held };
  }, { boulder: pick.pid, plane: flew.pid });
  check('a late joiner sees the supersized car', true);
  check('... the thrown object where it landed', Math.hypot(late.boulder[0] - land[0][0], late.boulder[1] - land[0][1]) < 1);
  check('... and the parked plane taken', late.plane === true);
} finally {
  await browser.close();
  stop();
  relay.kill();
}
process.exit(failed() ? 1 : 0);

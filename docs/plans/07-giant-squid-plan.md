# 07 · Giant squid plan: a sea monster in the deep water of every city

Written 2026-11-15 for the session that builds it. Read `docs/plans/README.md` first for the repo rules (branch, Google key check, deploy command, how to test). The owner is not a programmer: explain results in plain language, say what was and wasn't tested, and end with the deploy command.

## What the owner asked for

A giant squid hides in deep water. It notices you when you come close, bursts out, grabs your plane, boat or robot with its tentacles and pulls you under, unless you get away or fight it off. In a multiplayer room everyone sees the same attack.

The owner's six points, kept as the core:

1. **Hiding.** Squids live in deep water spots in each city (San Francisco Bay, Hong Kong harbour, the Mississippi). Only a ripple or a shadow hints at one.
2. **Noticing you.** Fly low or drive a boat within about 150 m and it gets ready: bubbles, a rumble, a warning on screen.
3. **The attack.** Within about 60 m it bursts out with a big splash, tentacles reaching up. Tentacles are chains of linked pieces that curl and wave.
4. **Taking you down.** A tentacle that reaches you wraps around your vehicle and pulls it under: a "Grabbed by the squid!" crash and the respawn screen.
5. **Escaping.** Turbo, climbing fast, or a giant robot punching it makes it let go. Big robots can fight it.
6. **Multiplayer.** The server decides when the squid strikes, so everyone in the room sees the same attack.

## What this plan adds to make it better

- **A fair warning.** A plane covers 60 m in one second, so a strike at 60 m with no wind-up can't be dodged. The strike gets a 1.2 second wind-up you can see and hear (the water bulges, tentacle tips break the surface, a rising sound), and the ranges are measured from the water surface, so flying high is always safe.
- **A struggle instead of an instant loss.** A grab starts a 4 second struggle with a meter on screen. Each vehicle has its own way out (below). Only if the meter runs out are you pulled under.
- **A fight worth having.** The squid has health. Robot punches, thrown cars and stomps hurt it. Beat it and it flees for three minutes, the room gets a message, and your logbook counts it.
- **Feeding it.** A car thrown into the water near an awake squid is grabbed instead of you. It buys about 20 seconds.
- **Ink.** When it lets go or is hit hard it squirts ink: a dark cloud in the water and a two second splat on your screen.
- **Finding it.** Within 400 m the minimap shows a ripple mark, and the robot's first-person radar shows a blip. At night its eyes and spots glow.
- **A switch.** Settings gets "Sea monster: On / Off" (like the potty setting), for players who find it scary. It never attacks during the flying lesson, auto-land, or a room game.

## How it should play

States, in order: **asleep → aware → winding up → striking → holding (the struggle) → dragging under**, or after a miss, an escape or a meal: **recovering → sinking → resting** (45 seconds before it can wake again).

Who it goes for: your plane, the copter, the shuttle (flying or hovering), a boat or car the robot is driving, the robot wading or flying on its jets, and friends in the room. It ignores anything more than 80 m above the water, anything on a bridge deck, and anyone on dry land more than 30 m from the shore.

The way out, per vehicle (the struggle meter fills when you do these):

| You are | How you break free |
| --- | --- |
| Plane, shuttle in flight mode | Full throttle fills it slowly, turbo fast. A barrel roll (double tap left or right) snaps the tentacle at once. |
| Copter, shuttle in hover mode | Hold lift up; turbo helps. |
| Boat or car | The horn's boost (SMASH), mashed. |
| Robot | SMASH punches the tentacle holding you: a 1× robot needs three, 2× two, 4× and 8× one. A ¼× or ½× robot can't; it has to be rescued. |
| A friend nearby | Can punch the tentacle or throw a car at the squid to free you. |

Losing: a plane, copter or shuttle is pulled under and crashes with the reason "Grabbed by the giant squid! 🦑" (the normal crash screen, with Respawn). A boat is capsized and the robot is thrown out. The robot itself doesn't crash in this game, so it is dunked, loses what it carries, and is spat out onto the nearest shore with a message.

Fighting: 6 health. A punch does 1 (2× robot: 2; 4× and 8×: 3), a thrown car or bus 2, a stomp from high up 3. Each hit makes it flinch and squirt ink. At 0 it flees: "🦑 The squid has had enough!", three minutes asleep, `logbook.squid` goes up by one for everyone who hit it.

## How to build it

Three new files, small hooks elsewhere. Keep every tuning number in one `SQUID` table at the top of the brain file.

**`src/squidbrain.js`: the rules, with no drawing and no browser code.** A pure state machine: `step(state, now, events) → { state, out }`. It runs in two places from the same file: in the browser for solo and offline play (the PSG1 app is often offline), and inside `server/relay.js` for rooms (`package.json` has `"type": "module"`, so the relay can import it directly). This is the important design choice: one set of rules, so solo and multiplayer can't drift apart.

**`src/squid.js`: where squids live, how they look, how they move.**

- *Where.* The map has no depth data, only a 2048 × 2048 water mask (`world.isWater`). "Deep" means far from shore: on a coarse grid (about 40 m cells) find water cells and their distance to the nearest land, then take up to three spots per city that are at least 150 m from shore, 1.5 km from each other, 800 m from the runway start, the helipad and the toilets, and 150 m from any bridge (`world.deckAt` and `world.bridges.list`). Pick them with a fixed seed so every player computes the same spots (the props do this with `rng(1234)` in `src/props.js`). A city with no water that wide gets no squid; say so in the report. The water surface height at a spot is `world.groundAt(x, z)`.
- *Looks.* Lego-built in the Lego look, smooth in the realistic one, like the vehicles (`isLego()`). A mantle, two big eyes, eight arms and two longer tentacles. Each arm is a chain of 8 to 12 segments drawn as one `InstancedMesh` for all arms, posed each frame by a simple curl-and-reach function (no physics engine): rest pose waving, reach pose bending toward a target point, wrap pose circling it. Add it straight to the scene, not to `world.meshes`, so it also shows in Google 3D (where the map's own meshes are hidden).
- *Effects.* Reuse what exists: `rampage.burst` and `rampage.explode` for splashes, `sound.noiseHit('splash')`, `glowTexture()` from `src/nightlights.js` for glowing eyes, the camera `shake` variable in `main.js` for the rumble. The ripple and the shadow are two flat transparent discs on the water.

**`tools/tests/squid.mjs`: the test.**

Hooks in existing code:

- **`src/main.js`, the frame loop.** The chain that decides what moves you each frame already has a branch for "carried by a friend's giant robot" (`rgFrozen() || updateCarried()`). Add a `squidHolds()` branch the same way: while held, the squid sets `flight.pos`, and the normal flight update is skipped. This is the cleanest way to grab a plane, because `Flight` has no hook for outside forces. End a lost struggle with `flight.crash('Grabbed by the giant squid! 🦑')` for aircraft.
- **Inputs to the struggle.** Read what already exists: `flight.throttle`, `flight.turbo`, `flight.barrel` (a barrel roll in progress), `input.read().liftSet`, the `smash` action, `rampage.driving`, `bot.walk.size`.
- **Damage.** `rampage.blast(x, y, z, r, from)` is the one place punches, stomps and thrown things land. Have it also ask the squid whether the blast touched it.
- **Minimap and radar.** `drawMinimap()` in `main.js`; the robot display in `src/dashboard.js` (`nRadar`).
- **Settings.** `prefs.monster` next to `prefs.potty`, same style of buttons.

**Multiplayer (`server/relay.js`).** Per-room state already lives in `meta` (`{order, host, game, props, smashed, cars, opts}`); add `squids`. Clients send `squid-near` (I am inside a squid's range, with my position and vehicle kind), `squid-hit` (damage), `squid-fed`, and `squid-free` / `squid-lost` from the player being held, who is the judge of their own struggle (the same trust the game already gives to tag hits and high-fives). The relay runs the brain, picks one target, and broadcasts `squid` messages carrying the state and a server timestamp; clients animate from `mp.serverNow()`, as the shared traffic does. Add the squid states to the late-joiner catch-up. With no room, or offline, the client runs the same brain itself.

## Build order, each step with its check

1. **Spots and the sleeping squid.** Spots chosen, ripple and shadow drawn, minimap mark. *Check:* the test prints the spots for all nine cities; two page loads give the same spots; screenshots of one spot by day and by night.
2. **The brain and the solo attack on a plane.** Aware, wind-up, strike, hold, drag under, crash screen, rest. *Check:* stepping the simulation, a low pass ends in the squid crash reason; a pass at 100 m above the water is ignored; after a respawn the squid is resting and doesn't grab again at once.
3. **The struggle and every vehicle.** The meter, the escapes in the table, the robot dunking, the boat capsizing. *Check:* one test case per row of the table, each for "escapes" and "doesn't".
4. **Fighting and feeding.** Health, flinch, ink, fleeing, the logbook, a thrown car as bait. *Check:* three punches from a 2× robot make it flee; a car thrown in the water is taken instead of the player.
5. **Multiplayer.** *Check:* two browsers in one room (separate browsers, as in `tools/tests/friends.mjs`): both see the same squid wake at the same server time, the second player frees the first with a punch, a late joiner sees a fleeing squid as asleep.
6. **Setting, polish, speed.** The On / Off setting, glow at night, sounds. *Check:* `tools/tests/perf.mjs` for Hong Kong and San Francisco shows no more than about 3% extra frame time with a squid awake; the PSG1 build (`npx vite build --mode psg1`) builds, and on PSG1 or Low graphics the squid uses fewer arm segments.

Then run the existing tests that touch what changed (robot, barrel, hover, bridges, friends, sharedworld, roomgames3, psg1), commit, push, and give the deploy command.

## Things that will trip you up

- **The test browser is very slow** (about 1 frame a second with SwiftShader). Don't wait for real frames: step the brain and the flight directly (`__game.step`), and use real-time timers only where two browsers must agree. Run at most two game pages at once and don't rebuild `dist` while a test runs.
- **Respawn puts you back where you were a few seconds earlier**, which is still inside the squid's range. The 45 second rest is what stops an endless grab loop; test it.
- **The robot has no crash state.** Don't try to give it one; dunk it and put it ashore.
- **Hover mode swaps the flight object** (`toggleHover` in `main.js`): read the vehicle through `flight` and `plane` each frame, don't keep references.
- **Room games.** While a room game runs (`rgRun`), squids stay asleep, so they can't wreck a Sky Race or a Landing Contest.
- **Don't let it grab from bridges.** Cars and the robot on a deck are safe; check with `world.deckAt`.

## Questions for the owner (defaults in brackets, so the build doesn't wait)

1. Should the sea monster be on for everyone to start with? [On, with the setting to turn it off.]
2. Up to three squids in a big city, one in a small one? [Yes.]
3. Should beating it unlock something, such as a squid-ink paint job? [Logbook count only for now.]
4. A room game later, "Squid Hunt", where the room fights it together? [Not in this plan.]

## Prompt to start the build session

```txt
Read docs/plans/README.md and docs/plans/07-giant-squid-plan.md. Build the giant squid in the order the plan gives, checking each step as it says, on branch claude/lego-airplane-game-ttd82x. Use the defaults for the owner questions unless I answer them. Show me a screenshot of the squid attacking before you finish, tell me what was and wasn't tested, and give me the deploy command.
```

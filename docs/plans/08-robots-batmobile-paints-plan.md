# 08 · Distinct robots, the Batmobile (car, flying car, robot), and two new paint jobs

Written 2026-11-15 for the session that builds it. Read `docs/plans/README.md` first for the repo rules (branch, Google key check, deploy command, how to test). The owner is not a programmer: explain results in plain language, say what was and wasn't tested, and end with the deploy command. `CLAUDE.md` asks for small self-contained subtasks to go to a local Qwen model first; that model only exists on the owner's computer, so in a cloud session do those tasks directly.

Pull before starting: other sessions push to this branch (the giant squid of plan 07 may be in progress or finished), and `src/main.js` moves a lot.

## What the owner asked for

1. **Distinct robots.** Each starting vehicle should turn into its own robot. Pieces of the vehicle you were end up on the robot, because it transformed from it.
2. **A Batmobile** with three forms on the transform button instead of two: car, flying car, robot.
3. **Two more paint jobs**, free from the start: red-orange and rainbow.

Build them in the order C, A, B below: the paint jobs are an afternoon, the robots change one file, and the Batmobile is the big one and gets a robot kit from part A.

## Part C · Paint jobs (do first)

How paint works today (`src/main.js`): `PAINTS` is a list of `{ id, name, color, need, how }`; `applyPaint(model)` walks the model and recolours every material whose colour equals the vehicle's accent colour in `ACCENT` (`plane` yellow, `heli` pink, `jet` red). The robot is painted the same way, so its accent parts follow.

- **Red-Orange.** One line: `{ id: 'redorange', name: 'Red-Orange', color: 0xff5a1f, need: () => true, how: '' }`.
- **Rainbow.** `{ id: 'rainbow', name: 'Rainbow', rainbow: true, need: () => true, how: '' }`. One colour can't do it, so `applyPaint` gets a second path: collect the accent-coloured meshes, sort them from nose to tail (and top to bottom on the robot), and give each its own material in the next colour of red, orange, yellow, green, blue, purple, so the vehicle wears bands of colour. Materials are shared between meshes, so clone before recolouring. Then let the hues drift slowly (one full turn in about 20 seconds) by nudging those few materials each frame; on the PSG1 and Low graphics keep them still.
- **The swatch.** The paint buttons take a `--c` colour; give the rainbow one a gradient background.
- **Friends should see paint.** Today the multiplayer state message doesn't carry the paint, so friends always see the classic colours. Add `paint` to the state the client sends (`mp.send` of type `state` in `main.js`) and to what `src/multiplayer.js` keeps per player, and paint the friend's model when it is made (`makeVehicle`) or when their paint changes. This makes every paint job visible to friends, not only the new ones.

*Check:* both appear unlocked on a fresh browser profile; a screenshot of each vehicle and its robot in rainbow; a second browser in the same room sees the first one's rainbow.

## Part A · A different robot for each vehicle

Today `createRobot(kind)` in `src/robot.js` builds one body for everyone from boxes, with a colour palette per vehicle and a small extra: wings, a tail fin and a chest propeller for the plane, a rotor and boom for the copter. The shuttle only has a palette.

**The idea.** Keep one skeleton (it carries the walking, punching and carrying animation, and the game's collision and camera assume `ROBOT_HEIGHT = 13`), and give each vehicle a **kit**: the parts of that vehicle, placed where a transforming toy would put them, plus its own proportions. Restructure `createRobot` into the skeleton with named anchors (`torso`, `head`, `arms[0..1]`, `legs[0..1]`, `back`) and a `KITS[kind]` function that adds parts to them and may set a few proportions (shoulder width, limb thickness, head shape). Do not change the height, the collision radius or what the function returns (`group`, `body`, `hands`, `animate`, `punch`, `updateBoosters`, `cockpitEye`, `radius`, `onStep`).

Build kit parts in the same colours and shapes as the vehicle models (`src/airplane.js`, `src/heli.js`, `src/jet.js`), so a player recognises them. Parts in the vehicle's accent colour take the paint job automatically.

| Robot | What it wears from the vehicle | Build |
| --- | --- | --- |
| **Bush plane** | Wings folded on the back (as now) with the yellow ailerons; the three-blade propeller spinning on the chest; the two main wheels on the shoulders; the tail fin and tailplane as a back fin; the yellow intake pipe over one shoulder; the white floats as forearm guards; the pilot's cap on the head | Medium, the classic |
| **Ghost-Spider copter** | The rotor on a back mast (as now); the pink web lines across the chest; the four pink spider legs as back legs that twitch when it walks; the cyan intakes as shoulders; the tail boom and shrouded tail rotor as a tail; a round white head with big eyes, like the copter's nose | Slim limbs, light on its feet |
| **Passenger shuttle** | The clear-blue canopy with its white-and-red top as the chest; the red half-round wing split in two as shoulder shields; the grey spoiler as a head crest; the "21" tile on one shoulder; the rear window as a backpack; the four hover thrusters in the feet and hands, with blue flames when it jet-jumps | Broad and stocky |
| **Batmobile** (part B) | The long hood as chest armour; the two tail fins as a cape-like pair on the back; the four fat wheels on shoulders and hips; the dark canopy as a visor; pointed ears on the head; the yellow emblem on the chest; the jet exhaust on the back | Tall shoulders, narrow waist |
| **A parked plane you took** | The bush-plane kit in that plane's own colour (`plane.parked.tint`) | As the bush plane |

Also in this part:

- **The change itself.** Today the old shape spins and shrinks while the new one grows (`updateMorph` in `main.js`). Keep that, and add a half-second flourish on the robot: the kit parts start folded flat against the body and swing out as it finishes growing (a single 0 to 1 "unfold" value each kit can read). Cheap, and it sells "it transformed from it".
- **Friends.** `src/multiplayer.js` asks for a friend's robot as `bot-<vehicle>` and `main.js` calls `createRobot` with that, so new kits show for friends with no more work, as long as the vehicle names are passed through (see `ownKind` in part B).
- **The robot's own first-person view and dashboard** stay as they are.

*Check:* a screenshot of each of the four robots (five with a taken parked plane) from the front and the back, in classic colours and one paint job; the existing robot tests (`robot`, `growth`, `tinyrobot`, `toilet`, `gamepad`) still pass, since nothing about size or collision changed; a two-browser screenshot showing a friend's shuttle robot.

## Part B · The Batmobile: car, flying car, robot

A fourth vehicle in the menu. It starts as a car on the runway. The transform button cycles **car → flying car → robot → car**.

**Looks.** Long, low and black with a dark canopy, two tall tail fins, four fat wheels with yellow hubs, a yellow emblem on the hood, and a jet exhaust at the back (flame with the throttle, bigger in turbo). The yellow is its accent colour, so paint jobs recolour the hubs, emblem and trim. Flying car: a wing swings out from each side, the fins stand up, the wheels fold flat under the body, the exhaust burns. Lego-built in the Lego look, smooth in the realistic one, like the other vehicles. New file `src/batmobile.js`, modelled on `src/jet.js` (same return shape: `group`, `parts`, `wheels`, `floats`, `controls`, `updateBoosters`, `cockpitEye`, `cockpitHidden`, `gearHeight`, `radius`, plus flags).

**Car form.** A new small driving model, `CarDrive`, with the same face the flight models have (`pos`, `quat`, `vel`, `speed`, `throttle`, `ctrl`, `onGround`, `crashed`, `forward`, `right`, `up`, `heading`, `reset()`, `resetAirborne()`, `update(dt, input)`, `crash(reason)`), so the rest of the game can treat it like any vehicle. Copy the driving feel from `RobotWalk._drive` in `src/robot.js` (the code that drives a car the robot gets into): the stick or W/S is gas and reverse, left and right steer, it follows the ground with `world.groundAt`, drives over bridges with `world.deckAt`, and stops at walls with `world.blockedAt`. Differences for the Batmobile:

- Fast: about 160 mph on a road, more in turbo. Brake button is a handbrake.
- It bumps traffic and loose props out of the way (the robot's car already does this in `rampage.update`), but it does not knock buildings down: it bounces off. Smashing stays the robot's job.
- Water: it sinks. "Splash! The Batmobile can't swim. Take off first!" and the normal crash screen. (No floats; the float button does nothing in car form.)
- Headlights and tail lights at night (`vehicleLights` in `src/vehlights.js`), and its own first-person dashboard in `src/dashboard.js`: black with red-lit dials, a speedometer, a turbine gauge and a FORM light (CAR / FLIGHT).

**Flying-car form.** The existing plane model, `Flight`, with jet thrust like the shuttle (`thrustMul`, `noProp`, `level`, `jet` flags on the model). It takes off and lands like a plane, and barrel-rolls. Auto-land works.

**Robot form.** `createRobot('bat')` with the kit from part A.

**The three-way switch.** Today `transform()` in `main.js` flips between vehicle and robot, and the shuttle's `toggleHover()` shows how to swap one flight model for another in place (copy position, speed and heading, set the input mode, update the buttons). For the Batmobile:

- **Car → flying car:** swap `CarDrive` for `Flight` where it stands, keeping its speed. You are now a plane rolling on its wheels: give it throttle and pull up. Wings swing out over half a second.
- **Flying car → robot:** exactly what a plane does today, on the ground or in the air.
- **Robot → car:** if the robot is standing on the ground. If it is in the air (jet-jumping), it becomes the flying car instead, so you never drop as a car from the sky.
- The transform button and its hint name the next form: "🚗 Car", "🛫 Fly", "🤖 Robot".
- Restarts: "Take off" starts as the car at the runway; "Start in the air" starts as the flying car.

**Everywhere else a vehicle is named.** Search `main.js` for the helpers added with the shuttle and extend each: `VEHICLE_NAMES`, `createOwnModel`, `ownKind` (it currently lets only `heli` and `jet` through, so friends and room games would see a bush plane), `ACCENT`, the nav-light spec in `src/navlights.js`, the menu card in `index.html` (`#segVehicle`, now four cards: check the layout on a phone and on the PSG1's narrow screen), the room-game vehicle picker (`#rgVehicle`), the leaderboard icon, the "FLY your ..." labels for a vehicle left behind, the phone controller's telemetry, and `PALETTES` in `robot.js`. `src/multiplayer.js` also narrows the vehicle name. Friends need to see which form you are in: send it in the state message (a `form` field) and build the friend's model in that form.

**Rules with the rest of the game.**

- Room games that put everyone in a vehicle (Sky Race, Keg Rush, Landing Contest) use the flying-car form and lock the car form until the game ends. Robot games use the robot.
- The toilets, growing, getting into other vehicles and leaving yours behind all work from the robot form as for any vehicle; a Batmobile left behind is parked as the car.
- If plan 07's squid is in: it ignores the car on land, and treats the flying car like a plane.
- Controls: in car form the game must read the stick the way it does for the robot's car, not the way it does for a plane (pitch inverted, throttle on a slider). `src/input.js` has `botMode` and `heliMode` flags for this; add a `carMode` or reuse `botMode` while driving, and check keyboard, touch, a controller and the PSG1 mapping each.

*Check, in a new `tools/tests/batmobile.mjs`:* the menu offers it; it starts as a car and drives along a road and across a bridge; it bounces off a building and sinks in water with the right message; transform makes it a flying car that takes off, then a robot, then a car again on the ground; from a jet-jump the robot becomes the flying car; its dashboard shows in first person in both forms; a friend in a second browser sees each form; screenshots of all three forms, front and back, day and night. Then the existing `jet`, `hover`, `leftbehind`, `barrel`, `bridges`, `roomgame`, `friends` and `psg1` tests.

## Things that will trip you up

- **The test browser is very slow** (about one frame a second). Step the simulation directly (`__game.step`) instead of waiting for frames; run at most two game pages at once; don't rebuild `dist` while a test runs.
- **`isHeli`, `isBot`, `plane`, `flight` and `vehicle` are swapped in place** by `transform()`, `toggleHover()`, `enterParkedPlane()` and the leave-behind code. The Batmobile adds a third thing to swap. Read them fresh each frame; never hold a reference across a change. Trace one full cycle on paper before writing code: car, fly, robot, into another car, out, back to your Batmobile.
- **Materials are shared.** Recolouring one mesh's material recolours every mesh that uses it; clone first (the rainbow paint and the tinted parked-plane robot both need this).
- **`ROBOT_HEIGHT` is load-bearing.** Kits change the look and the proportions inside the same height, never the height.
- **Four menu cards** won't fit the three-column grid; give the vehicle picker two rows of two, or a scrolling row, and check the PSG1's 620 px layout.
- **The name.** "Batmobile", like "LEGO" and "Ghost-Spider" already in the game, is someone else's brand. Fine for the owner's own game; the README already says a public store listing would need those names and looks changed. Keep the name in one place (`VEHICLE_NAMES`) so it is easy to change.

## Questions for the owner (defaults in brackets, so the build doesn't wait)

1. The Batmobile's look: long, low and black with tall fins and a yellow emblem. [Yes.]
2. Should the car form smash buildings like a supersized car? [No: it bounces off; the robot smashes.]
3. Rainbow: bands of colour that slowly drift. [Yes; still on the PSG1.]
4. Should friends see your paint job in multiplayer? [Yes.]
5. Should the Batmobile get a gadget, such as a grappling hook or smoke screen? [Not in this plan.]

## Prompt to start the build session

```txt
Read docs/plans/README.md and docs/plans/08-robots-batmobile-paints-plan.md. Pull first. Build parts C, A and B in that order on branch claude/lego-airplane-game-ttd82x, checking each part as the plan says and pushing after each. Use the defaults for the owner questions unless I answer them. Show me screenshots of the four robots and the Batmobile's three forms before you finish, tell me what was and wasn't tested, and give me the deploy command.
```

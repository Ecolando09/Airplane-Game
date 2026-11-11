# Robot fixes plan

Four changes the owner asked for. Each section says how the game behaves today (with the code location), what to change, and how to tell it worked. File and line references are from commit `23e5a1d`; search for the quoted names if lines have moved.

## 1. Potty breaks: less often, and optional

**Today** (`src/main.js`, "potty breaks" section): `POTTY_EVERY = 210` seconds, and the first prompt comes after 75 seconds. Once the 💩 button appears it stays until you use a toilet. There is no way to turn it off or wave it away.

**Change:**

1. Add a setting in the menu's Settings box: **Potty breaks: Off / Sometimes / Often**. Store it in `prefs.potty`.
   - Sometimes (default): every 10 minutes, first one after 5 minutes.
   - Often: every 3.5 minutes (today's behavior).
   - Off: never prompts.
2. Make each prompt skippable: a small "Not now" (✕) on the button that hides it for a full interval. If ignored for 60 seconds, it goes away on its own.
3. Never prompt during a game (Ring Race, Rampage, Beer Run) or during the flying lesson.
4. Keep toilets usable at any time: when the robot or a landed vehicle is next to a toilet, offer "🚽 Sit" even with no prompt, so it becomes a fun thing to find rather than a chore.
5. Optional small reward for going (so "optional" still feels worth doing): count potty breaks in the pilot logbook.
6. Move the runway toilet farther from the runway centerline (it sits in the takeoff view today; see `_buildToilets` in `src/world.js`).

**Done when:** with Off, the button never appears in a 15-minute session; with Sometimes, the first prompt is at 5 minutes or later; "Not now" hides it for a full interval; no prompt appears during any game.

## 2. Supersized cars: get in and drive

Assumption to confirm with the owner: "the car that you blew up" means the car you made bigger with the supersizer (not one that exploded).

**Today** (`src/rampage.js`): driving exists, but getting in is easy to miss and easy to break.

- The only way in is pressing GRAB next to a drivable object at 2× or bigger (`grabOrThrow` → `enterCar`). The only cue is a 2.5-second message.
- **Likely main bug:** walking toward any object kicks it away. In `Rampage.update`, anything within `2.5 m + its radius` is launched when the robot moves faster than 6 m/s. A 4× car has a radius near 13 m, so it flies off before the robot is close enough to grab it.
- GRAB prefers a nearby moving traffic car over the supersized one if the traffic car is closer.
- Only five kinds are drivable (`drive: true` in `src/props.js`): car, school bus, golf cart, fuel truck, ice cream truck.

**Change:**

1. Do not kick objects that are 2× or bigger. Treat them as solid: the robot stops at them.
2. Show a clear prompt. When a drivable object at 2× or bigger is within reach, show a large **🚗 DRIVE** button (like the Auto-land button), a green arrow over the car, and the key/button name. Walking into the car also offers it.
3. Make GRAB choose the supersized drivable object first when one is in reach.
4. After supersizing something drivable while standing next to it, show the DRIVE prompt immediately.
5. While driving, relabel the on-screen buttons: JUMP → EXIT, SMASH → HORN (or boost). Turbo should speed up the car too.
6. Leave the car where the player gets out, at its size, so they can get back in.
7. Consider making boats drivable on water.

**Done when:** in a test, supersize a parked car twice, walk straight at it, and the car stays put; the DRIVE prompt appears; one press puts the robot in the car; driving into a building knocks it down; EXIT puts the robot beside the car; pressing DRIVE again re-enters.

## 3. Jetpack: hold jump to fly

**Today** (`src/robot.js`, `RobotWalk.update`): a jump starts at 24 m/s upward. Holding the button fires jets for `JET_TIME = 1.0` second only (thrust 36 m/s², plus 14 per turbo level, against gravity 30). After that second the robot falls, and the jets only refill on the next jump from the ground. That gives about 42 m of height (97 m at T3X).

**Change:**

1. Remove the one-second limit: holding jump keeps the jets burning for as long as it is held.
2. Use a climb-speed model so it is controllable: while held, ease the vertical speed toward a climb rate (about +18 m/s, higher with turbo); when released, fall under gravity with a terminal speed near −35 m/s.
3. Add a soft ceiling (about 600 m above the ground) where the jets fade, so the robot cannot leave the map vertically.
4. Give real steering in the air while the jets are on: raise air control (today `1.2`, try `4`) and let air speed reach running speed times turbo. This is what makes it "essentially fly".
5. Add a head-bump check. The robot's collision is horizontal only, so flying up under a bridge deck or arch (colliders with a `bottom`) can pass through them. Stop upward movement when the head meets one.
6. Keep the stomp: falling fast (over 32 m/s) still slams. Holding jump near the ground cushions the landing, so players can choose a soft landing or a stomp.
7. Show it: light the rocket pack whenever the jets are on, even without turbo (today the pack only appears when turbo is above 1; see `updateBoosters` in `src/main.js`), and add a looping jet sound. Pull the camera back a little while airborne.
8. Inputs to check: Space, the on-screen JUMP button held down, gamepad button, and the phone controller's Jump button. While driving, jump still means "get out".

**Done when:** holding jump from the ground climbs continuously past 300 m; releasing falls; tapping holds a rough hover; the robot can cross a city in the air at running speed or better; flying up under the Golden Gate deck stops at the deck; a fast drop still stomps.

## 4. "Invisible" things blocking the robot

**Findings from reading the code**, most likely first. Step 1 below confirms which apply before fixing.

1. **Google 3D look (most likely, and probably also the cause of the earlier "lifts above things" complaint).**
   - In Google 3D every map building keeps its collision outline but cannot be knocked down (`canBreak: () => !google` in `src/main.js`), and the visible world is Google's photo mesh, which does not line up exactly with those outlines. The robot hits walls it cannot see.
   - In Google 3D the ground height comes from Google's mesh (`world.heightAt = google.heightAt ?? gridHeight`), and that mesh includes rooftops. A walking robot is therefore lifted onto buildings.
2. **Hand-built landmarks have blocky collision.** `src/landmarks.js` has 27 `solid(...)` boxes that are simpler than what is drawn: Tokyo Tower's base is one 86 m square though you can see between its four legs; Sutro Tower is one box around three legs; the Buddha's round altar is a 60 m square; and so on.
3. **Sliding along walls snags on corners.** When something unbreakable is in the way, movement is tried along the X and Z axes separately (`RobotWalk.update`). On rotated buildings this catches on corners and feels like an invisible snag.
4. **The map edge is an invisible wall** (position clamp 1,400 m beyond the map in `src/robot.js`).
5. Minor: outlines of odd-shaped buildings are tested with a margin, so the robot can be stopped a couple of meters before the visible wall.

**Change:**

1. **Make the problem visible first.** Add a debug view (`?debug=colliders`, or a key) that draws wireframes of nearby collision shapes in different colors (breakable, landmark, tree) and logs what is blocking the robot whenever it is stopped for more than 0.3 seconds. Reproduce with the owner's steps (ask which city and which look) and confirm the cause.
2. **Google 3D:**
   - Walk on the bare-earth elevation grid, not on Google's mesh, so the robot stays on the ground (keep the mesh height only for flying vehicles' landings).
   - Decide with the owner how buildings behave there. Recommended: the robot passes through them with a one-time note that buildings are only solid and breakable in the Lego and Realistic looks, and Rampage switches to the Lego look. Alternative: draw a faint box around each building outline within 30 m so the walls are at least visible.
3. **Landmarks:** fit the collision to what is drawn. Add a round collider type to `World.inFootprint`, give towers one box per leg, and leave open space open.
4. **Movement:** replace the axis-by-axis slide with a slide along the wall (remove the part of the movement that points into the wall, using the nearest face or edge direction), and round corners. If the robot is stopped by something unbreakable for half a second, flash that object's outline so it is never invisible.
5. **Map edge:** show "Edge of the map" when the robot reaches it.

**Done when:** in the Lego look the robot can walk between Tokyo Tower's legs and around the Buddha's altar without stopping short; in Google 3D it stays on the ground and never stops at nothing; walking diagonally into a landmark slides along it; the debug view shows no collision shape without something drawn in it.

## Testing notes for all four

- `?debug` in the URL exposes `window.__game` (world, flight, plane, `transform()`, `bot()`, `botSmash()`, `botGrab()`), which headless Playwright tests can drive. The pre-installed Chromium needs `--use-gl=swiftshader --enable-unsafe-swiftshader`.
- The test machine draws frames slowly, so step the simulation directly (`flight.update(1/60, input)`, `rampage.update(1/60, bot)`) instead of waiting for real time.
- The earlier test scripts were kept in a scratch folder and are gone. Add tests to the repo this time (for example `tools/tests/`), so later changes can be checked.

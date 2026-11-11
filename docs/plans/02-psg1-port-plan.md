# PSG1 port plan

Goal: play Lego Sky on a PSG1 with the built-in buttons and sticks, full screen, at a good frame rate. Read `01-psg1-research.md` first for the facts and their reliability.

## Approach

**Recommended: wrap the existing web game in the Android app the repo already has**, tuned for the PSG1's screen and controls. A Unity rewrite is not recommended: it would discard the entire game, and the Unity SDK only adds an input layout the browser already provides through the Gamepad API.

| Option | Work | Verdict |
|---|---|---|
| Open play.latlas.lol in a browser on the PSG1 | None, if a browser exists | Try first (Phase 0) |
| PSG1 build of the existing WebView app, sideloaded | Small to medium | **Recommended** |
| Same app with the game files bundled inside, submitted to PlayGate | Medium, plus content cleanup | Only if a store listing is wanted |
| Rewrite in Unity | Months | No |

## Phase 0: check the device (do this before writing code)

Needs the user's PSG1 and the PlaySolana extension. About 30 minutes.

1. In the build session, call the extension's `get_psg1_specifications`, `get_adb_guide` and `list_sdk_docs`. Save the answers to `docs/plans/psg1-device-facts.md` and correct `01-psg1-research.md` where they differ.
2. On the PSG1: look for Developer Options (Settings → About → tap Build number seven times), turn on USB debugging, connect to a computer and run `adb devices`.
3. On the PSG1: look for any browser and open `https://play.latlas.lol/legoplane/`. Note whether it loads, whether the buttons do anything, and roughly how smooth it is.
4. Add a tiny diagnostics page to the site (`public/diag.html`) that prints `navigator.userAgent`, `innerWidth × innerHeight`, `devicePixelRatio`, WebGL2 support and renderer string, and live gamepad buttons and axes. Open it on the device and record the output.

**Decision gate:**
- ADB works → continue with Phases 1 to 5 (sideload).
- No ADB and no browser → the only routes are PlayGate or a DevKit; skip to Phase 6 and ask Play Solana.
- Browser works well → Phases 1 and 2 still improve it; Phase 3 becomes optional.

## Phase 1: a PSG1 screen profile

Files: `index.html`, `src/style.css`, `src/main.js`.

1. **Detect the PSG1.** Turn on a `psg1` mode when any of these is true: the app's user-agent tag (`LegoSkyPSG1/1`, see Phase 3), a `?psg1` URL parameter (for testing on a computer), or a connected gamepad whose id contains `psg1`. Add `body.psg1`.
2. **Fix the layout size.** The CSS viewport will be tiny (about 470 × 410 if the pixel ratio is 2.6). In `psg1` mode set the viewport meta to a fixed logical width (for example `width=620`, which makes the page 620 × 540) so every panel can be designed against one known size.
3. **Lay out the HUD for 620 × 540:** speed box top-left, Menu top-right, minimap smaller (about 150 px) bottom-right, game strip (Beer Run, Ring Race, Rampage) top-center at about 300 px wide, messages in the middle band.
4. **Hide all touch controls** (`#touch`): the console has real buttons. Keep touch working for menus.
5. **Menu:** one column, full width on the left 60% or as a full-screen sheet; city cards stay a horizontal row.
6. **Camera:** the screen is nearly square, so widen the vertical field of view a little (try 72° instead of 65°) so the sides don't feel cropped.
7. **Render size:** draw at exactly 1240 × 1080 (set the renderer pixel ratio from the real size, not from `devicePixelRatio`).

Done when: on a computer, `?psg1` in a 1240 × 1080 window (device toolbar at DPR 2) shows no overlapping panels in the menu, in flight, in robot mode and in each game.

## Phase 2: controls

Files: `src/input.js`, `src/main.js`, `index.html`.

The game already reads a standard gamepad. Proposed PSG1 mapping (labels as printed on the PSG1):

| PSG1 control | Flying | Robot |
|---|---|---|
| Left stick | Steer and pitch | Walk and turn |
| Right stick | Rudder (left/right); helicopter lift (up/down) | Sidestep; (later) look around |
| R trigger / L trigger | Throttle up / down | Run (R trigger) |
| B (bottom) | Brake | Jump / jetpack (hold) |
| A (right) | Floats | Grab, throw, get in car |
| Y (left) | Robot mode | Back to vehicle |
| X (top) | Camera | Camera |
| R1 | Turbo | Smash |
| L1 | Auto-land when offered | Turbo |
| D-pad up / down | Big map / potty | Supersize bigger / smaller |
| D-pad left / right | (free) | (free) |
| Start | Menu / pause | Menu / pause |
| Select | Big map | Big map |

Tasks:

1. Add a `psg1` button table in `Input.pollButtons` and `Input.read` next to the existing Xbox one.
2. **Menu navigation with the D-pad.** Today the menu needs a tap or a mouse. Add focus movement between menu buttons (D-pad), A to press, B to go back, L1/R1 to change city. This is the largest task in this phase.
3. Make every pop-up (crash box, end-of-game card, potty button, auto-land button, lesson) operable by a button, and show the PSG1 button on it.
4. Replace keyboard hints with PSG1 button names in `psg1` mode, including the flying lesson's steps. The SDK's glyph images are MIT-licensed and can be used.
5. **Fallback if the WebView doesn't expose the Gamepad API:** in the Android app, catch key and stick events (`dispatchKeyEvent`, `onGenericMotionEvent`) and pass them to the page with `evaluateJavascript`, feeding a virtual gamepad in `input.js`.
6. Stop the B button from acting as Android "Back": the app must consume gamepad key events itself. (On many Android handhelds an unhandled B press becomes Back, which would open the menu or close the app.)

Done when: with a USB or Bluetooth gamepad on a computer in `?psg1` mode, a player can start from the menu, fly, transform, play each game and restart without touching mouse, keyboard or screen.

## Phase 3: the PSG1 app

Files: `android/`, `deploy/build-apk.sh`, `deploy/install-play.sh`.

1. Add a PSG1 variant of the app: its own package id (for example `lol.latlas.legosky.psg1`), app name, and user-agent tag `LegoSkyPSG1/1`. It loads `https://play.latlas.lol/legoplane/?psg1`.
2. Manifest: landscape (confirm the natural orientation in Phase 0), gamepad required, touchscreen not required, immersive full screen, keep screen on.
3. Give `deploy/build-apk.sh` a variant switch and have `deploy/install-play.sh` publish `downloads/lego-sky-psg1.apk` next to the phone APK. The existing no-Android-Studio pipeline (aapt, dx, zipalign, apksigner) keeps working. Note: `dx` cannot compile Java lambdas; use anonymous classes.
4. Install with `adb install -r lego-sky-psg1.apk` (exact steps from the extension's ADB guide).

Done when: the app icon appears on the PSG1, opens full screen, and the game is playable with the built-in controls.

## Phase 4: performance on the PSG1

Files: `src/main.js`, `src/world.js`, `src/traffic.js`.

1. Add an on-screen frame counter (`?fps`) and measure each city on the device.
2. Add a "PSG1" quality preset between Low and High: native resolution, 1024 shadow map, about 900 cars, normal fog. Make it the default in `psg1` mode.
3. Add automatic scaling: if frames stay slower than about 22 ms for two seconds, lower the render scale one step; raise it again when there is headroom.
4. Test the heavy maps (Hong Kong & Shenzhen at about 25 MB of data, Tokyo, Denver). If the WebView runs out of memory, the app's existing "renderer died" handler reloads; reduce those cities' building budget for `psg1` if needed.
5. Check heat and battery over a 20-minute session.

Target: 45 fps or better in the small cities and 30 fps or better in the big ones.

## Phase 5: play offline (optional, needed for a store build)

1. Bundle the built site inside the APK and serve it to the WebView from the app's assets (`shouldInterceptRequest` on a fixed in-app address works with the plain Android SDK; no AndroidX needed).
2. City data is about 133 MB in total. Bundle two or three small cities; download and cache the others on first use.
3. The game currently finds the multiplayer and leaderboard server from the page address. Make that address a setting (`window.LEGOSKY_CONFIG.relay`) so a bundled build still reaches `wss://play.latlas.lol/ws`.
4. Google 3D look: the Google key is restricted to the website address, so it will not work from a bundled app. Leave Google 3D off in the PSG1 build unless a separate Android-restricted key is created.

## Phase 6: PlayGate store listing (optional)

1. Create a developer account at `playgate.playsolana.com` and read the current requirements (use the extension's docs tools). Ask Play Solana two things: do they accept non-Unity APKs, and are wallet or quest features required?
2. Prepare the signed release APK or AAB, icon, banner, description, age rating. Keep the signing key backed up.
3. **Content that must change before any public store listing** (this is a real blocker, not a formality):
   - "LEGO", the brick logo styling and "LEGO Technic 42198" are LEGO Group trademarks. Rename the game and the plane.
   - "Ghost-Spider" is a Marvel character. Rename and recolor the helicopter.
   - The Denny's sign and name on the Spartanburg tower.
   - The family pins (home addresses, "Papa Doug's House", "Nan's House") must be removed from a public build for privacy.
   - Keep the map-data and satellite credits (OpenStreetMap/Overture, Copernicus Sentinel).
4. Optional Solana features if required or wanted: post Ring Race, Rampage and Beer Run scores to PlayDex leaderboards, and use the PlayID name on the leaderboard. The public SDK has no code for these, so this needs Play Solana's help.
5. Follow the staged rollout: Test → Pilot → Public.

## Risks

| Risk | Likelihood | What to do |
|---|---|---|
| Retail PSG1 blocks sideloading | Unknown | Phase 0 decides. Fall back to a browser, PlayGate or a DevKit |
| WebView too old or no Gamepad API | Low to medium | Diagnostics page in Phase 0; native input bridge (Phase 2, task 5) |
| Layout unreadable on the small, nearly square screen | High without Phase 1 | Fixed logical viewport and a dedicated layout |
| Big cities too slow or run out of memory | Medium | PSG1 preset, auto scaling, smaller building budgets |
| Store rejects for trademarks | High as the game stands | Rename and recolor before submitting (Phase 6, task 3) |

## Suggested order and size

1. Phase 0 (30 minutes, needs the device).
2. Phases 1 and 2 together (the bulk of the work; testable on a computer).
3. Phase 3 (short).
4. Phase 4 (needs the device).
5. Phases 5 and 6 only if a store listing is wanted.

# Lego Sky: plans for the next build session

Written 2026-11-11 for whoever (person or AI) does the building. Two projects:

1. **PSG1 version**: get the game running on the Play Solana PSG1 handheld.
   - `01-psg1-research.md`: what is known about the device, with how reliable each fact is.
   - `02-psg1-port-plan.md`: the step-by-step plan (screen layout, controls, app, performance, store).
   - `04-playsolana-extension-plan.md`: explore the PlaySolana extension, then build the PSG1 version with it.
2. **Robot fixes**: four changes to robot mode.
   - `03-robot-fixes-plan.md`: potty breaks optional, driving supersized cars, jetpack flight, invisible blockers.

## Status (updated 2026-11-11)

| Plan | Status |
|---|---|
| `03` sections 1 to 3 (potty, driving, jetpack) | **Done** (commit 4b09bb2). Tests: `tools/tests/robot.mjs` |
| `03` section 4 (invisible blockers) | **Done** (be7e96f). Tests: `tools/tests/blockers.mjs`. Collision view: backquote key or `?debug=colliders` |
| `02` Phase 0 diagnostics page | **Done**: `https://play.latlas.lol/legoplane/diag.html`. The on-device checks still need the owner and the PSG1 |
| `02` Phases 1, 2, 4 (layout, controls, menus, performance) | **Done** (380bb00). Tests: `tools/tests/psg1.mjs`. Try on a computer with `?psg1&fps` in a 620 x 540 window |
| `02` Phase 3 (PSG1 app) | **Done**: `deploy/build-apk.sh OUT.apk psg1`, published at `https://play.latlas.lol/downloads/lego-sky-psg1.apk` |
| `04` Part A (explore the extension) | **Not started**: needs a session in the Claude desktop app on the owner's computer |
| `04` Track 1 (Unity shell) | Waiting on Part A. The web side it loads (`?psg1`, `window.legoSkyPad`) is ready |
| `02` Phases 5, 6 (offline build, store) | Not started (only if a store listing is wanted) |

Run all tests: `npx vite build && node tools/tests/robot.mjs && node tools/tests/blockers.mjs && node tools/tests/psg1.mjs`

## Recommended order

1. Robot fixes 1 to 3 (potty, driving, jetpack). Small, independent, testable without the device.
2. Robot fix 4 (invisible blockers). Start with the debug view; ask the owner which city and look they were in.
3. Explore the PlaySolana extension (`04` Part A). Must run in the Claude desktop app on the owner's computer.
4. PSG1 Phase 0 (check the device). Needs the owner and the PSG1.
5. Build the PSG1 version: `04` Track 1 together with `02` Phases 1, 2 and 4.
6. `02` Phases 5 and 6 only if a store listing is wanted.

## Questions for the owner before starting

1. Does "the car that you blew up" mean the car you supersized? (The plan assumes yes.)
2. Where did the robot get blocked by invisible things: which city, and which look (Lego, Realistic or Google 3D)?
3. In Google 3D, should the robot pass through buildings (recommended) or should their outlines be drawn?
4. PSG1: is the goal to play on your own device (sideload), or a public listing in the Play Solana store? A public listing needs the game renamed and the LEGO, Marvel and Denny's references and family pins removed.
5. Can you run the Phase 0 checks on the PSG1 (Developer Options, USB debugging, browser)?
6. Is Unity installed on your computer, or are you willing to install it (several GB)? The extension's build tools need it.

## Things the builder needs to know about this repo

- **Branch:** `claude/lego-airplane-game-ttd82x`. Commit and push there. Do not open a pull request unless asked.
- **Stack:** Three.js + Vite. `src/main.js` is the hub (about 2,500 lines); robot code is in `src/robot.js`, `src/rampage.js`, `src/props.js`; the world and collision are in `src/world.js`; hand-built landmarks in `src/landmarks.js`; input in `src/input.js`.
- **Never commit the Google Maps key.** Before every commit run `git diff --cached | grep -c "AIza[S]y"` and make sure it prints 0 (the brackets keep this line from matching itself). The key lives only on the server.
- **Deploy:** the owner runs one command on their server after each push:
  `curl -fsSL https://raw.githubusercontent.com/Ecolando09/Airplane-Game/<commit>/deploy/install-play.sh | bash`
  Give them that line with the new commit id every time.
- **Server access:** SSH from a cloud session is blocked; the owner runs server commands.
- **Testing:** headless Chromium with Playwright is available. Launch with `--use-gl=swiftshader --enable-unsafe-swiftshader`. Add `?debug` to the URL to get `window.__game`. Run `node server/relay.js` and `npx vite preview --port 4173` for multiplayer and leaderboards. The machine renders slowly, so step the simulation directly in tests.
- **PlaySolana extension:** it is installed in the owner's Claude desktop app ("PlaySolana Developer Tools + Unity"). It is only available in sessions that run on that computer, not in cloud sessions. Use its `get_psg1_specifications`, `get_adb_guide`, `list_sdk_docs` and `get_sdk_doc` tools in Phase 0.
- **Owner:** not a programmer. Explain results in plain language, say what was and wasn't tested, and always end with the deploy command.

## Prompt to start the build session

Copy this into a new session on the repo:

> Read `docs/plans/README.md` and the four plan files next to it. Ask me the "Questions for the owner" first. Then implement `03-robot-fixes-plan.md` sections 1 to 3, test each in headless Chromium, commit and push to `claude/lego-airplane-game-ttd82x`, and give me the deploy command. After that, do section 4 starting with the debug view. For the PSG1, start with Part A of `04-playsolana-extension-plan.md` (explore the PlaySolana extension and write the notes file), then Phase 0 of `02-psg1-port-plan.md`, and tell me exactly what to check on my PSG1. This part needs a session in the Claude desktop app on my computer.

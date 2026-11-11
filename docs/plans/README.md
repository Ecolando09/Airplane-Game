# Lego Sky: plans for the next build session

Written 2026-11-11 for whoever (person or AI) does the building. Two projects:

1. **PSG1 version**: get the game running on the Play Solana PSG1 handheld.
   - `01-psg1-research.md`: what is known about the device, with how reliable each fact is.
   - `02-psg1-port-plan.md`: the step-by-step plan.
2. **Robot fixes**: four changes to robot mode.
   - `03-robot-fixes-plan.md`: potty breaks optional, driving supersized cars, jetpack flight, invisible blockers.

## Recommended order

1. Robot fixes 1 to 3 (potty, driving, jetpack). Small, independent, testable without the device.
2. Robot fix 4 (invisible blockers). Start with the debug view; ask the owner which city and look they were in.
3. PSG1 Phase 0 (check the device). Needs the owner and the PSG1.
4. PSG1 Phases 1 to 4.
5. PSG1 Phases 5 and 6 only if a store listing is wanted.

## Questions for the owner before starting

1. Does "the car that you blew up" mean the car you supersized? (The plan assumes yes.)
2. Where did the robot get blocked by invisible things: which city, and which look (Lego, Realistic or Google 3D)?
3. In Google 3D, should the robot pass through buildings (recommended) or should their outlines be drawn?
4. PSG1: is the goal to play on your own device (sideload), or a public listing in the Play Solana store? A public listing needs the game renamed and the LEGO, Marvel and Denny's references and family pins removed.
5. Can you run the Phase 0 checks on the PSG1 (Developer Options, USB debugging, browser)?

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

> Read `docs/plans/README.md` and the three plan files next to it. Ask me the "Questions for the owner" first. Then implement `03-robot-fixes-plan.md` sections 1 to 3, test each in headless Chromium, commit and push to `claude/lego-airplane-game-ttd82x`, and give me the deploy command. After that, do section 4 starting with the debug view. For the PSG1, start with Phase 0 of `02-psg1-port-plan.md`: use the PlaySolana extension's tools to confirm the device facts and tell me exactly what to check on my PSG1.

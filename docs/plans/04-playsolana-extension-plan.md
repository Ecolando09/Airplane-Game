# PlaySolana extension plan: explore it, then build a PSG1 version with it

The owner installed the **"PlaySolana Developer Tools + Unity"** extension in the Claude desktop app and wants a version of the game built with it. This plan covers exploring the extension and using it to produce a PSG1 build. It works alongside `02-psg1-port-plan.md`: that plan's screen and control work (its Phases 1 and 2) is needed either way.

## Where this has to run

The extension is a desktop extension. Its tools exist only in Claude sessions that run **on the owner's computer** (the Claude desktop app, or Claude Code on that machine). A cloud session cannot see them, which is why the research in `01-psg1-research.md` could not use them. The extension's Unity tools also drive a Unity editor on that same computer.

Needed on the owner's computer:
- The Claude desktop app with the extension enabled (done).
- The game's repository checked out locally.
- For any Unity work: Unity Hub with a Unity LTS release and its **Android Build Support** module (includes the Android SDK and NDK).
- A USB cable for the PSG1.

## Part A: explore the extension (about an hour, no code)

Known tools, from the owner's screenshot and the extension's web page: Start game development, List sdk docs, Get sdk doc, Get brandkit, Get litepaper, a PSG1 specifications tool, an ADB guide tool, and Unity control tools. Seven are read-only.

1. **List every tool** the extension offers with its description and inputs. Save the list in `docs/plans/psg1-extension-notes.md`.
2. **Read all the SDK docs**: call List sdk docs, then Get sdk doc for each entry. Save a short summary of each, and the full text of anything about input, screen, build settings, wallet, PlayDex, PlayID and publishing.
3. **Get the official device facts**: call the specifications tool and the ADB guide tool. Update `01-psg1-research.md`, replacing "Search" and "Community" facts with official ones, and resolve its listed conflicts (screen orientation, sticks and triggers, storage).
4. **Get the brand kit and litepaper** for store-listing rules and artwork requirements.
5. **Try Start game development in a throwaway folder** (not in the game's repo) and study what it creates: Unity version, packages, build settings, input setup, sample scenes, and any wallet or leaderboard hooks.
6. **Answer these questions** in the notes file. They decide Part B:
   - Does the scaffold or the docs support anything other than Unity (web, native Android)?
   - What do the Unity control tools do (open project, edit scenes, build, install on device)? Do they need a running Unity editor?
   - Is there a documented way to install on a retail PSG1 over USB?
   - What does PlayGate require of a submitted build? Is the SDK mandatory? Are wallet features mandatory?
   - Are there PlayDex leaderboard or quest APIs a game can call, and from what languages?

**Deliverable:** `docs/plans/psg1-extension-notes.md`, plus a one-paragraph recommendation of which track below to follow.

## Part B: build the PSG1 version

Three tracks, from least to most work. Part A decides between them; the recommendation below is the starting assumption.

### Track 1 (recommended first): Unity shell around the existing game

Use the extension's scaffold and the official SDK to make a proper PSG1 Unity project whose only scene shows the existing web game full screen.

Why this track: it is built with the official tools and passes through the official pipeline (Unity project, PlaySolana SDK, signed APK, ADB install, later PlayGate), yet keeps every feature of the current game. All nine places, both vehicles, robot mode, the games and multiplayer keep working, because the game itself is unchanged.

Steps:
1. Run Start game development to scaffold the project into a new folder in the repo (for example `psg1/`). Commit the scaffold untouched first, so later changes are easy to see.
2. Add a full-screen web view to the single scene. Use a maintained open-source Unity web view for Android (for example `gree/unity-webview`), pointed at `https://play.latlas.lol/legoplane/?psg1`.
3. Controls: first check whether the page's own Gamepad API sees the PSG1 controls through the web view (the diagnostics page from `02-psg1-port-plan.md` Phase 0 shows this). If not, read the controls in Unity through the SDK's `PSG1` input device and forward them to the page with the web view's "run JavaScript" call, feeding the virtual gamepad described in `02-psg1-port-plan.md` Phase 2.
4. Apply the SDK's build settings from the docs (ARM64, the required Android version, orientation, package id).
5. Build with the extension's Unity tools if they can build; otherwise from the Unity editor. Install with the steps from the ADB guide tool.
6. Do Phases 1, 2 and 4 of `02-psg1-port-plan.md` (PSG1 layout, button mapping and menu navigation, performance). They are web-side changes and apply unchanged.
7. If Part A found leaderboard or identity APIs: post Ring Race, Rampage and Beer Run scores to PlayDex and show the PlayID name, called from Unity when the page reports a finished game.

Done when: the Unity-built app installs on the PSG1 through the documented route, opens straight into the game, and every mode is playable with the built-in controls.

Risk: a web view inside Unity adds a layer. If it performs worse than the plain Android app from `02-psg1-port-plan.md` Phase 3, ship that plain app for personal use and keep the Unity shell only if the store requires it. Building both costs little, because they load the same page.

### Track 2: plain Android app, with the extension used for facts and install

This is `02-psg1-port-plan.md` as written. The extension contributes the official specs, the ADB steps and the store rules, but not the build. Choose this if Part A shows the SDK and Unity are not required for what the owner wants (playing on their own device).

### Track 3: native Unity version (large; only after a trial)

Rebuild the game in Unity so it is a "real" PSG1 title with no web view. This is months of work for the whole game, so do a small trial first and decide from the result.

Trial (one to two sessions):
1. Scaffold with Start game development.
2. Write a C# loader for the existing city files. `public/cities/<city>.json` is plain data: building boxes and outlines, roads, water, land, elevation, trees, landmarks. Nothing in it depends on Three.js. Draw buildings and trees with GPU instancing, one mesh per map chunk.
3. Port one vehicle's flight model from `src/flight.js` (about 220 lines of plain math) and the chase camera.
4. Load Spartanburg, fly the plane with PSG1 controls, measure the frame rate on the device.

Decide after the trial. If it runs clearly better than the web view and the owner wants a native title, port in this order: helicopter, robot and destruction, props, HUD and menu, games, multiplayer. Expect each to take about as long as it did originally. If the trial is not clearly better, stop and stay on Track 1.

## Order of work

1. Part A (explore). Short, and it removes most of the unknowns.
2. `02-psg1-port-plan.md` Phase 0 on the device, using the ADB guide from Part A.
3. Track 1 steps 1 to 5, in parallel with `02-psg1-port-plan.md` Phases 1 and 2.
4. Performance pass on the device.
5. Decide about a store listing (see the content cleanup list in `02-psg1-port-plan.md` Phase 6) and about the Track 3 trial.

## What to tell the owner up front

- This part must run in the Claude desktop app on their computer, not in the cloud app, because that is where the extension and Unity live.
- Unity is a large install (several GB with Android support).
- Nothing in this plan has been verified against the extension yet. Part A exists to do that, and the track may change once its notes are written.

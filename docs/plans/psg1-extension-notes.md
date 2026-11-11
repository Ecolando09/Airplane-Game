# PlaySolana extension notes (plan 04, Part A)

Explored 2026-11-10 in the Claude desktop app on the owner's computer, with the
"PlaySolana Developer Tools + Unity" extension. Everything below was read from
the extension's own tools, so it replaces the "Search" and "Community" facts in
`01-psg1-research.md`.

## Recommendation

**Follow Track 2: the plain Android app that already exists (port plan Phase 3,
`deploy/build-apk.sh OUT.apk psg1`). Skip the Unity shell (Track 1) for now.**

The extension's own rules for porting say a web or JavaScript game should stay
on the web and ship as a wrapped web app (a "PWA to APK" built with Capacitor or
Bubblewrap). They name Three.js as the recommended 3D framework, and they say
not to suggest Unity unless the owner is an experienced developer who asks for
it. The Unity SDK only adds an input layout and an editor simulator; it has no
wallet, leaderboard or publishing code. A web-view app that loads the live game
fits the official path. Unity is also not installed on this computer, and the
extension's Unity tools only work with a running Unity editor. Revisit Track 1
only if PlayGate turns out to require a Unity build. Nothing found so far says
it does: the stated requirement is "an APK (Android 12)" signed with a
consistent keystore.

## 1. Tools the extension offers

Read-only:

| Tool | Inputs | What it returns |
|---|---|---|
| `start_game_development` | `intent`: new-game, adaptation or unsure | Rules and workflow text, not files. It creates **no project**; plan 04's "scaffold in a throwaway folder" step does not apply. |
| `get_psg1_specifications` | none | Official hardware table and industrial-design notes |
| `get_adb_guide` | none | ADB commands for install, launch, input, logs, screenshots, profiling |
| `list_sdk_docs` | none | Six Unity SDK pages |
| `get_sdk_doc` | `slugs`: Introduction, Installation, Keys, Input-System, Sample-Scene, Simulator | Those pages (copies of developers.playsolana.com) |
| `get_brandkit` | none | Logos and colours |
| `get_litepaper` | none | Project background (PlayGate, PlayDex, PlayID, $PLAY) |

Unity control (all need Unity open with the `com.gamelovers.mcp-unity` package
and its server started on port 8090, Tools → MCP Unity → Server Window → Start
Server):

| Tool | Actions |
|---|---|
| `unity_editor` | recompile scripts, read or write console logs, run tests, add a package, run a menu item, batch operations |
| `unity_scene` | get info, create, load, save, delete, unload scenes |
| `unity_gameobject` | inspect, create, duplicate, delete, reparent objects; add an asset; make a prefab |
| `unity_transform` | change components, position, rotation, scale |
| `unity_material` | create, assign, change and inspect materials |

None of the Unity tools builds an APK or installs on a device. For Unity
projects the extension says the owner builds the APK from the editor
(File → Build Settings → Android → Build).

## 2. SDK docs, summarised

- **Introduction**: PlaySolana-Unity.SDK provides two things, a custom input
  device for Unity's New Input System and a PSG1 screen simulator. Source:
  `github.com/playsolana/PlaySolana.Unity-SDK`.
- **Installation**: Unity 2021.3 LTS or newer; add the package from the git
  URL `https://github.com/playsolana/PlaySolana.Unity-SDK.git`. An Asset Store
  listing is "soon".
- **Keys** (full text kept below): every physical button reaches games except
  Volume Up, Volume Down, Fingerprint and Home. **No L2/R2 triggers.**
- **Input-System**: the firmware presents the controls as a **standard Android
  gamepad with D-pad buttons**. In Unity, bind under Gamepad → PSG1.
- **Sample-Scene**: a `PSG1Input` scene shows the bindings.
- **Simulator**: 1240 × 1080 at 3.92 inches, correct DPI, multi-touch.

### Keys page (input-relevant text)

- A (right): confirm, interact. B (bottom): jump or cancel/back. X (top):
  secondary, menus, items. Y (left): attack, shoot, run.
- D-pad: menus and movement. Left stick: movement. Right stick: camera or
  secondary movement.
- Start/Menu: pause and options. Select/View: secondary menus and overlays.
- L and R shoulder buttons: quick actions and modifiers.
- Button glyph images (for on-screen hints) are hosted at
  `https://ps-public-bucket.fra1.cdn.digitaloceanspaces.com/uploads/` as
  `a_psg1.png`, `b_psg1.png`, `x_psg1.svg`, `y_psg1.png`, `start_psg1.png`,
  `L.svg`, `R.svg`, `stick.svg`, `stick-1.svg`, `D-Pad*.svg`.

## 3. Official device facts

| Item | Official value | Change from `01-psg1-research.md` |
|---|---|---|
| Chip | Rockchip RK3588S2, 4× Cortex-A76 + 4× Cortex-A55 | Was "RK3588S" |
| Graphics | Mali-G610 MP4; OpenGL ES 3.2, Vulkan 1.2 | Confirmed |
| Memory / storage | 8 GB / **128 GB** | Storage conflict resolved |
| Screen | 3.92-inch OLED, **1240 wide × 1080 tall**, multi-touch | Confirmed; the community skill's "portrait screen" was wrong |
| Body | A **portrait (tall) one-piece handheld**: screen on top, controls below | This is what the community skill meant |
| Controls | D-pad, A/B/X/Y diamond (X top, Y left, A right, B bottom), Select, Start, Solana button, **two analog sticks**, L and R shoulders | Sticks confirmed. **No triggers** |
| System | EchOS, based on Android 12; **no Google services** | Confirmed |
| Wireless, battery | Wi-Fi 6, Bluetooth 5.4, 5000 mAh | Confirmed |
| Wallet | SvalGuard, hardware-backed, uses the fingerprint sensor | New |

### Conflicts still open (check on the device)

1. **Which Android code the A button sends.** The ADB guide says A is key code
   96 (`BUTTON_A`) and B is 97 (`BUTTON_B`). The SDK source read earlier says
   the right button (A) sends `BUTTON_B`. The PSG1 app's bridge
   (`MainActivity.java`) follows the SDK source. Check with the diagnostics
   page: press A and see which browser button number lights up. If it is 0,
   swap A and B in the bridge.
2. **Trigger axes.** The SDK source defines `AXIS_BRAKE`/`AXIS_GAS`, but the
   official specs and docs say there are no triggers. The game now works the
   throttle with the sticks (below), so this no longer matters for play.

## 4. ADB guide (how to install on the PSG1)

- `adb devices`; or over Wi-Fi `adb connect <ip>:5555`.
- `adb install -r app.apk` (keep data) or `adb install -t -r app.apk` (test build).
- Launch: `adb shell monkey -p <package> -c android.intent.category.LAUNCHER 1`.
- Simulated buttons: `adb shell input keyevent 96` (A), `97` (B), `19`–`22` (D-pad).
- Logs: `adb logcat`; screenshots: `adb exec-out screencap -p > screen.png`.
- Performance: `adb shell dumpsys gfxinfo <package>`, `dumpsys meminfo <package>`.

The guide's existence implies a retail PSG1 can take USB installs, but this is
still unverified on the owner's unit (see Phase 0).

## 5. Brand kit and litepaper (for a later store listing)

- Logos: full-colour (dark backgrounds only), white, gray, mark-only, at
  `https://ps-public-bucket.fra1.digitaloceanspaces.com/uploads/`.
- Colours: accent green `#00FFB5`, accent purple `#E005F6`, brand gradient
  between them (sparingly). Backgrounds `#1C1628` and `#0A080D`, never pure black.
- PlayGate is the submission portal (upload builds, verify requirements,
  Test → Pilot → Public). PlayDex holds quests, leaderboards and XP; PlayID is
  the cross-game identity. **No public API for PlayDex or PlayID is documented
  in the extension**, so plan 04 Track 1 step 7 (post scores to PlayDex) has
  nothing to call yet.
- The extension's rules encourage a wallet (Solana Mobile Wallet Adapter,
  Jupiter Wallet only, $PLAY token), but nothing says it is required for a
  submission.

## 6. Answers to plan 04's questions

| Question | Answer |
|---|---|
| Anything other than Unity supported? | **Yes.** Web games packaged as an APK are the extension's default recommendation. |
| What do the Unity tools do? Need a running editor? | Edit scenes, objects, materials, run tests and menu items. Yes, a running editor with the mcp-unity package. They do not build or install. |
| Documented way to install on a retail PSG1 over USB? | The ADB guide (`adb install -r`). Not yet verified on the owner's unit. |
| What does PlayGate require? SDK or wallet mandatory? | "APK output is required"; always sign with the same keystore; no Google services. Nothing says the SDK or a wallet is mandatory. Full requirements are only on playgate.playsolana.com (needs an account). |
| PlayDex leaderboard or quest APIs? | None documented in the extension. |

## 7. What changed in the game because of these facts

- **Throttle without triggers.** The gamepad throttle used only the triggers,
  which the PSG1 does not have. Now, when no trigger is pressed: in the plane,
  right stick up/down is throttle; in the helicopter, left stick up/down is
  forward speed (right stick up/down stays lift); in robot mode the stick
  pushed all the way still runs. The PSG1 controls guide, the first-flight
  coach and the robot message no longer mention R2/L2. Tested in
  `tools/tests/psg1.mjs`.

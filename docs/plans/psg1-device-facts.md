# PSG1 device facts (port plan Phase 0, measured on the owner's PSG1)

Measured 2026-11-10 over wireless ADB (USB would not connect, see below) and
through the PSG1 browser's remote debugger. These are measurements on a retail
unit and beat both the official docs and the earlier research where they differ.

## The system

| Item | Measured | Note |
|---|---|---|
| Model | `PSG1` (product, model and device) | |
| Android | **15** (API 35), build `AP4A.241205.013.C1` | The official docs say Android 12 |
| CPU type | arm64-v8a | |
| Screen | 1240 × 1080, density 272 | So the browser's pixel ratio is **1.7**, not 2.6 |
| System WebView | `com.android.webview` 124.0.6367.219 | Used by the app if it can ever be installed |
| Browser | Chromium 133 (`org.chromium.chrome.stable`) | Ships on the device |
| Other apps seen | `com.playsolana.echos`, `com.PlaySolana.PlaySolanaOrigins`, setup wizard | |
| Controller | `psg1_gamepad` (vendor 0x1234, product 0x5678), keyboard + gamepad + joystick | Uses Android's `Generic.kl` key layout |

## Installing apps

**ADB installs are blocked on the retail PSG1.** `adb install` fails with
`SecurityException: ADB package installation is not permitted on this device`
(from `InstallerPolicyEnforcer`). This is a deliberate firmware policy, so the
PSG1 app (`lego-sky-psg1.apk`) cannot be sideloaded with ADB. Not yet tried:
downloading the APK in the PSG1's browser and opening it with the on-device
installer, which may or may not be covered by the same policy. Otherwise the
official route is PlayGate.

## Connecting

- **USB:** the PSG1 made itself the USB host ("USB controlled by: This device",
  "Connected device: Couldn't switch"), so the Windows computer saw nothing. A
  USB-A to USB-C cable should force the right roles; not tried.
- **Wireless debugging works:** Developer options → Wireless debugging → Pair
  device with pairing code, then `adb pair <ip>:<pair port> <code>` and
  `adb connect <ip>:<port>`. A VPN on the computer (Proton VPN) blocked it
  until it was paused.

## The browser (Chromium 133)

From `diag.html` on the device:

| Item | Value |
|---|---|
| Window | 730 × 492 CSS px with the browser bars showing (1241 × 836 real pixels) |
| Orientation | landscape-primary |
| Touch | 2 touch points, coarse pointer |
| Memory, cores | 8 GB, 8 |
| WebGL2 | yes, `ANGLE (ARM, Mali-G610, OpenGL ES 3.2)`, max texture 4096, 4x MSAA |
| Gamepad API | yes; the pad appears after the first button press |

### Controller in the browser

The gamepad's `mapping` is empty (not "standard"), but the numbers match the
standard layout, which is what the game reads:

| Printed on PSG1 | Browser button |
|---|---|
| **A** (right) | **1** |
| **B** (bottom) | **0** |
| X (top) | 3 |
| Y (left) | 2 |
| L, R | 4, 5 |
| SELECT, START | 8, 9 |
| D-pad ▲ ▼ ◀ ▶ | 12, 13, 14, 15 |
| Left stick | axes 0, 1 (full range) |
| Right stick | axes 2, 3 (full range) |

16 buttons, 4 axes, no triggers. The game's labels (`PSG1_LABEL` in
`src/psg1.js`) and the app bridge already match this: **A and B are not
swapped.** The ADB guide's key codes (A = 96 `BUTTON_A`) describe Android key
names, not the browser numbers, and were the source of the earlier doubt.

## The game in the browser

`https://play.latlas.lol/legoplane/?psg1&fps&city=spartanburg`:

- PSG1 mode turns on, Spartanburg loads, the menu and the flight HUD fit the
  730 × 492 window without overlaps.
- Menu: 36–42 fps at full render size.
- Flying over downtown: about 36 fps, with the automatic scaling down to 50 %
  render size (visibly soft). The remote debugger was attached, which costs a
  little.
- Minor: with `?fps`, the frame counter covers the place-name banner at the top.

## What this means

1. The game is playable on the PSG1 today: open the address above in the
   PSG1's browser. **Conflict:** commit 01b3ef3 (another session, same day)
   took PSG1 mode off the website and made the app the only PSG1 route, and
   its install step is `adb install`, which this device refuses. After the
   next deploy, `?psg1` will no longer work in the browser. Decide between
   bringing a browser PSG1 mode back (for example, switching on when a
   `psg1_gamepad` is seen) or finding a working install route for the app.
2. The PSG1 app cannot be installed by ADB. To get a full-screen icon: try the
   browser's "Add to Home screen", or the on-device installer, or PlayGate.
3. Phase 4 (performance) is the next real work: 36 fps at 50 % scale is below
   the 45 fps target for a small city.

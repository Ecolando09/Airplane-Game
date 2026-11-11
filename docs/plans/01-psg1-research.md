# PSG1 research: what we know and what we don't

Research date: 2026-11-11. Purpose: decide how to get Lego Sky (a Three.js web game) running on the Play Solana PSG1 handheld.

## How reliable each fact is

Play Solana's own sites (playsolana.com, developers.playsolana.com, mcp.playsolana.com) were **blocked from the research session's network**, so nothing below was read directly from them. Facts come from three places, marked in the tables:

- **SDK source**: read directly from the official open-source Unity SDK, `github.com/playsolana/PlaySolana.Unity-SDK` v1.1.0. Most reliable.
- **Search**: search-engine summaries of official pages and news articles. Probably right, not verified.
- **Community**: `github.com/solanabr/solana-game-skill`, a third-party Claude skill. Some of it contradicts the official SDK; treat as hints only.

The first job of the build session is to confirm these with the PlaySolana extension (see "Tools" below) and on the real device.

## Hardware

| Item | Value | Source |
|---|---|---|
| Screen resolution | 1240 × 1080 (wider than tall, almost square, about 1.15:1) | SDK source (simulator device file) |
| Screen | 3.92-inch OLED, capacitive multitouch | Search |
| Chip | Rockchip RK3588S, octa-core ARM | Search |
| Graphics | Mali-G610 | Search (litepaper) |
| Memory | 8 GB | Search |
| Storage | 128 GB (one outlet says 64 GB) | Search |
| System | "EchOS", a custom Android 12 | Search |
| Wireless | Wi-Fi 6, Bluetooth 5.4 | Search |
| Battery | 5000 mAh | Search (litepaper) |
| Extras | Fingerprint sensor, built-in hardware wallet | Search |

**Conflict to resolve on the device:** the community skill says the screen is portrait (1080 wide × 1240 tall). The official SDK's simulator file says width 1240, height 1080. Trust the SDK, but check `window.innerWidth/innerHeight` and `devicePixelRatio` on the device before designing the layout.

## Controls

From the SDK source (`Runtime/Psg1.cs`). The console shows up to Android as a standard gamepad named `psg1_gamepad`.

| Control | Android code | Note |
|---|---|---|
| D-pad | Hat axes or D-pad key codes | Both variants exist |
| A (right) | `BUTTON_B` | Nintendo-style labels: A is on the right |
| B (bottom) | `BUTTON_A` | |
| X (top) | `BUTTON_Y` | |
| Y (left) | `BUTTON_X` | |
| L1, R1 | `BUTTON_L1`, `BUTTON_R1` | Shoulder buttons |
| Left and right triggers | `AXIS_BRAKE`, `AXIS_GAS` | Analog |
| Left stick, right stick | X/Y and Z/RZ axes | Analog, with L3/R3 clicks |
| Start, Select | `BUTTON_START`, `BUTTON_SELECT` | |

**Conflict:** the community skill's diagram shows no sticks or triggers. The official SDK defines both sticks, both triggers, and ships glyph images for the sticks. Verify on the device.

Because the labels are Nintendo-style, the browser's "button 0" (bottom button) is the one printed **B** on the PSG1. On-screen hints must use PSG1 labels, not Xbox ones.

## Developer tools

- **PlaySolana Unity SDK** (MIT, Unity 2019.4+): only contains the input layout, a simulator screen profile and button glyph images. It has no wallet, quest or identity code. The README says "Currently, our SDK is only available for Unity."
- **Play Solana MCP** (the "PlaySolana Developer Tools + Unity" extension): hosted at `https://mcp.playsolana.com/mcp`. Tools include `start_game_development`, `get_psg1_specifications`, `get_adb_guide`, `list_sdk_docs`, `get_sdk_doc`, `get_brandkit`, `get_litepaper`, plus Unity control tools. Its PlayGate publishing step was marked "Soon" when indexed.
- **Simulator**: a Unity editor device profile only. There is no standalone emulator; for a web game, a 1240×1080 browser window with a gamepad is the equivalent.

## Getting a game onto the device

- **Official route:** PlayGate (`playgate.playsolana.com`). You upload a signed APK or AAB with icons, a banner, store text, ratings and localization. Releases are staged: Test → Pilot → Public. (Search, from the org's GitHub profile.)
- **Sideloading:** the official FAQ answers "Can I install my own APKs?" by saying users install from the PlayVerse catalog, and that own builds go through PlayGate or a DevKit. But the MCP has an ADB install guide. **Whether a retail PSG1 allows USB debugging is unknown** and is the single most important thing to check.
- **DevKit:** a developer edition of the PSG1 for approved builders.

## Unknowns that decide the plan

1. Does a retail PSG1 allow Developer Options and `adb install`?
2. Does it have a web browser? If so, the game may already run at play.latlas.lol with zero work.
3. Which Chromium version is the system WebView? The game needs WebGL2 and ES modules (Chromium 80+ is plenty; Android 12 normally ships 90+).
4. Does the WebView expose the Gamepad API for the built-in controls?
5. What is `devicePixelRatio`? At about 420 dpi it is probably near 2.6, which makes the CSS viewport only about 470 × 410. That is far smaller than any phone layout the game has.
6. Does PlayGate accept non-Unity APKs, and does it require Solana features (wallet, quests)?

## What this means for Lego Sky

- The game is WebGL2 + Three.js. The Mali-G610 is a capable 2022-class mobile GPU, so the game should run at native 1240×1080 with tuned settings; the biggest cities (Hong Kong & Shenzhen, Tokyo, Denver) are the risk.
- The repo already has an Android app (`android/`) that wraps the live site in a WebView, and a build script (`deploy/build-apk.sh`) that produces a signed APK without Android Studio. The PSG1 version can reuse both.
- A Unity rewrite would throw away the whole game for no benefit. Not recommended.

## Sources

- [PlaySolana Unity SDK (GitHub)](https://github.com/playsolana/PlaySolana.Unity-SDK)
- [playsolana GitHub organization](https://github.com/playsolana)
- [Play Solana MCP](https://mcp.playsolana.com/)
- [Play Solana home page](https://www.playsolana.com/)
- [Play Solana litepaper](https://www.playsolana.com/litepaper)
- [PlaySolana developer docs](https://developers.playsolana.com/)
- [solanabr/solana-game-skill (community)](https://github.com/solanabr/solana-game-skill)
- [Cryptorank: PSG1 Limited Edition specs](https://cryptorank.io/news/feed/4f26d-play-solana-psg1-limited-edition-with-pengu)
- [W3Gamer: PSG1 launch article](https://w3gamer.com/articles/solana-psg1-handheld-gaming-device/)
- [Dataconomy: PSG1 ship date](https://dataconomy.com/2025/08/28/play-solana-to-ship-first-web3-handheld-console-psg1-on-oct-6/)

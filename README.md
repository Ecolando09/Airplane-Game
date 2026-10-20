# Lego Sky: Spartanburg

A browser flying game: the LEGO Technic 42198 Bush Plane over a Lego-brick version of Spartanburg, SC, built from real map data.

- **Real city layout.** Roads, rail, rivers, parks and ~36,000 building footprints come from OpenStreetMap (via Overture Maps), on real terrain elevation.
- **Lego style.** Studded baseplate ground, brick buildings with windows, gable roofs, Lego trees and brick clouds.
- **Airport.** Take off from runway 5 at Spartanburg Downtown Memorial Airport (SPA), or start in the air over downtown.
- **Map pins.** 2225 Pineview Cir and the Denny's building have tall beacons and show on the street map in the corner.
- **Landmarks.** Morgan Square, Wofford, Converse, USC Upstate, Duncan Park, Drayton Mills, Cleveland Park and more are labeled.

## Play locally

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (works on GitHub Pages or any static host)
```

## Controls

| Key | Action |
|---|---|
| W / S or ↑ / ↓ | Climb / dive (press I to invert) |
| A / D or ← / → | Bank left / right (the plane levels itself when you let go) |
| Q / E | Rudder |
| Shift / Ctrl (or + / −) | Throttle up / down |
| B | Boat floats up/down (land on water) |
| Space | Brakes |
| C | Camera: chase / far / cockpit |
| N (or tap the map) | Enlarge the street map |
| R / T | Restart on the runway / in the air |
| M | Sound on/off |

Touch screens get an on-screen stick, a throttle slider and buttons. Gamepads (Xbox layout) work too: left stick to fly, right stick for rudder, triggers for throttle, A brakes, B floats, Y camera, Menu restarts, View enlarges the map. A starts the game from the menu.

**Takeoff:** set full throttle, then gently pull up at about 55 kt. **Landing:** line up with the runway, ease the throttle to about 20% and hold S lightly to descend. Close to the ground the plane raises its nose and cushions the touchdown, so just keep the wings level. With floats down (B) you can land on the river, creeks and ponds.

## Phone as a controller

Click **📱 Use my phone as the controller** (or the 📱 button while flying). The game shows a QR code and a 4-letter room code. Scan the code with your phone to open the controller: a stick (or tilt-to-steer), a throttle slider, and buttons for floats, camera, map, brakes, rudder and restart. The phone shows your speed and altitude and buzzes when you crash.

The phone and the game talk through a small relay (`server/relay.js`) on the same server that hosts the game, so this works on any network, but only when the game is self-hosted. It doesn't work on the claude.ai preview.

Local test: `npm run relay` in one terminal and `npm run dev` in another (Vite forwards `/ws` to the relay).

## Deploying to a VPS (games.latlas.lol)

1. DNS (Porkbun): an **A** record for `games` pointing to the server's IP.
2. On the server, install Node.js 18+ and Caddy, then copy the repo to `/opt/lego-sky` and run `npm install --omit=dev` there (the relay needs the `ws` package).
3. Build and upload the site: `npm run build` locally, then `rsync -av dist/ root@SERVER:/var/www/games/`.
4. Copy `deploy/Caddyfile` to `/etc/caddy/Caddyfile` (or merge it in) and run `sudo systemctl reload caddy`. Caddy gets the HTTPS certificate automatically.
5. Copy `deploy/lego-sky-relay.service` to `/etc/systemd/system/`, then run `sudo systemctl enable --now lego-sky-relay`.

## Rebuilding the map data

`public/city.json` is generated. To regenerate it (for example, to change the area):

```sh
pip install pyarrow shapely pillow numpy
python tools/fetch_data.py tools/data        # Overture Maps + terrain tiles
python tools/build_city.py tools/data public/city.json
```

The map area is set by `W, S, E, N` in `tools/fetch_data.py`. The runway isn't in the source data, so its position is set by hand in `tools/build_city.py`.

## Code layout

- `src/world.js`: terrain, map texture, buildings, trees, runway, clouds, collisions
- `src/airplane.js`: the LEGO Technic 42198 Bush Plane model (moving ailerons, elevator and rudder; sits tail-down on the ground)
- `src/flight.js`: flight physics (takeoff, stall, banked turns, landing and crash checks)
- `src/main.js`: rendering, cameras, HUD, minimap, game flow
- `src/lego.js`: Lego colors and the stud/window shader
- `src/remote.js`, `remote.html`, `src/remote-pad.js`: phone controller (game side and phone page)
- `server/relay.js`: WebSocket relay between phones and the game screen

Map data © OpenStreetMap contributors (ODbL), Overture Maps Foundation. Elevation: Mapzen Terrain Tiles (AWS Open Data).

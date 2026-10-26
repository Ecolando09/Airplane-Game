# Lego Sky

A browser flying game over Spartanburg, SC and Fort Collins, CO, built from real map data.

- **Vehicles:** the LEGO Technic 42198 Bush Plane, or Ghost-Spider's helicopter. Helicopter controls: joystick (or A/D) steers, throttle (Shift/Ctrl or the SPEED slider) sets forward speed, lift (W/S or the LIFT slider) goes up and down with the middle holding height, rudder (Q/E or the RUDDER bar above the joystick on phones) slides sideways.
- **Fly together:** in the menu, start a room and copy the invite link (or share the 4-letter code). Everyone in the room sees each other's vehicles, with an arrow, distance and direction to each player, dots on the map, and a notice when someone joins or leaves. Uses the same relay as the phone controller, so it works on the self-hosted site.
- **Looks:** Lego bricks; realistic (Sentinel-2 satellite ground, natural colors, a painted version of the plane); or Google Photorealistic 3D Tiles (needs a Google Maps API key on the server).

- **Real city layout.** Roads, rail, rivers, parks and ~45,000 building footprints come from OpenStreetMap (via Overture Maps), on real terrain elevation.
- **Lego style.** Studded baseplate ground, brick buildings with windows, gable roofs, Lego trees, brick clouds and Lego cars driving the real streets.
- **Airport.** Take off from runway 5 at Spartanburg Downtown Memorial Airport (SPA), or start in the air over downtown.
- **Map pins.** 2225 Pineview Cir, the Denny's building and Lake Craig at Croft State Park have tall beacons and show on the street map in the corner.
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
| T (or 1 / 2 / 3) | Turbo: normal, T2X (2× speed, orange booster rockets), T3X (3× speed, blue flames) |
| Space | Brakes |
| C | Camera: chase / far / cockpit |
| N (or tap the map) | Enlarge the street map |
| R | Restart on the runway |
| M | Sound on/off |

On a phone, turn it sideways: you get an on-screen stick, a throttle slider and buttons, and **TILT** lets you steer by tilting the phone like a steering wheel (tip the top toward you to climb; **CENTER** re-centers). Gamepads (Xbox layout) work too: left stick to fly, right stick for rudder, triggers for throttle, A brakes, B floats, Y camera, Menu restarts, View enlarges the map. A starts the game from the menu.

**Takeoff:** set full throttle, then gently pull up at about 55 kt. **Landing:** line up with the runway, ease the throttle to about 20% and hold S lightly to descend. Close to the ground the plane raises its nose and cushions the touchdown, so just keep the wings level. With floats down (B) you can land on the river, creeks and ponds.

## Phone as a controller

Click **📱 Use my phone as the controller** (or the 📱 button while flying). The game shows a QR code and a 4-letter room code. Scan the code with your phone to open the controller: a stick (or tilt-to-steer), a throttle slider, and buttons for floats, camera, map, brakes, rudder and restart. The phone shows your speed and altitude and buzzes when you crash.

The phone and the game talk through a small relay (`server/relay.js`) on the same server that hosts the game, so this works on any network, but only when the game is self-hosted. It doesn't work on the claude.ai preview.

Local test: `npm run relay` in one terminal and `npm run dev` in another (Vite forwards `/ws` to the relay).

## Deploying to play.latlas.lol

The site is a games homepage (`homepage/`) with this game under `/legoplane/`. `npm run build:play` builds both into `play-dist/`.

On the server (Ubuntu/Debian, as root), one command installs or updates everything: Node.js if missing, the site in `/var/www/play`, the phone-controller relay as a systemd service, and the web server. If nginx is already running it adds a separate nginx site (`deploy/nginx.conf`) and gets HTTPS from certbot; otherwise it sets up Caddy (`deploy/Caddyfile`), which handles HTTPS itself:

```sh
curl -fsSL https://raw.githubusercontent.com/Ecolando09/Airplane-Game/claude/lego-airplane-game-ttd82x/deploy/install-play.sh | sudo bash
```

For the **Google 3D** look, pass your Google Maps API key once (it's saved in `/etc/latlas-play/google-maps-key` and written into the site's `config.js`; it never goes in the repository):

```sh
curl -fsSL https://raw.githubusercontent.com/Ecolando09/Airplane-Game/claude/lego-airplane-game-ttd82x/deploy/install-play.sh | sudo GOOGLE_MAPS_KEY=your-key bash
```

Before the first run, add an **A** record for `play` in Porkbun pointing to the server's IP. Run the same command again to deploy updates.

## Rebuilding the map data

`public/city.json` is generated. To regenerate it (for example, to change the area):

```sh
pip install pyarrow shapely pillow numpy
pip install rasterio                         # for the satellite imagery
python tools/fetch_data.py spartanburg       # Overture Maps + terrain tiles
python tools/fetch_imagery.py spartanburg    # Sentinel-2 satellite photo
python tools/build_city.py spartanburg       # -> public/cities/spartanburg.json
```

Each city is configured in `tools/cities/<city>.json`: map area, runway (set by hand, since runways aren't in the source data), landmarks, map pins, custom buildings (Denny's Tower) and satellite scenes.

## Code layout

- `src/world.js`: terrain, map texture, buildings, trees, runway, clouds, collisions
- `src/airplane.js`: the LEGO Technic 42198 Bush Plane model (moving ailerons, elevator and rudder; sits tail-down on the ground)
- `src/flight.js`: flight physics (takeoff, stall, banked turns, landing and crash checks)
- `src/main.js`: rendering, cameras, HUD, minimap, game flow
- `src/lego.js`: Lego colors and the stud/window shader
- `src/traffic.js`: cars driving the streets
- `src/heli.js`: Ghost-Spider helicopter model and flight
- `src/google3d.js`: Google Photorealistic 3D Tiles world
- `src/remote.js`, `remote.html`, `src/remote-pad.js`: phone controller (game side and phone page)
- `server/relay.js`: WebSocket relay for the phone controller and multiplayer rooms
- `src/multiplayer.js`: multiplayer rooms (sending your position, showing other players)

Map data © OpenStreetMap contributors (ODbL), Overture Maps Foundation. Elevation: Mapzen Terrain Tiles (AWS Open Data). Satellite imagery contains modified Copernicus Sentinel data. Google 3D: © Google.

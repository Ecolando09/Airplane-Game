# Lego Sky: Spartanburg

A browser flying game: the LEGO Technic 42198 Bush Plane over a Lego-brick version of Spartanburg, SC, built from real map data.

- **Real city layout.** Roads, rail, rivers, parks and ~36,000 building footprints come from OpenStreetMap (via Overture Maps), on real terrain elevation.
- **Lego style.** Studded baseplate ground, brick buildings with windows, gable roofs, Lego trees and brick clouds.
- **Airport.** Take off from runway 5 at Spartanburg Downtown Memorial Airport (SPA), or start in the air over downtown.
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
| B or Space | Brakes |
| C | Camera: chase / far / cockpit |
| R / T | Restart on the runway / in the air |
| M | Sound on/off |

Touch screens get an on-screen stick, a throttle slider and buttons. Gamepads work too: left stick to steer, triggers for throttle.

**Takeoff:** set full throttle, then gently pull up at about 55 kt. **Landing:** line up with the runway, cut the throttle to about 25% and descend slowly. Touch down at less than about 1,400 fpm with the wings level.

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

Map data © OpenStreetMap contributors (ODbL), Overture Maps Foundation. Elevation: Mapzen Terrain Tiles (AWS Open Data).

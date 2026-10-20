"""Convert Overture Maps extracts + Terrarium elevation into compact game data.

Inputs (from tools/fetch_data.py): tools/data/{buildings,segments,water,landuse,places}.parquet, data/elev.json
Output: public/city.json
Local coordinates are meters: x east, z south, origin at bbox center.
"""
import json, math, sys, os, random
import pyarrow.parquet as pq, shapely
from shapely.geometry import Polygon

D = sys.argv[1] if len(sys.argv) > 1 else "tools/data"
OUT = sys.argv[2] if len(sys.argv) > 2 else 'public/city.json'
elev = json.load(open(f'{D}/elev.json'))
W, S, E, N = elev['bbox']
LON0, LAT0 = (W + E) / 2, (S + N) / 2
MX = 111320 * math.cos(math.radians(LAT0))
MZ = 110574

def xy(lon, lat):
    return (round((lon - LON0) * MX, 1), round(-(lat - LAT0) * MZ, 1))

HALF_X, HALF_Z = (E - W) / 2 * MX, (N - S) / 2 * MZ

def inside(x, z):
    return abs(x) < HALF_X and abs(z) < HALF_Z

random.seed(7)
out = {'origin': [LON0, LAT0], 'size': [round(HALF_X * 2), round(HALF_Z * 2)],
       'elev': {'n': elev['size'], 'h': elev['h']}}

# --- buildings -----------------------------------------------------------
boxes, polys = [], []
for r in pq.read_table(f'{D}/buildings.parquet').to_pylist():
    g = shapely.from_wkb(r['geometry'])
    for p in getattr(g, 'geoms', [g]):
        if p.geom_type != 'Polygon' or p.is_empty:
            continue
        pts = Polygon([xy(*c) for c in p.exterior.coords])
        if not pts.is_valid or pts.area < 12:
            continue
        c = pts.centroid
        if not inside(c.x, c.y):
            continue
        h = r['height'] or (r['num_floors'] or 0) * 3.4
        if not h:
            h = 7 if pts.area < 300 else 9 if pts.area < 2000 else 12
        h = max(3.2, round(h / 3.2) * 3.2)  # whole Lego "brick" layers
        cls = r['class'] or ''
        mrr = pts.minimum_rotated_rectangle
        if pts.area / max(mrr.area, 1) > 0.8 or pts.area < 250:
            cs = list(mrr.exterior.coords)[:4]
            ax, az = cs[1][0] - cs[0][0], cs[1][1] - cs[0][1]
            w = math.hypot(ax, az); d = math.hypot(cs[2][0] - cs[1][0], cs[2][1] - cs[1][1])
            ang = math.atan2(az, ax)
            boxes.append([round(mrr.centroid.x, 1), round(mrr.centroid.y, 1), round(w, 1), round(d, 1),
                          round(h, 1), round(ang, 3), 1 if cls in ('house', 'detached', 'residential', 'semidetached_house') or (not cls and pts.area < 250) else 0])
        else:
            s = pts.simplify(1.5)
            if s.geom_type != 'Polygon' or not s.is_valid:
                s = pts
            polys.append({'p': [v for c in list(s.exterior.coords)[:-1] for v in (round(c[0], 1), round(c[1], 1))], 'h': round(h, 1)})
out['boxes'] = boxes
out['polys'] = polys

# --- roads / rail / streams (polylines) ------------------------------------
ROAD_W = {'motorway': 22, 'trunk': 18, 'primary': 14, 'secondary': 12, 'tertiary': 10,
          'residential': 7, 'unclassified': 7, 'living_street': 6, 'service': 4.5, 'unknown': 6}
MAJOR = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary'}
lines = []
for r in pq.read_table(f'{D}/segments.parquet').to_pylist():
    k = r['class'] if r['subtype'] == 'road' else 'rail'
    if k != 'rail' and k not in ROAD_W:
        continue
    g = shapely.from_wkb(r['geometry'])
    for l in getattr(g, 'geoms', [g]):
        pts = [xy(*c) for c in l.coords]
        line = {'k': k, 'p': [v for p in pts for v in p]}
        name = (r['names'] or {}).get('primary')
        if name and k in MAJOR:
            line['n'] = name
        lines.append(line)
out['lines'] = lines

water_polys, streams = [], []
for r in pq.read_table(f'{D}/water.parquet').to_pylist():
    g = shapely.from_wkb(r['geometry'])
    for p in getattr(g, 'geoms', [g]):
        if p.geom_type == 'Polygon':
            water_polys.append([v for c in p.simplify(0.00002).exterior.coords for v in xy(*c)])
        elif p.geom_type == 'LineString':
            streams.append({'k': r['subtype'], 'p': [v for c in p.coords for v in xy(*c)]})
out['water'] = water_polys
out['streams'] = streams

LAND = {'park': 'park', 'grass': 'park', 'garden': 'park', 'recreation_ground': 'park', 'village_green': 'park',
        'dog_park': 'park', 'nature_reserve': 'forest', 'forest': 'forest', 'state_park': 'forest',
        'golf_course': 'golf', 'fairway': 'golf', 'green': 'golf', 'tee': 'golf', 'bunker': 'sand',
        'pitch': 'pitch', 'stadium': 'pitch', 'track': 'track', 'playground': 'park', 'cemetery': 'park',
        'grave_yard': 'park', 'retail': 'paved', 'commercial': 'paved', 'industrial': 'paved',
        'school': 'campus', 'college': 'campus', 'university': 'campus', 'hospital': 'campus',
        'pedestrian': 'paved', 'meadow': 'park', 'farmland': 'park'}
land = []
for r in pq.read_table(f'{D}/landuse.parquet').to_pylist():
    k = LAND.get(r['class'])
    if not k:
        continue
    g = shapely.from_wkb(r['geometry'])
    for p in getattr(g, 'geoms', [g]):
        if p.geom_type == 'Polygon':
            land.append({'k': k, 'p': [v for c in p.simplify(0.00002).exterior.coords for v in xy(*c)]})
order = ['campus', 'paved', 'park', 'forest', 'golf', 'pitch', 'track', 'sand']
land.sort(key=lambda l: order.index(l['k']))
out['land'] = land

# --- landmarks & airport ---------------------------------------------------
LANDMARKS = [
    ('Morgan Square', 34.94971, -81.93217),
    ('Wofford College', 34.95903, -81.93513),
    ('Converse University', 34.95600, -81.91850),
    ('Spartanburg Regional', 34.96521, -81.93865),
    ('Duncan Park Stadium', 34.93643, -81.91274),
    ('Cleveland Park', 34.96572, -81.95069),
    ('Drayton Mills', 34.97283, -81.90713),
    ('USC Upstate', 34.99685, -81.96956),
    ('Hatcher Garden', 34.93009, -81.95835),
    ('Chapman Cultural Center', 34.95325, -81.92978),
    ('Hub City Railroad Museum', 34.95353, -81.93753),
    ('Downtown Memorial Airport', 34.91857, -81.95728),
]
out['landmarks'] = [{'name': n, 'x': xy(lon, lat)[0], 'z': xy(lon, lat)[1]} for n, lat, lon in LANDMARKS]
# Map pins the player asked for. Pineview Circle has no house-number data, so the
# pin sits on the street itself (a short cul-de-sac, so within ~100 m).
LOCATORS = [
    ('2225 Pineview Cir', 34.93660, -81.88470, 'home'),
    ("Denny's Building", 34.94985, -81.92824, 'pin'),
]
out['locators'] = [{'name': n, 'x': xy(lon, lat)[0], 'z': xy(lon, lat)[1], 'kind': k} for n, lat, lon, k in LOCATORS]
# Runway 5/23, 1585 m x 46 m; centerline placed in the airfield gap in the map data.
cx, cz = xy(-81.9567, 34.9155)
out['runway'] = {'x': cx, 'z': cz, 'heading': 44, 'length': 1585, 'width': 46}

# --- trees: scatter on open ground, avoiding roads/buildings/water/runway ----
import numpy as np
from PIL import Image, ImageDraw
RES = 4.0
MW, MH = int(HALF_X * 2 / RES), int(HALF_Z * 2 / RES)
def mp(x, z): return ((x + HALF_X) / RES, (z + HALF_Z) / RES)
block = Image.new('L', (MW, MH), 0); bd = ImageDraw.Draw(block)
kind = Image.new('L', (MW, MH), 0); kd = ImageDraw.Draw(kind)  # 0 open, 1 residential, 2 park, 3 forest
for l in lines:
    pts = [mp(l['p'][i], l['p'][i + 1]) for i in range(0, len(l['p']), 2)]
    bd.line(pts, fill=255, width=max(2, int((ROAD_W.get(l['k'], 6) + 10) / RES)))
for b in boxes:
    r = max(b[2], b[3]) / 2 + 4
    x, z = mp(b[0], b[1]); bd.ellipse([x - r / RES, z - r / RES, x + r / RES, z + r / RES], fill=255)
for pl in polys:
    bd.polygon([mp(pl['p'][i], pl['p'][i + 1]) for i in range(0, len(pl['p']), 2)], fill=255)
for w in water_polys:
    bd.polygon([mp(w[i], w[i + 1]) for i in range(0, len(w), 2)], fill=255)
for s_ in streams:
    bd.line([mp(s_['p'][i], s_['p'][i + 1]) for i in range(0, len(s_['p']), 2)], fill=255, width=3)
for l in land:
    pts = [mp(l['p'][i], l['p'][i + 1]) for i in range(0, len(l['p']), 2)]
    if l['k'] in ('paved', 'pitch', 'track', 'sand', 'golf'):
        bd.polygon(pts, fill=255)
    else:
        kd.polygon(pts, fill={'campus': 1, 'park': 2, 'forest': 3}[l['k']])
for r in pq.read_table(f'{D}/landuse.parquet').to_pylist():
    if r['class'] == 'residential':
        g = shapely.from_wkb(r['geometry'])
        for p in getattr(g, 'geoms', [g]):
            if p.geom_type == 'Polygon':
                kd.polygon([mp(*xy(*c)) for c in p.exterior.coords], fill=1)
rw = out['runway']; h = math.radians(rw['heading'])
fx, fz = math.sin(h), -math.cos(h); sx, sz = -fz, fx
L2, W2 = rw['length'] / 2 + 250, rw['width'] / 2 + 120
for L2_, W2_ in ((L2, W2), (rw['length'] / 2 + 1200, rw['width'] / 2 + 60)):  # airfield + approach corridors
    bd.polygon([mp(rw['x'] + fx * a * L2_ + sx * b * W2_, rw['z'] + fz * a * L2_ + sz * b * W2_)
                for a, b in ((1, 1), (1, -1), (-1, -1), (-1, 1))], fill=255)
block = np.array(block); kind = np.array(kind)
PROB = {0: 0.55, 1: 0.18, 2: 0.25, 3: 0.95}
rng = np.random.default_rng(3)
trees = []
for _ in range(140000):
    x = rng.uniform(-HALF_X, HALF_X); z = rng.uniform(-HALF_Z, HALF_Z)
    i, j = int((x + HALF_X) / RES), int((z + HALF_Z) / RES)
    if i >= MW or j >= MH or block[j, i]:
        continue
    if rng.random() < PROB[int(kind[j, i])]:
        trees.append([round(x, 1), round(z, 1), int(rng.random() < 0.3), round(float(rng.uniform(0.8, 1.4)), 2)])
out['trees'] = trees
print(len(trees), 'trees')

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(out, open(OUT, 'w'), separators=(',', ':'))
print(len(boxes), 'boxes', len(polys), 'polys', len(lines), 'lines', len(land), 'land', os.path.getsize(OUT) // 1024, 'KB')

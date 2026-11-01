"""Convert Overture Maps extracts + Terrarium elevation into compact game data.

Usage: python tools/build_city.py <city>   (config: tools/cities/<city>.json)
Inputs (from tools/fetch_data.py): tools/data/<city>/{buildings,segments,water,landuse,places}.parquet, elev.json
Output: public/cities/<city>.json
Local coordinates are meters: x east, z south, origin at bbox center.
"""
import json, math, sys, os, random
import pyarrow.parquet as pq, shapely
from shapely.geometry import Polygon

CITY = sys.argv[1] if len(sys.argv) > 1 else 'spartanburg'
CFG = json.load(open(os.path.join(os.path.dirname(__file__), 'cities', f'{CITY}.json')))
D = f'tools/data/{CITY}'
OUT = f'public/cities/{CITY}.json'
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
# The elevation tiles include the sea floor; the game's water sits at sea level.
out = {'origin': [LON0, LAT0], 'size': [round(HALF_X * 2), round(HALF_Z * 2)],
       'elev': {'n': elev['size'], 'h': [max(v, 0) for v in elev['h']]}}
PAD = 0.004  # degrees kept beyond the map edge when clipping areas
def clip(g):
    return shapely.clip_by_rect(g, W - PAD, S - PAD, E + PAD, N + PAD)
rwc = CFG['runway']
hp = CFG.get('helipad')
STRUCT = CFG.get('structures', [])  # hand-modeled landmarks placed by position

# --- buildings -----------------------------------------------------------
# Places that must stay clear: the runway (some cities use a historic airfield
# that has buildings on it now), the helipad and hand-modeled landmarks.
def runway_rect(margin):
    cx, cz = xy(rwc['lon'], rwc['lat'])
    h = math.radians(rwc['heading'])
    fx, fz = math.sin(h), -math.cos(h)
    L, Wd = rwc['length'] / 2 + margin, rwc['width'] / 2 + margin
    return Polygon([(cx + fx * a * L - fz * b * Wd, cz + fz * a * L + fx * b * Wd)
                    for a, b in ((1, 1), (1, -1), (-1, -1), (-1, 1))])
keep_clear = [runway_rect(15)]
if hp:
    keep_clear.append(Polygon(shapely.Point(*xy(hp['lon'], hp['lat'])).buffer(12)))
for st in STRUCT:
    keep_clear.append(Polygon(shapely.Point(*xy(st['lon'], st['lat'])).buffer(st.get('clear', 0))))
keep_clear = shapely.union_all([k for k in keep_clear if not k.is_empty])

foot = []  # [polygon, known height or None, class]
custom = []
CUSTOM = {c['building'].lower(): c for c in CFG.get('custom', [])}  # hand-modeled buildings, by map name
for r in pq.read_table(f'{D}/buildings.parquet').to_pylist():
    g = shapely.from_wkb(r['geometry'])
    bname = ((r['names'] or {}).get('primary') or '').lower()
    if bname in CUSTOM:
        # Swap the generic block for a custom model with this footprint.
        fp = Polygon([xy(*c) for c in g.exterior.coords]).minimum_rotated_rectangle
        cs = list(fp.exterior.coords)[:4]
        w = math.hypot(cs[1][0] - cs[0][0], cs[1][1] - cs[0][1])
        d = math.hypot(cs[2][0] - cs[1][0], cs[2][1] - cs[1][1])
        ang = math.atan2(cs[1][1] - cs[0][1], cs[1][0] - cs[0][0])
        if d > w:  # make w the long side
            w, d, ang = d, w, ang + math.pi / 2
        c = CUSTOM[bname]
        if c['kind'] == 'skip':  # left out; a hand-modeled structure stands in for it
            continue
        custom.append({'kind': c['kind'], 'x': round(fp.centroid.x, 1), 'z': round(fp.centroid.y, 1),
                       'w': round(w, 1), 'd': round(d, 1), 'ang': round(ang, 3), 'h': c['height'],
                       **({'color': c['color']} if 'color' in c else {})})
        continue
    for p in getattr(g, 'geoms', [g]):
        if p.geom_type != 'Polygon' or p.is_empty:
            continue
        pts = Polygon([xy(*c) for c in p.exterior.coords])
        if not pts.is_valid or pts.area < CFG.get('minArea', 12):
            continue
        c = pts.centroid
        if not inside(c.x, c.y) or pts.intersects(keep_clear):
            continue
        h = r['height'] or (r['num_floors'] or 0) * 3.4 or None
        foot.append([pts, h, r['class'] or ''])

def default_height(area):
    for a, h in CFG.get('heights', [[300, 7], [2000, 9], [1e12, 12]]):
        if area < a:
            return h

# Many buildings in some cities (Hong Kong, Tokyo, Singapore) have no height in
# the map data. Estimate those from known heights nearby of similar size, since
# towers stand next to towers and houses next to houses.
if CFG.get('estimateHeights'):
    from scipy.spatial import cKDTree
    known = [(f[0].centroid.x, f[0].centroid.y, f[0].area, f[1]) for f in foot if f[1]]
    tree = cKDTree([(k[0], k[1]) for k in known])
    est = 0
    for f in foot:
        if f[1]:
            continue
        c, a = f[0].centroid, f[0].area
        ds_, ix = tree.query((c.x, c.y), k=16, distance_upper_bound=400)
        near = [known[i] for d_, i in zip(ds_, ix) if math.isfinite(d_)]
        similar = [k[3] for k in near if 0.4 < k[2] / a < 2.5]
        if len(similar) >= 3:
            f[1] = sorted(similar)[len(similar) // 2]
            est += 1
    print(est, 'heights estimated from neighbors,', len(known), 'known')
for f in foot:
    if not f[1]:
        f[1] = default_height(f[0].area)

# Very big cities: keep the map light enough for phones by leaving out the
# smallest buildings (sheds and garages go first; tall buildings always stay).
MAXB = CFG.get('maxBuildings', 200000)
if len(foot) > MAXB:
    foot.sort(key=lambda f: (f[1] < 15, -f[0].area))
    print(len(foot) - MAXB, 'smallest buildings left out; smallest kept', round(foot[MAXB - 1][0].area), 'm2')
    foot = foot[:MAXB]

boxes, polys = [], []
for pts, h, cls in foot:
    h = max(3.2, round(h / 3.2) * 3.2)  # whole Lego "brick" layers
    mrr = pts.minimum_rotated_rectangle
    if pts.area / max(mrr.area, 1) > 0.8 or pts.area < 250:
        cs = list(mrr.exterior.coords)[:4]
        ax, az = cs[1][0] - cs[0][0], cs[1][1] - cs[0][1]
        w = math.hypot(ax, az); d = math.hypot(cs[2][0] - cs[1][0], cs[2][1] - cs[1][1])
        ang = math.atan2(az, ax)
        house = cls in ('house', 'detached', 'residential', 'semidetached_house') or (not cls and pts.area < 250)
        boxes.append([round(mrr.centroid.x, 1), round(mrr.centroid.y, 1), round(w, 1), round(d, 1),
                      round(h, 1), round(ang, 3), 1 if house and h < 15 else 0])
    else:
        sp = pts.simplify(1.5)
        if sp.geom_type != 'Polygon' or not sp.is_valid:
            sp = pts
        polys.append({'p': [v for c in list(sp.exterior.coords)[:-1] for v in (round(c[0], 1), round(c[1], 1))], 'h': round(h, 1)})
out['boxes'] = boxes
out['custom'] = custom
out['polys'] = polys

# --- map layers --------------------------------------------------------------
# These are drawn into the 4096 px map texture (about 4-8 m per pixel), so whole
# meters and outlines simplified to half a pixel lose nothing visible.
PX = max(HALF_X, HALF_Z) * 2 / 4096
def flat(coords, tol, ring=False):
    pts = [xy(*c) for c in coords]
    if len(pts) > 2:
        g = (Polygon(pts) if ring else shapely.LineString(pts)).simplify(tol)
        if not g.is_empty:
            pts = list(g.exterior.coords if ring else g.coords)
    return [int(round(v)) for p in pts for v in p]

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
        line = {'k': k, 'p': flat(l.coords, 1.0)}
        name = (r['names'] or {}).get('primary')
        if name and k in MAJOR:
            line['n'] = name
        lines.append(line)
out['lines'] = lines

water_polys, streams = [], []
for r in pq.read_table(f'{D}/water.parquet').to_pylist():
    # "physical" features are named areas (bays, straits, capes) drawn loosely over
    # land and sea; the ocean, lakes and rivers have their own outlines.
    if r['subtype'] in ('physical', 'human_made'):
        continue
    g = clip(shapely.from_wkb(r['geometry']))
    for p in getattr(g, 'geoms', [g]):
        if p.is_empty:
            continue
        if p.geom_type == 'Polygon' and p.area * MX * MZ > (2 * PX) ** 2:
            # Islands are holes in the sea: [outline, hole, hole, ...] when there are any.
            holes = [flat(h.coords, PX / 2, ring=True) for h in p.interiors
                     if Polygon(h).area * MX * MZ > (2 * PX) ** 2]
            outline = flat(p.exterior.coords, PX / 2, ring=True)
            water_polys.append([outline, *holes] if holes else outline)
        elif p.geom_type == 'LineString':
            streams.append({'k': r['subtype'], 'p': flat(p.coords, PX / 2)})
out['water'] = water_polys
out['streams'] = streams

LAND = {'park': 'park', 'grass': 'park', 'garden': 'park', 'recreation_ground': 'park', 'village_green': 'park',
        'dog_park': 'park', 'nature_reserve': 'forest', 'forest': 'forest', 'state_park': 'forest',
        'golf_course': 'golf', 'fairway': 'golf', 'green': 'golf', 'tee': 'golf', 'bunker': 'sand',
        'pitch': 'pitch', 'stadium': 'pitch', 'track': 'track', 'playground': 'park', 'cemetery': 'park',
        'grave_yard': 'park', 'retail': 'paved', 'commercial': 'paved', 'industrial': 'paved',
        'school': 'campus', 'college': 'campus', 'university': 'campus', 'hospital': 'campus',
        'pedestrian': 'paved', 'meadow': 'park', 'farmland': 'park', **CFG.get('landExtra', {})}
land = []
for r in pq.read_table(f'{D}/landuse.parquet').to_pylist():
    k = LAND.get(r['class'])
    if not k:
        continue
    g = clip(shapely.from_wkb(r['geometry']))
    for p in getattr(g, 'geoms', [g]):
        if p.geom_type == 'Polygon' and p.area * MX * MZ > (2 * PX) ** 2:
            land.append({'k': k, 'p': flat(p.exterior.coords, PX / 2, ring=True)})
order = ['campus', 'paved', 'park', 'forest', 'golf', 'pitch', 'track', 'sand']
land.sort(key=lambda l: order.index(l['k']))
out['land'] = land

# --- landmarks, map pins & airport (from the city config) --------------------
out['name'] = CFG['name']
out['ground'] = CFG.get('ground', '#58ab41')
out['geoid'] = CFG.get('geoid', 0)  # ellipsoid minus sea level, for Google 3D tiles
if 'fog' in CFG:  # [near, far] meters: see farther in big mountain country
    out['fog'] = CFG['fog']
if 'airStart' in CFG:  # where "Start in the air" begins: direction toward landmarks[0], distance, height
    out['airStart'] = CFG['airStart']
out['airport'] = CFG['airport']
if 'beerRun' in CFG:  # the Beer Run delivery game: breweries, shops and VIP customers
    br = CFG['beerRun']
    out['beerRun'] = {
        'breweries': [{'name': n, 'x': xy(lon, lat)[0], 'z': xy(lon, lat)[1], 'beer': b} for n, lat, lon, b in br['breweries']],
        'shops': [{'name': n, 'x': xy(lon, lat)[0], 'z': xy(lon, lat)[1]} for n, lat, lon in br['shops']]
               + [{'name': n, 'x': xy(lon, lat)[0], 'z': xy(lon, lat)[1], 'vip': True} for n, lat, lon in br.get('vips', [])],
    }
out['landmarks'] = [{'name': n, 'x': xy(lon, lat)[0], 'z': xy(lon, lat)[1]} for n, lat, lon in CFG['landmarks']]
out['locators'] = [{'name': n, 'x': xy(lon, lat)[0], 'z': xy(lon, lat)[1], 'kind': k} for n, lat, lon, k in CFG.get('locators', [])]
# Runways aren't in the source data, so each config places one by hand.
cx, cz = xy(rwc['lon'], rwc['lat'])
# Helicopters start from a helipad (from the map data or spotted on aerial imagery).
if hp:
    hx, hz = xy(hp['lon'], hp['lat'])
    out['helipad'] = {'name': hp['name'], 'x': hx, 'z': hz}
out['structures'] = [{**{k: v for k, v in st.items() if k not in ('lat', 'lon', 'clear')},
                      'x': xy(st['lon'], st['lat'])[0], 'z': xy(st['lon'], st['lat'])[1]} for st in STRUCT]
out['runway'] = {'x': cx, 'z': cz, 'heading': rwc['heading'], 'length': rwc['length'], 'width': rwc['width'], 'names': rwc['names']}

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
wat = Image.new('L', (MW, MH), 0); wd = ImageDraw.Draw(wat)  # water, with its islands left dry
for w in water_polys:
    for n, ring in enumerate([w] if isinstance(w[0], (int, float)) else w):
        wd.polygon([mp(ring[i], ring[i + 1]) for i in range(0, len(ring), 2)], fill=0 if n else 255)
block.paste(255, mask=wat)
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
if hp:  # keep trees off the helipad
    px_, pz_ = mp(hx, hz)
    bd.ellipse([px_ - 40 / RES, pz_ - 40 / RES, px_ + 40 / RES, pz_ + 40 / RES], fill=255)
block = np.array(block); kind = np.array(kind)
# Tree odds per ground type (open, residential, park, forest); configurable per
# city, e.g. Colorado's open prairie has far fewer trees than the Carolina woods.
PROB = dict(enumerate(CFG.get('trees', [0.55, 0.18, 0.25, 0.95])))
rng = np.random.default_rng(3)
TREELINE = CFG.get('treeline')  # meters above sea level; no trees above it
EN = elev['size']
def LAND_H(x, z):
    i = min(EN - 1, max(0, round((x + HALF_X) / (2 * HALF_X) * (EN - 1))))
    j = min(EN - 1, max(0, round((z + HALF_Z) / (2 * HALF_Z) * (EN - 1))))
    return elev['h'][j * EN + i]
trees = []
for _ in range(int(HALF_X * HALF_Z * 4 / 1e6 * CFG.get('treeDensity', 450))):  # candidate spots per km²
    x = rng.uniform(-HALF_X, HALF_X); z = rng.uniform(-HALF_Z, HALF_Z)
    i, j = int((x + HALF_X) / RES), int((z + HALF_Z) / RES)
    if i >= MW or j >= MH or block[j, i]:
        continue
    if TREELINE and LAND_H(x, z) > TREELINE:  # bare rock up high
        continue
    if rng.random() < PROB[int(kind[j, i])]:
        trees.append([int(round(x)), int(round(z)), int(rng.random() < 0.3), round(float(rng.uniform(0.8, 1.4)), 1)])
out['trees'] = trees
print(len(trees), 'trees')

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(out, open(OUT, 'w'), separators=(',', ':'))
print(len(boxes), 'boxes', len(polys), 'polys', len(lines), 'lines', len(land), 'land', os.path.getsize(OUT) // 1024, 'KB')

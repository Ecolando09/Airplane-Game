"""Download Spartanburg map data into tools/data/ (run before build_city.py).

- Buildings, roads/rail, water, land use, places: Overture Maps (OpenStreetMap-derived), public S3 bucket.
- Elevation: Mapzen/AWS Terrarium terrain tiles.

Usage:  pip install pyarrow shapely pillow numpy
        python tools/fetch_data.py tools/data
"""
import io, json, math, os, sys, urllib.request
import numpy as np
import pyarrow.dataset as ds, pyarrow.fs as fs, pyarrow.parquet as pq
from PIL import Image

W, S, E, N = -82.00, 34.88, -81.86, 35.00  # Spartanburg, SC
RELEASE = '2026-09-23.1'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'tools/data'
os.makedirs(OUT, exist_ok=True)

proxy = os.environ.get('HTTPS_PROXY')
s3 = fs.S3FileSystem(anonymous=True, region='us-west-2', **({'proxy_options': proxy} if proxy else {}))
ROOT = f'overturemaps-us-west-2/release/{RELEASE}/'
THEMES = {
    'buildings': ('theme=buildings/type=building/', ['id', 'geometry', 'height', 'num_floors', 'class', 'names', 'bbox']),
    'segments': ('theme=transportation/type=segment/', ['id', 'geometry', 'subtype', 'class', 'names', 'bbox']),
    'water': ('theme=base/type=water/', ['id', 'geometry', 'subtype', 'class', 'names', 'bbox']),
    'landuse': ('theme=base/type=land_use/', ['id', 'geometry', 'subtype', 'class', 'names', 'bbox']),
    'places': ('theme=places/type=place/', ['id', 'geometry', 'basic_category', 'names', 'bbox']),
}
for name, (path, cols) in THEMES.items():
    d = ds.dataset(ROOT + path, filesystem=s3, format='parquet')
    f = ((ds.field('bbox', 'xmin') < E) & (ds.field('bbox', 'xmax') > W)
         & (ds.field('bbox', 'ymin') < N) & (ds.field('bbox', 'ymax') > S))
    t = d.to_table(columns=cols, filter=f)
    pq.write_table(t, f'{OUT}/{name}.parquet')
    print(name, t.num_rows)

# Elevation: zoom-13 Terrarium tiles resampled to a 257x257 grid over the bbox.
Z, G = 13, 257
def tile(lon, lat):
    n = 2 ** Z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
x0, y0 = tile(W, N); x1, y1 = tile(E, S)
tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
mosaic = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256))
for tx in range(tx0, tx1 + 1):
    for ty in range(ty0, ty1 + 1):
        url = f'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{Z}/{tx}/{ty}.png'
        im = np.array(Image.open(io.BytesIO(urllib.request.urlopen(url).read())).convert('RGB')).astype(float)
        mosaic[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = \
            im[:, :, 0] * 256 + im[:, :, 1] + im[:, :, 2] / 256 - 32768
grid = np.zeros((G, G))
for j in range(G):
    for i in range(G):
        px, py = tile(W + (E - W) * i / (G - 1), N - (N - S) * j / (G - 1))
        px = (px - tx0) * 256; py = (py - ty0) * 256
        ix, iy = int(px), int(py); fx, fy = px - ix, py - iy
        grid[j, i] = (mosaic[iy, ix] * (1 - fx) * (1 - fy) + mosaic[iy, ix + 1] * fx * (1 - fy)
                      + mosaic[iy + 1, ix] * (1 - fx) * fy + mosaic[iy + 1, ix + 1] * fx * fy)
json.dump({'bbox': [W, S, E, N], 'size': G, 'min': float(grid.min()), 'max': float(grid.max()),
           'h': [round(float(v), 1) for v in grid.flatten()]}, open(f'{OUT}/elev.json', 'w'))
print('elevation', grid.min(), grid.max())

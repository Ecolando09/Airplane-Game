"""Download Sentinel-2 true-color imagery for a city into public/cities/<city>-sat.jpg.

The image covers the city's bbox in plain lat/lon (matching the game's ground
texture), 4096 px square. Scenes are listed in the city config under "imagery"
as Sentinel-2 L2A scene folders in the public sentinel-cogs bucket. Each pixel comes
from the first listed scene where it is clear (per the scene classification
layer), so list several dates for cloudy cities.
Imagery: Contains modified Copernicus Sentinel data.

Usage: pip install rasterio numpy pillow && python tools/fetch_imagery.py <city>
"""
import json, os, sys
import numpy as np
import rasterio
from rasterio.vrt import WarpedVRT
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from PIL import Image

CITY = sys.argv[1] if len(sys.argv) > 1 else 'spartanburg'
CFG = json.load(open(os.path.join(os.path.dirname(__file__), 'cities', f'{CITY}.json')))
W, S, E, N = CFG['bbox']
SIZE = 4096
BUCKET = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/'

out = np.zeros((3, SIZE, SIZE), dtype=np.uint8)
filled = np.zeros((SIZE, SIZE), dtype=bool)
# Pixels that only cloudy scenes cover, used if no clear scene has them.
fallback = np.zeros((3, SIZE, SIZE), dtype=np.uint8)
fb_filled = np.zeros((SIZE, SIZE), dtype=bool)
# Scene classification (SCL) values to skip: no data, defective, cloud shadow,
# cloud (medium/high probability) and thin cirrus.
CLOUDY = [0, 1, 3, 8, 9, 10]
dst_transform = from_bounds(W, S, E, N, SIZE, SIZE)
def warped(url, resampling):
    with rasterio.open(url) as src, WarpedVRT(src, crs='EPSG:4326', transform=dst_transform,
                                               width=SIZE, height=SIZE, resampling=resampling) as vrt:
        return vrt.read()
with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif'):
    for scene in CFG['imagery']:
        if filled.all():
            break
        name = scene.rstrip('/').split('/')[-1]
        base = f'/vsicurl/{BUCKET}{scene.rstrip("/")}'
        print('reading', name, flush=True)
        data = warped(f'{base}/TCI.tif', Resampling.bilinear)
        has = data.sum(axis=0) > 0
        scl = warped(f'{base}/SCL.tif', Resampling.nearest)[0]
        clear = has & ~np.isin(scl, CLOUDY)
        new = clear & ~filled
        out[:, new] = data[:, new]
        filled |= new
        fb = has & ~fb_filled
        fallback[:, fb] = data[:, fb]
        fb_filled |= fb
        print(f'  clear here {clear.mean():.0%}, filled so far {filled.mean():.1%}', flush=True)
holes = ~filled & fb_filled
out[:, holes] = fallback[:, holes]
filled |= holes
print('coverage', filled.mean())
img = np.transpose(out, (1, 2, 0)).astype(np.float32)
# Sentinel true color is dark and flat; brighten and add a little contrast.
img = np.clip((img / 255.0) ** 0.8 * 1.35 * 255, 0, 255).astype(np.uint8)
os.makedirs('public/cities', exist_ok=True)
Image.fromarray(img).save(f'public/cities/{CITY}-sat.jpg', quality=82, optimize=True, progressive=True)
print('saved', os.path.getsize(f'public/cities/{CITY}-sat.jpg') // 1024, 'KB')

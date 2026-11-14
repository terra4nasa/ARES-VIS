#!/usr/bin/env python3
"""
Fetch an optical (CTX mosaic) window around the Elysium Planitia seed route from
Esri OnMars, stitch + downsample to a single JPEG used as the color map for the
first-person visor terrain renderer.

Output:
  public/assets/data/visor_window.jpg    1536x1536 optical window (~20 m/px)
  public/assets/data/visor_window.json   geographic manifest {w,h,lon0,lat1,lon1,lat0,resM,src}
"""
import io
import json
import math
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "data")
BASE = "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}"
Z = 12            # CTX level 12  (~20.4 m/px on Mars)
TILE_PX = 256

# route centroid (seed POIs span lon 135.612-135.69, lat 4.487-4.525)
C_LAT, C_LON = 4.5060, 135.6510

# Mars constants
R_M = 3_396_190.0          # m
M_PER_DEG_LAT = math.pi * R_M / 180.0            # ~59274 m
M_PER_DEG_LON = M_PER_DEG_LAT * math.cos(math.radians(C_LAT))

HALF_KM = 16.0             # window half-size in km  -> ~32 km window
OUT_PX = 1536

# tile grid geometry (ArcGIS Online 4326 scheme, origin -180/+90)
DEG_PER_TILE = 360.0 / (1 << Z) / 1.0     # per 256px tile: 360/2^z
DEG_PER_PX = DEG_PER_TILE / TILE_PX


def tile_for(lon: float, lat: float) -> tuple[int, int]:
    col = math.floor((lon + 180.0) / DEG_PER_TILE)
    row = math.floor((90.0 - lat) / DEG_PER_TILE)
    return col, row


def fetch_tile(x: int, y: int) -> Image.Image:
    url = BASE.format(z=Z, y=y, x=x)
    req = urllib.request.Request(url, headers={"User-Agent": "ares-vis-asset-gen/1.0"})
    with urllib.request.urlopen(req, timeout=45) as r:
        data = r.read()
    return Image.open(io.BytesIO(data)).convert("L")


def main() -> None:
    half_lon = HALF_KM * 1000.0 / M_PER_DEG_LON
    half_lat = HALF_KM * 1000.0 / M_PER_DEG_LAT
    w_lon, e_lon = C_LON - half_lon, C_LON + half_lon
    s_lat, n_lat = C_LAT - half_lat, C_LAT + half_lat
    c0, r0 = tile_for(w_lon, n_lat)   # top-left
    c1, r1 = tile_for(e_lon, s_lat)   # bottom-right
    cols, rows = c1 - c0 + 1, r1 - r0 + 1
    print(f"window lon {w_lon:.4f}..{e_lon:.4f}  lat {s_lat:.4f}..{n_lat:.4f}")
    print(f"tiles: cols {c0}..{c1} rows {r0}..{r1} -> {cols}x{rows} = {cols*rows}")

    big = Image.new("L", (cols * TILE_PX, rows * TILE_PX))
    jobs = [(x, y) for y in range(r0, r1 + 1) for x in range(c0, c1 + 1)]
    with ThreadPoolExecutor(max_workers=8) as ex:
        for (x, y), img in zip(jobs, ex.map(lambda j: fetch_tile(*j), jobs)):
            big.paste(img, ((x - c0) * TILE_PX, (y - r0) * TILE_PX))
    print("stitched:", big.size)

    # crop the exact requested window (centered on route centroid)
    big_lon0 = c0 * DEG_PER_TILE - 180.0
    big_lat1 = 90.0 - r0 * DEG_PER_TILE
    px_per_deg = TILE_PX / DEG_PER_TILE
    cx = (C_LON - big_lon0) * px_per_deg
    cy = (big_lat1 - C_LAT) * px_per_deg
    half = OUT_PX / 2
    left, top = int(round(cx - half)), int(round(cy - half))
    box = (left, top, left + OUT_PX, top + OUT_PX)
    win = big.crop(box)

    lon0 = big_lon0 + left / px_per_deg
    lon1 = big_lon0 + (left + OUT_PX) / px_per_deg
    lat1 = big_lat1 - top / px_per_deg
    lat0 = big_lat1 - (top + OUT_PX) / px_per_deg
    resM = (lon1 - lon0) * M_PER_DEG_LON / OUT_PX

    os.makedirs(OUT_DIR, exist_ok=True)
    jp = os.path.join(OUT_DIR, "visor_window.jpg")
    win.save(jp, "JPEG", quality=82, optimize=True)
    manifest = {
        "w": OUT_PX,
        "h": OUT_PX,
        "lon0": round(lon0, 7),
        "lat1": round(lat1, 7),
        "lon1": round(lon1, 7),
        "lat0": round(lat0, 7),
        "resM": round(resM, 2),
        "src": "Esri OnMars CTX mosaic level 12 (~20 m/px), grayscale, tinted client-side",
    }
    with open(os.path.join(OUT_DIR, "visor_window.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print("saved", jp, win.size, "resM", round(resM, 2))
    print("manifest:", manifest)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
ARES-VIS asset generator v2 — parallel HTTP-range TIFF reader.
Pulls exact row bands from NASA PDS GeoTIFFs (USGS Astrogeology S3) at ~25 MB/s.
Datasets:
  - HRSC-MOLA blended DEM 200 m/px (global, Int16) -> relief PNGs, slope hazard, terrain grids
  - THEMIS Day/Night IR controlled mosaics 100 m/px (Elysium quad) -> thermal PNGs
  - InSight POV photos (Wikimedia Commons) -> public/assets/img/pov_*
"""
import os
import struct, json, os, math, base64, zlib, urllib.request, urllib.parse, sys, time
import concurrent.futures as cf
import numpy as np
from PIL import Image

PROJ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = f"{PROJ}/public/assets"
TMP = "/tmp/assetgen"
os.makedirs(f"{OUT}/img", exist_ok=True)
os.makedirs(f"{OUT}/data", exist_ok=True)
os.makedirs(TMP, exist_ok=True)

R = 3396190.0
MPD = R * math.pi / 180.0
S3 = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars"
DEM_SRC = f"{S3}/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif"
DEM_OVR2 = DEM_SRC + ".ovr"  # overview level 2 = 1600 m/px (third listed overview)
THEMIS_DAY = f"{S3}/THEMIS_controlled_mosaics/Elysium_DayIR_31July2014/THEMIS_DayIR_ControlledMosaic_Elysium_00N135E_100mpp.tif"
THEMIS_DAY_LBL = THEMIS_DAY.replace(".tif", ".lbl")
THEMIS_NIGHT = f"{S3}/THEMIS_controlled_mosaics/Elysium_NightIR_30April2015/THEMIS_NightIR_ControlledMosaic_Elysium_00N135E_100mpp.tif"
UA = {"User-Agent": "ARES-VIS/1.0 (Space Apps 2026 educational use)"}

TYPESIZE = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8}


def http_range(url, start, length, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={**UA, "Range": f"bytes={start}-{start + length - 1}"})
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read()
        except Exception as e:
            print(f"    [range retry {attempt + 1}] {url.split('/')[-1]} @{start // 1000000}MB ({length}B): {e}", flush=True)
            if attempt == retries - 1:
                raise
            time.sleep(0.5 * (attempt + 1))


class Tiff:
    """Minimal TIFF/BigTIFF metadata reader (little-endian; GDAL output)."""

    def __init__(self, url, level_width=None):
        self.url = url
        self.level_width = level_width  # pick IFD whose ImageWidth == this
        head = http_range(url, 0, 1 << 20)
        bo = head[:2]
        if bo == b"II":
            self.en = "<"
        elif bo == b"MM":
            self.en = ">"
        else:
            raise ValueError("not a TIFF")
        magic = struct.unpack(self.en + "H", head[2:4])[0]
        if magic == 42:  # classic
            self.big = False
            ifd_off = struct.unpack(self.en + "I", head[4:8])[0]
        elif magic == 43:  # BigTIFF
            self.big = True
            ifd_off = struct.unpack(self.en + "Q", head[8:16])[0]
        else:
            raise ValueError("not a TIFF")
        offsz = 8 if self.big else 4
        self.tag_lists = []  # [(start_off, [(tag,typ,cnt,raw), ...])]
        ifd = ifd_off
        guard = 0
        while ifd and guard < 24:
            guard += 1
            hdr = http_range(url, ifd, 8 if self.big else 2)
            n = struct.unpack(self.en + ("Q" if self.big else "H"), hdr)[0]
            print(f"    IFD {guard - 1} @ {ifd}: {n} entries", flush=True)
            esz = 20 if self.big else 12
            ents_off = ifd + (8 if self.big else 2)
            ents = http_range(url, ents_off, n * esz)
            entries = []
            for i in range(n):
                e = i * esz
                if self.big:
                    tag, typ, cnt = struct.unpack(self.en + "HHQ", ents[e:e + 12])
                    val = ents[e + 12:e + 20]
                else:
                    tag, typ, cnt = struct.unpack(self.en + "HHI", ents[e:e + 8])
                    val = ents[e + 8:e + 12]
                size = TYPESIZE.get(typ, offsz) * cnt
                if size <= offsz:
                    raw = val[:size]
                else:
                    off = struct.unpack(self.en + ("Q" if self.big else "I"), val[:offsz])[0]
                    raw = http_range(url, off, size) if off + size > len(head) else head[off:off + size]
                entries.append((tag, typ, cnt, raw))
            self.tag_lists.append((ifd, entries))
            nxt_raw = head[ents_off + n * esz:ents_off + n * esz + offsz] if ents_off + n * esz + offsz <= len(head) else http_range(url, ents_off + n * esz, offsz)
            nxt = struct.unpack(self.en + ("Q" if self.big else "I"), nxt_raw)[0]
            ifd = nxt
        # choose IFD whose ImageWidth matches requested level (default 0)
        pick = 0
        if self.level_width:
            for k, (_, entries) in enumerate(self.tag_lists):
                d = dict((t[0], t[1:]) for t in entries)
                if 256 in d and self._int(d[256]) == self.level_width:
                    pick = k
                    break
        tags = dict((t[0], t[1:]) for t in self.tag_lists[pick][1])
        self.width = self._int(tags[256])
        self.height = self._int(tags[257])
        self.bps = self._int(tags.get(258, self._mk(3, 1)))
        self.spp = self._int(tags.get(277, self._mk(3, 1)))
        self.compression = self._int(tags[259])
        sf = tags.get(339)
        self.signed = self._int(sf) in (2, 3) if sf else self.bps != 8
        self.rps = self._int(tags.get(278, self._mk(4, self.height)))
        self.tiled = 324 in tags
        if self.tiled:
            self.tw = self._int(tags[322])
            self.th = self._int(tags[323])
            self.offsets = self._arr(tags[324])
            self.counts = self._arr(tags[325])
        else:
            self.offsets = self._arr(tags[273])
            self.counts = self._arr(tags[279])
        self.predictor = self._int(tags.get(317, self._mk(3, 1)))

    def _mk(self, typ, val):
        return (typ, 1, struct.pack(self.en + ("I" if typ == 4 else "H" if typ == 3 else "Q"), val))

    def _int(self, t):
        typ, cnt, raw = t
        if typ == 4:
            return struct.unpack(self.en + "I", raw[:4])[0]
        if typ == 16:
            return struct.unpack(self.en + "Q", raw[:8])[0]
        return struct.unpack(self.en + "H", raw[:2])[0]

    def _arr(self, t):
        typ, cnt, raw = t
        sz = TYPESIZE[typ]
        fmt = {4: "I", 3: "H", 16: "Q"}[typ]
        return list(struct.unpack(self.en + f"{cnt}{fmt}", raw))


def fetch_region(t: Tiff, r0: int, r1: int, c0: int, c1: int, workers=24):
    """Fetch a pixel region [r0:r1, c0:c1) from stripped or tiled TIFF, parallel."""
    kind = "i" if t.signed else "u"
    dtype = np.dtype(f"{t.en}{kind}{t.bps // 8}")
    if not t.tiled:
        offs = t.offsets[r0:r1]
        cnts = t.counts[r0:r1]
        comp = t.compression
        if comp == 1 and len(offs) > 1 and offs[1] - offs[0] == cnts[0]:
            blob = http_range(t.url, offs[0], offs[-1] + cnts[-1] - offs[0])
            cells = [blob[o - offs[0]:o - offs[0] + c] for o, c in zip(offs, cnts)]
        else:
            def job(i):
                return http_range(t.url, offs[i], cnts[i])
            with cf.ThreadPoolExecutor(workers) as ex:
                cells = list(ex.map(job, range(len(offs))))
        row_bytes = t.width * t.spp * t.bps // 8
        out = np.zeros((r1 - r0, t.width), dtype=dtype)
        for i, chunk in enumerate(cells):
            if comp in (8, 32946):
                chunk = zlib.decompress(chunk)
            elif comp != 1:
                raise ValueError(f"compression {comp} unsupported")
            n = len(chunk) // (t.width * t.spp * t.bps // 8)
            arr = np.frombuffer(chunk, dtype=dtype).reshape(n, t.width, t.spp) if t.spp > 1 else np.frombuffer(chunk, dtype=dtype).reshape(n, t.width)
            if t.spp > 1:
                arr = arr[:, :, 0]
            out[i * t.rps:i * t.rps + arr.shape[0]] = arr
        return out[:, c0:c1], comp
    # tiled: assemble covering tile range
    ty0, ty1 = r0 // t.th, (r1 - 1) // t.th
    tx0, tx1 = c0 // t.tw, (c1 - 1) // t.tw
    tpr = (t.width + t.tw - 1) // t.tw
    idxs = [ty * tpr + tx for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
    offs = [t.offsets[i] for i in idxs]
    cnts = [t.counts[i] for i in idxs]
    th, tw = t.th, t.tw
    band_rows = (ty1 - ty0 + 1) * th
    band_cols = (tx1 - tx0 + 1) * tw
    comp = t.compression
    if comp == 1 and len(offs) > 1 and offs[1] - offs[0] == cnts[0]:
        blob = http_range(t.url, offs[0], offs[-1] + cnts[-1] - offs[0])
        cells = [blob[o - offs[0]:o - offs[0] + c] for o, c in zip(offs, cnts)]
    else:
        def job(i):
            return http_range(t.url, offs[i], cnts[i])
        with cf.ThreadPoolExecutor(workers) as ex:
            cells = list(ex.map(job, range(len(offs))))
    canvas = np.zeros((band_rows, band_cols), dtype=dtype)
    k = 0
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            chunk = cells[k]; k += 1
            if comp in (8, 32946):
                chunk = zlib.decompress(chunk)
            elif comp != 1:
                raise ValueError(f"compression {comp} unsupported")
            arr = np.frombuffer(chunk, dtype=dtype).reshape(th, tw)
            canvas[(ty - ty0) * th:(ty - ty0 + 1) * th, (tx - tx0) * tw:(tx - tx0 + 1) * tw] = arr
    return canvas[r0 - ty0 * th:r1 - ty0 * th, c0 - tx0 * tw:c1 - tx0 * tw], comp


def decode_strips(t: Tiff, buf, comp, idx0, idx1):
    """Return decoded (rows, width) uint array for strip indices."""
    rows = []
    width = t.width
    spp = t.spp
    dtype = np.dtype(f"{t.en}u{t.bps // 8}")
    row_bytes = width * spp * t.bps // 8
    raw = bytes(buf)
    for i in range(idx1 - idx0):
        off = t.offsets[idx0 + i] - t.offsets[idx0]
        cnt = t.counts[idx0 + i]
        chunk = raw[off:off + cnt]
        if comp == 8 or comp == 32946:
            chunk = zlib.decompress(chunk)
        elif comp == 5:
            raise ValueError("LZW unsupported")
        elif comp != 1:
            raise ValueError(f"compression {comp} unsupported")
        strip_rows = t.rps
        n = len(chunk) // row_bytes
        if spp > 1:  # take first band
            arr = np.frombuffer(chunk, dtype=dtype).reshape(n, width, spp)[:, :, 0]
        else:
            arr = np.frombuffer(chunk, dtype=dtype).reshape(n, width)
        rows.append(arr)
    return np.concatenate(rows) if rows else np.zeros((0, width), dtype=dtype)


def rows_for_lat(lat_s, lat_n, height):
    """Top/bottom row indices for a lat band (lat_s=south edge, lat_n=north edge)."""
    r_top = int((90 - lat_n) * height / 180)
    r_bot = int((90 - lat_s) * height / 180)
    return max(0, r_top), min(height, r_bot + 1)


def cols_for_lon(lon0, lon1, width):
    c0 = int((lon0 + 180) * width / 360)
    c1 = int((lon1 + 180) * width / 360)
    return max(0, c0), min(width, c1 + 1)


print("== A. parse TIFF structures"); sys.stdout.flush()
dem_ovr = Tiff(DEM_OVR2, level_width=13337)  # overview level 2 = 1600 m/px
dem = Tiff(DEM_SRC)
print(f"  ovr level: {dem_ovr.width}x{dem_ovr.height} comp={dem_ovr.compression} tiled={dem_ovr.tiled} tile={getattr(dem_ovr,'tw','-')}")
print(f"  base: {dem.width}x{dem.height} comp={dem.compression} rps={dem.rps} tiled={dem.tiled}")

print("== B. regional DEM band (1600 m/px)"); sys.stdout.flush()
r0, r1 = rows_for_lat(-6, 14, dem_ovr.height)
c0, c1 = cols_for_lon(122, 150, dem_ovr.width)
dem_reg, _ = fetch_region(dem_ovr, r0, r1, c0, c1)
dem_reg = dem_reg.astype(np.float32)
print(f"  regional band: {dem_reg.shape}")
nod = dem_reg <= -32000
if nod.any():
    dem_reg[nod] = np.nanmean(np.where(nod, np.nan, dem_reg))

print("== C. local DEM band (200 m/px)"); sys.stdout.flush()
r0, r1 = rows_for_lat(3.9, 5.1, dem.height)
c0, c1 = cols_for_lon(134.8, 136.4, dem.width)
dem_loc, _ = fetch_region(dem, r0, r1, c0, c1)
dem_loc = dem_loc.astype(np.float32)
print(f"  local band: {dem_loc.shape}")
nod = dem_loc <= -32000
if nod.any():
    dem_loc[nod] = np.nanmean(np.where(nod, np.nan, dem_loc))

# --- palettes / shaders -------------------------------------------------
def mola_palette(elev_km):
    stops = [(-6.0, (12, 18, 100)), (-4.0, (28, 60, 150)), (-3.0, (58, 110, 190)),
             (-2.0, (110, 160, 212)), (-1.0, (158, 205, 226)), (-0.5, (212, 232, 190)),
             (0.0, (250, 246, 160)), (1.0, (242, 192, 110)), (2.0, (226, 132, 80)),
             (4.0, (198, 68, 58)), (6.0, (245, 245, 245))]
    e = np.clip(elev_km, stops[0][0], stops[-1][0])
    rgb = np.zeros(e.shape + (3,), dtype=np.float32)
    for i in range(len(stops) - 1):
        e0, c0 = stops[i]; e1, c1 = stops[i + 1]
        m = (e >= e0) & (e <= e1)
        if not m.any():
            continue
        tt = np.where(m, (e - e0) / (e1 - e0), 0)[..., None]
        rgb = np.where(m[..., None], np.array(c0, dtype=np.float32) * (1 - tt) + np.array(c1, dtype=np.float32) * tt, rgb)
    return rgb


def hillshade(elev, res_m, az=315, alt=45):
    dzdx = (np.roll(elev, -1, 1) - np.roll(elev, 1, 1)) / (2 * res_m)
    dzdy = (np.roll(elev, -1, 0) - np.roll(elev, 1, 0)) / (2 * res_m)
    dzdx[:, [0, -1]] = 0
    dzdy[[0, -1], :] = 0
    n = np.dstack([-dzdx, -dzdy, np.ones_like(elev)])
    n /= np.linalg.norm(n, axis=2)[..., None]
    a, z = math.radians(az), math.radians(90 - alt)
    L = np.array([math.sin(a) * math.sin(z), -math.cos(a) * math.sin(z), math.cos(z)])
    return np.clip((n * L).sum(axis=2), 0, 1)


def save_png(arr, path):
    Image.fromarray(arr).save(path, optimize=True)
    print(f"saved {path} {os.path.getsize(path)/1e6:.2f} MB")
    sys.stdout.flush()


print("== D. relief + hazard renders"); sys.stdout.flush()
rgb = mola_palette(dem_reg / 1000.0)
sh = hillshade(np.nan_to_num(dem_reg), 1600)
save_png(np.clip(rgb * (0.42 + 0.58 * sh)[..., None], 0, 255).astype(np.uint8), f"{OUT}/img/relief_regional.png")

rgb = mola_palette(dem_loc / 1000.0)
sh = hillshade(np.nan_to_num(dem_loc), 200)
save_png(np.clip(rgb * (0.40 + 0.60 * sh)[..., None], 0, 255).astype(np.uint8), f"{OUT}/img/relief_local.png")

resx = 200 / math.cos(math.radians(4.5))
dzdx = (np.roll(dem_loc, -1, 1) - np.roll(dem_loc, 1, 1)) / (2 * resx)
dzdy = (np.roll(dem_loc, -1, 0) - np.roll(dem_loc, 1, 0)) / (2 * 200)
slope_deg = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
hazard = np.zeros(dem_loc.shape + (4,), dtype=np.uint8)
for thr, col, alpha in [(1.5, (0, 0, 0), 0), (3.0, (250, 204, 21), 60), (6.0, (249, 115, 22), 100),
                        (12.0, (220, 38, 38), 140), (999.0, (127, 29, 29), 175)]:
    prev = 0 if thr == 1.5 else {1.5: 0, 3.0: 1.5, 6.0: 3.0, 12.0: 6.0, 999.0: 12.0}[thr]
    m = (slope_deg > prev) & (slope_deg <= thr)
    if thr > 1.5:
        hazard[m] = (*col, alpha)
save_png(hazard, f"{OUT}/img/slope_hazard.png")

print("== E. terrain grids"); sys.stdout.flush()
def grid_b64(a):
    return base64.b64encode(np.round(a).astype("<i2").tobytes()).decode()
local_grid = {"w": dem_loc.shape[1], "h": dem_loc.shape[0], "lon0": 134.8, "lat1": 5.1,
              "lon1": 136.4, "lat0": 3.9, "res": 200, "resx": round(resx), "units": "m MOLA areoid",
              "data": grid_b64(dem_loc)}
regional_grid = {"w": dem_reg.shape[1], "h": dem_reg.shape[0], "lon0": 122, "lat1": 14,
                 "lon1": 150, "lat0": -6, "res": 1600, "resx": round(1600 / math.cos(math.radians(4.5))),
                 "units": "m MOLA areoid", "data": grid_b64(dem_reg)}
with open(f"{OUT}/data/terrain.json", "w") as f:
    json.dump({"local": local_grid, "regional": regional_grid,
               "site": {"lat": 4.502388, "lon": 135.623447, "elev": -2413.0}}, f)
print(f"  terrain.json {os.path.getsize(f'{OUT}/data/terrain.json')/1e6:.2f} MB")

print("== F. THEMIS day/night IR"); sys.stdout.flush()
def lbl_extent(url):
    """Parse geographic extent from PDS label (ISIS/PDS4/PDS3 keys)."""
    txt = http_range(url, 0, 200000).decode("utf-8", "ignore")
    import re as _re
    vals = {}
    for key in ["minimum_?latitude", "maximum_?latitude", "minimum_?longitude", "maximum_?longitude"]:
        m = _re.search(key + r"[^0-9\-.]*([\-0-9\.]+)", txt, _re.I)
        if m:
            vals[key] = float(m.group(1))
    if len(vals) < 4:
        return None
    return (vals["minimum_?latitude"], vals["maximum_?latitude"],
            vals["minimum_?longitude"], vals["maximum_?longitude"])

def quad_roi(url, roi):
    """roi = (lat_s, lat_n, lon_w, lon_e) mapped within the quad's true extent."""
    t = Tiff(url)
    lat_s, lat_n = 0.0, 30.0
    lon_w, lon_e = 135.0, 180.0
    ext = lbl_extent(url.replace(".tif", ".lbl"))
    if ext:
        lat_s, lat_n, lon_w, lon_e = ext
        print(f"    lbl extent: lat {lat_s}..{lat_n}, lon {lon_w}..{lon_e}")
    rl_s, rl_n, rl_w, rl_e = roi
    def lat_to_row(lat):
        return int(round((lat_n - lat) / (lat_n - lat_s) * t.height))
    def lon_to_col(lon):
        return int(round((lon - lon_w) / (lon_e - lon_w) * t.width))
    r0, r1 = lat_to_row(rl_n), lat_to_row(rl_s) + 1
    c0, c1 = lon_to_col(rl_w), lon_to_col(rl_e) + 1
    if (r1 - r0) * (c1 - c0) > 40_000_000:
        raise ValueError("ROI too large")
    arr, _ = fetch_region(t, r0, r1, c0, c1)
    return arr.astype(np.float32)

day = quad_roi(THEMIS_DAY, (3.8, 5.2, 135.2, 137.0))
print(f"  day: {day.shape}")
nod = day <= 0
if nod.any():
    day[nod] = np.nanmean(np.where(nod, np.nan, day))
lo, hi = np.percentile(day, [1, 99])
g = np.clip((day - lo) / (hi - lo), 0, 1)
c0 = np.array([52, 36, 26], dtype=np.float32); c1 = np.array([255, 236, 208], dtype=np.float32)
save_png((c0 * (1 - g[..., None]) + c1 * g[..., None]).astype(np.uint8), f"{OUT}/img/themis_dayir.png")

night = quad_roi(THEMIS_NIGHT, (3.8, 5.2, 135.2, 137.0))
print(f"  night: {night.shape}")
nod = night <= 0
if nod.any():
    night[nod] = np.nanmean(np.where(nod, np.nan, night))
lo, hi = np.percentile(night, [1, 99])
g = np.clip((night - lo) / (hi - lo), 0, 1)
c0 = np.array([24, 14, 58], dtype=np.float32); c1 = np.array([255, 176, 92], dtype=np.float32)
save_png((c0 * (1 - g[..., None]) + c1 * g[..., None]).astype(np.uint8), f"{OUT}/img/themis_nightir.png")

print("== G. InSight POV images (NASA Image Library)"); sys.stdout.flush()
NASA_QUERIES = {
    "panorama.jpg": "InSight panorama",
    "selfie.jpg": "InSight self-portrait",
    "hirise_site.jpg": "InSight landing site HiRISE",
    "final_location.jpg": "InSight final selfie",
    "mole.png": "InSight mole HP3",
}
CREDITS = {
    "panorama.jpg": "NASA/JPL-Caltech",
    "selfie.jpg": "NASA/JPL-Caltech",
    "hirise_site.jpg": "NASA/JPL-Caltech/University of Arizona",
    "final_location.jpg": "NASA/JPL-Caltech",
    "mole.png": "NASA/JPL-Caltech",
}

def nasa_search(q):
    url = "https://images-api.nasa.gov/search?q=" + urllib.parse.quote(q) + "&media_type=image"
    req = urllib.request.Request(url, headers={"User-Agent": UA["User-Agent"]})
    d = json.loads(urllib.request.urlopen(req, timeout=40).read())
    items = d.get("collection", {}).get("items", [])
    out = []
    for it in items[:8]:
        data = it.get("data", [{}])[0]
        links = it.get("links", [])
        if links:
            out.append({"nasa_id": data.get("nasa_id"), "title": data.get("title"), "thumb": links[0].get("href")})
    return out

def nasa_asset(nasa_id):
    url = f"https://images-api.nasa.gov/asset/{urllib.parse.quote(nasa_id)}"
    req = urllib.request.Request(url, headers={"User-Agent": UA["User-Agent"]})
    d = json.loads(urllib.request.urlopen(req, timeout=40).read())
    items = d.get("collection", {}).get("items", [])
    best = None
    for it in items:
        href = it.get("href", "")
        if "~large" in href and href.endswith(".jpg"):
            return href
        if "~orig" in href and href.endswith((".jpg", ".png")):
            best = href
    return best or (items[0].get("href") if items else None)

manifest = []
for local, q in NASA_QUERIES.items():
    got = False
    try:
        results = nasa_search(q)
        for r in results:
            if not r.get("nasa_id"):
                continue
            try:
                asset = nasa_asset(r["nasa_id"])
                if not asset:
                    continue
                req = urllib.request.Request(asset, headers={"User-Agent": UA["User-Agent"]})
                data = urllib.request.urlopen(req, timeout=90).read()
                if len(data) < 20000 or len(data) > 9_000_000:
                    continue
                open(f"{OUT}/img/pov_{local}", "wb").write(data)
                manifest.append({"file": f"assets/img/pov_{local}", "title": r.get("title", q),
                                 "credit": CREDITS[local], "kb": round(len(data) / 1024)})
                print(f"  {local} <- NASA {r['nasa_id']} {len(data)//1024} KB")
                got = True
                break
            except Exception as e:
                print(f"    skip {r.get('nasa_id')}: {e}")
    except Exception as e:
        print(f"  NASA search failed for {q}: {e}")
    if not got:
        print(f"  FAILED {local} ({q})")
with open(f"{OUT}/data/pov_manifest.json", "w") as f:
    json.dump(manifest, f, indent=1)

print("== H. waypoint terrain sampling"); sys.stdout.flush()
WPS = [("BASE-01", 135.6234, 4.5024), ("SC-01", 135.6450, 4.5090),
       ("SC-02", 135.6680, 4.4980), ("SC-03", 135.6900, 4.5150),
       ("SC-04", 135.6120, 4.5250), ("SC-05", 135.6330, 4.4870)]
samples = {}
for name, lon, lat in WPS:
    cc = int((lon - 134.8) / (136.4 - 134.8) * (dem_loc.shape[1] - 1))
    rr = int((5.1 - lat) / (5.1 - 3.9) * (dem_loc.shape[0] - 1))
    cc = int(np.clip(cc, 1, dem_loc.shape[1] - 2)); rr = int(np.clip(rr, 1, dem_loc.shape[0] - 2))
    e = dem_loc[rr, cc]
    sl = slope_deg[rr, cc]
    samples[name] = {"lon": lon, "lat": lat, "elev_m": round(float(e)), "slope_deg": round(float(sl), 1)}
    print(f"  {name}: elev {e:.0f} m, slope {sl:.1f} deg")
with open(f"{OUT}/data/waypoint_terrain.json", "w") as f:
    json.dump(samples, f, indent=1)
print("DONE")

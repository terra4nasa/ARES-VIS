// Client-side terrain sampling from baked HRSC-MOLA DEM grids
export interface TerrainGrid {
  w: number;
  h: number;
  lon0: number;
  lat1: number;
  lon1: number;
  lat0: number;
  res: number;
  resx: number;
  units: string;
  data: string; // base64 int16 LE row-major, top-left origin
}

interface TerrainData {
  local: TerrainGrid;
  regional: TerrainGrid;
  site: { lat: number; lon: number; elev: number };
}

let cache: TerrainData | null = null;
let pending: Promise<TerrainData> | null = null;

export async function loadTerrain(): Promise<TerrainData> {
  if (cache) return cache;
  if (!pending) {
    /* Relative URL: resolves under the deployed base path (GitHub Pages /ARES-VIS/, Vercel /, dev /) */
    pending = fetch("assets/data/terrain.json")
      .then((r) => {
        if (!r.ok) throw new Error(`terrain.json HTTP ${r.status}`);
        return r.json() as Promise<TerrainData>;
      })
      .then((d) => {
        cache = d;
        return d;
      })
      .catch((e) => {
        pending = null; // don't cache the rejection — allow a retry on next call
        throw e;
      });
  }
  return pending;
}

const decodeCache = new WeakMap<TerrainGrid, Int16Array>();

function decode(grid: TerrainGrid): Int16Array {
  const hit = decodeCache.get(grid);
  if (hit) return hit;
  const bin = atob(grid.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const arr = new Int16Array(bytes.buffer);
  decodeCache.set(grid, arr);
  return arr;
}

/** bilinear elevation sample (m above MOLA areoid) — null if outside grid */
export function sampleElevation(grid: TerrainGrid, lon: number, lat: number): number | null {
  const { w, h, lon0, lon1, lat0, lat1 } = grid;
  if (lon < lon0 || lon > lon1 || lat < lat0 || lat > lat1) return null;
  const fx = ((lon - lon0) / (lon1 - lon0)) * (w - 1);
  const fy = ((lat1 - lat) / (lat1 - lat0)) * (h - 1);
  const x0 = Math.min(w - 2, Math.max(0, Math.floor(fx)));
  const y0 = Math.min(h - 2, Math.max(0, Math.floor(fy)));
  const tx = fx - x0;
  const ty = fy - y0;
  const d = decode(grid);
  const idx = (yy: number, xx: number) => d[yy * w + xx];
  const v =
    idx(y0, x0) * (1 - tx) * (1 - ty) +
    idx(y0, x0 + 1) * tx * (1 - ty) +
    idx(y0 + 1, x0) * (1 - tx) * ty +
    idx(y0 + 1, x0 + 1) * tx * ty;
  return v;
}

export interface Sample {
  dist: number; // m from route start
  elev: number; // m
  slope: number; // deg
  lon: number;
  lat: number;
}

/** Walk sample points along polyline; sample local grid, fall back to regional */
export async function profileAlongPath(
  pts: Array<{ lon: number; lat: number }>,
  stepM = 100
): Promise<Sample[]> {
  const t = await loadTerrain();
  const out: Sample[] = [];
  const toRad = Math.PI / 180;
  const R = 3396.19;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dLat = (b.lat - a.lat) * toRad;
    const dLon = (b.lon - a.lon) * toRad;
    const hAv =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
    const segM = 2 * R * Math.asin(Math.sqrt(hAv)) * 1000;
    const n = Math.max(1, Math.round(segM / stepM));
    for (let k = 0; k <= n; k++) {
      const tK = k / n;
      const lon = a.lon + (b.lon - a.lon) * tK;
      const lat = a.lat + (b.lat - a.lat) * tK;
      const elev = sampleElevation(t.local, lon, lat) ?? sampleElevation(t.regional, lon, lat);
      if (elev === null) continue;
      out.push({ dist: acc + segM * tK, elev, slope: 0, lon, lat });
    }
    acc += segM;
  }
  // slope from local grid gradient at each sample (200 m baseline, no noise)
  const t2 = t;
  const d = decode(t2.local);
  for (const s of out) {
    const fx = ((s.lon - t2.local.lon0) / (t2.local.lon1 - t2.local.lon0)) * (t2.local.w - 1);
    const fy = ((t2.local.lat1 - s.lat) / (t2.local.lat1 - t2.local.lat0)) * (t2.local.h - 1);
    const x = Math.min(t2.local.w - 2, Math.max(1, Math.round(fx)));
    const y = Math.min(t2.local.h - 2, Math.max(1, Math.round(fy)));
    const dzx = (d[y * t2.local.w + x + 1] - d[y * t2.local.w + x - 1]) / (2 * t2.local.resx);
    const dzy = (d[(y + 1) * t2.local.w + x] - d[(y - 1) * t2.local.w + x]) / (2 * t2.local.res);
    s.slope = (Math.atan(Math.hypot(dzx, dzy)) * 180) / Math.PI;
  }
  return out;
}

/** max slope within corridor around point (deg, from local grid) */
export async function corridorMaxSlope(lon: number, lat: number, radiusM = 250): Promise<number> {
  const t = await loadTerrain();
  const g = t.local;
  const c0 = ((lon - g.lon0) / (g.lon1 - g.lon0)) * (g.w - 1);
  const r0 = ((g.lat1 - lat) / (g.lat1 - g.lat0)) * (g.h - 1);
  const rx = radiusM / g.resx;
  const ry = radiusM / g.res;
  const x0 = Math.max(1, Math.round(c0 - rx));
  const x1 = Math.min(g.w - 2, Math.round(c0 + rx));
  const y0 = Math.max(1, Math.round(r0 - ry));
  const y1 = Math.min(g.h - 2, Math.round(r0 + ry));
  if (x1 <= x0 || y1 <= y0) return 0;
  const d = decode(g);
  let max = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dzx = (d[y * g.w + x + 1] - d[y * g.w + x - 1]) / (2 * g.resx);
      const dzy = (d[(y + 1) * g.w + x] - d[(y - 1) * g.w + x]) / (2 * g.res);
      const s = (Math.atan(Math.hypot(dzx, dzy)) * 180) / Math.PI;
      if (s > max) max = s;
    }
  }
  return max;
}

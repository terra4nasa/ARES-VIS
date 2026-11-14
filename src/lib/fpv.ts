// First-person visor environment — real HRSC-MOLA DEM (geometry) + Esri/CTX
// optical window (color drape). Consumed by the WebGL engine in fpv3d.ts.
import { loadTerrain, type TerrainGrid } from "./terrain";

export interface FpvEnv {
  g: TerrainGrid;
  d: Int16Array;
  mLatDeg: number; // meters per degree of latitude
  mLonDeg: number; // meters per degree of longitude (at grid mid-lat)
  siteElev: number;
  tex: Uint8ClampedArray | null; // RGBA optical window (or null → procedural)
  tw: number;
  th: number;
  tlon0: number;
  tlat1: number;
  tlon1: number;
  tlat0: number;
}

let envCache: Promise<FpvEnv> | null = null;

export function loadFpvEnv(): Promise<FpvEnv> {
  if (!envCache) {
    envCache = (async () => {
      const t = await loadTerrain();
      const g = t.local;
      const bin = atob(g.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const d = new Int16Array(bytes.buffer);
      const mLatDeg = (Math.PI * 3396190) / 180;
      const mLonDeg = mLatDeg * Math.cos((((g.lat0 + g.lat1) / 2) * Math.PI) / 180);
      let tex: Uint8ClampedArray | null = null;
      let tw = 0, th = 0, tlon0 = 0, tlat1 = 0, tlon1 = 0, tlat0 = 0;
      try {
        const man = await fetch("assets/data/visor_window.json").then((r) => {
          if (!r.ok) throw new Error(`visor manifest HTTP ${r.status}`);
          return r.json();
        });
        const img = await new Promise<HTMLImageElement>((res, rej) => {
          const im = new Image();
          im.onload = () => res(im);
          im.onerror = rej;
          im.src = "assets/data/visor_window.jpg";
        });
        const cv = document.createElement("canvas");
        cv.width = man.w;
        cv.height = man.h;
        const cx = cv.getContext("2d", { willReadFrequently: true })!;
        cx.drawImage(img, 0, 0);
        tex = cx.getImageData(0, 0, man.w, man.h).data;
        tw = man.w; th = man.h; tlon0 = man.lon0; tlat1 = man.lat1; tlon1 = man.lon1; tlat0 = man.lat0;
      } catch {
        tex = null; // procedural regolith fallback
      }
      return { g, d, mLatDeg, mLonDeg, siteElev: t.site.elev, tex, tw, th, tlon0, tlat1, tlon1, tlat0 };
    })();
  }
  return envCache;
}

/** elevation (m) at lon/lat — flat site elevation outside the DEM */
export function elevAt(env: FpvEnv, lon: number, lat: number): number {
  const { g, d } = env;
  if (lon < g.lon0 || lon > g.lon1 || lat < g.lat0 || lat > g.lat1) return env.siteElev;
  const gx = ((lon - g.lon0) / (g.lon1 - g.lon0)) * (g.w - 1);
  const gy = ((g.lat1 - lat) / (g.lat1 - g.lat0)) * (g.h - 1);
  const x0 = Math.min(g.w - 2, Math.max(0, gx | 0));
  const y0 = Math.min(g.h - 2, Math.max(0, gy | 0));
  let tx = Math.min(1, Math.max(0, gx - x0));
  let ty = Math.min(1, Math.max(0, gy - y0));
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const i = (yy: number, xx: number) => d[yy * g.w + xx];
  return (
    i(y0, x0) * (1 - tx) * (1 - ty) +
    i(y0, x0 + 1) * tx * (1 - ty) +
    i(y0 + 1, x0) * (1 - tx) * ty +
    i(y0 + 1, x0 + 1) * tx * ty
  );
}

export function wrap180(a: number): number {
  return ((((a + 180) % 360) + 360) % 360) - 180;
}

/** shortest-path angular lerp step */
export function approachAngle(cur: number, target: number, k: number): number {
  return cur + wrap180(target - cur) * k;
}

/** sun elevation (equinox approx — same model as eva.ts) */
export function sunElevAt(lst: number): number {
  const ha = ((lst - 12) / 24) * 2 * Math.PI;
  return (Math.asin(Math.cos((4.5 * Math.PI) / 180) * Math.cos(ha)) * 180) / Math.PI;
}

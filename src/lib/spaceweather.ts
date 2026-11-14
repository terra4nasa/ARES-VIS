/* Space-weather pipeline shared by the server API route (/api/spaceweather)
   and the client-side GitHub-Pages fallback (direct browser → NOAA SWPC). */

export interface SpaceWeather {
  ts: string;
  f107: number;
  proton10MeV: number;
  proton100MeV: number;
  kp: number;
  solarWindSpeed: number;
  earthMars: { au: number; km: number; lightMin: number };
  marsSurface: { gcrDosePerSol: number; speClass: number; evaState: string };
  live: { f107: boolean; protons: boolean; kp: boolean };
  modelNote: string;
}

const AU_KM = 149597870.7;
const C_KM_S = 299792.458;
const DAY_MS = 86400000;

/* ---------- minimal Keplerian heliocentric model (JPL approximate elements, 1800-2050) ---------- */
interface Elements {
  a: number; aD: number; e: number; eD: number; i: number; iD: number;
  L: number; LD: number; lp: number; lpD: number; ln: number; lnD: number;
}
const EARTH: Elements = {
  a: 1.00000261, aD: 0.00000562, e: 0.01671123, eD: -0.00004392,
  i: -0.00001531, iD: -0.01294668, L: 100.46457166, LD: 35999.37244981,
  lp: 102.93768193, lpD: 0.32327364, ln: -11.26064, lnD: 0,
};
const MARS: Elements = {
  a: 1.52371034, aD: 0.00001847, e: 0.09339410, eD: 0.00008900,
  i: 1.84969110, iD: -0.00813131, L: -4.55343205, LD: 19140.30268499,
  lp: -23.94362959, lpD: 0.44441088, ln: 49.55953891, lnD: -0.29257943,
};

function heliocentric(el: Elements, T: number): [number, number, number] {
  const d2r = Math.PI / 180;
  const a = el.a + el.aD * T;
  const e = el.e + el.eD * T;
  const I = (el.i + el.iD * T) * d2r;
  const L = (el.L + el.LD * T) * d2r;
  const lp = (el.lp + el.lpD * T) * d2r;
  const ln = (el.ln + el.lnD * T) * d2r;
  const w = lp - ln;
  let M = L - lp;
  M = ((M + Math.PI) % (2 * Math.PI)) - Math.PI;
  let E = M;
  for (let k = 0; k < 12; k++) {
    E = M + e * Math.sin(E);
  }
  const xv = a * (Math.cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w);
  const cn = Math.cos(ln), sn = Math.sin(ln);
  const ci = Math.cos(I), si = Math.sin(I);
  const x = (cw * cn - sw * sn * ci) * xv + (-sw * cn - cw * sn * ci) * yv;
  const y = (cw * sn + sw * cn * ci) * xv + (-sw * sn + cw * cn * ci) * yv;
  const z = sw * si * xv + cw * si * yv;
  return [x, y, z];
}

export function earthMarsDistance(): { au: number; km: number; lightMin: number } {
  const jd = Date.now() / DAY_MS + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const [ex, ey, ez] = heliocentric(EARTH, T);
  const [mx, my, mz] = heliocentric(MARS, T);
  const dAU = Math.hypot(ex - mx, ey - my, ez - mz);
  const km = dAU * AU_KM;
  return { au: dAU, km, lightMin: km / C_KM_S / 60 };
}

/* ---------- Mars surface radiation model (calibrated to MSL RAD measurements) ---------- */
function doseModel(f107: number, proton10: number, proton100: number, kp: number) {
  const activity = Math.min(1, f107 / 240); // 0 = deep solar min, 1 = solar max
  const gcr = 0.62 + 0.2 * (1 - activity); // mSv/day - RAD: 0.64 mSv/day near solar max
  let speClass = 0;
  if (proton10 >= 10) speClass = 1;
  if (proton10 >= 100) speClass = 2;
  if (proton10 >= 1000) speClass = 3;
  const state = speClass >= 1 || proton100 >= 1 ? "SPE_POSTPONE" : kp >= 6 ? "ELEVATED" : "NOMINAL";
  return { gcr, speClass, state };
}

function latestFlux(rows: Array<Record<string, unknown>>, energy: string): number {
  let v = 0;
  for (const r of rows) {
    if (String(r.energy).includes(energy) && typeof r.flux === "number") v = r.flux;
  }
  return v;
}

export async function safeFetch<T>(url: string, ms = 8000): Promise<T | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    const res = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const NOAA_URLS = {
  f107: "https://services.swpc.noaa.gov/products/summary/10cm-flux.json",
  protons: "https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json",
  kp: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
  wind: "https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json",
};

export interface NoaaRows {
  f107Rows: Array<{ flux: number; time_tag: string }> | null;
  protonRows: Array<Record<string, unknown>> | null;
  kpRows: Array<{ Kp: number; time_tag: string }> | null;
  swRows: Array<{ proton_speed: number; time_tag: string }> | null;
}

export async function fetchNoaaRows(): Promise<NoaaRows> {
  const [f107Rows, protonRows, kpRows, swRows] = await Promise.all([
    safeFetch<Array<{ flux: number; time_tag: string }>>(NOAA_URLS.f107),
    safeFetch<Array<Record<string, unknown>>>(NOAA_URLS.protons),
    safeFetch<Array<{ Kp: number; time_tag: string }>>(NOAA_URLS.kp),
    safeFetch<Array<{ proton_speed: number; time_tag: string }>>(NOAA_URLS.wind),
  ]);
  return { f107Rows, protonRows, kpRows, swRows };
}

export function buildSpaceWeather(rows: NoaaRows): SpaceWeather {
  const { f107Rows, protonRows, kpRows, swRows } = rows;
  const f107 = f107Rows?.[0]?.flux ?? 140;
  const p10 = protonRows ? latestFlux(protonRows, ">=10 MeV") : 0;
  const p100 = protonRows ? latestFlux(protonRows, ">=100 MeV") : 0;
  const kp = kpRows?.[kpRows.length - 1]?.Kp ?? 3;
  const wind = swRows?.[0]?.proton_speed ?? 450;
  const { au, km, lightMin } = earthMarsDistance();
  const dose = doseModel(f107, p10, p100, kp);
  return {
    ts: new Date().toISOString(),
    live: { f107: !!f107Rows, protons: !!protonRows, kp: !!kpRows },
    f107,
    proton10MeV: p10,
    proton100MeV: p100,
    kp,
    solarWindSpeed: wind,
    earthMars: { au, km, lightMin },
    marsSurface: { gcrDosePerSol: dose.gcr, speClass: dose.speClass, evaState: dose.state },
    modelNote:
      "GCR surface dose calibrated to Curiosity RAD measurements (0.64 mSv/day near solar maximum); scaled by F10.7 solar activity. SPE state from GOES integral proton flux (NOAA SWPC scale S1-S5).",
  };
}

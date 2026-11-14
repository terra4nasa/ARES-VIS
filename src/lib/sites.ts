// Mars gazetteer + location services for ARES-VIS.
// Named sites use widely published landing-site / feature coordinates
// (IAU east-positive, converted to ±180° for the EPSG:4326 map). Values are
// approximate MOLA figures — planning context, not survey data.
import { SITE } from "./data";
import { haversineKm, bearingDeg, compassPoint, type LngLat } from "./mars";
import type { RouteWaypoint } from "./store";

export interface MarsSite {
  id: string;
  name: string;
  kind: "landing site" | "crater" | "volcano" | "canyon" | "plain" | "basin" | "channel" | "region" | "polar cap";
  lon: number;
  lat: number;
  elevM?: number;
  note: string;
}

export const DEFAULT_SITE = {
  name: SITE.name,
  lon: SITE.lon,
  lat: SITE.lat,
  elevM: SITE.demElevM,
  kind: "landing site" as const,
  region: "Elysium Planitia",
  source: "gazetteer" as const,
};

/** Named surface landmarks the astronaut can relocate to (or arrive near). */
export const MARS_SITES: MarsSite[] = [
  { id: "insight", name: "Homestead Hollow (InSight)", kind: "landing site", lon: SITE.lon, lat: SITE.lat, elevM: SITE.demElevM, note: "InSight lander touchdown site — Elysium Planitia (Nov 2018)." },
  { id: "jezero", name: "Jezero Crater", kind: "crater", lon: 77.45, lat: 18.44, elevM: -2744, note: "Perseverance rover & Ingenuity helicopter (Feb 2021). Delta-lake system." },
  { id: "gale", name: "Gale Crater", kind: "crater", lon: 137.85, lat: -5.36, elevM: -4501, note: "Curiosity rover, Mount Sharp (Aug 2012)." },
  { id: "olympus", name: "Olympus Mons", kind: "volcano", lon: -133.8, lat: 18.65, elevM: 21900, note: "Tallest volcano in the solar system (~22 km above datum)." },
  { id: "ascraeus", name: "Ascraeus Mons", kind: "volcano", lon: -104.35, lat: 11.77, elevM: 18200, note: "Northernmost of the Tharsis Montes." },
  { id: "pavonis", name: "Pavonis Mons", kind: "volcano", lon: -113.15, lat: 0.79, elevM: 14000, note: "Middle Tharsis shield, near-equatorial." },
  { id: "arsia", name: "Arsia Mons", kind: "volcano", lon: -120.1, lat: -8.35, elevM: 16000, note: "Southernmost Tharsis shield with a 120 km caldera." },
  { id: "candor", name: "Valles Marineris (Candor Chasma)", kind: "canyon", lon: -70.4, lat: -5.7, elevM: -3500, note: "Grand Canyon of Mars — interior layered deposits." },
  { id: "noctis", name: "Noctis Labyrinthus", kind: "canyon", lon: -96.8, lat: -6.8, elevM: 1800, note: "Labyrinth of graben at the western end of Valles Marineris." },
  { id: "hellas", name: "Hellas Planitia", kind: "basin", lon: 70.5, lat: -42.4, elevM: -7152, note: "Deepest impact basin on Mars (~7 km below datum)." },
  { id: "utopia", name: "Utopia Planitia", kind: "plain", lon: 117.5, lat: 46.7, elevM: -3000, note: "Vast northern lowland plain; Viking 2 touched down nearby." },
  { id: "zhurong", name: "Utopia Planitia (Zhurong)", kind: "landing site", lon: 109.93, lat: 25.07, elevM: -3800, note: "Zhurong rover landing area (May 2021)." },
  { id: "arcadia", name: "Arcadia Planitia", kind: "plain", lon: -165.0, lat: 45.0, elevM: -3000, note: "Smooth, dust-mantled plains — a candidate human-landing region." },
  { id: "chryse", name: "Chryse Planitia (Viking 1)", kind: "landing site", lon: -48.22, lat: 22.69, elevM: -2800, note: "Viking 1 lander site at the mouth of Kasei Valles (1976)." },
  { id: "meridiani", name: "Meridiani Planum (Opportunity)", kind: "plain", lon: -5.53, lat: -1.95, elevM: -1380, note: "Opportunity rover traverse; hematite plains (2004–2018)." },
  { id: "cydonia", name: "Cydonia Mensa", kind: "region", lon: -9.46, lat: 40.75, elevM: -3500, note: "Knobby mesa terrain between the northern lowlands and Arabia." },
  { id: "cerberus", name: "Cerberus Fossae", kind: "channel", lon: 155.0, lat: 6.0, elevM: -2600, note: "Active tectonic fissures — source of most InSight marsquakes." },
  { id: "elysiummons", name: "Elysium Mons", kind: "volcano", lon: 147.21, lat: 25.02, elevM: 12800, note: "Principal volcano of the Elysium rise." },
  { id: "isidis", name: "Isidis Planitia", kind: "basin", lon: 87.5, lat: 13.9, elevM: -3800, note: "Ancient multi-ring impact basin between Syrtis and Utopia." },
  { id: "aresvallis", name: "Ares Vallis", kind: "channel", lon: -33.7, lat: 18.1, elevM: -2500, note: "Catastrophic outflow channel; Pathfinder/Sojourner (1997)." },
  { id: "arabia", name: "Arabia Terra", kind: "region", lon: 45.0, lat: 21.8, elevM: -2000, note: "Ancient, heavily cratered transition terrain." },
  { id: "kasei", name: "Kasei Valles", kind: "channel", lon: -63.0, lat: 12.0, elevM: -1000, note: "One of the largest outflow channel systems on Mars." },
  { id: "medusae", name: "Medusae Fossae", kind: "region", lon: -147.0, lat: -3.0, note: "Enigmatic wind-carved yardang terrain near Tharsis." },
  { id: "airy0", name: "Airy-0 (Prime Meridian)", kind: "crater", lon: 0.0, lat: -5.1, note: "The crater that defines Mars longitude 0°." },
  { id: "boreum", name: "Planum Boreum", kind: "polar cap", lon: 0.0, lat: 87.0, note: "Permanent north-polar water-ice cap." },
  { id: "australe", name: "Planum Australe", kind: "polar cap", lon: 0.0, lat: -87.0, note: "Permanent south-polar CO₂/water-ice cap." },
];

/** Broad physiographic regions (lon range west may be > east across ±180). */
const REGIONS: Array<{ name: string; s: number; n: number; w: number; e: number }> = [
  { name: "Elysium Planitia", s: -6, n: 26, w: 120, e: 160 },
  { name: "Tharsis Montes", s: -15, n: 25, w: -135, e: -95 },
  { name: "Valles Marineris", s: -16, n: 2, w: -100, e: -55 },
  { name: "Amazonis Planitia", s: -10, n: 20, w: -180, e: -140 },
  { name: "Arcadia Planitia", s: 30, n: 60, w: -180, e: -140 },
  { name: "Utopia Planitia", s: 15, n: 55, w: 90, e: 140 },
  { name: "Hellas rim", s: -55, n: -25, w: 50, e: 100 },
  { name: "Arabia Terra", s: -5, n: 35, w: 15, e: 70 },
  { name: "Syrtis Major", s: -2, n: 22, w: 62, e: 82 },
  { name: "Isidis Planitia", s: 5, n: 22, w: 80, e: 95 },
  { name: "Noachis Terra", s: -60, n: -25, w: -30, e: 40 },
  { name: "Terra Cimmeria", s: -70, n: -30, w: 120, e: 170 },
  { name: "Terra Sabaea", s: -25, n: 20, w: 15, e: 75 },
  { name: "Chryse / Xanthe", s: 10, n: 30, w: -60, e: -20 },
];

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function wrapLon(a: number): number {
  return ((((a + 180) % 360) + 360) % 360) - 180;
}

export function regionName(lon: number, lat: number): string {
  if (lat >= 70) return "Planum Boreum — northern polar region";
  if (lat <= -70) return "Planum Australe — southern polar region";
  const L = wrapLon(lon);
  for (const r of REGIONS) {
    const inLon = r.w <= r.e ? L >= r.w && L <= r.e : L >= r.w || L <= r.e;
    if (lat >= r.s && lat <= r.n && inLon) return r.name;
  }
  if (lat > 55) return "Northern Lowlands";
  if (lat < -55) return "Southern Highlands";
  return "Mid-latitude terrain";
}

export function nearestSite(lon: number, lat: number): { site: MarsSite; distKm: number } | null {
  let best: MarsSite | null = null;
  let bestD = Infinity;
  for (const s of MARS_SITES) {
    const d = haversineKm({ lon, lat }, { lon: s.lon, lat: s.lat });
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best ? { site: best, distKm: bestD } : null;
}

/** Auto-generated display name for wherever the astronaut happens to be. */
export function locationName(lon: number, lat: number): string {
  const near = nearestSite(lon, lat);
  if (near) {
    if (near.distKm < 25) return near.site.name;
    if (near.distKm < 150) {
      const dir = compassPoint(bearingDeg({ lon: near.site.lon, lat: near.site.lat }, { lon, lat }));
      return `${near.site.name} · ${(near.distKm).toFixed(0)} km ${dir}`;
    }
  }
  const reg = regionName(lon, lat).split(" — ")[0];
  const col = String.fromCharCode(65 + Math.floor(((wrapLon(lon) + 180) / 360) * 24));
  const row = String(Math.floor((lat + 90) / 15) + 1).padStart(2, "0");
  return `${reg} · sector ${col}-${row}`;
}

/** free-text site search — exact/prefix matches first, then substring */
export function findSitesByName(q: string): MarsSite[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const exact = MARS_SITES.filter(
    (x) => x.name.toLowerCase() === s || x.name.toLowerCase().startsWith(s)
  );
  if (exact.length) return exact;
  return MARS_SITES.filter(
    (x) => x.name.toLowerCase().includes(s) || x.kind.includes(s) || x.note.toLowerCase().includes(s)
  );
}

export type CoordParse = { value: number } | { error: string };

/** Parse one coordinate ("4.5024", "-4.5", "4.5024 N", "77.45E"). */
export function parseCoordinate(raw: string, kind: "lat" | "lon"): CoordParse {
  const m = raw.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*([NSEWnsew])?$/);
  if (!m) return { error: `Enter ${kind === "lat" ? "latitude" : "longitude"} as a number, optionally with N/S/E/W — e.g. ${kind === "lat" ? '"18.44 N"' : '"77.45 E"'}` };
  let v = parseFloat(m[1]);
  const h = (m[2] ?? "").toUpperCase();
  if (h === "S" || h === "W") v = -Math.abs(v);
  if (h === "N" || h === "E") v = Math.abs(v);
  if (kind === "lat") {
    if (Math.abs(v) > 90) return { error: "Latitude must be within −90° … 90° (pole to pole)." };
  } else if (Math.abs(v) > 180) {
    return { error: "Longitude must be within −180° … 180° (or use E/W suffix)." };
  }
  return { value: v };
}

/** Short mission code from a site name ("Jezero Crater" → "JEZ"). */
export function codeFromName(name: string): string {
  const word = name.replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(Boolean)[0] ?? "SITE";
  return word.slice(0, 4).toUpperCase();
}

/** Fresh demo route around an arbitrary location (loop: BASE → 3 ring stops → BASE). */
export function seedRouteAt(lat: number, lon: number, code = "SITE"): RouteWaypoint[] {
  const mLat = (Math.PI * 3396190) / 180;
  const mLon = mLat * Math.cos((lat * Math.PI) / 180);
  const mk = (id: string, name: string, la: number, lo: number): RouteWaypoint => ({
    id,
    name,
    lon: lo,
    lat: la,
  });
  const step = (fromLat: number, fromLon: number, brgDeg: number, distM: number) => {
    const brg = (brgDeg * Math.PI) / 180;
    return {
      lat: fromLat + (Math.cos(brg) * distM) / mLat,
      lon: fromLon + (Math.sin(brg) * distM) / mLon,
    };
  };
  const w1 = step(lat, lon, 28, 950);
  const w2 = step(w1.lat, w1.lon, 132, 780);
  const w3 = step(w2.lat, w2.lon, 238, 880);
  return [
    mk(`loc-base-${Date.now()}`, `${code}-BASE`, lat, lon),
    mk(`loc-w1-${Date.now()}`, `${code}-01`, w1.lat, w1.lon),
    mk(`loc-w2-${Date.now()}`, `${code}-02`, w2.lat, w2.lon),
    mk(`loc-w3-${Date.now()}`, `${code}-03`, w3.lat, w3.lon),
    mk(`loc-base2-${Date.now()}`, `${code}-BASE · RETURN`, lat, lon),
  ];
}

export function fmtKm(km: number): string {
  return km >= 100 ? `${km.toFixed(0)} km` : `${km.toFixed(1)} km`;
}

export type { LngLat };

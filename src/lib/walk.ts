// Marswalk simulation geometry — position/terrain lookup at a distance along the route
import { haversineKm, bearingDeg, slopeAdjustedSpeed } from "./mars";
import type { Sample } from "./terrain";
import type { RouteWaypoint, EvaParams } from "./store";

export interface WalkReadout {
  distM: number; // distance travelled along the route
  lon: number;
  lat: number;
  elev: number | null; // m at current position (nearest profile sample)
  slope: number; // deg at current position
  speedEff: number; // km/h incl. slope penalty
  legIdx: number; // current leg (from wp legIdx → legIdx+1); route.length-2 max
  nextIdx: number; // index of the waypoint we are heading to
  nextDistM: number; // straight-line distance to that waypoint
  bearing: number; // initial bearing to that waypoint (deg from N)
  totalM: number;
  elapsedH: number; // sim EVA clock incl. science-stop dwell
  dwellH: number; // remaining science-stop time at current waypoint (sim hours)
  o2Pct: number; // remaining O₂ supply (% of suit supply; 100 at departure, depletes)
  doseMsv: number;
  lstNow: number; // local solar time
  sunElev: number;
  finished: boolean;
  atEnd: boolean;
}

export interface WalkFrame {
  legCum: number[]; // cumulative distance at each waypoint, meters; length === route.length
  totalM: number;
}

/** cumulative leg distances for the polyline (meters) */
export function buildFrame(route: RouteWaypoint[]): WalkFrame {
  const legCum = [0];
  for (let i = 1; i < route.length; i++) {
    legCum.push(legCum[i - 1] + haversineKm(route[i - 1], route[i]) * 1000);
  }
  return { legCum, totalM: legCum[legCum.length - 1] ?? 0 };
}

/** nearest profile sample slope/elev at distance d (binary search; profile is sorted by dist) */
export function sampleProfile(profile: Sample[], dM: number): { slope: number; elev: number | null } {
  if (profile.length === 0) return { slope: 0, elev: null };
  let lo = 0;
  let hi = profile.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (profile[mid].dist < dM) lo = mid + 1;
    else hi = mid;
  }
  const s = profile[lo];
  const prev = profile[Math.max(0, lo - 1)];
  const pick = Math.abs(s.dist - dM) <= Math.abs(prev.dist - dM) ? s : prev;
  return { slope: pick.slope ?? 0, elev: pick.elev };
}

/** lerp position along the polyline at distance d (meters) */
export function posAlong(route: RouteWaypoint[], legCum: number[], dM: number): { lon: number; lat: number; legIdx: number } {
  const total = legCum[legCum.length - 1];
  const d = Math.min(Math.max(dM, 0), total);
  let i = 1;
  while (i < legCum.length - 1 && legCum[i] < d) i++;
  const a = route[i - 1];
  const b = route[i];
  const segM = legCum[i] - legCum[i - 1] || 1;
  const t = Math.min(1, Math.max(0, (d - legCum[i - 1]) / segM));
  return {
    lon: a.lon + (b.lon - a.lon) * t,
    lat: a.lat + (b.lat - a.lat) * t,
    legIdx: i - 1,
  };
}

/** full visor readout at a point of the walk — pure, cheap (no terrain decode) */
export function walkReadout(opts: {
  route: RouteWaypoint[];
  frame: WalkFrame;
  profile: Sample[];
  eva: EvaParams;
  gcrDosePerSol: number;
  distM: number;
  elapsedH: number;
  dwellH: number;
}): WalkReadout {
  const { route, frame, profile, eva, gcrDosePerSol, elapsedH, dwellH } = opts;
  const total = frame.totalM;
  const d = Math.min(Math.max(opts.distM, 0), total);
  const { lon, lat, legIdx } = posAlong(route, frame.legCum, d);
  const { slope, elev } = sampleProfile(profile, d);
  const speedEff = slopeAdjustedSpeed(eva.speedKmh, slope);
  const nextIdx = Math.min(legIdx + 1, route.length - 1);
  const next = route[nextIdx];
  const nextDistM = next ? haversineKm({ lon, lat }, next) * 1000 : 0;
  const bearing = next ? bearingDeg({ lon, lat }, next) : 0;
  const o2Pct = Math.max(0, 100 - (elapsedH / Math.max(eva.suitHours, 0.1)) * 100);
  const doseMsv = (gcrDosePerSol / 24) * elapsedH;
  const lstNow = (eva.startLst + elapsedH) % 24;
  const atEnd = total > 0 && d >= total - 0.5;
  return {
    distM: d,
    lon,
    lat,
    elev,
    slope,
    speedEff,
    legIdx,
    nextIdx,
    nextDistM: atEnd ? 0 : nextDistM,
    bearing,
    totalM: total,
    elapsedH,
    dwellH,
    o2Pct,
    doseMsv,
    lstNow,
    sunElev: sunElevAt(lstNow),
    finished: atEnd,
    atEnd,
  };
}

/** sun elevation (equinox approx, same model as eva.ts) */
function sunElevAt(lst: number): number {
  const ha = ((lst - 12) / 24) * 2 * Math.PI;
  const el = Math.asin(Math.cos((4.5 * Math.PI) / 180) * Math.cos(ha));
  return (el * 180) / Math.PI;
}

export function fmtClock(h: number): string {
  const totalS = Math.max(0, Math.round(h * 3600));
  const hh = Math.floor(totalS / 3600);
  const mm = Math.floor((totalS % 3600) / 60);
  const ss = totalS % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/** arc length (m) along the route polyline of the point nearest to lon/lat */
export function projectOntoRoute(route: RouteWaypoint[], lon: number, lat: number): number {
  if (route.length < 2) return 0;
  const mLat = (Math.PI * 3396190) / 180;
  const mLon = mLat * Math.cos(((route[0].lat * Math.PI) / 180));
  const px = (lon - route[0].lon) * mLon;
  const pz = -(lat - route[0].lat) * mLat;
  let best = Infinity;
  let bestD = 0;
  let acc = 0;
  for (let i = 1; i < route.length; i++) {
    const ax = (route[i - 1].lon - route[0].lon) * mLon;
    const az = -(route[i - 1].lat - route[0].lat) * mLat;
    const bx = (route[i].lon - route[0].lon) * mLon;
    const bz = -(route[i].lat - route[0].lat) * mLat;
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((px - ax) * dx + (pz - az) * dz) / len2;
    t = Math.min(1, Math.max(0, t));
    const qx = ax + dx * t, qz = az + dz * t;
    const d = (px - qx) ** 2 + (pz - qz) ** 2;
    if (d < best) {
      best = d;
      bestD = acc + Math.sqrt(len2) * t;
    }
    acc += Math.sqrt(len2);
  }
  return bestD;
}

/** visor readout while on manual foot controls — position is off-route, free walking */
export function manualReadout(opts: {
  route: RouteWaypoint[];
  eva: EvaParams;
  gcrDosePerSol: number;
  elapsedH: number;
  lon: number;
  lat: number;
  elev: number | null;
  slope: number;
  speedMs: number;
  walkedM: number;
}): WalkReadout {
  const { route, eva, elapsedH } = opts;
  // nearest waypoint = current guidance target while free-walking
  let nextIdx = 0;
  let bestD = Infinity;
  route.forEach((w, i) => {
    const d = haversineKm({ lon: opts.lon, lat: opts.lat }, w) * 1000;
    if (d < bestD) {
      bestD = d;
      nextIdx = i;
    }
  });
  const next = route[nextIdx];
  let totalM = 0;
  for (let i = 1; i < route.length; i++) totalM += haversineKm(route[i - 1], route[i]) * 1000;
  const atEnd = nextIdx === route.length - 1 && bestD < 6;
  const o2Pct = Math.max(0, 100 - (elapsedH / Math.max(eva.suitHours, 0.1)) * 100);
  return {
    distM: opts.walkedM,
    lon: opts.lon,
    lat: opts.lat,
    elev: opts.elev,
    slope: opts.slope,
    speedEff: opts.speedMs * 3.6,
    legIdx: Math.max(0, nextIdx - 1),
    nextIdx,
    nextDistM: atEnd ? 0 : bestD,
    bearing: next ? bearingDeg({ lon: opts.lon, lat: opts.lat }, next) : 0,
    totalM,
    elapsedH,
    dwellH: 0,
    o2Pct,
    doseMsv: (opts.gcrDosePerSol / 24) * elapsedH,
    lstNow: (eva.startLst + elapsedH) % 24,
    sunElev: sunElevAt((eva.startLst + elapsedH) % 24),
    finished: atEnd,
    atEnd,
  };
}

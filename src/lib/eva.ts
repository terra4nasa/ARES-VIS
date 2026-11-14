// EVA planning math for ARES-VIS
import { haversineKm, slopeAdjustedSpeed, sunElevationDeg } from "./mars";
import type { EvaParams, RouteWaypoint } from "./store";
import type { Sample } from "./terrain";

export interface Leg {
  fromIdx: number;
  toIdx: number;
  fromName: string;
  toName: string;
  distM: number;
  slopeMax: number;
  speedEff: number;
  timeH: number;
  lstArrive: number;
}

export interface EvaPlan {
  legs: Leg[];
  totalDistM: number;
  totalTimeH: number;
  lstEnd: number;
  o2UsedPct: number;
  returnMarginPct: number;
  doseMsv: number;
  sunElevStart: number;
  sunElevEnd: number;
  minSunElev: number;
  warnings: string[];
  ok: boolean;
}

export function computePlan(
  route: RouteWaypoint[],
  eva: EvaParams,
  profile: Sample[],
  gcrDosePerSol: number
): EvaPlan {
  const legs: Leg[] = [];
  let cumH = 0;
  const startLst = eva.startLst;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const distM = haversineKm(a, b) * 1000;
    // slope sampled along this leg
    const s0 = legStartDist(legs);
    const legSamples = profile.filter((p) => p.dist >= s0 && p.dist <= s0 + distM);
    const slopeMax = legSamples.length
      ? Math.max(...legSamples.map((p) => p.slope))
      : maxOf([a.slopeDeg ?? 0, b.slopeDeg ?? 0]);
    const speedEff = slopeAdjustedSpeed(eva.speedKmh, slopeMax);
    const timeH = distM / 1000 / speedEff;
    cumH += timeH;
    legs.push({
      fromIdx: i - 1,
      toIdx: i,
      fromName: a.name,
      toName: b.name,
      distM,
      slopeMax,
      speedEff,
      timeH,
      lstArrive: (startLst + cumH) % 24,
    });
  }
  const totalDistM = legs.reduce((s, l) => s + l.distM, 0);
  const totalTimeH = cumH;
  const lstEnd = (startLst + totalTimeH) % 24;
  const o2UsedPct = (totalTimeH / Math.max(eva.suitHours, 0.1)) * 100;
  // return margin: time to come back from the farthest point ≈ half total
  const returnH = legs.length ? legs.slice(Math.ceil(legs.length / 2)).reduce((s, l) => s + l.timeH, 0) : 0;
  const returnMarginPct = (returnH / Math.max(eva.suitHours, 0.1)) * 100;
  const doseMsv = (gcrDosePerSol / 24) * totalTimeH;
  const sunElevStart = sunElevationDeg(4.5, startLst);
  const sunElevEnd = sunElevationDeg(4.5, lstEnd);
  const minSunElev = Math.min(
    ...legs.map((l) => sunElevationDeg(4.5, l.lstArrive)),
    sunElevStart
  );

  const warnings: string[] = [];
  if (route.length < 2) warnings.push("Route needs at least 2 waypoints.");
  if (o2UsedPct > 85) warnings.push(`O₂ budget critical: ${o2UsedPct.toFixed(0)}% of suit supply consumed.`);
  else if (o2UsedPct > 65) warnings.push(`O₂ budget caution: ${o2UsedPct.toFixed(0)}% consumed.`);
  if (returnMarginPct > 40) warnings.push(`Return leg ≈ ${returnMarginPct.toFixed(0)}% of suit supply — exceeds 40% turnaround rule.`);
  if (minSunElev < 5 && route.length > 1) warnings.push(`Plan extends to low sun elevation (${minSunElev.toFixed(0)}°) — visibility/cold risk.`);
  legs.forEach((l) => {
    if (l.slopeMax > 10) warnings.push(`Leg ${l.fromIdx + 1}→${l.toIdx + 1}: slopes up to ${l.slopeMax.toFixed(1)}° — reroute advised.`);
  });

  return {
    legs,
    totalDistM,
    totalTimeH,
    lstEnd,
    o2UsedPct,
    returnMarginPct,
    doseMsv,
    sunElevStart,
    sunElevEnd,
    minSunElev,
    warnings,
    ok: route.length >= 2 && o2UsedPct <= 85 && returnMarginPct <= 40 && minSunElev >= 5,
  };
}

function legStartDist(legs: Leg[]): number {
  return legs.reduce((s, l) => s + l.distM, 0);
}

function maxOf(arr: number[]): number {
  return arr.length ? Math.max(...arr) : 0;
}

export function fmtLst(h: number): string {
  const hh = Math.floor(((h % 24) + 24) % 24);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

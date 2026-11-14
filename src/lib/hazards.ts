// Hazard drill engine for ARES-VIS — simulated surface emergencies where
// Mission Control directs the astronaut to the best shelter base.
//
// bestBaseFor() scores every candidate shelter (BASE waypoints on the current
// route + the Homestead Hollow lander fallback) by walk time adjusted with a
// hazard-specific shelter bias: some drills (O₂ leak) demand pure proximity,
// others (solar particle event) favour hard-sheltered habitats even if farther.
import { haversineKm, bearingDeg, compassPoint } from "./mars";
import { fmtDist } from "./mars";
import { DEFAULT_SITE } from "./sites";
import type { RouteWaypoint } from "./store";

export type HazardId =
  | "dust_storm"
  | "solar_storm"
  | "o2_leak"
  | "suit_tear"
  | "comms_outage"
  | "marsquake";

export interface HazardDef {
  id: HazardId;
  label: string;
  severity: "warn" | "alert";
  /** O₂ burn multiplier while the drill is active */
  o2Factor: number;
  /** dose-rate multiplier while the drill is active */
  doseFactor: number;
  /** absolute signal-percentage drop while the drill is active */
  signalDrop: number;
  /** 0 = pure nearest-base, 1 = strongly prefer hard shelter */
  shelterBias: number;
  /** one-line situation brief for the alert banner */
  brief: string;
  /** standing recommendation from Mission Control */
  rec: string;
}

export const HAZARDS: HazardDef[] = [
  {
    id: "dust_storm",
    label: "Dust storm",
    severity: "alert",
    o2Factor: 1.15,
    doseFactor: 1,
    signalDrop: 25,
    shelterBias: 0.6,
    brief: "Regional dust cell moving in — visibility collapsing, UHF scattering, PV input failing.",
    rec: "Cease science ops, stow the sample tray and traverse to shelter before local visibility drops under 50 m. Dust on seals and radiators raises suit thermal load.",
  },
  {
    id: "solar_storm",
    label: "Solar particle event",
    severity: "alert",
    o2Factor: 1,
    doseFactor: 8,
    signalDrop: 12,
    shelterBias: 1,
    brief: "X-class flare + SEP arrival — dose rate spiking, EVA dose budget burning fast.",
    rec: "Terminate exposed ops immediately. Head for the hard-sheltered habitat — regolith shielding is the only effective protection. Ride out the proton peak inside, minimum 6 h.",
  },
  {
    id: "o2_leak",
    label: "O₂ system leak",
    severity: "alert",
    o2Factor: 3,
    doseFactor: 1,
    signalDrop: 0,
    shelterBias: 0,
    brief: "Primary O₂ line pressure decaying — suspected micrometeoroid breach on the PLSS loop.",
    rec: "Isolate the secondary loop, drop all non-essential load and return to the nearest pressurized habitat NOW. Do not stop for samples. Suit reserves override every other objective.",
  },
  {
    id: "suit_tear",
    label: "Suit abrasion / tear",
    severity: "alert",
    o2Factor: 2,
    doseFactor: 1,
    signalDrop: 0,
    shelterBias: 0,
    brief: "Abrasion detected on the left knee assembly — suit integrity degrading, leak rate rising.",
    rec: "Apply the emergency patch kit, reduce exertion to minimum and walk to the closest habitat for doffing. Avoid knee-flexing terrain; keep the joint unloaded.",
  },
  {
    id: "comms_outage",
    label: "Comms blackout",
    severity: "warn",
    o2Factor: 1,
    doseFactor: 1,
    signalDrop: 55,
    shelterBias: 1,
    brief: "Orbiter handover failed — UHF relay lost, running on beacon-only telemetry.",
    rec: "Move to high ground near the habitat for a direct line-of-sight attempt on the next pass. If no relay in 30 min, execute the autonomous-return protocol.",
  },
  {
    id: "marsquake",
    label: "Marsquake",
    severity: "warn",
    o2Factor: 1.1,
    doseFactor: 1,
    signalDrop: 10,
    shelterBias: 0.4,
    brief: "Shallow seismic event registered nearby — rockfall risk on slopes and crater rims.",
    rec: "Clear steep terrain and crater rims immediately, hold in the open until shaking stops, then proceed to the habitat and inspect suit/samples for damage.",
  },
];

export interface ShelterCandidate {
  name: string;
  lon: number;
  lat: number;
  /** 0 exposed site · 1 partial cover · 2 hard-sheltered habitat */
  shelter: number;
}

export interface BaseRecommendation {
  name: string;
  lon: number;
  lat: number;
  distM: number;
  bearing: number;
  etaMin: number;
  speedKmh: number;
  score: number;
  why: string;
}

/** shelter rating of a route waypoint (BASE markers are hard-sheltered habitats) */
function shelterOf(wp: RouteWaypoint): number {
  if (wp.poiId === "base" || /base|hab/i.test(wp.name)) return 2;
  return 0;
}

/** candidate shelters: BASE waypoints on the route + Homestead Hollow fallback */
export function shelterCandidates(route: RouteWaypoint[]): ShelterCandidate[] {
  const out: ShelterCandidate[] = [];
  const seen: Array<{ lon: number; lat: number }> = [];
  const push = (name: string, lon: number, lat: number, shelter: number) => {
    if (seen.some((s) => haversineKm(s, { lon, lat }) < 0.05)) return; // <50 m dedupe
    seen.push({ lon, lat });
    out.push({ name, lon, lat, shelter });
  };
  for (const wp of route) push(wp.name, wp.lon, wp.lat, shelterOf(wp));
  push(`${DEFAULT_SITE.name} (lander fallback)`, DEFAULT_SITE.lon, DEFAULT_SITE.lat, 1);
  return out;
}

/**
 * Score all candidate shelters for the given hazard and position.
 * score = walk time (h) inflated by a shelter penalty for exposed sites —
 * bias 0 → pure nearest wins; bias 1 → hard shelter wins unless far farther.
 */
export function bestBaseFor(
  hazard: HazardDef,
  lon: number,
  lat: number,
  route: RouteWaypoint[],
  speedKmh: number
): BaseRecommendation | null {
  const cands = shelterCandidates(route);
  if (cands.length === 0) return null;
  const spd = Math.max(1, speedKmh);
  let best: BaseRecommendation | null = null;
  let bestScore = Infinity;
  for (const c of cands) {
    const distM = haversineKm({ lon, lat }, c) * 1000;
    const etaH = distM / 1000 / spd;
    const score = etaH * (1 + hazard.shelterBias * (2 - c.shelter) * 0.35);
    if (score < bestScore) {
      bestScore = score;
      const bearing = bearingDeg({ lon, lat }, c);
      best = {
        name: c.name,
        lon: c.lon,
        lat: c.lat,
        distM,
        bearing,
        etaMin: Math.max(1, Math.round(etaH * 60)),
        speedKmh: spd,
        score,
        why:
          c.shelter === 2
            ? "hard-sheltered habitat — pressurized volume, regolith cover, spare PLSS consumables"
            : c.shelter === 1
              ? "partial cover — lander deck and hollow walls; acceptable fallback shelter"
              : "exposed site — no structural shelter; only viable as the nearest reachable point",
      };
    }
  }
  return best;
}

/** Mission Control recommendation blip for a triggered drill */
export function hazardAlertText(hazard: HazardDef, rec: BaseRecommendation): string {
  const dir = compassPoint(rec.bearing);
  return `${rec.name} — ${fmtDist(rec.distM)} at bearing ${rec.bearing.toFixed(0).padStart(3, "0")}° ${dir}, ETA ≈ ${rec.etaMin} min at ${rec.speedKmh.toFixed(1)} km/h. ${rec.why}.`;
}

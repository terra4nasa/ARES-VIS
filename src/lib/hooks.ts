"use client";
import { useEffect, useState } from "react";
import { useStore, type EvaParams } from "./store";
import { profileAlongPath, type Sample } from "./terrain";
import { computePlan, type EvaPlan } from "./eva";
import { buildSpaceWeather, fetchNoaaRows, type SpaceWeather } from "./spaceweather";

export type { SpaceWeather };

let swCache: SpaceWeather | null = null;
let swPending: Promise<SpaceWeather> | null = null;

export function useSpaceWeather(): SpaceWeather | null {
  const [sw, setSw] = useState<SpaceWeather | null>(swCache);
  useEffect(() => {
    if (swCache) return;
    if (!swPending) {
      /* Server proxy → direct NOAA SWPC (GitHub Pages static deploys) → bundled defaults */
      swPending = fetch("api/spaceweather")
        .then(async (r) => {
          if (!r.ok) throw new Error("api-unavailable");
          return (await r.json()) as SpaceWeather;
        })
        .catch(() => fetchNoaaRows().then(buildSpaceWeather))
        .catch(() => ({
          ts: new Date().toISOString(),
          f107: 140,
          proton10MeV: 0,
          proton100MeV: 0,
          kp: 3,
          solarWindSpeed: 450,
          earthMars: { au: 1.6, km: 2.4e8, lightMin: 13.3 },
          marsSurface: { gcrDosePerSol: 0.7, speClass: 0, evaState: "NOMINAL" },
          live: { f107: false, protons: false, kp: false },
          modelNote: "Fallback values (live feed unavailable).",
        }))
        .then((d: SpaceWeather) => {
          swCache = d;
          return d;
        });
    }
    swPending.then(setSw);
  }, []);
  return sw;
}

export function useRouteProfile(): Sample[] {
  const route = useStore((s) => s.route);
  const [profile, setProfile] = useState<Sample[]>([]);
  useEffect(() => {
    let alive = true;
    if (route.length < 2) {
      Promise.resolve().then(() => {
        if (alive) setProfile([]);
      });
      return () => {
        alive = false;
      };
    }
    profileAlongPath(route.map((w) => ({ lon: w.lon, lat: w.lat }))).then((p) => {
      if (alive) setProfile(p);
    });
    return () => {
      alive = false;
    };
  }, [route]);
  return profile;
}

export function useEvaPlan(): { plan: EvaPlan; profile: Sample[]; sw: SpaceWeather | null; solveMs: number } {
  const eva = useStore((s) => s.eva) as EvaParams;
  const profile = useRouteProfile();
  const sw = useSpaceWeather();
  const route = useStore((s) => s.route);
  const t0 = performance.now();
  const plan = computePlan(route, eva, profile, sw?.marsSurface.gcrDosePerSol ?? 0.7);
  const solveMs = Math.max(0.1, performance.now() - t0);
  return { plan, profile, sw, solveMs };
}

"use client";
/**
 * ARES-VIS helmet visor — immersive Marswalk HUD.
 *
 * VisorOverlay renders when visorMode is on:
 *  - StandbyHud: visor configured, "BEGIN MARSWALK" launcher
 *  - WalkHud:    live telemetry while physically walking the route (WalkEngine)
 *  - VisorPrefs: per-block display preferences (persisted per user)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, FastForward, X, Settings2, Footprints, SkipForward, Mountain, Gauge, Radio, ShieldAlert, Activity, FlaskConical, Zap, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Hand, MapPin, HeartPulse, AlertTriangle } from "lucide-react";
import { useStore, type VisorPrefs, VISOR_PRESET } from "@/lib/store";
import { useRouteProfile, useSpaceWeather } from "@/lib/hooks";
import { FirstPersonTerrain } from "@/components/hud/FirstPerson";
import { SignalBars } from "@/components/hud/Comms";
import { camBus, walkInput, requestSampleCollect } from "@/lib/fpv3d";
import { POIS } from "@/lib/data";
import { buildFrame, walkReadout, manualReadout, projectOntoRoute, fmtClock, type WalkReadout } from "@/lib/walk";
import { fmtDist, fmtLonLat, compassPoint, haversineKm } from "@/lib/mars";
import { bestBaseFor, HAZARDS } from "@/lib/hazards";
import { locationName } from "@/lib/sites";
import { fmtLst } from "@/lib/eva";
import { Switch } from "@/components/ui/switch";

/* ================= WalkEngine — RAF simulation loop ================= */

function WalkEngine() {
  const active = useStore((s) => s.walk.active);
  const profile = useRouteProfile();
  const sw = useSpaceWeather();
  const skipDwellNonce = useStore((s) => s.walk.skipDwellNonce);
  const jumpNonce = useStore((s) => s.walk.jumpNonce);
  const profileRef = useRef(profile);
  const swRef = useRef(sw);
  useEffect(() => {
    profileRef.current = profile;
    swRef.current = sw;
  }, [profile, sw]);

  const sim = useRef({ distM: 0, elapsedH: 0, dwellH: 0, dwelled: new Set<number>(), warnedSteep: -1, o2Band: 0, manualDistM: 0 });
  const rafRef = useRef<number>(0);
  const lastRef = useRef(0);
  const accRef = useRef(1); // physics accumulator (s) — runs at ~12 Hz
  const pubAccRef = useRef(1); // readout emit accumulator (s) — throttled to ~3.5 Hz to keep the HUD calm
  const lastJumpRef = useRef(0);
  const lastSkipRef = useRef(0);
  const manualRef = useRef(false);
  const finishedManualRef = useRef(false);
  const lastOffRouteRef = useRef(0);
  const lastHazardAdviceRef = useRef(0);

  const resetSim = useCallback(() => {
    sim.current = { distM: 0, elapsedH: 0, dwellH: 0, dwelled: new Set<number>(), warnedSteep: -1, o2Band: 0, manualDistM: 0 };
    lastRef.current = performance.now();
  }, []);

  /** hazard-adjusted model params — leak drills burn O₂ faster, SPE multiplies dose */
  const hazardAdj = useCallback(() => {
    const s = useStore.getState();
    const hz = s.hazard?.def;
    return {
      eva: hz && hz.o2Factor !== 1 ? { ...s.eva, suitHours: s.eva.suitHours / hz.o2Factor } : s.eva,
      doseFactor: hz?.doseFactor ?? 1,
    };
  }, []);

  const physics = useCallback((dtRealS: number) => {
    const s = useStore.getState();
    const { route, walk } = s;
    if (route.length < 2) return;
    const frame = buildFrame(route);
    const st = sim.current;
    const simH = (dtRealS * walk.speedMult) / 3600;
    const manualOn = walk.active && walk.manual && !(walk.readout?.finished ?? false);

    /* manual ↔ auto transitions */
    if (manualOn !== manualRef.current) {
      if (manualOn) {
        st.dwellH = 0;
        st.manualDistM = 0;
        finishedManualRef.current = false;
        s.pushWalkEvent("MANUAL CONTROL ENGAGED — AUTO-TRAVERSE PAUSED", "info");
      } else {
        const proj = projectOntoRoute(route, camBus.lon, camBus.lat);
        st.distM = proj;
        for (let i = 1; i < route.length; i++) if (frame.legCum[i] <= proj + 0.5) st.dwelled.add(i);
        finishedManualRef.current = false;
        if (!walk.readout?.atEnd) s.pushWalkEvent("AUTO-TRAVERSE RESUMED — ROUTE SYNCED", "info");
      }
      manualRef.current = manualOn;
    }

    if (manualOn) {
      /* on foot: real-time EVA clock (no sim multiplier) */
      st.elapsedH += dtRealS / 3600;
      st.manualDistM += camBus.speedMs * dtRealS;
      if (camBus.offRouteM > 80 && performance.now() - lastOffRouteRef.current > 30000) {
        lastOffRouteRef.current = performance.now();
        s.pushWalkEvent(`OFF-ROUTE ${fmtDist(camBus.offRouteM)} — REJOIN THE TRAVERSE LINE`, "warn");
      }
      const finalWp = route[route.length - 1];
      const dFinal = haversineKm({ lon: camBus.lon, lat: camBus.lat }, finalWp) * 1000;
      if (dFinal < 6 && !finishedManualRef.current) {
        finishedManualRef.current = true;
        s.pushWalkEvent(`EVA COMPLETE — RETURNED TO ${finalWp.name} ✔`, "done");
        useStore.getState().setWalkPlaying(false);
      }
    } else if (walk.playing && !walkReadoutDone(walk.readout)) {
      const adj = hazardAdj();
      st.elapsedH += simH;
      if (st.dwellH > 0) {
        st.dwellH = Math.max(0, st.dwellH - simH);
        if (st.dwellH === 0 && st.distM < frame.totalM) {
          const nxt = route[Math.min(nextIdxFor(frame, st.distM) + 1, route.length - 1)];
          s.pushWalkEvent(`DEPARTING · TRAVERSE TO ${nxt.name}`, "info");
        }
      } else {
        // slope at current position → effective speed → advance
        const cur = walkReadout({ route, frame, profile: profileRef.current, eva: adj.eva, gcrDosePerSol: (swRef.current?.marsSurface.gcrDosePerSol ?? 0.7) * adj.doseFactor, distM: st.distM, elapsedH: st.elapsedH, dwellH: 0 });
        const mPerS = (cur.speedEff * 1000) / 3600;
        st.distM = Math.min(frame.totalM, st.distM + mPerS * dtRealS * walk.speedMult);
      }

      /* waypoint arrival */
      for (let i = 1; i < route.length; i++) {
        if (st.distM >= frame.legCum[i] - 0.4 && !st.dwelled.has(i)) {
          st.dwelled.add(i);
          st.distM = Math.max(st.distM, frame.legCum[i]);
          const wp = route[i];
          const poi = POIS.find((p) => p.id === wp.poiId);
          const isLast = i === route.length - 1;
          s.pushWalkEvent(`ARRIVED ${wp.name}${poi ? ` · ${poi.name.toUpperCase()}` : ""}`, "arrive");
          if (poi && poi.durationMin > 0 && !isLast) {
            st.dwellH = poi.durationMin / 60;
            s.pushWalkEvent(`SCIENCE STOP · ${poi.durationMin} MIN SUIT TIME (${walk.speedMult}× SIM)`, "info");
          }
          if (isLast) {
            const back = wp.poiId === "base";
            s.pushWalkEvent(back ? `EVA COMPLETE — RETURNED TO ${wp.name} ✔` : `ROUTE END · ${wp.name}`, "done");
            useStore.getState().setWalkPlaying(false);
          }
        }
      }

      /* hazard + O₂ advisories (once per threshold band) */
      const adj2 = hazardAdj();
      const r = walkReadout({ route, frame, profile: profileRef.current, eva: adj2.eva, gcrDosePerSol: (swRef.current?.marsSurface.gcrDosePerSol ?? 0.7) * adj2.doseFactor, distM: st.distM, elapsedH: st.elapsedH, dwellH: st.dwellH });
      if (r.slope > 10 && r.legIdx !== st.warnedSteep) {
        st.warnedSteep = r.legIdx;
        s.pushWalkEvent(`STEEP TERRAIN ${r.slope.toFixed(0)}° · SPEED ${r.speedEff.toFixed(1)} KM/H`, "warn");
      }
      const band = r.o2Pct <= 20 ? 3 : r.o2Pct <= 50 ? 2 : 1;
      if (band > st.o2Band) {
        st.o2Band = band;
        if (band === 2) s.pushWalkEvent(`O₂ SUPPLY ${r.o2Pct.toFixed(0)}% — PLAN TURNAROUND`, "warn");
        if (band === 3) s.pushWalkEvent(`O₂ CRITICAL ${r.o2Pct.toFixed(0)}% — HEAD HOME NOW`, "warn");
      }
    }

    /* hazard drill — periodic Mission Control shelter reminders (~30 s) */
    const hz = s.hazard;
    if (hz && Date.now() - lastHazardAdviceRef.current > 30000) {
      lastHazardAdviceRef.current = Date.now();
      const posLon = camBus.manual ? camBus.lon : (walk.readout?.lon ?? camBus.lon);
      const posLat = camBus.manual ? camBus.lat : (walk.readout?.lat ?? camBus.lat);
      const adj3 = hazardAdj();
      const cur = manualOn
        ? { speedEff: camBus.speedMs * 3.6 }
        : walkReadout({ route, frame, profile: profileRef.current, eva: adj3.eva, gcrDosePerSol: 0, distM: st.distM, elapsedH: st.elapsedH, dwellH: st.dwellH });
      const rec = bestBaseFor(hz.def, posLon, posLat, route, cur.speedEff);
      if (rec) {
        const burn = hz.def.o2Factor !== 1 ? ` O₂ burn ×${hz.def.o2Factor} — ${(100 / Math.max(s.eva.suitHours / hz.def.o2Factor, 0.1)).toFixed(1)} %/h.` : "";
        s.pushComms("mission", `DRILL REMINDER — ${hz.def.label.toUpperCase()} active. Shelter ${rec.name}: ${fmtDist(rec.distM)} at bearing ${rec.bearing.toFixed(0).padStart(3, "0")}°, ETA ≈ ${rec.etaMin} min.${burn} ${hz.def.rec}`, "alert");
      }
    }
  }, [hazardAdj]);

  /** publish the visor readout to the store — throttled (~3.5 Hz) so HUD panels
   *  don't re-render every physics tick (that was the flicker source) */
  const emit = useCallback(() => {
    const s = useStore.getState();
    const { route, eva, walk } = s;
    if (route.length < 2 || !walk.active) return;
    const frame = buildFrame(route);
    const st = sim.current;
    const gcr = swRef.current?.marsSurface.gcrDosePerSol ?? 0.7;
    const adj = hazardAdj();
    const r = manualRef.current
      ? manualReadout({
          route,
          eva: adj.eva,
          gcrDosePerSol: gcr * adj.doseFactor,
          elapsedH: st.elapsedH,
          lon: camBus.lon,
          lat: camBus.lat,
          elev: camBus.elevM,
          slope: camBus.slopeDeg,
          speedMs: camBus.speedMs,
          walkedM: st.manualDistM,
        })
      : walkReadout({ route, frame, profile: profileRef.current, eva: adj.eva, gcrDosePerSol: gcr * adj.doseFactor, distM: st.distM, elapsedH: st.elapsedH, dwellH: st.dwellH });
    s.setWalkReadout(r);
  }, [hazardAdj]);

  /* reset when a new walk starts (readout null ⇒ fresh) */
  useEffect(() => {
    if (active) {
      const st = useStore.getState().walk;
      if (!st.readout) {
        resetSim();
        physics(0);
        emit();
      }
    }
  }, [active, physics, emit, resetSim]);

  /* RAF loop — physics at ~12 Hz, readout emit throttled to ~3.5 Hz (flicker fix) */
  useEffect(() => {
    if (!active) return;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - lastRef.current) / 1000);
      lastRef.current = now;
      accRef.current += dt;
      pubAccRef.current += dt;
      if (accRef.current >= 0.08) {
        physics(accRef.current);
        accRef.current = 0;
      }
      if (pubAccRef.current >= 0.28) {
        emit();
        pubAccRef.current = 0;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    lastRef.current = performance.now();
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, physics, emit]);

  /* external commands — nonce guards prevent re-fire when effect deps change identity */
  useEffect(() => {
    if (!active || skipDwellNonce === 0 || lastSkipRef.current === skipDwellNonce) return;
    lastSkipRef.current = skipDwellNonce;
    if (sim.current.dwellH > 0) {
      sim.current.dwellH = 0;
      useStore.getState().pushWalkEvent("SCIENCE STOP SKIPPED — RESUMING TRAVERSE", "info");
    }
  }, [skipDwellNonce, active]);

  useEffect(() => {
    if (!active || jumpNonce === 0 || lastJumpRef.current === jumpNonce) return;
    lastJumpRef.current = jumpNonce;
    const s = useStore.getState();
    if (s.route.length < 2) return;
    const frame = buildFrame(s.route);
    // advance exactly one waypoint: first waypoint index ahead of current position
    const nxt = frame.legCum[nextIdxFor(frame, sim.current.distM)];
    sim.current.distM = nxt;
    physics(0);
    emit();
  }, [jumpNonce, active, physics, emit]);

  return null;
}

function walkReadoutDone(r: WalkReadout | null): boolean {
  return !!r && r.atEnd;
}

function nextIdxFor(frame: { legCum: number[] }, distM: number): number {
  let i = 1;
  while (i < frame.legCum.length - 1 && frame.legCum[i] <= distM) i++;
  return i;
}

/* ================= HUD building blocks ================= */

function VisorCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`hud-panel rounded-sm px-3 py-2 ${className}`}>{children}</div>;
}

function Row({ label, value, color = "var(--hud-cyan)", glow = false }: { label: string; value: React.ReactNode; color?: string; glow?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="hud-label">{label}</span>
      <span className={`font-display text-[12px] ${glow ? "hud-glow-cyan" : ""}`} style={{ color }}>
        {value}
      </span>
    </div>
  );
}

/** O₂ supply bar — now lives in the bottom dock (EvaDockCard); kept for reuse */

/** mini elevation profile with walker dot (pure SVG — cheap at 12 Hz) */
function MiniProfile({ r }: { r: WalkReadout }) {
  const route = useStore((s) => s.route);
  const profile = useRouteProfile();
  const path = useMemo(() => {
    if (profile.length < 4) return null;
    const step = Math.max(1, Math.floor(profile.length / 160));
    const pts = profile.filter((_, i) => i % step === 0);
    const minE = Math.min(...pts.map((p) => p.elev));
    const maxE = Math.max(...pts.map((p) => p.elev));
    const span = Math.max(1, maxE - minE);
    const W = 150;
    const H = 40;
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${((p.dist / pts[pts.length - 1].dist) * W).toFixed(1)},${(H - ((p.elev - minE) / span) * (H - 6) - 3).toFixed(1)}`).join(" ");
    return { d, W, H };
  }, [profile]);
  const frac = r.totalM > 0 ? Math.min(1, r.distM / r.totalM) : 0;
  return (
    <VisorCard className="w-[166px]">
      <div className="hud-label mb-1 flex items-center gap-1"><Mountain className="h-3 w-3" /> traverse profile</div>
      {path ? (
        <svg viewBox={`0 0 ${path.W} ${path.H}`} className="h-10 w-full" preserveAspectRatio="none">
          <path d={path.d} fill="none" stroke="#ffb347" strokeWidth="1.2" opacity="0.9" />
          <line x1={frac * path.W} y1="0" x2={frac * path.W} y2={path.H} stroke="#54e0ff" strokeWidth="1" strokeDasharray="2 2" />
          <circle cx={frac * path.W} cy={path.H - 12} r="2.4" fill="#54e0ff" />
        </svg>
      ) : (
        <div className="hud-label py-3 text-center">sampling dem…</div>
      )}
      <div className="mt-1 flex justify-between text-[9px] text-[var(--hud-dim)]">
        <span>{fmtDist(r.distM)}</span>
        <span>{fmtDist(r.totalM)}</span>
      </div>
    </VisorCard>
  );
}

/* ================= immersive frame / instruments ================= */

/** curved helmet glass — vignette, brow/chin shade, reflections, scratches.
 *  viewBox 0..100 stretched over the viewport (preserveAspectRatio="none") —
 *  polygon/path data cannot use %-units, so all geometry lives in the 0-100 space.
 *  Rivets stay in a separate un-stretched svg so they remain perfectly round. */
function HelmetFrame() {
  return (
    <>
    <svg className="no-print pointer-events-none absolute inset-0 z-[469] h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      <defs>
        <radialGradient id="hf-vig" cx="50%" cy="46%" r="74%">
          <stop offset="58%" stopColor="#04060a" stopOpacity="0" />
          <stop offset="82%" stopColor="#04060a" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#02030a" stopOpacity="0.97" />
        </radialGradient>
        <linearGradient id="hf-brow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#010207" stopOpacity="0.88" />
          <stop offset="1" stopColor="#010207" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="hf-chin" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#010207" stopOpacity="0.8" />
          <stop offset="0.18" stopColor="#010207" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="hf-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.075" />
          <stop offset="0.3" stopColor="#ffffff" stopOpacity="0.015" />
          <stop offset="0.6" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#hf-vig)" />
      <rect width="100%" height="10%" fill="url(#hf-brow)" />
      <rect y="83%" width="100%" height="17%" fill="url(#hf-chin)" />
      <polygon points="0,0 30,0 4,100 0,100" fill="url(#hf-glass)" opacity="0.55" />
      <polygon points="38,0 47,0 16,100 10,100" fill="url(#hf-glass)" opacity="0.4" />
      <path d="M 66 24 q 9 3.5 18 1" stroke="#ffffff" strokeOpacity="0.06" fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <path d="M 28 68 q 11 -4 24 -2" stroke="#ffffff" strokeOpacity="0.05" fill="none" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      <path d="M 55 78 q 7 2 13 0.5" stroke="#ffffff" strokeOpacity="0.04" fill="none" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <rect width="2.4" height="58" y="21" fill="#04060a" opacity="0.92" />
      <rect x="97.6" width="2.4" height="58" y="21" fill="#04060a" opacity="0.92" />
    </svg>
    {/* helmet side rivets — px-space svg so the circles never stretch */}
    <svg className="no-print pointer-events-none absolute inset-0 z-[469] h-full w-full" aria-hidden>
      <g fill="#161f29" stroke="#3a4754" strokeWidth="1">
        <circle cx="1.2%" cy="30%" r="4" />
        <circle cx="98.8%" cy="30%" r="4" />
        <circle cx="1.2%" cy="70%" r="4" />
        <circle cx="98.8%" cy="70%" r="4" />
      </g>
    </svg>
    </>
  );
}

/** live heading tape — canvas + rAF (reads camBus, no React re-render) */
function CompassTape() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = 300, H = 46;
    cv.width = W * dpr;
    cv.height = H * dpr;
    const cx = cv.getContext("2d")!;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const yaw = ((camBus.yawDeg % 360) + 360) % 360;
      const r = useStore.getState().walk.readout;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.clearRect(0, 0, W, H);
      cx.fillStyle = "rgba(9,13,19,0.78)";
      cx.strokeStyle = "rgba(255,122,47,0.28)";
      cx.lineWidth = 1;
      cx.beginPath();
      if (typeof cx.roundRect === "function") cx.roundRect(0.5, 0.5, W - 1, H - 1, 4);
      else cx.rect(0.5, 0.5, W - 1, H - 1);
      cx.fill();
      cx.stroke();
      const span = 110;
      const ppd = (W - 24) / span;
      const xm = W / 2;
      cx.textAlign = "center";
      const startDeg = Math.floor((yaw - span / 2) / 5) * 5;
      for (let a = startDeg; a <= yaw + span / 2 + 6; a += 5) {
        const x = xm + (a - yaw) * ppd;
        if (x < 10 || x > W - 10) continue;
        const deg = ((a % 360) + 360) % 360;
        const isCard = deg % 90 === 0;
        const major = deg % 30 === 0;
        const fade = 1 - (Math.abs(a - yaw) / (span / 2)) * 0.6;
        cx.strokeStyle = `rgba(215,226,236,${(major ? 0.9 : 0.38) * fade})`;
        cx.lineWidth = 1;
        cx.beginPath();
        cx.moveTo(x, major ? 15 : 19);
        cx.lineTo(x, 24);
        cx.stroke();
        if (major) {
          cx.font = "10px 'Share Tech Mono', monospace";
          cx.fillStyle = isCard ? "#ffb347" : `rgba(215,226,236,${0.75 * fade})`;
          cx.fillText(isCard ? ["N", "E", "S", "W"][deg / 90] : String(deg), x, 11);
        }
      }
      if (r && !r.atEnd) {
        const rel = ((r.bearing - yaw + 540) % 360) - 180;
        const cl = Math.max(-span / 2, Math.min(span / 2, rel));
        const x = xm + cl * ppd;
        const clipped = Math.abs(rel) > span / 2;
        cx.fillStyle = "#54e0ff";
        cx.globalAlpha = clipped ? 0.5 : 0.95;
        cx.beginPath();
        cx.moveTo(x, 26);
        cx.lineTo(x - 4.5, 33);
        cx.lineTo(x + 4.5, 33);
        cx.closePath();
        cx.fill();
        if (clipped) cx.fillRect(rel > 0 ? W - 9 : 3, 28, 6, 2.5);
        cx.globalAlpha = 1;
      }
      /* shelter bug during hazard drills — magenta, below the waypoint bug */
      const hz = useStore.getState().hazard;
      if (hz) {
        const rel = ((hz.base.bearing - yaw + 540) % 360) - 180;
        const cl = Math.max(-span / 2, Math.min(span / 2, rel));
        const x = xm + cl * ppd;
        const clipped = Math.abs(rel) > span / 2;
        cx.fillStyle = "#ff5f8f";
        cx.globalAlpha = 0.5 + 0.5 * Math.sin(Date.now() / 260);
        cx.beginPath();
        cx.moveTo(x, 30);
        cx.lineTo(x - 4, 37);
        cx.lineTo(x + 4, 37);
        cx.closePath();
        cx.fill();
        if (clipped) cx.fillRect(rel > 0 ? W - 9 : 3, 32, 6, 2.5);
        cx.globalAlpha = 1;
      }
      cx.strokeStyle = "#ff7a2f";
      cx.lineWidth = 1.5;
      cx.beginPath();
      cx.moveTo(xm, 13);
      cx.lineTo(xm, 30);
      cx.stroke();
      cx.font = "10px 'Share Tech Mono', monospace";
      cx.fillStyle = "#ff7a2f";
      cx.fillText(`${String(Math.round(yaw)).padStart(3, "0")}°`, xm, 42);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} style={{ width: 300, height: 46 }} className="max-w-[86vw]" />;
}

/** top-down traverse mini-map with walker dot + live view cone (canvas, rAF) */
function MiniMap({ size = 138 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const S = size;
    cv.width = S * dpr;
    cv.height = S * dpr;
    const cx = cv.getContext("2d")!;
    let raf = 0;
    const M_LAT = 59274;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const st = useStore.getState();
      const route = st.route;
      const r = st.walk.readout;
      const cLat = camBus.centerLat;
      const mLon = M_LAT * Math.cos((cLat * Math.PI) / 180);
      const k = (S * 0.94) / camBus.spanM;
      const px = (lon: number) => S / 2 + (lon - camBus.centerLon) * mLon * k;
      const py = (lat: number) => S / 2 - (lat - cLat) * M_LAT * k;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.clearRect(0, 0, S, S);
      cx.save();
      cx.beginPath();
      cx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
      cx.clip();
      cx.fillStyle = "rgba(7,11,16,0.84)";
      cx.fillRect(0, 0, S, S);
      cx.strokeStyle = "rgba(84,224,255,0.12)";
      cx.lineWidth = 1;
      cx.beginPath();
      cx.moveTo(S / 2, 8);
      cx.lineTo(S / 2, S - 8);
      cx.moveTo(8, S / 2);
      cx.lineTo(S - 8, S / 2);
      cx.stroke();
      if (route.length >= 2) {
        cx.strokeStyle = "rgba(255,179,71,0.9)";
        cx.lineWidth = 1.6;
        cx.beginPath();
        route.forEach((w, i) => (i ? cx.lineTo(px(w.lon), py(w.lat)) : cx.moveTo(px(w.lon), py(w.lat))));
        cx.stroke();
        route.forEach((w, i) => {
          cx.fillStyle = i === route.length - 1 ? "#4ade80" : "#54e0ff";
          cx.beginPath();
          cx.arc(px(w.lon), py(w.lat), 2.4, 0, Math.PI * 2);
          cx.fill();
        });
      }
      if (r && !r.atEnd) {
        const wp = route[Math.min(r.nextIdx, route.length - 1)];
        if (wp) {
          const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
          cx.strokeStyle = `rgba(84,224,255,${0.3 + 0.5 * pulse})`;
          cx.lineWidth = 1.4;
          cx.beginPath();
          cx.arc(px(wp.lon), py(wp.lat), 4 + 3 * pulse, 0, Math.PI * 2);
          cx.stroke();
        }
      }
      /* shelter base during hazard drills — magenta diamond + dashed bearing line */
      const hz = st.hazard;
      if (hz) {
        const bx = px(hz.base.lon), by = py(hz.base.lat);
        const ax = px(camBus.lon), ay = py(camBus.lat);
        cx.strokeStyle = "rgba(255,95,143,0.75)";
        cx.lineWidth = 1.2;
        cx.setLineDash([3, 3]);
        cx.beginPath();
        cx.moveTo(ax, ay);
        cx.lineTo(bx, by);
        cx.stroke();
        cx.setLineDash([]);
        cx.fillStyle = "#ff5f8f";
        cx.beginPath();
        cx.moveTo(bx, by - 5);
        cx.lineTo(bx + 4, by);
        cx.lineTo(bx, by + 5);
        cx.lineTo(bx - 4, by);
        cx.closePath();
        cx.fill();
      }
      const wx = px(camBus.lon), wy = py(camBus.lat);
      const yawR = (camBus.yawDeg * Math.PI) / 180;
      cx.fillStyle = "rgba(84,224,255,0.16)";
      cx.beginPath();
      cx.moveTo(wx, wy);
      cx.arc(wx, wy, 26, yawR - Math.PI / 2 - 0.42, yawR - Math.PI / 2 + 0.42);
      cx.closePath();
      cx.fill();
      cx.fillStyle = "#54e0ff";
      cx.beginPath();
      cx.arc(wx, wy, 3, 0, Math.PI * 2);
      cx.fill();
      cx.restore();
      cx.strokeStyle = "rgba(255,122,47,0.35)";
      cx.lineWidth = 1;
      cx.beginPath();
      cx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
      cx.stroke();
      cx.fillStyle = "#ffb347";
      cx.font = "9px 'Share Tech Mono', monospace";
      cx.textAlign = "center";
      cx.fillText("N", S / 2, 12);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);
  return (
    <div className="hud-panel justify-center rounded-full p-[3px]">
      <canvas ref={ref} style={{ width: size, height: size }} className="rounded-full" />
    </div>
  );
}

/** nav needle — rotates relative to the live camera heading (rAF, no re-render) */
function BearingNeedle({ bearing }: { bearing: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (ref.current) ref.current.style.transform = `rotate(${bearing - camBus.yawDeg}deg)`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bearing]);
  return (
    <svg ref={ref} viewBox="0 0 24 24" className="h-7 w-7 drop-shadow-[0_0_4px_rgba(255,122,47,0.6)]">
      <path d="M12 2 L18 22 L12 17 L6 22 Z" fill="var(--hud-orange)" stroke="#0b0f14" strokeWidth="0.8" />
    </svg>
  );
}

/** bio telemetry — deterministic heart waveform sparkline (12 Hz re-render) */
function HeartSpark() {
  const t = performance.now() / 1000;
  const pts: string[] = [];
  for (let i = 0; i < 50; i++) {
    const tt = t * 1.15 + i * 0.09;
    const ph = tt % 1;
    const beat = ph < 0.14 ? Math.sin((ph / 0.14) * Math.PI) : ph > 0.2 && ph < 0.3 ? -Math.sin(((ph - 0.2) / 0.1) * Math.PI) * 0.35 : 0;
    const v = 74 + beat * 16 + Math.sin(tt * 0.31) * 3.5;
    pts.push(`${i * 2},${(20 - (v - 70) * 0.9).toFixed(1)}`);
  }
  const bpm = 76 + Math.sin(t * 0.21) * 4 + Math.sin(t * 1.13) * 1.5;
  return (
    <div className="mt-1.5 flex items-end gap-2">
      <svg viewBox="0 0 98 26" className="h-6 w-[98px]" preserveAspectRatio="none">
        <polyline points={pts.join(" ")} fill="none" stroke="var(--hud-green)" strokeWidth="1.1" opacity="0.9" />
      </svg>
      <div className="pb-0.5">
        <div className="hud-label leading-none">heart</div>
        <div className="font-display text-[12px] leading-none text-[var(--hud-green)]">{bpm.toFixed(0)} bpm</div>
      </div>
    </div>
  );
}

function airTempC(lst: number): number {
  return -63 + 21 * Math.sin(((lst - 9) / 24) * 2 * Math.PI);
}

/** center reticle — corner brackets + fine cross */
function ReticleHud() {
  return (
    <div className="no-print pointer-events-none absolute left-1/2 top-1/2 z-[468] -translate-x-1/2 -translate-y-1/2">
      <svg viewBox="0 0 64 64" className="h-16 w-16 opacity-60" style={{ filter: "drop-shadow(0 0 3px rgba(255,122,47,0.55))" }}>
        <g stroke="var(--hud-orange)" strokeWidth="1.5" fill="none">
          <path d="M6 18 V6 H18" />
          <path d="M46 6 H58 V18" />
          <path d="M58 46 V58 H46" />
          <path d="M18 58 H6 V46" />
          <path d="M32 25 V29 M32 35 V39 M25 32 H29 M35 32 H39" strokeWidth="1" />
        </g>
        <circle cx="32" cy="32" r="1.4" fill="var(--hud-orange)" />
      </svg>
    </div>
  );
}

/* ================= live walk HUD — bottom dock ================= */

/** compact dock card */
function DockCard({ children, className = "", minW }: { children: React.ReactNode; className?: string; minW?: number }) {
  return (
    <div className={`hud-panel flex flex-col rounded-sm px-2.5 py-2 ${className}`} style={minW ? { minWidth: minW } : undefined}>
      {children}
    </div>
  );
}

/* ---------------- F13: large O₂ warning banner ---------------- */

function O2Banner({ pct, critical }: { pct: number; critical: boolean }) {
  const color = critical ? "var(--hud-red)" : "var(--hud-amber)";
  return (
    <div className="absolute left-1/2 top-[64px] z-[478] w-[min(640px,calc(100%-20px))] -translate-x-1/2">
      <div
        className={`flex items-center gap-3 rounded-sm border-2 px-4 py-2.5 ${critical ? "blink" : ""}`}
        style={{
          borderColor: color,
          background: critical ? "rgba(248,113,113,0.16)" : "rgba(255,179,71,0.12)",
          boxShadow: `0 0 26px ${critical ? "rgba(248,113,113,0.45)" : "rgba(255,179,71,0.3)"}`,
        }}
        role="alert"
        aria-live="assertive"
      >
        <ShieldAlert className="h-8 w-8 shrink-0" style={{ color }} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-xl font-bold tracking-[0.18em]" style={{ color }}>
            O₂ {critical ? "CRITICAL" : "LOW"} · {pct.toFixed(0)}%
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--hud-text)]">
            {critical ? "RETURN TO BASE IMMEDIATELY — SUIT RESERVE NEARLY SPENT" : "HALF SUPPLY CONSUMED — PLAN YOUR TURNAROUND LEG NOW"}
          </div>
        </div>
        <div className="w-28 shrink-0">
          <div className="h-3 w-full overflow-hidden rounded-sm bg-[rgba(255,255,255,0.12)]">
            <div className="h-full transition-all duration-300" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
          </div>
          <div className="hud-label mt-0.5 text-center">o₂ reserve</div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- F6/F7: live location beacon card ---------------- */

function LocationBeaconCard() {
  const [fix, setFix] = useState(() => ({ lon: camBus.lon, lat: camBus.lat, elev: camBus.elevM }));
  useEffect(() => {
    const iv = setInterval(() => {
      setFix({ lon: camBus.lon, lat: camBus.lat, elev: camBus.elevM });
    }, 130);
    return () => clearInterval(iv);
  }, []);
  const name = locationName(fix.lon, fix.lat);
  return (
    <DockCard minW={196} className="border-[rgba(84,224,255,0.4)]">
      <div className="hud-label flex items-center gap-1.5">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--hud-cyan)] opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--hud-cyan)]" />
        </span>
        location · live beacon
      </div>
      <div className="font-display mt-1 text-[13px] leading-tight text-[var(--hud-cyan)] hud-glow-cyan">{name}</div>
      <div className="mt-1 text-[11px] text-[var(--hud-text)]">{fmtLonLat(fix.lon, fix.lat)}</div>
      <div className="hud-label mt-0.5">elev {fix.elev.toFixed(0)} m · auto-identified</div>
    </DockCard>
  );
}

/* ---------------- F3: comms dock card ---------------- */

function CommsDockCard({ onOpen }: { onOpen: () => void }) {
  const comms = useStore((s) => s.comms);
  const last = comms.messages[comms.messages.length - 1];
  const statusColor = comms.status === "ONLINE" ? "var(--hud-green)" : comms.status === "DEGRADED" ? "var(--hud-amber)" : "var(--hud-red)";
  return (
    <DockCard minW={178}>
      <div className="hud-label flex items-center gap-1"><Radio className="h-3 w-3" /> comms link</div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="font-display text-[12px]" style={{ color: statusColor }}>● {comms.status}</span>
        <SignalBars signal={comms.signal} />
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-[var(--hud-dim)]">
        <span>{comms.relay.split(" / ")[0]}</span>
        <span className="text-[var(--hud-cyan)]">{comms.signal}%</span>
      </div>
      <div className="mt-1 line-clamp-2 min-h-[28px] text-[10px] leading-snug text-[var(--hud-dim)]">
        {last ? `${last.from === "mission" ? "MC: " : last.from === "crew" ? "you: " : "log: "}${last.text}` : "link open — send a report"}
      </div>
      <button className="hud-btn mt-1.5 !min-h-0 w-full !justify-center !py-1.5" onClick={onOpen} title="Open the comms console">
        <Radio className="h-3.5 w-3.5" /> open comms
      </button>
    </DockCard>
  );
}

/* ---------------- dock telemetry cards ---------------- */

function EvaDockCard({ r }: { r: WalkReadout }) {
  const o2 = r.o2Pct;
  const color = o2 <= 20 ? "var(--hud-red)" : o2 <= 50 ? "var(--hud-amber)" : "var(--hud-green)";
  return (
    <DockCard minW={174}>
      <div className="hud-label flex items-center gap-1"><Activity className="h-3 w-3" /> eva telemetry</div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="hud-label">o₂ supply</span>
        <span className="font-display text-[14px]" style={{ color }}>{o2.toFixed(0)}%</span>
      </div>
      <div className="mt-1 h-2.5 w-full overflow-hidden rounded-sm bg-[rgba(255,255,255,0.08)]">
        <div className="h-full transition-all duration-300" style={{ width: `${Math.min(100, Math.round(o2))}%`, background: color }} />
      </div>
      <div className="mt-1.5 space-y-0.5">
        <Row label="lst clock" value={fmtLst(r.lstNow)} glow />
        <Row label="elapsed" value={fmtClock(r.elapsedH)} />
        <Row label="dose" value={`${r.doseMsv.toFixed(3)} mSv`} color="var(--hud-amber)" />
      </div>
    </DockCard>
  );
}

/** biometrics dock — heart, core temp, suit pressure, work rate (deterministic sim) */
function BioDockCard({ r }: { r: WalkReadout }) {
  const exertion = Math.min(1, r.speedEff / 4.5 + r.slope / 40);
  const bpm = 74 + exertion * 34 + Math.sin(performance.now() / 4100) * 3;
  const coreC = 36.9 + exertion * 0.9;
  const met = (1.6 + exertion * 5.4).toFixed(1);
  return (
    <DockCard minW={172}>
      <div className="hud-label flex items-center gap-1"><HeartPulse className="h-3 w-3" /> biometrics</div>
      <HeartSpark />
      <div className="mt-1 space-y-0.5">
        <Row label="core temp" value={`${coreC.toFixed(1)} °C`} color={coreC > 37.6 ? "var(--hud-amber)" : "var(--hud-green)"} />
        <Row label="suit pressure" value="4.3 psi" />
        <Row label="work rate" value={`${met} MET`} color={Number(met) > 5 ? "var(--hud-amber)" : "var(--hud-cyan)"} />
      </div>
    </DockCard>
  );
}

/** radiation dock — live dose rate (space-weather driven), cumulative, drill boost */
function RadDockCard({ r }: { r: WalkReadout }) {
  const sw = useSpaceWeather();
  const hzFactor = useStore((s) => s.hazard?.def.doseFactor ?? 1);
  const rateUsvH = ((sw?.marsSurface.gcrDosePerSol ?? 0.7) * 1000 / 24) * hzFactor;
  const state = sw?.marsSurface.evaState ?? "…";
  const hot = hzFactor > 1 || state === "SPE_POSTPONE";
  return (
    <DockCard minW={166} className={hot ? "border-[rgba(248,113,113,0.55)]" : ""}>
      <div className="hud-label flex items-center gap-1"><Zap className="h-3 w-3" /> radiation</div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="hud-label">dose rate</span>
        <span className="font-display text-[14px]" style={{ color: hot ? "var(--hud-red)" : "var(--hud-cyan)" }}>{rateUsvH.toFixed(1)} <span className="text-[9px]">µSv/h</span></span>
      </div>
      <div className="mt-1.5 space-y-0.5">
        <Row label="cumulative" value={`${r.doseMsv.toFixed(3)} mSv`} />
        <Row label="space wx" value={state.replace("_", " ")} color={state === "NOMINAL" ? "var(--hud-green)" : hot ? "var(--hud-red)" : "var(--hud-amber)"} />
        <Row label="shielding" value="suit · 0.4 g/cm²" color="var(--hud-dim)" />
      </div>
      {hot && <div className="mt-1 rounded-sm border border-[rgba(248,113,113,0.5)] px-1.5 py-1 text-[9px] leading-snug text-[var(--hud-red)]">ELEVATED FLUX — shelter advised</div>}
    </DockCard>
  );
}

function TerrainDockCard({ r }: { r: WalkReadout }) {
  const slopeColor = r.slope > 10 ? "var(--hud-red)" : r.slope > 6 ? "var(--hud-amber)" : "var(--hud-green)";
  return (
    <DockCard minW={152}>
      <div className="hud-label flex items-center gap-1"><Gauge className="h-3 w-3" /> terrain</div>
      <div className="mt-1 space-y-0.5">
        <Row label="elev" value={r.elev !== null ? `${Math.round(r.elev)} m` : "…"} />
        <Row label="slope" value={`${r.slope.toFixed(1)}°`} color={slopeColor} />
        <Row label="speed" value={`${r.speedEff.toFixed(1)} km/h`} color="var(--hud-amber)" />
        <Row label="sun" value={`${r.sunElev.toFixed(0)}°`} />
        <Row label="air" value={`${airTempC(r.lstNow).toFixed(0)}°C`} />
      </div>
    </DockCard>
  );
}

/* ---------------- F5: interactive control cluster ---------------- */

function ControlCluster({ onPrefs, playing, manual, speedMult, finished, drillOpen, onToggleDrill }: {
  onPrefs: () => void;
  playing: boolean;
  manual: boolean;
  speedMult: number;
  finished: boolean;
  drillOpen: boolean;
  onToggleDrill: () => void;
}) {
  const setWalkManual = useStore((s) => s.setWalkManual);
  const setWalkPlaying = useStore((s) => s.setWalkPlaying);
  const cycleWalkSpeed = useStore((s) => s.cycleWalkSpeed);
  const jumpToNextWaypoint = useStore((s) => s.jumpToNextWaypoint);
  const stopWalk = useStore((s) => s.stopWalk);
  const setVisorMode = useStore((s) => s.setVisorMode);
  const setCommsOpen = useStore((s) => s.setCommsOpen);
  const openPanel = useStore((s) => s.openPanel);
  const commsOpen = useStore((s) => s.comms.open);
  const hazard = useStore((s) => s.hazard);
  const dockBtn = "hud-btn !min-h-0 !flex-col !gap-0.5 !px-1 !py-1.5 text-[8px] leading-none";
  return (
    <DockCard minW={214} className="order-first border-[var(--hud-border)] 2xl:order-none">
      <div className="hud-label flex items-center gap-1"><Settings2 className="h-3 w-3" /> control panel</div>
      <div className="mt-1.5 grid grid-cols-5 gap-1">
        <button className={`${dockBtn} ${manual ? "active" : ""}`} onClick={() => setWalkManual(!manual)} disabled={finished} title={manual ? "Return to auto-traverse (route-synced)" : "Take manual foot control (WASD / D-pad · SHIFT lope)"}>
          <Footprints className="h-4 w-4" />{manual ? "auto" : "foot"}
        </button>
        <button className={dockBtn} onClick={() => cycleWalkSpeed()} disabled={manual} title={`Simulation time multiplier — astronaut ground speed stays ${useStore.getState().eva.speedKmh.toFixed(1)} km/h (slope-adjusted)`}>
          <FastForward className="h-4 w-4" />{manual ? "foot" : `sim ×${speedMult}`}
        </button>
        <button className={dockBtn} onClick={() => jumpToNextWaypoint()} disabled={finished || manual} title="Skip to next waypoint">
          <SkipForward className="h-4 w-4" />skip
        </button>
        <button className={dockBtn} onClick={() => setWalkPlaying(!playing)} disabled={finished} title={playing ? "Pause walk" : "Resume walk"}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{playing ? "pause" : "play"}
        </button>
        <button className={`${dockBtn} !border-[rgba(248,113,113,0.55)] !text-[var(--hud-red)]`} onClick={() => stopWalk()} title="End walk — exit visor">
          <X className="h-4 w-4" />end
        </button>
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1">
        <button className={dockBtn} onClick={() => setVisorMode(false)} title="Switch to Map View — the walk pauses and your position stays live">
          <Mountain className="h-4 w-4" />map view
        </button>
        <button className={`${dockBtn} ${commsOpen ? "active" : ""}`} onClick={() => setCommsOpen(!commsOpen)} title="Communications console">
          <Radio className="h-4 w-4" />comms
        </button>
        <button className={dockBtn} onClick={() => openPanel("locations")} title="Relocate — named sites, coordinates">
          <MapPin className="h-4 w-4" />places
        </button>
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1">
        <button className={dockBtn} onClick={onPrefs} title="Visor display preferences">
          <Gauge className="h-4 w-4" />prefs
        </button>
        <button
          className={`${dockBtn} ${drillOpen || hazard ? "active !border-[rgba(255,95,143,0.65)] !text-[#ff9db9]" : ""}`}
          onClick={onToggleDrill}
          title="Hazard drill simulator — Mission Control directs you to the best shelter"
        >
          <AlertTriangle className="h-4 w-4" />{hazard ? "drill!" : "drill"}
        </button>
        <span />
      </div>
    </DockCard>
  );
}

/* ---------------- hazard drill simulator (visor side) ---------------- */

function HazardDrillMenu({ onClose }: { onClose: () => void }) {
  const hazard = useStore((s) => s.hazard);
  const triggerHazard = useStore((s) => s.triggerHazard);
  const clearHazard = useStore((s) => s.clearHazard);
  return (
    <div className="pointer-events-auto absolute bottom-[calc(286px*var(--hud-zoom,1)_+_env(safe-area-inset-bottom))] left-2 z-[500] w-[340px] max-w-[calc(100vw-24px)] md:left-3">
      <div className="hud-panel max-h-[calc(100dvh-310px)] overflow-y-auto rounded-sm p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="font-display flex items-center gap-1.5 text-[12px] tracking-[0.18em] text-[#ff9db9]">
            <AlertTriangle className="h-3.5 w-3.5" /> HAZARD DRILLS
          </span>
          <button className="text-[var(--hud-dim)] hover:text-[var(--hud-amber)]" onClick={onClose} aria-label="Close drill menu"><X className="h-3.5 w-3.5" /></button>
        </div>
        <p className="mb-2 text-[9px] leading-snug text-[var(--hud-dim)]">
          Training drills — Mission Control simulates an emergency, ranks every shelter by walk time + shielding and directs you to the best one.
        </p>
        {hazard ? (
          <div className="rounded-sm border border-[rgba(255,95,143,0.55)] bg-[rgba(255,95,143,0.08)] p-2">
            <div className="font-display text-[11px] text-[#ff9db9]">● ACTIVE — {hazard.def.label.toUpperCase()}</div>
            <div className="mt-1 text-[10px] leading-snug text-[var(--hud-text)]">
              Shelter: <b className="text-[var(--hud-amber)]">{hazard.base.name}</b> · {fmtDist(hazard.base.distM)} · bearing {hazard.base.bearing.toFixed(0).padStart(3, "0")}° · ETA ≈ {hazard.base.etaMin} min
            </div>
            <button className="hud-btn mt-2 !min-h-0 w-full !py-1.5 !text-[10px]" onClick={() => clearHazard()}>
              end drill — conditions nominal
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            {HAZARDS.map((h) => (
              <button
                key={h.id}
                className="flex w-full items-start justify-between gap-2 rounded-sm border border-[var(--hud-border-dim)] px-2 py-1.5 text-left transition-colors hover:border-[rgba(255,95,143,0.5)]"
                onClick={() => triggerHazard(h.id)}
                title={h.brief}
              >
                <span className="min-w-0">
                  <span className="block text-[11px] text-[var(--hud-text)]">{h.label}</span>
                  <span className="hud-label block truncate">{h.brief}</span>
                </span>
                <span className={`mt-0.5 shrink-0 font-display text-[8px] tracking-[0.15em] ${h.severity === "alert" ? "text-[var(--hud-red)]" : "text-[var(--hud-amber)]"}`}>
                  {h.severity === "alert" ? "CRIT" : "WARN"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WalkHud({ prefs, onPrefs }: { prefs: VisorPrefs; onPrefs: () => void }) {
  const r = useStore((s) => s.walk.readout);
  const route = useStore((s) => s.route);
  const eva = useStore((s) => s.eva);
  const walk = useStore((s) => s.walk);
  const manual = useStore((s) => s.walk.manual);
  const hazard = useStore((s) => s.hazard);
  const [drillOpen, setDrillOpen] = useState(false);
  if (!r) return null;
  const nextWp = route[Math.min(r.nextIdx, route.length - 1)];
  const etaH = r.speedEff > 0.05 ? r.nextDistM / 1000 / r.speedEff : 0;
  const o2 = r.o2Pct;
  const o2Critical = o2 <= 20;
  const o2Low = o2 <= 50;

  /* small hazard banner covers terrain advisories; drills get the global banner
   * (Alerts.tsx) + compass/minimap shelter bugs — no duplicate banner here */
  const alerts: { msg: string; level: "advise" | "critical" }[] = [];
  if (prefs.hazards) {
    if (r.slope > 10) alerts.push({ msg: `STEEP TERRAIN ${r.slope.toFixed(0)}° — REDUCED TRACTION`, level: "advise" });
    if (r.sunElev < 5) alerts.push({ msg: `LOW SUN ${r.sunElev.toFixed(0)}° — VISIBILITY/COLD RISK`, level: "advise" });
  }
  const topAlert = alerts[0];

  /* the waypoint we are currently stopped at (last legCum point at/before walker) */
  const dwellWp = (() => {
    if (r.dwellH <= 0) return null;
    const frame = buildFrame(route);
    let idx = 0;
    for (let i = 1; i < route.length; i++) if (frame.legCum[i] <= r.distM + 1.5) idx = i;
    return route[idx] ?? null;
  })();

  const stackTop = prefs.compass ? "top-[62px]" : "top-3";
  const hazardTop = o2Low && prefs.hazards ? "top-[178px]" : stackTop;
  return (
    <div className="pointer-events-none absolute inset-0 z-[470] select-none visor-solid" style={{ zoom: "var(--hud-zoom, 1)" }}>
      {/* critical O₂ or drill: red pulsing edge vignette */}
      {(o2Critical || hazard) && prefs.hazards && <div className="o2-crit-vignette" />}

      {/* ---- top center: live compass tape ---- */}
      {prefs.compass && (
        <div className="absolute left-1/2 top-3 z-[472] -translate-x-1/2">
          <CompassTape />
        </div>
      )}
      {/* ---- F13: big O₂ warning ---- */}
      {prefs.hazards && o2Low && <O2Banner pct={o2} critical={o2Critical} />}
      {/* ---- small hazard banner ---- */}
      {topAlert && (
        <div className={`absolute left-1/2 ${hazardTop} z-[471] -translate-x-1/2`}>
          <div className="hud-panel flex items-center gap-2 rounded-sm px-3 py-1.5 text-[11px]">
            <ShieldAlert className="h-3.5 w-3.5 text-[var(--hud-amber)]" />
            <span className="text-[var(--hud-amber)]">{topAlert.msg}</span>
          </div>
        </div>
      )}

      {/* ---- event toast (below the O₂ banner when that is showing) ---- */}
      <WalkEventToast lower={o2Low && prefs.hazards} />

      {/* ---- science-stop dwell card ---- */}
      {r.dwellH > 0 && dwellWp && (
        <div className="pointer-events-auto absolute left-1/2 top-1/2 z-[480] -translate-x-1/2 -translate-y-1/2">
          <VisorCard className="w-[300px] border-[rgba(84,224,255,0.45)] text-center">
            <div className="hud-label">science stop in progress · {dwellWp.name}</div>
            <div className="font-display mt-1 text-lg text-[var(--hud-cyan)] hud-glow-cyan">{POIS.find((p) => p.id === dwellWp.poiId)?.name ?? dwellWp.name}</div>
            <div className="mt-1 text-[11px] text-[var(--hud-text)]">
              {POIS.find((p) => p.id === dwellWp.poiId)?.activity ?? "Field activity"}
            </div>
            <div className="font-display mt-2 text-2xl text-[var(--hud-amber)]">{fmtClock(r.dwellH)} <span className="text-[10px] text-[var(--hud-dim)]">remaining (sim)</span></div>
            <button className="hud-btn mt-3 !min-h-0 w-full !py-1.5" onClick={() => useStore.getState().skipDwell()}>
              <FastForward className="h-3.5 w-3.5" /> resume walking
            </button>
          </VisorCard>
        </div>
      )}

      {/* ---- sample capture ---- */}
      <CapturePrompt />
      <SampleTray />
      <ManualPad />
      <ControlsHint />

      {/* ---- F4: bottom HUD dock — every panel below the sightline ---- */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-[476] border-t border-[var(--hud-border)] bg-[rgba(4,7,11,0.92)] backdrop-blur-md">
        <div className="hud-scroll flex items-stretch gap-2 overflow-x-auto px-2 pb-[calc(0.45rem_+_env(safe-area-inset-bottom))] pt-1.5">
          {/* navigation + route progress */}
          {prefs.nav && nextWp && (
            <DockCard minW={292} className="justify-between">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="hud-label">next waypoint</div>
                  <div className="font-display truncate text-[14px] text-[var(--hud-amber)] hud-glow">
                    {nextWp.name} <span className="text-[10px] font-normal text-[var(--hud-dim)]">{POIS.find((p) => p.id === nextWp.poiId)?.name ?? ""}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <div className="hud-label">range</div>
                    <div className="font-display text-[14px] text-[var(--hud-cyan)] hud-glow-cyan">{fmtDist(r.atEnd ? 0 : r.nextDistM)}</div>
                  </div>
                  <div className="text-right">
                    <div className="hud-label">eta</div>
                    <div className="font-display text-[14px] text-[var(--hud-cyan)]">{r.atEnd ? "—" : fmtClock(etaH).slice(3)}</div>
                  </div>
                  <div className="flex flex-col items-center">
                    <BearingNeedle bearing={r.bearing} />
                    <span className="font-display text-[9px] text-[var(--hud-dim)]">{r.bearing.toFixed(0).padStart(3, "0")}° {compassPoint(r.bearing)}</span>
                  </div>
                </div>
              </div>
              <div className="mt-2">
                <div className="relative h-1.5 w-full overflow-visible rounded-sm bg-[rgba(255,255,255,0.08)]">
                  {(() => {
                    const frame = buildFrame(route);
                    return frame.legCum.slice(1, -1).map((d, i) => (
                      <div key={i} className="absolute top-1/2 h-2.5 w-[2px] -translate-y-1/2 bg-[rgba(84,224,255,0.55)]" style={{ left: `${(d / frame.totalM) * 100}%` }} title={route[i + 1]?.name} />
                    ));
                  })()}
                  <div className="h-full rounded-sm bg-[var(--hud-orange)]" style={{ width: `${(r.distM / Math.max(r.totalM, 1)) * 100}%`, boxShadow: "0 0 8px rgba(255,122,47,0.8)" }} />
                </div>
                <div className="mt-1 flex justify-between text-[9px] text-[var(--hud-dim)]">
                  <span>walked {fmtDist(r.distM)}</span>
                  <span className="text-[var(--hud-amber)]">{manual ? "MANUAL · real-time" : `☉ sim ${walk.speedMult}× · ${eva.crew} crew`}</span>
                  <span>remaining {fmtDist(Math.max(0, r.totalM - r.distM))}</span>
                </div>
              </div>
            </DockCard>
          )}
          {prefs.eva && <EvaDockCard r={r} />}
          {prefs.bio && <BioDockCard r={r} />}
          {prefs.terrain && <TerrainDockCard r={r} />}
          {prefs.rad && <RadDockCard r={r} />}
          <LocationBeaconCard />
          {prefs.comms && <CommsDockCard onOpen={() => useStore.getState().setCommsOpen(!useStore.getState().comms.open)} />}
          {prefs.minimap && <MiniMap size={112} />}
          <ControlCluster onPrefs={onPrefs} playing={walk.playing} manual={manual} speedMult={walk.speedMult} finished={!!r.atEnd} drillOpen={drillOpen} onToggleDrill={() => setDrillOpen((v) => !v)} />
        </div>
      </div>
      {/* hazard drill menu floats OUTSIDE the dock row — nesting it inside the
          scrollable dock clipped its top items off-screen at short viewports */}
      {drillOpen && <HazardDrillMenu onClose={() => setDrillOpen(false)} />}
    </div>
  );
}

function WalkEventToast({ lower = false }: { lower?: boolean }) {
  const event = useStore((s) => s.walk.event);
  const compass = useStore((s) => s.visorPrefs.compass);
  if (!event) return null;
  const color = event.kind === "warn" ? "var(--hud-red)" : event.kind === "arrive" ? "var(--hud-cyan)" : event.kind === "done" ? "var(--hud-green)" : "var(--hud-amber)";
  return (
    <div className={`absolute left-1/2 z-[485] -translate-x-1/2 ${lower ? "top-[192px]" : compass ? "top-[110px]" : "top-3"}`} key={event.id}>
      <div className="hud-panel walk-event max-w-[calc(100vw-24px)] rounded-sm px-4 py-1.5 text-center" style={{ borderColor: color, boxShadow: `0 0 18px ${color}44` }}>
        <span className="font-display text-[12px] tracking-[0.14em]" style={{ color }}>{event.msg}</span>
      </div>
    </div>
  );
}

/* ================= manual foot controls (D-pad + DASH) ================= */

function PadButton({ onHold, children, title, accent = false }: {
  onHold: (down: boolean) => void;
  children: React.ReactNode;
  title: string;
  accent?: boolean;
}) {
  return (
    <button
      className={`hud-btn touch-none select-none !min-h-0 flex h-10 w-10 items-center justify-center !p-0 active:!bg-[rgba(84,224,255,0.28)] ${accent ? "!border-[rgba(255,179,71,0.6)]" : ""}`}
      title={title}
      aria-label={title}
      onPointerDown={(e) => {
        e.preventDefault();
        try {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        } catch {
          /* synthetic / invalid pointer ids — hold still works */
        }
        onHold(true);
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      onLostPointerCapture={() => onHold(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

function ManualPad() {
  const finished = useStore((s) => !!s.walk.readout?.atEnd);
  const manual = useStore((s) => s.walk.manual);
  if (finished) return null;
  return (
    <div className="pointer-events-auto absolute bottom-[calc(274px_+_env(safe-area-inset-bottom))] left-2 z-[475] select-none md:left-3">
      {manual && (
        <div className="hud-chip mb-1 !py-0.5 !text-[9px] !text-[var(--hud-amber)]">manual · shift = dash</div>
      )}
      <div className="grid grid-cols-3 gap-1">
        <span />
        <PadButton onHold={(d) => (walkInput.fwd = d ? 1 : 0)} title="Walk forward (W)">
          <ChevronUp className="h-5 w-5" />
        </PadButton>
        <span />
        <PadButton onHold={(d) => (walkInput.strafe = d ? -1 : 0)} title="Sidestep left (A)">
          <ChevronLeft className="h-5 w-5" />
        </PadButton>
        <PadButton
          accent
          onHold={(d) => (walkInput.dash = d)}
          title="Dash — hold (SHIFT)"
        >
          <Zap className={`h-5 w-5 ${walkInput.dash ? "text-[var(--hud-amber)]" : ""}`} />
        </PadButton>
        <PadButton onHold={(d) => (walkInput.strafe = d ? 1 : 0)} title="Sidestep right (D)">
          <ChevronRight className="h-5 w-5" />
        </PadButton>
        <span />
        <PadButton onHold={(d) => (walkInput.fwd = d ? -1 : 0)} title="Walk backward (S)">
          <ChevronDown className="h-5 w-5" />
        </PadButton>
        <span />
      </div>
    </div>
  );
}

/* ================= 3D sample capture ================= */

function CapturePrompt() {
  const [t, setT] = useState<{ code: string; kind: string; massKg: number; distM: number } | null>(null);
  useEffect(() => {
    const iv = setInterval(() => {
      setT(camBus.target ? { ...camBus.target } : null);
    }, 140);
    return () => clearInterval(iv);
  }, []);
  if (!t) return null;
  return (
    <div className="pointer-events-auto absolute left-1/2 top-[46%] z-[478] -translate-x-1/2 -translate-y-1/2">
      <VisorCard className="w-[248px] border-[rgba(84,224,255,0.55)] !py-2 text-center">
        <div className="hud-label blink">◉ sample in capture range</div>
        <div className="font-display mt-0.5 text-[13px] text-[var(--hud-cyan)] hud-glow-cyan">
          {t.code} · {t.kind}
        </div>
        <div className="hud-label mt-0.5">{t.massKg.toFixed(2)} kg · {t.distM.toFixed(1)} m ahead</div>
        <button className="hud-btn mt-2 !min-h-0 w-full !py-1.5" onClick={() => requestSampleCollect()}>
          <Hand className="h-3.5 w-3.5" /> collect sample · [E]
        </button>
      </VisorCard>
    </div>
  );
}

function SampleTray() {
  const collected = useStore((s) => s.collected);
  if (collected.length === 0) return null;
  return (
    <div className="pointer-events-none absolute left-2 top-3 z-[474] md:left-3">
      <div className="hud-panel rounded-sm px-2 py-1.5">
        <div className="hud-label flex items-center gap-1">
          <FlaskConical className="h-3 w-3" /> sample tray · {collected.length}/12
        </div>
        <div className="mt-1 flex max-w-[150px] flex-wrap gap-1">
          {collected.slice(-4).map((s) => (
            <span key={`${s.code}-${s.t}`} className="hud-chip !py-0.5 !text-[9px] !text-[var(--hud-cyan)]" title={`${s.kind} — ${s.note} · ${s.massKg.toFixed(2)} kg`}>
              {s.code}
            </span>
          ))}
          {collected.length > 4 && <span className="hud-chip !py-0.5 !text-[9px]">+{collected.length - 4}</span>}
        </div>
      </div>
    </div>
  );
}

function ControlsHint() {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const iv = setInterval(() => {
      if (camBus.manual) setGone(true);
    }, 500);
    const t = setTimeout(() => setGone(true), 22000);
    return () => {
      clearInterval(iv);
      clearTimeout(t);
    };
  }, []);
  if (gone) return null;
  return (
    <div className="pointer-events-none absolute bottom-[302px] left-1/2 z-[473] -translate-x-1/2">
      <span className="hud-chip !text-[var(--hud-cyan)]">W A S D walk · SHIFT dash · E collect sample · drag to look</span>
    </div>
  );
}

/* ================= standby (visor on, not walking) ================= */

function StandbyHud({ prefs, onPrefs }: { prefs: VisorPrefs; onPrefs: () => void }) {
  const route = useStore((s) => s.route);
  const site = useStore((s) => s.site);
  const openPanel = useStore((s) => s.openPanel);
  const setVisorMode = useStore((s) => s.setVisorMode);
  const canWalk = route.length >= 2;
  const blocksOn = ([prefs.nav && "NAV", prefs.eva && "EVA", prefs.bio && "BIO", prefs.rad && "RAD", prefs.terrain && "TERRAIN", prefs.comms && "COMMS", prefs.hazards && "HAZARD", prefs.profile && "PROFILE", prefs.compass && "COMPASS", prefs.minimap && "MAP", prefs.shadows && "SHADOWS"] as (string | false)[]).filter((b): b is string => !!b);
  return (
    <div className="pointer-events-none absolute inset-0 z-[470] flex items-center justify-center select-none visor-solid" style={{ zoom: "var(--hud-zoom, 1)" }}>
      <div className="pointer-events-auto w-[min(430px,calc(100%-32px))]">
        <VisorCard className="border-[rgba(255,122,47,0.45)] text-center">
          <div className="hud-label">visor mode · hud configured</div>
          <div className="font-display mt-1 text-lg text-[var(--hud-amber)] hud-glow">MARSWALK VISOR READY</div>
          <div className="mt-2 rounded-sm border border-[rgba(84,224,255,0.35)] bg-[rgba(84,224,255,0.06)] px-2 py-1.5">
            <div className="hud-label">current location · live beacon</div>
            <div className="font-display mt-0.5 text-[13px] text-[var(--hud-cyan)] hud-glow-cyan">{site.name}</div>
            <div className="hud-label mt-0.5">{fmtLonLat(site.lon, site.lat)} · {site.region}</div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--hud-text)]">
            Real-time 3D surface view — DEM terrain, craters, rocks, sun shadows and the lander rendered from real mission data. Walk hands-free along the traverse or take manual foot control (WASD / on-screen pad, SHIFT to dash), look around freely and grab rock samples in 3D with [E]. Live range, bearing, O₂ and dose telemetry sit in the dock below.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {blocksOn.length > 0 ? blocksOn.map((b) => <span key={b} className="hud-chip !text-[var(--hud-cyan)]">{b}</span>) : <span className="hud-chip">all blocks off — open prefs</span>}
          </div>
          <button className="hud-btn active mt-4 w-full !py-2.5" disabled={!canWalk} onClick={() => useStore.getState().startWalk()}>
            <Footprints className="h-4 w-4" /> {canWalk ? "begin marswalk" : "plan a route first (≥2 waypoints)"}
          </button>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <button className="hud-btn !min-h-0 !flex-col !gap-0.5 !py-1.5 text-[8px]" onClick={() => openPanel("locations")} title="Choose a location — named sites, search, coordinates">
              <MapPin className="h-4 w-4" />locations
            </button>
            <button className="hud-btn !min-h-0 !flex-col !gap-0.5 !py-1.5 text-[8px]" onClick={() => setVisorMode(false)} title="Switch to Map View">
              <Mountain className="h-4 w-4" />map view
            </button>
            <button className="hud-btn !min-h-0 !flex-col !gap-0.5 !py-1.5 text-[8px]" onClick={onPrefs} title="Visor display preferences">
              <Settings2 className="h-4 w-4" />prefs
            </button>
          </div>
          {canWalk && <p className="mt-2 text-[10px] text-[var(--hud-dim)]">EVA-01 · {route.length} waypoints · sim clock starts at {fmtLst(useStore.getState().eva.startLst)}</p>}
        </VisorCard>
      </div>
    </div>
  );
}

/* ================= preferences popover ================= */

const PREF_META: { key: keyof VisorPrefs; label: string; hint: string }[] = [
  { key: "nav", label: "Navigation tape", hint: "next WP · range · bearing · ETA · progress" },
  { key: "eva", label: "EVA telemetry", hint: "O₂ bar · dose · LST clock · elapsed" },
  { key: "bio", label: "Biometrics", hint: "heart · core temp · suit pressure · work rate" },
  { key: "rad", label: "Radiation", hint: "live dose rate · cumulative · space-wx state" },
  { key: "terrain", label: "Terrain underfoot", hint: "elevation · slope · speed · sun" },
  { key: "comms", label: "Comms relay", hint: "Earth light-time · space weather" },
  { key: "hazards", label: "Hazard alerts", hint: "steep terrain · O₂ turnaround · low sun" },
  { key: "profile", label: "Traverse profile", hint: "mini DEM profile with walker dot" },
  { key: "helmet", label: "Helmet mask", hint: "curved visor frame overlay" },
  { key: "reticle", label: "Center reticle", hint: "crosshair at visor center" },
  { key: "compass", label: "Heading tape", hint: "live compass · waypoint + shelter bearing bugs" },
  { key: "minimap", label: "Traverse mini-map", hint: "top-down route · walker · view cone" },
  { key: "shadows", label: "Sun shadows", hint: "dynamic shadow maps — terrain · rocks · lander" },
];

function VisorPrefsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prefs = useStore((s) => s.visorPrefs);
  const setVisorPref = useStore((s) => s.setVisorPref);
  const setVisorDensity = useStore((s) => s.setVisorDensity);
  const matchesDensity = (d: "minimal" | "standard" | "full") => PREF_META.every((m) => VISOR_PRESET[d][m.key] === prefs[m.key]);
  if (!open) return null;
  return (
    <div className="pointer-events-auto absolute bottom-[calc(286px*var(--hud-zoom,1)_+_env(safe-area-inset-bottom))] right-2 z-[500] w-[290px] md:right-3">
      <div className="hud-panel rounded-sm p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-display text-[12px] tracking-[0.18em] text-[var(--hud-amber)]">VISOR PREFS</span>
          <button className="text-[var(--hud-dim)] hover:text-[var(--hud-amber)]" onClick={onClose} aria-label="Close visor preferences"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="mb-3 grid grid-cols-3 gap-1.5">
          {(["minimal", "standard", "full"] as const).map((d) => (
            <button key={d} className={`hud-btn !min-h-0 !px-1 !py-1 text-[9px] ${matchesDensity(d) ? "active" : ""}`} onClick={() => setVisorDensity(d)}>
              {d}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {PREF_META.map((m) => (
            <div key={m.key} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] text-[var(--hud-text)]">{m.label}</div>
                <div className="hud-label truncate">{m.hint}</div>
              </div>
              <Switch checked={prefs[m.key]} onCheckedChange={(v) => setVisorPref(m.key, v)} aria-label={m.label} />
            </div>
          ))}
        </div>
        <p className="mt-2 text-[9px] text-[var(--hud-dim)]">Saved to your mission file · applies live</p>
      </div>
    </div>
  );
}

/* ================= root overlay ================= */

export function VisorOverlay() {
  const prefs = useStore((s) => s.visorPrefs);
  const walkActive = useStore((s) => s.walk.active);
  const hasReadout = useStore((s) => s.walk.readout !== null);
  const dwelling = useStore((s) => (s.walk.readout?.dwellH ?? 0) > 0);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const togglePrefs = useCallback(() => setPrefsOpen((v) => !v), []);

  /* HUD zoom for large monitors — drives the --hud-zoom CSS var consumed by the
   * visor HUD (zoom) and by floating panels that must track the dock height */
  useEffect(() => {
    const apply = () => {
      const z = Math.min(1.42, Math.max(1, window.innerWidth / 1650));
      document.documentElement.style.setProperty("--hud-zoom", z.toFixed(3));
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  return (
    <>
      <WalkEngine />
      {/* first-person surface view — the walking astronaut's eyes */}
      <FirstPersonTerrain />
      {/* helmet mask */}
      {prefs.helmet && <HelmetFrame />}
      {/* reticle */}
      {prefs.reticle && !dwelling && <ReticleHud />}
      {/* prefs panel (opened from the dock control cluster or standby card) */}
      <VisorPrefsPanel open={prefsOpen} onClose={togglePrefs} />
      {walkActive && hasReadout ? <WalkHud prefs={prefs} onPrefs={togglePrefs} /> : <StandbyHud prefs={prefs} onPrefs={togglePrefs} />}
    </>
  );
}

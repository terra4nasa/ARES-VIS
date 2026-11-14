"use client";
/**
 * Global critical-alert stack + persistent hazard drill banner.
 *
 * CriticalAlerts  — mission-control warnings that POP over any view (map or
 *                   visor): low O₂, weak signal, space-weather escalations and
 *                   hazard-drill triggers. Warnings auto-dismiss after 30 s;
 *                   critical alerts stay until acknowledged.
 * HazardBanner    — persistent R2B (return-to-base) banner while a drill is
 *                   active: recommended shelter, distance, bearing, ETA and a
 *                   live countdown, with locate/end controls.
 */
import { useEffect, useMemo, useState } from "react";
import { ShieldAlert, Crosshair, Square } from "lucide-react";
import { useStore } from "@/lib/store";
import { fmtDist, compassPoint } from "@/lib/mars";
import { bestBaseFor } from "@/lib/hazards";

function alertColor(kind: "warn" | "alert"): string {
  return kind === "alert" ? "var(--hud-red)" : "var(--hud-amber)";
}

export function CriticalAlerts() {
  const alerts = useStore((s) => s.comms.alerts);
  const dismissAlert = useStore((s) => s.dismissAlert);

  /* warnings fade out on their own; critical alerts persist */
  useEffect(() => {
    const timers = alerts
      .filter((a) => a.kind === "warn")
      .map((a) => setTimeout(() => dismissAlert(a.id), 30000));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts.map((a) => `${a.id}:${a.kind}`).join(",")]);

  if (alerts.length === 0) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-[600] flex w-[min(680px,calc(100vw-20px))] -translate-x-1/2 flex-col gap-1.5">
      {alerts.map((a) => {
        const color = alertColor(a.kind);
        const critical = a.kind === "alert";
        return (
          <div
            key={a.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-sm border-2 px-3.5 py-2.5 backdrop-blur-md ${critical ? "blink-slow" : ""}`}
            style={{
              borderColor: color,
              background: critical ? "rgba(60,10,10,0.92)" : "rgba(52,38,8,0.92)",
              boxShadow: `0 0 26px ${critical ? "rgba(248,113,113,0.4)" : "rgba(255,179,71,0.3)"}`,
            }}
            role="alert"
            aria-live="assertive"
          >
            <ShieldAlert className="mt-0.5 h-7 w-7 shrink-0" style={{ color }} />
            <div className="min-w-0 flex-1">
              <div className="font-display text-[13px] font-bold tracking-[0.14em]" style={{ color }}>
                {a.title}
              </div>
              <div className="mt-0.5 whitespace-pre-line text-[11px] leading-snug text-[var(--hud-text)]">{a.text}</div>
            </div>
            <button
              className="shrink-0 rounded-sm border px-1.5 py-1 text-[10px] tracking-widest"
              style={{ borderColor: color, color }}
              onClick={() => dismissAlert(a.id)}
              aria-label="Acknowledge alert"
            >
              ACK
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** persistent hazard-drill banner — both map and visor views */
export function HazardBanner() {
  const hazard = useStore((s) => s.hazard);
  const readout = useStore((s) => s.walk.readout);
  const route = useStore((s) => s.route);
  const site = useStore((s) => s.site);
  const plannedSpeed = useStore((s) => s.eva.speedKmh);
  const clearHazard = useStore((s) => s.clearHazard);
  const focus = useStore((s) => s.focus);
  const [, setClockTick] = useState(0);

  /* T+ clock tick — also nudges the periodic Mission Control advice cadence */
  useEffect(() => {
    if (!hazard) return;
    const iv = setInterval(() => setClockTick((t) => t + 1), 20000);
    return () => clearInterval(iv);
  }, [hazard?.startedT]);

  /* re-solve the shelter recommendation toward the current position. Computed
   * in render, NOT in a store selector: a fresh object per snapshot makes
   * React's useSyncExternalStore loop ("getSnapshot should be cached") and
   * crash the app the moment a drill is triggered */
  const rec = useMemo(() => {
    if (!hazard) return null;
    const spd = readout?.speedEff || plannedSpeed;
    return bestBaseFor(hazard.def, readout?.lon ?? site.lon, readout?.lat ?? site.lat, route, spd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hazard?.id, readout?.lon, readout?.lat, readout?.speedEff, plannedSpeed, route, site.lon, site.lat]);

  if (!hazard || !rec) return null;
  const color = hazard.def.severity === "alert" ? "var(--hud-red)" : "var(--hud-amber)";
  const elapsedMin = Math.floor((Date.now() - hazard.startedT) / 60000);
  return (
    <div className="no-print pointer-events-none absolute bottom-[calc(58px+env(safe-area-inset-bottom))] left-1/2 z-[540] w-[min(620px,calc(100vw-20px))] -translate-x-1/2">
      <div
        className="pointer-events-auto flex items-center gap-3 rounded-sm border-2 px-3.5 py-2"
        style={{ borderColor: color, background: "rgba(50,12,14,0.93)", boxShadow: `0 0 22px rgba(248,113,113,0.3)` }}
      >
        <ShieldAlert className="h-7 w-7 shrink-0 blink" style={{ color }} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[13px] font-bold tracking-[0.14em]" style={{ color }}>
            {hazard.def.label.toUpperCase()} DRILL · T+{elapsedMin} MIN — RETURN TO SHELTER
          </div>
          <div className="mt-0.5 truncate text-[11px] text-[var(--hud-text)]">
            Recommended: <b className="text-[var(--hud-amber)]">{rec.name}</b> — {fmtDist(rec.distM)} at bearing{" "}
            {rec.bearing.toFixed(0).padStart(3, "0")}° {compassPoint(rec.bearing)} · ETA ≈ {rec.etaMin} min
          </div>
        </div>
        <button
          className="hud-btn !min-h-0 shrink-0 !px-2 !py-1.5 !text-[10px]"
          onClick={() => focus(rec.lon, rec.lat, 15)}
          title="Locate the recommended shelter on the map"
        >
          <Crosshair className="h-3.5 w-3.5" /> locate
        </button>
        <button
          className="hud-btn !min-h-0 shrink-0 !px-2 !py-1.5 !text-[10px] !border-[rgba(248,113,113,0.55)] !text-[var(--hud-red)]"
          onClick={() => clearHazard()}
          title="End the hazard drill"
        >
          <Square className="h-3 w-3" /> end
        </button>
      </div>
    </div>
  );
}

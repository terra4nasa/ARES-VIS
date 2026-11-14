"use client";
import { Orbit, Crosshair, Layers, Map as MapIcon, MapPin, FlaskConical, Gauge, Database, Printer, Radar, Radio, Satellite, User, Users } from "lucide-react";
import { useStore } from "@/lib/store";
import { fmtDist, fmtLonLat } from "@/lib/mars";
import { loadTerrain, sampleElevation } from "@/lib/terrain";
import { useEffect, useState } from "react";
import { useEvaPlan, useSpaceWeather } from "@/lib/hooks";
import { fmtLst } from "@/lib/eva";
import { SITE } from "@/lib/data";

export function FrameCorners() {
  return (
    <>
      <div className="hud-frame-corner tl no-print" />
      <div className="hud-frame-corner tr no-print" />
      <div className="hud-frame-corner bl no-print" />
      <div className="hud-frame-corner br no-print" />
    </>
  );
}

export function CompassTape() {
  return (
    <div className="no-print pointer-events-none absolute left-1/2 top-[68px] z-[500] -translate-x-1/2">
      <div className="hud-panel flex items-center gap-3 px-3 py-1">
        <span className="hud-label">grid north</span>
        <span className="font-display text-[11px] text-[var(--hud-cyan)]">▲ 000°</span>
        <span className="hud-chip">mars-2000 sphere · lon-lat grid</span>
      </div>
    </div>
  );
}

export function Reticle({ visor }: { visor: boolean }) {
  if (!visor) return null;
  return (
    <div className="no-print pointer-events-none absolute left-1/2 top-1/2 z-[470] -translate-x-1/2 -translate-y-1/2">
      <Crosshair className="h-10 w-10 text-[var(--hud-orange)] opacity-40" />
    </div>
  );
}

export function TopBar() {
  const cursor = useStore((s) => s.cursor);
  const planMode = useStore((s) => s.planMode);
  const setPlanMode = useStore((s) => s.setPlanMode);
  const openPanel = useStore((s) => s.openPanel);
  const visorMode = useStore((s) => s.visorMode);
  const setVisorMode = useStore((s) => s.setVisorMode);
  const mapZoom = useStore((s) => s.mapZoom);
  const site = useStore((s) => s.site);
  const [cursorElev, setCursorElev] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    if (!cursor) {
      Promise.resolve().then(() => {
        if (alive) setCursorElev(null);
      });
      return () => {
        alive = false;
      };
    }
    loadTerrain().then((t) => {
      if (!alive || !cursor) return;
      const e = sampleElevation(t.local, cursor.lon, cursor.lat) ?? sampleElevation(t.regional, cursor.lon, cursor.lat);
      setCursorElev(e);
    });
    return () => {
      alive = false;
    };
  }, [cursor]);

  return (
    <header className="no-print relative z-[520] flex h-14 items-center justify-between gap-2 border-b border-[var(--hud-border-dim)] bg-[rgba(5,8,12,0.92)] px-3 backdrop-blur">
      <div className="flex items-center gap-3 min-w-0">
        <Orbit className="h-6 w-6 shrink-0 text-[var(--hud-orange)]" />
        <div className="min-w-0">
          <div className="font-display truncate text-sm font-bold tracking-[0.22em] text-[var(--hud-amber)] hud-glow">
            ARES-VIS <span className="hidden text-[10px] font-normal tracking-[0.3em] text-[var(--hud-dim)] sm:inline">v2.1</span>
          </div>
          <div className="hud-label truncate">Elysium Marswalk Planner · Sol Operations</div>
        </div>
      </div>

      <div className="hidden items-center gap-4 md:flex">
        <div className="hidden max-w-[210px] xl:block">
          <div className="hud-label">location</div>
          <div className="truncate text-xs text-[var(--hud-amber)] hud-glow" title={`${site.name} · ${fmtLonLat(site.lon, site.lat)}`}>
            <MapPin className="mb-0.5 inline h-3 w-3 text-[var(--hud-cyan)]" /> {site.name}
          </div>
        </div>
        <div className="text-right">
          <div className="hud-label">cursor</div>
          <div className="text-xs text-[var(--hud-cyan)] hud-glow-cyan">
            {cursor ? fmtLonLat(cursor.lon, cursor.lat) : "— move pointer —"}
          </div>
        </div>
        <div className="text-right">
          <div className="hud-label">elev (dem)</div>
          <div className="text-xs text-[var(--hud-cyan)]">
            {cursorElev !== null ? `${cursorElev.toFixed(0)} m` : "—"}
          </div>
        </div>
        <div className="text-right">
          <div className="hud-label">zoom</div>
          <div className="text-xs text-[var(--hud-cyan)]">Z{mapZoom.toFixed(0)}</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          className={`hud-btn ${planMode ? "active blink" : ""}`}
          onClick={() => {
            const next = !planMode;
            setPlanMode(next);
            if (next) openPanel("route");
          }}
          aria-pressed={planMode}
          title="Instant on-board route planning — opens the EVA planner"
        >
          <MapIcon className="h-4 w-4" />
          <span className="hidden sm:inline">{planMode ? "planning · click map" : "plan route"}</span>
        </button>
        {/* F10: visor ↔ map view switch — shared mission state, switch any time */}
        <div className="flex overflow-hidden rounded-sm border border-[var(--hud-border)]" role="group" aria-label="View mode switch">
          <button
            className={`view-seg ${!visorMode ? "view-seg-on" : ""}`}
            onClick={() => visorMode && setVisorMode(false)}
            aria-pressed={!visorMode}
            title="Map View — top-down Mars map with graticule, beacon and layers"
          >
            <MapIcon className="h-4 w-4" />
            <span className="hidden sm:inline">map view</span>
          </button>
          <button
            className={`view-seg ${visorMode ? "view-seg-on" : ""}`}
            onClick={() => { if (!visorMode) setVisorMode(true); }}
            aria-pressed={visorMode}
            title="Visor View — first-person astronaut perspective (prefs inside)"
          >
            <Radar className={`h-4 w-4 ${visorMode ? "animate-pulse" : ""}`} />
            <span className="hidden sm:inline">visor view</span>
          </button>
        </div>
      </div>
    </header>
  );
}

export function StatusBar() {
  const { plan } = useEvaPlan();
  const sw = useSpaceWeather();
  const eva = useStore((s) => s.eva);
  const route = useStore((s) => s.route);
  const walk = useStore((s) => s.walk);
  const state = sw?.marsSurface.evaState ?? "…";
  const walking = walk.active && walk.readout;

  return (
    <footer className="no-print relative z-[520] flex min-h-11 flex-wrap items-center justify-between gap-x-5 gap-y-1 border-t border-[var(--hud-border-dim)] bg-[rgba(5,8,12,0.92)] px-4 py-1.5 text-[11px] backdrop-blur">
      {walking && walk.readout && (
        <span className="text-[var(--hud-cyan)]">
          <span className="blink">●</span> WALK <b>{walk.readout.atEnd ? "COMPLETE" : "LIVE"}</b>
          <span className="ml-2">next <b className="text-[var(--hud-amber)]">{route[Math.min(walk.readout.nextIdx, route.length - 1)]?.name}</b> {fmtDist(walk.readout.nextDistM)}</span>
          <span className="ml-2">O₂ supply <b className={walk.readout.o2Pct <= 20 ? "text-[var(--hud-red)]" : walk.readout.o2Pct <= 50 ? "text-[var(--hud-amber)]" : "text-[var(--hud-green)]"}>{walk.readout.o2Pct.toFixed(0)}%</b></span>
        </span>
      )}
      {!walking && (
        <span className="text-[var(--hud-dim)]">
          ROUTE <b className="text-[var(--hud-amber)]">{route.length} wp</b>
        </span>
      )}
      <span className="text-[var(--hud-dim)]">
        DIST <b className="text-[var(--hud-amber)]">{(plan.totalDistM / 1000).toFixed(2)} km</b>
      </span>
      <span className="text-[var(--hud-dim)]">
        EVA <b className="text-[var(--hud-amber)]">{plan.totalTimeH.toFixed(2)} h</b>
        <span className="ml-2">LST end <b className="text-[var(--hud-cyan)]">{route.length > 1 ? fmtLst(plan.lstEnd) : "—"}</b></span>
      </span>
      <span className="text-[var(--hud-dim)]">
        O₂ <b className={plan.o2UsedPct > 65 ? "text-[var(--hud-red)]" : "text-[var(--hud-green)]"}>
          {plan.o2UsedPct > 0 ? `${plan.o2UsedPct.toFixed(0)}%` : "0%"}
        </b>
        <span className="ml-2">crew <b className="text-[var(--hud-cyan)]"><User className="mb-0.5 inline h-3 w-3" />{eva.crew}</b></span>
      </span>
      <span className="text-[var(--hud-dim)]">
        DOSE <b className="text-[var(--hud-amber)]">{plan.doseMsv > 0 ? `${plan.doseMsv.toFixed(3)} mSv` : "—"}</b>
      </span>
      <span className="text-[var(--hud-dim)]">
        SPACE WX{" "}
        <b className={`blink ${state === "NOMINAL" ? "text-[var(--hud-green)]" : state === "ELEVATED" ? "text-[var(--hud-amber)]" : state === "…" ? "" : "text-[var(--hud-red)]"}`}>
          {state.replace("_", " ")}
        </b>
      </span>
      <span className="hidden text-[var(--hud-dim)] lg:inline">
        EARTH-MARS <b className="text-[var(--hud-cyan)]">{sw ? `${(sw.earthMars.lightMin).toFixed(1)} light-min` : "…"}</b>
      </span>
    </footer>
  );
}

export function IconRail() {
  const activePanel = useStore((s) => s.activePanel);
  const openPanel = useStore((s) => s.openPanel);
  const commsOpen = useStore((s) => s.comms.open);
  const setCommsOpen = useStore((s) => s.setCommsOpen);
  const items = [
    { id: "layers", icon: Layers, label: "Layers" },
    { id: "route", icon: MapIcon, label: "Route" },
    { id: "locations", icon: MapPin, label: "Locations" },
    { id: "science", icon: FlaskConical, label: "Science" },
    { id: "conditions", icon: Gauge, label: "Conditions" },
    { id: "catalog", icon: Database, label: "Catalog" },
    { id: "nasa", icon: Satellite, label: "NASA" },
    { id: "brief", icon: Printer, label: "Brief" },
  ] as const;
  return (
    <nav className="no-print relative z-[520] flex w-14 shrink-0 flex-col items-center gap-1 border-r border-[var(--hud-border-dim)] bg-[rgba(5,8,12,0.92)] py-3 backdrop-blur" aria-label="Planner panels">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => openPanel(activePanel === it.id ? null : it.id)}
          className={`group flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-sm border transition-all ${
            activePanel === it.id
              ? "border-[var(--hud-orange)] bg-[rgba(255,122,47,0.18)] text-[var(--hud-amber)]"
              : "border-transparent text-[var(--hud-dim)] hover:border-[var(--hud-border-dim)] hover:text-[var(--hud-amber)]"
          }`}
          aria-label={it.label}
          title={it.label}
        >
          <it.icon className="h-5 w-5" />
          <span className="text-[8px] tracking-[0.2em] uppercase">{it.label}</span>
        </button>
        ))}
        <button
          onClick={() => setCommsOpen(!commsOpen)}
          className={`group flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-sm border transition-all ${
            commsOpen
              ? "border-[var(--hud-orange)] bg-[rgba(255,122,47,0.18)] text-[var(--hud-amber)]"
              : "border-transparent text-[var(--hud-dim)] hover:border-[var(--hud-border-dim)] hover:text-[var(--hud-amber)]"
          }`}
          aria-label="Comms console"
          title="Comms console — Mission Control link"
        >
          <Radio className="h-5 w-5" />
          <span className="text-[8px] tracking-[0.2em] uppercase">Comms</span>
        </button>
      <div className="mt-auto text-center">
        <Users className="mx-auto h-4 w-4 text-[var(--hud-dim)]" />
        <div className="hud-label mt-1 text-[8px]">crew eva</div>
      </div>
    </nav>
  );
}

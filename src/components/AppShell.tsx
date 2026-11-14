"use client";
import dynamic from "next/dynamic";
import { AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { Orbit } from "lucide-react";
import { FrameCorners, CompassTape, TopBar, StatusBar, IconRail } from "@/components/hud/Chrome";
import { VisorOverlay } from "@/components/hud/Visor";
import { BootOverlay } from "@/components/hud/BootOverlay";
import { CommsEngine, CommsPanel } from "@/components/hud/Comms";
import { CriticalAlerts, HazardBanner } from "@/components/hud/Alerts";
import { LayersPanel } from "@/components/panels/LayersPanel";
import { RoutePanel } from "@/components/panels/RoutePanel";
import { SciencePanel } from "@/components/panels/SciencePanel";
import { ConditionsPanel } from "@/components/panels/ConditionsPanel";
import { CatalogPanel } from "@/components/panels/CatalogPanel";
import { NasaPanel } from "@/components/panels/NasaPanel";
import { BriefPanel } from "@/components/panels/BriefPanel";
import { LocationsPanel } from "@/components/panels/LocationsPanel";
import { useStore } from "@/lib/store";

const MapCanvas = dynamic(() => import("@/components/map/MapCanvas"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-[#03050a]">
      <div className="text-center">
        <div className="font-display animate-pulse text-sm tracking-[0.3em] text-[var(--hud-amber)]">ACQUIRING MARS BASEMAP…</div>
        <div className="hud-label mt-2">usgs onmars tiles · ctx mosaic</div>
      </div>
    </div>
  ),
});

export function AppShell() {
  const visorMode = useStore((s) => s.visorMode);
  const planMode = useStore((s) => s.planMode);
  const [mounted, setMounted] = useState(false);  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (!mounted) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center" style={{ background: "var(--hud-bg)" }}>
        <div className="flex items-center gap-3 opacity-80">
          <Orbit className="h-8 w-8 animate-pulse text-[var(--hud-orange)]" />
          <span className="font-display text-sm tracking-[0.3em] text-[var(--hud-amber)]">ARES-VIS · BOOTING</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden select-none" style={{ background: "var(--hud-bg)" }}>
      <TopBar />
      <div className="relative flex min-h-0 flex-1">
        {(!visorMode) && <IconRail />}
        <main className="relative min-w-0 flex-1 overflow-hidden" aria-label="Mars map display">
          <MapCanvas />
          <div className="vignette" />
          <div className="scanlines" />
          <div className="sweep" />
          {(!visorMode) && <CompassTape />}
          {(!visorMode) && <FrameCorners />}
          {visorMode && (
            <div className="absolute inset-0 z-[460]" aria-label="Helmet visor display">
              <VisorOverlay />
            </div>
          )}
          {planMode && (
            <div className="no-print pointer-events-none absolute bottom-16 left-1/2 z-[500] -translate-x-1/2">
              <span className="hud-chip !border-[rgba(255,122,47,0.6)] !text-[var(--hud-amber)] blink">plan mode · click map to drop waypoints</span>
            </div>
          )}
          <AnimatePresence>
            <LayersPanel key="layers" />
            <RoutePanel key="route" />
            <LocationsPanel key="locations" />
            <SciencePanel key="science" />
            <ConditionsPanel key="conditions" />
            <CatalogPanel key="catalog" />
            <NasaPanel key="nasa" />
            <BriefPanel key="brief" />
          </AnimatePresence>
          {/* working comms link — runs in both views (F3) */}
          <CommsEngine />
          <CommsPanel inVisor={visorMode} />
          {/* mission-control critical warnings + hazard drill banner (both views) */}
          <CriticalAlerts />
          <HazardBanner />
        </main>
      </div>
      <StatusBar />
      <BootOverlay />
    </div>
  );
}

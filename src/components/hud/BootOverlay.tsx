"use client";
import { Orbit, ChevronRight } from "lucide-react";
import { useStore } from "@/lib/store";
import { motion } from "framer-motion";

const FEATURES = [
  ["6 data kinds fused", "optical · topographic · thermal · atmospheric · geophysical · radiation — layered over one Mars map"],
  ["Safety-first planning", "slope hazards from real DEM, O₂ budget & turnaround rules, live space-weather GO/NO-GO"],
  ["Real NASA missions", "MRO CTX · Viking · MGS MOLA · Mars Express HRSC · Odyssey THEMIS · InSight SEIS/APSS · MSL RAD"],
  ["Modular by design", "plug any future XYZ/WMTS/GeoJSON API into the layer registry at runtime"],
];

export function BootOverlay() {
  const bootDone = useStore((s) => s.bootDone);
  const setBootDone = useStore((s) => s.setBootDone);
  if (bootDone) return null;
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[900] flex items-center justify-center overflow-y-auto bg-[#03050a] p-4"
      role="dialog"
      aria-label="Mission briefing"
    >
      <div className="sweep" />
      <div className="boot-flicker my-auto w-full max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <Orbit className="h-10 w-10 text-[var(--hud-orange)] hud-glow" />
          <div>
            <h1 className="font-display text-2xl font-bold tracking-[0.28em] text-[var(--hud-amber)] hud-glow">ARES-VIS</h1>
            <p className="hud-label">interplanetary survival guide · martian map · nasa space apps 2026</p>
          </div>
        </div>
        <p className="mb-6 text-sm leading-relaxed text-[var(--hud-text)]">
          The first astronauts on Mars will want the best map possible. This visor display fuses decades of robotic
          Mars-mission data into one hyper-local planning tool for a Marswalk across <b className="text-[var(--hud-amber)]">Elysium
          Planitia</b> — the plains where InSight listened to Mars quake for four years.
        </p>
        <ul className="mb-8 space-y-2.5">
          {FEATURES.map(([t, d]) => (
            <li key={t} className="flex items-start gap-3 rounded-sm border border-[var(--hud-border-dim)] bg-[rgba(9,13,19,0.8)] p-3">
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--hud-cyan)]" />
              <div>
                <b className="text-[13px] text-[var(--hud-amber)]">{t}</b>
                <p className="text-[11px] leading-relaxed text-[var(--hud-dim)]">{d}</p>
              </div>
            </li>
          ))}
        </ul>
        <button className="hud-btn active w-full py-3 text-sm" onClick={() => setBootDone(true)}>
          ▸ enter visor display
        </button>
        <p className="mt-3 text-center text-[10px] text-[var(--hud-dim)]">
          Preloaded: MARSWALK-01 science route from Homestead Hollow. Live tiles stream from USGS Astrogeology.
        </p>
      </div>
    </motion.div>
  );
}

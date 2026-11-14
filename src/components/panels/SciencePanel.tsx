"use client";
import { Crosshair, TriangleAlert } from "lucide-react";
import { POIS, QUAKES, GEOLOGY } from "@/lib/data";
import { useStore } from "@/lib/store";
import { PanelFrame } from "./PanelFrame";

export function SciencePanel() {
  const addWaypoint = useStore((s) => s.addWaypoint);
  const route = useStore((s) => s.route);
  const focus = useStore((s) => s.focus);
  const toggleLayer = useStore((s) => s.toggleLayer);
  const layers = useStore((s) => s.layers);

  const addToRoute = (poi: (typeof POIS)[number]) => {
    if (route.some((w) => w.poiId === poi.id)) return;
    addWaypoint({
      id: `wp-${Date.now()}`,
      name: poi.code,
      lon: poi.lon,
      lat: poi.lat,
      poiId: poi.id,
      elevM: poi.elevM,
      slopeDeg: poi.slopeDeg,
    });
    focus(poi.lon, poi.lat);
  };

  const quakesOn = layers.find((l) => l.def.id === "quakes")?.visible;
  const geoOn = layers.find((l) => l.def.id === "geology")?.visible;

  return (
    <PanelFrame id="science" title="SCIENCE TARGETS" subtitle="marswalk-01 · new science along the way">
      <div className="space-y-3">
        <p className="text-[11px] leading-relaxed text-[var(--hud-dim)]">
          Targets selected around the InSight landing site (Elysium Planitia). Terrain values are sampled from the
          HRSC-MOLA blended DEM. Add targets to build the EVA route.
        </p>
        {POIS.map((p) => {
          const added = route.some((w) => w.poiId === p.id);
          return (
            <article key={p.id} className="rounded-sm border border-[var(--hud-border-dim)] bg-[rgba(10,15,22,0.6)]">
              {p.pov && (
                <div className="relative h-28 w-full overflow-hidden border-b border-[var(--hud-border-dim)]">
                  <img src={p.pov} alt={`${p.name} — surface view`} className="h-full w-full object-cover opacity-90" loading="lazy" />
                  <span className="absolute bottom-1 right-1 bg-black/70 px-1.5 py-0.5 text-[8px] tracking-wider text-[var(--hud-dim)]">
                    POV · {p.povCredit}
                  </span>
                </div>
              )}
              <div className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-xs font-bold tracking-wider text-[var(--hud-amber)]">
                    {p.code} · {p.name}
                  </h3>
                  <span className={`hud-chip shrink-0 ${p.type === "hazard" ? "!text-[var(--hud-red)] !border-[rgba(248,113,113,0.4)]" : p.type === "base" ? "!text-[var(--hud-green)]" : ""}`}>
                    {p.type}
                  </span>
                </div>
                <div className="hud-label mt-1">
                  {p.lat.toFixed(4)}°N {p.lon.toFixed(4)}°E · elev {p.elevM} m · slope {p.slopeDeg}°
                  {p.durationMin > 0 && ` · ~${p.durationMin} min ops`}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-[var(--hud-text)]">{p.objective}</p>
                <p className="mt-1.5 text-[10px] text-[var(--hud-cyan)]">▸ {p.activity}</p>
                <p className="mt-1 flex items-start gap-1 text-[10px] text-[var(--hud-dim)]">
                  <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-[var(--hud-amber)]" />
                  {p.hazard}
                </p>
                <div className="mt-2.5 flex gap-2">
                  <button className={`hud-btn flex-1 ${added ? "active" : ""}`} onClick={() => addToRoute(p)} disabled={added || p.type === "base"}>
                    {p.type === "base" ? "evа start" : added ? "in route" : "add to route"}
                  </button>
                  <button className="hud-btn" onClick={() => focus(p.lon, p.lat, 15)} aria-label={`Zoom to ${p.code}`}>
                    <Crosshair className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </article>
          );
        })}

        {/* geophysics context */}
        <section className="rounded-sm border border-[var(--hud-border-dim)] bg-[rgba(10,15,22,0.6)] p-3 text-[11px]">
          <h3 className="hud-label mb-2 text-[var(--hud-orange)]">geophysical context (insight)</h3>
          <div className="flex flex-wrap gap-2">
            <button className={`hud-btn !min-h-0 !px-2 !py-1 ${quakesOn ? "active" : ""}`} onClick={() => toggleLayer("quakes")}>
              seismicity {quakesOn ? "on" : "off"}
            </button>
            <button className={`hud-btn !min-h-0 !px-2 !py-1 ${geoOn ? "active" : ""}`} onClick={() => toggleLayer("geology")}>
              geology {geoOn ? "on" : "off"}
            </button>
          </div>
          <p className="mt-2 leading-relaxed text-[var(--hud-dim)]">{QUAKES.note}</p>
          <ul className="mt-2 space-y-1">
            {GEOLOGY.features.map((f) => (
              <li key={f.name} className="flex items-center gap-2">
                <span className="inline-block h-2 w-4 rounded-sm" style={{ background: f.color }} />
                <span className="text-[var(--hud-text)]">{f.name}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] leading-snug text-[var(--hud-dim)]">{GEOLOGY.note}</p>
        </section>
      </div>
    </PanelFrame>
  );
}

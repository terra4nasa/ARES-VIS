"use client";
import { ArrowDown, ArrowUp, MapPin, Trash2, TriangleAlert, CircleCheck, Footprints, Wand2, Undo2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { useEvaPlan } from "@/lib/hooks";
import { PanelFrame } from "./PanelFrame";
import { Slider } from "@/components/ui/slider";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { fmtLst } from "@/lib/eva";
import { fmtDist } from "@/lib/mars";

export function RoutePanel() {
  const route = useStore((s) => s.route);
  const eva = useStore((s) => s.eva);
  const setEva = useStore((s) => s.setEva);
  const removeWaypoint = useStore((s) => s.removeWaypoint);
  const moveWaypoint = useStore((s) => s.moveWaypoint);
  const clearRoute = useStore((s) => s.clearRoute);
  const setPlanMode = useStore((s) => s.setPlanMode);
  const planMode = useStore((s) => s.planMode);
  const autoChainSites = useStore((s) => s.autoChainSites);
  const appendReturnToBase = useStore((s) => s.appendReturnToBase);
  const startWalk = useStore((s) => s.startWalk);
  const { plan, profile, solveMs } = useEvaPlan();

  const chartData = profile.map((p) => ({
    km: +(p.dist / 1000).toFixed(2),
    elev: Math.round(p.elev),
    slope: +p.slope.toFixed(1),
  }));

  return (
    <PanelFrame id="route" title="MARSWALK ROUTE" subtitle="eva planner · on-board solve — instant">
      <div className="space-y-4">
        {/* quick actions */}
        <section className="rounded-sm border border-[rgba(255,122,47,0.35)] bg-[rgba(255,122,47,0.05)] p-3">
          <h3 className="hud-label mb-2 text-[var(--hud-orange)]">quick plan — one click, &lt;10 ms</h3>
          <div className="grid grid-cols-2 gap-2">
            <button className="hud-btn !min-h-0 flex-col !gap-1 !py-2" onClick={() => autoChainSites(true)} title="Nearest-neighbour chain through every science site, out and back">
              <Wand2 className="h-4 w-4" />
              <span className="text-[9px]">chain all sites</span>
            </button>
            <button className="hud-btn !min-h-0 flex-col !gap-1 !py-2" onClick={appendReturnToBase} disabled={route.length === 0} title="Append BASE-01 as the final waypoint">
              <Undo2 className="h-4 w-4" />
              <span className="text-[9px]">return to base</span>
            </button>
          </div>
          <button className="hud-btn active mt-2 w-full !py-2.5" disabled={route.length < 2} onClick={() => startWalk()} title="Walk the route in the helmet visor with live telemetry">
            <Footprints className="h-4 w-4" /> walk this route (visor)
          </button>
          <p className="mt-2 text-[9px] leading-relaxed text-[var(--hud-dim)]">
            Solving is on-board: DEM terrain sampling + EVA model run in the browser — no server round-trip. Last solve: <b className="text-[var(--hud-cyan)]">{solveMs.toFixed(1)} ms</b>.
          </p>
        </section>

        {/* EVA params */}
        <section className="rounded-sm border border-[var(--hud-border-dim)] bg-[rgba(10,15,22,0.6)] p-3">
          <h3 className="hud-label mb-3 text-[var(--hud-orange)]">eva parameters</h3>
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex justify-between text-[11px]">
                <span className="hud-label">crew size</span>
                <span className="text-[var(--hud-cyan)]">{eva.crew} astronauts</span>
              </div>
              <Slider value={[eva.crew]} min={1} max={4} step={1} onValueChange={(v) => setEva({ crew: v[0] })} aria-label="Crew size" />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[11px]">
                <span className="hud-label">base walk speed (suited)</span>
                <span className="text-[var(--hud-cyan)]">{eva.speedKmh.toFixed(1)} km/h</span>
              </div>
              <Slider value={[eva.speedKmh]} min={1.5} max={4} step={0.1} onValueChange={(v) => setEva({ speedKmh: v[0] })} aria-label="Walk speed" />
              <p className="mt-1 text-[10px] leading-tight text-[var(--hud-dim)]">avg human walking pace ≈ 4.8 km/h · suited EVA 1.5–4.0 (default 2.6)</p>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[11px]">
                <span className="hud-label">suit endurance (O₂)</span>
                <span className="text-[var(--hud-cyan)]">{eva.suitHours} h</span>
              </div>
              <Slider value={[eva.suitHours]} min={4} max={10} step={0.5} onValueChange={(v) => setEva({ suitHours: v[0] })} aria-label="Suit endurance" />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[11px]">
                <span className="hud-label">eva start (local solar time)</span>
                <span className="text-[var(--hud-cyan)]">{fmtLst(eva.startLst)}</span>
              </div>
              <Slider value={[eva.startLst]} min={6} max={18} step={0.25} onValueChange={(v) => setEva({ startLst: v[0] })} aria-label="EVA start time" />
            </div>
          </div>
        </section>

        {/* Metrics */}
        <section className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-sm border border-[var(--hud-border-dim)] p-2.5">
            <div className="hud-label">total distance</div>
            <div className="font-display mt-1 text-lg text-[var(--hud-amber)]">{(plan.totalDistM / 1000).toFixed(2)} km</div>
          </div>
          <div className="rounded-sm border border-[var(--hud-border-dim)] p-2.5">
            <div className="hud-label">eva duration</div>
            <div className="font-display mt-1 text-lg text-[var(--hud-amber)]">{plan.totalTimeH.toFixed(2)} h</div>
          </div>
          <div className="rounded-sm border border-[var(--hud-border-dim)] p-2.5">
            <div className="hud-label">o₂ consumed</div>
            <div className={`font-display mt-1 text-lg ${plan.o2UsedPct > 65 ? "text-[var(--hud-red)]" : "text-[var(--hud-green)]"}`}>
              {plan.o2UsedPct.toFixed(0)}%
            </div>
          </div>
          <div className="rounded-sm border border-[var(--hud-border-dim)] p-2.5">
            <div className="hud-label">radiation dose</div>
            <div className="font-display mt-1 text-lg text-[var(--hud-amber)]">{plan.doseMsv > 0 ? `${plan.doseMsv.toFixed(3)} mSv` : "—"}</div>
          </div>
        </section>

        {plan.warnings.length > 0 && (
          <section className="space-y-1.5">
            {plan.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 rounded-sm border border-[rgba(248,113,113,0.4)] bg-[rgba(248,113,113,0.07)] p-2 text-[11px] text-[var(--hud-red)]">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{w}</span>
              </div>
            ))}
          </section>
        )}
        {plan.ok && (
          <div className="flex items-center gap-2 rounded-sm border border-[rgba(74,222,128,0.4)] bg-[rgba(74,222,128,0.07)] p-2 text-[11px] text-[var(--hud-green)]">
            <CircleCheck className="h-4 w-4 shrink-0" />
            <span>EVA plan within safety margins — GO for Marswalk.</span>
          </div>
        )}

        {/* Elevation profile */}
        {chartData.length > 2 && (
          <section className="rounded-sm border border-[var(--hud-border-dim)] bg-[rgba(10,15,22,0.6)] p-3">
            <h3 className="hud-label mb-2 text-[var(--hud-orange)]">elevation profile (hrsc-mola dem)</h3>
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ff7a2f" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="#ff7a2f" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="km" tick={{ fill: "#7c8b99", fontSize: 9 }} tickLine={false} axisLine={{ stroke: "#233042" }} />
                  <YAxis tick={{ fill: "#7c8b99", fontSize: 9 }} tickLine={false} axisLine={{ stroke: "#233042" }} domain={["dataMin - 20", "dataMax + 20"]} />
                  <Tooltip
                    contentStyle={{ background: "rgba(8,12,18,0.95)", border: "1px solid rgba(255,122,47,0.4)", fontSize: 11, fontFamily: "Share Tech Mono" }}
                    labelFormatter={(v) => `km ${v}`}
                    formatter={(v: number | string) => [`${v}`, "elev (m)"]}
                  />
                  <Area type="monotone" dataKey="elev" stroke="#ffb347" strokeWidth={1.5} fill="url(#elevGrad)" />
                  {route.slice(1).map((w, i) => {
                    const d = profile.find((p) => p.lon === w.lon && p.lat === w.lat);
                    return d ? <ReferenceLine key={i} x={+(d.dist / 1000).toFixed(2)} stroke="#54e0ff" strokeDasharray="3 3" /> : null;
                  })}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* Legs */}
        {plan.legs.length > 0 && (
          <section className="rounded-sm border border-[var(--hud-border-dim)] p-3">
            <h3 className="hud-label mb-2 text-[var(--hud-orange)]">legs</h3>
            <div className="space-y-1.5 text-[11px]">
              {plan.legs.map((l, i) => (
                <div key={i} className="flex items-center justify-between gap-2 border-b border-[rgba(255,255,255,0.04)] pb-1.5">
                  <span className="text-[var(--hud-text)]">
                    {l.fromIdx + 1}→{l.toIdx + 1} <span className="text-[var(--hud-dim)]">{fmtDist(l.distM)}</span>
                  </span>
                  <span className="text-[var(--hud-dim)]">
                    slope {l.slopeMax.toFixed(1)}° · {l.timeH.toFixed(2)} h · arr {fmtLst(l.lstArrive)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Waypoints */}
        <section className="rounded-sm border border-[var(--hud-border-dim)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="hud-label text-[var(--hud-orange)]">waypoints ({route.length})</h3>
            <div className="flex gap-2">
              <button className={`hud-btn !min-h-0 !px-2 !py-1 ${planMode ? "active" : ""}`} onClick={() => setPlanMode(!planMode)}>
                <MapPin className="h-3.5 w-3.5" /> {planMode ? "clicking…" : "add by click"}
              </button>
              <button className="hud-btn !min-h-0 !px-2 !py-1" onClick={clearRoute}>clear</button>
            </div>
          </div>
          {planMode && <p className="mb-2 text-[10px] text-[var(--hud-cyan)]">Click the map to drop waypoints · drag any marker to fine-tune — the plan recomputes instantly.</p>}
          <ul className="space-y-1.5">
            {route.map((w, i) => (
              <li key={w.id} className="flex items-center gap-2 rounded-sm border border-[rgba(255,255,255,0.06)] px-2 py-1.5 text-[11px]">
                <span className={`font-display w-6 text-center ${i === 0 ? "text-[var(--hud-green)]" : "text-[var(--hud-amber)]"}`}>{i === 0 ? "⌂" : i}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[var(--hud-text)]">{w.name}</div>
                  <div className="hud-label truncate">
                    {w.lat.toFixed(4)}°N {w.lon.toFixed(4)}°E{w.elevM !== undefined ? ` · ${w.elevM} m` : ""}
                  </div>
                </div>
                <button className="text-[var(--hud-dim)] hover:text-[var(--hud-amber)] disabled:opacity-30" onClick={() => moveWaypoint(w.id, -1)} disabled={i === 0} aria-label="Move up">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button className="text-[var(--hud-dim)] hover:text-[var(--hud-amber)] disabled:opacity-30" onClick={() => moveWaypoint(w.id, 1)} disabled={i === route.length - 1} aria-label="Move down">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button className="text-[var(--hud-red)]" onClick={() => removeWaypoint(w.id)} aria-label="Remove waypoint">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
            {route.length === 0 && (
              <li className="rounded-sm border border-dashed border-[var(--hud-border-dim)] p-3 text-center text-[11px] text-[var(--hud-dim)]">
                Empty route — add science targets from the SCIENCE panel or click the map.
              </li>
            )}
          </ul>
        </section>
      </div>
    </PanelFrame>
  );
}

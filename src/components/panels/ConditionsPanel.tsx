"use client";
import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PanelFrame } from "./PanelFrame";
import { WEATHER, COMMS, RADIATION } from "@/lib/data";
import { useEvaPlan, useSpaceWeather } from "@/lib/hooks";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useStore } from "@/lib/store";
import { fmtLst } from "@/lib/eva";
import { Radio, Wind, Activity, Satellite } from "lucide-react";

export function ConditionsPanel() {
  const sw = useSpaceWeather();
  const { plan } = useEvaPlan();
  const eva = useStore((s) => s.eva);
  const route = useStore((s) => s.route);

  const data = WEATHER.hours.map((h, i) => ({
    lst: h,
    air: WEATHER.airTemp[i],
    ground: WEATHER.groundTemp[i],
    pressure: WEATHER.pressure[i],
  }));

  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () => setNow(new Date().toISOString().slice(11, 19) + " UTC");
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const state = sw?.marsSurface.evaState ?? "…";
  const stateColor = state === "NOMINAL" ? "var(--hud-green)" : state === "ELEVATED" ? "var(--hud-amber)" : "var(--hud-red)";

  return (
    <PanelFrame id="conditions" title="SURFACE CONDITIONS" subtitle="weather · radiation · comms">
      <Tabs defaultValue="weather" className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-transparent">
          <TabsTrigger value="weather" className="data-[state=active]:text-[var(--hud-amber)]"><Wind className="mb-0.5 inline h-3.5 w-3.5" /> WX</TabsTrigger>
          <TabsTrigger value="radiation" className="data-[state=active]:text-[var(--hud-amber)]"><Activity className="mb-0.5 inline h-3.5 w-3.5" /> RAD</TabsTrigger>
          <TabsTrigger value="comms" className="data-[state=active]:text-[var(--hud-amber)]"><Radio className="mb-0.5 inline h-3.5 w-3.5" /> COMMS</TabsTrigger>
        </TabsList>

        <TabsContent value="weather" className="mt-3 space-y-3">
          <div className="rounded-sm border border-[var(--hud-border-dim)] bg-[rgba(10,15,22,0.6)] p-3">
            <h3 className="hud-label mb-2 text-[var(--hud-orange)]">diurnal cycle · homestead hollow</h3>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 5, right: 8, bottom: 0, left: -22 }}>
                  <XAxis dataKey="lst" tick={{ fill: "#7c8b99", fontSize: 9 }} tickLine={false} axisLine={{ stroke: "#233042" }} />
                  <YAxis tick={{ fill: "#7c8b99", fontSize: 9 }} tickLine={false} axisLine={{ stroke: "#233042" }} />
                  <Tooltip
                    contentStyle={{ background: "rgba(8,12,18,0.95)", border: "1px solid rgba(255,122,47,0.4)", fontSize: 11, fontFamily: "Share Tech Mono" }}
                    labelFormatter={(v) => `LST ${fmtLst(Number(v))}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="air" name="air °C" stroke="#54e0ff" dot={false} strokeWidth={1.5} />
                  <Line type="monotone" dataKey="ground" name="ground °C" stroke="#ff7a2f" dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
              <span className="hud-chip">dust τ ≈ {WEATHER.dustTau}</span>
              <span className="hud-chip">solar max ≈ {WEATHER.solarMaxWm2} W/m²</span>
              {route.length > 1 && (
                <span className="hud-chip !border-[rgba(84,224,255,0.4)] !text-[var(--hud-cyan)]">
                  eva window {fmtLst(eva.startLst)} → {fmtLst(plan.lstEnd)}
                </span>
              )}
            </div>
          </div>
          <p className="text-[10px] leading-snug text-[var(--hud-dim)]">{WEATHER.note}</p>
          <div className="rounded-sm border border-[var(--hud-border-dim)] p-3 text-[11px] leading-relaxed">
            <b className="text-[var(--hud-amber)]">EVA guidance:</b> plan surface ops between 08:00–16:00 LST for maximum
            solar heating (ground above −40 °C) and visibility. Pre-dawn ground temperature (−90 °C) challenges suit
            seals and traction on frost-like CO₂-free regolith — no light for solar recharge after 17:00 LST.
          </div>
        </TabsContent>

        <TabsContent value="radiation" className="mt-3 space-y-3">
          <div className="rounded-sm border border-[var(--hud-border-dim)] bg-[rgba(10,15,22,0.6)] p-3 text-[11px]">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="hud-label text-[var(--hud-orange)]">live space weather</h3>
              <span className="hud-chip blink" style={{ color: stateColor, borderColor: stateColor }}>{state.replace("_", " ")}</span>
            </div>
            <div className="text-[10px] text-[var(--hud-dim)]">{now} · source: NOAA SWPC + /api/spaceweather model</div>
            <dl className="mt-3 grid grid-cols-2 gap-2">
              <div className="border border-[rgba(255,255,255,0.06)] p-2">
                <dt className="hud-label">f10.7 solar flux</dt>
                <dd className="text-[var(--hud-cyan)]">{sw ? `${sw.f107} sfu` : "…"} {sw && !sw.live.f107 && "(cached)"}</dd>
              </div>
              <div className="border border-[rgba(255,255,255,0.06)] p-2">
                <dt className="hud-label">kp index</dt>
                <dd className="text-[var(--hud-cyan)]">{sw ? sw.kp.toFixed(1) : "…"}</dd>
              </div>
              <div className="border border-[rgba(255,255,255,0.06)] p-2">
                <dt className="hud-label">≥10 mev protons</dt>
                <dd className="text-[var(--hud-cyan)]">{sw ? `${sw.proton10MeV.toFixed(2)} pfu` : "…"}</dd>
              </div>
              <div className="border border-[rgba(255,255,255,0.06)] p-2">
                <dt className="hud-label">≥100 mev protons</dt>
                <dd className="text-[var(--hud-cyan)]">{sw ? `${sw.proton100MeV.toFixed(3)} pfu` : "…"}</dd>
              </div>
              <div className="border border-[rgba(255,255,255,0.06)] p-2">
                <dt className="hud-label">gcr dose / sol</dt>
                <dd className="text-[var(--hud-amber)]">{sw ? `${sw.marsSurface.gcrDosePerSol.toFixed(2)} mSv` : "…"}</dd>
              </div>
              <div className="border border-[rgba(255,255,255,0.06)] p-2">
                <dt className="hud-label">this eva dose</dt>
                <dd className="text-[var(--hud-amber)]">{plan.doseMsv > 0 ? `${plan.doseMsv.toFixed(3)} mSv` : "—"}</dd>
              </div>
            </dl>
            {sw && (
              <p className="mt-2 text-[10px] leading-snug text-[var(--hud-dim)]">
                Earth–Mars one-way light time right now: <b className="text-[var(--hud-cyan)]">{sw.earthMars.lightMin.toFixed(1)} min</b>{" "}
                ({(sw.earthMars.km / 1e6).toFixed(1)} M km) — computed from Keplerian orbits at {new Date(sw.ts).toISOString().slice(0, 16).replace("T", " ")} UTC.
              </p>
            )}
          </div>
          <p className="text-[10px] leading-snug text-[var(--hud-dim)]">{RADIATION.note}</p>
          {state === "SPE_POSTPONE" && (
            <div className="rounded-sm border border-[rgba(248,113,113,0.5)] bg-[rgba(248,113,113,0.08)] p-2.5 text-[11px] text-[var(--hud-red)]">
              Solar particle event in progress — postpone all EVAs. Seek habitat shielding; monitor NOAA SWPC S-scale.
            </div>
          )}
        </TabsContent>

        <TabsContent value="comms" className="mt-3 space-y-3">
          <div className="rounded-sm border border-[var(--hud-border-dim)] bg-[rgba(10,15,22,0.6)] p-3 text-[11px]">
            <h3 className="hud-label mb-2 flex items-center gap-1.5 text-[var(--hud-orange)]">
              <Satellite className="h-3.5 w-3.5" /> uhf relay passes (illustrative pattern)
            </h3>
            {COMMS.passPattern.map((t) => (
              <div key={t} className="flex items-center justify-between border-b border-[rgba(255,255,255,0.05)] py-1.5">
                <span className="text-[var(--hud-text)]">pass @ LST {fmtLst(t)}</span>
                <span className="text-[var(--hud-dim)]">~10 min window · MRO/Odyssey/TGO</span>
              </div>
            ))}
          </div>
          <ul className="space-y-1.5 text-[11px]">
            {COMMS.relays.map((r) => (
              <li key={r.name} className="flex items-center justify-between rounded-sm border border-[var(--hud-border-dim)] px-2.5 py-2">
                <span className="text-[var(--hud-text)]">{r.name}</span>
                <span className="hud-label">{r.band} · {r.dataRate}</span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] leading-snug text-[var(--hud-dim)]">{COMMS.note}</p>
          {sw && (
            <p className="text-[11px] leading-relaxed">
              <b className="text-[var(--hud-amber)]">Direct-to-Earth:</b> one-way light time{" "}
              <b className="text-[var(--hud-cyan)]">{sw.earthMars.lightMin.toFixed(1)} min</b> — voice loops require
              ~{Math.round(sw.earthMars.lightMin * 2)} min round trip. All real-time decisions during the Marswalk are
              local; the plan is uploaded before suit-up.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </PanelFrame>
  );
}

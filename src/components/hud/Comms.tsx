"use client";
/**
 * Working comms link UI + driver.
 *  - CommsEngine: 1 Hz signal/relay model + periodic Mission Control chatter
 *  - CommsPanel:  message log · compose box · link status · signal bars
 * The panel floats above the map (map view) or the HUD dock (visor view);
 * visibility is driven by the `comms.open` store flag (TopBar + dock buttons).
 */
import { useEffect, useRef, useState } from "react";
import { SendHorizonal, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { chatter, type CommsCtx, type CommsMessage } from "@/lib/comms";
import { useSpaceWeather } from "@/lib/hooks";
import { fmtLonLat } from "@/lib/mars";
import { fmtLst } from "@/lib/eva";
import { locationName } from "@/lib/sites";

/* ---------------- driver: signal model + chatter ---------------- */

export function CommsEngine() {
  const sw = useSpaceWeather();
  const latency = sw?.earthMars.lightMin ?? null;

  useEffect(() => {
    const tick = setInterval(() => useStore.getState().tickComms(latency ?? undefined), 1000);
    return () => clearInterval(tick);
  }, [latency]);

  useEffect(() => {
    let alive = true;
    let to: ReturnType<typeof setTimeout> | null = null;
    const loop = () => {
      if (!alive) return;
      to = setTimeout(() => {
        if (!alive) return;
        const s = useStore.getState();
        const r = s.walk.readout;
        const route = s.route;
        const next = route[Math.min(r?.nextIdx ?? 1, Math.max(0, route.length - 1))];
        const lon = r?.lon ?? s.site.lon;
        const lat = r?.lat ?? s.site.lat;
        const ctx: CommsCtx = {
          o2Pct: r?.o2Pct ?? 100,
          locName: locationName(lon, lat),
          lon,
          lat,
          elevM: r?.elev ?? s.site.elevM ?? null,
          speedKmh: r?.speedEff ?? s.eva.speedKmh,
          samples: s.collected.length,
          nextName: next?.name ?? "—",
          nextDistM: r?.nextDistM ?? 0,
          bearing: r?.bearing ?? 0,
          etaH: r && r.speedEff > 0.05 ? r.nextDistM / 1000 / r.speedEff : 0,
          lstClock: r ? fmtLst(r.lstNow) : fmtLst(s.eva.startLst),
          elapsedH: r?.elapsedH ?? 0.4,
          signal: s.comms.signal,
          spaceWx: sw?.marsSurface.evaState ?? "NOMINAL",
          lightMin: s.comms.latencyMin,
          walking: !!r,
        };
        s.pushComms("mission", chatter(ctx));
        loop();
      }, 38000 + Math.random() * 34000);
    };
    loop();
    return () => {
      alive = false;
      if (to) clearTimeout(to);
    };
  }, [sw]);

  return null;
}

/* ---------------- shared bits ---------------- */

export function SignalBars({ signal, size = "sm" }: { signal: number; size?: "sm" | "lg" }) {
  const bars = Math.max(1, Math.min(5, Math.ceil(signal / 20)));
  const color = signal >= 60 ? "bg-[var(--hud-green)]" : signal >= 35 ? "bg-[var(--hud-amber)]" : "bg-[var(--hud-red)]";
  const hs = size === "lg" ? ["h-2", "h-3", "h-4", "h-5", "h-6"] : ["h-1", "h-1.5", "h-2", "h-2.5", "h-3"];
  return (
    <span className="inline-flex items-end gap-[2px]" role="img" aria-label={`signal ${signal}%`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={`w-[3px] rounded-sm ${hs[i]} ${i < bars ? color : "bg-[rgba(255,255,255,0.14)]"}`} />
      ))}
    </span>
  );
}

const FROM_META: Record<CommsMessage["from"], { label: string; color: string }> = {
  mission: { label: "MISSION CTRL", color: "var(--hud-cyan)" },
  crew: { label: "EVA-1 · YOU", color: "var(--hud-amber)" },
  system: { label: "SUITE LOG", color: "var(--hud-dim)" },
};

const KIND_BORDER: Record<CommsMessage["kind"], string> = {
  info: "rgba(255,122,47,0.14)",
  warn: "rgba(255,179,71,0.45)",
  alert: "rgba(248,113,113,0.6)",
};

/* ---------------- the floating comms panel ---------------- */

export function CommsPanel({ inVisor }: { inVisor: boolean }) {
  const comms = useStore((s) => s.comms);
  const sendComms = useStore((s) => s.sendComms);
  const setCommsOpen = useStore((s) => s.setCommsOpen);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [comms.messages.length]);

  if (!comms.open) return null;
  const statusColor = comms.status === "ONLINE" ? "var(--hud-green)" : comms.status === "DEGRADED" ? "var(--hud-amber)" : "var(--hud-red)";

  const submit = () => {
    if (!draft.trim()) return;
    sendComms(draft);
    setDraft("");
  };

  return (
    <div
      className={`pointer-events-auto absolute right-2 z-[530] flex w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden rounded-sm border border-[var(--hud-border)] bg-[rgba(5,8,12,0.94)] shadow-[0_0_28px_rgba(0,0,0,0.6)] backdrop-blur-md md:right-3 ${
        inVisor ? "bottom-[calc(274px_+_env(safe-area-inset-bottom))] z-[492]" : "bottom-14"
      }`}
      role="complementary"
      aria-label="Communications"
    >
      {/* link status header */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--hud-border-dim)] px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-display text-[12px] tracking-[0.16em] ${comms.status === "ONLINE" ? "text-[var(--hud-green)]" : "blink"}`} style={{ color: statusColor }}>
              ● {comms.status}
            </span>
            <span className="hud-label">· {comms.relay}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <SignalBars signal={comms.signal} />
            <span className="text-[10px] text-[var(--hud-cyan)]">{comms.signal}%</span>
            <span className="hud-label truncate">RT {(comms.latencyMin * 2).toFixed(1)} min · UHF relay</span>
          </div>
        </div>
        <button className="text-[var(--hud-dim)] hover:text-[var(--hud-amber)]" onClick={() => setCommsOpen(false)} aria-label="Close comms panel">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* message log */}
      <div ref={listRef} className="hud-scroll flex-1 space-y-1.5 overflow-y-auto px-3 py-2" style={{ minHeight: 150, maxHeight: 260 }}>
        {comms.messages.length === 0 && (
          <div className="py-6 text-center text-[11px] text-[var(--hud-dim)]">
            Link open — send a report to Mission Control.
          </div>
        )}
        {comms.messages.map((m) => {
          const meta = FROM_META[m.from];
          return (
            <div key={m.id} className="rounded-sm border px-2 py-1.5" style={{ borderColor: KIND_BORDER[m.kind] }}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-[9px] tracking-[0.18em]" style={{ color: meta.color }}>{meta.label}</span>
                <span className="text-[8px] text-[var(--hud-dim)]">{new Date(m.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              </div>
              <div className={`mt-0.5 whitespace-pre-line text-[11px] leading-snug ${m.from === "system" ? "text-[var(--hud-dim)]" : "text-[var(--hud-text)]"}`}>{m.text}</div>
            </div>
          );
        })}
      </div>

      {/* compose */}
      <div className="flex items-center gap-1.5 border-t border-[var(--hud-border-dim)] p-2">
        <input
          className="hud-input !py-1.5"
          placeholder="message mission control…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          aria-label="Message to mission control"
        />
        <button className="hud-btn active !min-h-0 !px-2.5 !py-2" onClick={submit} disabled={!draft.trim()} title="Send to Mission Control">
          <SendHorizonal className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

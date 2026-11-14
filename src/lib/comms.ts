// Working comms link — UHF orbiter relay model + Mission Control reply engine.
// Pure functions; the zustand store owns state, CommsEngine (React) drives ticks.
import { fmtDist, fmtLonLat } from "./mars";
import { compassPoint } from "./mars";

export interface CommsMessage {
  id: number;
  from: "crew" | "mission" | "system";
  text: string;
  t: number;
  kind: "info" | "warn" | "alert";
}

export interface CommsCtx {
  o2Pct: number;
  locName: string;
  lon: number;
  lat: number;
  elevM: number | null;
  speedKmh: number;
  samples: number;
  nextName: string;
  nextDistM: number;
  bearing: number;
  etaH: number;
  lstClock: string;
  elapsedH: number;
  signal: number;
  spaceWx: string;
  lightMin: number;
  walking: boolean;
}

const cTo = compassPoint;

/** One simulated downlink/uplink exchange — contextual Mission Control reply. */
export function missionReply(query: string, ctx: CommsCtx): { text: string; kind: CommsMessage["kind"] } {
  const q = query.toLowerCase();
  const sig = `${ctx.signal}% signal · relay latency ${(ctx.lightMin * 2).toFixed(1)} min round-trip via orbiter buffer`;
  if (/\b(o2|oxygen|air|breath|breathe)\b/.test(q)) {
    if (ctx.o2Pct <= 20) return { text: `SUIT ADVISORY — O₂ CRITICAL at ${ctx.o2Pct.toFixed(0)}%. Turn back to BASE immediately, keep exertion minimal. We are watching your telemetry, copy your beacon at ${fmtLonLat(ctx.lon, ctx.lat)}.`, kind: "alert" };
    if (ctx.o2Pct <= 50) return { text: `O₂ at ${ctx.o2Pct.toFixed(0)}% — past the halfway rule. Finish the current task and start the turnaround leg. Burn rate ≈ ${(100 / Math.max(ctx.elapsedH, 0.4)).toFixed(1)} %/h.`, kind: "warn" };
    return { text: `Suit telemetry nominal — O₂ ${ctx.o2Pct.toFixed(0)}% remaining, ~${ctx.o2Pct.toFixed(0)}% suit margin for ${ctx.lstClock} LST ops. Keep moving, astronaut.`, kind: "info" };
  }
  if (/(where|position|location|coordinate|beacon|gps|fix)/.test(q)) {
    return { text: `Beacon fix: ${fmtLonLat(ctx.lon, ctx.lat)} — auto-identified as “${ctx.locName}”. Elevation ${ctx.elevM !== null ? `${ctx.elevM.toFixed(0)} m` : "—"}. Lock at ${ctx.signal}% signal.`, kind: "info" };
  }
  if (/(sample|rock|collect|tray)/.test(q)) {
    return ctx.samples > 0
      ? { text: `Tray reads ${ctx.samples} sample${ctx.samples === 1 ? "" : "s"} secured. Good cache — log masses on the next dwell and we'll uplink the manifest to the orbiter buffer.`, kind: "info" }
      : { text: `Tray is empty so far. Targets S-xx are marked with cyan pillars along the traverse — get within 7 m, face the rock, press [E].`, kind: "info" };
  }
  if (/(eta|route|waypoint|next|range|bearing|head)/.test(q)) {
    return { text: `Next waypoint ${ctx.nextName}: ${fmtDist(ctx.nextDistM)} out at bearing ${ctx.bearing.toFixed(0).padStart(3, "0")}° ${cTo(ctx.bearing)}. ETA ≈ ${ctx.etaH > 0 ? (ctx.etaH * 60).toFixed(0) + " min" : "—"} at ${ctx.speedKmh.toFixed(1)} km/h.`, kind: "info" };
  }
  if (/(weather|wind|temp|dust|storm|sky)/.test(q)) {
    return { text: `Local METEOK: ${ctx.spaceWx.replace("_", " ")} space-weather state; dust opacity steady, gusting 4–9 m/s surface winds. Sky stays butterscotch — no storm cells on orbital imagery.`, kind: "info" };
  }
  if (/(signal|comms|relay|link|comm)/.test(q)) {
    return { text: `Comms health: ${sig}. ${ctx.signal < 60 ? "Degrading with terrain shadowing — expect handover to the next orbiter pass." : "UHF link solid; MRO/Odyssey handovers seamless."}`, kind: "info" };
  }
  if (/(help|status|report|check|copy)/.test(q)) {
    return { text: `STATUS BLOCK — O₂ ${ctx.o2Pct.toFixed(0)}% · walk ${ctx.speedKmh.toFixed(1)} km/h · EVA clock ${ctx.lstClock} · beacon ${fmtLonLat(ctx.lon, ctx.lat)} (“${ctx.locName}”) · next ${ctx.nextName} ${fmtDist(ctx.nextDistM)} · samples ${ctx.samples} · ${sig}.`, kind: "info" };
  }
  if (/(hello|hi|hey|houston|ares|good (morning|sol))/.test(q)) {
    return { text: `Loud and clear, EVA-1. Mission Control copies on all channels — ${sig}. Give us a shout any time.`, kind: "info" };
  }
  return { text: `Copy: “${query.trim().slice(0, 80)}”. Logged at Mission Control and queued on the orbiter buffer (${sig}). Standing by.`, kind: "info" };
}

/** Periodic mission-control chatter (picked when nothing else is pending). */
export function chatter(ctx: CommsCtx): string {
  const lines = [
    `Orbiter pass in ~${(6 + Math.random() * 9).toFixed(0)} min — buffer any imagery you want downlinked.`,
    `Space-weather watch: ${ctx.spaceWx.replace("_", " ")} — ${ctx.spaceWx === "NOMINAL" ? "no restrictions on EVA duration." : "keep excursions conservative."}`,
    `Reminder: dust-mitigation brush for the camera windows at your next stop.`,
    `SEIS logged a small event near Cerberus Fossae overnight — nothing local, keep walking.`,
    `Terrain team confirms your traverse corridor is trafficable — ${ctx.signal < 60 ? "watch for comms shadowing in the next draw." : "comms corridor looks clean."}`,
    `Habitat copies your beacon at ${fmtLonLat(ctx.lon, ctx.lat)} — “${ctx.locName}” matches our expected fix.`,
    `Suit fluid loop looks textbook, EVA-1. Hydrate at the next dwell.`,
    `Weather desk: surface ${ctx.lstClock} LST — pressure steady, fine EVA window.`,
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}

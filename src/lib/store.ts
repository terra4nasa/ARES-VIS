"use client";
import { create } from "zustand";
import { PRESET_LAYERS, type LayerDef } from "./layers";
import { POIS, COMMS } from "./data";
import { PERSIST_KEY } from "./persistKey";
import { haversineKm } from "./mars";
import type { WalkReadout } from "./walk";
import { DEFAULT_SITE, seedRouteAt, codeFromName, locationName, regionName, wrapLon } from "./sites";
import { missionReply, type CommsMessage } from "./comms";
import { HAZARDS, bestBaseFor, hazardAlertText, type HazardDef, type HazardId } from "./hazards";
import {
  HUD_PANELS,
  HUD_PANEL_ORDER,
  PRESET_PANEL_OPEN,
  clampPanelRect,
  defaultHudPanels,
  hudPanelDef,
  panelsOpenFromPrefs,
  stackedHudPanels,
  type HudPanelId,
  type HudPanelState,
} from "./hudPanels";

export interface SiteState {
  name: string;
  lon: number;
  lat: number;
  elevM?: number;
  kind: string;
  region: string;
  source: "gazetteer" | "coords" | "default";
}

export type CommsStatus = "ONLINE" | "DEGRADED" | "ACQUIRING";

/** mission-control critical warning popup (vis: Alerts.tsx stack) */
export interface CommsAlert {
  id: number;
  /** dedupe key — same key won't re-pop within the cooldown window */
  key: string;
  title: string;
  text: string;
  kind: "warn" | "alert";
  t: number;
}

/** active hazard drill */
export interface HazardState {
  id: HazardId;
  def: HazardDef;
  startedT: number;
  /** recommended shelter for this drill */
  base: { name: string; lon: number; lat: number; distM: number; bearing: number; etaMin: number; why: string };
}

export interface CommsState {
  messages: CommsMessage[];
  alerts: CommsAlert[];
  signal: number; // 0–100 %
  status: CommsStatus;
  relay: string;
  latencyMin: number; // Earth–Mars one-way light time
  open: boolean; // comms panel visible
}

export interface RouteWaypoint {
  id: string;
  name: string;
  lon: number;
  lat: number;
  poiId?: string;
  elevM?: number;
  slopeDeg?: number;
}

export interface LayerState {
  def: LayerDef;
  visible: boolean;
  opacity: number;
}

export type PanelId = "layers" | "route" | "science" | "conditions" | "catalog" | "nasa" | "brief" | "locations";

export interface EvaParams {
  crew: number;
  speedKmh: number;
  suitHours: number;
  startLst: number; // local solar time of EVA start (hours 6..18)
}

/** per-block visor HUD preferences — persisted with the mission */
export interface VisorPrefs {
  nav: boolean; // next-waypoint tape: distance / bearing / ETA
  eva: boolean; // O₂ · dose · mission clock
  bio: boolean; // biometrics: heart · core temp · suit pressure · work rate
  rad: boolean; // radiation: live dose rate · cumulative · space-wx state
  terrain: boolean; // elevation · slope · sun · environment
  comms: boolean; // earth light-time · space weather
  hazards: boolean; // steep-terrain / low-O₂ alerts
  profile: boolean; // mini elevation profile
  helmet: boolean; // curved helmet mask frame
  reticle: boolean; // center crosshair
  compass: boolean; // live heading tape with bearing bug
  minimap: boolean; // top-down traverse mini-map
  shadows: boolean; // dynamic sun shadow maps (terrain / rocks / lander)
}

export const VISOR_PRESET: Record<"minimal" | "standard" | "full", VisorPrefs> = {
  minimal: { nav: true, eva: true, bio: false, rad: false, terrain: false, comms: false, hazards: true, profile: false, helmet: false, reticle: true, compass: true, minimap: false, shadows: false },
  standard: { nav: true, eva: true, bio: true, rad: false, terrain: true, comms: true, hazards: true, profile: false, helmet: true, reticle: true, compass: true, minimap: true, shadows: true },
  full: { nav: true, eva: true, bio: true, rad: true, terrain: true, comms: true, hazards: true, profile: true, helmet: true, reticle: true, compass: true, minimap: true, shadows: true },
};

export const DEFAULT_VISOR_PREFS: VisorPrefs = { ...VISOR_PRESET.standard };

export interface WalkSim {
  active: boolean;
  playing: boolean;
  manual: boolean; // astronaut on manual foot controls (WASD / D-pad · SHIFT dash)
  speedMult: number; // sim-time multiplier (1× real time … 240×)
  vehicle: "foot" | "rover"; // utility vehicle — ~10 km/h between sites, drains its battery
  o2BonusH: number; // O₂ topped up inside structures (hours of extra suit supply)
  chargeNonce: number; // bump → WalkEngine recharges the rover battery (structure dock)
  readout: WalkReadout | null;
  event: { id: number; msg: string; kind: "info" | "arrive" | "warn" | "done" } | null;
  skipDwellNonce: number; // bump → engine ends the current science stop
  jumpNonce: number; // bump → engine teleports to the next waypoint
}

/** a rock sample grabbed in the 3D visor during the current EVA */
export interface CollectedSample {
  code: string;
  kind: string;
  note: string;
  massKg: number;
  lon: number;
  lat: number;
  t: number;
}

interface AppStore {
  layers: LayerState[];
  route: RouteWaypoint[];
  planMode: boolean;
  visorMode: boolean;
  bootDone: boolean;
  activePanel: PanelId | null;
  eva: EvaParams;
  visorPrefs: VisorPrefs;
  walk: WalkSim;
  collected: CollectedSample[]; // samples secured this EVA (3D catch)
  cursor: { lon: number; lat: number } | null;
  mapZoom: number;
  focusTarget: { lon: number; lat: number; zoom?: number; nonce: number } | null;
  /** current operating site — drives the map view, 3D scene and location HUD */
  site: SiteState;
  siteNonce: number; // bump → 3D scene rebuilds at the new site
  comms: CommsState;
  hazard: HazardState | null; // active hazard drill (null = nominal ops)
  hazardAdviceNonce: number; // bump → WalkEngine emits a periodic advice blip
  /** floating visor panels — movable / resizable / closable HUD windows */
  hudPanels: Record<HudPanelId, HudPanelState>;
  /** monotonic z counter — focusHudPanel assigns the next value */
  hudZ: number;
  /* actions */
  toggleLayer: (id: string) => void;
  setLayerOpacity: (id: string, v: number) => void;
  addCustomLayer: (def: LayerDef) => void;
  removeCustomLayer: (id: string) => void;
  setPlanMode: (v: boolean) => void;
  setVisorMode: (v: boolean) => void;
  setBootDone: (v: boolean) => void;
  openPanel: (p: PanelId | null) => void;
  setEva: (p: Partial<EvaParams>) => void;
  setVisorPref: (k: keyof VisorPrefs, v: boolean) => void;
  setVisorDensity: (d: "minimal" | "standard" | "full") => void;
  /** floating HUD panels — layout + visibility */
  setHudPanelRect: (id: HudPanelId, patch: Partial<Pick<HudPanelState, "x" | "y" | "w" | "h">>) => void;
  toggleHudPanel: (id: HudPanelId, open?: boolean) => void;
  focusHudPanel: (id: HudPanelId) => void;
  collapseHudPanel: (id: HudPanelId, collapsed: boolean) => void;
  stackHudPanels: () => void;
  resetHudPanels: () => void;
  startWalk: () => boolean;
  stopWalk: () => void;
  setWalkPlaying: (v: boolean) => void;
  setWalkManual: (v: boolean) => void;
  /** structure capabilities + vehicle mode */
  setWalkVehicle: (v: "foot" | "rover") => void;
  topUpO2: (pct: number) => void;
  rechargeRover: () => void;
  takeShelter: () => void;
  repairTools: () => void;
  useO2Candle: () => void;
  collectSample: (s: CollectedSample) => void;
  cycleWalkSpeed: () => void;
  setWalkReadout: (r: WalkReadout) => void;
  pushWalkEvent: (msg: string, kind?: "info" | "arrive" | "warn" | "done") => void;
  skipDwell: () => void;
  jumpToNextWaypoint: () => void;
  setCursor: (c: { lon: number; lat: number } | null) => void;
  setMapZoom: (z: number) => void;
  addWaypoint: (w: RouteWaypoint) => void;
  removeWaypoint: (id: string) => void;
  moveWaypoint: (id: string, dir: -1 | 1) => void;
  updateWaypointPos: (id: string, lon: number, lat: number) => void;
  renameWaypoint: (id: string, name: string) => void;
  clearRoute: () => void;
  autoChainSites: (returnToBase: boolean) => number;
  appendReturnToBase: () => void;
  focus: (lon: number, lat: number, zoom?: number) => void;
  /** relocate the mission — resets the EVA, rebuilds the 3D scene, moves the map */
  setLocation: (p: { lon: number; lat: number; name?: string; elevM?: number; kind?: string; source?: "gazetteer" | "coords" }) => void;
  pushComms: (from: CommsMessage["from"], text: string, kind?: CommsMessage["kind"]) => void;
  sendComms: (text: string) => void;
  tickComms: (latencyMin?: number) => void;
  setCommsOpen: (v: boolean) => void;
  /** mission-control warning popup — deduped by key, mirrored into the comms log */
  pushAlert: (key: string, title: string, text: string, kind?: "warn" | "alert") => void;
  dismissAlert: (id: number) => void;
  /** start a simulated hazard drill — comms recommend the best shelter base */
  triggerHazard: (id: HazardId) => void;
  clearHazard: () => void;
  bumpHazardAdvice: () => void;
}

function initialLayers(): LayerState[] {
  return PRESET_LAYERS.map((def) => ({
    def,
    visible: def.defaultVisible,
    opacity: def.defaultOpacity,
  }));
}

/** First-visit demo route: MARSWALK-01 around Homestead Hollow */
function seedRoute(): RouteWaypoint[] {
  return POIS.filter((p) => ["base", "sc1", "sc2", "sc5"].includes(p.id)).map((p) => ({
    id: `seed-${p.id}`,
    name: p.code,
    lon: p.lon,
    lat: p.lat,
    poiId: p.id,
    elevM: p.elevM,
    slopeDeg: p.slopeDeg,
  }));
}

interface Persisted {
  customLayers: LayerDef[];
  route: RouteWaypoint[];
  eva: EvaParams;
  visorPrefs: VisorPrefs;
  bootDone: boolean;
  site: SiteState;
  hudPanels?: Partial<Record<HudPanelId, HudPanelState>>; // floating panel layout
  hudZ?: number;
}

const DEFAULT_EVA: EvaParams = { crew: 2, speedKmh: 2.6, suitHours: 8, startLst: 9 };

/**
 * viewport size in LOCAL panel units (real px ÷ --hud-zoom) — SSR-safe.
 * Panel coordinates are relative to the visor surface (`.visor-solid` root),
 * which sits below the app TopBar — measure that element, not the window.
 */
const vp = () => {
  if (typeof window === "undefined") return { w: 1440, h: 900 };
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hud-zoom"));
  const zoom = Number.isFinite(v) && v > 0 ? v : 1;
  const root = document.querySelector<HTMLElement>(".visor-solid");
  if (root) {
    const r = root.getBoundingClientRect();
    return { w: r.width / zoom, h: r.height / zoom };
  }
  return { w: window.innerWidth / zoom, h: window.innerHeight / zoom };
};

/**
 * Resolve the floating panel layout: fresh default for the current viewport,
 * overlaid with anything persisted (per-id merge keeps forward-compat when new
 * panels ship), or migrated from legacy visorPrefs booleans when the visitor
 * predates the floating-panel system.
 */
function buildHudPanels(
  stored?: Partial<Record<HudPanelId, HudPanelState>>,
  prefs?: VisorPrefs
): Record<HudPanelId, HudPanelState> {
  const { w, h } = vp();
  const open = panelsOpenFromPrefs(prefs ?? DEFAULT_VISOR_PREFS);
  const base = defaultHudPanels(w, h, open);
  if (!stored) return base;
  const merged = { ...base } as Record<HudPanelId, HudPanelState>;
  for (const id of HUD_PANEL_ORDER) {
    const s = stored[id];
    if (!s) continue;
    merged[id] = {
      ...merged[id],
      ...s,
      w: Math.max(hudPanelDef(id).minW, Math.round(s.w ?? merged[id].w)),
    };
  }
  return merged;
}const DEFAULT_COMMS: CommsState = {
  messages: [],
  alerts: [],
  signal: 88,
  status: "ONLINE",
  relay: "MRO / Electra",
  latencyMin: 13.3,
  open: false,
};

function loadPersisted(): Persisted {
  if (typeof window === "undefined") {
    return { customLayers: [], route: [], eva: DEFAULT_EVA, visorPrefs: DEFAULT_VISOR_PREFS, bootDone: false, site: { ...DEFAULT_SITE } };
  }
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) throw new Error("empty");
    const p = JSON.parse(raw) as Partial<Persisted>;
    return {
      customLayers: p.customLayers ?? [],
      route: p.route ?? [],
      eva: p.eva ?? DEFAULT_EVA,
      visorPrefs: { ...DEFAULT_VISOR_PREFS, ...(p.visorPrefs ?? {}) },
      bootDone: p.bootDone ?? false,
      site: p.site ?? { ...DEFAULT_SITE },
      hudPanels: p.hudPanels ?? undefined,
      hudZ: p.hudZ ?? 1,
    };
  } catch {
    return { customLayers: [], route: [], eva: DEFAULT_EVA, visorPrefs: DEFAULT_VISOR_PREFS, bootDone: false, site: { ...DEFAULT_SITE } };
  }
}

export const useStore = create<AppStore>((set, get) => {
  const firstVisit = typeof window !== "undefined" && !localStorage.getItem(PERSIST_KEY);
  const p = firstVisit
    ? { customLayers: [], route: seedRoute(), eva: DEFAULT_EVA, visorPrefs: DEFAULT_VISOR_PREFS, bootDone: false, site: { ...DEFAULT_SITE }, hudPanels: undefined as Persisted["hudPanels"], hudZ: 1 }
    : loadPersisted();

  // persist on mutation (fire-and-forget)
  const persist = () => {
    if (typeof window === "undefined") return;
    const s = get();
    const data: Persisted = {
      customLayers: s.layers.filter((l) => l.def.custom).map((l) => l.def),
      route: s.route,
      eva: s.eva,
      visorPrefs: s.visorPrefs,
      bootDone: s.bootDone,
      site: s.site,
      hudPanels: s.hudPanels,
      hudZ: s.hudZ,
    };
    localStorage.setItem(PERSIST_KEY, JSON.stringify(data));
  };

  let eventId = 1;
  let commsId = 1;
  let alertId = 1;
  let tickCount = 0;
  /** last alert emit per dedupe key (cooldown 45 s) */
  const alertCooldown: Record<string, number> = {};

  return {
    layers: [...initialLayers(), ...p.customLayers.map((def) => ({ def, visible: true, opacity: 0.8 }))],
    route: p.route,
    planMode: false,
    visorMode: false,
    bootDone: p.bootDone,
    activePanel: null,
    eva: p.eva,
    visorPrefs: p.visorPrefs,
    walk: { active: false, playing: false, manual: false, speedMult: 10, vehicle: "foot", o2BonusH: 0, chargeNonce: 0, readout: null, event: null, skipDwellNonce: 0, jumpNonce: 0 },
    collected: [],
    cursor: null,
    mapZoom: 12,
    focusTarget: null,
    site: p.site,
    siteNonce: 0,
    comms: { ...DEFAULT_COMMS },
    hazard: null,
    hazardAdviceNonce: 0,
    hudPanels: buildHudPanels(p.hudPanels, p.visorPrefs),
    hudZ: p.hudZ ?? 1,

    toggleLayer: (id) =>
      set((s) => ({
        layers: s.layers.map((l) => (l.def.id === id ? { ...l, visible: !l.visible } : l)),
      })),
    setLayerOpacity: (id, v) =>
      set((s) => ({ layers: s.layers.map((l) => (l.def.id === id ? { ...l, opacity: v } : l)) })),
    addCustomLayer: (def) =>
      set((s) => ({ layers: [...s.layers, { def, visible: true, opacity: 0.8 }] })),
    removeCustomLayer: (id) => set((s) => ({ layers: s.layers.filter((l) => l.def.id !== id) })),
    setPlanMode: (v) => set({ planMode: v }),
    setVisorMode: (v) => set({ visorMode: v, activePanel: v ? null : get().activePanel }),
    setBootDone: (v) => set({ bootDone: v }),
    openPanel: (panel) => set({ activePanel: panel }),
    setEva: (patch) => {
      set((s) => ({ eva: { ...s.eva, ...patch } }));
      persist();
    },
    setVisorPref: (k, v) => {
      set((s) => ({ visorPrefs: { ...s.visorPrefs, [k]: v } }));
      persist();
    },
    setVisorDensity: (d) => {
      // presets drive both overlay prefs and which floating panels are open
      set((s) => {
        const openIds = new Set<string>(PRESET_PANEL_OPEN[d]);
        return {
          visorPrefs: { ...VISOR_PRESET[d], helmet: s.visorPrefs.helmet },
          hudPanels: Object.fromEntries(
            Object.entries(s.hudPanels).map(([id, st]) => [id, { ...st, open: openIds.has(id) }])
          ) as Record<HudPanelId, HudPanelState>,
        };
      });
      persist();
    },
    setHudPanelRect: (id, patch) => {
      set((s) => {
        const st = s.hudPanels[id];
        const { w: vw, h: vh } = vp();
        const rect = clampPanelRect({ ...st, ...patch }, hudPanelDef(id), vw, vh, st.collapsed);
        return { hudPanels: { ...s.hudPanels, [id]: { ...st, ...rect } } };
      });
      persist();
    },
    toggleHudPanel: (id, open) => {
      set((s) => {
        const st = s.hudPanels[id];
        const willOpen = open ?? !st.open;
        const z = s.hudZ + 1;
        // (re)opened panels clamp into the current viewport — a layout saved on
        // a bigger window must never land off-screen on a smaller one
        const { w: vw, h: vh } = vp();
        const rect = willOpen && !st.collapsed
          ? clampPanelRect({ x: st.x, y: st.y, w: st.w, h: st.h }, hudPanelDef(id), vw, vh, st.collapsed)
          : { x: st.x, y: st.y, w: st.w, h: st.h };
        return {
          hudZ: z,
          hudPanels: { ...s.hudPanels, [id]: { ...st, ...rect, open: willOpen, z } },
        };
      });
      persist();
    },
    focusHudPanel: (id) => {
      set((st) => {
        // always bump — several panels may share the initial z, so "already
        // top" can't be inferred from z alone; compaction caps the growth
        if (st.hudPanels[id].z === st.hudZ && st.hudZ > 1) return {};
        const cur = st.hudPanels[id];
        // compact z values periodically so panel z never climbs into the
        // dialog / critical-alert layers (base 486 + z must stay < ~560)
        if (st.hudZ > 60) {
          const order = HUD_PANEL_ORDER.slice().sort((a, b) => st.hudPanels[a].z - st.hudPanels[b].z);
          const panels = { ...st.hudPanels };
          order.forEach((pid, i) => {
            panels[pid] = { ...panels[pid], z: i + 1 };
          });
          panels[id] = { ...panels[id], z: HUD_PANEL_ORDER.length + 1 };
          return { hudPanels: panels, hudZ: HUD_PANEL_ORDER.length + 1 };
        }
        const z = st.hudZ + 1;
        return { hudZ: z, hudPanels: { ...st.hudPanels, [id]: { ...cur, z } } };
      });
      persist();
    },
    collapseHudPanel: (id, collapsed) => {
      set((s) => ({ hudPanels: { ...s.hudPanels, [id]: { ...s.hudPanels[id], collapsed } } }));
      persist();
    },
    stackHudPanels: () => {
      set((s) => {
        const { w, h } = vp();
        return { hudPanels: stackedHudPanels(w, h, s.hudPanels) };
      });
      persist();
    },
    resetHudPanels: () => {
      set((s) => {
        const { w, h } = vp();
        const open = Object.fromEntries(Object.entries(s.hudPanels).map(([id, st]) => [id, st.open])) as Partial<Record<HudPanelId, boolean>>;
        const collapsed = Object.fromEntries(Object.entries(s.hudPanels).map(([id, st]) => [id, st.collapsed])) as Partial<Record<HudPanelId, boolean>>;
        const fresh = defaultHudPanels(w, h, open);
        for (const id of HUD_PANEL_ORDER) fresh[id].collapsed = collapsed[id] ?? false;
        return { hudPanels: fresh, hudZ: 1 };
      });
      persist();
    },
    startWalk: () => {
      const s = get();
      if (s.route.length < 2) return false;
      set({
        walk: { active: true, playing: true, manual: false, speedMult: s.walk.speedMult, vehicle: "foot", o2BonusH: 0, chargeNonce: 0, readout: null, event: { id: eventId++, msg: `MARSWALK DEPARTED · ${s.route[0].name}`, kind: "info" }, skipDwellNonce: 0, jumpNonce: 0 },
        collected: [],
        planMode: false,
        visorMode: true,
        activePanel: null,
        focusTarget: { lon: s.route[0].lon, lat: s.route[0].lat, zoom: 14, nonce: (s.focusTarget?.nonce ?? 0) + 1 },
      });
      return true;
    },
    stopWalk: () => set({ walk: { active: false, playing: false, manual: false, speedMult: get().walk.speedMult, vehicle: "foot", o2BonusH: 0, chargeNonce: 0, readout: null, event: null, skipDwellNonce: 0, jumpNonce: 0 } }),
    setWalkPlaying: (v) => set((s) => ({ walk: { ...s.walk, playing: v } })),
    setWalkManual: (v) => set((s) => ({ walk: { ...s.walk, manual: v } })),
    setWalkVehicle: (v) => {
      set((s) => ({
        walk: {
          ...s.walk,
          vehicle: v,
          event: { id: (s.walk.event?.id ?? 0) + 1, msg: v === "rover" ? "UTILITY ROVER ENGAGED — ~10 KM/H BETWEEN SITES · BATTERY DRAINS ~1.6 %/KM" : "DISEMBARKED — ON FOOT · SUITED PACE 3.4 KM/H (SHIFT TO LOPE)", kind: "info" as const },
        },
      }));
    },
    topUpO2: (pct) => {
      set((s) => ({ walk: { ...s.walk, o2BonusH: s.walk.o2BonusH + (pct / 100) * s.eva.suitHours } }));
      get().pushComms("crew", `Suit repressurized from the LOX bank — supply +${pct}%.`, "info");
    },
    rechargeRover: () => {
      set((s) => ({ walk: { ...s.walk, chargeNonce: s.walk.chargeNonce + 1 } }));
      get().pushComms("crew", "Rover docked and charging from the habitat solar array — battery 100%.", "info");
    },
    takeShelter: () => {
      const s = get();
      if (s.hazard) {
        s.pushWalkEvent(`SHELTERED INSIDE HAB-01 — RIDING OUT ${s.hazard.def.label.toUpperCase()}`, "info");
        s.pushComms("crew", "Inside the hab, hatch sealed. Sheltering from the drill event.", "info");
        s.clearHazard();
      } else {
        s.pushWalkEvent("INSIDE HAB-01 — PRESSURIZED, SYSTEMS NOMINAL", "info");
      }
    },
    repairTools: () => {
      get().pushComms("crew", "Drill crown swapped and tool latches re-torqued from the cache spares — kit serviceable.", "info");
    },
    useO2Candle: () => {
      set((s) => ({ walk: { ...s.walk, o2BonusH: s.walk.o2BonusH + (8 / 100) * s.eva.suitHours } }));
      get().pushComms("crew", "O₂ candle cracked — suit supply +8%. Ventilating the cache before stowing.", "info");
    },
    collectSample: (sm) => set((s) => ({ collected: [...s.collected, sm] })),
    cycleWalkSpeed: () =>
      set((s) => {
        const steps = [1, 5, 20, 60];
        const idx = steps.indexOf(s.walk.speedMult);
        return { walk: { ...s.walk, speedMult: steps[(idx + 1) % steps.length] } };
      }),
    setWalkReadout: (r) => set((s) => ({ walk: { ...s.walk, readout: r } })),
    pushWalkEvent: (msg, kind = "info") =>
      set((s) => ({
        walk: { ...s.walk, event: { id: eventId++, msg, kind } },
        // mirror the event into the comms log (system traffic)
        comms: {
          ...s.comms,
          messages: [
            ...s.comms.messages,
            { id: commsId++, from: "system" as const, text: msg, t: Date.now(), kind: (kind === "warn" ? "warn" : "info") as CommsMessage["kind"] },
          ].slice(-120),
        },
      })),
    skipDwell: () => set((s) => ({ walk: { ...s.walk, skipDwellNonce: s.walk.skipDwellNonce + 1 } })),
    jumpToNextWaypoint: () => set((s) => ({ walk: { ...s.walk, jumpNonce: s.walk.jumpNonce + 1 } })),
    setCursor: (c) => set({ cursor: c }),
    setMapZoom: (z) => set({ mapZoom: z }),
    addWaypoint: (w) => {
      set((s) => ({ route: [...s.route, w] }));
      persist();
    },
    removeWaypoint: (id) => {
      set((s) => ({ route: s.route.filter((w) => w.id !== id) }));
      persist();
    },
    moveWaypoint: (id, dir) => {
      set((s) => {
        const idx = s.route.findIndex((w) => w.id === id);
        const to = idx + dir;
        if (idx < 0 || to < 0 || to >= s.route.length) return s;
        const route = [...s.route];
        const [item] = route.splice(idx, 1);
        route.splice(to, 0, item);
        return { route };
      });
      persist();
    },
    updateWaypointPos: (id, lon, lat) => {
      set((s) => ({ route: s.route.map((w) => (w.id === id ? { ...w, lon, lat } : w)) }));
      persist();
    },
    renameWaypoint: (id, name) => {
      set((s) => ({
        ...s,
        route: s.route.map((w) => (w.id === id ? { ...w, name } : w)),
      }));
      persist();
    },
    clearRoute: () => {
      set({ route: [] });
      persist();
    },
    autoChainSites: (returnToBase) => {
      const s = get();
      const base = POIS.find((p) => p.type === "base");
      const sites = POIS.filter((p) => p.type !== "base");
      if (!base || sites.length === 0) return 0;
      const toWp = (poi: (typeof POIS)[number], i: number): RouteWaypoint => ({
        id: `auto-${poi.id}-${Date.now()}-${i}`,
        name: poi.code,
        lon: poi.lon,
        lat: poi.lat,
        poiId: poi.id,
        elevM: poi.elevM,
        slopeDeg: poi.slopeDeg,
      });
      // nearest-neighbour chain: BASE → closest unvisited site → …
      const remaining = [...sites];
      const ordered: (typeof POIS)[number][] = [];
      let cur = base;
      while (remaining.length) {
        let best = 0;
        let bestD = Infinity;
        remaining.forEach((cand, i) => {
          const d = haversineKm(cur, cand);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        cur = remaining[best];
        ordered.push(cur);
        remaining.splice(best, 1);
      }
      const route: RouteWaypoint[] = [toWp(base, 0), ...ordered.map((poi, i) => toWp(poi, i + 1))];
      if (returnToBase) route.push(toWp(base, route.length));
      set({ route });
      persist();
      return route.length;
    },
    appendReturnToBase: () => {
      const s = get();
      const base = POIS.find((p) => p.type === "base");
      if (!base || s.route.length === 0) return;
      if (s.route[s.route.length - 1].poiId === "base") return;
      set((st) => ({
        route: [
          ...st.route,
          {
            id: `auto-base-return-${Date.now()}`,
            name: base.code,
            lon: base.lon,
            lat: base.lat,
            poiId: base.id,
            elevM: base.elevM,
            slopeDeg: base.slopeDeg,
          },
        ],
      }));
      persist();
    },
    focus: (lon, lat, zoom) =>
      set((s) => ({ focusTarget: { lon, lat, zoom, nonce: (s.focusTarget?.nonce ?? 0) + 1 } })),

    /** relocate the mission: stop any walk, seed a fresh demo route, rebuild the 3D scene, move the map */
    setLocation: ({ lon, lat, name, elevM, kind, source }) => {
      const s = get();
      const clampedLat = Math.min(90, Math.max(-90, lat));
      const clampedLon = wrapLon(lon);
      const locName = name ?? locationName(clampedLon, clampedLat);
      const site: SiteState = {
        name: locName,
        lon: clampedLon,
        lat: clampedLat,
        elevM,
        kind: kind ?? "coords",
        region: regionName(clampedLon, clampedLat),
        source: source ?? "coords",
      };
      const code = codeFromName(locName);
      set({
        site,
        siteNonce: s.siteNonce + 1,
        route: seedRouteAt(clampedLat, clampedLon, code),
        walk: { active: false, playing: false, manual: false, speedMult: s.walk.speedMult, vehicle: "foot", o2BonusH: 0, chargeNonce: 0, readout: null, event: null, skipDwellNonce: 0, jumpNonce: 0 },
        collected: [],
        focusTarget: { lon: clampedLon, lat: clampedLat, zoom: 13, nonce: (s.focusTarget?.nonce ?? 0) + 1 },
        comms: {
          ...s.comms,
          messages: [
            ...s.comms.messages,
            { id: commsId++, from: "system" as const, text: `LOCATION UPDATE — now operating at ${locName} (${clampedLat.toFixed(4)}° ${clampedLat >= 0 ? "N" : "S"}, ${Math.abs(clampedLon).toFixed(4)}° ${clampedLon >= 0 ? "E" : "W"}). EVA reset · beacon re-acquired.`, t: Date.now(), kind: "info" as const },
          ].slice(-120),
        },
      });
      persist();
    },

    pushComms: (from, text, kind = "info") =>
      set((s) => ({
        comms: { ...s.comms, messages: [...s.comms.messages, { id: commsId++, from, text, t: Date.now(), kind }].slice(-120) },
      })),

    sendComms: (text) => {
      const t = text.trim();
      if (!t) return;
      get().pushComms("crew", t);
      // Mission Control answers after a short relay delay
      setTimeout(() => {
        const s = get();
        const r = s.walk.readout;
        const route = s.route;
        const frameNext = route[Math.min(r?.nextIdx ?? 1, route.length - 1)] ?? route[route.length - 1];
        const ctx = {
          o2Pct: r?.o2Pct ?? 100,
          locName: locationName(r?.lon ?? s.site.lon, r?.lat ?? s.site.lat),
          lon: r?.lon ?? s.site.lon,
          lat: r?.lat ?? s.site.lat,
          elevM: r?.elev ?? s.site.elevM ?? null,
          speedKmh: r?.speedEff ?? s.eva.speedKmh,
          samples: s.collected.length,
          nextName: frameNext?.name ?? "—",
          nextDistM: r?.nextDistM ?? 0,
          bearing: r?.bearing ?? 0,
          etaH: r && r.speedEff > 0.05 ? r.nextDistM / 1000 / r.speedEff : 0,
          lstClock: r ? `${String(Math.floor(r.lstNow)).padStart(2, "0")}:${String(Math.floor((r.lstNow % 1) * 60)).padStart(2, "0")}` : "—",
          elapsedH: r?.elapsedH ?? 0.4,
          signal: s.comms.signal,
          spaceWx: s.comms.status === "ONLINE" ? "NOMINAL" : "ELEVATED",
          lightMin: s.comms.latencyMin,
          walking: !!r,
        };
        const reply = missionReply(t, ctx);
        get().pushComms("mission", reply.text, reply.kind);
      }, 1400 + Math.random() * 2200);
    },

    tickComms: (latencyMin) => {
      const s = get();
      tickCount++;
      const r = s.walk.readout;
      const baseWp = s.route[0];
      const distKm = r && baseWp ? haversineKm(baseWp, { lon: r.lon, lat: r.lat }) : 0;
      const base = 92 - Math.min(38, distKm * 3.4) - (r ? 0 : 2);
      const wander = Math.sin(Date.now() / 7300) * 4.2 + (Math.random() - 0.5) * 3.4;
      const hazardDrop = s.hazard?.def.signalDrop ?? 0;
      const signal = Math.round(Math.min(100, Math.max(4, base + wander - hazardDrop)));
      const prev = s.comms.status;
      const status = signal >= 60 ? "ONLINE" : signal >= 35 ? "DEGRADED" : "ACQUIRING";
      const relay = COMMS.relays[Math.floor(tickCount / 25) % COMMS.relays.length].name;
      const patch: Partial<CommsState> = { signal, status, relay };
      if (latencyMin && latencyMin > 0) patch.latencyMin = latencyMin;
      const degrade = prev !== "ACQUIRING" && status === "ACQUIRING";
      set({
        comms: {
          ...s.comms,
          ...patch,
          messages: degrade
            ? [...s.comms.messages, { id: commsId++, from: "system" as const, text: "SIGNAL WEAK — reacquiring orbiter pass…", t: Date.now(), kind: "warn" as const }].slice(-120)
            : s.comms.messages,
        },
      });
    },

    setCommsOpen: (v) => set((s) => ({ comms: { ...s.comms, open: v } })),

    /** critical-warning popup — deduped by key (45 s cooldown), mirrored into the comms log */
    pushAlert: (key, title, text, kind = "alert") => {
      const now = Date.now();
      if (alertCooldown[key] && now - alertCooldown[key] < 45000) return;
      alertCooldown[key] = now;
      set((s) => ({
        comms: {
          ...s.comms,
          alerts: [...s.comms.alerts, { id: alertId++, key, title, text, kind, t: now }].slice(-4),
          messages: [...s.comms.messages, { id: commsId++, from: "mission" as const, text: `${title} — ${text}`, t: now, kind }].slice(-120),
        },
      }));
    },

    dismissAlert: (id) =>
      set((s) => ({ comms: { ...s.comms, alerts: s.comms.alerts.filter((a) => a.id !== id) } })),

    /** simulated hazard drill — alert + Mission Control shelter recommendation */
    triggerHazard: (id) => {
      const s = get();
      const def = HAZARDS.find((h) => h.id === id);
      if (!def) return;
      const r = s.walk.readout;
      const lon = r?.lon ?? s.site.lon;
      const lat = r?.lat ?? s.site.lat;
      const spd = r?.speedEff ?? s.eva.speedKmh;
      const rec = bestBaseFor(def, lon, lat, s.route, spd);
      if (!rec) return;
      set({
        hazard: {
          id: def.id,
          def,
          startedT: Date.now(),
          base: { name: rec.name, lon: rec.lon, lat: rec.lat, distM: rec.distM, bearing: rec.bearing, etaMin: rec.etaMin, why: rec.why },
        },
      });
      get().pushAlert(`hazard-${def.id}`, `⚠ ${def.label.toUpperCase()} — SHELTER ADVISED`, `${def.brief} Recommended shelter: ${hazardAlertText(def, rec)}`, def.severity);
      get().pushComms("mission", `MISSION CONTROL PRIORITY — ${def.label.toUpperCase()} DRILL INITIATED. ${def.brief} Proceed to ${rec.name} — ${(rec.distM / 1000).toFixed(2)} km at bearing ${rec.bearing.toFixed(0).padStart(3, "0")}°, ETA ≈ ${rec.etaMin} min at ${rec.speedKmh.toFixed(1)} km/h. ${rec.why}. ${def.rec}`, def.severity);
      get().pushWalkEvent(`HAZARD DRILL · ${def.label.toUpperCase()} — R2B ${rec.bearing.toFixed(0).padStart(3, "0")}° · ${rec.etaMin} MIN`, def.severity === "alert" ? "warn" : "info");
    },

    clearHazard: () =>
      set((s) => ({
        hazard: null,
        hazardAdviceNonce: s.hazardAdviceNonce,
        comms: {
          ...s.comms,
          messages: [...s.comms.messages, { id: commsId++, from: "mission" as const, text: "DRILL COMPLETE — conditions nominal. Well executed, EVA-1. Resetting suit models to nominal.", t: Date.now(), kind: "info" as const }].slice(-120),
        },
      })),

    bumpHazardAdvice: () => set((s) => ({ hazardAdviceNonce: s.hazardAdviceNonce + 1 })),
  };
});

// hydrate layers once on client mount (preset + persisted customs)
if (typeof window !== "undefined") {
  // debugging handle (harmless in prod, used by E2E checks)
  (window as unknown as { __ARES_STORE__?: typeof useStore }).__ARES_STORE__ = useStore;
  const firstVisit = !localStorage.getItem(PERSIST_KEY);
  if (!firstVisit) {
    const p = loadPersisted();
    useStore.setState({
      layers: [
        ...initialLayers(),
        ...p.customLayers.map((def) => ({ def, visible: true, opacity: 0.8 })),
      ],
      route: p.route,
      eva: p.eva,
      visorPrefs: p.visorPrefs,
      bootDone: p.bootDone,
      site: p.site,
      hudPanels: buildHudPanels(p.hudPanels, p.visorPrefs),
      hudZ: p.hudZ ?? 1,
    });
  }
}

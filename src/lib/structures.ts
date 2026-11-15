/**
 * Surface structures with per-site capabilities — the things an astronaut can
 * physically "get inside" when something goes wrong.
 *
 * Two structure classes are rendered in the 3D scene (see fpv3d.ts):
 *  - HAB  — pressurized dome habitat complex at the BASE waypoint, 16 m NW of
 *           the pad (az 305°): O₂ resupply, rover docking/charge, storm shelter
 *  - CACHE— unpressurized instrument cache at every science / hazard site,
 *           6.5 m off the waypoint (az 35° + i·47°): tool/drill repair, spare
 *           O₂ candle
 *
 * Structure positions are exported as nodes so the FPV engine can compute
 * proximity and the HUD can show the ENTER prompt. The formulas here MUST
 * match the mesh placement offsets in fpv3d.ts.
 */

import { POIS } from "./data";
import type { RouteWaypoint } from "./store";

export type StructureType = "hab" | "cache";
export type CapId = "o2" | "charge" | "shelter" | "repair" | "candle";

export interface CapDef {
  id: CapId;
  label: string;
  desc: string;
  /** HUD accent color var */
  color: string;
}

export interface StructureInfo {
  id: string;
  type: StructureType;
  code: string;
  label: string;
  sub: string;
  caps: CapDef[];
}

export interface StructureNode extends StructureInfo {
  /** scene-local meters (same space as the walker position) */
  x: number;
  z: number;
}

export const CAPS: Record<CapId, CapDef> = {
  o2: { id: "o2", label: "O₂ resupply", desc: "Repressurize from the hab's LOX bank — tops the suit back up by 40% of a full charge.", color: "var(--hud-green)" },
  charge: { id: "charge", label: "Rover dock + charge", desc: "Dock the utility vehicle and recharge its battery to 100% from the solar array.", color: "var(--hud-amber)" },
  shelter: { id: "shelter", label: "Storm shelter", desc: "Get inside the regolith-shielded hab and ride out any active hazard drill under Mission Control's watch.", color: "var(--hud-cyan)" },
  repair: { id: "repair", label: "Tool / drill service", desc: "Swap the worn drill crown and re-torque the tool latches from the cache spares.", color: "var(--hud-amber)" },
  candle: { id: "candle", label: "Spare O₂ candle", desc: "Crack a chlorate candle from the emergency locker — +8% suit supply.", color: "var(--hud-green)" },
};

/** habitat complex capabilities (pressurized) */
const HAB_CAPS: CapDef[] = [CAPS.o2, CAPS.charge, CAPS.shelter];
/** instrument cache capabilities (unpressurized — gloves-on service) */
const CACHE_CAPS: CapDef[] = [CAPS.repair, CAPS.candle];

/** structure metadata for a waypoint's POI type */
export function structureForPoi(poiId: string | undefined, wpIdx: number): StructureInfo | null {
  const poi = POIS.find((p) => p.id === poiId);
  if (!poi) return null;
  if (poi.type === "base") {
    return {
      id: "hab",
      type: "hab",
      code: "HAB-01",
      label: "Hab complex",
      sub: poi.name,
      caps: HAB_CAPS,
    };
  }
  if (poi.type === "science" || poi.type === "hazard") {
    return {
      id: `cache-${wpIdx}`,
      type: "cache",
      code: `CACHE-${String(wpIdx).padStart(2, "0")}`,
      label: "Instrument cache",
      sub: poi.name,
      caps: CACHE_CAPS,
    };
  }
  return null;
}

const RAD = Math.PI / 180;

/**
 * Structure scene positions for the current route. Offsets MUST match the mesh
 * placement in fpv3d.ts (hab: 16 m @ 305° from base; cache: 6.5 m @ 35°+i·47°).
 * `toX`/`toZ` convert lon/lat → scene meters; they are passed in to keep this
 * module free of scene imports.
 */
export function structureNodes(
  route: RouteWaypoint[],
  toX: (lon: number) => number,
  toZ: (lat: number) => number
): StructureNode[] {
  const nodes: StructureNode[] = [];
  route.forEach((wp, i) => {
    const info = structureForPoi(wp.poiId, i);
    if (!info) return;
    if (info.type === "hab") {
      const azH = 305 * RAD;
      nodes.push({ ...info, x: toX(wp.lon) + Math.sin(azH) * 16, z: toZ(wp.lat) - Math.cos(azH) * 16 });
    } else {
      const az = (35 + i * 47) * RAD;
      nodes.push({ ...info, x: toX(wp.lon) + Math.sin(az) * 6.5, z: toZ(wp.lat) - Math.cos(az) * 6.5 });
    }
  });
  return nodes;
}

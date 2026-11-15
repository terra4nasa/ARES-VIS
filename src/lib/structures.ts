/**
 * Surface structures with per-site capabilities — the things an astronaut can
 * physically "get inside" when something goes wrong.
 *
 * Structures are placed from the ROUTE (not the POI catalog) so every site —
 * default or relocated — gets its buildings:
 *  - HAB  — pressurized dome habitat complex at the base waypoints (route
 *           start + return), 16 m NW of the pad (az 305°): O₂ resupply, rover
 *           dock + charge, storm shelter
 *  - FL   — field lab station (pressurized work module): tool service,
 *           rover charge
 *  - CACHE— unpressurized instrument cache: tool / drill service, spare
 *           O₂ candle
 *  - REL  — comms / power relay: rover charge, spare O₂ candle
 * The three station types cycle across the intermediate waypoints, so each
 * site stop has a different building with a different use.
 *
 * Node positions are exported so the FPV engine can build the meshes and
 * compute proximity from the SAME coordinates.
 */

import { bearingDeg } from "./mars";
import type { RouteWaypoint } from "./store";

export type StructureType = "hab" | "lab" | "cache" | "relay";
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
  charge: { id: "charge", label: "Rover dock + charge", desc: "Dock the utility vehicle and recharge its battery to 100% from the station array.", color: "var(--hud-amber)" },
  shelter: { id: "shelter", label: "Storm shelter", desc: "Get inside the regolith-shielded hab and ride out any active hazard drill under Mission Control's watch.", color: "var(--hud-cyan)" },
  repair: { id: "repair", label: "Tool / drill service", desc: "Swap the worn drill crown and re-torque the tool latches from the station spares.", color: "var(--hud-amber)" },
  candle: { id: "candle", label: "Spare O₂ candle", desc: "Crack a chlorate candle from the emergency locker — +8% suit supply.", color: "var(--hud-green)" },
};

const HAB_CAPS: CapDef[] = [CAPS.o2, CAPS.charge, CAPS.shelter];
const LAB_CAPS: CapDef[] = [CAPS.repair, CAPS.charge];
const CACHE_CAPS: CapDef[] = [CAPS.repair, CAPS.candle];
const RELAY_CAPS: CapDef[] = [CAPS.charge, CAPS.candle];

/** which station type sits at route index i (0-based); base waypoints → hab */
export function structureForWp(i: number, total: number): StructureInfo {
  if (i === 0 || i === total - 1) {
    return { id: "hab", type: "hab", code: "HAB-01", label: "Hab complex", sub: "Base camp — pressurized", caps: HAB_CAPS };
  }
  const cycle: StructureInfo[] = [
    { id: "lab", type: "lab", code: `FL-${String(i).padStart(2, "0")}`, label: "Field lab", sub: "Pressurized work module", caps: LAB_CAPS },
    { id: "cache", type: "cache", code: `CACHE-${String(i).padStart(2, "0")}`, label: "Instrument cache", sub: "Unpressurized — gloves-on", caps: CACHE_CAPS },
    { id: "relay", type: "relay", code: `REL-${String(i).padStart(2, "0")}`, label: "Comms relay", sub: "Power + signal mast", caps: RELAY_CAPS },
  ];
  return cycle[(i - 1) % 3];
}

const RAD = Math.PI / 180;

/** heading the astronaut faces at route index i — the camera settles on the
 *  departing-leg bearing (arrival bearing eases into it on approach) */
function viewBearing(route: RouteWaypoint[], i: number): number {
  if (i < route.length - 1) return bearingDeg(route[i], route[i + 1]);
  return bearingDeg(route[i - 1], route[i]);
}

/**
 * Geo offsets (meters east / north) of the structure at route index i,
 * placed INSIDE the camera's field of view (half-angle ≈ 36°) when the
 * astronaut stands at the waypoint: stations 6 m at +30° (front-right of the
 * view heading), hab airlock 10 m at −28° (front-left — the lander parks
 * front-right at base, and the dome complex itself is scenery at the pad).
 */
export function structureOffset(route: RouteWaypoint[], i: number): { dE: number; dN: number } {
  const total = route.length;
  if (i === 0 || i === total - 1) {
    const az = viewBearing(route, i) - 28;
    return { dE: Math.sin(az * RAD) * 10, dN: Math.cos(az * RAD) * 10 };
  }
  const az = viewBearing(route, i) + 30;
  return { dE: Math.sin(az * RAD) * 6, dN: Math.cos(az * RAD) * 6 };
}

/**
 * Structure scene positions for the current route. `toX`/`toZ` convert
 * lon/lat → scene meters; passed in to keep this module free of scene imports.
 * Geo north maps to −z in scene space.
 */
export function structureNodes(
  route: RouteWaypoint[],
  toX: (lon: number) => number,
  toZ: (lat: number) => number
): StructureNode[] {
  const nodes: StructureNode[] = [];
  route.forEach((wp, i) => {
    const info = structureForWp(i, route.length);
    const off = structureOffset(route, i);
    nodes.push({ ...info, x: toX(wp.lon) + off.dE, z: toZ(wp.lat) - off.dN });
  });
  return nodes;
}

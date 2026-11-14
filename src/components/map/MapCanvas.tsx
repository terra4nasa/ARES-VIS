"use client";
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { useStore } from "@/lib/store";
import { TILE_SIZE, ZOOM_OFFSET, MAP_MIN_ZOOM, MAP_MAX_ZOOM } from "@/lib/layers";
import { POIS, QUAKES, GEOLOGY, landingEllipseGeo } from "@/lib/data";
import { loadTerrain, sampleElevation } from "@/lib/terrain";
import type * as LT from "leaflet";

type Leaflet = typeof LT;
type Rec = { layer: LT.Layer; visible: boolean; opacity: number };

/* graticule steps (deg) — pick the first step that keeps lines ~110 px apart */
const GRID_STEPS = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30];
const fmtLonGrid = (lon: number, dec: number) => `${Math.abs(lon).toFixed(dec)}°${lon >= 0 ? "E" : "W"}`;
const fmtLatGrid = (lat: number, dec: number) => `${Math.abs(lat).toFixed(dec)}°${lat >= 0 ? "N" : "S"}`;

function astroDivIcon(L: Leaflet, idle: boolean): LT.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div class="astro-marker${idle ? " idle" : ""}"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="5.6" r="3.1" fill="#f1f5f9" stroke="#0c4a6e" stroke-width="1.1"/><path d="M9.9 4.9a3.1 3.1 0 0 1 4.2-.3" stroke="#ff7a2f" stroke-width="1.2" fill="none" stroke-linecap="round"/><rect x="8.2" y="9.3" width="7.6" height="6.6" rx="2.2" fill="#f1f5f9" stroke="#0c4a6e" stroke-width="1.1"/><path d="M12 10.8v3.6" stroke="#0c4a6e" stroke-width="1"/><path d="M10.3 16.4v3.4M13.7 16.4v3.4" stroke="#f1f5f9" stroke-width="1.9" stroke-linecap="round"/><path d="M8.2 11.2l-2.3 2.6M15.8 11.2l2.3 2.6" stroke="#f1f5f9" stroke-width="1.7" stroke-linecap="round"/></svg><span></span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

export default function MapCanvas() {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LT.Map | null>(null);
  const LRef = useRef<Leaflet | null>(null);
  const recsRef = useRef<Map<string, Rec>>(new Map());
  const routeGroupRef = useRef<LT.LayerGroup | null>(null);
  const walkGroupRef = useRef<LT.LayerGroup | null>(null);
  const astroRef = useRef<LT.Marker | null>(null);
  const idleBeaconRef = useRef<LT.Marker | null>(null);
  const trailRef = useRef<LT.Polyline | null>(null);
  const gridGroupRef = useRef<LT.LayerGroup | null>(null);
  const gridLabelRef = useRef<LT.LayerGroup | null>(null);
  const planModeRef = useRef(false);
  const lastMoveRef = useRef(0);
  const [gridInfo, setGridInfo] = useState<{ step: number; km: number } | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const layers = useStore((s) => s.layers);
  const route = useStore((s) => s.route);
  const focusTarget = useStore((s) => s.focusTarget);
  const planMode = useStore((s) => s.planMode);
  const walkActive = useStore((s) => s.walk.active);
  const walkReadout = useStore((s) => s.walk.readout);
  const site = useStore((s) => s.site);
  const siteNonce = useStore((s) => s.siteNonce);
  const setCursor = useStore((s) => s.setCursor);
  const setMapZoom = useStore((s) => s.setMapZoom);

  /* ---------- init map ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L: Leaflet = (await import("leaflet")) as unknown as Leaflet;
      if (cancelled || !divRef.current || mapRef.current) return;
      LRef.current = L;
      const st0 = useStore.getState();
      const map = L.map(divRef.current, {
        crs: L.CRS.EPSG4326,
        center: [st0.site.lat, st0.site.lon],
        zoom: 13,
        minZoom: MAP_MIN_ZOOM,
        maxZoom: MAP_MAX_ZOOM,
        zoomControl: false,
        wheelPxPerZoomLevel: 120, // gentler wheel zoom (≈ half the default twitch)
        preferCanvas: false,
      });
      map.createPane("gridPane").style.zIndex = "205";
      map.createPane("gridLabelPane").style.zIndex = "445";
      map.createPane("routePane").style.zIndex = "260";
      map.createPane("reliefPane").style.zIndex = "210";
      map.createPane("thermalPane").style.zIndex = "220";
      map.createPane("hazardPane").style.zIndex = "230";
      map.createPane("geoPane").style.zIndex = "240";
      map.createPane("sciencePane").style.zIndex = "250";
      L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);
      mapRef.current = map;
      routeGroupRef.current = L.layerGroup().addTo(map);
      walkGroupRef.current = L.layerGroup().addTo(map);
      gridGroupRef.current = L.layerGroup().addTo(map);
      gridLabelRef.current = L.layerGroup().addTo(map);

      /* geographic graticule — redrawn whenever the view moves/zooms */
      const redrawGrid = () => updateGrid(map, L);
      redrawGrid();
      map.on("moveend", redrawGrid);
      map.on("zoomend", redrawGrid);

      map.on("mousemove", (e: LT.LeafletMouseEvent) => {
        const now = Date.now();
        if (now - lastMoveRef.current < 120) return;
        lastMoveRef.current = now;
        setCursor({ lon: e.latlng.lng, lat: e.latlng.lat });
      });
      map.on("zoomend", () => setMapZoom(map.getZoom()));
      map.on("click", (e: LT.LeafletMouseEvent) => {
        if (!planModeRef.current) return;
        const n = useStore.getState().route.length + 1;
        useStore.getState().addWaypoint({
          id: `wp-${Date.now()}`,
          name: `WP-${String(n).padStart(2, "0")}`,
          lon: e.latlng.lng,
          lat: e.latlng.lat,
        });
      });

      loadTerrain();
      syncLayers(useStore.getState().layers, L, map);
      drawRoute(useStore.getState().route, L, map);
      const ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(divRef.current);
      setMapReady(true);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    planModeRef.current = planMode;
    if (divRef.current) {
      divRef.current.style.cursor = planMode ? "crosshair" : "";
    }
  }, [planMode]);

  useEffect(() => {
    if (mapRef.current && LRef.current) syncLayers(layers, LRef.current, mapRef.current);
  }, [layers]);

  useEffect(() => {
    if (mapRef.current && LRef.current) drawRoute(route, LRef.current, mapRef.current);
  }, [route, planMode]);

  useEffect(() => {
    if (mapRef.current && focusTarget) {
      mapRef.current.flyTo([focusTarget.lat, focusTarget.lon], focusTarget.zoom ?? mapRef.current.getZoom(), { duration: 1.1 });
    }
  }, [focusTarget]);

  /* ---------- geographic graticule + edge coordinate labels ---------- */
  function updateGrid(map: LT.Map, L: Leaflet) {
    const g = gridGroupRef.current;
    const gl = gridLabelRef.current;
    if (!g || !gl) return;
    g.clearLayers();
    gl.clearLayers();
    const b = map.getBounds();
    const z = map.getZoom();
    const degPerPx = 360 / (TILE_SIZE * Math.pow(2, z));
    const step = GRID_STEPS.find((s) => s >= degPerPx * 110) ?? 45;
    const lat0 = Math.max(-90, b.getSouth());
    const lat1 = Math.min(90, b.getNorth());
    const lon0 = b.getWest();
    const lon1 = b.getEast();
    const i0 = Math.ceil(lon0 / step);
    const i1 = Math.floor(lon1 / step);
    const j0 = Math.ceil(lat0 / step);
    const j1 = Math.floor(lat1 / step);
    const dec = step < 0.01 ? 3 : step < 0.1 ? 2 : step < 10 ? 1 : 0;
    const nLines = Math.max(0, i1 - i0 + 1) + Math.max(0, j1 - j0 + 1);
    const withLabels = nLines <= 46;
    for (let i = i0; i <= i1; i++) {
      const lon = i * step;
      const isAxis = i === 0 || Math.abs(Math.abs(lon) - 180) < step * 0.01;
      L.polyline([[lat0, lon], [lat1, lon]], {
        pane: "gridPane",
        color: isAxis ? "rgba(255,179,71,0.5)" : "rgba(84,224,255,0.3)",
        weight: isAxis ? 1.8 : 1,
        interactive: false,
      }).addTo(g);
      if (withLabels) {
        L.marker([lat1, lon], {
          pane: "gridLabelPane",
          icon: L.divIcon({ className: "", html: `<div class="grid-label">${fmtLonGrid(lon, dec)}</div>` }),
          interactive: false,
          keyboard: false,
        }).addTo(gl);
      }
    }
    for (let j = j0; j <= j1; j++) {
      const lat = j * step;
      if (lat <= -90 || lat >= 90) continue;
      const isAxis = j === 0;
      L.polyline([[lat, lon0], [lat, lon1]], {
        pane: "gridPane",
        color: isAxis ? "rgba(255,179,71,0.5)" : "rgba(84,224,255,0.3)",
        weight: isAxis ? 1.8 : 1,
        interactive: false,
      }).addTo(g);
      if (withLabels) {
        L.marker([lat, lon0], {
          pane: "gridLabelPane",
          icon: L.divIcon({ className: "", html: `<div class="grid-label">${fmtLatGrid(lat, dec)}</div>` }),
          interactive: false,
          keyboard: false,
        }).addTo(gl);
      }
    }
    const kmPerCell = (step * Math.PI * 3396.19) / 180;
    setGridInfo({ step, km: kmPerCell });
  }

  /* ---------- geo layers ---------- */
  function buildGeoLayer(dataKey: string | undefined, L: Leaflet): LT.Layer {
    const group: LT.Layer[] = [];
    if (dataKey === "pois") {
      for (const p of POIS) {
        const cls = p.type === "base" ? "base-icon" : "poi-icon";
        const m = L.marker([p.lat, p.lon], {
          pane: "sciencePane",
          icon: L.divIcon({ className: "", html: `<div class="${cls}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] }),
        });
        m.bindPopup(
          `<div style="font-family:'Share Tech Mono',monospace;font-size:11px;max-width:240px">` +
            `<b style="color:#ffb347">${p.code} — ${p.name}</b><br/>` +
            `<span style="color:#54e0ff">elev ${p.elevM} m · slope ${p.slopeDeg}°</span><br/>${p.objective.slice(0, 180)}…</div>`
        );
        group.push(m);
      }
    } else if (dataKey === "ellipse") {
      const poly = L.polygon(landingEllipseGeo() as never, {
        pane: "sciencePane",
        color: "#54e0ff",
        weight: 1.5,
        dashArray: "6 6",
        fill: true,
        fillOpacity: 0.04,
      });
      poly.bindPopup("InSight landing ellipse — approximate 130 × 27 km footprint (NASA/JPL site selection)");
      group.push(poly);
    } else if (dataKey === "quakes") {
      for (const q of QUAKES.events) {
        const m = L.circleMarker([q.lat, q.lon], { radius: q.mag * 2.4, color: "#f43f5e", weight: 1.5, fillColor: "#f43f5e", fillOpacity: 0.35 });
        m.bindTooltip(q.label, { direction: "top" });
        m.bindPopup(`${q.label}<br/>${QUAKES.note}`);
        group.push(m);
      }
    } else if (dataKey === "geology") {
      for (const f of GEOLOGY.features) {
        if (f.kind === "polygon") {
          const poly = L.polygon(f.coords as never, { pane: "geoPane", color: f.color, weight: 1.5, fill: true, fillOpacity: 0.08 });
          poly.bindTooltip(f.name);
          group.push(poly);
        } else {
          const line = L.polyline(f.coords as never, { pane: "geoPane", color: f.color, weight: 2.5, dashArray: "5 5" });
          line.bindTooltip(f.name);
          group.push(line);
        }
      }
    }
    return L.layerGroup(group);
  }

  const PANE_FOR_GROUP: Record<string, string> = {
    TOPOGRAPHY: "reliefPane",
    THERMAL: "thermalPane",
    HAZARD: "hazardPane",
    GEOPHYSICS: "geoPane",
    SCIENCE: "sciencePane",
    IMAGERY: "overlayPane",
  };

  function syncLayers(layerStates: ReturnType<typeof useStore.getState>["layers"], L: Leaflet, map: LT.Map) {
    const desired = new Map(layerStates.map((l) => [l.def.id, l]));
    for (const [id, rec] of recsRef.current) {
      if (!desired.has(id)) {
        map.removeLayer(rec.layer);
        recsRef.current.delete(id);
      }
    }
    for (const [id, st] of desired) {
      let rec = recsRef.current.get(id);
      if (!rec) {
        let layer: LT.Layer;
        if (st.def.type === "xyz") {
          layer = L.tileLayer(st.def.url!, {
            tileSize: TILE_SIZE,
            zoomOffset: ZOOM_OFFSET,
            maxNativeZoom: (st.def.maxNativeZoom ?? 12) + 1,
            minZoom: MAP_MIN_ZOOM,
            maxZoom: MAP_MAX_ZOOM,
            crossOrigin: true,
          });
        } else if (st.def.type === "image") {
          const [s, w, n, e] = st.def.bounds!;
          layer = L.imageOverlay(st.def.src!, [
            [s, w],
            [n, e],
          ], { pane: PANE_FOR_GROUP[st.def.group] ?? "overlayPane" });
        } else {
          layer = buildGeoLayer(st.def.dataKey, L);
        }
        rec = { layer, visible: false, opacity: -1 };
        recsRef.current.set(id, rec);
      }
      if (st.visible && !rec.visible) {
        rec.layer.addTo(map);
        rec.visible = true;
      } else if (!st.visible && rec.visible) {
        map.removeLayer(rec.layer);
        rec.visible = false;
      }
      if (rec.opacity !== st.opacity) {
        const anyLayer = rec.layer as unknown as { setOpacity?: (v: number) => void };
        anyLayer.setOpacity?.(st.opacity);
        rec.opacity = st.opacity;
      }
      if (st.visible && st.def.type !== "xyz") {
        const anyLayer = rec.layer as unknown as { bringToFront?: () => void };
        anyLayer.bringToFront?.();
      }
    }
  }

  function drawRoute(r: ReturnType<typeof useStore.getState>["route"], L: Leaflet, map: LT.Map) {
    const g = routeGroupRef.current;
    if (!g) return;
    g.clearLayers();
    if (r.length === 0) return;
    const coords = r.map((w) => [w.lat, w.lon]) as [number, number][];
    if (r.length > 1) {
      L.polyline(coords, { pane: "routePane", color: "#ff7a2f", weight: 9, opacity: 0.14 }).addTo(g);
      L.polyline(coords, { pane: "routePane", color: "#ff7a2f", weight: 3, opacity: 0.95, dashArray: "1 0" }).addTo(g);
    }
    r.forEach((w, i) => {
      const isBase = i === 0;
      const icon = L.divIcon({
        className: "",
        html: `<div class="wp-icon" style="${isBase ? "border-color:#4ade80;color:#4ade80;" : ""}">${isBase ? "⌂" : i}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      const m = L.marker([w.lat, w.lon], { pane: "routePane", icon, draggable: planModeRef.current, autoPan: false }).addTo(g);
      m.bindTooltip(`${w.name}${w.elevM !== undefined ? ` · ${w.elevM} m` : ""}${planModeRef.current ? " · drag to move" : ""}`, { direction: "top", offset: [0, -14], permanent: true, className: "wp-label" });
      m.on("dragend", () => {
        const ll = m.getLatLng();
        useStore.getState().updateWaypointPos(w.id, ll.lng, ll.lat);
      });
    });
    void map;
  }

  /* ---------- walk simulation: astronaut marker + map follow + traveled trail ---------- */
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const g = walkGroupRef.current;
    if (!L || !map || !g) return;
    if (!walkActive) {
      if (astroRef.current) {
        map.removeLayer(astroRef.current);
        astroRef.current = null;
      }
      if (trailRef.current) {
        map.removeLayer(trailRef.current);
        trailRef.current = null;
      }
      return;
    }
  }, [walkActive]);

  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const g = walkGroupRef.current;
    if (!L || !map || !g || !walkActive || !walkReadout) return;
    const r = walkReadout;
    const pos: [number, number] = [r.lat, r.lon];

    if (!astroRef.current) {
      astroRef.current = L.marker(pos, { pane: "routePane", icon: astroDivIcon(L, false), zIndexOffset: 1000, interactive: false }).addTo(g);
    } else {
      astroRef.current.setLatLng(pos);
    }

    /* traveled trail: route vertices up to current leg + current position */
    const st = useStore.getState();
    const done = st.route.slice(0, Math.min(r.legIdx + 1, st.route.length)).map((w) => [w.lat, w.lon] as [number, number]);
    done.push(pos);
    if (!trailRef.current) {
      trailRef.current = L.polyline(done, { pane: "routePane", color: "#54e0ff", weight: 3.5, opacity: 0.9 }).addTo(g);
    } else {
      trailRef.current.setLatLngs(done);
    }

    /* camera follows the astronaut */
    map.panTo(pos, { animate: false });
  }, [walkActive, walkReadout]);

  /* ---------- idle location beacon: astronaut marker pinned at the current site ---------- */
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const g = walkGroupRef.current;
    if (!mapReady || !L || !map || !g) return;
    if (!walkActive) {
      const pos: [number, number] = [site.lat, site.lon];
      if (!idleBeaconRef.current) {
        idleBeaconRef.current = L.marker(pos, { pane: "sciencePane", icon: astroDivIcon(L, true), zIndexOffset: 900, interactive: false }).addTo(g);
      } else {
        idleBeaconRef.current.setLatLng(pos);
      }
    } else if (idleBeaconRef.current) {
      map.removeLayer(idleBeaconRef.current);
      idleBeaconRef.current = null;
    }
  }, [walkActive, site.lat, site.lon, mapReady]);

  /* ---------- follow mission relocations (Locations panel / manual coords) ---------- */
  useEffect(() => {
    if (siteNonce > 0 && mapRef.current) {
      mapRef.current.flyTo([site.lat, site.lon], 13, { duration: 1.4 });
    }
  }, [siteNonce, site.lat, site.lon]);

  return (
    <>
      <div ref={divRef} className="absolute inset-0 z-0 h-full w-full" aria-label="Mars surface map" />
      {gridInfo && (
        <div className="no-print pointer-events-none absolute left-2 top-2 z-[400] md:left-3">
          <span className="hud-chip bg-[rgba(5,8,12,0.8)] !text-[var(--hud-cyan)]">
            grid {gridInfo.step < 0.01 ? gridInfo.step.toFixed(3) : gridInfo.step < 1 ? gridInfo.step.toFixed(2) : gridInfo.step.toFixed(0)}° ≈{" "}
            {gridInfo.km >= 1 ? `${gridInfo.km.toFixed(gridInfo.km < 10 ? 1 : 0)} km` : `${(gridInfo.km * 1000).toFixed(0)} m`} / cell · mars-2000 lon-lat
          </span>
        </div>
      )}
    </>
  );
}

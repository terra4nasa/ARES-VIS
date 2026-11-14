"use client";
/**
 * LOCATION CONTROL — pick a named Mars site, search by name, or type raw
 * coordinates (name *or* lat/lon — either one alone works). Relocation resets
 * the EVA, re-seeds the route around the new site, rebuilds the 3D scene and
 * recentres the map + beacon.
 */
import { useMemo, useState } from "react";
import { CircleCheck, Crosshair, Footprints, MapPin, TriangleAlert } from "lucide-react";
import { useStore } from "@/lib/store";
import { PanelFrame } from "./PanelFrame";
import { MARS_SITES, findSitesByName, parseCoordinate, locationName, type MarsSite } from "@/lib/sites";
import { fmtLonLat } from "@/lib/mars";

export function LocationsPanel() {
  const site = useStore((s) => s.site);
  const setLocation = useStore((s) => s.setLocation);
  const focus = useStore((s) => s.focus);
  const startWalk = useStore((s) => s.startWalk);
  const routeLen = useStore((s) => s.route.length);
  const [query, setQuery] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const matches = useMemo(() => (query.trim().length >= 2 ? findSitesByName(query).slice(0, 6) : []), [query]);

  const apply = (p: { lon: number; lat: number; name?: string; elevM?: number; kind?: string; source?: "gazetteer" | "coords" }, label: string) => {
    setError(null);
    setOkMsg(`Relocated to ${label} — environment rebuilt.`);
    setLocation(p);
  };

  const submitName = () => {
    const found = findSitesByName(query);
    if (found.length === 0) {
      setOkMsg(null);
      setError(`No known Mars site named “${query.trim()}”. Try one of the sites below, or switch to coordinates.`);
      return;
    }
    apply({ lon: found[0].lon, lat: found[0].lat, name: found[0].name, elevM: found[0].elevM, kind: found[0].kind, source: "gazetteer" }, found[0].name);
    setQuery("");
  };

  const submitCoords = () => {
    const pLat = parseCoordinate(lat, "lat");
    if ("error" in pLat) {
      setOkMsg(null);
      setError(pLat.error);
      return;
    }
    const pLon = parseCoordinate(lon, "lon");
    if ("error" in pLon) {
      setOkMsg(null);
      setError(pLon.error);
      return;
    }
    apply({ lon: pLon.value, lat: pLat.value, name: locationName(pLon.value, pLat.value), source: "coords" }, `${pLat.value.toFixed(3)}°, ${pLon.value.toFixed(3)}°`);
    setLat("");
    setLon("");
  };

  return (
    <PanelFrame id="locations" title="LOCATION CONTROL" subtitle="mars sites · manual input · beacon">
      <div className="space-y-4">
        {/* current location */}
        <section className="rounded-sm border border-[rgba(84,224,255,0.4)] bg-[rgba(84,224,255,0.05)] p-3">
          <h3 className="hud-label mb-2 text-[var(--hud-cyan)]">current location · live beacon</h3>
          <div className="font-display text-[15px] leading-snug text-[var(--hud-amber)] hud-glow">{site.name}</div>
          <div className="hud-label mt-1">{site.region}</div>
          <div className="mt-1.5 flex items-center justify-between text-[11px]">
            <span className="text-[var(--hud-cyan)] hud-glow-cyan">{fmtLonLat(site.lon, site.lat)}</span>
            <span className="hud-chip !py-0.5 !text-[9px]">{site.elevM !== undefined ? `${site.elevM} m` : "—"} · {site.source}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="hud-btn !min-h-0 !py-2" onClick={() => focus(site.lon, site.lat, 13)} title="Centre the map on the beacon">
              <Crosshair className="h-4 w-4" /> centre map
            </button>
            <button className="hud-btn active !min-h-0 !py-2" disabled={routeLen < 2} onClick={() => startWalk()} title="Start the EVA at this location in the helmet visor">
              <Footprints className="h-4 w-4" /> walk here
            </button>
          </div>
        </section>

        {/* manual input — name OR coordinates */}
        <section className="rounded-sm border border-[var(--hud-border-dim)] bg-[rgba(10,15,22,0.6)] p-3">
          <h3 className="hud-label mb-2 text-[var(--hud-orange)]">go to… (name or coordinates)</h3>
          <div className="space-y-2">
            <div>
              <div className="mb-1 text-[11px] text-[var(--hud-text)]">Named site</div>
              <div className="flex gap-1.5">
                <input
                  className="hud-input"
                  placeholder="e.g. Jezero, Olympus Mons, Hellas…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitName();
                  }}
                  aria-label="Site name"
                />
                <button className="hud-btn !min-h-0 shrink-0 !px-3" onClick={submitName} disabled={!query.trim()}>
                  <MapPin className="h-4 w-4" /> go
                </button>
              </div>
              {matches.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {matches.map((s) => (
                    <button key={s.id} className="hud-chip hover:!border-[var(--hud-cyan)] hover:!text-[var(--hud-cyan)]" onClick={() => apply({ lon: s.lon, lat: s.lat, name: s.name, elevM: s.elevM, kind: s.kind, source: "gazetteer" }, s.name)}>
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-[rgba(255,255,255,0.06)] pt-2">
              <div className="mb-1 text-[11px] text-[var(--hud-text)]">Latitude &amp; longitude (either suffix N/S/E/W or signed decimal)</div>
              <div className="flex gap-1.5">
                <input className="hud-input" placeholder="lat · 18.44 N" value={lat} onChange={(e) => setLat(e.target.value)} aria-label="Latitude" />
                <input className="hud-input" placeholder="lon · 77.45 E" value={lon} onChange={(e) => setLon(e.target.value)} aria-label="Longitude" />
                <button className="hud-btn !min-h-0 shrink-0 !px-3" onClick={submitCoords} disabled={!lat.trim() && !lon.trim()}>
                  set
                </button>
              </div>
              <p className="mt-1 text-[9px] text-[var(--hud-dim)]">Valid range: lat −90…90 · lon −180…180 (IAU east-positive). Coordinates alone are enough — the location is auto-named.</p>
            </div>
          </div>
          {error && (
            <div className="mt-2 flex items-start gap-2 rounded-sm border border-[rgba(248,113,113,0.4)] bg-[rgba(248,113,113,0.07)] p-2 text-[11px] text-[var(--hud-red)]">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {okMsg && (
            <div className="mt-2 flex items-start gap-2 rounded-sm border border-[rgba(74,222,128,0.4)] bg-[rgba(74,222,128,0.07)] p-2 text-[11px] text-[var(--hud-green)]">
              <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{okMsg}</span>
            </div>
          )}
        </section>

        {/* gazetteer */}
        <section className="rounded-sm border border-[var(--hud-border-dim)] p-3">
          <h3 className="hud-label mb-2 text-[var(--hud-orange)]">named mars sites ({MARS_SITES.length})</h3>
          <div className="hud-scroll max-h-[260px] space-y-1.5 overflow-y-auto pr-1">
            {MARS_SITES.map((s) => (
              <SiteRow key={s.id} site={s} active={site.name === s.name} onPick={() => apply({ lon: s.lon, lat: s.lat, name: s.name, elevM: s.elevM, kind: s.kind, source: "gazetteer" }, s.name)} />
            ))}
          </div>
          <p className="mt-2 text-[9px] leading-relaxed text-[var(--hud-dim)]">
            Coordinates are approximate published values (IAU east-positive, ±180°). Relocating resets the EVA and re-seeds the route; the 3D surface scene rebuilds with terrain unique to each site.
          </p>
        </section>
      </div>
    </PanelFrame>
  );
}

function SiteRow({ site, active, onPick }: { site: MarsSite; active: boolean; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      className={`flex w-full items-center gap-2 rounded-sm border px-2 py-1.5 text-left transition-colors ${
        active ? "border-[var(--hud-orange)] bg-[rgba(255,122,47,0.14)]" : "border-[rgba(255,255,255,0.06)] hover:border-[var(--hud-border)] hover:bg-[rgba(255,122,47,0.06)]"
      }`}
      title={site.note}
    >
      <MapPin className={`h-3.5 w-3.5 shrink-0 ${active ? "text-[var(--hud-orange)]" : "text-[var(--hud-cyan)]"}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] text-[var(--hud-text)]">{site.name}</span>
        <span className="hud-label block truncate">{site.kind} · {fmtLonLat(site.lon, site.lat)}{site.elevM !== undefined ? ` · ${site.elevM} m` : ""}</span>
      </span>
    </button>
  );
}

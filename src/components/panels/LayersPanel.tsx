"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { customToLayerDef, PLANNED_ENDPOINTS, type LayerDef } from "@/lib/layers";
import { PanelFrame } from "./PanelFrame";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";

const GROUPS = ["IMAGERY", "TOPOGRAPHY", "THERMAL", "HAZARD", "SCIENCE", "GEOPHYSICS"] as const;

export function LayersPanel() {
  const layers = useStore((s) => s.layers);
  const toggleLayer = useStore((s) => s.toggleLayer);
  const setLayerOpacity = useStore((s) => s.setLayerOpacity);
  const addCustomLayer = useStore((s) => s.addCustomLayer);
  const removeCustomLayer = useStore((s) => s.removeCustomLayer);
  const [dialogOpen, setDialogOpen] = useState(false);

  const persistCustoms = (defs: LayerDef[]) => {
    const route = useStore.getState().route;
    const eva = useStore.getState().eva;
    localStorage.setItem(
      "aresvis-state-v1",
      JSON.stringify({ customLayers: defs, route, eva, bootDone: useStore.getState().bootDone })
    );
  };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = e.currentTarget;
    const name = (f.elements.namedItem("name") as HTMLInputElement).value.trim();
    const type = (f.elements.namedItem("type") as HTMLSelectElement).value as "xyz" | "image";
    const url = (f.elements.namedItem("url") as HTMLInputElement).value.trim();
    const maxNative = parseInt((f.elements.namedItem("maxNative") as HTMLInputElement).value || "12", 10);
    const attribution = (f.elements.namedItem("attribution") as HTMLInputElement).value.trim();
    if (!url) {
      toast.error("URL is required");
      return;
    }
    if (type === "xyz" && !url.includes("{z}") && !url.includes("{x}") && !url.includes("{y}")) {
      toast.error("XYZ template must contain {z} {x} {y}");
      return;
    }
    let bounds: [number, number, number, number] | undefined;
    if (type === "image") {
      bounds = [-90, -180, 90, 180];
      const s = parseFloat((f.elements.namedItem("bSouth") as HTMLInputElement).value);
      const w = parseFloat((f.elements.namedItem("bWest") as HTMLInputElement).value);
      const n = parseFloat((f.elements.namedItem("bNorth") as HTMLInputElement).value);
      const eo = parseFloat((f.elements.namedItem("bEast") as HTMLInputElement).value);
      if ([s, w, n, eo].every((v) => !isNaN(v))) bounds = [s, w, n, eo];
    }
    const def = customToLayerDef({ name, type, url, bounds, maxNativeZoom: isNaN(maxNative) ? undefined : maxNative, attribution }, 0);
    addCustomLayer(def);
    persistCustoms([...useStore.getState().layers.filter((l) => l.def.custom).map((l) => l.def)]);
    setDialogOpen(false);
    toast.success(`Layer "${name}" added`);
  };

  return (
    <PanelFrame id="layers" title="LAYER STACK" subtitle="toggle · opacity · plug in new APIs">
      <div className="space-y-4">
        {GROUPS.map((g) => {
          const groupLayers = layers.filter((l) => l.def.group === g);
          if (!groupLayers.length) return null;
          return (
            <section key={g}>
              <h3 className="hud-label mb-2 border-b border-[var(--hud-border-dim)] pb-1 text-[var(--hud-orange)]">{g}</h3>
              <div className="space-y-2.5">
                {groupLayers.map(({ def, visible, opacity }) => (
                  <div key={def.id} className="rounded-sm border border-[var(--hud-border-dim)] bg-[rgba(10,15,22,0.6)] p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs text-[var(--hud-text)]">{def.name}</div>
                        <div className="hud-label mt-0.5 truncate">{def.instrument}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {def.custom && (
                          <button
                            className="text-[var(--hud-red)] hover:scale-110"
                            aria-label={`Remove ${def.name}`}
                            onClick={() => {
                              removeCustomLayer(def.id);
                              persistCustoms(useStore.getState().layers.filter((l) => l.def.custom).map((l) => l.def));
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <Switch checked={visible} onCheckedChange={() => toggleLayer(def.id)} aria-label={`Toggle ${def.name}`} />
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="hud-label w-10">opac</span>
                      <Slider
                        value={[opacity * 100]}
                        min={5}
                        max={100}
                        step={5}
                        onValueChange={(v) => setLayerOpacity(def.id, v[0] / 100)}
                        className="flex-1"
                        aria-label={`Opacity for ${def.name}`}
                      />
                      <span className="w-8 text-right text-[10px] text-[var(--hud-dim)]">{Math.round(opacity * 100)}%</span>
                    </div>
                    {def.note && <p className="mt-1.5 text-[10px] leading-snug text-[var(--hud-dim)]">{def.note}</p>}
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        <button className="hud-btn w-full" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" /> add custom layer / api
        </button>

        <details className="rounded-sm border border-[var(--hud-border-dim)] p-3 text-[11px] text-[var(--hud-dim)]">
          <summary className="hud-label cursor-pointer text-[var(--hud-cyan)]">planned api endpoints (modular registry)</summary>
          <ul className="mt-2 space-y-1.5">
            {PLANNED_ENDPOINTS.map((p) => (
              <li key={p.name} className="flex items-start gap-2">
                <span className="hud-chip mt-0.5 shrink-0">{p.status}</span>
                <span>
                  <b className="text-[var(--hud-text)]">{p.name}</b> — {p.api}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 leading-snug">
            The renderer accepts XYZ tile templates, image overlays and GeoJSON sources — any future NASA API that resolves to
            one of these can be plugged in without code changes via “Add custom layer”.
          </p>
        </details>
      </div>

      {dialogOpen && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Add custom layer">
          <form onSubmit={submit} className="hud-panel w-full max-w-md space-y-3 p-5">
            <h3 className="font-display text-sm tracking-[0.2em] text-[var(--hud-amber)]">ADD LAYER SOURCE</h3>
            <div>
              <label className="hud-label">layer name</label>
              <input name="name" className="hud-input mt-1" placeholder="My mission overlay" required />
            </div>
            <div>
              <label className="hud-label">source type</label>
              <select name="type" className="hud-input mt-1" defaultValue="xyz">
                <option value="xyz">XYZ tile template (e.g. Mars Trek / future WMTS)</option>
                <option value="image">Geo-referenced image overlay (PNG/JPG)</option>
              </select>
            </div>
            <div>
              <label className="hud-label">url</label>
              <input name="url" className="hud-input mt-1" placeholder="https://…/{z}/{y}/{x}.png  or  image url" required />
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className="hud-label">s lat</label>
                <input name="bSouth" className="hud-input mt-1" placeholder="-90" inputMode="decimal" />
              </div>
              <div>
                <label className="hud-label">w lon</label>
                <input name="bWest" className="hud-input mt-1" placeholder="-180" inputMode="decimal" />
              </div>
              <div>
                <label className="hud-label">n lat</label>
                <input name="bNorth" className="hud-input mt-1" placeholder="90" inputMode="decimal" />
              </div>
              <div>
                <label className="hud-label">e lon</label>
                <input name="bEast" className="hud-input mt-1" placeholder="180" inputMode="decimal" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="hud-label">max server level (xyz)</label>
                <input name="maxNative" className="hud-input mt-1" placeholder="12" inputMode="numeric" />
              </div>
              <div>
                <label className="hud-label">attribution</label>
                <input name="attribution" className="hud-input mt-1" placeholder="Source name" />
              </div>
            </div>
            <p className="text-[10px] leading-snug text-[var(--hud-dim)]">
              Mars tile services using plate carrée (EPSG-like lat/lon grid, Mars-2000 sphere) — e.g. USGS OnMars — work
              directly. Earth-Web-Mercator sources need reprojection.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="hud-btn" onClick={() => setDialogOpen(false)}>
                cancel
              </button>
              <button type="submit" className="hud-btn active">
                add layer
              </button>
            </div>
          </form>
        </div>
      )}
    </PanelFrame>
  );
}

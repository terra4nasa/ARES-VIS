"use client";
import { ExternalLink } from "lucide-react";
import { CATALOG } from "@/lib/data";
import { PLANNED_ENDPOINTS } from "@/lib/layers";
import { PanelFrame } from "./PanelFrame";

export function CatalogPanel() {
  return (
    <PanelFrame id="catalog" title="DATA CATALOG" subtitle="nasa missions behind every layer">
      <div className="space-y-3">
        {CATALOG.map((c) => (
          <article key={c.name} className="rounded-sm border border-[var(--hud-border-dim)] bg-[rgba(10,15,22,0.6)] p-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-xs font-bold text-[var(--hud-amber)]">{c.name}</h3>
              {c.live && <span className="hud-chip blink !text-[var(--hud-green)] !border-[rgba(74,222,128,0.4)]">live</span>}
            </div>
            <div className="hud-label mt-1">{c.kind} · {c.mission}</div>
            <dl className="mt-2 space-y-1 text-[11px]">
              <div className="flex gap-2"><dt className="hud-label w-20 shrink-0">instrument</dt><dd className="text-[var(--hud-text)]">{c.instrument}</dd></div>
              <div className="flex gap-2"><dt className="hud-label w-20 shrink-0">resolution</dt><dd className="text-[var(--hud-text)]">{c.resolution}</dd></div>
              <div className="flex gap-2"><dt className="hud-label w-20 shrink-0">coverage</dt><dd className="text-[var(--hud-text)]">{c.coverage}</dd></div>
              <div className="flex gap-2"><dt className="hud-label w-20 shrink-0">source</dt><dd className="text-[var(--hud-text)]">{c.source}</dd></div>
              <div className="flex gap-2"><dt className="hud-label w-20 shrink-0">used as</dt><dd className="text-[var(--hud-cyan)]">{c.usedAs}</dd></div>
            </dl>
            <a href={c.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[10px] text-[var(--hud-cyan)] underline-offset-2 hover:underline">
              <ExternalLink className="h-3 w-3" /> open source archive
            </a>
          </article>
        ))}
        <section className="rounded-sm border border-[var(--hud-border-dim)] p-3">
          <h3 className="hud-label mb-2 text-[var(--hud-orange)]">planned integrations</h3>
          <ul className="space-y-1.5 text-[11px] text-[var(--hud-dim)]">
            {PLANNED_ENDPOINTS.map((p) => (
              <li key={p.name} className="flex items-start gap-2">
                <span className="hud-chip mt-0.5 shrink-0">{p.status}</span>
                <span><b className="text-[var(--hud-text)]">{p.name}</b> — {p.api}</span>
              </li>
            ))}
          </ul>
        </section>
        <p className="text-[10px] leading-snug text-[var(--hud-dim)]">
          Processed assets (relief renders, hazard overlay, terrain grids, POV images) were generated from the sources
          above at build time — see scripts/generate_assets.py in the project repository for the full pipeline.
        </p>
      </div>
    </PanelFrame>
  );
}

"use client";
/**
 * FirstPersonTerrain — full-viewport first-person view rendered behind the
 * helmet HUD while the astronaut physically walks the route.
 *
 * Hosts the WebGL engine (fpv3d.ts): real DEM terrain with CTX color drape,
 * rocks, craters, distant highlands, dust, waypoint beacons and the InSight
 * lander. The camera *is* the astronaut — gait bob, heading eased toward the
 * next waypoint, drag to look around (auto-recenters while walking).
 * Also renders a live idle preview from the start point while in standby.
 * Rebuilds the whole scene when the mission relocates (siteNonce bump).
 */
import { useEffect, useRef, useState } from "react";
import { createFpvScene, type FpvScene } from "@/lib/fpv3d";
import { useStore } from "@/lib/store";

/** per-site scene variation seed (crater fields / mesas / scatter differ) */
function siteSeedOf(lat: number, lon: number): number {
  const a = Math.round((lat + 90) * 4096) & 0x1ffff;
  const b = Math.round((lon + 180) * 4096) & 0x1ffff;
  return ((a * 2654435761) ^ (b * 40503)) >>> 0;
}

export function FirstPersonTerrain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<FpvScene | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const siteNonce = useStore((s) => s.siteNonce);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let dead = false;
    let scene: FpvScene | null = null;
    const kick = setTimeout(() => {
      if (dead) return;
      setReady(false);
      const site = useStore.getState().site;
      createFpvScene(canvas, {
        seed: siteSeedOf(site.lat, site.lon),
        elev0: site.elevM,
      })
        .then((s) => {
          if (dead) {
            s.dispose();
            return;
          }
          scene = s;
          sceneRef.current = s;
          setReady(true);
        })
        .catch((err) => {
          console.error("[visor] webgl scene failed:", err);
          if (!dead) setFailed(true);
        });
    }, 30);
    return () => {
      dead = true;
      clearTimeout(kick);
      scene?.dispose();
      sceneRef.current = null;
    };
  }, [siteNonce]);

  return (
    <div className={`absolute inset-0 z-[460] overflow-hidden select-none ${ready ? "visor-boot" : ""}`}>
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        style={{ display: ready ? "block" : "none", filter: "saturate(1.05) contrast(1.03)" }}
        aria-label="First-person Mars surface view from the walking astronaut"
      />
      {!ready && !failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#120a06]">
          <div className="text-center">
            <div className="font-display text-[13px] tracking-[0.3em] text-[var(--hud-amber)] blink">CALIBRATING SURFACE OPTICS</div>
            <div className="hud-label mt-2">dem mesh · ctx drape · dust optics</div>
          </div>
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#120a06]">
          <span className="hud-chip">webgl unavailable — surface view disabled</span>
        </div>
      )}
    </div>
  );
}

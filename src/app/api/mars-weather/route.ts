import { NextResponse } from "next/server";

/* Live Mars weather — MAAS2 (api.maas2.apollorion.com), an open mirror of the
 * MSL Curiosity REMS (Rover Environmental Monitoring Station) archive at Gale
 * Crater. Public, no API key. Cached in-memory for 30 min (REMS reports ~one
 * sol per day, so this stays far inside fair use); the last good payload is
 * retained so the panel can show honest STALE data instead of an error if the
 * upstream mirror is briefly unreachable. */
export const dynamic = "force-dynamic";

const TTL_MS = 30 * 60 * 1000;
const ENDPOINT = "https://api.maas2.apollorion.com/";

interface WxPayload {
  sol: number;
  minTemp: number;
  maxTemp: number;
  pressure: number;
  atmo: string;
  season: string;
  sunrise: string;
  sunset: string;
  date: string;
  /** true = fresh from MAAS2 · false = last good payload (upstream down) */
  live: boolean;
  fetchedAt: string;
}

let cached: { at: number; data: WxPayload } | null = null;
let lastGood: WxPayload | null = null;

export async function GET() {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json({ ok: true, ...cached.data });
  }
  try {
    const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(12000) });
    const b = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    /* MAAS2 ships numbers as strings ("sol": "3742") and text/html content-type */
    const num = (v: unknown, f: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : f;
    };
    if (!res.ok || !b || num(b.sol, 0) <= 0) {
      throw new Error(`MAAS2 HTTP ${res.status}`);
    }
    const data: WxPayload = {
      sol: num(b.sol, 0),
      minTemp: Math.round(num(b.min_temp, -90)),
      maxTemp: Math.round(num(b.max_temp, -20)),
      pressure: Math.round(num(b.pressure, 0)),
      atmo: String(b.atmo_opacity ?? "Unknown"),
      season: String(b.season ?? "—"),
      sunrise: String(b.sunrise ?? "—"),
      sunset: String(b.sunset ?? "—"),
      date: String(b.terrestrial_date ?? "—"),
      live: true,
      fetchedAt: new Date().toISOString(),
    };
    cached = { at: Date.now(), data };
    lastGood = data;
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    if (lastGood) {
      return NextResponse.json({ ok: true, ...lastGood, live: false });
    }
    return NextResponse.json(
      { ok: false, error: `REMS mirror unreachable: ${String(e).slice(0, 100)}` },
      { status: 502 },
    );
  }
}

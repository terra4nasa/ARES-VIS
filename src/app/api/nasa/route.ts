import { NextRequest, NextResponse } from "next/server";

/* Live NASA Open APIs (api.nasa.gov) proxy.
   The API key stays server-side (NASA_API_KEY env var, falls back to DEMO_KEY)
   so nothing sensitive ships in the client bundle or the public repo.
   Upstream responses are cached in-memory for 15 min to stay well inside the
   hourly rate limit even with many judges viewing the app at once. */

export const dynamic = "force-dynamic";

const NASA_API_KEY = process.env.NASA_API_KEY ?? "DEMO_KEY";
const KEY_SOURCE = NASA_API_KEY === "DEMO_KEY" ? "demo" : "env";
const TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; data: unknown }>();

async function nasaJson(url: string): Promise<unknown> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => null);
  console.log(
    `[nasa] ${url.replace(/api_key=[^&]+/, "api_key=***")} -> HTTP ${res.status}`,
    body && typeof body === "object" ? JSON.stringify(body).slice(0, 120) : String(body),
  );
  if (!res.ok || !body) {
    const msg =
      body && typeof body === "object" && "error" in (body as Record<string, unknown>)
        ? JSON.stringify((body as Record<string, unknown>).error)
        : `HTTP ${res.status}`;
    throw new Error(`api.nasa.gov: ${msg}`);
  }
  cache.set(url, { at: Date.now(), data: body });
  return body;
}

function todayUtc(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

function isoStamp(s: string): string {
  // "2026-11-11 00:17:52" → parts for the EPIC archive path
  return s.slice(0, 10).replaceAll("-", "/");
}

export async function GET(req: NextRequest) {
  // During the static-export bake (force-static), searchParams access is
  // disallowed — default to "apod" there; runtime requests read the query.
  let dataset = "apod";
  try {
    dataset = req.nextUrl.searchParams.get("dataset") ?? "apod";
  } catch {
    dataset = "apod";
  }
  try {
    if (dataset === "apod") {
      // NASA's "today" APOD entry occasionally 500s upstream — retry with
      // yesterday's entry so the panel always shows real, dated content.
      let body: Record<string, string> | null = null;
      let fallbackUsed = false;
      for (const offset of [0, -1, -2]) {
        try {
          body = (await nasaJson(
            `https://api.nasa.gov/planetary/apod?api_key=${NASA_API_KEY}&thumbs=true` +
              (offset ? `&date=${todayUtc(offset)}` : ""),
          )) as Record<string, string>;
          if (offset) fallbackUsed = true;
          break;
        } catch {
          continue;
        }
      }
      if (!body) throw new Error("APOD unavailable for today and recent dates");
      return NextResponse.json({
        dataset,
        keySource: KEY_SOURCE,
        live: true,
        fallbackUsed,
        date: body.date,
        title: body.title,
        explanation: body.explanation,
        url: body.thumbnail_url && body.media_type === "video" ? body.thumbnail_url : body.url,
        hdurl: body.hdurl,
        mediaType: body.media_type,
        copyright: body.copyright ?? null,
      });
    }

    if (dataset === "epic") {
      interface EpicVec { x: number; y: number; z: number }
      interface EpicFrame {
        identifier: string;
        date: string;
        caption: string;
        image: string;
        centroid_coordinates: { lat: number; lon: number };
        dscovr_j2000_position: EpicVec;
      }
      const arr = (await nasaJson(
        `https://api.nasa.gov/EPIC/api/natural?api_key=${NASA_API_KEY}`,
      )) as EpicFrame[];
      const latest = arr?.[0];
      if (!latest) throw new Error("EPIC returned no frames");
      const stamp = isoStamp(latest.date);
      return NextResponse.json({
        dataset,
        keySource: KEY_SOURCE,
        live: true,
        date: latest.date,
        caption: latest.caption,
        imageUrl: `https://epic.gsfc.nasa.gov/archive/natural/${stamp}/jpg/${latest.image}.jpg`,
        centroid: latest.centroid_coordinates,
        dscovrKm: Math.hypot(latest.dscovr_j2000_position.x, latest.dscovr_j2000_position.y, latest.dscovr_j2000_position.z),
      });
    }

    if (dataset === "neo") {
      interface NeoObject {
        name: string;
        is_potentially_hazardous_asteroid: boolean;
        estimated_diameter?: { meters?: { estimated_diameter_min?: number; estimated_diameter_max?: number } };
        close_approach_data?: Array<{
          close_approach_date?: string;
          close_approach_date_full?: string;
          miss_distance?: { kilometers?: string };
          relative_velocity?: { kilometers_per_second?: string };
        }>;
      }
      interface NeoFeed { near_earth_objects: Record<string, NeoObject[]> }
      const start = todayUtc();
      const end = todayUtc(1);
      const r = (await nasaJson(
        `https://api.nasa.gov/neo/rest/v1/feed?start_date=${start}&end_date=${end}&api_key=${NASA_API_KEY}`,
      )) as NeoFeed;
      const all = Object.values(r.near_earth_objects).flat();
      if (!all.length) throw new Error("NEO feed returned no objects");
      const shaped = all
        .map((o) => {
          const c = o.close_approach_data?.[0] ?? {};
          const d = o.estimated_diameter?.meters ?? {};
          return {
            name: o.name,
            km: Number(c.miss_distance?.kilometers ?? NaN),
            kmPerS: Number(c.relative_velocity?.kilometers_per_second ?? NaN),
            diameterM: [
              Number(d.estimated_diameter_min ?? NaN),
              Number(d.estimated_diameter_max ?? NaN),
            ],
            hazardous: Boolean(o.is_potentially_hazardous_asteroid),
            when: c.close_approach_date_full ?? c.close_approach_date ?? "",
          };
        })
        .filter((o) => Number.isFinite(o.km))
        .sort((a, b) => a.km - b.km);
      return NextResponse.json({
        dataset,
        keySource: KEY_SOURCE,
        live: true,
        window: [start, end],
        count: shaped.length,
        hazardousCount: shaped.filter((o) => o.hazardous).length,
        closest: shaped[0],
        top: shaped.slice(0, 4),
      });
    }

    return NextResponse.json({ error: `unknown dataset "${dataset}"` }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "upstream failure", dataset },
      { status: 502 },
    );
  }
}

import { NextResponse } from "next/server";
import { buildSpaceWeather, fetchNoaaRows } from "@/lib/spaceweather";

/* Live per-request rendering on servers. The GitHub Pages export workflow
   (.github/workflows/github-pages.yml) swaps this single line to
   "force-dynamic" with sed before `next build`, so the route can be
   prerendered for the static site. */
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await fetchNoaaRows();
  return NextResponse.json(buildSpaceWeather(rows));
}

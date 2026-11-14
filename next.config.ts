import type { NextConfig } from "next";

/* Build modes:
 * - default            → "standalone" server build (Docker / self-hosting / cloud)
 * - NEXT_OUTPUT=export → fully static site for GitHub Pages (client-only; the
 *                        space-weather panel falls back to direct NOAA fetches)
 * NEXT_BASE_PATH=/ARES-VIS sets the project-page base path for the Pages deploy. */
const isExport = process.env.NEXT_OUTPUT === "export";
const basePath = process.env.NEXT_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  ...(isExport
    ? {
        output: "export" as const,
        basePath,
        assetPrefix: basePath ? `${basePath}/` : undefined,
        images: { unoptimized: true },
      }
    : { output: "standalone" as const }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;

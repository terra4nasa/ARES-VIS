#!/usr/bin/env bash
# Build the static GitHub Pages export (out/) for ARES-VIS.
# Dynamic route handlers (/api/spaceweather, /api/nasa) must be prerenderable:
# swap force-dynamic → force-static so `next build` executes each once at
# build time and bakes a snapshot; the client-side code keeps data live via
# direct NOAA / api.nasa.gov fetches. Route files are restored on exit.
set -euo pipefail
# Repo root, resolved from this script's location (works locally and on CI)
cd "$(dirname "$0")/.."

ROUTES=(src/app/api/spaceweather/route.ts src/app/api/nasa/route.ts)
BACKUPS=()
cleanup() {
  for i in "${!ROUTES[@]}"; do
    mv "${BACKUPS[$i]}" "${ROUTES[$i]}" 2>/dev/null || true
  done
}
trap cleanup EXIT

for ROUTE in "${ROUTES[@]}"; do
  BACKUP="$ROUTE.export-backup"
  BACKUPS+=("$BACKUP")
  cp "$ROUTE" "$BACKUP"
  sed -i 's/export const dynamic = "force-dynamic";/export const dynamic = "force-static";/' "$ROUTE"
done

NEXT_OUTPUT=export NEXT_BASE_PATH=/ARES-VIS npx next build

# Pages' Jekyll step would ignore _next/ without this marker
touch out/.nojekyll

echo "--- export complete ---"
ls out/ | head -6

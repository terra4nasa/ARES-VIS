# ARES-VIS — Elysium Marswalk Planner

**NASA Space Apps 2026 · Interplanetary Survival Guide: Martian Map**

**🔴 Live app:** **[https://ares-vis.vercel.app](https://ares-vis.vercel.app/)**
— full 2D planner + 3D visor + NASA live data (APOD, EPIC, NEO watch, space weather).

ARES-VIS fuses decades of robotic Mars-mission data into one hyper-local planning
tool for a Marswalk across **Elysium Planitia** — the plains where NASA's InSight
lander listened to Mars quakes for four years. Plan the EVA on a 2D orbital map,
then step into a first-person **3D helmet visor** and physically walk the route.

> **ARES** = the Greek counterpart of Mars · **VIS** = the helmet **VIS**or

## Features

- **2D mission map (Leaflet)** — real Mars tile layers: MRO CTX / Viking optical,
  MGS MOLA relief, Odyssey THEMIS day & night infrared, slope-hazard science
  layers, POI markers for the InSight landing site and science caches
- **EVA planner** — click waypoints, get distance / ETA / elevation profile,
  slope-adjusted walking speed, O₂ budget with the 40 % turnaround rule,
  radiation dose accumulation and GO / NO-GO verdicts
- **First-person 3D visor (Three.js/WebGL)** — HRSC-MOLA hybrid DEM terrain
  (200 m/px), procedural crater field, ~15 k instanced rocks, distant highland
  ring, drifting dust, PCF **sun shadows** from the true LST sun position, and a
  detailed **InSight lander** model
- **Dash-to-walk manual control** — hands-free auto-traverse *or* take the foot
  controls: `WASD` / arrow keys / on-screen D-pad, **SHIFT to dash**, drag to
  look around; speed reacts to the local terrain gradient
- **3D sample collection** — 12 beaconed science targets along the traverse;
  aim within ~26° of the reticle inside 7 m and press **[E]** (or the HUD button)
  to secure the rock into the sample tray
- **Live space weather** — NOAA SWPC feeds + a Keplerian Earth–Mars orbit model
  (distance, one-way light time) drive the dose / GO-NO-GO logic
- **NASA live feed panel** — real-time data straight from [api.nasa.gov](https://api.nasa.gov/):
  the **Astronomy Picture of the Day** (crew sky report), the latest **EPIC**
  full-disc Earth from DSCOVR/L1 ("home, 20 light-minutes away"), and a
  **near-Earth-object watch** (closest approaches, hazard flags) — fetched
  server-side through `/api/nasa` so the API key never reaches the browser
- **Mission brief export** — downloadable text brief + GPX track with
  HRSC-MOLA elevations

Everything runs client-side; the only server components are optional proxies
(`/api/spaceweather`, `/api/nasa`) — the UI degrades gracefully to bundled
defaults and honest STANDBY states when they are unavailable.

## Quick start (local development)

Prerequisite: **Node.js ≥ 20.9** (or **Bun ≥ 1.2**). No database, no required
environment variables. The NASA live-feed panel works out of the box on a
shared `DEMO_KEY`; for full rate limits (recommended for demo day) get a free
key at <https://api.nasa.gov/> and set it locally:

```bash
echo "NASA_API_KEY=your_key_here" > .env.local   # gitignored, never committed
```

```bash
git clone https://github.com/terra4nasa/ARES-VIS.git
cd ARES-VIS
npm install        # or: bun install
npm run dev        # or: bun run dev
```

Open **http://localhost:3000**.

Production build & serve (Next.js *standalone* output):

```bash
npm run build
npm run start        # Bun runtime
# or, with plain Node:
npm run start:node   # node .next/standalone/server.js
```

The standalone server honours `PORT` and `HOSTNAME` (default `3000` / `0.0.0.0`).

---

## 1 · Self-hosted server (VPS / bare metal)

```bash
npm ci              # or: bun install --frozen-lockfile
npm run build
npm run start:node  # serves on 0.0.0.0:3000
```

Keep it alive with **pm2**:

```bash
npm i -g pm2
pm2 start npm --name ares-vis -- run start:node
pm2 save && pm2 startup    # auto-start on boot
```

…or a **systemd** unit (`/etc/systemd/system/ares-vis.service`):

```ini
[Unit]
Description=ARES-VIS Marswalk Planner
After=network.target

[Service]
WorkingDirectory=/opt/ares-vis
ExecStart=/usr/bin/node .next/standalone/server.js
Environment=NODE_ENV=production PORT=3000
Restart=on-failure
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now ares-vis
```

**Nginx reverse proxy** with TLS (`/etc/nginx/sites-available/ares-vis`):

```nginx
server {
    listen 80;
    server_name mars.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

```bash
sudo certbot --nginx -d mars.example.com   # free Let's Encrypt certificate
```

## 2 · Docker / Docker Compose

A multi-stage `Dockerfile` is included (Bun install → Next standalone build →
lean `node:22-alpine` runtime, ~180 MB image).

```bash
# plain Docker
docker build -t ares-vis .
docker run -d -p 3000:3000 --name ares-vis ares-vis

# or Docker Compose
docker compose up -d --build
```

App: http://localhost:3000 · logs: `docker logs -f ares-vis`
Health check is built into the compose file. To change the port:
`docker run -p 8080:3000 ares-vis`.

## 3 · Cloud hosts

| Platform | How | Notes |
|---|---|---|
| **Vercel** (recommended) | Import the repo at vercel.com → Deploy | Zero config; `/api/spaceweather` runs as a serverless function |
| **Netlify** | New site → import repo → build `npm run build` | Add `@netlify/plugin-nextjs`; or deploy the Docker image |
| **Railway** | New project → Deploy from repo | Uses the `Dockerfile` automatically; exposes port 3000 |
| **Render** | New Web Service → Docker runtime | Port auto-detected from the container |
| **Fly.io** | `fly launch` (detects Dockerfile) · `fly deploy` | `fly.toml` not required |
| **Google Cloud Run / AWS App Runner** | Build & push the image, create service on port 3000 | Fully stateless — scale to zero is fine |

Any Node-capable host works the same way: `npm run build && npm run start:node`
behind your load balancer.

## 4 · GitHub Pages (static site)

GitHub Pages only serves static files, so the deploy uses Next's
`output: "export"` mode (`NEXT_OUTPUT=export`).

**One-time setup:** repo **Settings → Pages → Build and deployment → Source:
"GitHub Actions"**.

The included workflow (`.github/workflows/github-pages.yml`) then builds and
publishes on every push to `main`:

- site URL: `https://terra4nasa.github.io/ARES-VIS/`
- `NEXT_BASE_PATH=/ARES-VIS` is applied automatically so all assets resolve

**What works on Pages** — the full 2D planner, all map layers, the 3D visor,
manual walking, sample collection and brief export (all client-rendered).
**Limitation** — there is no server, so `/api/spaceweather` does not exist; the
app automatically falls back to fetching NOAA SWPC directly from the browser
(CORS-enabled endpoints), and to bundled default values if that fails too.

Manual local export (optional):

```bash
NEXT_OUTPUT=export NEXT_BASE_PATH=/ARES-VIS npx next build
# static site lands in ./out
```

---

## Visor controls

| Input | Action |
|---|---|
| `W A S D` / arrows / on-screen D-pad | walk (auto-traverse pauses) |
| `SHIFT` | dash |
| drag on the scene | free look |
| `E` / HUD button | collect the targeted rock sample |
| HUD chips (NAV · EVA · TERRAIN · … · SHADOWS) | toggle visor modules |

## Architecture

```
src/
├─ app/            Next.js App Router (page + /api/spaceweather)
├─ components/
│  ├─ hud/         BootOverlay · Chrome (top bar) · Visor (3D HUD) · FirstPerson
│  ├─ map/         MapCanvas (Leaflet, Mars tile math)
│  └─ panels/      Layers · Route · Science · Conditions · Catalog · Brief
└─ lib/
   ├─ layers.ts    modular layer registry — add a new XYZ/WMTS/GeoJSON layer here
   ├─ fpv3d.ts     first-person WebGL engine (terrain, rocks, lander, shadows,
   │               manual walk, sample capture)
   ├─ walk.ts      EVA simulation (speed, O₂, dose, waypoints)
   ├─ eva.ts       route optimisation + GO/NO-GO
   ├─ mars.ts      Mars geodesy & tile math
   └─ spaceweather.ts NOAA ingestion + Keplerian Earth–Mars model
```

## Data sources & credits

- **USGS Astrogeology / PDS** — HRSC-MOLA hybrid DEM, Viking & MGS MOLA imagery
- **NASA/JPL-Caltech** — MRO Context Camera (CTX) mosaics
- **NASA/ASU** — Mars Odyssey THEMIS day & night infrared mosaics
- **NASA/JPL** — InSight mission (Elysium Planitia landing site, SEIS/HP³)
- **NOAA SWPC** — live space weather (F10.7, GOES proton flux, Kp, solar wind)
- Surface dose model calibrated to **MSL RAD** measurements

Built for the **NASA Space Apps Challenge 2026**. Data products are public
domain / CC-BY where applicable.

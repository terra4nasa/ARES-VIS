# ARES-VIS — Elysium Marswalk Planner
# Build : docker build -t ares-vis .
# Run   : docker run -d -p 3000:3000 --name ares-vis ares-vis

# ---- deps ----
FROM oven/bun:1.2 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- build (standalone server output) ----
FROM oven/bun:1.2 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# package.json "build" = next build + copies static assets into .next/standalone
RUN bun run build

# ---- lean runtime ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder /app/.next/standalone ./
EXPOSE 3000
CMD ["node", "server.js"]

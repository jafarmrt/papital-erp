# Dockerfile — Papital ERP (PHASE 3 / TD-058, v7.0.20 / TD-175)
# Multi-stage: prod-deps (runtime node_modules) + build (vite client + esbuild server) → minimal production runtime.
# The app runs migrations from dist/drizzle at startup (never db:push).
# Build:  docker build -t papital-erp:v<version> .
# Run:    docker run -p 3000:3000 --env-file .env papital-erp:v<version>
# Update: the image has no backup script and nothing takes a backup when it changes (v11, O9): before a new image starts
#         on the database, take a dump from outside the container, e.g.
#           pg_dump --format=custom --file=papital-before-v<version>.dump "$DATABASE_URL"
#         a newer image migrates the database at start, and an older image refuses a migrated database.
#
# v7.0.20 (TD-175): the server bundle is built with `--packages=external`, so every npm
# package (express, pg, drizzle-orm, ...) is `require`d from node_modules at runtime.
# The runtime stage previously shipped no node_modules and crashed on boot with
# "Cannot find module 'express'". Production dependencies are now installed in a
# dedicated stage from the tracked package-lock.json (TD-172) and copied into runtime.

# ---------- Stage 1: production dependencies only ----------
FROM mirror.gcr.io/library/node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
# v7.0.58 (TD-173): SheetJS (xlsx) از فایل داخل مخزن نصب می‌شود (نسخه رسمی فقط روی cdn.sheetjs.com منتشر می‌شود)
COPY vendor ./vendor
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ---------- Stage 2: build ----------
FROM mirror.gcr.io/library/node:24-alpine AS build
WORKDIR /app

# All dependencies (dev deps required for vite/esbuild build), reproducible from the lockfile.
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --no-audit --no-fund

COPY . .
# The image has no .git: pass the commit with --build-arg GIT_COMMIT_SHA=$(git rev-parse HEAD) (dist/build-info.json)
ARG GIT_COMMIT_SHA
# Build the client bundle + server bundle + copies drizzle/ into dist/drizzle (Linux build env)
RUN npm run build

# ---------- Stage 3: runtime ----------
FROM mirror.gcr.io/library/node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Runtime needs: production node_modules, server bundle, client dist, drizzle migrations,
# package.json (version SSOT)
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Writable state directories (mount a volume/PVC on /app/public/uploads in K8s)
RUN mkdir -p public/uploads logs && chown -R node:node /app
USER node

EXPOSE 3000

# Container-level health (K8s probes remain the authoritative gates). v11 (O12, O17): /health/ready, which fails while
# the database is unreachable (/health/startup stays 200 once the server started), on the PORT the server listens on
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health/ready" >/dev/null 2>&1 || exit 1

CMD ["node", "dist/server.cjs"]

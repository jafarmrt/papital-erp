# Dockerfile — Papital ERP (PHASE 3 / TD-058)
# Multi-stage: build (vite client + esbuild server) → minimal production runtime.
# The app runs migrations from dist/drizzle at startup (never db:push).
# Build:  docker build -t papital-erp:v<version> .
# Run:    docker run -p 3000:3000 --env-file .env papital-erp:v<version>

# ---------- Stage 1: build ----------
FROM node:22-alpine AS build
WORKDIR /app

# Install all dependencies (dev deps required for vite/esbuild build).
# NOTE: package-lock.json is not currently tracked in the repository, so npm ci
# cannot be used here — reproducibility debt is tracked in TECH_DEBT.md (TD-058 note).
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .
# Build the client bundle + server bundle + copies drizzle/ into dist/drizzle (Linux build env)
RUN npm run build

# ---------- Stage 2: runtime ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Runtime needs: server bundle, client dist, drizzle migrations, package.json (version SSOT)
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Writable state directories (mount a volume/PVC on /app/public/uploads in K8s)
RUN mkdir -p public/uploads logs && chown -R node:node /app
USER node

EXPOSE 3000

# Container-level liveness fallback (K8s probes remain the authoritative gates)
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health/live >/dev/null 2>&1 || exit 1

CMD ["node", "dist/server.cjs"]

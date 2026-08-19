# SparkSocial API — Azure Container Apps image.
#
# Multi-stage so the runtime layer carries no toolchain. Runs as a non-root user
# because Container Apps does not sandbox the container for you.

FROM node:22-alpine AS deps
WORKDIR /app

# Copy only manifests first so the dependency layer caches across code changes.
#
# Every workspace package's manifest, not just the ones apps/api's own
# package.json lists as direct dependencies — npm workspaces symlinks the
# whole graph from one root install, and `npm ci` needs every workspace
# member's package.json present to resolve package-lock.json's workspace
# section at all. Copying only a handful (as this file used to) either fails
# `npm ci` outright or silently produces an image missing the symlinks for
# whatever wasn't copied — a `Cannot find module '@sparksocial/x'` that only
# ever shows up at runtime in the built image, never in dev.
COPY package.json package-lock.json ./
COPY packages/agency/package.json     packages/agency/
COPY packages/analytics/package.json  packages/analytics/
COPY packages/assemble/package.json   packages/assemble/
COPY packages/assetgraph/package.json packages/assetgraph/
COPY packages/campaign/package.json   packages/campaign/
COPY packages/capture/package.json    packages/capture/
COPY packages/compose/package.json    packages/compose/
COPY packages/db/package.json         packages/db/
COPY packages/engage/package.json     packages/engage/
COPY packages/finish/package.json     packages/finish/
COPY packages/generate/package.json   packages/generate/
COPY packages/genome/package.json     packages/genome/
COPY packages/guardrails/package.json packages/guardrails/
COPY packages/learning/package.json   packages/learning/
COPY packages/playbooks/package.json  packages/playbooks/
COPY packages/publish/package.json    packages/publish/
COPY packages/recipes/package.json    packages/recipes/
COPY packages/shared/package.json     packages/shared/
COPY packages/spark/package.json      packages/spark/
COPY packages/storage/package.json    packages/storage/
COPY packages/tools/package.json      packages/tools/
COPY packages/trends/package.json     packages/trends/
COPY apps/api/package.json            apps/api/
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg + ffprobe for the Finish pipeline (§6.3). Installed here rather than
# via `ffmpeg-static`, whose postinstall downloads a ~70MB binary from GitHub —
# a dependency that fails on any restricted network, which is most CI.
# Alpine's build is ~80MB; if image size becomes the constraint, the swap is a
# separate ffmpeg sidecar, not a smaller ffmpeg.
RUN apk add --no-cache ffmpeg

RUN addgroup -S spark && adduser -S spark -G spark

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY packages ./packages
COPY apps/api ./apps/api

# tsx runs the TypeScript sources directly. The packages are internal workspace
# source, not published artifacts, so there is no build step to keep in sync.
RUN npm i -g tsx@4

USER spark
EXPOSE 8080

# Container Apps injects PORT; REVISION is stamped by the deploy workflow so
# /health can confirm which commit is actually serving traffic.
ENV PORT=8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["tsx", "apps/api/src/index.ts"]

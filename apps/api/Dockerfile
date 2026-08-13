# SparkSocial API — Azure Container Apps image.
#
# Multi-stage so the runtime layer carries no toolchain. Runs as a non-root user
# because Container Apps does not sandbox the container for you.

FROM node:22-alpine AS deps
WORKDIR /app

# Copy only manifests first so the dependency layer caches across code changes.
COPY package.json package-lock.json ./
COPY packages/shared/package.json  packages/shared/
COPY packages/db/package.json      packages/db/
COPY packages/tools/package.json   packages/tools/
COPY packages/genome/package.json  packages/genome/
COPY apps/api/package.json         apps/api/
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

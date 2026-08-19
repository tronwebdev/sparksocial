# SparkSocial web — Azure Container Apps image.
#
# Three stages: `deps` installs the whole workspace (npm workspaces symlinks
# the graph from one root install, so every member's package.json has to be
# present for `npm ci` to resolve package-lock.json's workspace section —
# see apps/api/Dockerfile's own comment on this, the same rule applies here).
# `builder` runs `next build`. `runtime` carries only what `output:
# 'standalone'` produces — a pruned server bundle with no monorepo, no
# toolchain, not even the full node_modules from `deps`.

FROM node:22-alpine AS deps
WORKDIR /app
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
COPY apps/web/package.json            apps/web/
RUN npm ci --ignore-scripts

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY packages ./packages
COPY apps/web ./apps/web

# NEXT_PUBLIC_* values are inlined into the client bundle at build time, not
# read at runtime — they have to be real here, as build args, or the running
# container ships a client bundle with an empty Clerk key / wrong API origin
# baked in, and no env var set on the Container App afterward can fix it.
# `--build-arg` is how the deploy workflow passes these through; see
# .github/workflows/deploy-azure.yml.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
ARG NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
ARG NEXT_PUBLIC_SOCIAL_PROVIDERS=google
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    NEXT_PUBLIC_CLERK_SIGN_IN_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_URL \
    NEXT_PUBLIC_CLERK_SIGN_UP_URL=$NEXT_PUBLIC_CLERK_SIGN_UP_URL \
    NEXT_PUBLIC_SOCIAL_PROVIDERS=$NEXT_PUBLIC_SOCIAL_PROVIDERS \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
    NODE_ENV=production

# `apps/web/package.json`'s own `build` script pins `NEXT_DIST_DIR=.next-build`
# via `cross-env` unconditionally — a fresh container has no locally-running
# dev server to protect from that collision, but the script does it anyway,
# so the standalone output below is read from `.next-build`, not Next's
# default `.next`. Confirmed against a real build, not assumed: the first
# version of this file copied from `.next` and would have produced an image
# with no static assets and a 404 on every page.
RUN npm run build -w @sparksocial/web

# `public/` doesn't exist in this repo yet — `next build` doesn't require it,
# but a later stage's COPY does need the source directory to exist, or the
# build fails outright rather than just producing an image with no public
# assets. Guarantees the COPY below always has something to copy.
RUN mkdir -p apps/web/public

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S spark && adduser -S spark -G spark

# `output: 'standalone'` (next.config.ts) traces the real dependency graph
# and emits a self-contained server + pruned node_modules — nothing from
# `deps`'s full workspace install is copied forward. Path mirrors
# `outputFileTracingRoot` (the repo root), so server.js lands under
# `apps/web/`, not at the standalone root — verified against a real build,
# not assumed from Next's docs, since this exact monorepo path quirk is
# already what `next.config.ts`'s own comment on `outputFileTracingRoot`
# warns is easy to get wrong. `.next-build`, not `.next` — see the `RUN
# npm run build` comment above for why.
COPY --from=builder --chown=spark:spark /app/apps/web/.next-build/standalone ./
COPY --from=builder --chown=spark:spark /app/apps/web/.next-build/static ./apps/web/.next-build/static
COPY --from=builder --chown=spark:spark /app/apps/web/public ./apps/web/public

USER spark
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/sign-in').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]

# SparkSocial API — Azure Container Apps image.
#
# Multi-stage so the runtime layer carries no toolchain. Runs as a non-root user
# because Container Apps does not sandbox the container for you.
#
# ── Debian, not Alpine, and why that had to change ────────────────────────
#
# Both stages were `node:22-alpine`. Two things in this image need a real
# Chromium — Playwright, for the onboarding site crawl, and Remotion, for video
# renders — and neither could have one there:
#
#   * `npm ci --ignore-scripts` (kept, deliberately, see below) means Playwright's
#     postinstall never downloads a browser. So the crawl failed with
#     `browserType.launch: Executable doesn't exist at
#     /home/spark/.cache/ms-playwright/chromium_headless_shell-1234/…` — rendered
#     in full, in red, under "What's your website?" on the second onboarding step.
#   * Running the installer would not have fixed it. Playwright's and Remotion's
#     browser downloads are glibc-linked, and musl cannot execute them. Alpine is
#     not a supported target for either project.
#
# So: Debian for both stages, and one distro Chromium at a stable path shared by
# both consumers. Both stages move together — `@resvg/resvg-js` and
# `@remotion/compositor` ship per-platform native binaries, and installing the
# `-musl` variants for a `-gnu` runtime is a `Cannot find module` that only
# appears in the built image.
#
# One Chromium rather than two: letting each library fetch its own would add
# ~400MB and two revision-numbered paths that move on every dependency bump.
# `/usr/bin/chromium` does not move. `CHROMIUM_PATH` is read by
# `packages/genome/src/crawl.ts` and `apps/api/src/remotion-runner.ts`, and both
# fall back to their library's own resolution when it is unset — so a local
# checkout with `npx playwright install` behaves exactly as it did before.

FROM node:22-bookworm-slim AS deps
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

# `--ignore-scripts` stays. It is the reason Playwright has no browser, but
# fixing that by re-enabling every dependency's postinstall would trade one
# missing binary for arbitrary code execution across the whole dependency tree —
# and `ffmpeg-static`, which this image deliberately does not use, downloads
# ~70MB from GitHub in its own postinstall. The browser is installed explicitly,
# below, where it can be seen.
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg + ffprobe for the Finish pipeline (§6.3), from the distro rather than
# via `ffmpeg-static` — see the note on `--ignore-scripts` above.
#
# chromium for Playwright (the site crawl) and Remotion (video renders).
# `fonts-liberation` because a headless Chromium with no fonts installed renders
# text as empty boxes, which in a video render is a silent defect: the file is
# valid, plays fine, and has no captions in it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ffmpeg \
       chromium \
       fonts-liberation \
       ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# The path both libraries are pointed at. Set here rather than in the deploy
# workflow so the image is self-describing: whatever runs this container gets a
# working browser without knowing it needed to configure one.
ENV CHROMIUM_PATH=/usr/bin/chromium

RUN groupadd -r spark && useradd -r -g spark spark

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY packages ./packages
COPY apps/api ./apps/api

# tsx runs the TypeScript sources directly. The packages are internal workspace
# source, not published artifacts, so there is no build step to keep in sync.
RUN npm i -g tsx@4

# Remotion bundles the composition into a temp dir and Chromium needs a writable
# home for its own profile; neither exists for a `-r` system user by default.
RUN mkdir -p /home/spark && chown -R spark:spark /home/spark
ENV HOME=/home/spark

USER spark
EXPOSE 8080

# Container Apps injects PORT; REVISION is stamped by the deploy workflow so
# /health can confirm which commit is actually serving traffic.
ENV PORT=8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["tsx", "apps/api/src/index.ts"]

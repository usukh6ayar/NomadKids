# The API image — Nest, Prisma, and Chromium for report generation.
#
# ★ Two lines in here are load-bearing in a way that is invisible until a parent
# opens a blank PDF of their child. They are marked below. Read
# docs/PDF_SPIKE.md §4 before touching either.
#
# Chromium comes from the Debian archive rather than Puppeteer's bundled
# download, so the image builds on arm64 (a laptop) and amd64 (Railway, Fly)
# from the same file.

# ─────────────────────────────────────────────────────────────────────────────
# Build
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS build

RUN corepack enable

# ★ OpenSSL, for Prisma.
#
# `node:*-slim` ships without libssl, and Prisma's query engine links against
# it. Without this, `prisma generate` warns that it "failed to detect the
# libssl/openssl version" and defaults to openssl-1.1.x — then the engine
# cannot load at runtime on a Debian 12 image, which is bookworm/openssl-3.
#
# The warning is easy to scroll past because the build still *succeeds*; the
# failure lands later, when the container starts and Prisma cannot open a
# connection. Found on the first Railway deploy.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Skip Puppeteer's ~170 MB Chromium download at install time: the runtime stage
# installs Chromium from apt instead.
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Manifests first, so a source-only change does not re-run the install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile

# ★ The shared tsconfig. Both packages `extends` it, and a missing `extends`
# target is NOT an error in TypeScript — it silently falls back to compiler
# defaults. Those defaults have `esModuleInterop: false`, so the build failed
# deep inside zod's type declarations with fifty TS1259 errors that say nothing
# about the real cause. Found by the first real `docker build`.
COPY tsconfig.base.json ./

COPY packages/contracts packages/contracts
COPY apps/api apps/api

# ★ A placeholder URL, for the BUILD STAGE ONLY.
#
# `prisma generate` reads the schema and writes a client. It never opens a
# connection. But `prisma.config.ts` resolves the datasource through `env()`,
# which throws when the variable is unset — so generate fails at config load,
# with an error about a missing DATABASE_URL that makes it look like the build
# is trying to reach a database it cannot see.
#
# This is safe precisely because it is scoped here: `ENV` does not cross a
# multi-stage boundary, so the runtime stage never sees it and takes the real
# value from the platform. The hostname is deliberately absurd — if it ever did
# leak into a running container, the failure would be immediate and obvious
# rather than a silent connection to something real.
ENV DATABASE_URL="postgresql://build:build@build-time-placeholder.invalid:5432/build"

RUN pnpm --filter contracts build \
 && pnpm --filter @kinder/api prisma:generate \
 && pnpm --filter @kinder/api build \
 && pnpm prune --prod

# ─────────────────────────────────────────────────────────────────────────────
# Runtime
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      # Prisma's query engine links against libssl — see the build stage.
      openssl \
      # fontconfig supplies fc-cache and fc-list. The boot assertion in
      # src/reports/font-check.ts reads fc-list; without this package it falls
      # back to a weaker check.
      fontconfig \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/contracts packages/contracts
COPY --from=build /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/package.json apps/api/package.json

# ★ Migrations run INSIDE the container, as the platform's pre-deploy step.
#
# That needs two things this image did not originally have, and neither failure
# is visible until a real deploy:
#
#   1. `prisma.config.ts` — in Prisma 7 the datasource URL lives here, not in
#      schema.prisma. Without it the CLI has no database to migrate.
#   2. The `prisma` CLI itself — it was a devDependency, so `pnpm prune --prod`
#      deleted it from the image. It is now a runtime dependency for exactly
#      this reason.
#
# The alternative — migrating by hand from a laptop against the production URL —
# is a step somebody eventually forgets, on the deploy where it matters.
COPY --from=build /app/apps/api/prisma.config.ts apps/api/prisma.config.ts

# The application reads these at runtime to embed @font-face in the HTML.
COPY --from=build /app/apps/api/assets apps/api/assets

# ★★ THE TWO LINES. ★★
#
# Chromium renders **no text at all** — not tofu, nothing — when fontconfig has
# an empty font set. Images, borders and page breaks all still work, the job
# reports success, and the family downloads a blank portfolio. Embedding the
# font as @font-face in the HTML does NOT prevent this; the system install is
# what makes Chromium render text at all.
#
# Debian's `chromium` package happens to pull in DejaVu today, which is why the
# bug stays invisible until somebody slims this image, moves to Alpine or
# distroless, or adds --no-install-recommends somewhere new. That is a change
# made six months from now for image size, and the symptom is blank
# parent-facing reports. Do not remove these lines.
#
# docs/PDF_SPIKE.md §4 has the measurements. src/reports/font-check.ts refuses
# to start the worker if they are missing.
COPY apps/api/assets/fonts/ /usr/share/fonts/truetype/kinder/
RUN fc-cache -f && fc-list :lang=mn | head -n 1

# Chromium writes to /dev/shm and to a profile directory; running as root is
# not required and the image should not.
RUN useradd --create-home --shell /bin/bash app \
 && chown -R app:app /app
USER app

EXPOSE 3001

# Liveness only. /health/readiness is authenticated and probes Chromium, Redis,
# storage and the font — that is a deploy-time check, not a per-30-second one.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/main.js"]

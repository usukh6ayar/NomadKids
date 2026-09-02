# The web image — Next.js, server-rendered.
#
# ★ Written for the VPS. On Vercel this file is never read: the platform builds
# from source and there is no container. It exists because the deployment moved
# to a single Datacom VPS on 2026-08-31, where the web app is a service in
# `docker-compose.prod.yml` beside the API.
#
# ★★ Two things here are easy to get wrong and both fail only in the container:
# the standalone trace root, and the build-time public variables. Both are
# marked below.

# ─────────────────────────────────────────────────────────────────────────────
# Build
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS build

RUN corepack enable
WORKDIR /app

# Manifests first, so a source-only change does not re-run the install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile

# The shared tsconfig both packages `extends`. A missing extends target is not
# an error in TypeScript — it silently falls back to compiler defaults, and the
# build fails deep inside a dependency's types saying nothing about the cause.
# The API Dockerfile carries the same note for the same reason.
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/web apps/web

RUN pnpm --filter contracts build

# ★ `NEXT_PUBLIC_*` are inlined at BUILD time, not read at run time.
#
# Next replaces every `process.env.NEXT_PUBLIC_…` with a literal during the
# build, so setting them in `docker-compose.prod.yml` under `environment:` does
# nothing at all — the bundle already contains whatever was present here. They
# are build arguments for exactly that reason.
#
# The failure this prevents is quiet: the app boots, renders, and every API call
# goes to `http://localhost:3001` from the visitor's own browser.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_MEDIA_URL
# ★ `metadataBase` in `app/layout.tsx` reads this. Unset, Next resolves the
# OpenGraph image against `http://localhost:3000` and warns at build time only —
# the deploy is green and every shared link previews a URL nobody can fetch.
ARG NEXT_PUBLIC_SITE_URL

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_MEDIA_URL=$NEXT_PUBLIC_MEDIA_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter @kinder/web build

# ─────────────────────────────────────────────────────────────────────────────
# Runtime
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

# ★★ The standalone bundle keeps the monorepo's own directory shape, because
# `outputFileTracingRoot` in next.config.ts points at the repository root. So
# the server lives at `apps/web/server.js` inside it, not at the top — copying
# it flat produces an image that starts and 404s every route.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

# Next's own server does not need root, and a container that runs as one for no
# reason is a container that hands root away with its first RCE.
RUN useradd --create-home --shell /bin/bash web \
 && chown -R web:web /app
USER web

EXPOSE 3000

# Liveness only, and deliberately a page rather than an API call: this proves
# the Next server is answering, not that the API behind it is.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]

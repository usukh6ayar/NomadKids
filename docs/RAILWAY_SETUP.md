# RAILWAY_SETUP.md

Deploying the NomadKids API to Railway. Written 2026-08-20, after the image and
its migration path were verified locally.

`DEPLOYMENT.md` covers the topology. This is the operational sequence.

---

## 1. What goes where

Railway hosts the **API only** — the NestJS server, its BullMQ report worker,
and Chromium. The Next.js frontend goes to Vercel; the two are separate
deployments that meet over HTTPS.

| Service    | Source                | Notes                                             |
| ---------- | --------------------- | ------------------------------------------------- |
| `api`      | `apps/api/Dockerfile` | the app, the worker and Chromium in one container |
| `postgres` | Railway plugin        | supplies `DATABASE_URL`                           |
| `redis`    | Railway plugin        | supplies `REDIS_URL`                              |

Object storage is **not** on Railway — it is Cloudflare R2, reached over the
S3-compatible API.

### ★ Memory is not optional

The container needs **≥ 1 GB**. `PDF_SPIKE.md` §3 measured a 512 MB floor for a
single render, and 384 MB fails outright. Under-provision it and PDF generation
fails with `Target closed`, which reads like a Puppeteer bug rather than a
capacity problem — and it fails only for the families with the most photos.

If the plan cannot give 1 GB, set `REPORTS_WORKER_ENABLED=false` on the web
service and run a second, larger service for the worker. Do not simply hope.

---

## 2. Environment variables

Railway injects `PORT`, `DATABASE_URL` and `REDIS_URL` from the plugins. The
rest are set by hand.

| Variable                                                                | Value                                                    |
| ----------------------------------------------------------------------- | -------------------------------------------------------- |
| `NODE_ENV`                                                              | `production`                                             |
| `CORS_ORIGINS`                                                          | `https://nomadkids.mn` — exactly this, nothing else      |
| `WEB_ORIGIN`                                                            | `https://nomadkids.mn`                                   |
| `COOKIE_DOMAIN`                                                         | **empty** — host-only is correct, see `SECURITY.md` §3.1 |
| `JWT_SECRET`                                                            | `openssl rand -base64 48`                                |
| `REFRESH_SECRET`                                                        | a **different** `openssl rand -base64 48`                |
| `STORAGE_ENDPOINT`                                                      | the R2 S3 endpoint                                       |
| `STORAGE_BUCKET`                                                        | the R2 bucket name                                       |
| `STORAGE_ACCESS_KEY_ID`                                                 | R2 token id                                              |
| `STORAGE_SECRET_ACCESS_KEY`                                             | R2 token secret                                          |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `MAIL_FROM` | all together, or none at all                             |
| `REPORTS_WORKER_ENABLED`                                                | `true`                                                   |

`loadEnv()` refuses to boot on a plaintext `http://` origin, identical signing
secrets, a `COOKIE_DOMAIN` without a leading dot, or half-configured SMTP. That
is deliberate: a misconfiguration should stop the process, not surface a week
later as a login that silently never works.

**This guard has already caught a real mistake** — during Phase 13 the container
refused to start because `WEB_ORIGIN` was `http://`, which was exactly right.

---

## 3. Migrations — from the entrypoint, not pre-deploy

`apps/api/docker-entrypoint.sh` runs `prisma migrate deploy` and then execs the
API. `set -e` means a failed migration stops the container rather than serving
against a schema that is not there.

### ★ Why not Railway's pre-deploy step

It was tried first, and it failed in the worst possible way: the deployment
went `FAILED` with `failureStage: PRE_DEPLOY_COMMAND` and **no readable output
at all** — the deploy logs came back empty through both the CLI and the MCP API.
Three variations of the command were attempted (relative path, absolute path,
with diagnostics prepended); each produced the same silent failure.

Removing the step entirely made the same image deploy successfully and log
`Database connected`, which proved the image, the credentials and the private
network were all fine. Only the pre-deploy step itself was broken.

Running the migration from the entrypoint puts its output in the ordinary
service log, where it is visible:

```
[entrypoint] applying database migrations…
2 migrations found in prisma/migrations
Applying migration `20260819055205_init`
Applying migration `20260819190000_observation_author_and_review_status`
All migrations have been successfully applied.
[entrypoint] migrations applied; starting the API
```

The trade-off: with several replicas each would attempt to migrate. Prisma takes
an advisory lock, so the others wait and then find nothing to do — and this
service runs a single replica.

### ★ Two things had to change to make this possible

Both were invisible until the first real deploy attempt, and both are recorded
in the Dockerfile:

1. **`prisma` was a devDependency**, so `pnpm prune --prod` deleted the CLI from
   the image. It is now a runtime dependency — migrations are part of the
   deployment, not a step somebody runs from a laptop and eventually forgets.
2. **`prisma.config.ts` was never copied** into the runtime stage. In Prisma 7
   the datasource URL lives there rather than in `schema.prisma`, so the CLI had
   no database to migrate.

Verified locally: `prisma migrate deploy` run **inside** the production image
against a scratch database applied both migrations and produced 5 partial unique
indexes and 71 foreign keys — the same integrity the backup/restore rehearsal
checks.

The path is `node_modules/.bin/prisma`, not a bare `prisma`: pnpm places
workspace package binaries under the package's own `node_modules/.bin`, not the
repository root.

---

## 4. Sequence

1. Create the Railway project and connect the GitHub repository
   (`usukh6ayar/NomadKids`, branch `main`).
2. Add the **Postgres** and **Redis** plugins first, so their URLs exist before
   the API boots.
3. Create the API service from the repository. `railway.json` selects the
   Dockerfile and the root build context; no further build settings are needed.
4. Set the environment variables above.
5. Raise the memory limit to **≥ 1 GB** before the first deploy.
6. Deploy. The pre-deploy command migrates; the health check polls `/v1/health`.

### After the first successful deploy

- [ ] `GET /v1/health` returns `{"status":"ok"}`
- [ ] `GET /v1/health/readiness` with an admin session reports `storage`,
      `chromium`, `redis` and **`cyrillicFont`** all true
- [ ] The logs contain `Font check passed` and `Report worker started`
- [ ] Generate one report and **open it** — a blank PDF is a successful
      download (`PDF_SPIKE.md` §4)

### Seeding the first administrator

The seed script creates one only when asked:

```
SEED_ADMIN_USERNAME=<name> SEED_ADMIN_PASSWORD=<at least 12 chars> pnpm seed
```

Run it once, from a Railway shell against the production database. Do not put
`SEED_ADMIN_PASSWORD` in the service's permanent variables.

---

## 5. What Railway is not doing

- **No object storage.** Photos and PDFs live in R2. A Railway-only restore
  gives a database whose every image 404s — see `PRODUCTION_READINESS.md` §3.
- **No frontend.** That is Vercel.
- **No backups by default.** Railway's Postgres snapshots are not a substitute
  for the verified `pg_dump`/`pg_restore` procedure; set that up separately.

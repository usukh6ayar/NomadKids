# NomadKids — v2

Kindergarten child-development digital portfolio system.
Next.js · NestJS · Prisma · PostgreSQL · Cloudflare R2.

> **Status: Phase 1 MVP implementation and production-readiness verification
> complete. External provisioning and device QA remain.**
>
> 690 automated tests pass, along with 121 live security probes run against the
> production Docker image. The image builds and boots, and a Mongolian-Cyrillic
> PDF has been generated and text-extracted from **inside** it. Password reset
> works end to end against a real SMTP server, and a backup/restore rehearsal
> has been completed.
>
> **Not done, and not claimed:** nothing is deployed. There is no production
> database, Redis, R2 bucket, DNS or TLS certificate, and real-device QA has not
> been run. See [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) for
> what is verified and what is outstanding, and
> [docs/PHASE_1_ACCEPTANCE.md](docs/PHASE_1_ACCEPTANCE.md) for the acceptance
> evidence.

## Quick start

```bash
pnpm install
docker compose up -d                              # postgres · redis · minio
cp .env.example .env                              # then fill in the two secrets
pnpm --filter @kinder/api prisma:generate
pnpm --filter @kinder/contracts build
pnpm dev                                          # web :3000 · api :3001
```

`pnpm verify` runs typecheck, lint and tests — the same three checks as CI.

> Host ports are offset by one (Postgres 5433, Redis 6380, MinIO 9002/9003) so
> this project and the Django reference system can run at the same time.
> Comparing the two side by side is exactly what the reference is kept for.

## Production

| Role | Origin                     | Platform    |
| ---- | -------------------------- | ----------- |
| Web  | `https://nomadkids.mn`     | Vercel      |
| API  | `https://api.nomadkids.mn` | Railway/Fly |

One registrable domain, so the two origins are **same-site** — which is what
lets authentication use `SameSite=Lax` HttpOnly cookies and keep the browser's
own CSRF protection. **No token is ever stored in `localStorage`.**

Data residency outside Mongolia was approved by the client on 2026-08-19.

Full topology, environment table and pre-launch checks:
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## What this is

A digital portfolio for Mongolian kindergartens: teachers record observations
and developmental assessments about children; parents see their own child's
portfolio, progress and photographs; administrators manage kindergartens,
groups, staff and configuration. Reports are generated as A4 PDFs in Mongolian.

The MVP is **Phase 1** only. Attendance, meals, finance, chat, realtime and
analytics are later phases — see [`CLAUDE.md`](CLAUDE.md) §7.

---

## Documents

| Document                                         | What it answers                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)     | Stack, topology, layering, repository layout, risks                                |
| [docs/DATABASE.md](docs/DATABASE.md)             | 28 tables — purpose, relationships, indexes, authorization boundary                |
| [docs/API.md](docs/API.md)                       | Every REST route with its role and ownership rule                                  |
| [docs/SECURITY.md](docs/SECURITY.md)             | Auth, cookies, CSRF, RBAC, IDOR, media, audit — and the 108-case acceptance matrix |
| [docs/UI_UX_MAP.md](docs/UI_UX_MAP.md)           | 24 Next.js routes, one screen = one job                                            |
| [docs/MIGRATION_PLAN.md](docs/MIGRATION_PLAN.md) | What was kept, transformed and dropped from the Django system                      |
| [docs/PDF_SPIKE.md](docs/PDF_SPIKE.md)           | **Executed.** Puppeteer benchmarked; the blank-report failure and its fix          |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)         | Domains, services, environment, backups, pre-launch checks                         |

**Start with [ARCHITECTURE.md](docs/ARCHITECTURE.md), then
[SECURITY.md](docs/SECURITY.md).**

---

## The reference system

`../ByatshanNuudelchid` is a working Django implementation of this product —
25,601 lines, 751 tests, Phase 1 substantially complete. It is kept as the
**behavioural specification**: business rules, domain concepts, authorization
requirements, validation, PDF content and Mongolian terminology.

Its _architecture_ is not carried forward. See
[MIGRATION_PLAN.md](docs/MIGRATION_PLAN.md).

Copies of its requirement documents live in [`docs/reference/`](docs/reference/),
including the client's RFP (`Project_Info.md`).

---

## The one thing to know before writing code

Prisma has no equivalent of Django's soft-delete manager or tenant scoping. A
query that forgets `deletedAt: null` returns deleted records; one that forgets
the tenant filter returns **another kindergarten's children**.

The structural answer is in [CLAUDE.md](CLAUDE.md) §2.2: `PrismaClient` is
importable only from `*.repository.ts`, enforced by lint. Read that before the
first query is written.

---

## Layout

```
apps/web/          Next.js          (not yet created)
apps/api/          NestJS + Prisma  (not yet created)
packages/contracts/ shared Zod schemas and types (not yet created)
docs/              design documents — the current contents of this repository
docs/spikes/pdf/   executed PDF spike: scripts, Dockerfile, generated output
```

---

## The PDF spike, in one line

Puppeteer + Chromium renders the Mongolian report correctly — 19 pages, 2.5 s,
775 MB RSS — **but produces a completely blank PDF, with no error, if the
container has no system fonts.** The fix is two lines in a Dockerfile and a
boot-time assertion: [docs/PDF_SPIKE.md](docs/PDF_SPIKE.md).

To reproduce:

```bash
cd docs/spikes/pdf
npm install
node run-puppeteer.mjs && node verify.mjs out/puppeteer-warm-1.pdf
```

---

## Language

Documentation, code, comments, identifiers and commit messages: **English**.
All user-facing UI text: **Mongolian**.

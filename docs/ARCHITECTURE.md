# ARCHITECTURE.md — new stack

**Status:** Phase 0 foundation exists and is verified. No feature code — no
Prisma models, no migrations, no auth, no feature controllers or pages.
**Reference system:** the Django monolith at `../ByatshanNuudelchid` — business
rules, domain concepts and authorization requirements come from there. Its
_architecture_ does not.

---

## 1. Stack

| Layer    | Choice                                                                      |
| -------- | --------------------------------------------------------------------------- |
| Frontend | Next.js (App Router) · TypeScript · Tailwind · shadcn/ui · TanStack Query   |
| Backend  | NestJS · REST · Prisma · PostgreSQL                                         |
| Auth     | HttpOnly Secure cookies, short access token + rotating refresh, CSRF, RBAC  |
| Storage  | Cloudflare R2, private bucket, presigned URLs                               |
| PDF      | Puppeteer + Chromium — [PDF_SPIKE.md](PDF_SPIKE.md)                         |
| Jobs     | BullMQ + Redis                                                              |
| Realtime | **none in the MVP** — §7                                                    |
| Hosting  | Next.js → Vercel · NestJS + worker → Railway or Fly · managed Postgres · R2 |

Approved 2026-08-19, including **D13** — the client has approved hosting this
application's data in cloud infrastructure outside Mongolia
([SECURITY.md](SECURITY.md) §14.1).

**Confirmed production domains:**

| Role | Origin                     | Hosted on   |
| ---- | -------------------------- | ----------- |
| Web  | `https://nomadkids.mn`     | Vercel      |
| API  | `https://api.nomadkids.mn` | Railway/Fly |

Postgres and object storage are still reached through `DATABASE_URL` and an
S3-compatible client rather than provider-specific SDK calls. That was built so
a "must be hosted in Mongolia" answer would be a deployment change rather than a
rewrite; the answer went the other way, but the property is cheap to keep and
regulation changes. Do not hard-code R2- or Vercel-specific assumptions into
application code.

---

## 2. Topology

```
                    ┌─────────────────────────────┐
   browser ────────▶│  Next.js  (Vercel)          │
                    │  RSC + client components    │
                    │  TanStack Query             │
                    └──────────────┬──────────────┘
                                   │ HTTPS, credentialed
                                   │ cookies + X-CSRF-Token
                    ┌──────────────▼──────────────┐
                    │  NestJS  (Railway / Fly)    │
                    │  controllers → services     │
                    │  → repositories → Prisma    │
                    │  authz guards               │
                    └───┬────────┬────────┬───────┘
                        │        │        │
             ┌──────────▼──┐  ┌──▼────┐  ┌▼─────────────┐
             │ PostgreSQL  │  │ Redis │  │ Cloudflare R2│
             │  (managed)  │  │BullMQ │  │ private      │
             └─────────────┘  └───┬───┘  └──────────────┘
                                  │
                    ┌─────────────▼───────────────┐
                    │  Report worker (same image) │
                    │  Puppeteer + Chromium       │
                    │  ≥ 1 GB RAM                 │
                    └─────────────────────────────┘
```

**Two deployables, one codebase.** The API container and the report worker run
the same image with a different entrypoint — the worker needs Chromium and the
fonts, and duplicating the image would let the two drift.

### 2.1 The origin split is a real cost

The reference system was one process: a template view called a Python function.
Here every page render crosses a network boundary. The consequences are
deliberate, not incidental:

- Cookies would be cross-site unless both apps share a registrable domain.
  **They do** — `nomadkids.mn` and `api.nomadkids.mn`, so the two origins are
  same-site, `SameSite=Lax` applies, and the cookie is host-only (no `Domain`
  attribute). See [SECURITY.md](SECURITY.md) §3.1.
  **The DNS records must exist before the auth module is written**: on
  `*.vercel.app` + `*.railway.app` the two would be cross-site, `SameSite=None`
  would become mandatory, and the browser would stop helping — a change that is
  easy to make and hard to notice.
- Latency is now Vercel → Railway per request. Both should be in or near the
  same region; a Frankfurt frontend against a Singapore API is a slow product.
  Serving Mongolian users, pick the closest available region on each and measure
  before launch.
- The frontend must never call the API with a user's cookie from a server
  component _and_ cache the result — see §5.2.

This is the price of the TypeScript + future-mobile decision. It buys an API
that a mobile client can use unchanged.

---

## 3. Repository layout

```
/
├── apps/
│   ├── web/                    Next.js
│   │   ├── app/                routes — see UI_UX_MAP.md
│   │   ├── components/
│   │   ├── lib/api/            typed fetch client, one function per endpoint
│   │   └── lib/auth/
│   └── api/                    NestJS
│       ├── src/
│       │   ├── authz/          ★ the only place authorization is decided
│       │   ├── modules/        one folder per domain (§4)
│       │   ├── prisma/         schema.prisma, migrations, seed
│       │   ├── storage/        R2 client, presigning, upload validation
│       │   ├── jobs/           BullMQ queues + processors
│       │   ├── reports/        Puppeteer renderer, HTML templates
│       │   └── common/         guards, interceptors, filters, audit
│       └── test/
├── packages/
│   └── contracts/              ★ Zod schemas + inferred types, shared
├── docs/
├── docker-compose.yml          postgres + redis + minio (local dev)
├── CLAUDE.md
└── README.md
```

### 3.1 Why only one package

The brief proposed `ui/`, `types/` and `config/`. For a solo developer:

- **`types/` → yes, as `contracts/`.** This is the one package that earns its
  keep: a Zod schema defined once, used by Nest for request validation and by
  the web app for form validation and response types. Without it the two drift
  and the compiler cannot tell you.
- **`ui/` → no.** A shared component package pays off when two apps consume it.
  There is one app. shadcn/ui components live in `apps/web/components/ui`, which
  is where its CLI puts them. Extract later if a second consumer appears.
- **`config/` → no.** Shared ESLint/TS config for two apps is a package that
  exists to hold four files. Root-level `tsconfig.base.json` and `eslint.config.mjs`
  do the same job with less indirection.

**pnpm workspaces, no Turborepo.** Two apps and one package do not need a build
graph orchestrator.

---

## 4. Backend layering

```
controller     parse the request, call a service, shape the response. Nothing else.
service        business rules, transactions, audit writes
repository     ★ the ONLY layer that may import PrismaClient
authz          ★ the ONLY place that decides who may reach what
```

### 4.1 The repository rule exists for one reason

Prisma has no equivalent of Django's soft-delete manager. `prisma.child.findMany()`
returns deleted rows unless every call site remembers `deletedAt: null`, and
returns _every kindergarten's_ rows unless every call site remembers the tenant
filter. One forgotten filter is a cross-tenant data leak.

So: `PrismaClient` is importable only from `*.repository.ts`, enforced by an
ESLint `no-restricted-imports` rule that fails CI. Each repository exposes a base
filter carrying `deletedAt: null` and the tenant scope; methods extend it.

This is the single most important structural rule in the backend. It replaces a
framework guarantee the previous stack gave for free.

### 4.2 Controllers stay thin

```ts
// ✅
@Get(":id")
async detail(@Actor() actor: Actor, @Param("id") id: string) {
  const child = await this.children.getForActor(actor, id);   // throws 404
  return ChildDetailDto.from(child);
}

// ❌ — authorization and business logic in the controller
@Get(":id")
async detail(@Req() req, @Param("id") id: string) {
  const child = await this.prisma.child.findUnique({ where: { id } });
  if (child.kindergartenId !== req.user.kindergartenId) throw new ForbiddenException();
  ...
}
```

The second version is wrong four times over: Prisma outside a repository, no
soft-delete filter, authorization from a session-held kindergarten, and 403
instead of 404.

### 4.3 Modules

`auth · users · kindergartens · groups · children · guardianships · enrollments ·
portfolio · observations · media · assessments · terms · notifications · reports ·
config · audit`

One folder each: `controller.ts`, `service.ts`, `repository.ts`, `dto/`, `tests/`.

### 4.4 Transactions

No implicit per-request transaction. Services open one explicitly where a write
must be atomic with its audit row:

```ts
await this.prisma.$transaction(async (tx) => {
  const obs = await this.repo.create(tx, input);
  await this.audit.append(tx, { action: "create", objectId: obs.id, childId });
  return obs;
});
```

Enqueue **after** the transaction commits, never inside it — a worker that starts
before the row is visible fails to find it:

```ts
const job = await this.repo.createReportJob(...);   // committed
await this.queue.add("generate-report", { jobId: job.id });
```

Two exceptions that must **not** be transactional: `LoginAttempt` and the
`login_failed` audit row. They record failure; rolling them back with the failing
request resets the lockout counter. See [SECURITY.md](SECURITY.md) §2.

---

## 5. Frontend

### 5.1 Rendering

- **Server components** for the initial read of a page — the child list, a child's
  detail. One round trip, no loading spinner on first paint.
- **Client components + TanStack Query** for anything interactive: filters,
  pagination, forms, optimistic updates, and the notification badge.
- **Server actions are not used for API calls.** The API is a separate service
  with its own auth; routing through a server action adds a hop and a second
  auth path. Client components call the API directly with `credentials: "include"`.

### 5.2 The caching trap

A server component that fetches with the user's cookie must never be cached.
Next.js caching is per-URL, not per-user; a cached response containing one
child's data would be served to another parent.

**Rule: every authenticated fetch passes `cache: "no-store"`.** The typed API
client in `lib/api/` sets it by default so it cannot be forgotten at a call site.

### 5.3 Design system

Tailwind + shadcn/ui. Design tokens (colour, spacing, radius, type scale) are
lifted from the reference system's `app.css` so the product stays recognisable,
but components are shadcn's — the 3,115 lines of hand-written CSS are not ported.

Three shells, matching the three audiences: `(teacher)`, `(parent)`, `(admin)`.
See [UI_UX_MAP.md](UI_UX_MAP.md).

**All user-facing text is Mongolian.** Code, identifiers, comments and commit
messages are English.

### 5.4 Mobile-first

It must work on a phone before it works anywhere else. Most teachers will use
this standing in a classroom.

---

## 6. Background jobs

BullMQ on Redis. Queues: `reports`, `media-cleanup`, `retention`.

| Job                                     | Trigger                           |
| --------------------------------------- | --------------------------------- |
| Generate a portfolio or term-report PDF | on demand, tracked by `ReportJob` |
| Orphaned R2 object sweep                | nightly                           |
| Expired report cleanup                  | nightly                           |
| Expired auth token cleanup              | hourly                            |

The report worker is where Chromium lives: ≥ 1 GB RAM, one browser reused across
jobs, Cyrillic fonts installed system-wide. It **cannot** run on Vercel — see
[PDF_SPIKE.md](PDF_SPIKE.md) §8.

---

## 7. No realtime in the MVP — an explicit decision

**No Socket.IO. No WebSocket gateway. No Redis pub/sub. No socket rooms.**

Notifications are ordinary REST plus refetch:

- TanStack Query `refetchOnWindowFocus` covers the common case — a parent opens
  the tab and sees the badge update.
- The unread count polls at 60 s **only while the tab is visible**
  (`refetchInterval` with a `document.visibilityState` guard).

At this product's cadence — a teacher posts a handful of notices a day — polling
is indistinguishable from realtime to the user, and it removes a stateful
connection layer, a scaling concern, and a second auth path.

Realtime is a **Phase 2** item. When it arrives it belongs on the Nest side
(Railway/Fly holds long-lived connections; Vercel does not).

---

## 8. Local development

`docker-compose.yml` runs Postgres, Redis and MinIO (S3-compatible, standing in
for R2). The apps run on the host with `pnpm dev`.

```bash
docker compose up -d
pnpm --filter api prisma migrate dev
pnpm --filter api seed
pnpm dev
```

Nothing about local development should require a Cloudflare account.

---

## 9. Testing

| Level       | Tool                                 | Covers                                       |
| ----------- | ------------------------------------ | -------------------------------------------- |
| Unit        | Vitest                               | services, authz functions, pure logic        |
| Integration | Vitest + supertest + a real Postgres | **every endpoint, through HTTP**             |
| Component   | Vitest + Testing Library             | forms, guarded UI                            |
| E2E         | Playwright                           | login, record an observation, generate a PDF |

**The authorization matrix in [SECURITY.md](SECURITY.md) §6 is the integration
suite's specification.** 108 cases, tested through the HTTP client against real
routes. A unit test of `canAccessChild()` passes even when a controller forgets
to call it — necessary, not sufficient.

No mocked Prisma in integration tests. A test against a mock proves the mock
works.

---

## 10. What is deliberately not carried over

| Reference system                     | Here                         | Why                                                              |
| ------------------------------------ | ---------------------------- | ---------------------------------------------------------------- |
| Django templates, 81 files           | React components             | Stack change                                                     |
| `services.py` / `selectors.py` split | services + repositories      | Same intent, TS idiom                                            |
| Soft-delete model manager            | repository base filter       | Prisma has no equivalent                                         |
| Celery + beat                        | BullMQ                       | Node                                                             |
| WeasyPrint                           | Puppeteer                    | Measured — [PDF_SPIKE.md](PDF_SPIKE.md)                          |
| `django-simple-history` on 3 models  | **dropped for the MVP**      | `AuditLog` records who changed what; full row history is Phase 2 |
| Django Admin, 16 ModelAdmin classes  | 5 purpose-built admin routes | [UI_UX_MAP.md](UI_UX_MAP.md)                                     |
| MinIO in production                  | R2                           | Managed                                                          |
| `ATOMIC_REQUESTS`                    | explicit transactions        | Nest has no implicit one                                         |
| Integer primary keys                 | UUIDs                        | Reduces enumeration damage                                       |

---

## 11. Risks

| #   | Risk                                                                                                     | Mitigation                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | A query without the tenant/soft-delete filter leaks data                                                 | Repository rule + ESLint (§4.1); the §6 matrix as tests                                                                                 |
| R2  | A later deployment move puts the API on a different registrable domain, silently forcing `SameSite=None` | Double-submit token + origin check are kept regardless; `COOKIE_DOMAIN` is validated at boot                                            |
| R3  | Blank PDFs if the image loses its fonts                                                                  | Startup health check that **fails the boot** + an automated test asserting Cyrillic in extracted text ([PDF_SPIKE.md](PDF_SPIKE.md) §5) |
| R4  | A cached server-component fetch serves one user's data to another                                        | `cache: "no-store"` in the shared client (§5.2)                                                                                         |
| R5  | Two deployables drift in config                                                                          | One image for API and worker; one `.env.example`                                                                                        |
| R6  | ~~Children's data hosted outside Mongolia~~                                                              | **Closed** — client approved, 2026-08-19 ([SECURITY.md](SECURITY.md) §14.1). Deletion and sub-processor obligations remain              |
| R7  | Rebuilding admin screens by hand is the largest single cost                                              | Kept to 5 routes, one shared CRUD pattern                                                                                               |

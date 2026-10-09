# CLAUDE.md — NomadKids (v2)

Kindergarten child-development digital portfolio system.
**Next.js + NestJS + Prisma + PostgreSQL.**

## THE RULES IN THIS FILE ARE MANDATORY

Code that violates a rule does not get written. If a rule blocks the task, do
not work around it — **stop and ask.**

A rule the codebase contradicts teaches everyone to stop reading the file. When
the client moves a line, the line moves here — it is never quietly ignored.

### Where the documents live

The design documents are **not in this repository**. They live beside it, in
`../nomadkids_md/` (git history keeps the old `docs/` tree too). Code comments
that cite `docs/X.md §N` mean the same file there.

| File                                                             | What it answers                                            |
| ---------------------------------------------------------------- | ---------------------------------------------------------- |
| `rfp/Project_Info.md`                                            | The client's RFP, in Mongolian. **Final authority.**       |
| `rfp/нэмэлт.md`                                                  | The client's finance and funding addendum (2026-08-25)     |
| `rfp/legal/`                                                     | Ministry regulations and the ESIS token guide              |
| `architecture/SECURITY.md`                                       | Auth, cookies, RBAC, media — and the 108 acceptance cases  |
| `architecture/ARCHITECTURE.md`, `DATABASE.md`, `API.md`          | Topology, tables, every route with its ownership rule      |
| `ops/VPS_DEPLOYMENT.md`, `ops/PROD_RECOVERY.md`                  | Deploying, backups, restore                                |
| `esis/ESIS_TRIAL_STATE.md`                                       | **Read before any ESIS work** — what the live service does |
| `esis/ESIS_REQUEST.md`, `ESIS_HANDBOOK.md`, `ESIS_COMPLIANCE.md` | Field lists, endpoints, the ministry's requirements        |
| `finance/FINANCE_MODULE.md`, `finance/QPAY_INTEGRATION.md`       | The finance module and the portal-fee gateway              |
| `manuals/`                                                       | Mongolian manuals for operators, directors and users       |

Precedence on conflict: **RFP > nomadkids_md > CLAUDE.md > existing code.**

**Language:** documentation, code, comments, identifiers and commit messages in
**English**. All user-facing UI text in **Mongolian**.

### The Django project is a reference, not a template

`../ByatshanNuudelchid` is the source of truth for **business rules, domain
concepts, authorization requirements, validation rules, PDF content and
terminology**. It is _not_ the source of truth for architecture, models,
templates or services. Do not port its structure — it contains Phase 2
concepts, redundant fields and historical workarounds.

---

## 1. Security rules

### 1.1 Authorization lives in exactly one module

Every access to child data goes through `apps/api/src/authz/`.

```ts
// ✅
const child = await this.children.getForActor(actor, id); // throws 404

// ❌ — authorization decided in a controller
const child = await this.prisma.child.findUnique({ where: { id } });
if (child.kindergartenId !== actor.kindergartenId) throw new ForbiddenException();
```

If the logic exists in two places, the web app and a future mobile client
answer differently.

### 1.2 Resolve the kindergarten from enrollment history

`Child.kindergartenId` is a denormalised "currently attending" pointer, for
listing and filtering only. Authorization reads `Enrollment` history. Exactly one
exception exists — a child with _no_ enrollments falls back to the column so the
staff who just registered them are not locked out. **Do not add a second.**

### 1.3 Never store the kindergarten in the session or the token

The access token carries `userId` and `sessionId` and nothing else. Roles and
kindergartens are re-read from `Membership` on every request, or revoking a
teacher's assignment would not take effect until their token expired.

### 1.4 Files are never directly reachable

```
GET /media/:id → authorization → 302 to a 5-minute presigned URL
```

Private bucket. `storageKey` is a random UUID path, never derived from a name or
id. The real filename lives only in `originalName`, for display. No public
bucket, no public custom domain, no `<img src="https://storage...">`.

A chat attachment is authorised by **room membership** (`ChatAccessService`),
never by the tenant — a tenant-wide rule would let a group-A parent read group
B's photographs.

### 1.5 No secrets in source

All configuration from `process.env`. `.env` gitignored. Every new setting gets a
line in `.env.example`.

### 1.6 Never trust a file's extension

Detect the real MIME type from **content**. A `.jpg` can be an executable. Strip
EXIF from every uploaded image.

### 1.7 404, never 403, for child data

An unauthorized child, observation, media file, report or chat room returns
**404**. A 403 confirms the record exists.

★ **One exception: 402 for the portal access fee** (2026-09-01). It is shown
only to a guardian who has _already passed_ `canAccessChild` for that child —
someone who knows the child exists — and a 404 there would hide the one fact
that lets them act. Authorization runs first, so a stranger still gets 404 and
the status cannot become an oracle. `authz/portal-access.ts`. **Do not add a
second exception without the same argument.**

---

## 2. Architecture rules

### 2.1 Layering

```
controller   parse, call a service, shape a response. Nothing else.
service      business rules, transactions, audit
repository   ★ the ONLY layer that may import PrismaClient
authz        ★ the ONLY place that decides who may reach what
```

### 2.2 `PrismaClient` is importable only from `*.repository.ts`

Enforced by an ESLint `no-restricted-imports` rule that fails CI.

Prisma has no soft-delete manager and no tenant scoping.
`prisma.child.findMany()` returns deleted rows and every kindergarten's rows
unless the call site remembers both filters. One forgotten filter is a
cross-tenant leak. Repositories carry a base filter (`deletedAt: null` + tenant
scope) that methods extend, never replace.

★ **`Prisma.Decimal` is covered by this rule too** — it is re-exported from the
generated client. Money outside a repository uses **`decimal.js`** directly
(the library Prisma's decimal is built on). `invoices/invoice-math.ts` is the
worked example. Never JavaScript floats for money.

### 2.3 Configuration belongs in the database, not in code

Anything an administrator can edit is a **table**, not a TypeScript enum:
`DevelopmentDomain`, `AssessmentLevel`, `ObservationType`. System-level values
(roles, record states, job states) may be enums.

### 2.4 Every authenticated fetch is `cache: "no-store"`

Next.js caching is per-URL, not per-user. A cached server-component fetch
containing one child's data would be served to another parent. The typed client
in `apps/web/lib/api/` sets it by default.

---

## 3. Database rules

### 3.1 Every tenant-scoped table carries `kindergartenId`

Denormalised even when reachable through a relation. One filter enforces the
isolation.

### 3.2 No hard deletes

Set `deletedAt`. **Who** deleted it lives in `AuditLog` (`actorUserId` against a
`DELETE` action), never in a `deletedById` column — an append-only row cannot be
overwritten by the next writer. `AuditLog` itself is append-only, never updated,
never deleted; its repository exposes only `append()`.

★ **Finance is stricter** (`нэмэлт.md` §14): a confirmed financial transaction is
never deleted at all. A payment is voided with a **reversing row**
(`Payment.reversalOfId`, `InvoicesRepository.voidPayment()`), and a reversal
cannot itself be voided. Every financial `audit.append()` that overwrites or
removes something records the `before` value.

### 3.3 Review migrations by hand

Read the generated SQL. Check for accidental `DROP COLUMN` or any data-losing
operation. **Locally, apply with `prisma migrate deploy`, never `migrate dev`** —
the local history has diverged and `migrate dev` offers a RESET. Create new
migrations with `prisma migrate diff` or `migrate dev --create-only`.

### 3.4 N+1 queries are forbidden

Every list uses `include`/`select` deliberately. Every list is paginated. No
endpoint returns an unbounded set.

### 3.5 Enqueue after commit

```ts
const job = await this.repo.createReportJob(...);   // committed
await this.queue.add("generate-report", { jobId: job.id });
```

Never inside the transaction — the worker would start before the row is visible.

### 3.6 Records that must survive a rollback

`LoginAttempt` and the `login_failed` audit row record failure. Written inside a
transaction that the failing request rolls back, the lockout counter silently
resets. **Write them outside any interactive transaction.**

---

## 4. Testing rules

### 4.1 Authorization tests are mandatory

Every new endpoint touching child data requires at minimum:

```ts
test("teacher from another group gets 404");
test("guardian of another child gets 404");
test("user from another kindergarten gets 404");
```

**Through HTTP, against the real route:**

```ts
// ✅ proves the endpoint checks
const res = await request(app).get(`/children/${otherChild.id}`).set(cookie);
expect(res.status).toBe(404);

// ❌ passes even if the controller never calls it
expect(await canAccessChild(user, otherChild)).toBe(false);
```

`SECURITY.md` §6 lists **108 acceptance cases** — the integration suite's
specification. Beyond those, write the tests that carry a rule (about one case
per rule); do not pin every 400/409 a validator can emit.

### 4.2 Never claim a feature works without running the tests

Run them, show the output. If they fail, say so immediately.

### 4.3 PDF tests assert on extracted text

A generator returning 1 MB of blank pages passes every "did it produce a file"
check.

### 4.4 A full-suite failure that passes alone is not automatically noise

Both suites have failed tests in a full run that pass alone — eight instances
between 2026-09-02 and 2026-09-28, across `catalog`, `query-counts`, `children`
(api) and `admin-users`, `funding-register`, `flows`, `password-policy`,
`invoices`, `admin-reports-overview` (web). Most were **5000 ms timeouts**, and
the failing set changes between runs of the same tree. **The cause is not
known.** It points at the full-run environment, not at any one test's logic.

Ruled out, with evidence: file parallelism (`fileParallelism: false`), the login
rate limiter (per-file app; high-login files call `RateLimitService.resetAll()`
in `beforeEach`), the report worker and scheduler (off in `test/setup.ts`),
leaked connections (every file closes its app), `resetData` missing a table.

**Ruled in — and the first thing to check:**

- **Never run the api and web suites at the same time**, nor two api runs
  (they share the test database), nor beside a busy `pnpm dev`. That starves
  Postgres and CPU and produces `beforeEach` hook timeouts — including a
  cross-kindergarten "leak" in `children.test.ts` that is not one.
- A killed api run can leave `kinder_test` poisoned (failures that move around
  and name `system-config.ts`) — recreate it rather than bisect.
- The api suite takes ~21 minutes. Run it in the background with
  `--reporter=verbose` written to a file **before** grepping.

★★ **A cross-kindergarten isolation failure must never be waved through.** If it
recurs with nothing else running, capture the full reporter output and treat it
as a defect until shown otherwise.

---

## 5. UI rules

- All user-facing text in **Mongolian**. Code and identifiers in English
- Three shells: `(teacher)`, `(parent)`, `(admin)`
- Confirm before delete, toast after save, loading state over ~300 ms
- Every field has a `<label>`, every image an `alt`
- **Mobile-first.** It works on a phone before it works anywhere else
- Empty states say what to do next — and never show sample figures in their place
- Restyle through the token layer (`globals.css` `@theme` + shared primitives)
- Web redesigns and new screens come from the client's frontend developer's
  PRs. Backend, contracts, migrations and deploy are ours; write web code only
  when the user asks for that specific change

---

## 6. Slow work goes to a queue

BullMQ, never inside a request: PDF generation (~2.5 s), image processing,
bulk notifications, cleanup sweeps.

The `reports-worker` container (2 GB) runs the slow work. It needs Chromium and
**Cyrillic fonts installed system-wide** — without them a PDF renders blank with
no error. The `api` containers set `REPORTS_WORKER_ENABLED=false`.

---

## 7. Scope

**Scope runs through RFP Phase III** (client, in writing, 2026-08-25), plus
what the client added since. Phase 1 was delivered and accepted (14 PASS,
1 blocked).

**In scope and built:** attendance · meals and the weekly menu · surveys and
analytics · growth and charts · milestones · allergies · medication ·
vaccination · safety incidents · document library · artwork comparison ·
annual, group and batch reports · Excel import/export · photo consent ·
chat (2026-08-29) · the ESIS integration.

**The finance module (`нэмэлт.md`):**

| §                                   | State                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| §1 sixth attendance status `OTHER`  | done                                                                                                                            |
| §2 meal register, §12 dish fields   | done                                                                                                                            |
| §3 meal cost                        | **partial** — ESIS api 128 food discounts read live, stored nowhere; three states incl. `UNASSESSED`; per-child split not built |
| §4–§6 state funding, rules, monthly | done — the rule table ships **empty**; no tariff is hard-coded                                                                  |
| §7 invoices                         | done, incl. `generate-month`                                                                                                    |
| §8 online payment                   | QPay charges **only the portal access fee** — see below                                                                         |
| §9 dashboard, §10 child finance tab | done — a guardian's payload omits `funding` entirely                                                                            |
| §11 allergy cross-check             | done                                                                                                                            |
| §13 accountant role                 | done, `Role.ACCOUNTANT`                                                                                                         |
| §14 financial audit log             | done — reversal rows, before/after values                                                                                       |
| §15 external-ID history             | **not started**                                                                                                                 |
| §16 the reports                     | done — `FINANCE_REPORT` jobs carry **no `childId`**                                                                             |

★ **QPay** (client, 2026-09-01): "QPay-ийг зөвхөн эцэг эхчүүдээс энэхүү
website-ийг ашиглах эрхийг нээхийн тулд мөнгө авна. Өөр зүйлд QPay
ашиглахгүй". `AccessSubscription` is one child × one school year, priced by
`ACCESS_FEE_AMOUNT` (**"0" turns the gate off** and is the default). One
merchant serves every kindergarten, so credentials and price are deployment
settings. **No `Payment` row is written for a fee** — it is the platform
operator's revenue, not the kindergarten's. Tuition and meal invoices are
settled in cash or by transfer, recorded by the accountant, never through
the gateway.

★ **Chat** has **no AI in it** — the client said so three times. It is a group
message board: membership derived per request, 404 for a room you are not in,
`kindergartenId` on every row, soft delete, paginated history.

★ **Phone proof through verify.mn** (2026-10-01) is **inbound** — the person
texts a code _from_ their phone — for password reset, a guardian's phone on an
invitation, and changing one's own phone. Off unless `VERIFY_MN_API_KEY` is
set. Never show an SMS price in the UI.

**Still out — RFP Phase IV.** Say which phase it belongs to and ask:

native mobile apps · outbound SMS · push notification · QR pick-up ·
electronic signature · multi-language · AI observation suggestions ·
voice-to-text

Pulling work forward silently is how a three-week delivery becomes six.

---

## 8. Production

**Production is the Datacom VPS, `202.131.1.111`**, running
`docker-compose.prod.yml`: web, api, reports-worker, Postgres (`db`), Redis,
MinIO (`storage`), Caddy. Cloudflare is DNS only. Vercel and Railway still
build from `main` and **serve nothing** — their status says nothing about
`nomadkids.mn`.

**A merge to `main` deploys nothing.** To deploy:

```bash
ssh root@202.131.1.111
cd /opt/nomadkids
sudo -u deploy git pull --ff-only origin main      # git as deploy, never root
nohup setsid docker compose -f docker-compose.prod.yml up -d --build [service] \
  > /tmp/deploy.log 2>&1 < /dev/null &
```

- The api entrypoint runs `prisma migrate deploy`; rebuild `api` **and**
  `reports-worker` when the api or a migration changed (Chromium image, 20+ min).
  Web-only changes rebuild `web` alone.
- Watch `/tmp/deploy.log` and `docker compose ps`, never
  `pgrep -f "…up -d --build"` — it matches its own shell.
- `.env` is a symlink to `.env.production`. `up -d --build` does not re-read
  `env_file`: a changed variable needs `--force-recreate`.
- Take a `pg_dump` to `/root/backups/` before any manual prod DB write, and ask
  before anything destructive (DROP, deleting rows, stopping the stack).
- Backups: `scripts/backup.sh` from root's cron at 02:15, offsite to
  `BACKUP_REMOTE` (R2 via rclone).

Locally nothing runs in Docker: Postgres 5432, Redis 6379, MinIO 9010 run
natively. `NEXT_PUBLIC_MEDIA_URL` must match MinIO's port or CSP blocks every
photo. Rebuild `packages/contracts` after a schema change — a stale `dist`
silently strips new fields.

---

## 9. Common mistakes

| Mistake                                        | Correct                                      |
| ---------------------------------------------- | -------------------------------------------- |
| `prisma.*` in a service or controller          | Repository only                              |
| Query without `deletedAt: null`                | Repository base filter                       |
| Query without the tenant scope                 | Repository base filter                       |
| Using `Child.kindergartenId` for authorization | `canAccessChild()` — reads enrollments       |
| Returning 403 for child data                   | Return **404**                               |
| `prisma.x.delete()`                            | Soft delete                                  |
| Roles baked into the JWT                       | Re-read `Membership` per request             |
| Generating a PDF in a request                  | BullMQ + `ReportJob`                         |
| Development domains as a TS enum               | The `DevelopmentDomain` table                |
| Serving storage objects by direct URL          | `/media/:id` + presigned URL after the check |
| Authenticated fetch without `no-store`         | Always `cache: "no-store"`                   |
| `prisma migrate dev` on the local database     | `prisma migrate deploy`                      |
| Running api and web suites together            | One suite at a time                          |
| Saying "done" without running tests            | Run them, show the output                    |

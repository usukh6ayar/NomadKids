# CLAUDE.md — NomadKids (v2)

Kindergarten child-development digital portfolio system.
**Next.js + NestJS + Prisma + PostgreSQL.**

## THE RULES IN THIS FILE ARE MANDATORY

Code that violates a rule does not get written. If a rule blocks the task, do
not work around it — **stop and ask.**

**Required reading:**

- `docs/reference/Project_Info.md` — the client's RFP, in Mongolian. Final authority.
- `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/API.md`, `docs/SECURITY.md`
- `docs/reference/ROADMAP-django.md` — phase scope

Precedence on conflict: RFP > docs/ > CLAUDE.md > existing code.

**Language:** documentation, code, comments, identifiers and commit messages in
**English**. All user-facing UI text in **Mongolian**.

### The Django project is a reference, not a template

`../ByatshanNuudelchid` is the source of truth for **business rules, domain
concepts, authorization requirements, validation rules, PDF content and
terminology**. It is _not_ the source of truth for architecture, models,
templates or services. Do not port its structure. It contains Phase 2 concepts,
redundant fields and historical workarounds — see `docs/MIGRATION_PLAN.md` for
what was deliberately dropped.

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

If the logic exists in two places, the web app and the future mobile client
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
GET /media/:id → canAccessChild() → 302 to a 5-minute presigned R2 URL
```

Private bucket. `storageKey` is a random UUID path, never derived from a name or
id. The real filename lives only in `originalName`, for display. No public
bucket, no public custom domain, no `<img src="https://r2...">`.

### 1.5 No secrets in source

All configuration from `process.env`. `.env` gitignored. Every new setting gets a
line in `.env.example`.

### 1.6 Never trust a file's extension

Detect the real MIME type from **content**. A `.jpg` can be an executable. Strip
EXIF from every uploaded image.

### 1.7 404, never 403, for child data

An unauthorized child, observation, media file or report returns **404**. A 403
confirms the record exists.

★ **One exception, added 2026-09-01: 402 for the portal access fee.** It is
shown only to a guardian who has *already passed* `canAccessChild` for that
child — someone who knows the child exists — and a 404 there would hide the one
fact that lets them act. Authorization runs first, so a stranger still gets 404
and the status cannot become an oracle. `authz/portal-access.ts`,
`docs/SECURITY.md` §5.4. **Do not add a second exception without the same
argument.**

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

**Why this matters more than it looks.** Prisma has no soft-delete manager and no
tenant scoping. `prisma.child.findMany()` returns deleted rows and every
kindergarten's rows unless the call site remembers both filters. One forgotten
filter is a cross-tenant leak. Repositories carry a base filter
(`deletedAt: null` + tenant scope) that methods extend, never replace.

★ **`Prisma.Decimal` is covered by this rule too.** It is re-exported from the
generated client, so importing it for the number type opens the query surface
to whatever file did so. Money outside a repository uses **`decimal.js`**
directly — the same library Prisma's decimal is built on, so values cross the
boundary unchanged. `invoices/invoice-math.ts` is the worked example. The rule
caught this being got wrong on 2026-08-31, which is the argument for keeping it
mechanical: it cannot tell "I only wanted the number type" from "I am about to
run a query", and should not have to.

### 2.3 Configuration belongs in the database, not in code

Anything an administrator can edit is a **table**, not a TypeScript enum:
`DevelopmentDomain`, `AssessmentLevel`, `ObservationType`.

System-level values (roles, record states, job states) may be enums.

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

Set `deletedAt`. `AuditLog` is the single exception: append-only, never updated,
never deleted — its repository exposes only `append()`.

**Who deleted it lives in `AuditLog`, not in a column.** This rule asked for a
`deletedById` beside `deletedAt` until 2026-08-25, and no table ever carried
one — the instruction and the schema had disagreed from the beginning, which
was found while scoping `Attendance` (`docs/ATTENDANCE_PLAN.md` §4). `AuditLog`
already records `actorUserId` against a `DELETE` action and an `objectId`, and
it is the better home: a column can be overwritten by the next writer, an
append-only row cannot. A mandatory rule that nothing obeys stops being read,
so the rule moved to match the design rather than the reverse.

★ Then five tables shipped the column anyway — `Attendance`,
`AttendanceRequest`, `MenuDay`, `Survey`, `SurveyResponse` — the same day the
rule was written, on a branch that predated it. Nothing ever wrote to them:
`grep deletedById apps/api/src` returns one comment and no assignment. They are
dropped in `20260825170000_drop_vestigial_deleted_by`, which is safe precisely
_because_ nothing wrote them — every value was NULL. The alternative, wiring six
services to fill a column `AuditLog` already answers better, is the version of
this rule that was deleted for being unread.

### 3.3 Review migrations by hand

After `prisma migrate dev`, **read** the generated SQL. Check for accidental
`DROP COLUMN` or any data-losing operation.

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

`docs/SECURITY.md` §6 lists **108 acceptance cases** extracted from the reference
suite. That is the integration suite's specification.

### 4.2 Never claim a feature works without running the tests

Run them, show the output. If they fail, say so immediately.

### 4.3 PDF tests assert on extracted text

A generator returning 1 MB of blank pages passes every "did it produce a file"
check. See `docs/PDF_SPIKE.md` §4.

### 4.4 A full-suite failure that passes alone is not automatically noise

Three times on 2026-09-02 a test failed in `pnpm --filter api test` and passed
when its file was run alone: `catalog.test.ts` (two authorization cases),
`query-counts.test.ts` (an N+1 guard) and `children.test.ts` (cross-kindergarten
isolation — the most serious kind there is).

**The cause is not known.** What is ruled out, with evidence, so nobody repeats
the search:

| Hypothesis | Why not |
| --- | --- |
| Test files run in parallel | `vitest.config.mts` sets `fileParallelism: false` |
| Login rate limiter exhausted | `createTestApp` compiles a fresh module per file, so the limiter is per-file — it cannot produce a failure that only appears in a full run |
| Report worker / maintenance scheduler | Both gated on `REPORTS_WORKER_ENABLED`, which `test/setup.ts` sets to `"false"` |
| Leaked apps holding connections | All 46 files call `app.close()` in `afterAll`; Postgres `max_connections` is 100 and the suite sits near 8 |
| `resetData` missing a table | Verified by truncating and counting rows in all 65 tables — none survive |

★ It **is** real, and one instance had a real cause: `attendance-register.test.ts`
did 21 tests × 5 logins against a 60-per-15-minutes limit and got 429s that read
as register defects. `RateLimitService.resetAll()` in `beforeEach` fixes that
class, and every high-login file already does it.

★★ **Do not treat the rest as flake and move on.** A cross-kindergarten
isolation failure is the one result in this suite that must never be waved
through: the code is right by construction there — `visible` is the first term
of the `AND`, so a group filter narrows it and cannot widen it — but "the code
looks right" is what everybody says before a leak. If it recurs, capture the
full reporter output rather than the summary line, which is where this
investigation stalled.

---

## 5. UI rules

- All user-facing text in **Mongolian**. Code and identifiers in English
- Three shells: `(teacher)`, `(parent)`, `(admin)`
- Confirm before delete, toast after save, loading state over ~300 ms
- Every field has a `<label>`, every image an `alt`
- **Mobile-first.** It works on a phone before it works anywhere else
- Empty states say what to do next

---

## 6. Slow work goes to a queue

BullMQ, never inside a request: PDF generation (~2.5 s), image processing, bulk
notifications, cleanup sweeps.

The report worker needs Chromium, ≥ 1 GB RAM, and **Cyrillic fonts installed
system-wide**. It cannot run on Vercel.

---

## 7. Scope

**Scope runs through RFP Phase III.** Changed 2026-08-25 by the client, in
writing, after the Phase 1 MVP was delivered and accepted
(`PHASE_1_ACCEPTANCE.md`: 14 PASS, 1 blocked).

This rule used to say "MVP = Phase 1 only" and list attendance, meals, surveys,
health, allergies, medication, Excel and growth percentiles as forbidden. All of
them are now in scope, and three had already landed before the rule was
updated — which is the reason it is being updated rather than quietly ignored.
A mandatory rule that the codebase contradicts teaches everyone to stop reading
the file.

**In scope** — RFP §20 Phase II and Phase III, plus the appended modules:

attendance · meals and the weekly menu · surveys and their analytics ·
growth measurements and charts · milestones · allergies · medication ·
vaccination · safety incidents · document library · artwork comparison ·
annual, group and batch reports · Excel import and export · photo consent

★ **The client added a second document on 2026-08-25: `нэмэлт.md`**, a finance
and funding module — state funding rules and monthly reconciliation, food-cost
calculation, parent invoices, online payment, an accountant role, a financial
dashboard, financial audit trails and nine financial reports.

That contradicts the line below, which had payments, invoices, QPay and the
accountant role as Phase IV. **It is now requested work**, so the line moves —
same reason §7 moved the first time: a rule the codebase is about to contradict
teaches everyone to stop reading the file.

What has been built from `нэмэлт.md` so far, and what has not. **Updated
2026-08-31** — the previous version of this list said "§3–§10, §13, §14, §16 —
the finance module proper — not started", and by then §4, §5 and §6 had shipped.
The list is corrected rather than left standing for the reason this whole
section keeps repeating: a rule the codebase contradicts stops being read.

- §1's sixth attendance status (`OTHER`) — **done**, it had been dropped.
  ★ It was called done on 2026-08-25 and was half true until 2026-09-02: the
  Prisma enum had it, `ATTENDANCE_STATUS_LABEL` named it, the funding register
  filtered on it — but `attendanceStatusSchema` and `recordAttendanceSchema`
  both stopped at five, so the "Бусад" button the teacher's day sheet has been
  drawing all along failed on save. A status list written out by hand in four
  places is how that happens
- §2 the meal register, §12's dish fields — **done**
- §11 the allergy cross-check — **done** (it was already RFP Module 2)
- §13 the accountant role — **done**, `Role.ACCOUNTANT`
- §4, §5, §6 state funding, the rules engine, the monthly calculation —
  **done**: `FundingRule`, `FundingCalculation`, `settle()`, the monthly
  register and its Excel export, `/admin/funding` and `/finance`. The rule
  table ships **empty**, by §4's own instruction that no tariff is hard-coded
- §3 meal cost — **partial**: `dependsOnMeals` weights a funding rule, but
  there is no per-child meal cost split by source
- §7 invoices — **done**: `Invoice`, `InvoiceLineItem`, `Payment`, a
  hand-written invoice, the carried balance, and `POST
  …/invoices/generate-month` which bills a whole month from the `PARENT`
  tariffs × the month's attendance and meal days
- §8 online payment — **built, then narrowed**. ★★ **QPay now charges one
  thing: the portal access fee** (client, 2026-09-01 — "QPay-ийг зөвхөн эцэг
  эхчүүдээс энэхүү website-ийг ашиглах эрхийг нээхийн тулд мөнгө авна. Өөр
  зүйлд QPay ашиглахгүй"). A family's tuition and meal invoices are still
  raised and still settled — cash or transfer, recorded by the accountant —
  but never through the gateway.

  `AccessSubscription` is one child × one school year, priced per deployment
  (`ACCESS_FEE_AMOUNT`, **"0" turns the gate off** and is the default).
  `QpayInvoice` points at it. **No `Payment` row is written** for a fee: it is
  the platform operator's revenue, and a kindergarten's ledger must not carry
  income its accountant will never find on their own statement.

  ★ **This is the one place the product answers 402 instead of 404.** §1.7's
  rule protects against confirming a record exists; an unpaid guardian already
  knows their child exists, and a 404 would hide the one fact that lets them
  fix it. Authorization still runs **first**, so a stranger gets 404 and the
  402 can never become an oracle — `authz/portal-access.ts`,
  `test/portal-access.test.ts`.

  **One merchant serves every kindergarten** (client, 2026-08-31), so the
  credentials and the price are deployment settings, not columns. A pending
  attempt is a `QpayInvoice`, **not** a settled fact — a QR nobody has scanned
  is not money that moved

★ **§7 and §8 were built twice.** `main` and `origin/main` diverged at
`878a3a2` and each wrote the whole module into the same paths; the merge on
2026-09-01 kept `origin/main`'s, because that code was already live and its
migrations were already in the production database — not because the design
was better. Both were sound. The reasoning, the two defects fixed on the way in
(JavaScript floats for money; a `/v2` doubled into the QPay base URL) and what
was lost (a line no longer points at the `FundingRule` that produced it, and no
longer carries `quantity × unitAmount`) are in `docs/FINANCE_MODULE.md` §1.
- §9 the financial dashboard — **done**: `/kindergartens/:id/invoices/dashboard`
  and the panel at the head of `/finance`. Nine figures, none of them stored —
  every one aggregated on read from the calculations, invoices and payments
- §10 the child finance tab — **done**: `/children/:id/finance`. **A guardian's
  payload omits `funding` entirely** — the state's payments to the kindergarten
  are its revenue, not the family's debt
- §16 the nine reports — **done**: a screen at the foot of `/finance`, Excel
  inline, and PDF on BullMQ as a `FINANCE_REPORT` job. Eight keys, not nine —
  "Ирц–санхүүжилтийн тулгалт" is the monthly register, which shipped with §6 and
  already exports. ★ A `FINANCE_REPORT` job carries **no `childId`**, which is
  what keeps every `canAccessChild`-gated report route from ever serving one
- §14 the financial audit log — **partial**: `AuditLog` records every financial
  action, but not consistently as `Өмнөх утга → Шинэ утга`, and the reversal
  rule for confirmed transactions is not built
- §15 the external-ID history — **not started**

★ §14 asks that a confirmed financial transaction is **never deleted** —
"Залруулга эсвэл reversal transaction ашиглана". That is stricter than §3.2's
soft delete and overrides it here: a confirmed payment gets a **reversing row**,
not a `deletedAt`. §3.2 stays the rule everywhere else.

★★ **Chat moved into scope on 2026-08-29, at the client's explicit request.**

It was listed below as Phase IV, and the rule above worked exactly as written:
the request was raised against §7, the phase was named, the client was asked,
and they answered "build it fully". This line moves rather than being quietly
ignored — the third time §7 has moved and for the same reason each time, which
is stated a few paragraphs up: a mandatory rule the codebase contradicts stops
being read.

What that costs is worth writing down, because "chat" is one word and a
fortnight of work: a message model, an authorization path of its own, a
paginated history endpoint, an unread cursor per person per room, and a
realtime story. It is being built against the same rules as everything else —
membership derived per request (§1.3), 404 for a room you are not in (§1.7),
`kindergartenId` on every row (§3.1), soft delete (§3.2), no unbounded list
(§3.4). **There is no AI in it**, which the client stated three times: it is a
group message board, not an assistant.

**Still out** — RFP §20 Phase IV, minus what `нэмэлт.md` and the 2026-08-29
request pulled forward. Say which phase it belongs to and ask:

native mobile apps · SMS · push notification · QR pick-up ·
electronic signature · multi-language · AI observation suggestions ·
voice-to-text

Pulling work forward silently is still how a three-week delivery becomes six.
The difference is that the client has now asked for this much, explicitly.

---

## 8. Common mistakes

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
| Serving R2 objects by direct URL               | `/media/:id` + presigned URL after the check |
| Authenticated fetch without `no-store`         | Always `cache: "no-store"`                   |
| Saying "done" without running tests            | Run them, show the output                    |

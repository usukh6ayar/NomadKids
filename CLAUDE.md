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

**MVP = Phase 1 only.** Not in the MVP:

attendance · meals · finance · funding · invoices · payments · QPay ·
accountant role · health · allergies · medication · chat · realtime ·
WebSocket · push · SMS · surveys · Excel import/export · analytics ·
radar charts · growth percentiles · AI · voice-to-text · native mobile apps

If asked for one: say which phase it belongs to and ask whether to pull it
forward. Pulling work forward silently is how a three-week delivery becomes six.

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

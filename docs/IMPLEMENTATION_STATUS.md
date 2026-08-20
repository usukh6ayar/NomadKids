# IMPLEMENTATION_STATUS.md

Running status of the MVP build. Updated at the end of every phase with what was
actually verified, not what was intended.

**Rule:** nothing is marked complete without a command and its real output.

---

## Summary

| Phase | Scope                                     | Status      |
| ----- | ----------------------------------------- | ----------- |
| 0     | Architecture, docs, PDF spike             | ✅ complete |
| 1     | Repository foundation                     | ✅ complete |
| 2     | Database — Prisma schema, migration, seed | ✅ complete |
| 3     | Auth + authorization core                 | ✅ complete |
| 4     | Kindergarten / school years / groups      | ✅ complete |
| 5     | Children / guardianships / enrollment     | ✅ complete |
| 6     | Portfolio                                 | ✅ complete |
| 7     | Observations + media                      | ✅ complete |
| 8     | Assessment                                | ✅ complete |
| 9     | Notifications                             | ✅ complete |
| 9b    | Dashboards + audit read API               | ✅ complete |
| 10    | Reports + PDF                             | ✅ complete |
| 11    | Web UI                                    | ⬜ pending  |
| 12    | QA + security                             | ⬜ pending  |
| 13    | Production readiness                      | ⬜ pending  |

**Git:** no commits. Working tree holds the whole build, uncommitted by
instruction.

---

## Phase 0 — Architecture, documentation, PDF spike ✅

**Delivered:** `ARCHITECTURE.md`, `DATABASE.md`, `API.md`, `SECURITY.md`,
`UI_UX_MAP.md`, `MIGRATION_PLAN.md`, `PDF_SPIKE.md`, `DEPLOYMENT.md`, `CLAUDE.md`.

**PDF spike — executed, not estimated.** Puppeteer + Chromium: 19-page Mongolian
portfolio, 1.9 s on macOS / 2.5 s in a Debian container, 775 MB RSS, 512 MB
memory floor measured (384 MB fails), 10,266 Cyrillic characters verified by
extracting text back out of the PDF.

Found a failure that would have reached production: **Chromium renders no text
at all — not tofu, nothing — when fontconfig has an empty font set**, even
though `@font-face` loads. A blank report that reports success. Two competing
hypotheses were tested and rejected before the real cause was isolated.
`PDF_SPIKE.md` §4.

react-pdf and Gotenberg were assessed against the same requirements rather than
benchmarked, because Puppeteer passed all of them and the stack decision named
it. Stated as a judgement, not a measurement — `PDF_SPIKE.md` §7.

**Decisions:** D1–D13 settled. D13 (data residency outside Mongolia) approved by
the client 2026-08-19; production domain `nomadkids.mn`.

---

## Phase 1 — Repository foundation ✅

pnpm workspace: `apps/web`, `apps/api`, `packages/contracts`.

**Verified:**

```
pnpm typecheck   → 3/3 projects clean
pnpm lint        → 0 errors
pnpm format:check→ all files match
pnpm test        → 46/46 passing (contracts 6 · api 34 · web 6)
next build       → compiled, 3 routes
nest build       → 10 JS files, no test files in dist
node dist/main.js→ boots, connects to Postgres
```

Real HTTP verification:

```
GET /v1/health           → 200 {"status":"ok"}
GET /v1/nope             → 404 application/problem+json, Mongolian title
CORS https://evil.test   → no allow-origin header (refused)
CORS http://localhost:3000 → allow-origin + allow-credentials
```

**Load-bearing pieces:** the ESLint Prisma boundary (with a test proving the rule
still fires), `tenant-scope.ts` (AND-nested filters a caller cannot disable), Zod
environment validation with production-only invariants, `ZodValidationPipe`,
problem+json filter, and an API client that cannot be called without
`cache: "no-store"`.

**Four real problems hit and fixed:** Prisma 7 moved the datasource URL out of
the schema; TypeScript 7 pinned back to 5.9.3 for NestJS decorator metadata;
Nest's `ValidationPipe` needs class-validator so a Zod pipe replaced it; a
`.tsbuildinfo` outside `dist` produced a silently incomplete build.

---

## Phase 2 — Database ✅

**29 tables** — the 28 designed in `DATABASE.md` plus `Session`, which the
refresh-token rotation in Phase 3 needs and the design document had folded into
prose.

**Verified against a genuinely clean database**, not just the working one:

```
DROP DATABASE kinder_fresh; CREATE DATABASE kinder_fresh;
prisma migrate deploy  → applied 20260819055205_init
seed                   → 5 domains · 4 levels · 5 observation types · superadmin

tables       29
indexes     114
partial idx   5
fks          70
domains       5
```

Migration reviewed by hand for data-losing operations (CLAUDE.md §3.4): none.
The `DROP` matches were all `ON DELETE` clauses.

### Five constraints Prisma cannot express, added by hand

Prisma emits `UNIQUE("kindergartenId", "code")` — but **Postgres treats NULLs as
distinct**, so that does not stop two system config rows sharing a code. Running
the seed twice would have silently duplicated every development domain, and
every screen resolving a domain by code would start picking one arbitrarily.

```sql
development_domains_system_code_key         -- WHERE kindergartenId IS NULL
assessment_levels_system_value_key          -- WHERE kindergartenId IS NULL
observation_types_system_code_key           -- WHERE kindergartenId IS NULL
school_years_one_current_per_kindergarten   -- WHERE isCurrent = true
enrollments_one_active_per_child_year       -- WHERE status = 'ACTIVE'
```

The last one is the load-bearing part of enrollment history: a child may hold
one _active_ enrollment per school year, while ended and transferred rows stay
unconstrained. Deleting history is what breaks authorization after a transfer.

### Tests — 54 passing (api), 66 across the workspace

`test/schema.test.ts` asserts against **real Postgres**, because it is testing
guarantees that live in the database rather than in TypeScript. Prisma's types
accept every operation below; the database refuses them:

- duplicate system domain code / level value → rejected
- a kindergarten overriding a system code → allowed
- two current school years in one kindergarten → rejected
- two ACTIVE enrollments for one child+year → rejected
- an ended enrollment beside a new active one → allowed (this is a transfer)
- deleting a kindergarten that still has children → rejected (`onDelete: Restrict`)
- `visibleToParents` defaults to **false** — if that default ever flips, every
  private teaching note in the system becomes visible

### A bug the tests caught immediately

`TRUNCATE ... CASCADE` empties dependent tables **entirely**, not just the rows
that cascade — so truncating `kindergartens` wiped the `kindergartenId IS NULL`
system config too, and every test after the first failed. Fixed by extracting
`prisma/system-config.ts`, used by both the seed and `resetData()`, so tests and
production can never run against different domain definitions.

**Verified:** `typecheck` 3/3 clean · `lint` 0 errors 0 warnings ·
`format:check` clean · `test` 66/66.

---

## Phase 3 — Auth + authorization core ✅

### The authorization module

`src/authz/` — pure decision functions with no database access, so the rules can
be tested exhaustively without fixtures and there is exactly one place that
answers "may this person see this child".

- `child-access.ts` — `canAccessChild` / `canRecordForChild` /
  `canAdministerChild`, plus `childKindergartenIds`, which is what makes a
  transfer safe.
- `authz.repository.ts` — loads the facts. No decisions.
- `child-access.service.ts` — throws **404, never 403**.

**Writing is deliberately narrower than reading.** A guardian may read their
child's portfolio; `canRecordForChild` refuses them. That single distinction
covers a whole family of reference-suite cases
(`test_a_guardian_cannot_edit_their_own_child`,
`test_delete_refuses_the_childs_own_guardian`).

### Authentication

argon2id · HttpOnly `SameSite=Lax` cookies, **no `Domain`** · 15-minute access
JWT · rotating opaque refresh with family-level theft detection · CSRF
double-submit + origin check · in-process rate limiting · database-backed
lockout.

Four properties that are easy to lose and are each pinned by a test:

- **The access token carries only `userId` and `sessionId`.** Roles are re-read
  from `Membership` per request, so revoking a teacher's assignment takes effect
  on the next call — verified by a test that revokes mid-session and sees the
  membership list empty without re-login.
- **Failure records are never transactional.** `LoginAttempt` and the
  `login_failed` audit row must survive a rolled-back request or the lockout
  counter silently resets.
- **Unknown user and wrong password are indistinguishable** — same status, same
  message, and a burned argon2 verification so the timing matches too.
- **Replaying a rotated refresh token revokes the whole family.** Two parties
  holding the cookie means it was stolen.

### Tests — 127 passing (api), 139 across the workspace

`test/auth.test.ts` (43 cases) runs against the real app, real Postgres and real
cookies. `src/authz/child-access.test.ts` (29 cases) covers the decision
functions exhaustively. Both exist because they prove different things: a
controller that forgets to call `canAccessChild` passes every unit test.

### Three real bugs, found by running rather than by testing

1. **`/v1/health` returned 401.** The global `AuthGuard` locked the health
   endpoint. The existing test imported `HealthModule` alone, so the guards
   never ran and it passed — while the deployed container would have failed
   every liveness probe and been restart-looped by the platform. The test now
   boots the full app and asserts both that health is reachable _and_ that
   `/auth/me` is not.
2. **Every Mongolian error message was being discarded.** `ProblemExceptionFilter`
   only forwarded array-shaped validation messages, so "Хэт олон удаа буруу
   оролдлоо" reached the user as a generic title. Thrown messages now become
   `detail`; unexpected exceptions still send nothing, so a Prisma error cannot
   leak table names.
3. **`TokenService`'s optional constructor parameter broke DI.** Nest cannot
   distinguish an optional parameter from a provider; the error pointed at
   "index [0]" rather than at the environment.

### One structural decision

The ESLint Prisma boundary fired on `generated/prisma/enums` — importing a
constant like `Role`, not the query surface. Rather than carve an exception into
a security rule (which weakens it for every future file), `src/domain/enums.ts`
is now the single sanctioned re-export seam and the only file exempted. The
boundary itself stays absolute.

**Verified:** `typecheck` 3/3 · `lint` 0 errors · `format:check` clean ·
`test` 139/139 · live app: `/v1/health` → 200, `/v1/auth/me` → 401.

---

## Phase 4 — Kindergarten / school years / groups / users ✅

**29 routes live**, verified from the running app's route map. Built
deliberately as the template Phases 5–10 copy: controller → service →
repository, `scopedWhere` composed in every tenant query, Zod DTOs, pagination,
and uniform 404.

### Three decisions settled here, because nine modules will inherit them

1. **404 for every authorization failure, including wrong-role.**
   `API.md` had said 403 for role gates; the reference suite says 404, even for
   `test_a_teacher_cannot_reach_the_admin_screens`. D2 makes the reference the
   acceptance criterion, and one rule cannot be got wrong endpoint by endpoint.
   403 now means CSRF/origin rejection **only**. `RolesGuard` throws
   `NotFoundException`; `SECURITY.md` §5.4 and `API.md` §1.1 updated.

2. **`scopedWhere` is used, not decorative.** It had tests and no callers. Every
   tenant query in `tenants.repository.ts` now composes it, so `deletedAt: null`
   and the kindergarten filter are structural rather than remembered.

3. **`TenantAccessService`** — the kindergarten-scoped counterpart to
   `ChildAccessService`. `assertAdmin` / `assertMember` / `assertStaff`, all
   taking the id from the _resource_, never the request.

### Authorization properties pinned by tests

- **A teacher's group list contains only their assigned groups** — and
  `?kindergartenId=` narrows, never grants.
- **Ending an assignment revokes access on the next request**, no re-login.
- **Revoking a membership also ends its group assignments.** Without this the
  `GroupTeacher` rows stay open and reactivating the membership later silently
  restores access to groups nobody re-granted.
- **Isolation tested in both directions.** An asymmetric scope bug passes a
  one-directional suite and fails the moment the other kindergarten makes the
  request.
- **A user cannot reactivate their own deactivated account** — `isActive` is
  absent from the profile DTO and unknown properties are stripped.
- **New users get an invitation, never an admin-chosen password.** The account
  is created with an unusable random hash.

### Two real bugs found by tests, one by review

- **School-year `isCurrent` ordering.** The old current year was demoted
  _after_ the insert — but the partial unique index rejects the insert first, so
  the demotion never ran. Now demote-then-create inside one transaction.
- **`list` and `detail` authorization disagreed.** `visibleChildrenWhere` used
  `enrollments: { none: {} }` without `deletedAt: null`, while
  `loadChildAccessFacts` filtered deleted rows — so a child whose only
  enrollment was soft-deleted was reachable by URL but absent from the list.
  Confirmed by writing the failing test first (`detail: true, list: false`).
  `test/authz-consistency.test.ts` now holds 16 cases keeping the two
  definitions identical; they will drift again otherwise.
- **`clearFailures(userId)` cleared nothing.** `LoginAttempt.identifier` stores
  what was typed, not a user id — deliberately, so failures against unknown
  usernames still count. A locked-out user therefore stayed locked out after a
  successful password reset. Now clears by every identifier the user can log in
  with, with a test for the whole locked-out → reset → login path.

### Also closed

- **`PasswordService.burn()`** used a hand-written literal hash inside a
  `.catch()`. Had argon2 ever rejected it the timing defence would have
  vanished silently. Now self-generated at first use, with a test asserting it
  costs real time (measured: 125 ms vs 112 ms for a genuine verify).
- **`MaintenanceService`** prunes `LoginAttempt`, `AuthToken` and `Session`.
  `LoginAttempt` is scanned on every login, so an unbounded table degrades the
  exact endpoint under attack. Revoked sessions are kept 7 days — deleting them
  on revocation would make a replayed refresh token look merely unknown and the
  family-revocation defence would never fire.
- **Authorship columns dropped from the design** (`DATABASE.md` §1.4).
  `AuditLog` already records who did what with more context; three FK columns on
  25 tables would duplicate a subset of it, and two records of one fact drift.

**Verified:** `typecheck` 3/3 · `lint` 0 errors · `format:check` clean ·
`test` **260/260** (api 248 · contracts 6 · web 6) · 29 routes mapped in the
running app.

---

## Phase 5 — Children / guardianships / enrollment ✅

The authorization heart of the system. 14 routes; **53 HTTP tests** covering
every case the brief names.

### The attack matrix, all through real requests

| Class              | Cases                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| IDOR               | 8 — detail, PATCH, enroll, guardians, enrollments; a nonexistent id is byte-identical to a forbidden one |
| Cross-kindergarten | 4, tested in **both directions**                                                                         |
| Revoked guardian   | 4 — access dies mid-session, the record survives, restoration works                                      |
| Revoked teacher    | 3 — assignment ended, and whole membership revoked                                                       |
| Sibling isolation  | 2 — a classmate in the same room is still 404 for a parent                                               |
| Multiple guardians | 2 — revoking one leaves the other intact                                                                 |
| Multiple teachers  | 2 — same                                                                                                 |
| Write ⊂ read       | 9 — a guardian reads their child and cannot edit, archive, enrol or add guardians                        |

### Enrollment history behaves as authorization requires

A transfer **ends** the old row and creates a new one, in one transaction, in
that order — the partial unique index rejects the insert otherwise, and doing it
the other way round produces a transfer that silently did nothing.

Tested: the previous teacher still reaches the child after the transfer (D2,
behaviour preserved), exactly one ACTIVE enrollment per school year survives,
and ending an enrollment never sets `deletedAt`.

### Two infrastructure bugs found by running the suite repeatedly

Both were invisible in a single green run, and both would have wasted days
later:

1. **argon2 at production cost made the suite unusable.** Six logins per test at
   ~110 ms each — the children file alone took **350 s** and hit hook timeouts.
   Now `PasswordService` uses reduced parameters when `NODE_ENV=test`, while
   `password.service.test.ts` constructs a service with the _production_
   parameters explicitly and asserts `burn()` still costs real time. The
   hardening cannot be weakened without that test failing. 350 s → 9 s.

2. **Supertest was exhausting ephemeral ports.** `request(app.getHttpServer())`
   binds a _fresh listener per request_ when the server is not already
   listening. At several hundred logins per file this reused sockets mid-response
   and produced failures that looked like anything but the cause — `Parse Error:
Expected HTTP/`, a login returning 400, a `beforeEach` timing out — moving to
   different tests on every run. Fixed by having the test app `listen(0)` once.

   Verified by running the full suite **five consecutive times: 0 failures**.
   Before the fix it was 2 failures in 6 runs.

Also fixed: the Prisma test client is a module-level singleton captured at
import time, so disconnecting moved from each file's `afterAll` (where the first
file to finish killed the client every later file held) to a global teardown.

**Verified:** `typecheck` 3/3 · `lint` 0 errors · `format:check` clean ·
`test` **313/313** (api 301 · contracts 6 · web 6) · 5 consecutive clean runs.

---

## Phase 6 — Portfolio ✅

8 routes, **50 tests**. "Миний тухай", ages 2–5, birthday notes, overview.

### The rule I would have got wrong without checking

The brief said to verify parent write scope against the reference before
implementing. That was the right instruction:

> **Portfolio editing is gated by `can_access_child` — read access — not
> `can_record_for_child`.**

The reference's `save_about_me`, `save_age_profile` and `save_birthday_note` all
use the read-level check. **Guardians are meant to write to the portfolio**; it
is a family record, not a professional one. Applying the stricter check that
governs observations — the natural assumption, and what I would have written —
would have silently turned every parent read-only and removed a feature the
client already has.

There is a test named for exactly this, so it cannot regress quietly:
_"If this ever returns 404, portfolio editing has been wrongly gated on
canRecordForChild and every parent has silently become read-only."_

### The two-voices rule — RFP §4.3

`parentNote` is the guardian's, `teacherNote` is the teacher's, and **neither
may overwrite the other's**. Seven tests cover it, including:

- a guardian's crafted write of `teacherNote` → 400 naming the field, and the
  teacher's existing note is **untouched**
- the whole request is rejected rather than partially applied — a partial save
  is harder to reason about than a refusal
- **a teacher who is also the child's own guardian writes the parent note.** The
  branch keys off _relationship to this child_, not role; keying off
  `Role.PARENT` would get this backwards, and a teacher whose child attends the
  same kindergarten is a real case

### Two API-shape decisions

- **Schemas are `.strict()`.** Zod's default silently strips unknown keys, which
  here is wrong twice over: a portfolio save that discards half the form looks
  like it worked, and stripping would remove `teacherNote` from a guardian's
  payload before the service saw it — producing a cheerful 200 for a write that
  never happened.
- **An unwritten section returns an empty shape, not `null`.** Returning `null`
  sends an empty HTTP body, which a form cannot bind to and a client cannot
  distinguish from a failure. A section nobody has filled in is a normal state.

### The overview is an overview

Presence, counts and timestamps — **not content**. A test asserts the
introduction text does _not_ appear in the overview response, which is what
stops it drifting into the dashboard the brief rules out.

**Verified:** `typecheck` 3/3 · `lint` 0 errors · `format:check` clean ·
`test` **363/363** · 49 routes mapped in the running app.

---

## Phase 7 — Observations + media ✅

16 routes, **97 tests** (48 observations · 31 media · 18 upload validation).
65 routes total in the running app.

### A schema change the reference forced

Reading `apps/observations/services.py` before implementing surfaced two things
the initial schema had wrong. Migration
`20260819190000_observation_author_and_review_status`:

1. **`Observation.authorId` was missing.** A guardian may edit their own
   submission before approval, and always sees their own pending note — both are
   query-time questions the audit log cannot answer. This is domain authorship
   (like `assessedById`), not audit data, so `DATABASE.md` §1.4 still holds.

2. **`ReviewStatus.NOT_REQUIRED` was wrong.** The reference approves a teacher's
   own observation on save — _"there is nobody above them to approve it"_ — and
   the parent read filter is `visibleToParents AND APPROVED`. With my default,
   **every teacher observation would have been invisible to the family it was
   written for.** The enum now has PENDING / APPROVED / RETURNED, defaulting to
   APPROVED.

The migration header documents that the enum cast fails loudly on any surviving
`NOT_REQUIRED` row, and why that is the intended behaviour rather than a silent
coercion.

### The rules, each verified rather than assumed

| Rule                             | Behaviour                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Filing a **parent** observation  | needs read access — the §5.4 feature                                                                 |
| Filing a **teacher** observation | needs record access; a guardian gets 404                                                             |
| Teacher note default             | private, APPROVED                                                                                    |
| Parent note default              | visible to its author, PENDING, excluded from the report                                             |
| Guardian read filter             | `visible AND approved` **OR** their own submission                                                   |
| Guardian edit window             | own submission only, until a teacher approves it                                                     |
| §5.4 teacher decisions           | visibility, report inclusion, domains — stripped from a guardian's payload even when posted directly |

The "own submission" clause is not a convenience: without it a parent's note
would vanish on save and reappear only after a teacher acted, and they could not
tell whether it had saved.

### Media — private R2, tested against real MinIO

- **Random storage keys**, `children/{uuid}/{uuid}`. A test asserts the uploaded
  filename appears in neither the key nor any response.
- **Authorization before the URL.** A presigned URL is a bearer credential;
  generating one for an unauthorized caller has already leaked the object. The
  test asserts the response carries no signature at all.
- **The bucket really is private** — a test fetches the object's raw URL without
  a signature and requires ≥400. Assumed privacy is not privacy.
- **A photo inherits its observation's visibility.** The note staying hidden
  while its pictures do not is the more embarrassing half of the same leak.
- **EXIF stripped** by re-encoding through sharp, verified by asserting the
  metadata is gone rather than trusting the call.
- **302 redirect rather than JSON**, so the credential spends less time in
  client memory.

### Three bugs found by running

1. **Two rate-limiter instances.** `MediaModule` declared its own
   `RateLimitService`, so Nest built a second counter — which one a request
   landed in depended on which module's guard resolved it. The suite exposed it
   as spurious 429s; in production it would have been quieter and worse, a
   documented limit of 5 login attempts behaving like 10. Now a single `@Global`
   `RateLimitModule`.

2. **★ Every Mongolian filename was corrupted on upload.** Busboy decodes the
   multipart `filename` parameter as latin1, so `зураг.jpg` arrives as
   `Ð·ÑÑÐ°Ð³.jpg`. Invisible in an English-language test suite; caught by
   asserting a Cyrillic name survives the round trip. The repair is conditional
   and round-trip checked, so an already-correct name is not corrupted the other
   way.

3. **`file-type` is ESM-only** and would not resolve from this CommonJS build.
   Replaced with 20 lines of magic-byte detection for the three allowed formats
   — fewer moving parts than an interop shim, on the security-critical path.
   `validateImageUpload` now takes no filename at all, which is a stronger
   guarantee than remembering not to echo it.

**Verified:** `typecheck` 3/3 · `lint` 0 errors · `format:check` clean ·
`test` **472/472** · 65 routes mapped · `/v1/health` 200 from the built app.

---

## Phase 8 — Assessment ✅

12 routes, **39 tests**. 77 routes total in the running app.

### ★ A scope violation caught before any code was written

`docs/API.md` §9 — which **I** wrote in Phase 0, before the scope was fixed —
specified:

```
GET /groups/:id/assessment-grid   → children × domains matrix
PUT /groups/:id/assessment-grid   → array of cells
```

The standing instruction says three times that assessment stays **one
development domain at a time** and not to build the 9-domain matrix. Following
my own document would have built the forbidden thing.

Rather than trust either the brief or my doc alone, I checked the reference
project. Its UI map records a P0 to build that matrix and then says: **"That is
now cancelled. Assessment stays one domain at a time, which is what the backend
does."** All three sources now agree; API.md §9 was rewritten first, and the
endpoint was implemented afterwards.

**`domainId` is required, not optional.** That is the structural guard: an
optional domain is exactly how this endpoint drifts back into a matrix. Tests
assert 400 when it is omitted, 400 when `termId` is omitted, and 400 for an
unknown extra parameter (`.strict()` query schema).

### Measured, not asserted

The reference pins the group screen's query count with `assertNumQueries`
because it is the screen a teacher opens most often. My first attempt at the
equivalent test contained dead code and measured nothing — it asserted on the
response shape, which would pass against a per-child query loop.

Replaced with a real measurement: the repository runs against an instrumented
Prisma client and the operations are counted.

```
group of  2 children → 2 queries
group of 20 children → 2 queries
```

### Visibility rules — different from observations, verified

|                  | Rule                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| Assessment       | visible to a guardian when `visibleToParents` is set. **No approval workflow** — unlike observations |
| Publishing       | **per term**, not per assessment. A teacher decides "this term is ready to share"                    |
| New assessment   | `visibleToParents: false`. If that default flips, every in-progress assessment reaches families      |
| Term report      | visible only when **FINAL**. A draft is the teacher's working text                                   |
| Missing vs draft | the **same** response to a parent — telling them a draft exists is its own disclosure                |

Also enforced: a child in the bulk save must actually be enrolled in _that_
group for _that_ year, or a valid child id from elsewhere would have an
assessment written against a group they do not attend.

### Consistency fix

`getTermReport` returned a bare `null`, which sends an empty HTTP body — the
same ambiguity I fixed for About Me in Phase 6. Now returns an explicit
`exists: false` shape, so the decision is applied consistently rather than per
endpoint.

**Verified:** `typecheck` 3/3 · `lint` 0 errors · `format:check` clean ·
`test` **511/511** · 77 routes mapped in the running app.

---

## Phase 9 — Notifications ✅

9 routes, **40 tests**, passing on the first run.

### The property that carries the weight

A family's audience is derived from **their own children** — their child ids,
those children's _active_ groups, and the kindergartens they attend — never from
memberships. That is what makes it structurally impossible for a targeting
mistake to deliver a family a notice about a child they are not connected to.

Targeting is §8.1's three cases, and "the whole kindergarten" is expressed as
**having no target rows** rather than an `isEveryone` flag. A flag goes stale
the moment someone adds a target and forgets to clear it; the absence of rows
cannot.

Tested: a group target reaches that group only; a child target reaches that
child's family and not their classmate's; **a notice to last year's group does
not follow the family**, because only ACTIVE enrollments contribute a group.

### Read tracking, no realtime

Per ARCHITECTURE.md §7 this is REST plus polling. `GET
/notifications/unread-count` is polled at 60 s while the tab is visible. At a
handful of notices a day that is indistinguishable from realtime to the user,
and it removes a stateful connection layer and a second auth path.

- Marking read is **idempotent** and goes through the audience filter first —
  otherwise the endpoint confirms that a notice exists.
- Read state is per user: one parent reading does not clear it for the other.
- **The response never says who else has read it.** A family's reading habits
  are not the staff's business; each response carries only the caller's own
  receipt.

### Draft is the default

A new notice is a DRAFT and publishing is a separate act, so a half-written
notice cannot reach two hundred families because someone hit save. A guardian
cannot see a draft, by list or by id. Editing is open to any staff member in the
kindergarten — §8.1 is a shared queue, not a personal outbox.

**Verified:** `typecheck` 3/3 · `lint` 0 errors · `format:check` clean ·
`test` **551/551**.

---

## Phase 9b — Dashboards + audit read API 🔄

Not in the original phase list. `API.md` §13–14 specify
`/dashboard/{teacher,admin,parent}` and `GET /audit`, and "Dashboard" is the
first item in the teacher navigation — but no phase owned them. Found by
auditing the plan against the spec rather than by reaching Phase 11 and
discovering the gap.

5 routes, **32 tests**, passing on the first run. 90 routes total.

### A dashboard is a scoped view, not a summary

Every count and list is bounded by the same authorization the detail endpoints
use. A dashboard that builds its own filters is precisely how a private
teaching note reaches a family through the side door, so the parent feed reuses
the observation visibility rule verbatim — and a test asserts a private
observation does **not** appear there.

Teacher: three actionable lists (submissions to review, children not yet
assessed **this term**, recent observations to resume from) plus the counts that
give them context. No charts, no analytics — the brief excludes both, and a test
asserts the response has neither key.

The assessment list reports **the gap, not the coverage**: children already
assessed need no action, so they are not on it.

### Cases that would have been production incidents

- **A revoked teacher gets an empty dashboard, not an error.** Their first
  screen after losing an assignment must not be a stack trace.
- **A kindergarten with no terms configured does not 500 on login.** Every
  term-dependent query is skipped rather than run against a null id.
- **`GET /dashboard/parent` has no `@Roles("PARENT")`.** The feed is built from
  guardianships, so a role gate would lock a teacher out of their own child's
  screen. Tested with a dual-role user.
- **`/dashboard/primary`** decides post-login routing server-side, so the rule
  lives in one place rather than one per client.

### Audit read API

Read-only and admin-only, scoped to the admin's own kindergartens. It answers
RFP §971's "who accessed this child's record" — which is itself sensitive, since
it lists which staff opened which files and when.

**The `childId` filter runs `assertCanAccess` first.** Without that the filter
answers "does child X exist in a kindergarten I administer" for any id an
attacker cares to try. A test confirms probing another kindergarten's child
returns 404.

There is deliberately **no write endpoint** — entries are appended internally by
the services that perform the actions, and a test asserts `POST /v1/audit` is
not routable.

**Verified:** `typecheck` 3/3 · `lint` 0 errors · `format:check` clean ·
`test` **583/583** · 90 routes mapped.

---

## Phase 10 — Reports + PDF ✅

Portfolio PDF (RFP §10.3) and term report PDF (§6.4), generated off-request
through BullMQ, stored privately, downloaded by presigned URL, expired on a
schedule.

12 source files, 5 routes, **31 new tests**. 614 passing, 95 routes.

### The spike's findings had to reach the image, not just the document

`PDF_SPIKE.md` §4 found that Chromium renders **no text at all** — not tofu,
nothing — when fontconfig has an empty font set. Images, borders and page breaks
all still work; the job reports success and a family downloads a blank portfolio
of their child. A finding written down in a spike document does not stop that.
Three things do, and all three now exist:

1. `apps/api/Dockerfile` copies the bundled fonts into `/usr/share/fonts` and
   runs `fc-cache -f`, with the reasoning inline so the lines survive the next
   image-slimming pass.
2. `font-check.ts` **refuses to start the worker** without a Cyrillic-capable
   font. A container that would render blank PDFs must not accept jobs.
3. The test asserts on **extracted text**, via `pdftotext` — including `[өүӨҮ]`,
   the characters a Russian-only fallback font would silently drop. A test that
   checks "did it produce a file" passes in exactly the broken state.

### ★ The cross-audience leak — caught before the service was written

A generated PDF is the only artefact in this system whose visibility filter is
applied **once**, at generation, and then frozen into a file that outlives the
request. Everything else re-derives visibility per request, so this class of bug
cannot arise elsewhere.

The failure: a teacher generates a portfolio containing private teaching notes
and unpublished assessments — correctly, they may see them. The output hangs off
the job as a `MediaFile`. A guardian later opens that job's download route,
passes `canAccessChild` (their own child), and receives the teacher's copy.

Fixed by recording the audience on the job (`report-params.ts`, never accepted
from the client) and gating download on **two** independent checks: requester
identity, and a live child-access check so a teacher who has left the group
cannot fetch a portfolio they generated last term. Both failures are 404.

### The report is a third reader of the same observations

The list endpoint, the detail endpoint and the PDF all answer "which
observations may this person see". The first draft of `reports.repository.ts`
wrote a **fourth** hand-rolled visibility filter — the same mistake that
produced the list/detail disagreement in Phase 5. It now composes
`ObservationsRepository.readableWhere`, and `authz-consistency.test.ts` gained
three cases asserting the report's observation set equals the list's for the
same viewer, and that a guardian's set is a strict subset of a teacher's.

### Photographs, measured — the envelope the spike never took

The spike's 512 MB floor and 384 MB failure were measured on a **text-only**
template. `report-images.ts` bounds three things (downscale to 1000 px, cap the
count, cap the total bytes), and `PDF_SPIKE.md` §9 records the measurement:
45 source photos totalling 212 MB → 40 embedded → **4.7 MB, 16 pages, 10.3 s**.

The measurement lied twice before it was right, and both are recorded because
both produced a passing test that measured nothing:

- **Flat-colour test images** compress to ~40 KB. The first run reported
  "0.0 MB each" and would have passed at any budget.
- **Identical test images** make Chromium embed **one** image XObject and
  reference it ninety times — 1 image in a report that appeared to carry 90.
  The test now asserts on the XObject count.

### Smaller decisions worth keeping

- **Failure messages are a fixed Mongolian sentence, never `error.message`.**
  `errorMessage` is shown to the requester, and a Prisma error carries table
  names while an S3 error carries the **storage key**. Tested.
- **Retention.** A finished PDF expires after 14 days and is swept nightly; the
  job row survives with the file reference cleared, so what was generated for
  whom stays auditable. A stored report is a copy of a child's record living
  outside the permission system that produced it — and D13 put that storage
  outside Mongolia.
- **Idempotent generation, and the orphan it used to leave.** BullMQ delivers at
  least once, and the first version handled only the easy case — a job already
  `DONE`. The case that mattered was a worker killed mid-render: the row sits at
  `RUNNING`, the job is redelivered, and a second PDF is written. With the media
  row and the job update as separate calls, the second overwrote
  `resultMediaFileId` and the first object was left in the bucket with nothing
  referencing it — invisible to `listExpired`, uncollectable by the retention
  sweep, containing a child's record. `completeJob` now does both in one
  transaction and reports whether it attached; a render that lost the race
  deletes what it wrote. A row that has a result but never reached `DONE` is
  reconciled rather than re-rendered.
- **Failures re-throw for the worker.** `run()` recorded the failure and then
  resolved, so BullMQ saw a successful job and `attempts: 3` was dead
  configuration — a renderer killed under memory pressure never got the quieter
  second attempt it usually needs. The worker now passes `rethrow: true`; tests
  pass `false` so they can assert on the recorded row.
- **A failed enqueue marks the job FAILED.** Leaving it `QUEUED` was worse than
  an error: nothing would pick it up and the client would poll a job that never
  progressed. The nightly sweep additionally re-enqueues jobs stuck at `QUEUED`
  for over 30 minutes, covering the narrower window where the row committed and
  the process died before the enqueue.
- **★ A draft term report is stamped `ТӨСӨЛ`.** A guardian can never reach one —
  their query filters to `FINAL` — but a teacher legitimately previews their own
  text, and the page otherwise carried a signature block and a "Баталгаажсан:"
  line with an empty date. It looked official, printed as official, and could be
  handed to a parent at a meeting with nothing marking it provisional. The
  banner is rendered and the signature block suppressed; asserted on extracted
  text.
- **`concurrency: 1`.** Each job holds a Chromium page against a 512 MB floor;
  two concurrent renders on a 1 GB instance is an OOM kill that surfaces as
  `Target closed` and reads like a Puppeteer bug.
- **`REPORTS_WORKER_ENABLED`** splits the worker out later without a code
  change, and is `false` in tests — a background consumer would race every
  assertion about a job's status. Tests call `ReportGeneratorService.run()`
  directly, which is what the worker calls.
- **`GET /health/readiness`** (admin-only) probes Chromium, Redis, storage and
  the font, for the pre-launch checklist. `/health` stays public and
  uninformative.
- **Term report CRUD already existed** in the assessment module from Phase 8, so
  Phase 10 added only its PDF path. A guardian's copy requires `FINAL`, checked
  at request time as well as generation time — otherwise a parent queues a job
  that fails minutes later, and the FAILED row itself confirms an unfinished
  report exists.

### Verified

```
pnpm typecheck   3/3 packages, no errors
pnpm lint        0 errors, 0 warnings
pnpm format:check clean
pnpm vitest run  614 passed | 1 skipped (615)
```

The skipped test is `reports-load.test.ts`, the photo-heavy measurement — opt-in
via `RUN_LOAD_MEASURE=1` because it generates ~200 MB of test images. Its
output is recorded in `PDF_SPIKE.md` §9.

**Not done in this phase:** the Dockerfile is written but has not been built or
run. It is asserted by review against `PDF_SPIKE.md` §5, not by a green build —
that belongs to Phase 13, and it is listed there.

---

## Phase 11 — Web UI ✅

The Next.js frontend for the Phase 1 MVP, against the existing NestJS API.
**18 routes, 0 dead.** 54 web tests, 614 API tests, all gates green.

### ★ Three route groups do not build

`UI_UX_MAP.md` specified `(teacher)`, `(parent)` and `(admin)`. Next resolves
route groups into the same URL space, and all three audiences need
`/children/[childId]`, `/notifications` and `/settings` — declaring them three
times is a duplicate-route error. Prefixing the parent's routes (`/my/children/…`)
would give one child two URLs, so a link a teacher sends a parent breaks for one
of them.

Resolved to **one authenticated shell with role-derived navigation**. The screens
both audiences reach render the view appropriate to the viewer; the data is
already filtered by the API, so the difference is affordances, never client-side
hiding. It also handles the case the split could not: an administrator whose own
child attends gets one product rather than two.

`UI_UX_MAP.md` §2 has been corrected.

### Two integration defects found — neither visible from the frontend alone

1. **`PUT` was missing from the API's CORS allow-list.** The assessment and
   term-report endpoints are idempotent upserts and use it. Every browser
   preflight would have failed, and the symptom — a generic CORS error — points
   at the wrong layer entirely. Found by reading `main.ts` against the route
   map; verified with a real `OPTIONS` request.
2. **The API never loaded `.env` at boot.** Only the test setup did, so
   `pnpm dev` died on nine missing variables. Fixed with a `dotenv` call placed
   **before every other import** in `main.ts` — several providers call
   `loadEnv()` at module scope, so a later import parses an empty environment.
3. **★ The test suite and a running dev server shared a BullMQ queue.** Found by
   accident: the API suite dropped to 612/614 while `pnpm dev` was up. The tests
   enqueue a report, the dev worker — same Redis, same database — picks it up and
   renders it, while the test _also_ calls `run()` directly. Two PDFs, two
   `MediaFile` rows, and the idempotency test fails with "expected 2 to be 1"
   pointing at code that is correct.

   It presents as flakiness, since it depends on whether anyone happens to have a
   dev server running, which is the worst way for a real invariant to be
   reported. Fixed with a `bull-test` key prefix under `NODE_ENV=test`
   (`queuePrefix`), applied to the reports queue, its worker and the maintenance
   scheduler. Verified by re-running the full suite **with** the dev server up:
   614 pass.

### ★ Contracts verified against the running API, not against my assumptions

The web tests stub `fetch`, so they prove the components work against the shapes
I _wrote down_. That is exactly the gap where a schema drifts from reality and
the failure appears only in a browser.

So `packages/contracts/src/domain.ts` was checked by parsing **live responses**
from the running API for every endpoint the app consumes — 32 schemas, three
roles, including a generated PDF polled to `DONE` and its presigned download.
All 32 parse. Writing them first surfaced two mistakes: `childStatus` is
`ACTIVE | ARCHIVED` (not the four values I assumed), and `/dashboard/primary`
returns `{ dashboard }`, not `{ role, path }`.

The same run asserts the thing that matters most: **a private teaching note
seeded for the teacher is absent from the parent's observation list.**

### Security posture

- **No token touches the browser.** Cookies are HttpOnly and set by the API; the
  login response carries only a user summary. A test asserts `localStorage` and
  `sessionStorage` are empty after a successful sign-in.
- **Role checks are UX only**, and say so at the top of `require-role.tsx`. The
  API re-derives authorization per request; someone bypassing the client gets a
  different menu and the same 404s.
- **A 404 renders as "Олдсонгүй", never as a permissions message.** The API
  refuses to distinguish absent from forbidden; reintroducing the distinction in
  the UI would confirm the record exists. Tested.
- **No bucket URLs.** Every image `src` is the API's `/v1/media/:id`, which
  authorizes and then 302s to a short-lived presigned URL. Deliberately outside
  `next/image`, which would cache the object behind a public `/_next/image` path.
- **The report audience is never client-supplied** — tested that no `audience`
  field is sent.
- **`?from=` is honoured only for same-origin paths**, or the login page becomes
  an open redirect.

### UX decisions worth keeping

- **The parent-visibility checkbox defaults to unchecked**, matching the API. A
  test guards it: shipped pre-checked, every private note would be published by
  default and nobody would notice until one was.
- **One domain at a time.** A test asserts there is exactly one domain selector
  and one radiogroup per child — an assertion about the _absence_ of the
  cancelled nine-domain matrix.
- **Assessment saves the whole column in one request**, with a sticky save bar,
  because on a phone the roster is longer than the viewport.
- **Approve-and-publish is one action.** A teacher who must remember a second
  step will not take it, and families would not see notes they wrote themselves.
- **The two-voices rule is visible**: each side edits its own note and reads the
  other's. Guardianship is decided by _relationship to this child_, not role —
  the same rule the API applies, so they cannot disagree.
- **Loading, empty and error states are components**, not a pattern to copy, so
  a new screen gets all three by construction.

### Responsive and accessibility

`responsive.test.tsx` asserts on class strings and CSS source rather than
geometry — jsdom has no layout engine, so every element is 0×0 and a test of
real pixel heights would pass while asserting nothing.

Verified: every button size ≥ 44px; inputs and selects 48px; all text controls
16px (below it, iOS zooms and does not zoom back, leaving the page scrolled
sideways); `overflow-x: hidden` on `html`; `overflow-wrap: break-word` for long
Mongolian words; a focus ring that is never removed; every field label bound to
its control; errors as `role="alert"` and `aria-describedby`. The served CSS
bundle was checked in the running app for the tokens and both size floors.

### Verified

```
pnpm typecheck    3/3 packages, no errors
pnpm lint         0 errors, 0 warnings
pnpm format:check clean
pnpm --filter @kinder/web test   54 passed
pnpm --filter @kinder/api test   614 passed | 1 skipped
next build        18 routes, compiled successfully
```

Against a running API and a seeded kindergarten: all 15 routes return 200, login
works end to end for teacher/parent/admin, the `PUT` preflight passes, and cookie
attributes are `HttpOnly; SameSite=Lax` with no `Domain`.

**Not done in this phase**, and deliberately: no admin CRUD screens for users,
groups or the configuration tables. Those endpoints exist, but the brief forbids
dead navigation and the MVP scope does not include the editors — so nothing links
to them. Listed for Phase 12 to confirm as an intentional gap rather than an
oversight.

**Next:** Phase 12 — QA and security verification.

---

## Phase 12 — Final QA + security verification ✅

No new features. Security, regression, performance and acceptance QA against a
running system.

**685 tests** (6 contracts · 625 API · 54 web) — three consecutive clean runs,
zero flakes. **151 live HTTP security assertions**, zero failures. Plus 8 new
in-process N+1 guards, and the auth rate-limit tests rewritten to cover both
controls rather than one hardcoded number.

### Nine defects found, all fixed

Three would have been visible to users on day one:

- **`PUT` missing from the CORS allow-list.** Every assessment and term-report
  save is an idempotent upsert over `PUT`. The browser preflight would fail and
  report a generic CORS error, which points at the wrong layer entirely.
- **A per-IP login limit of 10 per 15 minutes.** A kindergarten is one NAT
  address. Eight teachers arriving at 08:00, plus one mistype, and nobody in the
  building can log in. The staff would experience the security control as the
  product being broken. Raised to 60 — brute force is stopped by the
  per-identifier lockout (5 failures → 15 minutes, in the database), which is
  the control actually doing the work.
- **★ The PDF download opened its tab after an `await`.** Off the user gesture,
  so iOS Safari blocks it as a popup: the parent taps "Татаж авах", nothing
  happens, no error explains it. That is the primary parent action failing
  silently on the primary parent device. Now opened synchronously with a blank
  URL, location set when the presigned URL arrives, same-tab fallback.

The rest: `.env` unloaded by the API at boot and by the Prisma CLI; the test
suite sharing a BullMQ queue with a running dev server (a phantom idempotency
failure that presented as flakiness); `X-Powered-By` on both apps; no CSP on the
web app; and `SECURITY.md` §9 documenting rate limits the code did not have.

### ★ A measurement that could report a negative

The first N+1 pass counted statements from _outside_ the process via
`pg_stat_database`. It reported endpoints getting **cheaper** as rows were added
— −53 queries for +24 rows — which is impossible, and revealed the counter was
picking up the report worker and the maintenance scheduler. It also accused the
portfolio endpoint of scaling.

Replaced with `test/query-counts.test.ts`: an instrumented Prisma client, each
endpoint run at two data sizes, asserting on the _growth_ rather than an
absolute. All 8 pass, portfolio included. There is no N+1.

The lesson is worth keeping: a measurement that can produce an impossible value
is not a measurement, and the accusation it made was false.

### What the live probes cover

| Group                                                              | Assertions |
| ------------------------------------------------------------------ | ---------- |
| RBAC — every role against every protected endpoint                 | 12         |
| Tenant isolation — kindergarten A reaching for B                   | 16         |
| IDOR — id substitution, revoked teacher, revoked guardian          | 16         |
| Observation privacy — list, detail, defaults                       | 6          |
| Assessment visibility — unpublished, draft term report, no matrix  | 5          |
| Notifications — targeting, read tracking                           | 4          |
| Media — signing, revocation, content sniffing, bucket privacy      | 14         |
| Reports — job ownership, download authorization                    | 7          |
| Authentication — cookies, lockout, enumeration, session revocation | 22         |
| CORS + CSRF — real preflights, forged origins, mismatched tokens   | 13         |
| Headers and error hygiene                                          | 6          |
| Password reset — full lifecycle including replay and expiry        | 15         |
| PDF — A4, embedded fonts, audience-correct content                 | 15         |
| Pagination + rate limiting                                         | 13         |

Two assertions matter more than the rest, and both pass: **the parent's
generated PDF excludes the private teaching note**, and **the bucket object is
not readable without its signature**.

### Verified, not asserted

- **Migrations** apply from an empty database; 5 partial unique indexes and 71
  foreign keys present; `migrate status` reports up to date.
- **Backup/restore** is a real `pg_dump` → `pg_restore` round trip into a scratch
  database, with row counts, indexes, foreign keys, argon2 hashes and migration
  history all checked afterwards. A restore that "completed" is not a restore
  that worked.
- **argon2** production cost is `m=65536, t=3, p=1`, above the OWASP floor. (A
  hash showing `m=1024` in the database turned out to be a leftover _test_
  fixture from the vitest run that had just truncated it — worth chasing down
  rather than assuming.)
- **Audit log** records LOGIN, LOGIN_FAILED, CREATE and UPDATE with actor and
  child, and is append-only: the only `update`/`delete` references in the
  codebase are docstrings in the generated Prisma client.

### Documents

`PHASE_1_ACCEPTANCE.md` (new) — 14 PASS, 1 partially BLOCKED, 0 FAIL.
`FINAL_DEVICE_QA.md` (new) — what jsdom cannot prove, and the device checklist.
`PRODUCTION_READINESS.md` (new) — blockers, the verified backup procedure, and
the accepted gaps.
`SECURITY.md` §9 — corrected against the implementation.

### Verified

```
pnpm --filter @kinder/contracts test    6 passed
pnpm --filter @kinder/api test        625 passed | 1 skipped
pnpm --filter @kinder/web test         54 passed
                                      ×3 consecutive runs, 0 flakes
live security probes                  151 passed | 0 failed
pnpm typecheck / lint / format:check   clean
```

**Blockers for Phase 13**, none of which can be closed from this environment:
the Docker image has never been built or run, production credentials are not
provisioned, device QA needs a real phone, and password-reset email delivery is
not implemented.

**Next:** Phase 13 — production readiness.

---

## Phase 13 — Production readiness ✅

Runtime and release verification. Two of the four Phase 12 blockers closed; the
other two are provisioning and hardware, not code.

### ★ The Docker image, built for the first time

It had never been built. The first `docker build` found two defects that review
could not have:

1. **`tsconfig.base.json` was never copied into the image.** Both packages
   `extends` it — and a missing `extends` target is **not an error** in
   TypeScript. It silently falls back to compiler defaults, which have
   `esModuleInterop: false`, so the build died inside zod's type declarations
   with fifty `TS1259` errors saying nothing about the cause.
2. **`prisma generate` could not load its config.** It never opens a connection,
   but `prisma.config.ts` resolves the datasource through `env()`, which throws
   when unset. Fixed with a placeholder scoped to the build stage; `ENV` does not
   cross a multi-stage boundary, and the runtime stage was checked to confirm no
   `DATABASE_URL` leaked.

Then the checks that were the whole point:

- The worker boots and reports **"4 Mongolian-capable font(s) registered"**.
- With `/usr/share/fonts` emptied, the container **exits 1 and refuses to
  start**, printing the remediation. The blank-PDF failure mode now has all
  three defences verified rather than two.
- A portfolio PDF was generated **inside the container**: A4, 3 pages, 945
  characters extracted, Mongolian `өүӨҮ` present 13 times, NotoSans embedded and
  subsetted, no serif fallback.
- **121 security probes re-run against the container** — 80 authorization/media/
  report, 41 auth/CORS/CSRF/headers — 0 failures, with
  `CORS_ORIGINS=https://nomadkids.mn`.
- Runs as `uid=1001(app)` under a 1 GB memory limit.

### ★ Password-reset email, implemented and verified

The token was being created correctly and sent nowhere. Now `MailService`
(nodemailer), one message type, verified end to end against a real SMTP server:
request → 204 → message delivered (231 Cyrillic characters, HTML and text
parts) → link → confirm → new password works, old fails, replay rejected,
unknown identifier still 204.

Three decisions recorded in `PRODUCTION_READINESS.md`:

- **The response never varies on delivery** — not on existence, not on SMTP
  being configured, not on the send succeeding. Any of those leaking makes the
  endpoint a user-enumeration oracle.
- **A token is issued even when the account has no email.** Many parents here
  have a phone number and no email; refusing would mean their account can never
  be recovered, not even by an administrator reading the link out. _The targeted
  auth tests caught this_ — an earlier version returned null and broke two of
  them, which was the right answer.
- **Half-configured SMTP is refused at boot in production**, because it looks
  configured and fails only when a parent needs it.

`/health/readiness` now reports SMTP but deliberately does not let it gate the
status: a deployment without mail is workable, and failing readiness for it
would make a working system look broken.

### Also done

- **Backup/restore rehearsed** against container-written data: counts match, 5
  partial indexes, 71 foreign keys.
- **R2 policy decided** and recorded — private, versioning on, 30-day version
  retention, no lifecycle on `children/`, 14 days on `reports/` as a backstop to
  the application sweep. Plus the ordering rule that matters: **restore the
  bucket first, the database second**, because the database decides what is
  supposed to exist.
- `WEB_ORIGIN` added and validated; a plaintext `http://` origin is refused in
  production (which is how the container caught my own test config).

### Verified

```
docker build                    ✅
container boot + font check     ✅
boot assertion without fonts    ✅ exit 1
PDF inside the container        ✅ A4, Cyrillic, embedded fonts
security probes vs container    121 passed | 0 failed
password reset via real SMTP    ✅ full cycle
backup → restore rehearsal      ✅ counts + integrity
targeted auth tests             47 passed
final gate: 690 tests           690 passed | 1 skipped
```

Full suite deliberately **not** re-run per the Phase 13 testing policy; targeted
suites were run for each change (auth tests for the mail change, container smoke
for the Docker change), with one final full verification below.

### Remaining — provisioning and hardware, not code

- Managed Postgres, Redis, an R2 bucket, two signing secrets, DNS and TLS for
  `nomadkids.mn` / `api.nomadkids.mn`
- Device QA per `FINAL_DEVICE_QA.md`

---

## Phase 13 — the split origin, 2026-08-20

### ★ The CSRF token was read from a cookie the web origin cannot see

Found while explaining a `GET /v1/auth/me 401` in the browser console. That
particular 401 was benign — the designed signed-out response — but looking for
it surfaced two defects behind it, neither reachable from localhost.

**The deployment is cross-site.** `nomadkids.vercel.app` against
`nomadkids.up.railway.app` are different registrable domains, and the session
cookies are `SameSite=Lax` — confirmed against the live API by sending
`POST /v1/auth/refresh` with a junk refresh cookie, which makes
`clearAuthCookies` echo the real attribute set:

```
set-cookie: kinder_access=;  Path=/;                HttpOnly; Secure; SameSite=Lax
set-cookie: kinder_refresh=; Path=/v1/auth/refresh; HttpOnly; Secure; SameSite=Lax
set-cookie: kinder_csrf=;    Path=/;                          Secure; SameSite=Lax
```

A `SameSite=Lax` cookie is not sent on a cross-site fetch, so no browser can
hold a session on this host pair. **Fixed by DNS, not by code** — see
`PRODUCTION_READINESS.md` §2.4. Nothing in this repository is wrong about it;
`ARCHITECTURE.md` §2.1 predicted it in writing.

**The second wall, which _was_ code.** `lib/api/browser.ts` read `kinder_csrf`
from `document.cookie`. That cannot work once the API owns its own host:

```
cookies scope by DOMAIN, not by site
  → api.nomadkids.mn issues a host-only cookie   (correct — SECURITY.md §3.1)
  → the browser sends it to api.nomadkids.mn     (correct — same-site)
  → document.cookie on nomadkids.mn cannot read it
  → no X-CSRF-Token header → CsrfGuard → 403 on every save
```

Same-site is not same-host, and this survives the DNS move — it would have
turned the first working login into a product where nothing can be saved.

The token was already in the response body of `/auth/login`, `/auth/refresh` and
`/auth/me`, and already in `sessionSchema`. The API needed no change. The client
now mirrors `data.csrfToken` from the session query into a small in-memory
module that `mutate()` reads.

Mirroring from the query's **data**, not from inside its `queryFn`, is the part
worth keeping: it follows the session however it changes, including a 401. The
login response also writes it, closing the window between a successful login and
the `/auth/me` refetch.

**★ And one assumption in that design was wrong, which the test caught.** The
plan was that the mirror alone would be enough — `useLogout` and `providers.tsx`
both call `queryClient.clear()`, which was expected to drop `data` and take the
token with it. It does not. `clear()` removes the query but **does not reset an
active observer's `data` and does not refetch**, so the effect never re-runs.
Measured, not reasoned about: after a logout the stub recorded
`["GET /auth/me", "POST /auth/logout"]` — no second `/auth/me` — and the token
was still in memory.

The consequence was small (a CSRF token is not a credential, and the server had
already revoked the session) but the shape was not: a departed user's auth state
surviving in memory on a shared kindergarten computer is the exact thing
`useLogout`'s `clear()` exists to prevent. Both clear sites now forget the token
explicitly, and the logout test asserts it against a stub that still answers
`/auth/me` with a live session — so it tests the logout path itself, not a 401
arriving.

Worth stating plainly because the first version of this note claimed the
self-clearing behaviour as a design virtue. It was not true. The test is the
only reason that was found.

**Why neither defect appeared in development.** `localhost:3000` and
`localhost:3001` are the **same cookie domain** — ports are invisible to
cookies. Development is same-site and same-host, so both mechanisms worked
locally and could only fail once deployed.

### ★ A green table that was measuring the wrong thing

`PRODUCTION_READINESS.md` recorded "Browser-shaped login ✅ three cookies set"
and "Authenticated follow-up ✅ `/auth/me` → bagsh". Both were `curl`.

**curl has no cookie policy.** No `SameSite`, no notion of a registrable domain,
and it replays any `Set-Cookie` to any host you next name. Every rule that
actually decides whether a browser keeps and returns a session cookie is
invisible to it. The check could not have failed, whatever the configuration
was.

That section is now split into three labelled groups — verified with curl,
verified in a browser, split-origin cookie behaviour — with the curl evidence
kept and the authenticated browser flow marked **BLOCKED / NOT YET VERIFIED**.

This is the second time in two days that a deployment check passed while the
product was broken in a browser, after the CSP nonce. Same shape both times: the
signal was real, and it was measuring something adjacent to the thing that
mattered.

### Tests

Both halves are covered, because either alone proves nothing:

- `apps/web/test/csrf.test.tsx` — jsdom's empty cookie jar models the split
  origin exactly. Proves the token comes from session state, that a decoy
  `kinder_csrf` on the web origin is ignored, that `document.cookie` is never
  read, that login and logout both carry it, and that it is dropped on logout
  and on a 401. **Three of these fail against the old implementation** —
  checked by restoring it and re-running, not assumed. A fourth (logout)
  failed against the _new_ implementation and is the reason the explicit
  forget exists.
- **Session refresh has no web-client flow to test.** `POST /auth/refresh`
  exists and returns `csrfToken`, but nothing in `apps/web` calls it: an expired
  access cookie surfaces as a 401 and `providers.tsx` redirects to `/login`.
  The server-side contract is covered by the API test below; there is no browser
  path to break, which is worth recording so the absence does not later read as
  an oversight.
- `apps/api/test/csrf-session-token.test.ts` — real app, real database. Proves
  the token in the `/auth/me` **body** is the one `CsrfGuard` accepts, that it
  equals the cookie the browser holds, and that a missing or mismatched header
  is a 403. Every other CSRF test takes the token from `Set-Cookie`, which is
  something only a server-side client can do.

```
apps/web  full suite (7 files)              65 passed
apps/api  test/csrf-session-token.test.ts    7 passed
apps/api  test/auth.test.ts                 47 passed
tsc --noEmit (web, api) · eslint             clean
```

The whole web suite was run rather than a subset because `test/support/render.tsx`
is shared by every web test — `stubApi` now records request headers, which is
what makes asserting on `X-CSRF-Token` possible at all. The API suite was **not**
re-run in full, per the Phase 13 testing policy; no API source changed except a
comment.

★ Note what the API test does and does not prove. The API was already correct,
so `csrf-session-token.test.ts` would have passed before this change too — it is
a **regression lock on an existing contract**, not evidence that the fix works.
Only the web tests that were confirmed to fail against the old client are that.

### Still not verified in a browser

`nomadkids.mn` answers `NOERROR` with no A record; `api.nomadkids.mn` answers
`NXDOMAIN`. The zone is delegated but neither host is published, so the
browser-shaped flow — login, session, a real save, logout — **cannot be
attempted**, and is recorded as blocked rather than passed.

# ESIS sync — three tiers, a stored reference, and a manual pull

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every ESIS read this product makes has a named trigger and leaves an
`EsisSyncRun` or an `AuditLog` row behind — so the month's ministry log reads as
purposeful rather than as a system polling whatever it can reach.

**Architecture:** Reference data is copied into `EsisReference` monthly and read
from there; the staff roster is refreshed daily; per-child data is read only when
somebody opens that child's screen. A BullMQ repeatable job drives the first two,
copying `MaintenanceScheduler`. An ADMIN can run either on demand, through the
same code and the same run record.

**Tech Stack:** NestJS, Prisma, PostgreSQL, BullMQ + Redis, zod v4, vitest +
supertest, Next.js.

**Spec:** `docs/superpowers/specs/2026-09-15-esis-full-coverage-design.md` §6,
amended 2026-09-16 — see §0.

---

## 0. What changed since the spec was written

Three things, all measured against the code on 2026-09-16.

**(a) The spec's tier 1 had nowhere to put anything.** Nothing in this product
persists ESIS reference data — the cook catalogues, programmes, buildings and
rooms are read live, per screen, every time. A "monthly reference sync" with no
store would call the ministry and discard the answer, which is the purposeless
call §1.1 exists to forbid.

**Client decision, 2026-09-16: add the store.** The argument that settles it is
not tidiness: `cook/product` returns **1000 rows**, and a teacher opening the
menu form fetches all of them. Ten teachers is ten thousand rows pulled from the
ministry for data that changes monthly. A monthly copy is _fewer_ calls in their
log, not more, and the screens get faster and keep working when ESIS does not.

**(b) Reference data is not all tenant data.** Measured from `ESIS_READERS`:

| Scope                             | Resources                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **National** (no `institutionId`) | the seven `cook/*` services, `screeningQuestions`                                                         |
| **Institution-scoped**            | `buildings`, `rooms`, `programs`, `subjectAreas`, `academicOrg`, `vaccineCatalog`, `academicYearStatuses` |

So `EsisReference.kindergartenId` is **nullable**, which is a deliberate
exception to CLAUDE.md §3.1 and is argued for in Task 1.

**(c) A scheduled run has no initiator.** `EsisSyncRun.initiatedById` is
non-null with a `Restrict` relation to `User`. Task 1 makes it nullable; NULL
means the schedule ran it, exactly as `AuditLog.actorUserId` already works.

**Out of scope, deliberately:** the seven ESIS **write** services (150, 152,
162, 129, 131, 73, 72). They are spec №3b. Every `POST` lands in the ministry's
real records for a real kindergarten during a trial with no test environment,
and that risk deserves its own plan rather than being the tail of this one.

---

## Background the engineer needs

**What ESIS is.** The Mongolian Ministry of Education's student information
system. This deployment holds a Bearer token scoped to one institution, `42778`,
for a one-month trial the ministry is watching. Responses are wrapped:

```json
{ "SUCCESS_CODE": 200, "RESPONSE_MESSAGE": "…", "RESULT": [ { … } ] }
```

**What already exists and must be reused, not rebuilt:**

- `MaintenanceScheduler` (`apps/api/src/maintenance/maintenance.scheduler.ts`) —
  a BullMQ **repeatable** job, gated on `REPORTS_WORKER_ENABLED`, with the
  reasoning for why it is not `setInterval` written out. **Read it first.** Your
  scheduler is this file with a different cron and a different service call.
- `EsisSyncRun` + `EsisRepository.createRun` / `finishRun` / `findRunning` /
  `expireStaleRuns` — a per-kindergarten run lock with a 15-minute stale
  recovery, already used by `EsisAdminService.preview`.
- `EsisAdminService.refreshStaffRoster` — tier 2's work, built in spec №2. Your
  tier 2 calls it; it does not get rewritten.
- `EsisAdminService.read` — the per-child path, gated by
  `assertCanReadEsisChild` and writing an `AuditLog` `VIEW`. **That is tier 3,
  and it is already done.** Task 6 verifies it and writes it down; it does not
  rebuild it.
- `esisVisibleRows` — credentials destroyed, register numbers gated per caller.

**Rules that bind this work** (`CLAUDE.md`):

- §1.7 — child data returns **404**, never 403.
- §2.1 — controllers parse and call a service; only `*.repository.ts` may import
  `PrismaClient`.
- §3.1 — every tenant-scoped table carries `kindergartenId`. Task 1 takes a
  documented exception; do not take a second.
- §3.3 — **read the generated migration SQL by hand**.
- §3.4 — every list paginated; `include`/`select` deliberate; no N+1.
- §3.5 — **enqueue after commit**, never inside the transaction.
- §5 — user-facing text in **Mongolian**; code and identifiers in English.
- §6 — slow work goes to a queue, never inside a request.

**Commands:**

```bash
pnpm --filter @kinder/api test                 # ~17 min, needs Postgres on :5432
pnpm --filter @kinder/api typecheck && pnpm lint
pnpm --filter contracts build                  # before the web app sees new fields
```

**Never run the api and web suites at the same time** — they starve Postgres and
produce hook timeouts that look exactly like a cross-tenant leak.

**A green api suite is no evidence an ESIS reader works.** `test/setup.ts`
deletes `ESIS_TOKEN`, so every ESIS route under vitest answers from a stub. This
branch has already been bitten twice. After any change touching a schema, a
parser or a reader, run:

```bash
cd apps/api && set -a && . ../../.env && set +a
ESIS_INSTITUTION_ID=42778 pnpm exec tsx scripts/esis-probe.ts
```

---

## File Structure

| File                                                    | Responsibility                                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `apps/api/prisma/schema.prisma`                         | `EsisReference`; `EsisSyncRun.initiatedById` nullable                                        |
| `apps/api/src/integrations/esis/esis.reference.ts`      | Which resources belong to which tier, and their scope. Data, no I/O                          |
| `apps/api/src/integrations/esis/esis.repository.ts`     | `replaceReference`, `findNationalReference`, `findInstitutionReference`, `referenceSyncedAt` |
| `apps/api/src/integrations/esis/esis-sync.service.ts`   | `runReferenceSync`, `runRosterSync`, the run record around both                              |
| `apps/api/src/integrations/esis/esis-sync.scheduler.ts` | Two repeatable BullMQ jobs                                                                   |
| `apps/api/src/integrations/esis/esis.controller.ts`     | `POST …/esis/sync`, `GET …/esis/sync-runs`                                                   |
| `apps/web/app/(app)/platform/[id]/esis/page.tsx`        | The operator's sync panel                                                                    |

---

## Task 1: The reference table, and a run with no initiator

**Files:**

- Modify: `apps/api/prisma/schema.prisma`
- Create: the generated migration

- [ ] **Step 1: Add the model and change the column**

```prisma
/// One row of ESIS reference data, copied so a screen does not have to ask the
/// ministry for it.
///
/// ★ **Why a copy at all.** `cook/product` returns a thousand rows and the
/// menu form fetches every one of them each time a teacher opens it. Ten
/// teachers in a morning is ten thousand rows pulled from the ministry for a
/// catalogue that changes monthly. A monthly copy is fewer calls in their log,
/// not more — and it is the difference between a screen that works when ESIS
/// is down and one that does not.
///
/// ★★ **`kindergartenId` is nullable, and that is a deliberate exception to
/// CLAUDE.md §3.1.** The seven `cook/*` services and `screeningQuestions` take
/// no `institutionId`: they are the ministry's **national** catalogues, the
/// same rows for every kindergarten in the country. Storing a copy per tenant
/// would duplicate a thousand food products per kindergarten to express a fact
/// that is not about any of them.
///
/// The rule §3.1 protects — one filter enforcing isolation — is kept by the
/// repository instead: `findNationalReference` and `findInstitutionReference`
/// are separate methods, so a caller cannot reach another tenant's buildings by
/// forgetting an argument. NULL means national; a value means that
/// kindergarten's, and the unique index below covers both shapes.
///
/// ★★★ Not soft-deleted. A superseded copy of somebody else's catalogue is not
/// a record anyone needs to read back (§3.2's rule is for records that are),
/// and a replace that left the old rows behind would serve a discontinued
/// product as though the ministry still listed it. `EsisSyncRun` records that
/// the refresh happened.
model EsisReference {
  id String @id @default(uuid()) @db.Uuid

  /// NULL for a national catalogue. See the note above.
  kindergartenId String? @db.Uuid

  /// The `ESIS_READERS` key this row came from — `foodProducts`, `rooms`, …
  resource String
  /// The ministry's own identifier within that resource.
  externalId String
  /// The row as ESIS sent it, after `esisVisibleRows` has taken the refusals
  /// out. Stored whole because nothing maps these into domain models: the
  /// screens render the ministry's own field names.
  payload Json

  syncedAt DateTime @default(now())

  kindergarten Kindergarten? @relation(fields: [kindergartenId], references: [id], onDelete: Cascade)

  @@unique([kindergartenId, resource, externalId])
  @@index([resource, syncedAt])
  @@map("esis_reference")
}
```

On `Kindergarten`'s relation block, beside `esisStaffRoster`:

```prisma
  esisReference          EsisReference[]
```

And on `EsisSyncRun`, make the initiator optional:

```prisma
  /// NULL when the schedule ran it rather than a person.
  ///
  /// ★ Nullable since 2026-09-16, when tiers 1 and 2 became repeatable jobs.
  /// The alternative was a fabricated "system" user row, which is worse in the
  /// exact way it looks better: it can be granted a membership, it shows up in
  /// a user list, and an audit trail that names it cannot distinguish the
  /// scheduler from somebody who logged in as it. `AuditLog.actorUserId` is
  /// nullable for the same reason and has been all along.
  initiatedById String? @db.Uuid
```

and change its relation to `initiatedBy User? @relation(...)`.

- [ ] **Step 2: Generate the migration**

```bash
cd /Users/usukhbayar/Desktop/Projects/byatshan-nuudelchid-v2/apps/api
pnpm exec prisma migrate dev --name esis_reference --create-only
```

**`--create-only` is mandatory** — this database has divergent history and a
plain `migrate dev` offers a RESET, destroying a local database seeded with 94
real children. The command is also not interactive-safe in a sandboxed shell; if
it refuses, drive the prompt rather than dropping `--create-only`.

- [ ] **Step 3: Read the SQL by hand** (CLAUDE.md §3.3)

Confirm: `CREATE TABLE "esis_reference"`, the unique index, and
`ALTER TABLE "esis_sync_runs" ALTER COLUMN "initiatedById" DROP NOT NULL`.

**There must be no `DROP TABLE`, no `DROP COLUMN`, and no `SET NOT NULL`.**
Dropping a NOT NULL is safe on existing rows; adding one is not. Paste the full
SQL in your report. If it contains anything data-losing, stop and report.

- [ ] **Step 4: Apply and verify**

```bash
pnpm exec prisma migrate deploy
pnpm exec prisma generate
cd .. && cd .. && pnpm --filter @kinder/api typecheck && pnpm lint
```

`migrate deploy`, never `migrate dev`. Then confirm the existing `preview` flow
still compiles — it passes `actor.userId` into `createRun`, which is still valid
for a nullable column.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat(esis): a place to keep the ministry's reference data, and a run nobody started"
```

Body: why the copy exists (the 1000-row menu fetch), why `kindergartenId` is
nullable and how §3.1's guarantee is kept anyway, and why a nullable initiator
beats a fabricated system user. End with:
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

---

## Task 2: Which resource belongs to which tier

**Files:**

- Create: `apps/api/src/integrations/esis/esis.reference.ts`
- Create: `apps/api/src/integrations/esis/esis.reference.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { ESIS_READABLE_KEYS, ESIS_READERS } from "./esis.service";
import { REFERENCE_RESOURCES, externalIdFor } from "./esis.reference";

/*
 * ★ The list is closed, and the test is what closes it.
 *
 * A resource on this list gets copied monthly whether or not anybody looks at
 * it. That is defensible for a catalogue and indefensible for a child's
 * medical record, so "is this reference data?" must be a decision somebody
 * made rather than a property something acquired.
 */
describe("REFERENCE_RESOURCES", () => {
  it("names only readers that exist", () => {
    for (const entry of REFERENCE_RESOURCES) {
      expect({ key: entry.resource, known: ESIS_READABLE_KEYS.includes(entry.resource) }).toEqual({
        key: entry.resource,
        known: true,
      });
    }
  });

  /*
   * ★★ The scope flag must match the reader, or a national catalogue gets
   * stored once per kindergarten and an institution's rooms get stored as
   * everybody's.
   */
  it("agrees with each reader about whether it is institution-scoped", () => {
    for (const entry of REFERENCE_RESOURCES) {
      const reader = ESIS_READERS[entry.resource] as { institution?: boolean };
      const readerIsScoped = reader.institution !== false;
      expect({ key: entry.resource, scoped: entry.scope === "INSTITUTION" }).toEqual({
        key: entry.resource,
        scoped: readerIsScoped,
      });
    }
  });

  /*
   * ★★★ Nothing per-child is on the list. Named explicitly rather than left to
   * the reviewer's memory: a vaccination history copied monthly for every
   * child is exactly the bulk collection the design forbids.
   */
  it("excludes every per-child service", () => {
    const perChild = REFERENCE_RESOURCES.filter((entry) =>
      ESIS_READERS[entry.resource].endpoint.path.includes(":personId"),
    );
    expect(perChild).toEqual([]);
  });

  it("gives every row a stable external id", () => {
    expect(externalIdFor("foodProducts", { productId: 12, name: "Будаа" })).toBe("12");
    expect(externalIdFor("rooms", { facilityId: "A-1" })).toBe("A-1");
  });

  /* A row with no recognisable id is skipped, not stored under "undefined". */
  it("returns null when it cannot find an id", () => {
    expect(externalIdFor("foodProducts", { name: "no id here" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter @kinder/api exec vitest run src/integrations/esis/esis.reference.test.ts
```

Expected: FAIL to compile — the module does not exist.

- [ ] **Step 3: Write the module**

`REFERENCE_RESOURCES` is an array of `{ resource, scope, idField }`:

| Resource                                                                                                  | Scope         |
| --------------------------------------------------------------------------------------------------------- | ------------- |
| `foodProductTypes`, `foodMaterialGroups`, `foodMaterials`, `foodProducts`, `foodProductMaterials`         | `NATIONAL`    |
| `screeningQuestions`                                                                                      | `NATIONAL`    |
| `buildings`, `rooms`, `programs`, `subjectAreas`, `academicOrg`, `vaccineCatalog`, `academicYearStatuses` | `INSTITUTION` |

**Thirteen resources, and `foodKit` / `foodKitProducts` are deliberately not
among them.** Both carry `params: ["productId"]` — verified 2026-09-16 — so
sweeping them means choosing products to sweep over and issuing one call per
product. That is a per-row fan-out against a thousand-row catalogue, not a
catalogue read, and it would put _more_ traffic in the ministry's log than the
live reads this tier exists to remove. They stay on-demand, triggered by an
operator opening one product. Say that in a `★` comment.

Check every reader's `params` before listing it. A path parameter is the
signal: it means the resource is a lookup, not a catalogue, and the same
exclusion applies.

`externalIdFor(resource, row)` reads the id field named in the table above,
returns it as a string, and returns `null` when the field is absent or empty.
Derive the id field from the reader's own field catalogue where you can rather
than hand-writing fifteen names; if you hand-write them, name the source of each
in a comment — the branch's history is a long argument against invented field
names.

- [ ] **Step 4: Run, typecheck, lint, commit**

```bash
pnpm --filter @kinder/api exec vitest run src/integrations/esis/esis.reference.test.ts
pnpm --filter @kinder/api typecheck && pnpm lint
git add apps/api/src/integrations/esis/esis.reference.ts apps/api/src/integrations/esis/esis.reference.test.ts
git commit -m "feat(esis): the closed list of what gets copied, and what stays on demand"
```

---

## Task 3: Storing a reference sweep

**Files:**

- Modify: `apps/api/src/integrations/esis/esis.repository.ts`
- Modify: `apps/api/src/integrations/esis/esis-sync.service.ts` (new file)
- Test: `apps/api/test/esis-sync.test.ts` (new file)

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/esis-sync.test.ts`, copying the harness from
`test/esis-admin.test.ts` — `createTestApp({ esis })`, `resetData`, the `read`
mock, `RateLimitService.resetAll()`.

Cover, through the route Task 5 adds (write them now, let them fail):

- a national resource is stored once with `kindergartenId` NULL
- an institution resource is stored against the kindergarten
- a second sweep **replaces** rather than accumulating
- a row whose external id cannot be read is skipped and counted
- a refused credential never reaches `payload` — seed the mock with
  `googleEmailPass` and assert it is absent from the stored JSON
- the run record is written, with `initiatedById` NULL for a scheduled call and
  the actor's id for a manual one

- [ ] **Step 2: Confirm they fail**

- [ ] **Step 3: Repository**

```ts
  /**
   * Swaps one resource's stored rows for the sweep that just came back.
   *
   * ★ Scoped by `kindergartenId` **including when it is NULL** — a national
   * catalogue's refresh must not delete an institution's rows for the same
   * resource, and Prisma's `null` in a `where` means `IS NULL`, which is the
   * behaviour wanted here rather than a bug to work around.
   */
  replaceReference(
    kindergartenId: string | null,
    resource: string,
    rows: { externalId: string; payload: Prisma.InputJsonValue }[],
  ) { … }
```

Plus `findNationalReference(resource)` and
`findInstitutionReference(kindergartenId, resource)` as **separate** methods —
the point of the split is that a caller cannot read another tenant's rows by
passing the wrong argument. Both paginated per §3.4.

- [ ] **Step 4: Service**

`EsisSyncService.runReferenceSync({ kindergartenId, actorUserId })`:

1. Take the run lock — `expireStaleRuns`, `findRunning`, `createRun` — exactly as
   `preview` does. A scheduled sweep must not run on top of a manual one.
2. For each entry in `REFERENCE_RESOURCES`, read it, pass the rows through
   `esisVisibleRows(rows, { identifiers: false })`, map through `externalIdFor`,
   skip and count the ones without an id, and `replaceReference`.
3. **One resource failing must not abandon the rest.** Use `Promise.allSettled`
   like `preview` does, and finish the run `PARTIAL` when some succeeded.
4. `finishRun` with a per-resource summary: `{ resource, stored, skipped }`.

`identifiers: false` is deliberate even for national data: a catalogue has no
register numbers, and if one ever appears, this is not the place it should first
be stored.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter @kinder/api exec vitest run test/esis-sync.test.ts
pnpm --filter @kinder/api typecheck && pnpm lint
git commit -m "feat(esis): a reference sweep that replaces, counts and survives one bad resource"
```

---

## Task 4: The daily roster tier

**Files:**

- Modify: `apps/api/src/integrations/esis/esis-sync.service.ts`
- Test: `apps/api/test/esis-sync.test.ts`

- [ ] **Step 1: Write the failing tests**

- the roster sync calls spec №2's refresh and records a run
- `studentMovements` is read with a `beginDate` derived from the **last
  successful run**, not from a fixed window — and falls back to a sensible span
  when there has never been one
- two roster syncs in the same minute: the second is refused by the run lock

- [ ] **Step 2: Confirm they fail**

- [ ] **Step 3: Implement**

`runRosterSync({ kindergartenId, actorUserId })`: the same run-lock preamble,
then `refreshStaffRoster`'s work plus `studentMovements` since the last success.

**`studentMovements` is read, not stored.** There is no table for it and this
plan does not add one; it is read so the run summary can report how many
enrolments moved, which is what tells an operator whether the roster they are
looking at is current. Say that in a `★` comment — a read whose result is
counted and discarded needs its reason written down, or the next person deletes
it as dead code.

Add `EsisRepository.lastSuccessfulRun(kindergartenId, kind)`. That means runs
need a **kind** — add it to the `resources` JSON the run already carries rather
than a new column, and say why in a comment.

- [ ] **Step 4: Verify and commit**

---

## Task 5: The manual pull, and the history behind it

**Files:**

- Modify: `apps/api/src/integrations/esis/esis.controller.ts`, the sync service
- Test: `apps/api/test/esis-sync.test.ts`

- [ ] **Step 1: Write the failing tests**

- `POST /v1/kindergartens/:id/esis/sync` with `{ tier: "REFERENCE" }` — ADMIN gets 200
- the same route — a **teacher** gets 404 and no run is written (§1.7)
- an ADMIN of another kindergarten gets 404
- `GET /v1/kindergartens/:id/esis/sync-runs` — ADMIN, paginated, newest first
- the history shows who started each run, and **"хуваарь"** for a scheduled one
  rather than an empty name

- [ ] **Step 2: Confirm they fail**

- [ ] **Step 3: Implement**

`@Post("sync")` and `@Get("sync-runs")` on the kindergarten-scoped ESIS
controller, `@Roles("ADMIN")`, param shape copied from `catalog` in the same
file (`@Param(new ZodValidationPipe(idParamSchema)) params: { id: string }`).

The manual route calls the **same** service methods the scheduler does, with
`actorUserId` set. That is the whole point: one code path, one run record, and a
history where a manual run and a scheduled one are the same kind of thing with a
different initiator.

- [ ] **Step 4: Verify and commit**

---

## Task 6: Tier 3 is already built — prove it and write it down

No new route. The per-child path exists: `GET …/esis/resource` →
`assertCanReadEsisChild` → `AuditLog` `VIEW`.

- [ ] **Step 1: Prove the trigger discipline holds**

Add to `apps/api/test/esis-admin.test.ts`:

- a per-child read writes exactly one `AuditLog` row naming the actor, the
  child and the resource
- no scheduled or manual sync reaches a per-child resource — assert that
  `REFERENCE_RESOURCES` and the roster tier between them touch **no** reader
  whose path contains `:personId`

The second is the one that matters. It is the executable form of "we never bulk
collect children's medical data", and it is the sentence the ministry's reviewer
will care about most.

- [ ] **Step 2: Run, and commit with the reasoning**

---

## Task 7: The screens read the copy

Tier 1 stores data. If the screens keep reading live, the store is a monthly
call whose result nobody uses — the same defect §0(a) removed, moved one layer
along.

**Files:**

- Modify: `apps/api/src/integrations/esis/esis-admin.service.ts` (the resource read)
- Modify: `apps/web/components/esis/use-esis-food-products.ts` and the catalogue screens
- Test: `apps/api/test/esis-sync.test.ts`, `apps/web/test/`

- [ ] **Step 1: Write the failing test**

- reading a reference resource through `…/esis/resource` serves the **stored**
  rows and does not call ESIS — assert the `read` mock was not called
- when the store is empty, the screen says so in Mongolian and offers the sync,
  rather than silently falling back to a live call

That last point is a decision, not an oversight: a fallback would make the
store's staleness invisible and put the 1000-row fetch back in the ministry's
log at exactly the moments the copy was supposed to prevent it.

- [ ] **Step 2: Implement, verify, commit**

Include the `syncedAt` in the payload so the screen can say when the copy was
made. An operator looking at a catalogue needs to know whether they are seeing
last month's.

---

## Task 8: The scheduler

Last, deliberately: everything it calls is already tested and reachable by hand,
so a scheduling bug cannot hide behind an untested service.

**Files:**

- Create: `apps/api/src/integrations/esis/esis-sync.scheduler.ts`
- Modify: `apps/api/src/integrations/esis/esis.module.ts`

- [ ] **Step 1: Copy the pattern**

Read `apps/api/src/maintenance/maintenance.scheduler.ts` and follow it: one
`IORedis` connection, `queuePrefix(env.NODE_ENV)`, a `Queue` and a `Worker`,
`upsertJobScheduler`, `concurrency: 1`, and the try/catch that keeps a Redis
outage at boot from stopping the API serving requests.

Two repeatable jobs:

| Job                   | Pattern      | What                                      |
| --------------------- | ------------ | ----------------------------------------- |
| `esis-roster-sync`    | `40 3 * * *` | tier 2, every kindergarten with a mapping |
| `esis-reference-sync` | `10 4 1 * *` | tier 1, monthly                           |

Not 03:20 — that is the nightly cleanup's slot, and two heavy jobs at the same
minute on the same instance is a self-inflicted contention problem.

Gate on `REPORTS_WORKER_ENABLED`, the same flag, for the same reason its comment
gives: an instance that does not process background work should not schedule it
either.

- [ ] **Step 2: Decide what "every kindergarten" means, and say so**

The scheduler has no actor, so it cannot use a tenant-scoped repository method.
It needs the list of kindergartens with an `esisInstitutionId`. Add a repository
method for exactly that and no more, and give it a comment saying why it is not
scoped: there is no actor to scope it to, and the alternative — scheduling per
tenant from somewhere that has one — would silently stop syncing a kindergarten
whose admin left.

- [ ] **Step 3: Verify**

The scheduler is hard to test without Redis. Do not fake it. Instead:

- unit-test the **selection** (which kindergartens, which tier) as a pure
  function
- run the full api suite and confirm the scheduler stays inert under
  `REPORTS_WORKER_ENABLED=false`, which `test/setup.ts` already sets
- start the API locally with the flag on and confirm from the log that both jobs
  register, then stop it

Report what you did for the third, including the log lines.

- [ ] **Step 4: Commit**

---

## Task 9: Wire the six remaining read services

Six granted `GET` services are still uncalled. They are not tiers — each is
operator-triggered — but the 84/84 matrix spec №4 produces needs them wired or
explicitly dispositioned.

| API      | Path                                                         | Note                                                                 |
| -------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| 85       | `stdnt/awards/:personId`                                     | per-child; tier 3, gated like its neighbours                         |
| …784     | `student/search/:civilId`                                    | takes a civil id **in the path**                                     |
| 186      | `MOF/ORGANIZATION/BUILDING/{registerNumber}`                 | brace placeholders, `OPEN` tag, different shape from every other row |
| 119      | `zereg/get/request/:registerNum`                             | **different path root** — `/svc/api/zereg/`, not `/svc/api/hub/v2/`  |
| 167, 170 | `degree/request/decisions/:requestId`, `degree/history/v2/…` | no degree module exists in this product                              |

- [ ] **Step 1: Wire 85 and …784**

85 is a per-child read: add it to the catalogue, gate it with
`assertCanReadEsisChild` like every other `:personId` reader, and let tier 3's
test in Task 6 cover it.

…784 takes a civil id in the path. `studentByRegister` is the existing precedent
for sending an identifier the operator already holds — read its doc comment and
follow it, including keeping the typed value out of the audit row.

- [ ] **Step 2: 186 and 119 — decide, with evidence**

Both break an assumption `esisPath` makes. Probe each once against the live
service before wiring, and report what came back. If either needs a different
base URL or a different placeholder syntax, **say so and stop** rather than
bending `esisPath` on a guess — the client builds every other path on one root
and that is worth keeping.

- [ ] **Step 3: 167 and 170 — dispositioned, not wired**

Record them in the request register as granted-but-unused, with the reason: this
product has no teacher-qualification module, so there is no screen for a degree
request's decisions. That is a defensible line in the matrix; a wired service
nothing calls is not.

- [ ] **Step 4: Probe, verify, commit**

Run the live probe and report the tally.

---

## Task 10: The operator's panel, and the live proof

- [ ] **Step 1: The panel**

On `apps/web/app/(app)/platform/[id]/esis/page.tsx`: when each tier last ran,
what it stored, and a **"Татах"** button per tier. The run history below it, with
"хуваарь" where there is no initiator. Mongolian throughout; mobile-first.

Rebuild contracts (`pnpm --filter contracts build`) before the web app reads the
new fields — a stale `dist` silently strips them.

- [ ] **Step 2: Prove it against institution 42778**

With the API running and a real admin session:

1. Run the reference sync. Expect rows stored for each national catalogue —
   `foodProducts` alone should store on the order of 1000.
2. Run the roster sync. Expect 13 staff rows, 0 skipped.
3. Open the menu form and confirm it renders from the store: the `read` path is
   not called, and the screen shows the `syncedAt`.
4. Confirm no per-child service was touched by either sync — check the ESIS
   client log for any path containing a `personId`.

Step 4 is the one to take seriously. It is the claim the whole tier design
exists to support.

- [ ] **Step 3: Record it**

Add a subsection to `docs/ESIS_API_READINESS.md`, in Mongolian, with the counts,
the timings, and the per-child assertion.

- [ ] **Step 4: Commit**

---

## What this plan does not do

- **No ESIS writes.** The seven `POST` services are spec №3b. Every one lands in
  the ministry's real records during a trial with no test environment.
- **No per-child scheduling.** Tier 3 stays on-demand, gated, audited. A nightly
  sweep of children's medical data is the single worst artefact this project
  could file with the ministry.
- **No fallback to a live call when the store is empty.** Task 7 §1.
- **No new tenant-scoped table without `kindergartenId`.** `EsisReference` takes
  one documented exception, for data that is genuinely national.

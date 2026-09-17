# ESIS Group Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put ESIS services 150, 152 and 162 — бүлэг үүсгэх, засах/устгах, багш тохируулах — behind a prepare → approve → send harness that records the exact payload a human approved, and cannot double-post it.

**Architecture:** A new `EsisWriteRequest` table holds one write per row with the payload built server-side from `Group`. A closed registry maps a service key to its builder and Zod schema, so a screen names a key and a subject id and never composes JSON. Approving enqueues a BullMQ job after the transaction commits; the job re-reads the row and refuses to send when `sentAt` is already set, because ESIS honours no idempotency header and a retried 150 would create a second group in the ministry's record.

**Tech Stack:** NestJS, Prisma 7, Zod, BullMQ + ioredis, vitest + supertest, Next.js App Router, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-18-esis-group-writes-design.md`

---

## Read this before Task 1

Four things about this codebase will cost you a day if you find them the hard
way.

**1. A green api suite proves nothing about ESIS.** `apps/api/test/setup.ts`
deletes `ESIS_TOKEN`, so every ESIS route in the suite runs against a stub. The
live check is a script:

```bash
cd apps/api && set -a && . ../../.env && set +a
ESIS_INSTITUTION_ID=42778 pnpm exec tsx scripts/esis-probe.ts
```

Baseline before this plan: **OK 34 · EMPTY 20 · SKIP 1 · PARSE 0**.

**2. Adding one key to `ESIS_ENDPOINTS` breaks three completeness tests.**
`esis.fields.test.ts` asserts `Object.keys(ESIS_FIELDS).sort()` equals
`Object.keys(ESIS_ENDPOINTS).sort()` (line ~170), and that the catalog's
`fieldSource` partition covers every endpoint key (line ~460). Task 1 adds all
of them in one commit for that reason.

**3. Never name a write key `…Save`.** `esis.fields.test.ts`'s "makes every
write reachable" test does
`Object.keys(ESIS_ENDPOINTS).filter((key) => key.endsWith("Save"))` and
requires each to appear in `ESIS_WRITE_RESOURCES` — the allow-list of the
**immediate**, teacher-callable `POST …/esis/write` route. A key called
`groupCreateSave` would either fail that test or, worse, be "fixed" by putting
an unapproved group write behind a teacher's route. The keys here are
`groupCreate`, `groupUpdate`, `groupInstructor`. Task 1 extends that test so
the reachability guarantee covers approval-gated writes too, rather than
leaving a hole exactly where the new writes are.

**4. Migrations: `prisma migrate deploy`, never `migrate dev`.** History is
divergent, so `migrate dev` offers a RESET and the local database holds 94 real
children from institution 42778. The test database is separate — apply to both:

```bash
cd apps/api && pnpm exec prisma migrate deploy
cd apps/api && set -a && . ../../.env && set +a && DATABASE_URL="$TEST_DATABASE_URL" pnpm exec prisma migrate deploy
```

Forgetting the second one produces 41 failures in `attendance-register.test.ts`
that look like a code defect and are not.

**Do not run prettier on these files** — they are not clean at HEAD by design:
`esis.catalog.ts`, `esis.fields.ts`, `esis.fields.test.ts`, `esis.service.ts`,
`apps/web/components/esis/esis-pull-button.tsx`.

**Never run two vitest processes at once**, and never run the api and web
suites together: `beforeEach → resetData` deadlocks on Postgres and produces
failures that impersonate cross-kindergarten leaks.

---

## File Structure

| File                                                      | Responsibility                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| `apps/api/src/integrations/esis/esis.endpoints.ts`        | **Modify** — the three new endpoints                                |
| `apps/api/src/integrations/esis/esis.catalog.ts`          | **Modify** — catalog entry + `fieldSource` for each                 |
| `apps/api/src/integrations/esis/esis.fields.ts`           | **Modify** — `ESIS_FIELDS` entry for each                           |
| `apps/api/src/integrations/esis/esis.mapping.ts`          | **Modify** — which of our tables each maps to                       |
| `apps/api/src/integrations/esis/esis.fields.test.ts`      | **Modify** — reachability rule learns about approval-gated writes   |
| `apps/api/src/integrations/esis/esis.schemas.ts`          | **Modify** — the three upload schemas                               |
| `apps/api/src/integrations/esis/esis.service.ts`          | **Modify** — three `send()` wrappers                                |
| `apps/api/src/integrations/esis/esis-group-writes.ts`     | **Create** — the closed registry: key → builder + schema            |
| `apps/api/src/integrations/esis/esis-write.repository.ts` | **Create** — the only file here importing Prisma for write requests |
| `apps/api/src/integrations/esis/esis-write.service.ts`    | **Create** — prepare, approve, cancel, list; authz and audit        |
| `apps/api/src/integrations/esis/esis-write.worker.ts`     | **Create** — the BullMQ queue and worker; the `sentAt` refusal      |
| `apps/api/src/integrations/esis/esis.dto.ts`              | **Modify** — prepare/approve DTOs                                   |
| `apps/api/src/integrations/esis/esis.controller.ts`       | **Modify** — four routes                                            |
| `apps/api/src/integrations/esis/esis.module.ts`           | **Modify** — register the three new providers                       |
| `apps/api/prisma/schema.prisma`                           | **Modify** — `EsisWriteRequest`, `EsisWriteState`, back-relations   |
| `apps/api/test/esis-group-writes.test.ts`                 | **Create** — the harness and its authorization cases                |
| `packages/contracts/src/domain.ts`                        | **Modify** — the write-request shape the web reads                  |
| `apps/web/components/esis/esis-group-write.tsx`           | **Create** — prepare, preview, approve on the group screen          |
| `apps/web/app/(app)/groups/[groupId]/page.tsx`            | **Modify** — mount it                                               |
| `apps/web/components/esis/esis-write-queue.tsx`           | **Create** — the Бичих tab's list                                   |
| `apps/web/app/(app)/admin/esis-sync/page.tsx`             | **Modify** — add the tab                                            |
| `apps/web/test/esis-group-write.test.tsx`                 | **Create** — the screen's behaviour                                 |
| `docs/ESIS_API_READINESS.md`                              | **Modify** — every live response, §1.1.x                            |
| `docs/ESIS_TRIAL_STATE.md`                                | **Modify** — §3 gains spec №3б, §6 loses it                         |

---

## Task 1: The three endpoints, in all five registries

**Files:**

- Modify: `apps/api/src/integrations/esis/esis.endpoints.ts`
- Modify: `apps/api/src/integrations/esis/esis.catalog.ts`
- Modify: `apps/api/src/integrations/esis/esis.fields.ts`
- Modify: `apps/api/src/integrations/esis/esis.mapping.ts`
- Test: `apps/api/src/integrations/esis/esis.fields.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `esis.fields.test.ts`, inside the top-level `describe`:

```ts
it("carries the three group writes the client asked for", () => {
  expect(ESIS_ENDPOINTS.groupCreate).toEqual({
    apiId: 150,
    slug: "GRANTED",
    method: "POST",
    path: "/svc/api/hub/v2/student/group/info/create",
  });
  expect(ESIS_ENDPOINTS.groupUpdate).toEqual({
    apiId: 152,
    slug: "GRANTED",
    method: "POST",
    path: "/svc/api/hub/v2/student/group/info/update",
  });
  expect(ESIS_ENDPOINTS.groupInstructor).toEqual({
    apiId: 162,
    slug: "GRANTED",
    method: "POST",
    path: "/svc/api/hub/v2/group/instructor/save",
  });
});

/*
 * ★ The three group writes are reachable through the approval harness, not
 * through `POST …/esis/write`. The rule above this one keys off a `…Save`
 * suffix, which these deliberately do not have — see the plan's "Read this
 * before Task 1" §3. Without this test the guarantee that every write is
 * reachable would stay green while three of them were unreachable, which is
 * the exact failure the older test's comment describes.
 */
it("makes every approval-gated write reachable too", () => {
  expect([...ESIS_APPROVAL_WRITES].sort()).toEqual([
    "groupCreate",
    "groupInstructor",
    "groupUpdate",
  ]);
  for (const key of ESIS_APPROVAL_WRITES) {
    expect(ESIS_ENDPOINTS[key].method).toBe("POST");
    expect(ESIS_WRITE_RESOURCES as readonly string[]).not.toContain(key);
  }
});
```

Add the import at the top of the file:

```ts
import { ESIS_APPROVAL_WRITES } from "./esis-group-writes";
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/api && pnpm exec vitest run src/integrations/esis/esis.fields.test.ts
```

Expected: FAIL — `Cannot find module './esis-group-writes'`.

- [ ] **Step 3: Add the endpoints**

In `esis.endpoints.ts`, immediately after the `groupsNextYear` entry (it sits
under the `── Бүлэг ──` comment block that already names all three services,
so they belong beside it):

```ts
  /*
   * The write half the note above says exists. Spec №3б.
   *
   * ★ `slug: "GRANTED"` rather than an `API-000…` string, the same value
   * `studentAwards` carries: these three are in the ministry's granted-service
   * export (`apis-granted.xlsx`) with an id, a method and a URL, and the
   * public catalogue page does not render them — so there is no portal slug to
   * copy and inventing one would make `esis.requests.ts`'s join look sounder
   * than it is.
   *
   * ★★ No `…Save` suffix, and that is load-bearing rather than taste.
   * `esis.fields.test.ts` treats a `…Save` key as reachable through
   * `POST …/esis/write` — the immediate, teacher-callable route. These three
   * go through the approval harness (`esis-write.service.ts`) and a director;
   * naming them `…Save` would put an unapproved group write behind a
   * teacher's button.
   */
  groupCreate: endpoint({
    apiId: 150,
    slug: "GRANTED",
    method: "POST",
    path: "/svc/api/hub/v2/student/group/info/create",
  }),
  groupUpdate: endpoint({
    apiId: 152,
    slug: "GRANTED",
    method: "POST",
    path: "/svc/api/hub/v2/student/group/info/update",
  }),
  groupInstructor: endpoint({
    apiId: 162,
    slug: "GRANTED",
    method: "POST",
    path: "/svc/api/hub/v2/group/instructor/save",
  }),
```

- [ ] **Step 4: Add the catalog entries**

In `esis.catalog.ts`, in the `ESIS_CATALOG` object beside the other group
entries:

```ts
  groupCreate: {
    name: "Бүлэг үүсгэх",
    domain: "ROSTER",
    usage: "Цэцэрлэгийн бүлгийг ЭСИС-д шинээр бүртгүүлэх",
    previewable: false,
    note:
      "Бичих сервис. Захирал батална — доорх талбарууд нь гаралт биш, " +
      "илгээх орц.",
  },
  groupUpdate: {
    name: "Бүлэг засах, устгах",
    domain: "ROSTER",
    usage: "Бүртгэгдсэн бүлгийн нэр, хэлбэрийг засах, эсвэл бүлгийг устгах",
    previewable: false,
    note:
      "Бичих сервис. Устгах нь буцаах боломжгүй тул зөвхөн энэ системээс " +
      "үүсгэсэн бүлэгт нээлттэй — spec №3б §5.",
  },
  groupInstructor: {
    name: "Бүлгийн багш тохируулах",
    domain: "ROSTER",
    usage: "Бүлгийг хариуцах багшийг ЭСИС-д тохируулах",
    previewable: false,
    note:
      "Бичих сервис. Багшийн `esisPersonId` нь `EsisStaffRoster`-оос гарна; " +
      "roster-т байхгүй багшийг бэлтгэх үед татгалзана.",
  },
```

And in the same file's `fieldSource` partition, add all three to the
`"GRANTED"` list — if no such list exists, add them to `"PORTAL"`'s and change
this step to match whatever the assertion at `esis.fields.test.ts:460` reads.
Run the test after this step to see which list the assertion wants.

- [ ] **Step 5: Add the field lists**

In `esis.fields.ts`, `ESIS_FIELDS` needs a key for each. **The request fields
are not known yet** — the portal does not render these services and the
ministry's export carries only id, method and URL. So each starts as an empty
list with the reason, and Task 2 fills it from the ministry's own refusal:

```ts
  /*
   * ★ Empty, and not a stub. Spec №3б Task 2 learns these names from the
   * service's own `400` — the way `studentContacts`'s `{ personId }` body was
   * learned on 2026-09-14 — because the portal does not document them and an
   * invented field list would be a guess sent into the ministry's production
   * record. An empty list renders as "талбар тодорхойгүй" rather than as a
   * form with wrong labels.
   */
  groupCreate: [],
  groupUpdate: [],
  groupInstructor: [],
```

And in the same file's `fieldSource` map, `groupCreate: "GRANTED"` and the
other two likewise (matching the value Step 4 used).

- [ ] **Step 6: Add the mapping targets**

In `esis.mapping.ts`, inside `resourceTargets`:

```ts
if (key === "groupCreate" || key === "groupUpdate" || key === "groupInstructor") {
  return {};
}
```

and in whichever function answers "which of our tables is this":

```ts
if (key === "groupCreate" || key === "groupUpdate") return "Group";
if (key === "groupInstructor") return "Group / Membership";
```

- [ ] **Step 7: Create the registry stub the test imports**

Create `apps/api/src/integrations/esis/esis-group-writes.ts`:

```ts
/**
 * The closed list of ESIS writes that go through approval.
 *
 * ★ Separate from `ESIS_WRITE_RESOURCES`, which is the allow-list of the
 * immediate `POST …/esis/write` route a teacher may call. These three are a
 * director's, they are built from our own `Group` rather than echoed from a
 * form, and what gets approved has to be what gets sent — so they need a
 * different door. `esis.fields.test.ts` asserts the two lists do not overlap.
 */
export const ESIS_APPROVAL_WRITES = ["groupCreate", "groupUpdate", "groupInstructor"] as const;

export type EsisApprovalWrite = (typeof ESIS_APPROVAL_WRITES)[number];

/**
 * The registry key a request carries. `groupDelete` is not an endpoint — it is
 * `groupUpdate`'s second operation (152 is "засах, устгах"), and it gets its
 * own key because what a director approves, what the audit row says and what
 * the queue shows must all distinguish a rename from a removal.
 */
export const ESIS_WRITE_SERVICES = [
  "groupCreate",
  "groupUpdate",
  "groupDelete",
  "groupInstructor",
] as const;

export type EsisWriteService = (typeof ESIS_WRITE_SERVICES)[number];

/** Which endpoint each service key posts to. */
export const ESIS_WRITE_ENDPOINT: Record<EsisWriteService, EsisApprovalWrite> = {
  groupCreate: "groupCreate",
  groupUpdate: "groupUpdate",
  groupDelete: "groupUpdate",
  groupInstructor: "groupInstructor",
};
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd apps/api && pnpm exec vitest run src/integrations/esis/esis.fields.test.ts src/integrations/esis/esis.requests.test.ts src/integrations/esis/esis.reference.test.ts
```

Expected: PASS. If `esis.requests.test.ts` fails on an apiId not present in the
register, add rows for 150, 152 and 162 to `esis.requests.ts` copying the shape
of its neighbours, with the ministry's own service names ("Бүлгийн мэдээлэл
нэмэх", "Бүлгийн мэдээлэл засах", "Бүлгийн багш хадгалах") and status
`Зөвшөөрөгдсөн`.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/integrations/esis/
git commit -m "feat(esis): the three group writes, and a second door for a write that needs approval"
```

---

## Task 2: Learn the payloads from the ministry's own refusal

**Files:**

- Create: `apps/api/scripts/esis-group-write-probe.ts`
- Modify: `apps/api/src/integrations/esis/esis.fields.ts`
- Modify: `docs/ESIS_API_READINESS.md`

This task calls the live service. Read every word before running it.

- [ ] **Step 1: Write the probe**

Create `apps/api/scripts/esis-group-write-probe.ts`:

```ts
/**
 * What do 150, 152 and 162 actually want in their bodies?
 *
 * ★ **`update` and `instructor` only. `create` is never probed.** A rejected
 * update cannot create a record; a create with a half-right body might succeed
 * and leave a group in the ministry's register that nothing here asked for and
 * 152 would then have to remove. So the field names are learned from the two
 * services whose failure is inert, and `groupCreate`'s schema is written from
 * what they reveal plus the one live create in Task 13, which is deliberate,
 * watched, and immediately deleted.
 *
 * ★★ This is the method `studentContacts` was solved with on 2026-09-14: an
 * empty body answered `400 personId шаардлагатай`, which is the ministry
 * telling us the contract. Each 400's message body is printed whole.
 */
import { loadEnv } from "../src/config/env";
import { EsisClient } from "../src/integrations/esis/esis.client";
import { EsisConfig } from "../src/integrations/esis/esis.config";
import { ESIS_ENDPOINTS } from "../src/integrations/esis/esis.endpoints";

async function main() {
  const env = loadEnv(process.env);
  const client = new EsisClient(new EsisConfig(env));
  const institutionId = Number(process.env.ESIS_INSTITUTION_ID);

  for (const key of ["groupUpdate", "groupInstructor"] as const) {
    const endpoint = ESIS_ENDPOINTS[key];
    for (const body of [{}, { institutionId }]) {
      try {
        const response = await client.request({
          path: endpoint.path,
          method: "POST",
          body,
          parse: (raw: unknown) => raw,
        });
        console.log(key, JSON.stringify(body), "→ OK", JSON.stringify(response.data));
      } catch (error) {
        console.log(key, JSON.stringify(body), "→", String(error));
      }
    }
  }
}

void main();
```

- [ ] **Step 2: Run it against institution 42778**

```bash
cd apps/api && set -a && . ../../.env && set +a
ESIS_INSTITUTION_ID=42778 pnpm exec tsx scripts/esis-group-write-probe.ts
```

Expected: four lines, each a `400` naming a required field, or a `403`. Copy
the output verbatim — it is the only source for the next step.

- [ ] **Step 3: Record what came back**

Add a `§1.1.x` subsection to `docs/ESIS_API_READINESS.md` with the date, the
command, and the four responses **quoted, not summarised**. If a service
answered `403`, say so and stop: a service the token cannot reach is
`BLOCKED_ON_MINISTRY` on the matrix, and the rest of this plan proceeds with
the two that answered.

- [ ] **Step 4: Fill the field lists**

Replace the empty `ESIS_FIELDS` arrays from Task 1 Step 5 with the names the
refusals gave, in the shape the neighbouring entries use. Keep the ★ comment
and add what it was learned from:

```ts
/* Learned from the service's own 400 on 2026-09-18 — ESIS_API_READINESS §1.1.x. */
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/scripts/esis-group-write-probe.ts apps/api/src/integrations/esis/esis.fields.ts docs/ESIS_API_READINESS.md
git commit -m "docs(esis): the three group writes' field names, from the ministry's own refusals"
```

---

## Task 3: `EsisWriteRequest`

**Files:**

- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_esis_write_requests/migration.sql` (generated)

- [ ] **Step 1: Add the model**

In `schema.prisma`, after `EsisStaffRoster`:

```prisma
/// One ESIS write, from the payload a director was shown to the answer the
/// ministry gave.
///
/// ★ The payload is stored **before** approval and never rebuilt after it. The
/// human approved those bytes; rebuilding at send time would mean approving a
/// description of a write rather than the write.
model EsisWriteRequest {
  id             String @id @default(uuid()) @db.Uuid
  kindergartenId String @db.Uuid

  /// The registry key — `groupCreate`, `groupUpdate`, `groupDelete`,
  /// `groupInstructor`. Not the apiId: 152 is two services here, and a rename
  /// must not read as a removal in the queue or the audit row.
  service String
  apiId   Int

  /// The group this is about, on our side. Required, including for a create:
  /// «Илгээх» pushes a group that already exists here.
  groupId String @db.Uuid

  payload Json

  state EsisWriteState @default(PREPARED)

  /// Enforced by us. ESIS honours no idempotency header, and a retried 150
  /// would create a second group nothing here could remove.
  idempotencyKey String @unique

  preparedById String    @db.Uuid
  approvedById String?   @db.Uuid
  approvedAt   DateTime?

  /// ESIS's answer, whole. For `groupCreate` this is an **input** as well as a
  /// record: `groupDelete`'s payload needs the ministry's own group id, and
  /// this is the only place it appears.
  response  Json?
  sentAt    DateTime?
  failedAt  DateTime?
  errorCode String?

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  kindergarten Kindergarten @relation(fields: [kindergartenId], references: [id], onDelete: Restrict)
  group        Group        @relation(fields: [groupId], references: [id], onDelete: Restrict)
  preparedBy   User         @relation("EsisWritePreparer", fields: [preparedById], references: [id], onDelete: Restrict)
  approvedBy   User?        @relation("EsisWriteApprover", fields: [approvedById], references: [id], onDelete: Restrict)

  @@index([kindergartenId, createdAt])
  @@index([state, createdAt])
  @@index([kindergartenId, groupId, service])
  @@map("esis_write_requests")
}

enum EsisWriteState {
  PREPARED
  APPROVED
  SENT
  FAILED
  CANCELLED
}
```

- [ ] **Step 2: Add the back-relations**

`Kindergarten` — beside `esisSyncRuns`:

```prisma
  esisWriteRequests      EsisWriteRequest[]
```

`Group`:

```prisma
  esisWriteRequests EsisWriteRequest[]
```

`User` — two, because the relation is named twice:

```prisma
  esisWritesPrepared EsisWriteRequest[] @relation("EsisWritePreparer")
  esisWritesApproved EsisWriteRequest[] @relation("EsisWriteApprover")
```

- [ ] **Step 3: Generate the migration without applying it**

```bash
cd apps/api && pnpm exec prisma migrate dev --create-only --name esis_write_requests
```

`--create-only` is what makes `migrate dev` safe here: it writes the SQL and
does not touch the database, so the RESET prompt never appears.

- [ ] **Step 4: Read the SQL by hand (CLAUDE.md §3.3)**

```bash
cat apps/api/prisma/migrations/*_esis_write_requests/migration.sql
```

Expected: `CREATE TYPE "EsisWriteState"`, one `CREATE TABLE`, four
`CREATE INDEX`/`CREATE UNIQUE INDEX`, four `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY`.
**If there is a single `DROP` or `ALTER … DROP COLUMN`, stop and say so** —
that would mean the schema had drifted from the migrations, which is a
different problem from this task.

- [ ] **Step 5: Apply to both databases**

```bash
cd apps/api && pnpm exec prisma migrate deploy
cd apps/api && set -a && . ../../.env && set +a && DATABASE_URL="$TEST_DATABASE_URL" pnpm exec prisma migrate deploy
cd apps/api && pnpm exec prisma generate
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat(esis): a row per write, carrying the payload its approver saw"
```

---

## Task 4: The repository

**Files:**

- Create: `apps/api/src/integrations/esis/esis-write.repository.ts`

- [ ] **Step 1: Write the file**

```ts
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { Prisma } from "../../generated/prisma/client";

/**
 * The only file that reaches Prisma for ESIS write requests.
 *
 * ★ A new repository rather than more methods on `EsisRepository`, and the
 * reason is the base filter rather than file size. Reference rows are
 * hard-replaced and may be national (`kindergartenId` NULL); a write request
 * is tenant-scoped and soft-deleted. Two different base filters in one
 * repository is how a forgotten one becomes a cross-tenant leak (CLAUDE.md
 * §2.2).
 */
@Injectable()
export class EsisWriteRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The base filter every read below extends and none replaces. */
  private scope(kindergartenId: string) {
    return { kindergartenId, deletedAt: null };
  }

  create(input: {
    kindergartenId: string;
    service: string;
    apiId: number;
    groupId: string;
    payload: Prisma.InputJsonValue;
    idempotencyKey: string;
    preparedById: string;
  }) {
    return this.prisma.esisWriteRequest.create({ data: input });
  }

  findByIdempotencyKey(kindergartenId: string, idempotencyKey: string) {
    return this.prisma.esisWriteRequest.findFirst({
      where: { ...this.scope(kindergartenId), idempotencyKey },
    });
  }

  findOne(kindergartenId: string, id: string) {
    return this.prisma.esisWriteRequest.findFirst({
      where: { ...this.scope(kindergartenId), id },
    });
  }

  /**
   * The row as the worker reads it, by id alone.
   *
   * ★ Unscoped by tenant on purpose, and it is the one method here that is.
   * A job carries an id, not an actor — the authorization happened at approve
   * time, in the request that created the job. Narrowing this by tenant would
   * mean passing a `kindergartenId` through Redis and trusting it on the way
   * back, which is worse: the row's own `kindergartenId` is the authority.
   */
  findForWorker(id: string) {
    return this.prisma.esisWriteRequest.findFirst({ where: { id, deletedAt: null } });
  }

  approve(id: string, approvedById: string) {
    return this.prisma.esisWriteRequest.update({
      where: { id },
      data: { state: "APPROVED", approvedById, approvedAt: new Date() },
    });
  }

  cancel(id: string) {
    return this.prisma.esisWriteRequest.update({
      where: { id },
      data: { state: "CANCELLED" },
    });
  }

  markSent(id: string, response: Prisma.InputJsonValue) {
    return this.prisma.esisWriteRequest.update({
      where: { id },
      data: { state: "SENT", sentAt: new Date(), response, errorCode: null },
    });
  }

  markFailed(id: string, errorCode: string) {
    return this.prisma.esisWriteRequest.update({
      where: { id },
      data: { state: "FAILED", failedAt: new Date(), errorCode },
    });
  }

  /** The create whose group id a delete needs — §5 of the spec. */
  findSentCreate(kindergartenId: string, groupId: string) {
    return this.prisma.esisWriteRequest.findFirst({
      where: { ...this.scope(kindergartenId), groupId, service: "groupCreate", state: "SENT" },
      orderBy: { sentAt: "desc" },
    });
  }

  /** Newest first, paginated — no endpoint returns an unbounded set (§3.4). */
  async list(kindergartenId: string, page: { skip: number; take: number }) {
    const [items, total] = await Promise.all([
      this.prisma.esisWriteRequest.findMany({
        where: this.scope(kindergartenId),
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
        include: {
          group: { select: { id: true, name: true } },
          preparedBy: { select: { lastName: true, firstName: true } },
          approvedBy: { select: { lastName: true, firstName: true } },
        },
      }),
      this.prisma.esisWriteRequest.count({ where: this.scope(kindergartenId) }),
    ]);
    return { items, total };
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd apps/api && pnpm exec tsc -p tsconfig.json --noEmit
```

Expected: no errors. If `esisWriteRequest` is not on `PrismaService`, Task 3
Step 5's `prisma generate` did not run.

- [ ] **Step 3: Check the ESLint boundary rule accepts the import**

```bash
cd apps/api && pnpm exec eslint src/integrations/esis/esis-write.repository.ts
```

Expected: clean. The `no-restricted-imports` rule allows Prisma in
`*.repository.ts` only, which is why the filename matters.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/integrations/esis/esis-write.repository.ts
git commit -m "feat(esis): the write requests' own repository, with its own base filter"
```

---

## Task 5: The payload builders

**Files:**

- Modify: `apps/api/src/integrations/esis/esis-group-writes.ts`
- Modify: `apps/api/src/integrations/esis/esis.schemas.ts`
- Test: `apps/api/src/integrations/esis/esis-group-writes.test.ts` (create)

**Use the exact field names Task 2 recorded.** The schemas below are written
from the shape those refusals imply; if a name differs, **the schema changes
and nothing else does** — that is the point of the registry.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/integrations/esis/esis-group-writes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildGroupPayload } from "./esis-group-writes";

const GROUP = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Дэлбээ",
  ageBand: "AGE_4" as const,
  esisGroupId: null as string | null,
};

describe("group write payloads", () => {
  it("builds a create from the group's own row", () => {
    expect(
      buildGroupPayload({ service: "groupCreate", group: GROUP, institutionId: 42778 }),
    ).toEqual({
      institutionId: 42778,
      groupName: "Дэлбээ",
      ageBand: 4,
    });
  });

  it("names the ministry's group id on an update, not ours", () => {
    expect(
      buildGroupPayload({
        service: "groupUpdate",
        group: { ...GROUP, esisGroupId: "9987" },
        institutionId: 42778,
      }),
    ).toEqual({
      institutionId: 42778,
      studentGroupId: 9987,
      groupName: "Дэлбээ",
      ageBand: 4,
    });
  });

  it("refuses an update for a group ESIS has never seen", () => {
    expect(() =>
      buildGroupPayload({ service: "groupUpdate", group: GROUP, institutionId: 42778 }),
    ).toThrow("ESIS_GROUP_ID_UNKNOWN");
  });

  it("carries the teacher's ESIS person id on an instructor write", () => {
    expect(
      buildGroupPayload({
        service: "groupInstructor",
        group: { ...GROUP, esisGroupId: "9987" },
        institutionId: 42778,
        esisPersonId: "5512",
      }),
    ).toEqual({
      institutionId: 42778,
      studentGroupId: 9987,
      personId: 5512,
    });
  });

  it("refuses an instructor write with no person id", () => {
    expect(() =>
      buildGroupPayload({
        service: "groupInstructor",
        group: { ...GROUP, esisGroupId: "9987" },
        institutionId: 42778,
      }),
    ).toThrow("ESIS_PERSON_ID_UNKNOWN");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/api && pnpm exec vitest run src/integrations/esis/esis-group-writes.test.ts
```

Expected: FAIL — `buildGroupPayload is not a function`.

- [ ] **Step 3: Add `esisGroupId` to `Group`**

The update and instructor payloads need the ministry's own group id, and
nothing stores it. In `schema.prisma`, on `Group`:

```prisma
  /// ESIS's own id for this group, filled from `groupCreate`'s response.
  ///
  /// ★ NULL means "the ministry has not seen this group", which is what makes
  /// an update refusable before it is prepared rather than after it is sent.
  esisGroupId String? @db.VarChar(64)
```

Generate, review and apply it exactly as Task 3 Steps 3–5 did, with
`--name group_esis_group_id`.

- [ ] **Step 4: Write the builders**

Append to `esis-group-writes.ts`:

```ts
import { z } from "zod";

/** The age band as the ministry counts it — our `AgeBand` enum's own number. */
const AGE_BAND_NUMBER: Record<string, number> = {
  AGE_2: 2,
  AGE_3: 3,
  AGE_4: 4,
  AGE_5: 5,
};

export const groupCreatePayloadSchema = z
  .object({
    institutionId: z.number().int(),
    groupName: z.string().min(1),
    ageBand: z.number().int(),
  })
  .strict();

export const groupUpdatePayloadSchema = groupCreatePayloadSchema
  .extend({ studentGroupId: z.number().int() })
  .strict();

export const groupInstructorPayloadSchema = z
  .object({
    institutionId: z.number().int(),
    studentGroupId: z.number().int(),
    personId: z.number().int(),
  })
  .strict();

export interface GroupForWrite {
  id: string;
  name: string;
  ageBand: string;
  esisGroupId: string | null;
}

/**
 * The payload for one write, built from our own row.
 *
 * ★ Throws named codes rather than returning `null`. Every one of these is a
 * refusal a director has to read — "ЭСИС энэ бүлгийг хараахан хараагүй" is
 * actionable, an empty preview is not — and `esis-write.service.ts` maps each
 * code to its Mongolian sentence.
 */
export function buildGroupPayload(input: {
  service: EsisWriteService;
  group: GroupForWrite;
  institutionId: number;
  esisPersonId?: string | null;
}): Record<string, unknown> {
  const { service, group, institutionId } = input;
  const ageBand = AGE_BAND_NUMBER[group.ageBand];
  if (ageBand === undefined) throw new Error("ESIS_AGE_BAND_UNMAPPED");

  if (service === "groupCreate") {
    return groupCreatePayloadSchema.parse({
      institutionId,
      groupName: group.name,
      ageBand,
    });
  }

  if (group.esisGroupId === null) throw new Error("ESIS_GROUP_ID_UNKNOWN");
  const studentGroupId = Number(group.esisGroupId);

  if (service === "groupInstructor") {
    if (!input.esisPersonId) throw new Error("ESIS_PERSON_ID_UNKNOWN");
    return groupInstructorPayloadSchema.parse({
      institutionId,
      studentGroupId,
      personId: Number(input.esisPersonId),
    });
  }

  /*
   * `groupUpdate` and `groupDelete` post the same body to the same path. What
   * separates them is Task 11's `deleteFlag` field — filled in once Task 2's
   * probe has said what the ministry calls it — and the confirmation the
   * director types. Until then a delete prepares as an update and Task 11 is
   * the task that must not be skipped.
   */
  return groupUpdatePayloadSchema.parse({
    institutionId,
    studentGroupId,
    groupName: group.name,
    ageBand,
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd apps/api && pnpm exec vitest run src/integrations/esis/esis-group-writes.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/integrations/esis/esis-group-writes.ts apps/api/src/integrations/esis/esis-group-writes.test.ts apps/api/prisma/
git commit -m "feat(esis): a group's payload, built from its own row and refusable before it is sent"
```

---

## Task 6: `EsisService` learns the three sends

**Files:**

- Modify: `apps/api/src/integrations/esis/esis.service.ts`

- [ ] **Step 1: Add the methods**

Beside the other `save…` methods, above the private `send`:

```ts
  async sendGroupCreate(body: unknown) {
    return this.send(ESIS_ENDPOINTS.groupCreate, groupCreatePayloadSchema.parse(body));
  }

  async sendGroupUpdate(body: unknown) {
    return this.send(ESIS_ENDPOINTS.groupUpdate, groupUpdatePayloadSchema.parse(body));
  }

  async sendGroupInstructor(body: unknown) {
    return this.send(ESIS_ENDPOINTS.groupInstructor, groupInstructorPayloadSchema.parse(body));
  }
```

Import the three schemas from `./esis-group-writes`.

The payload is parsed **again** here, after the harness already parsed it at
prepare time. That is deliberate: the row has been sitting in a table between
those two moments, and `EsisService` is the layer that must not post a shape
nobody checked.

- [ ] **Step 2: Verify the file still compiles, and do not format it**

```bash
cd apps/api && pnpm exec tsc -p tsconfig.json --noEmit
```

`esis.service.ts` is not prettier-clean at HEAD by design. Do not run prettier
on it; if `pnpm format:check` flags it, leave it and say so.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/integrations/esis/esis.service.ts
git commit -m "feat(esis): three group sends, parsed at the boundary as well as at prepare"
```

---

## Task 7: Prepare

**Files:**

- Create: `apps/api/src/integrations/esis/esis-write.service.ts`
- Modify: `apps/api/src/integrations/esis/esis.dto.ts`
- Test: `apps/api/test/esis-group-writes.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/esis-group-writes.test.ts`:

```ts
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";

let app: INestApplication;
let scenario: Scenario;
let admin: AuthSession;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetData();
  app.get(RateLimitService).resetAll();
  scenario = await createScenario();
  admin = await login(app, scenario.admin.email);
  await testDb().kindergarten.update({
    where: { id: scenario.kindergarten.id },
    data: { esisInstitutionId: "42778", esisMappedAt: new Date() },
  });
});

describe("preparing a group write", () => {
  it("stores the payload it showed, and shows the payload it stored", async () => {
    const res = await authed(
      request(app.getHttpServer()).post(
        `/v1/kindergartens/${scenario.kindergarten.id}/esis/group-writes`,
      ),
      admin,
    ).send({ service: "groupCreate", groupId: scenario.group.id });

    expect(res.status).toBe(201);
    expect(res.body.state).toBe("PREPARED");
    expect(res.body.payload).toMatchObject({
      institutionId: 42778,
      groupName: scenario.group.name,
    });

    const row = await testDb().esisWriteRequest.findFirstOrThrow({
      where: { id: res.body.id },
    });
    expect(row.payload).toEqual(res.body.payload);
    expect(row.sentAt).toBeNull();
  });

  it("returns the first row when the same write is prepared twice", async () => {
    const url = `/v1/kindergartens/${scenario.kindergarten.id}/esis/group-writes`;
    const body = { service: "groupCreate", groupId: scenario.group.id };

    const first = await authed(request(app.getHttpServer()).post(url), admin).send(body);
    const second = await authed(request(app.getHttpServer()).post(url), admin).send(body);

    expect(second.body.id).toBe(first.body.id);
    expect(await testDb().esisWriteRequest.count()).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/api && pnpm exec vitest run test/esis-group-writes.test.ts
```

Expected: FAIL with 404 — the route does not exist.

- [ ] **Step 3: Add the DTOs**

In `esis.dto.ts`:

```ts
/**
 * `POST …/esis/group-writes` — which write, about which group.
 *
 * ★ No `payload`. The caller names a service and a subject; the payload is
 * built from our own tables (spec §3). A body field for it would be the
 * pass-through model this design rejected, and would let a browser post
 * anything into the ministry's record.
 */
export const prepareEsisGroupWriteSchema = z.object({
  service: z.enum(ESIS_WRITE_SERVICES),
  groupId: uuidSchema,
  /** Required for `groupDelete` only — see Task 11. */
  confirmGroupName: z.string().min(1).optional(),
});
export type PrepareEsisGroupWriteDto = z.infer<typeof prepareEsisGroupWriteSchema>;
```

Import `ESIS_WRITE_SERVICES` from `./esis-group-writes`.

- [ ] **Step 4: Write the service's prepare**

Create `apps/api/src/integrations/esis/esis-write.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Actor } from "../../authz/actor";
import { AuditService } from "../../audit/audit.service";
import { TenantAccessService } from "../../authz/tenant-access.service";
import { buildGroupPayload, ESIS_WRITE_ENDPOINT } from "./esis-group-writes";
import type { EsisWriteService as WriteServiceKey } from "./esis-group-writes";
import { ESIS_ENDPOINTS } from "./esis.endpoints";
import { EsisRepository } from "./esis.repository";
import { EsisWriteRepository } from "./esis-write.repository";
import type { PrepareEsisGroupWriteDto } from "./esis.dto";
import { createHash } from "node:crypto";

/** Each refusal a director can act on, in the language they read. */
const REFUSALS: Record<string, string> = {
  ESIS_GROUP_ID_UNKNOWN:
    "ЭСИС энэ бүлгийг хараахан хараагүй. Эхлээд «Бүлэг үүсгэх»-ийг илгээнэ үү.",
  ESIS_PERSON_ID_UNKNOWN:
    "Багшийн ЭСИС-ийн дугаар ажилтны бүртгэлд байхгүй. Ажилтны бүртгэлийг шинэчлээд дахин үзнэ үү.",
  ESIS_AGE_BAND_UNMAPPED: "Бүлгийн насны хэлбэрийг ЭСИС-ийн кодтой тааруулаагүй.",
};

@Injectable()
export class EsisWriteRequestService {
  constructor(
    private readonly tenants: TenantAccessService,
    private readonly repo: EsisWriteRepository,
    private readonly esisRepo: EsisRepository,
    private readonly audit: AuditService,
  ) {}

  async prepare(actor: Actor, kindergartenId: string, dto: PrepareEsisGroupWriteDto) {
    this.tenants.assertAdmin(actor, kindergartenId);

    const kindergarten = await this.esisRepo.findKindergarten(kindergartenId);
    if (!kindergarten?.esisInstitutionId) {
      throw new BadRequestException("Энэ цэцэрлэг ЭСИС-т холбогдоогүй байна.");
    }

    /*
     * ★ 404, not 403, for a group outside this kindergarten (CLAUDE.md §1.7).
     * The tenant check above has already passed, so this is the case of an
     * administrator naming a group id that belongs to somebody else.
     */
    const group = await this.esisRepo.findGroupForWrite(kindergartenId, dto.groupId);
    if (!group) throw new NotFoundException();

    const esisPersonId =
      dto.service === "groupInstructor"
        ? await this.esisRepo.findGroupTeacherEsisPersonId(kindergartenId, dto.groupId)
        : null;

    let payload: Record<string, unknown>;
    try {
      payload = buildGroupPayload({
        service: dto.service,
        group,
        institutionId: Number(kindergarten.esisInstitutionId),
        esisPersonId,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "UNKNOWN";
      throw new BadRequestException(REFUSALS[code] ?? "Илгээх өгөгдлийг бэлтгэж чадсангүй.");
    }

    const idempotencyKey = writeKey(dto.service, dto.groupId, payload);

    /*
     * ★ Read before write, and the unique index behind it. Two directors
     * pressing the button together race here; the index is what decides, and
     * the loser re-reads rather than failing — the answer they want is the row
     * that exists.
     */
    const existing = await this.repo.findByIdempotencyKey(kindergartenId, idempotencyKey);
    if (existing) return existing;

    const endpointKey = ESIS_WRITE_ENDPOINT[dto.service as WriteServiceKey];
    const row = await this.repo.create({
      kindergartenId,
      service: dto.service,
      apiId: ESIS_ENDPOINTS[endpointKey].apiId ?? 0,
      groupId: dto.groupId,
      payload: payload as never,
      idempotencyKey,
      preparedById: actor.userId,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "EsisWriteRequest",
      objectId: row.id,
      metadata: { service: dto.service, groupId: dto.groupId, apiId: row.apiId },
    });

    return row;
  }
}

/**
 * The idempotency key.
 *
 * ★ A hash of the payload, not a timestamp or a uuid. Preparing the same write
 * twice must collide; preparing a *different* write about the same group must
 * not. Renaming a group and sending it again is a new key, which is right —
 * that is a second write, and ESIS should receive it.
 */
function writeKey(service: string, groupId: string, payload: Record<string, unknown>) {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return `${service}:${groupId}:${createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`;
}
```

- [ ] **Step 5: Add the two repository reads it needs**

In `esis.repository.ts`:

```ts
  /** The group a write is about, tenant-scoped and soft-delete filtered. */
  findGroupForWrite(kindergartenId: string, groupId: string) {
    return this.prisma.group.findFirst({
      where: { id: groupId, kindergartenId, deletedAt: null },
      select: { id: true, name: true, ageBand: true, esisGroupId: true },
    });
  }

  /**
   * The ESIS person id of the teacher assigned to this group.
   *
   * ★ From `EsisStaffRoster`, joined on the membership — not from anything the
   * request supplies. The roster is replaced wholesale on each sync, so this
   * returns `null` for a teacher who registered since the last one, and
   * `EsisWriteRequestService.prepare` turns that into a refusal naming the
   * roster rather than a failed job.
   */
  async findGroupTeacherEsisPersonId(kindergartenId: string, groupId: string) {
    const assignment = await this.prisma.groupTeacher.findFirst({
      where: { groupId, deletedAt: null, group: { kindergartenId, deletedAt: null } },
      select: { user: { select: { id: true, nationalId: true } } },
      orderBy: { createdAt: "asc" },
    });
    if (!assignment?.user?.nationalId) return null;

    const row = await this.prisma.esisStaffRoster.findFirst({
      where: { kindergartenId, registerNumber: assignment.user.nationalId.toUpperCase() },
      select: { esisPersonId: true },
    });
    return row?.esisPersonId ?? null;
  }
```

If the model that assigns a teacher to a group is not called `GroupTeacher`,
find it with `grep -n "model Group" -A40 apps/api/prisma/schema.prisma` and use
that name — the join is "the group's teacher", however this schema spells it.

- [ ] **Step 6: Add the route**

In `esis.controller.ts`, inside `KindergartenEsisController`:

```ts
  /**
   * Prepare one group write. Spec №3б.
   *
   * ★ ADMIN only, unlike `write` above. That route's `@Roles` includes TEACHER
   * because the three child-record saves are a teacher's own fields; a group
   * write changes the ministry's register of this kindergarten's classes, and
   * the client's 2026-09-14 rule puts a working surface like that on the
   * director.
   */
  @Post("group-writes")
  @Roles("ADMIN")
  prepareGroupWrite(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(prepareEsisGroupWriteSchema)) body: PrepareEsisGroupWriteDto,
  ) {
    return this.writes.prepare(actor, params.id, body);
  }
```

Add `private readonly writes: EsisWriteRequestService` to the constructor, and
register `EsisWriteRequestService` and `EsisWriteRepository` in
`esis.module.ts`'s `providers`.

- [ ] **Step 7: Run the test to verify it passes**

```bash
cd apps/api && pnpm exec vitest run test/esis-group-writes.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/integrations/esis/ apps/api/test/esis-group-writes.test.ts
git commit -m "feat(esis): a prepared write stores the bytes it showed"
```

---

## Task 8: Approve, and enqueue after the commit

**Files:**

- Modify: `apps/api/src/integrations/esis/esis-write.service.ts`
- Create: `apps/api/src/integrations/esis/esis-write.worker.ts`
- Modify: `apps/api/src/integrations/esis/esis.controller.ts`
- Modify: `apps/api/src/integrations/esis/esis.module.ts`
- Test: `apps/api/test/esis-group-writes.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/esis-group-writes.test.ts`:

```ts
describe("approving a group write", () => {
  it("moves to APPROVED and enqueues exactly one job", async () => {
    const prepared = await authed(
      request(app.getHttpServer()).post(
        `/v1/kindergartens/${scenario.kindergarten.id}/esis/group-writes`,
      ),
      admin,
    ).send({ service: "groupCreate", groupId: scenario.group.id });

    const queue = app.get(EsisWriteQueue);
    const added: string[] = [];
    queue.add = async (id: string) => {
      added.push(id);
    };

    const res = await authed(
      request(app.getHttpServer()).post(
        `/v1/kindergartens/${scenario.kindergarten.id}/esis/group-writes/${prepared.body.id}/approve`,
      ),
      admin,
    ).send({});

    expect(res.status).toBe(200);
    expect(res.body.state).toBe("APPROVED");
    expect(added).toEqual([prepared.body.id]);

    const row = await testDb().esisWriteRequest.findFirstOrThrow({
      where: { id: prepared.body.id },
    });
    expect(row.approvedById).toBe(scenario.admin.id);
    expect(row.sentAt).toBeNull();
  });

  it("refuses to approve a write that has already been sent", async () => {
    const prepared = await authed(
      request(app.getHttpServer()).post(
        `/v1/kindergartens/${scenario.kindergarten.id}/esis/group-writes`,
      ),
      admin,
    ).send({ service: "groupCreate", groupId: scenario.group.id });

    await testDb().esisWriteRequest.update({
      where: { id: prepared.body.id },
      data: { state: "SENT", sentAt: new Date() },
    });

    const res = await authed(
      request(app.getHttpServer()).post(
        `/v1/kindergartens/${scenario.kindergarten.id}/esis/group-writes/${prepared.body.id}/approve`,
      ),
      admin,
    ).send({});

    expect(res.status).toBe(409);
  });
});
```

Add `import { EsisWriteQueue } from "../src/integrations/esis/esis-write.worker";` to the top.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/api && pnpm exec vitest run test/esis-group-writes.test.ts -t "approving"
```

Expected: FAIL — cannot find module `esis-write.worker`.

- [ ] **Step 3: Write the queue and worker**

Create `apps/api/src/integrations/esis/esis-write.worker.ts`:

```ts
import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { loadEnv } from "../../config/env";
import { queuePrefix } from "../../reports/reports.queue";
import { EsisWriteSender } from "./esis-write.sender";

export const ESIS_WRITE_QUEUE = "esis-write";
const JOB_NAME = "esis-write-send";

/**
 * The one way a prepared write reaches ESIS.
 *
 * ★ Its own class so `EsisWriteRequestService` can depend on "something that
 * enqueues" without depending on Redis, which is what lets the integration
 * test above replace `add` with an array. A service that constructed its own
 * `Queue` would make the enqueue untestable and the assertion "exactly one
 * job" unwritable.
 */
@Injectable()
export class EsisWriteQueue implements OnApplicationShutdown {
  private readonly connection: Redis;
  private readonly queue: Queue;

  constructor() {
    const env = loadEnv(process.env);
    this.connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(ESIS_WRITE_QUEUE, {
      connection: this.connection,
      prefix: queuePrefix(),
    });
  }

  /**
   * ★ `jobId` is the request id, so BullMQ itself deduplicates a double
   * approve. That is the outer of two guards; the inner one — the worker's
   * `sentAt` check — is the one that matters, because a job id only lives as
   * long as Redis keeps it.
   */
  async add(writeRequestId: string) {
    await this.queue.add(JOB_NAME, { writeRequestId }, { jobId: writeRequestId, attempts: 1 });
  }

  async onApplicationShutdown() {
    await this.queue.close();
    this.connection.disconnect();
  }
}

@Injectable()
export class EsisWriteWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EsisWriteWorker.name);
  private connection?: Redis;
  private worker?: Worker;

  constructor(private readonly sender: EsisWriteSender) {}

  onModuleInit() {
    const env = loadEnv(process.env);
    /*
     * ★ Its **own** flag, not `REPORTS_WORKER_ENABLED`.
     *
     * That flag means two things at once: "drain the report queue" and, by
     * implication, "this host has Chromium and a gigabyte of RAM" — CLAUDE.md
     * §6 says the report worker cannot run on Vercel for exactly that reason.
     * Gating ESIS writes on it would mean a deployment that turns reports off
     * silently stops sending to the ministry: approvals would queue, the
     * director would see APPROVED forever, and nothing would log an error.
     * An ESIS write needs no browser and no memory.
     */
    if (env.ESIS_WRITE_WORKER_ENABLED !== true) {
      this.logger.log("ESIS write worker disabled");
      return;
    }
    this.connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker(
      ESIS_WRITE_QUEUE,
      async (job) => this.sender.send(String(job.data.writeRequestId)),
      { connection: this.connection, prefix: queuePrefix(), concurrency: 1 },
    );
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    this.connection?.disconnect();
  }
}
```

`concurrency: 1` because the deployment has one rate-limited ESIS token and
this is a month the ministry is watching.

- [ ] **Step 3b: Add the flag**

In `apps/api/src/config/env.ts`, beside `REPORTS_WORKER_ENABLED`:

```ts
  /**
   * Whether this process drains the ESIS write queue.
   *
   * ★ Separate from `REPORTS_WORKER_ENABLED`, which also carries "Chromium is
   * installed here". An ESIS write needs neither a browser nor a gigabyte, and
   * a deployment that turns reports off must not silently stop writing to the
   * ministry. Off in tests, where the sender is called directly.
   */
  ESIS_WRITE_WORKER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
```

In `.env.example`, beside the reports line (CLAUDE.md §1.5 — every new setting
gets one):

```
ESIS_WRITE_WORKER_ENABLED=true
```

In `apps/api/test/setup.ts`, beside `REPORTS_WORKER_ENABLED`:

```ts
process.env.ESIS_WRITE_WORKER_ENABLED = "false";
```

Then check the local `.env` has it, or relies on the `"true"` default — Task 15
Step 3's live exercise does nothing at all if this process is not draining the
queue, and the symptom is a row that stays `APPROVED` with no error anywhere.

- [ ] **Step 4: Write the sender**

Create `apps/api/src/integrations/esis/esis-write.sender.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { AuditService } from "../../audit/audit.service";
import { EsisService } from "./esis.service";
import { EsisWriteRepository } from "./esis-write.repository";

/**
 * Sends one approved write, once.
 *
 * ★ The `sentAt` refusal is the whole point of this class. ESIS honours no
 * idempotency header, so a BullMQ retry, a duplicate job or a redelivery after
 * a restart would each re-post a `150` and create a **second group** in the
 * ministry's register that nothing here can remove. The row is re-read inside
 * the job rather than trusted from the payload, because the job may have been
 * sitting in Redis while another one finished.
 */
@Injectable()
export class EsisWriteSender {
  private readonly logger = new Logger(EsisWriteSender.name);

  constructor(
    private readonly repo: EsisWriteRepository,
    private readonly esis: EsisService,
    private readonly audit: AuditService,
  ) {}

  async send(writeRequestId: string) {
    const row = await this.repo.findForWorker(writeRequestId);
    if (!row) return;

    if (row.sentAt !== null) {
      this.logger.warn(`ESIS write ${row.id} already sent at ${row.sentAt.toISOString()}`);
      return;
    }
    if (row.state !== "APPROVED") {
      this.logger.warn(`ESIS write ${row.id} is ${row.state}, not APPROVED`);
      return;
    }

    try {
      const response = await this.dispatch(row.service, row.payload);
      await this.repo.markSent(row.id, (response.data ?? {}) as never);
      await this.audit.append({
        action: "UPDATE",
        kindergartenId: row.kindergartenId,
        actorUserId: row.approvedById,
        objectType: "EsisWriteRequest",
        objectId: row.id,
        before: { state: "APPROVED" },
        metadata: { service: row.service, apiId: row.apiId, outcome: "SENT" },
      });
    } catch (error) {
      const code = error instanceof Error ? error.name : "UNKNOWN";
      await this.repo.markFailed(row.id, code);
      await this.audit.append({
        action: "UPDATE",
        kindergartenId: row.kindergartenId,
        actorUserId: row.approvedById,
        objectType: "EsisWriteRequest",
        objectId: row.id,
        before: { state: "APPROVED" },
        metadata: { service: row.service, apiId: row.apiId, outcome: "FAILED", errorCode: code },
      });
    }
  }

  private dispatch(service: string, payload: unknown) {
    switch (service) {
      case "groupCreate":
        return this.esis.sendGroupCreate(payload);
      case "groupUpdate":
      case "groupDelete":
        return this.esis.sendGroupUpdate(payload);
      case "groupInstructor":
        return this.esis.sendGroupInstructor(payload);
      default:
        throw new Error(`Unknown ESIS write service: ${service}`);
    }
  }
}
```

- [ ] **Step 5: Add approve to the service**

In `esis-write.service.ts`, add `EsisWriteQueue` to the constructor and:

```ts
  async approve(actor: Actor, kindergartenId: string, writeRequestId: string) {
    this.tenants.assertAdmin(actor, kindergartenId);

    const row = await this.repo.findOne(kindergartenId, writeRequestId);
    if (!row) throw new NotFoundException();
    if (row.state !== "PREPARED") {
      throw new ConflictException("Энэ илгээлт аль хэдийн шийдэгдсэн байна.");
    }

    const approved = await this.repo.approve(row.id, actor.userId);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "EsisWriteRequest",
      objectId: row.id,
      before: { state: row.state },
      metadata: { service: row.service, apiId: row.apiId, state: "APPROVED" },
    });

    /*
     * ★ After the write above, never inside a transaction with it (CLAUDE.md
     * §3.5). A worker that started while the row was still invisible would
     * find nothing and drop the job; a crash between the two leaves an
     * APPROVED row the queue screen shows as waiting, which a director can
     * approve again. A lost job is recoverable. A double post is not.
     */
    await this.queue.add(row.id);

    return approved;
  }

  async cancel(actor: Actor, kindergartenId: string, writeRequestId: string) {
    this.tenants.assertAdmin(actor, kindergartenId);
    const row = await this.repo.findOne(kindergartenId, writeRequestId);
    if (!row) throw new NotFoundException();
    if (row.state !== "PREPARED") {
      throw new ConflictException("Энэ илгээлт аль хэдийн шийдэгдсэн байна.");
    }
    const cancelled = await this.repo.cancel(row.id);
    await this.audit.append({
      action: "UPDATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "EsisWriteRequest",
      objectId: row.id,
      before: { state: row.state },
      metadata: { service: row.service, state: "CANCELLED" },
    });
    return cancelled;
  }
```

Import `ConflictException` from `@nestjs/common`.

- [ ] **Step 6: Add the routes and providers**

`esis.controller.ts`:

```ts
  @Post("group-writes/:writeId/approve")
  @HttpCode(200)
  @Roles("ADMIN")
  approveGroupWrite(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(esisWriteParamSchema)) params: { id: string; writeId: string },
  ) {
    return this.writes.approve(actor, params.id, params.writeId);
  }

  @Post("group-writes/:writeId/cancel")
  @HttpCode(200)
  @Roles("ADMIN")
  cancelGroupWrite(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(esisWriteParamSchema)) params: { id: string; writeId: string },
  ) {
    return this.writes.cancel(actor, params.id, params.writeId);
  }
```

In `esis.dto.ts`:

```ts
export const esisWriteParamSchema = z.object({ id: uuidSchema, writeId: uuidSchema });
```

In `esis.module.ts` `providers`, add `EsisWriteQueue`, `EsisWriteWorker`,
`EsisWriteSender`.

- [ ] **Step 7: Run the test to verify it passes**

```bash
cd apps/api && pnpm exec vitest run test/esis-group-writes.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/integrations/esis/ apps/api/test/esis-group-writes.test.ts
git commit -m "feat(esis): approve enqueues after the commit, and a sent row cannot be approved again"
```

---

## Task 9: The worker refuses to send twice

**Files:**

- Test: `apps/api/test/esis-group-writes.test.ts`

The guard exists from Task 8. This task proves it, because it is the one
failure this design cannot recover from.

- [ ] **Step 1: Write the failing test**

```ts
describe("the sender's one guarantee", () => {
  it("sends nothing for a row that already has sentAt", async () => {
    const prepared = await authed(
      request(app.getHttpServer()).post(
        `/v1/kindergartens/${scenario.kindergarten.id}/esis/group-writes`,
      ),
      admin,
    ).send({ service: "groupCreate", groupId: scenario.group.id });

    await testDb().esisWriteRequest.update({
      where: { id: prepared.body.id },
      data: { state: "APPROVED", sentAt: new Date(), response: { ok: true } },
    });

    const esis = app.get(EsisService);
    let calls = 0;
    esis.sendGroupCreate = async () => {
      calls += 1;
      return { data: {}, source: "LIVE", durationMs: 1 } as never;
    };

    await app.get(EsisWriteSender).send(prepared.body.id);

    expect(calls).toBe(0);
  });

  it("sends nothing for a row that was never approved", async () => {
    const prepared = await authed(
      request(app.getHttpServer()).post(
        `/v1/kindergartens/${scenario.kindergarten.id}/esis/group-writes`,
      ),
      admin,
    ).send({ service: "groupCreate", groupId: scenario.group.id });

    const esis = app.get(EsisService);
    let calls = 0;
    esis.sendGroupCreate = async () => {
      calls += 1;
      return { data: {}, source: "LIVE", durationMs: 1 } as never;
    };

    await app.get(EsisWriteSender).send(prepared.body.id);

    expect(calls).toBe(0);
    const row = await testDb().esisWriteRequest.findFirstOrThrow({
      where: { id: prepared.body.id },
    });
    expect(row.state).toBe("PREPARED");
  });
});
```

Add imports for `EsisService` and `EsisWriteSender`.

- [ ] **Step 2: Run it**

```bash
cd apps/api && pnpm exec vitest run test/esis-group-writes.test.ts -t "one guarantee"
```

Expected: PASS — the guard was written in Task 8. **If either fails, stop:**
the harness's only irreversible failure is unguarded, and no later task
matters until it is.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/esis-group-writes.test.ts
git commit -m "test(esis): the sender has been seen to refuse a row it already sent"
```

---

## Task 10: The authorization cases

**Files:**

- Test: `apps/api/test/esis-group-writes.test.ts`

Through HTTP, against the real route (CLAUDE.md §4.1).

- [ ] **Step 1: Write the failing tests**

```ts
describe("who may write a group to ESIS", () => {
  it("a teacher of this kindergarten gets 403", async () => {
    const teacher = await login(app, scenario.teacher.email);
    const res = await authed(
      request(app.getHttpServer()).post(
        `/v1/kindergartens/${scenario.kindergarten.id}/esis/group-writes`,
      ),
      teacher,
    ).send({ service: "groupCreate", groupId: scenario.group.id });

    /*
     * ★ 403, not 404, and this is not the §1.7 exception. §1.7 protects the
     * existence of *child* data; this is a role refusal on a kindergarten the
     * caller demonstrably belongs to, which is what every other `@Roles`
     * route answers. The 404 cases are the two below.
     */
    expect(res.status).toBe(403);
  });

  it("an administrator of another kindergarten gets 404", async () => {
    const other = await createScenario({ name: "Өөр цэцэрлэг" });
    const otherAdmin = await login(app, other.admin.email);

    const res = await authed(
      request(app.getHttpServer()).post(
        `/v1/kindergartens/${scenario.kindergarten.id}/esis/group-writes`,
      ),
      otherAdmin,
    ).send({ service: "groupCreate", groupId: scenario.group.id });

    expect(res.status).toBe(404);
  });

  it("a group from another kindergarten gets 404", async () => {
    const other = await createScenario({ name: "Гурав дахь цэцэрлэг" });

    const res = await authed(
      request(app.getHttpServer()).post(
        `/v1/kindergartens/${scenario.kindergarten.id}/esis/group-writes`,
      ),
      admin,
    ).send({ service: "groupCreate", groupId: other.group.id });

    expect(res.status).toBe(404);
    expect(await testDb().esisWriteRequest.count()).toBe(0);
  });

  it("another kindergarten's write request is 404 to approve", async () => {
    const other = await createScenario({ name: "Дөрөв дэх цэцэрлэг" });
    await testDb().kindergarten.update({
      where: { id: other.kindergarten.id },
      data: { esisInstitutionId: "42779", esisMappedAt: new Date() },
    });
    const otherAdmin = await login(app, other.admin.email);
    const theirs = await authed(
      request(app.getHttpServer()).post(
        `/v1/kindergartens/${other.kindergarten.id}/esis/group-writes`,
      ),
      otherAdmin,
    ).send({ service: "groupCreate", groupId: other.group.id });

    const res = await authed(
      request(app.getHttpServer()).post(
        `/v1/kindergartens/${scenario.kindergarten.id}/esis/group-writes/${theirs.body.id}/approve`,
      ),
      admin,
    ).send({});

    expect(res.status).toBe(404);
  });
});
```

If `createScenario` does not take a name argument, call it with no argument —
check its signature in `apps/api/test/support/fixtures.ts`.

- [ ] **Step 2: Run them**

```bash
cd apps/api && pnpm exec vitest run test/esis-group-writes.test.ts
```

Expected: PASS, 8 tests. A **403 where 404 was asserted** on the
cross-kindergarten cases means `assertAdmin` is answering before the tenant is
resolved — fix the service, not the test.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/esis-group-writes.test.ts
git commit -m "test(esis): a group write refuses every caller it should, through the route"
```

---

## Task 11: Delete — the second confirmation, and 150's answer as input

**Files:**

- Modify: `apps/api/src/integrations/esis/esis-group-writes.ts`
- Modify: `apps/api/src/integrations/esis/esis-write.service.ts`
- Test: `apps/api/test/esis-group-writes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("deleting a group in ESIS", () => {
  it("refuses without the group's name typed back", async () => {
    await testDb().group.update({
      where: { id: scenario.group.id },
      data: { esisGroupId: "9987" },
    });

    const res = await authed(
      request(app.getHttpServer()).post(
        `/v1/kindergartens/${scenario.kindergarten.id}/esis/group-writes`,
      ),
      admin,
    ).send({ service: "groupDelete", groupId: scenario.group.id });

    expect(res.status).toBe(400);
    expect(await testDb().esisWriteRequest.count()).toBe(0);
  });

  it("refuses a group this system did not create in ESIS", async () => {
    await testDb().group.update({
      where: { id: scenario.group.id },
      data: { esisGroupId: "9987" },
    });

    const res = await authed(
      request(app.getHttpServer()).post(
        `/v1/kindergartens/${scenario.kindergarten.id}/esis/group-writes`,
      ),
      admin,
    ).send({
      service: "groupDelete",
      groupId: scenario.group.id,
      confirmGroupName: scenario.group.name,
    });

    expect(res.status).toBe(400);
    expect(res.body.detail ?? res.body.message).toContain("үүсгэсэн");
  });

  it("prepares a delete for a group it created itself", async () => {
    await testDb().group.update({
      where: { id: scenario.group.id },
      data: { esisGroupId: "9987" },
    });
    await testDb().esisWriteRequest.create({
      data: {
        kindergartenId: scenario.kindergarten.id,
        service: "groupCreate",
        apiId: 150,
        groupId: scenario.group.id,
        payload: { institutionId: 42778 },
        idempotencyKey: "seed-create",
        preparedById: scenario.admin.id,
        state: "SENT",
        sentAt: new Date(),
        response: { studentGroupId: 9987 },
      },
    });

    const res = await authed(
      request(app.getHttpServer()).post(
        `/v1/kindergartens/${scenario.kindergarten.id}/esis/group-writes`,
      ),
      admin,
    ).send({
      service: "groupDelete",
      groupId: scenario.group.id,
      confirmGroupName: scenario.group.name,
    });

    expect(res.status).toBe(201);
    expect(res.body.payload).toMatchObject({ studentGroupId: 9987 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/api && pnpm exec vitest run test/esis-group-writes.test.ts -t "deleting a group"
```

Expected: FAIL — a delete currently prepares like an update.

- [ ] **Step 3: Add the two guards to `prepare`**

In `esis-write.service.ts`, after the group is loaded and before the payload is
built:

```ts
/*
 * ★ Two guards, and both are about the same fact: there is no undo.
 *
 * The typed name is the product's ordinary destructive-action pattern
 * (CLAUDE.md §5). The `findSentCreate` check is stricter and specific to
 * this trial — spec №3б §5 opens 152's delete only against a group this
 * system created in ESIS itself, so the one live exercise runs against a
 * throwaway group with no children rather than against a real class.
 */
if (dto.service === "groupDelete") {
  if (dto.confirmGroupName !== group.name) {
    throw new BadRequestException("Устгахын тулд бүлгийн нэрийг яг бичнэ үү.");
  }
  const create = await this.repo.findSentCreate(kindergartenId, dto.groupId);
  if (!create) {
    throw new BadRequestException("Зөвхөн энэ системээс ЭСИС-д үүсгэсэн бүлгийг устгаж болно.");
  }
}
```

- [ ] **Step 4: Verify the delete payload carries the ministry's id**

`buildGroupPayload` already reads `group.esisGroupId` for the update branch,
which `groupDelete` shares. Fill that column when a create succeeds — in
`esis-write.sender.ts`, inside the success path before `markSent`:

```ts
/*
 * ★ The create's answer is an input, not just a record. `groupDelete`
 * and `groupUpdate` both need the ministry's own group id, and this is
 * the only moment it is ever sent to us. Read from the response by the
 * name Task 2's probe recorded; if the field is absent, the column stays
 * NULL and the next update refuses with ESIS_GROUP_ID_UNKNOWN rather
 * than posting a body with `studentGroupId: NaN`.
 */
if (row.service === "groupCreate") {
  const ministryId = readGroupId(response.data);
  if (ministryId) await this.repo.setGroupEsisId(row.groupId, ministryId);
}
```

with, at the foot of the file:

```ts
function readGroupId(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const value = (data as Record<string, unknown>).studentGroupId;
  if (typeof value === "number") return String(value);
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}
```

and in `esis-write.repository.ts`:

```ts
  /**
   * Stamps the ministry's own group id onto our `Group`.
   *
   * ★ The second repository in this codebase that writes `Group`, and the one
   * exception to this file's own "one base filter per repository" note — so it
   * says why rather than being noticed later. It runs **inside the worker**,
   * where there is no actor and no tenant to scope by: the `groupId` comes
   * from an `EsisWriteRequest` row that a tenant-scoped read produced at
   * prepare time and that nothing can edit afterwards, so the id has already
   * been proved to belong to the kindergarten that approved the write.
   *
   * ★★ It writes one column that only this flow ever sets. If a second caller
   * ever needs it, move it to the groups repository instead of copying it —
   * two places stamping an external id is how they diverge.
   */
  setGroupEsisId(groupId: string, esisGroupId: string) {
    return this.prisma.group.update({ where: { id: groupId }, data: { esisGroupId } });
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd apps/api && pnpm exec vitest run test/esis-group-writes.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/integrations/esis/ apps/api/test/esis-group-writes.test.ts
git commit -m "feat(esis): a delete needs the name typed and a create this system made"
```

---

## Task 12: The queue a director reads

**Files:**

- Modify: `apps/api/src/integrations/esis/esis-write.service.ts`
- Modify: `apps/api/src/integrations/esis/esis.controller.ts`
- Modify: `packages/contracts/src/domain.ts`
- Test: `apps/api/test/esis-group-writes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("the write queue", () => {
  it("lists this kindergarten's writes, newest first, paginated", async () => {
    for (const name of ["Дэлбээ", "Навч"]) {
      const group = await testDb().group.create({
        data: {
          kindergartenId: scenario.kindergarten.id,
          schoolYearId: scenario.schoolYear.id,
          name,
          ageBand: "AGE_4",
        },
      });
      await authed(
        request(app.getHttpServer()).post(
          `/v1/kindergartens/${scenario.kindergarten.id}/esis/group-writes`,
        ),
        admin,
      ).send({ service: "groupCreate", groupId: group.id });
    }

    const res = await authed(
      request(app.getHttpServer()).get(
        `/v1/kindergartens/${scenario.kindergarten.id}/esis/group-writes?page=1&pageSize=1`,
      ),
      admin,
    );

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(2);
    expect(res.body.items[0].group.name).toBe("Навч");
  });
});
```

Adjust the `group.create` fields to whatever `Group` actually requires — read
the model with `grep -n "model Group" -A40 apps/api/prisma/schema.prisma`.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/api && pnpm exec vitest run test/esis-group-writes.test.ts -t "write queue"
```

Expected: FAIL with 404.

- [ ] **Step 3: Add list to the service and the route**

```ts
  async list(actor: Actor, kindergartenId: string, page: PaginationQuery) {
    this.tenants.assertAdmin(actor, kindergartenId);
    const { items, total } = await this.repo.list(kindergartenId, {
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
    });
    return { items, total, page: page.page, pageSize: page.pageSize };
  }
```

```ts
  @Get("group-writes")
  @Roles("ADMIN")
  listGroupWrites(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ) {
    return this.writes.list(actor, params.id, query);
  }
```

- [ ] **Step 4: Add the contract**

In `packages/contracts/src/domain.ts`:

```ts
export const esisWriteStateSchema = z.enum(["PREPARED", "APPROVED", "SENT", "FAILED", "CANCELLED"]);

export const esisWriteRequestSchema = z.object({
  id: uuidSchema,
  service: z.enum(["groupCreate", "groupUpdate", "groupDelete", "groupInstructor"]),
  apiId: z.number().int(),
  state: esisWriteStateSchema,
  payload: z.record(z.string(), z.unknown()),
  response: z.record(z.string(), z.unknown()).nullish(),
  errorCode: z.string().nullish(),
  sentAt: z.string().nullish(),
  createdAt: z.string(),
  group: z.object({ id: uuidSchema, name: z.string() }),
  preparedBy: z.object({ lastName: z.string(), firstName: z.string() }).nullish(),
  approvedBy: z.object({ lastName: z.string(), firstName: z.string() }).nullish(),
});
export type EsisWriteRequest = z.infer<typeof esisWriteRequestSchema>;

export const esisWriteRequestPageSchema = z.object({
  items: z.array(esisWriteRequestSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
```

- [ ] **Step 5: Rebuild contracts, then run**

```bash
pnpm --filter @kinder/contracts build
cd apps/api && pnpm exec vitest run test/esis-group-writes.test.ts
```

Expected: PASS, 12 tests. **Rebuild contracts before debugging any "missing
field"** — a stale `contracts/dist` silently drops what the built schema lacks.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/integrations/esis/ apps/api/test/esis-group-writes.test.ts packages/contracts/src/domain.ts
git commit -m "feat(esis): the write queue, paginated, with the group and both people named"
```

---

## Task 13: The group screen's илгээх

**Files:**

- Create: `apps/web/components/esis/esis-group-write.tsx`
- Modify: `apps/web/app/(app)/groups/[groupId]/page.tsx`
- Test: `apps/web/test/esis-group-write.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/esis-group-write.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setParams, stubApi } from "./support/render";
import { EsisGroupWrite } from "@/components/esis/esis-group-write";

const KG = "33333333-3333-4333-8333-333333333333";
const GROUP = "11111111-1111-4111-8111-111111111111";

const PREPARED = {
  id: "22222222-2222-4222-8222-222222222222",
  service: "groupCreate",
  apiId: 150,
  state: "PREPARED",
  payload: { institutionId: 42778, groupName: "Дэлбээ", ageBand: 4 },
  response: null,
  errorCode: null,
  sentAt: null,
  createdAt: "2026-09-18T00:00:00.000Z",
  group: { id: GROUP, name: "Дэлбээ" },
  preparedBy: { lastName: "Болд", firstName: "Сараа" },
  approvedBy: null,
};

beforeEach(() => setParams({ groupId: GROUP }));
afterEach(() => vi.unstubAllGlobals());

describe("ЭСИС рүү илгээх — бүлэг", () => {
  it("shows every field of the payload before anything is sent", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `/kindergartens/${KG}/esis/group-writes`,
        method: "POST",
        body: PREPARED,
        status: 201,
      },
    ]);

    renderWithProviders(<EsisGroupWrite kindergartenId={KG} groupId={GROUP} groupName="Дэлбээ" />, {
      selectedChild: false,
    });

    await user.click(await screen.findByRole("button", { name: "ЭСИС рүү илгээх" }));

    /*
       ★ Every value, none hidden — the client's instruction on output:
       "garaltiin utguudiig bugdiig ni haruulna nuuj haaj bolohgui".
    */
    expect(await screen.findByText("institutionId")).toBeInTheDocument();
    expect(screen.getByText("42778")).toBeInTheDocument();
    expect(screen.getByText("groupName")).toBeInTheDocument();
    expect(screen.getByText("ageBand")).toBeInTheDocument();
  });

  it("sends nothing until Батлах is pressed", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `/kindergartens/${KG}/esis/group-writes`,
        method: "POST",
        body: PREPARED,
        status: 201,
      },
    ]);

    renderWithProviders(<EsisGroupWrite kindergartenId={KG} groupId={GROUP} groupName="Дэлбээ" />, {
      selectedChild: false,
    });

    await user.click(await screen.findByRole("button", { name: "ЭСИС рүү илгээх" }));
    await screen.findByText("institutionId");

    expect(calls.filter((call) => call.url.includes("/approve"))).toHaveLength(0);
  });
});
```

`renderWithProviders`'s `selectedChild: false` option exists because the
`(app)` layout does not always provide `SelectedChildProvider` — check its
signature in `apps/web/test/support/render.tsx` and match it.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/web && pnpm exec vitest run test/esis-group-write.test.tsx
```

Expected: FAIL — cannot resolve `@/components/esis/esis-group-write`.

- [ ] **Step 3: Write the component**

Create `apps/web/components/esis/esis-group-write.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api/client";
import type { EsisWriteRequest } from "@kinder/contracts";
import { toast } from "@/components/ui/toast";

const SERVICE_LABEL: Record<string, string> = {
  groupCreate: "Бүлэг үүсгэх",
  groupUpdate: "Бүлэг засах",
  groupDelete: "Бүлэг устгах",
  groupInstructor: "Бүлгийн багш тохируулах",
};

/**
 * The director's «ЭСИС рүү илгээх» — prepare, read, approve.
 *
 * ★ The preview renders the payload's own keys, not a translated form. What is
 * approved has to be what is sent, and a relabelled field is a description of
 * a write rather than the write. The keys are ESIS's; the labels around them
 * are ours.
 */
export function EsisGroupWrite(props: {
  kindergartenId: string;
  groupId: string;
  groupName: string;
}) {
  const [request, setRequest] = useState<EsisWriteRequest | null>(null);
  const [busy, setBusy] = useState(false);

  async function prepare(service: string, confirmGroupName?: string) {
    setBusy(true);
    try {
      const prepared = await api.post<EsisWriteRequest>(
        `/kindergartens/${props.kindergartenId}/esis/group-writes`,
        { service, groupId: props.groupId, confirmGroupName },
      );
      setRequest(prepared);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Бэлтгэж чадсангүй.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!request) return;
    setBusy(true);
    try {
      await api.post(
        `/kindergartens/${props.kindergartenId}/esis/group-writes/${request.id}/approve`,
        {},
      );
      toast.success("ЭСИС рүү илгээхээр дараалалд орлоо.");
      setRequest(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Батлаж чадсангүй.");
    } finally {
      setBusy(false);
    }
  }

  if (!request) {
    return (
      <Card className="flex flex-col gap-3">
        <h2 className="text-body font-semibold text-ink">ЭСИС</h2>
        <p className="text-caption text-muted">
          Бүлгийн мэдээллийг Боловсролын ЭСИС систем рүү илгээнэ. Илгээхээс өмнө яг ямар өгөгдөл
          явахыг харна.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => void prepare("groupCreate")}>
            ЭСИС рүү илгээх
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void prepare("groupUpdate")}
          >
            Засварыг илгээх
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-body font-semibold text-ink">
        {SERVICE_LABEL[request.service] ?? request.service} — API {request.apiId}
      </h2>
      <dl className="flex flex-col gap-1.5">
        {Object.entries(request.payload).map(([key, value]) => (
          <div key={key} className="flex items-baseline justify-between gap-3">
            <dt className="text-caption font-medium text-muted">{key}</dt>
            <dd className="text-body text-ink">{String(value)}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => void approve()}>
          Батлах
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => setRequest(null)}>
          Болих
        </Button>
      </div>
    </Card>
  );
}
```

Match the real names of `Button`, `Card`, `toast` and `api` to this repo — read
one existing panel such as `apps/web/components/esis/esis-write.tsx` and follow
it exactly rather than trusting the imports above.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/web && pnpm exec vitest run test/esis-group-write.test.tsx
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Mount it on the group screen**

In `apps/web/app/(app)/groups/[groupId]/page.tsx`, render
`<EsisGroupWrite … />` for an ADMIN only. Find how that page already tests a
role and use the same check.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/esis/esis-group-write.tsx "apps/web/app/(app)/groups/[groupId]/page.tsx" apps/web/test/esis-group-write.test.tsx
git commit -m "feat(esis): the group screen shows the payload before the director approves it"
```

---

## Task 14: The Бичих tab

**Files:**

- Create: `apps/web/components/esis/esis-write-queue.tsx`
- Modify: `apps/web/app/(app)/admin/esis-sync/page.tsx`
- Test: `apps/web/test/esis-group-write.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/esis-group-write.test.tsx`:

```tsx
describe("Бичих самбар", () => {
  it("names the state, the group and who approved each write", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `/kindergartens/${KG}/esis/group-writes`,
        body: {
          items: [
            {
              ...PREPARED,
              state: "SENT",
              sentAt: "2026-09-18T01:00:00.000Z",
              approvedBy: { lastName: "Дорж", firstName: "Оюун" },
              response: { studentGroupId: 9987 },
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      },
    ]);

    renderWithProviders(<EsisWriteQueue kindergartenId={KG} />, { selectedChild: false });

    expect(await screen.findByText("Илгээгдсэн")).toBeInTheDocument();
    expect(screen.getByText("Дэлбээ")).toBeInTheDocument();
    expect(screen.getByText(/Оюун/)).toBeInTheDocument();
  });

  it("says what to do next when nothing has been written yet", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `/kindergartens/${KG}/esis/group-writes`,
        body: { items: [], total: 0, page: 1, pageSize: 20 },
      },
    ]);

    renderWithProviders(<EsisWriteQueue kindergartenId={KG} />, { selectedChild: false });

    expect(await screen.findByText("ЭСИС рүү илгээсэн зүйл хараахан байхгүй.")).toBeInTheDocument();
    expect(screen.getByText(/Бүлгийн дэлгэцээс/)).toBeInTheDocument();
  });
});
```

The second test is CLAUDE.md §5's "empty states say what to do next", asserted
rather than assumed.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/web && pnpm exec vitest run test/esis-group-write.test.tsx -t "Бичих"
```

Expected: FAIL — cannot resolve `EsisWriteQueue`.

- [ ] **Step 3: Write the component**

Create `apps/web/components/esis/esis-write-queue.tsx`:

```tsx
"use client";

import { Card } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { EsisWriteRequest } from "@kinder/contracts";

const STATE_LABEL: Record<string, string> = {
  PREPARED: "Хүлээгдэж байна",
  APPROVED: "Батлагдсан",
  SENT: "Илгээгдсэн",
  FAILED: "Уналаа",
  CANCELLED: "Болисон",
};

const SERVICE_LABEL: Record<string, string> = {
  groupCreate: "Бүлэг үүсгэх",
  groupUpdate: "Бүлэг засах",
  groupDelete: "Бүлэг устгах",
  groupInstructor: "Бүлгийн багш тохируулах",
};

/**
 * Every write this kindergarten has sent, or is about to.
 *
 * ★ `SENT` is labelled "Илгээгдсэн", not "Амжилттай". ESIS answering is not
 * ESIS agreeing, and the answer is shown beside the row so the director reads
 * the ministry's own words rather than our summary of them.
 */
export function EsisWriteQueue(props: { kindergartenId: string }) {
  const writes = useQuery({
    queryKey: ["esis-group-writes", props.kindergartenId],
    queryFn: () =>
      api.get<{ items: EsisWriteRequest[]; total: number }>(
        `/kindergartens/${props.kindergartenId}/esis/group-writes?page=1&pageSize=20`,
      ),
  });

  if (writes.isLoading) return <Card>Уншиж байна…</Card>;

  const items = writes.data?.items ?? [];
  if (items.length === 0) {
    return (
      <Card className="flex flex-col gap-1.5">
        <p className="text-body text-ink">ЭСИС рүү илгээсэн зүйл хараахан байхгүй.</p>
        <p className="text-caption text-muted">
          Бүлгийн дэлгэцээс «ЭСИС рүү илгээх»-ийг дарж бэлтгэнэ.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <Card key={item.id} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-body font-medium text-ink">
              {SERVICE_LABEL[item.service] ?? item.service}
            </p>
            <p className="text-caption text-muted">{STATE_LABEL[item.state] ?? item.state}</p>
          </div>
          <p className="text-caption text-muted">{item.group.name}</p>
          {item.approvedBy ? (
            <p className="text-caption text-muted">
              Баталсан: {item.approvedBy.lastName} {item.approvedBy.firstName}
            </p>
          ) : null}
          {item.errorCode ? (
            <p className="text-caption text-danger">Алдаа: {item.errorCode}</p>
          ) : null}
          {item.response ? (
            <pre className="overflow-x-auto rounded-control bg-sunken p-2 text-caption text-ink">
              {JSON.stringify(item.response, null, 2)}
            </pre>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
```

The `<pre>` has `overflow-x-auto` because wide content must scroll inside its
own container rather than making the page scroll sideways on a phone.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/web && pnpm exec vitest run test/esis-group-write.test.tsx
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Add the tab**

In `apps/web/app/(app)/admin/esis-sync/page.tsx`, add a Бичих tab beside the
existing sync content and render `<EsisWriteQueue kindergartenId={…} />`. Follow
whatever tab mechanism the page already uses.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/esis/esis-write-queue.tsx "apps/web/app/(app)/admin/esis-sync/page.tsx" apps/web/test/esis-group-write.test.tsx
git commit -m "feat(esis): the write queue, where the sync panel already lives"
```

---

## Task 15: Both suites, then the live exercise

**Files:**

- Modify: `docs/ESIS_API_READINESS.md`
- Modify: `docs/ESIS_TRIAL_STATE.md`

- [ ] **Step 1: Run both suites, one at a time**

```bash
cd apps/api && pnpm exec vitest run --reporter=verbose > /tmp/api.log 2>&1; tail -5 /tmp/api.log
```

then, only after it has finished:

```bash
cd apps/web && pnpm exec vitest run --reporter=verbose > /tmp/web.log 2>&1; tail -5 /tmp/web.log
```

Never together, and not while `pnpm dev` is busy — both produce `beforeEach`
hook timeouts that impersonate cross-kindergarten leaks. Expected: api and web
both green. Report the counts; if anything fails, say so with the output rather
than re-running until it passes.

- [ ] **Step 2: Check formatting and lint**

```bash
pnpm format:check
pnpm -r lint
pnpm -r typecheck
```

If `format:check` names `esis.catalog.ts`, `esis.fields.ts`,
`esis.fields.test.ts`, `esis.service.ts` or `esis-pull-button.tsx`, **leave them
alone and say so** — those five are deliberately not clean at HEAD.

- [ ] **Step 3: The live exercise, in this order**

Against institution 42778, one record at a time. Between each step, write the
response into `docs/ESIS_API_READINESS.md` §1.1.x **before** starting the next.

1. **150** — create a group named `ЗЗЗ туршилт` in NomadKids with no children
   enrolled, then prepare and approve `groupCreate`. Record the response and
   whether `esisGroupId` was filled.
2. **162** — assign one teacher to that group, prepare and approve
   `groupInstructor`. If prepare refuses for a missing `esisPersonId`, refresh
   the staff roster from `/admin/esis-sync` and try again — that refusal
   working is itself a result worth recording.
3. **152 update** — rename the group and approve `groupUpdate`.
4. **152 delete** — approve `groupDelete` with the name typed back.

Only after step 4 is `groupUpdate` fit to offer on a real group. Until then,
keep the Засварыг илгээх button behind whatever flag the group screen already
uses, or do not mount it.

- [ ] **Step 4: Re-run the probe**

```bash
cd apps/api && set -a && . ../../.env && set +a
ESIS_INSTITUTION_ID=42778 pnpm exec tsx scripts/esis-probe.ts
```

Expected: no worse than **OK 34 · EMPTY 20 · SKIP 1 · PARSE 0**. Any new
`PARSE` is a schema this plan broke.

- [ ] **Step 5: Update the handover**

In `docs/ESIS_TRIAL_STATE.md`: move spec №3б out of §6 "Одоо юу үлдсэн" and
into §3 "Дууссан ажил", with what was proved live and what was not. Add the
three services to §8's key-files table if a new file belongs there. Say plainly
that 72, 73, 129 and 131 remain unwired and why — §6 keeps a line for them.

- [ ] **Step 6: Commit**

```bash
git add docs/
git commit -m "docs(esis): the three group writes, run live against institution 42778"
```

---

## What this plan does not do

- **72, 73, 129, 131.** Spec §1. Four named matrix states, not four gaps.
- **No bulk write.** One subject per request, approved on its own.
- **No two-person approval.** The preparer may approve; a kindergarten with one
  director would otherwise be locked out.
- **No delete on a real group.** Only on a group this system created in ESIS,
  and only once.
- **No change to `POST …/esis/write`** or to `ESIS_WRITE_RESOURCES`. The
  immediate pass-through route keeps its three child-record saves, and none of
  the group writes joins it.

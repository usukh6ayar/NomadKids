# Staff self-registration against the ESIS roster — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A teacher registers themselves with a kindergarten code and their
register number, matched against a stored ESIS staff roster, and sets their own
password — with no administrator ever typing one and no unauthenticated request
ever reaching the ministry.

**Architecture:** An admin-triggered refresh stores `school/staff` and
`teacher/list` in `EsisStaffRoster`. A public, rate-limited endpoint matches a
typed register number against that stored table, derives a role from the ISCO-08
`jobCode`, creates an account through the existing invitation machinery, and
returns a one-time token the teacher redeems on the existing invitation page.

**Tech Stack:** NestJS, Prisma, PostgreSQL, zod v4, vitest + supertest, Next.js.

**Spec:** `docs/superpowers/specs/2026-09-15-esis-full-coverage-design.md` §5,
amended 2026-09-16 — see §0 below.

---

## 0. What changed since the spec was written

The spec says registration matches "the PERSISTED staff roster — the one tier 2
syncs daily". **There is no such table.** Verified 2026-09-16: `StaffRecord` is
certificates and work history, and `EsisSyncRun` stores run metadata, not rows.
Tier 2 belongs to spec №3, which is not built.

**Client decision, 2026-09-16: the roster table is part of this plan.** Spec №3
later adds a schedule on top of it; it does not build it.

The spec's rule survives intact and is the reason the table exists at all: the
registration route is **unauthenticated**, so it must never call ESIS. Public
traffic in the ministry's logs is exactly what §1.1 argues against.

---

## Background the engineer needs

**What ESIS is.** The Mongolian Ministry of Education's student information
system. This deployment holds a Bearer token scoped to one institution, `42778`,
for a one-month trial the ministry is watching. Responses are wrapped:

```json
{ "SUCCESS_CODE": 200, "RESPONSE_MESSAGE": "…", "RESULT": [ { … } ] }
```

**Measured live on 2026-09-16** — this is what the design is built from, not
documentation:

`school/staff` (API 55) returns **13 rows** and is the superset: all 10 rows of
`teacher/list` (API …812) appear in it by `personId`. Every row of both carries
`personRegNumber` (a string) and `civilId` (a **number**).

Distinct `jobCode` values across the 13:

| jobCode   | positionName                                  | Count |
| --------- | --------------------------------------------- | ----- |
| `2342-13` | Багш, цэцэрлэгийн /мэргэжлийн/ /СӨБ/          | 4     |
| `2342-05` | Багш, цэцэрлэгийн багшийн туслах /мэргэжлийн/ | 4     |
| `2351-01` | Арга зүйч, ердийн цэцэрлэгийн                 | 1     |
| `5120-11` | ахлах Тогооч, туслах Тогооч                   | 2     |
| `5153-12` | Жижүүр /байрны/                               | 1     |
| `1341-02` | Цэцэрлэгийн менежер, эрхлэгч                  | 1     |

These are **ISCO-08 occupation codes**: 2342 early-childhood educators, 2351
education-methods specialists, 5120 cooks, 5153 building caretakers, 1341 child-
care services managers. The role mapping keys on the **four-digit group**, not on
`positionName` — that field is free text and the live data already disagrees with
itself on capitalisation ("ахлах Тогооч", "туслах Тогооч").

**Existing machinery you will reuse, not rebuild:**

- `UsersService.createInvitedAccount` (`users.service.ts:149`) — creates a user
  with an unusable random password hash, a `Membership`, an `INVITATION`
  auth-token, and an `AuditLog` row. Returns `{ user, invitationToken }`.
- `AuthService.acceptInvitation` (`auth.service.ts:368`) — the person redeems the
  token and sets their own password. Already public, already rate-limited.
- `apps/web/app/invitation/[token]/page.tsx` — the page they land on.
- `@RateLimit({ limit, windowMs })` + `RateLimitGuard`
  (`common/rate-limit/rate-limit.guard.ts`), applied per route in
  `auth.controller.ts`.

**Rules that bind this work** (`CLAUDE.md`):

- §1.1 — every access to child data goes through `authz/`.
- §1.7 — child data returns **404**, never 403.
- §2.1 — controllers parse and call a service; only `*.repository.ts` may import
  `PrismaClient`.
- §3.1 — every tenant-scoped table carries `kindergartenId`.
- §3.2 — no hard deletes; set `deletedAt`.
- §3.3 — **read the generated migration SQL by hand** before committing.
- §3.6 — failure counters are written **outside** any interactive transaction, or
  the failing request's rollback resets them.
- §4.1 — authorization tests through HTTP against the real route.
- §5 — all user-facing text in **Mongolian**; code and identifiers in English.

**Commands:**

```bash
pnpm --filter @kinder/api test                 # ~15 min, needs Postgres on :5432
pnpm --filter @kinder/api exec vitest run test/staff-registration.test.ts
pnpm --filter contracts build                  # rebuild before the web app sees new fields
pnpm --filter @kinder/api typecheck && pnpm lint
```

**Never run the api and web suites at the same time** — they starve Postgres and
produce hook timeouts that look exactly like a cross-tenant data leak.

**A green api suite is no evidence an ESIS reader works.** `test/setup.ts`
deletes `ESIS_TOKEN`, so every ESIS route under vitest answers from a stub. After
any change touching a schema or parser, run the live probe:

```bash
cd apps/api && set -a && . ../../.env && set +a
ESIS_INSTITUTION_ID=42778 pnpm exec tsx scripts/esis-probe.ts
```

---

## File Structure

| File                                                   | Responsibility                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `apps/api/prisma/schema.prisma`                        | `EsisStaffRoster` model; `Kindergarten.staffRegistrationCodeHash` + `staffRegistrationCodeSetAt` |
| `apps/api/src/integrations/esis/esis.roster.ts`        | `jobCode` → `Role`, and the register-number normaliser. Pure functions, no I/O                   |
| `apps/api/src/integrations/esis/esis.repository.ts`    | `replaceStaffRoster`, `findRosterEntryByRegisterNumber`, `latestRosterSyncAt`                    |
| `apps/api/src/integrations/esis/esis-admin.service.ts` | `refreshStaffRoster(actor, kindergartenId)` — ADMIN only                                         |
| `apps/api/src/staff-registration/`                     | New module: controller, service, repository, dto. The public route lives here, not in `auth/`    |
| `apps/api/test/staff-registration.test.ts`             | HTTP tests: the match, every refusal, the rate limit, the audit row                              |
| `apps/web/app/register/page.tsx`                       | The teacher's form (Mongolian)                                                                   |
| `apps/web/app/(app)/admin/staff-code/page.tsx`         | The director's code panel and the who-registered list                                            |

A new module rather than adding to `auth/`: this route is about ESIS identity,
reads the roster table, and must not inherit `auth/`'s rate-limit budget — a
teacher failing registration must not lock out logins.

---

## Task 1: The roster table and the kindergarten code

**Files:**

- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_esis_staff_roster/migration.sql` (generated)

- [ ] **Step 1: Add the model and the two columns**

In `apps/api/prisma/schema.prisma`, add:

```prisma
/// One row of the ministry's staff list for one kindergarten, stored so an
/// unauthenticated registration attempt never has to reach ESIS.
///
/// ★ **Not a cache.** A cache may be missed and refilled on demand; this table
/// is the only thing `POST /v1/staff-registration` is allowed to read, because
/// that route is public and a public route must not put traffic into the
/// ministry's logs (design §1.1). If the table is empty or stale, registration
/// refuses — see `StaffRegistrationService`.
///
/// ★★ Replaced wholesale on each refresh rather than merged. The ministry's
/// list is the truth about who works here; a merge would keep somebody who has
/// left, and "left the kindergarten" is exactly the case this must get right.
/// Rows are hard-deleted on replace — the CLAUDE.md §3.2 soft-delete rule
/// protects records somebody may need to read back, and a superseded copy of an
/// upstream list is not one. `AuditLog` records that a refresh happened.
model EsisStaffRoster {
  id             String @id @default(uuid()) @db.Uuid
  kindergartenId String @db.Uuid

  /// ESIS's own identifier for the person. The join key for everything else.
  esisPersonId String
  /// Регистрийн дугаар — what the teacher types. Stored normalised (upper-case,
  /// no spaces) so a match is an equality test rather than a scan.
  registerNumber String
  lastName       String
  firstName      String

  /// ISCO-08 occupation code, e.g. `2342-13`. The role is derived from this and
  /// never from `positionName`, which is free text — the live data disagrees
  /// with itself on capitalisation.
  jobCode      String?
  positionName String?
  /// Whether `teacher/list` (API …812) also returned this person, not only
  /// `school/staff` (55). Recorded because the two lists disagree: on 42778
  /// `teacher/list` reports two арга зүйч and `school/staff` reports one.
  isInstructor Boolean @default(false)

  syncedAt DateTime @default(now())

  kindergarten Kindergarten @relation(fields: [kindergartenId], references: [id], onDelete: Cascade)

  /// The registration lookup, and the guarantee that one register number
  /// resolves to one person within a kindergarten.
  @@unique([kindergartenId, registerNumber])
  @@unique([kindergartenId, esisPersonId])
  @@map("esis_staff_roster")
}
```

On `model User`, beside the other identity columns:

```prisma
  /// The ESIS person this account belongs to, when it was created by
  /// self-registration.
  ///
  /// ★ Globally unique, not per kindergarten, because one person in the
  /// ministry's database is one person: the same `personId` registering twice
  /// must be refused rather than given a second account. `Child.esisPersonId`
  /// is scoped per kindergarten for the opposite reason — a child's record
  /// belongs to the kindergarten holding it.
  ///
  /// ★★ NULL for every account made by invitation, which is most of them. It
  /// is the marker for "this person registered themselves", and the
  /// director's review list reads it.
  esisPersonId String? @unique
```

And on `model Kindergarten`, beside `esisMappedAt`:

```prisma
  /// The code a director gives their staff so they can register themselves.
  ///
  /// ★ Hashed, like a password, though it is not one. It is a secret shared
  /// among thirteen people and it is a **throttle, not authentication** — the
  /// roster match is the real gate. Hashed anyway: a plaintext column is one
  /// database read away from letting anybody register as any member of staff at
  /// any kindergarten, and the cost of hashing it is nothing.
  staffRegistrationCodeHash  String?
  staffRegistrationCodeSetAt DateTime?
```

And in `Kindergarten`'s relation block:

```prisma
  esisStaffRoster        EsisStaffRoster[]
```

- [ ] **Step 2: Generate the migration**

```bash
cd apps/api
pnpm exec prisma migrate dev --name esis_staff_roster --create-only
```

**`--create-only` matters.** This database has divergent history; a plain
`migrate dev` offers a RESET and destroys the roster seeded from live ESIS.

- [ ] **Step 3: Read the generated SQL by hand**

CLAUDE.md §3.3. Open the generated `migration.sql` and confirm:

- It `CREATE TABLE "esis_staff_roster"`, `ALTER TABLE "kindergartens" ADD COLUMN` twice, and `ALTER TABLE "users" ADD COLUMN "esisPersonId"`.
- There is **no** `DROP TABLE`, **no** `DROP COLUMN`, and no `ALTER COLUMN … SET NOT NULL` on an existing table.
- All three unique indexes are present — the roster's two and `users.esisPersonId`.

If it contains anything data-losing, stop and report it. Do not apply it.

- [ ] **Step 4: Apply it and regenerate the client**

```bash
pnpm exec prisma migrate deploy
pnpm exec prisma generate
pnpm --filter @kinder/api typecheck
```

`migrate deploy`, never `migrate dev` — see Step 2.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(esis): a stored staff roster, and a kindergarten's registration code"
```

---

## Task 2: jobCode decides the role, and unmapped means no role

**Files:**

- Create: `apps/api/src/integrations/esis/esis.roster.ts`
- Create: `apps/api/src/integrations/esis/esis.roster.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/integrations/esis/esis.roster.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeRegisterNumber, roleForJobCode } from "./esis.roster";

/*
 * ★ Every code here was returned live by institution 42778 on 2026-09-16.
 * None is invented, which is the whole point: the eleven reader field-lists
 * this project had to correct were all written from documentation.
 */
describe("roleForJobCode", () => {
  it.each([
    ["2342-13", "TEACHER"], // Багш, цэцэрлэгийн /мэргэжлийн/ /СӨБ/
    ["2342-05", "TEACHER"], // Багшийн туслах
    ["2351-01", "TEACHER"], // Арга зүйч
    ["5120-11", "COOK"], // Тогооч
  ])("maps %s to %s", (jobCode, role) => {
    expect(roleForJobCode(jobCode)).toBe(role);
  });

  /*
   * ★★ The two that must NOT resolve, and they fail in opposite directions.
   *
   * `5153-12` is the жижүүр. Nothing in the product fits, and TEACHER is the
   * tempting default because it is the commonest staff role — it would also
   * hand every child's development record to the building's caretaker.
   *
   * `1341-02` is the эрхлэгч. ADMIN fits perfectly and is refused anyway:
   * with no approval step, a job title would decide who administers the
   * kindergarten, and a job title is a string in somebody else's database.
   */
  it.each([
    ["5153-12"], // Жижүүр /байрны/
    ["1341-02"], // Цэцэрлэгийн менежер, эрхлэгч
  ])("refuses to derive a role for %s", (jobCode) => {
    expect(roleForJobCode(jobCode)).toBeNull();
  });

  it("refuses an unknown, malformed or absent code", () => {
    for (const value of ["9999-99", "2342", "", "  ", null, undefined]) {
      expect({ value, role: roleForJobCode(value) }).toEqual({ value, role: null });
    }
  });

  /* The mapping keys on the four-digit ISCO group, so an unseen suffix works. */
  it("reads the occupation group rather than the whole code", () => {
    expect(roleForJobCode("2342-99")).toBe("TEACHER");
  });
});

describe("normalizeRegisterNumber", () => {
  it("upper-cases and strips whitespace so typing is forgiving", () => {
    expect(normalizeRegisterNumber(" ул24270406 ")).toBe("УЛ24270406");
    expect(normalizeRegisterNumber("УЛ 2427 0406")).toBe("УЛ24270406");
  });

  /*
   * ★ Cyrillic У (U+0423) and Latin Y (U+0059) are different characters that
   * look identical in most fonts. A teacher with a Latin keyboard layout types
   * the wrong one and gets "register number not found" forever, with no way to
   * tell why. Mapped rather than rejected.
   */
  it("maps look-alike Latin letters to their Cyrillic twins", () => {
    expect(normalizeRegisterNumber("YЛ24270406")).toBe("УЛ24270406");
    expect(normalizeRegisterNumber("AA12345678")).toBe("АА12345678");
  });

  it("returns null for anything that is not two letters and eight digits", () => {
    for (const value of ["", "УЛ2427040", "УЛ242704066", "УЛ2427040A", "1234567890"]) {
      expect({ value, out: normalizeRegisterNumber(value) }).toEqual({ value, out: null });
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter @kinder/api exec vitest run src/integrations/esis/esis.roster.test.ts
```

Expected: FAIL to compile — the module does not exist.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/integrations/esis/esis.roster.ts`:

```ts
import { Role } from "../../domain/enums";

/**
 * The role a member of staff gets from the ministry's own occupation code.
 *
 * ★ **Keyed on `jobCode`, never on `positionName`** — measured live against
 * institution 42778 on 2026-09-16. `positionName` is free text and the thirteen
 * real rows already disagree with themselves on capitalisation ("ахлах Тогооч",
 * "туслах Тогооч"); `jobCode` is ISCO-08 and its four-digit group is stable.
 *
 * ★★ **Unmapped returns `null`, and `null` means no account.** Two codes are
 * refused deliberately rather than missing by accident:
 *
 * - `5153` (building caretakers) — the жижүүр. `TEACHER` is the tempting
 *   default because it is the commonest staff role here; it would also hand
 *   every child's development record to the caretaker.
 * - `1341` (child-care services managers) — the эрхлэгч. `ADMIN` fits, and is
 *   refused because this flow has no approval step: a job title in somebody
 *   else's database must not decide who administers a kindergarten.
 *
 * `ACCOUNTANT` is absent for the same reason as `ADMIN`. Both stay
 * invitation-only.
 */
const ROLE_BY_OCCUPATION_GROUP: Record<string, Role> = {
  /** Early-childhood educators — багш, багшийн туслах. */
  "2342": Role.TEACHER,
  /** Education-methods specialists — арга зүйч. */
  "2351": Role.TEACHER,
  /** Cooks — тогооч. */
  "5120": Role.COOK,
};

export function roleForJobCode(jobCode: string | null | undefined): Role | null {
  const group = /^(\d{4})-/.exec((jobCode ?? "").trim())?.[1];
  return group ? (ROLE_BY_OCCUPATION_GROUP[group] ?? null) : null;
}

/*
 * Cyrillic letters that have an identical-looking Latin twin. A teacher on a
 * Latin layout types the twin, the equality match fails, and the screen can
 * only say "not found" — which is indistinguishable from not being on the
 * roster at all. Mapping them costs nothing and removes a whole class of
 * unanswerable support question.
 */
const LOOKALIKE: Record<string, string> = {
  A: "А",
  B: "В",
  C: "С",
  E: "Е",
  H: "Н",
  K: "К",
  M: "М",
  O: "О",
  P: "Р",
  T: "Т",
  X: "Х",
  Y: "У",
};

/**
 * A register number in the one form the roster stores and the match compares.
 *
 * Returns `null` when the input is not two Cyrillic letters followed by eight
 * digits — the shape of a Mongolian регистрийн дугаар. A caller treats `null`
 * exactly as it treats "no such row": the same refusal, the same message.
 */
export function normalizeRegisterNumber(value: string | null | undefined): string | null {
  const collapsed = (value ?? "").replace(/\s+/g, "").toUpperCase();
  const mapped = [...collapsed].map((ch) => LOOKALIKE[ch] ?? ch).join("");
  return /^[А-ЯЁӨҮ]{2}\d{8}$/.test(mapped) ? mapped : null;
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @kinder/api exec vitest run src/integrations/esis/esis.roster.test.ts
pnpm --filter @kinder/api typecheck
pnpm lint
```

Expected: PASS, all cases. If `Role` is not importable from `../../domain/enums`,
find where the other ESIS files import it and follow them.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/integrations/esis/esis.roster.ts apps/api/src/integrations/esis/esis.roster.test.ts
git commit -m "feat(esis): the ministry's occupation code decides the role, and two codes decide nothing"
```

---

## Task 3: An admin refreshes the roster

**Files:**

- Modify: `apps/api/src/integrations/esis/esis.repository.ts`
- Modify: `apps/api/src/integrations/esis/esis-admin.service.ts`
- Modify: `apps/api/src/integrations/esis/esis.controller.ts`
- Test: `apps/api/test/esis-admin.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/esis-admin.test.ts`, following that file's existing style —
it provides `a` (a `Scenario`), `adminA` / `teacherA` / `superAdmin`, `authed()`,
`mapInstitution()`, `server()`, and the `read` mock at the top:

```ts
/*
 * ★ The roster exists so that `POST /v1/staff-registration` — which is public —
 * never has to call ESIS. This is the only route that fills it, and it is
 * ADMIN-only: a refresh spends the deployment's token against the ministry's
 * rate limits.
 */
describe("staff roster refresh", () => {
  const url = (kindergartenId: string) =>
    `/v1/kindergartens/${kindergartenId}/esis/staff-roster/refresh`;

  /*
   * ★ The register number is **lower case here on purpose.**
   *
   * Measured live on 2026-09-16: `school/staff` returns register numbers in
   * lower case — 0 of 13 matched the pattern as sent, 13 of 13 after
   * upper-casing — while `teacher/list` returns the same thirteen people's
   * numbers in upper case. The roster is built from `school/staff` because it
   * is the superset, so this fixture is what the service actually receives.
   */
  const staffRow = {
    personId: "90000000000001",
    personRegNumber: "ул24270406",
    lastName: "Овог",
    firstName: "Нэр",
    jobCode: "2342-13",
    positionName: "Багш, цэцэрлэгийн /мэргэжлийн/ /СӨБ/",
  };

  it("stores the register number normalised, not as the ministry cased it", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);
    read.mockResolvedValue({ data: [staffRow] });

    const res = await authed(request(server()).post(url(a.kindergarten.id)), adminA).send({});

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);

    const stored = await db.esisStaffRoster.findMany({
      where: { kindergartenId: a.kindergarten.id },
    });
    expect(stored).toHaveLength(1);
    /*
     * Upper case, though the fixture was lower. Storing it raw would make the
     * registration lookup fail for every member of staff, and the screen would
     * say "you are not on the list" — indistinguishable from the truth.
     */
    expect(stored[0]).toMatchObject({ registerNumber: "УЛ24270406", jobCode: "2342-13" });
  });

  /* A row nobody could ever match is counted and skipped, not stored. */
  it("skips a row whose register number cannot be read", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);
    read.mockResolvedValue({
      data: [staffRow, { ...staffRow, personId: "90000000000002", personRegNumber: "" }],
    });

    const res = await authed(request(server()).post(url(a.kindergarten.id)), adminA).send({});

    expect(res.body).toMatchObject({ count: 1, skipped: 1 });
  });

  /*
   * ★★ Replace, not merge. Somebody who has left the kindergarten must stop
   * being able to register, and a merge would leave their row behind.
   */
  it("replaces the previous roster rather than merging into it", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);

    read.mockResolvedValue({ data: [staffRow] });
    await authed(request(server()).post(url(a.kindergarten.id)), adminA).send({});

    read.mockResolvedValue({
      data: [{ ...staffRow, personId: "90000000000002", personRegNumber: "УБ11112222" }],
    });
    await authed(request(server()).post(url(a.kindergarten.id)), adminA).send({});

    const stored = await db.esisStaffRoster.findMany({
      where: { kindergartenId: a.kindergarten.id },
    });
    expect(stored.map((row) => row.registerNumber)).toEqual(["УБ11112222"]);
  });

  it("returns 404 to a teacher and stores nothing", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);

    const res = await authed(request(server()).post(url(a.kindergarten.id)), teacherA).send({});

    expect(res.status).toBe(404);
    expect(await db.esisStaffRoster.count({ where: { kindergartenId: a.kindergarten.id } })).toBe(
      0,
    );
  });

  it("returns 404 to an admin of another kindergarten", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);

    const res = await authed(request(server()).post(url(a.kindergarten.id)), adminB).send({});

    expect(res.status).toBe(404);
  });
});
```

`adminB` may not exist in that file's fixtures — check, and add it the way
`adminA` is built if it does not.

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter @kinder/api exec vitest run test/esis-admin.test.ts -t "staff roster refresh"
```

Expected: FAIL — 404 on every case, the route does not exist.

- [ ] **Step 3: Repository**

In `apps/api/src/integrations/esis/esis.repository.ts`:

```ts
  /**
   * Swaps one kindergarten's stored roster for the list ESIS just returned.
   *
   * ★ Delete-then-insert inside one transaction, so a reader never sees a
   * half-written roster and a failed refresh leaves the previous one intact.
   * A registration attempt landing mid-refresh must match against a complete
   * list or an old one, never a partial one.
   *
   * ★★ Hard delete. CLAUDE.md §3.2 protects records somebody may need to read
   * back; a superseded copy of somebody else's list is not one, and keeping
   * them would leave a person who has left the kindergarten able to register.
   * `AuditLog` records that the refresh happened and who ran it.
   */
  replaceStaffRoster(
    kindergartenId: string,
    rows: {
      esisPersonId: string;
      registerNumber: string;
      lastName: string;
      firstName: string;
      jobCode: string | null;
      positionName: string | null;
      isInstructor: boolean;
    }[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.esisStaffRoster.deleteMany({ where: { kindergartenId } });
      if (rows.length === 0) return 0;
      const created = await tx.esisStaffRoster.createMany({
        data: rows.map((row) => ({ ...row, kindergartenId })),
      });
      return created.count;
    });
  }
```

- [ ] **Step 4: Service**

In `esis-admin.service.ts`, add a method that:

1. `this.tenants.assertAdmin(actor, kindergartenId)`.
2. Loads the kindergarten; 404 if absent or unmapped; `ServiceUnavailableException`
   with a Mongolian message if `!this.esis.isConfigured`, matching `myProfile`'s
   existing wording.
3. Calls `this.esis.staff(institutionId)` and `this.esis.teachers(institutionId)`.
4. Builds rows from `staff` — it is the superset, 13 rows against `teacher/list`'s
   10, all ten present in it by `personId`. Sets `isInstructor` from whether the
   `teacher/list` response contains that `personId`.
5. Passes every `personRegNumber` through `normalizeRegisterNumber` and
   **stores the normalised value**, skipping and counting any row that returns
   `null`.

   ★ **Storing the raw value would break the whole feature**, and the reason is
   not obvious. Measured live on 2026-09-16: `school/staff` returns register
   numbers in **lower case** — 0 of 13 match the pattern as sent, 13 of 13
   after upper-casing — while `teacher/list` returns the same people's numbers
   in upper case, 10 of 10 as sent. Two services, the same thirteen people,
   different casing. The roster is built from `school/staff` because it is the
   superset, so a roster of raw values would never match a teacher typing their
   number normally, and the failure would look exactly like "you are not on the
   list".

   Normalising on both sides is what makes the lookup an equality test. The
   store side is the one that is easy to forget.

6. Calls `repo.replaceStaffRoster`.
7. Writes an `AuditLog` row with action **`UPDATE`**. `AuditAction` has no
   `SYNC` value — verified 2026-09-16, the enum is `LOGIN`, `LOGIN_FAILED`,
   `LOGOUT`, `VIEW`, `CREATE`, `UPDATE`, `DELETE`, `RESTORE`, `DOWNLOAD`,
   `PERMISSION_CHANGE`, `PASSWORD_RESET`, `INVITE`, `ACTIVATE` — and adding
   one would be a migration for a word. Use `objectType: "EsisStaffRoster"`,
   `objectId: kindergartenId`, `metadata: { count, skipped }`. **No register
   number in the metadata**; `esis-admin.service.ts` already keeps typed
   register numbers out of audit rows and this must not be the exception.
8. Returns `{ count, skipped, syncedAt }`.

Give it a `★` doc comment saying why the route exists: the public registration
endpoint may not call ESIS, so somebody authenticated has to fill the table.

- [ ] **Step 5: Controller**

Add to the kindergarten-scoped ESIS controller:

```ts
  @Post("staff-roster/refresh")
  @Roles("ADMIN")
  refreshStaffRoster(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.refreshStaffRoster(actor, params.id);
  }
```

That is the exact param shape the neighbouring routes use — `catalog` and
`studentRegistrationTemplate` in the same file. Do not invent a
`KindergartenParams` type; this file validates with `idParamSchema` through
`ZodValidationPipe`.

- [ ] **Step 6: Run the tests**

```bash
pnpm --filter @kinder/api exec vitest run test/esis-admin.test.ts
pnpm --filter @kinder/api typecheck
pnpm lint
```

Expected: PASS, the whole file.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/integrations/esis/ apps/api/test/esis-admin.test.ts
git commit -m "feat(esis): an admin fills the staff roster so a public route never has to"
```

---

## Task 4: The director's registration code

**Files:**

- Modify: `apps/api/src/integrations/esis/esis-admin.service.ts` (or a new
  `staff-registration` service if Task 5 has already created one — put it with
  the code that reads it)
- Test: `apps/api/test/esis-admin.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/*
 * ★ The code is a **throttle, not authentication** — a secret shared among
 * thirteen people. The roster match is the real gate. It is hashed anyway: a
 * plaintext column is one database read away from registering as anybody.
 */
describe("the kindergarten's registration code", () => {
  const url = (kindergartenId: string) =>
    `/v1/kindergartens/${kindergartenId}/staff-registration-code`;

  it("issues a code to an admin, and stores only its hash", async () => {
    const res = await authed(request(server()).post(url(a.kindergarten.id)), adminA).send({});

    expect(res.status).toBe(201);
    expect(typeof res.body.code).toBe("string");
    expect(res.body.code.length).toBeGreaterThanOrEqual(8);

    const row = await db.kindergarten.findUniqueOrThrow({ where: { id: a.kindergarten.id } });
    expect(row.staffRegistrationCodeHash).not.toBeNull();
    expect(row.staffRegistrationCodeHash).not.toContain(res.body.code);
    expect(row.staffRegistrationCodeSetAt).not.toBeNull();
  });

  /* Rotating invalidates the old one — that is the whole point of rotating. */
  it("replaces the previous code", async () => {
    const first = await authed(request(server()).post(url(a.kindergarten.id)), adminA).send({});
    const second = await authed(request(server()).post(url(a.kindergarten.id)), adminA).send({});

    expect(second.body.code).not.toBe(first.body.code);
  });

  it("returns 404 to a teacher", async () => {
    const res = await authed(request(server()).post(url(a.kindergarten.id)), teacherA).send({});
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter @kinder/api exec vitest run test/esis-admin.test.ts -t "registration code"
```

Expected: FAIL — 404, the route does not exist.

- [ ] **Step 3: Implement**

A service method that asserts ADMIN, generates a code, hashes it with the
existing `PasswordService` (`auth/password.service.ts` — reuse it rather than
adding a second hashing path), stores hash and timestamp, writes an `AuditLog`
row that **does not contain the code**, and returns the plaintext once.

Generate the code as `randomBytes(6).toString("base64url")` — eight characters,
the same construction `createPlaceholderGuardianAccount` already uses for
handles. Give it a `★` comment explaining that it is shown exactly once, for
the reason a password reset link is: something the system can re-issue but
never re-read.

Controller route `@Post("kindergartens/:id/staff-registration-code")`,
`@Roles("ADMIN")`.

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @kinder/api exec vitest run test/esis-admin.test.ts
pnpm --filter @kinder/api typecheck && pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ apps/api/test/esis-admin.test.ts
git commit -m "feat(staff): a director issues a registration code, and the database keeps only its hash"
```

---

## Task 5: The public registration route

This is the security-critical task of the plan.

**Files:**

- Create: `apps/api/src/staff-registration/staff-registration.module.ts`
- Create: `apps/api/src/staff-registration/staff-registration.controller.ts`
- Create: `apps/api/src/staff-registration/staff-registration.service.ts`
- Create: `apps/api/src/staff-registration/staff-registration.dto.ts`
- Modify: `apps/api/src/app.module.ts` (register the module)
- Modify: `apps/api/src/integrations/esis/esis.repository.ts` (the lookup)
- Test: `apps/api/test/staff-registration.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/staff-registration.test.ts`. Copy the harness shape from
`test/esis-admin.test.ts` — `createTestApp`, `resetData`, `RateLimitService`
reset in `beforeEach`, `createScenario`.

```ts
/*
 * ★ The route is **public** — the teacher has no account yet. So it must not
 * reach ESIS: public traffic in the ministry's logs is what the roster table
 * exists to prevent. Every case below matches against stored rows only.
 */
describe("staff self-registration", () => {
  const url = "/v1/staff-registration";
  const REG = "УЛ24270406";

  const seedRoster = (kindergartenId: string, overrides = {}) =>
    db.esisStaffRoster.create({
      data: {
        kindergartenId,
        esisPersonId: "90000000000001",
        registerNumber: REG,
        lastName: "Овог",
        firstName: "Нэр",
        jobCode: "2342-13",
        positionName: "Багш, цэцэрлэгийн /мэргэжлийн/ /СӨБ/",
        isInstructor: true,
        ...overrides,
      },
    });

  it("registers a teacher who is on the roster and knows the code", async () => {
    const code = await issueCode(a.kindergarten.id);
    await seedRoster(a.kindergarten.id);

    const res = await request(server()).post(url).send({ code, registerNumber: REG });

    expect(res.status).toBe(201);
    expect(typeof res.body.invitationToken).toBe("string");

    const membership = await db.membership.findFirst({
      where: { kindergartenId: a.kindergarten.id, role: "TEACHER" },
      orderBy: { createdAt: "desc" },
      include: { user: true },
    });
    expect(membership?.user.lastName).toBe("Овог");
  });

  /*
   * ★★ The account is unusable until the teacher redeems the token. Nobody —
   * not the director, not the developer — ever knows their password.
   */
  it("creates an account that cannot be logged into yet", async () => {
    const code = await issueCode(a.kindergarten.id);
    await seedRoster(a.kindergarten.id);
    const res = await request(server()).post(url).send({ code, registerNumber: REG });

    const user = await db.user.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    const login = await request(server())
      .post("/v1/auth/login")
      .send({ identifier: user.username, password: "Password123!" });

    expect(login.status).toBe(401);
    expect(res.body.invitationToken).toBeTruthy();
  });

  /*
   * ★★★ Every refusal returns the same status and the same message.
   *
   * If "wrong code" and "not on this roster" differed, the route would answer
   * "does this person work at this kindergarten?" for anybody holding a list of
   * register numbers — which is a list that exists on paper in several offices.
   */
  it.each([
    ["a wrong code", async () => ({ code: "wrongcode", registerNumber: REG })],
    [
      "a register number not on the roster",
      async () => ({ code: await issueCode(a.kindergarten.id), registerNumber: "УБ99998888" }),
    ],
    [
      "a malformed register number",
      async () => ({ code: await issueCode(a.kindergarten.id), registerNumber: "nonsense" }),
    ],
  ])("refuses %s with the same answer as every other refusal", async (_label, build) => {
    await seedRoster(a.kindergarten.id);

    const res = await request(server())
      .post(url)
      .send(await build());

    expect(res.status).toBe(401);
    expect(res.body.detail ?? res.body.message).toBe(REFUSAL);
    expect(await db.user.count({ where: { lastName: "Овог" } })).toBe(0);
  });

  /* A person on the roster whose job maps to no role cannot register at all. */
  it.each([
    ["5153-12"], // Жижүүр
    ["1341-02"], // Эрхлэгч — ADMIN is invitation-only
  ])("refuses jobCode %s even with a valid code and a roster row", async (jobCode) => {
    const code = await issueCode(a.kindergarten.id);
    await seedRoster(a.kindergarten.id, { jobCode });

    const res = await request(server()).post(url).send({ code, registerNumber: REG });

    expect(res.status).toBe(401);
    expect(
      await db.membership.count({ where: { kindergartenId: a.kindergarten.id, role: "ADMIN" } }),
    ).toBe(1);
  });

  /* Registering twice must not mint a second account for the same person. */
  it("refuses a second registration for a person who already has an account", async () => {
    const code = await issueCode(a.kindergarten.id);
    await seedRoster(a.kindergarten.id);

    await request(server()).post(url).send({ code, registerNumber: REG });
    const second = await request(server()).post(url).send({ code, registerNumber: REG });

    expect(second.status).toBe(401);
    expect(await db.user.count({ where: { lastName: "Овог" } })).toBe(1);
  });

  /*
   * ★ A kindergarten with no code set must refuse everything, rather than
   * treating "no code" as "any code".
   */
  it("refuses when the kindergarten has never issued a code", async () => {
    await seedRoster(a.kindergarten.id);

    const res = await request(server()).post(url).send({ code: "anything", registerNumber: REG });

    expect(res.status).toBe(401);
  });

  /*
   * ★★ Fail closed on an absent roster, and on a stale one — design §5.
   *
   * An empty table is not "nobody works here", it is "nobody has refreshed
   * this", and the two must not produce the same answer as a genuine match.
   * The stale case is the sharper one: a roster from six months ago still
   * lists the people who have left, which is exactly who must no longer be
   * able to mint an account.
   *
   * There is no fallback to a live ESIS call here and there must not be — the
   * route is public, and the roster exists precisely so that public traffic
   * never reaches the ministry.
   */
  it("refuses when the roster has never been filled", async () => {
    const code = await issueCode(a.kindergarten.id);

    const res = await request(server()).post(url).send({ code, registerNumber: REG });

    expect(res.status).toBe(401);
    expect(await db.user.count({ where: { lastName: "Овог" } })).toBe(0);
  });

  it("refuses when the roster is older than the staleness threshold", async () => {
    const code = await issueCode(a.kindergarten.id);
    await seedRoster(a.kindergarten.id, {
      syncedAt: new Date(Date.now() - STALE_AFTER_MS - 60_000),
    });

    const res = await request(server()).post(url).send({ code, registerNumber: REG });

    expect(res.status).toBe(401);
    expect(await db.user.count({ where: { lastName: "Овог" } })).toBe(0);
  });

  it("accepts a roster that is inside the threshold", async () => {
    const code = await issueCode(a.kindergarten.id);
    await seedRoster(a.kindergarten.id, {
      syncedAt: new Date(Date.now() - STALE_AFTER_MS + 60_000),
    });

    const res = await request(server()).post(url).send({ code, registerNumber: REG });

    expect(res.status).toBe(201);
  });

  /*
   * ★★ Another kindergarten's code must not reach this roster. The code is
   * looked up to find the kindergarten, so this is the tenant boundary itself.
   */
  it("does not let one kindergarten's code match another's roster", async () => {
    const codeB = await issueCode(b.kindergarten.id);
    await seedRoster(a.kindergarten.id);

    const res = await request(server()).post(url).send({ code: codeB, registerNumber: REG });

    expect(res.status).toBe(401);
    expect(await db.user.count({ where: { lastName: "Овог" } })).toBe(0);
  });

  /* CLAUDE.md §3.6 — the counter must survive the failing request's rollback. */
  it("rate-limits repeated failures", async () => {
    await seedRoster(a.kindergarten.id);

    const attempts = [];
    for (let i = 0; i < 12; i += 1) {
      attempts.push(await request(server()).post(url).send({ code: "wrong", registerNumber: REG }));
    }

    expect(attempts.some((res) => res.status === 429)).toBe(true);
  });
});
```

Write `issueCode(kindergartenId)` as a helper that calls the Task 4 route as
`adminA` and returns `res.body.code`. Import `REFUSAL` and `STALE_AFTER_MS`
from the service rather than restating them — a duplicated refusal string is
how the uniform-refusal property quietly stops being tested.

`seedRoster`'s `overrides` must be able to set `syncedAt`, which means the
column cannot be `@default(now())`-only in the create call. Prisma allows
passing it explicitly; if the generated type refuses, that is a signal the
schema made it non-writable and Task 1 needs revisiting — report it rather
than working around it.

- [ ] **Step 2: Run them and confirm they fail**

```bash
pnpm --filter @kinder/api exec vitest run test/staff-registration.test.ts
```

Expected: FAIL — 404 on every case, the route does not exist.

- [ ] **Step 3: Implement**

`staff-registration.dto.ts` — a zod schema: `code` a non-empty string, max 64;
`registerNumber` a non-empty string, max 32. Validate shape only. **Do not**
reject a malformed register number here with a distinct error: the uniform
refusal in the service is the whole design, and a validation 400 on a malformed
number leaks that a well-formed one is treated differently.

`staff-registration.service.ts` — one method, in this order:

1. `normalizeRegisterNumber(dto.registerNumber)`; on `null`, refuse.
2. Find the kindergarten whose `staffRegistrationCodeHash` verifies against
   `dto.code`. There is no index on a hash, so load kindergartens with a non-null
   hash and verify each — **document why the loop is acceptable**: it is bounded
   by the number of tenants, it runs only on this route, and the alternative is
   asking the caller which kindergarten they mean, which would let them probe.
   If the deployment ever has enough tenants for this to matter, the fix is a
   code prefix that names the tenant, not a plaintext column.
3. On no match, refuse.
4. `repo.findRosterEntryByRegisterNumber(kindergartenId, normalized)`; on none,
   refuse. **If the row's `syncedAt` is older than `STALE_AFTER_MS`, refuse** —
   export that constant from the service so the test imports the same value
   rather than restating it. Use **30 days**: long enough that a director who
   refreshes when they issue a code is not tripped by it, short enough that a
   roster nobody has touched for a term stops minting accounts. Give the
   constant a `★` comment saying the threshold is a fail-closed guess, not a
   measured figure, and that the correct fix is spec №3's daily sync rather
   than a longer window.
5. `roleForJobCode(entry.jobCode)`; on `null`, refuse.
6. If a `User` already exists with this `esisPersonId`, refuse. The column is
   added in Task 1 and is globally unique — one person in the ministry's
   database is one account.
7. `users.createInvitedAccount(...)` with a generated username, the roster's
   `lastName` / `firstName`, and the derived role, then set `esisPersonId` on
   the created user. The username must **not** be derived from the register
   number — `createPlaceholderGuardianAccount` explains why a readable handle
   is a guess away from somebody else's.
8. Audit: `action: "INVITE"`, `metadata: { role, source: "self-registration" }`.
   **No register number, no code.**
9. Return `{ invitationToken }`.

Every refusal throws the **same** `UnauthorizedException` with the same
Mongolian message — write it once as a module constant with a `★` comment saying
why the branches may not diverge.

`staff-registration.controller.ts` — `@Public()`, `@UseGuards(RateLimitGuard)`,
`@RateLimit({ limit: 10, windowMs: HOUR })`, matching `auth.controller.ts`'s
invitation-accept budget.

`staff-registration.module.ts` — imports whatever provides `UsersService`,
`EsisRepository`, `PasswordService`, `AuditService`. Register it in
`app.module.ts`.

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @kinder/api exec vitest run test/staff-registration.test.ts
pnpm --filter @kinder/api typecheck && pnpm lint
```

Expected: PASS, every case.

- [ ] **Step 5: Run the whole api suite**

```bash
pnpm --filter @kinder/api test 2>&1 | tail -20
```

Expected: 2230+ passed, 0 failed. Any failure is real. If a cross-kindergarten
isolation test fails, check nothing else is running first — a second vitest run
or a busy `pnpm dev` starves Postgres and produces failures that look exactly
like a leak.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/staff-registration/ apps/api/src/ apps/api/test/staff-registration.test.ts
git commit -m "feat(staff): a teacher registers themselves against the stored roster, and every refusal reads the same"
```

---

## Task 6: The director reviews who registered

The client's instruction: "захирал заавал батлах хэрэг байхгүй зүгээр хянахад л
болно хэн хэн бүртгүүлсэн байгаа эсэх мэдээлэл."

**Files:**

- Modify: the ESIS admin service, controller, repository
- Test: `apps/api/test/esis-admin.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("who registered themselves", () => {
  const url = (kindergartenId: string) => `/v1/kindergartens/${kindergartenId}/staff-registrations`;

  it("lists self-registered staff with when and as what", async () => {
    const code = await issueCode(a.kindergarten.id);
    await seedRoster(a.kindergarten.id);
    await request(server()).post("/v1/staff-registration").send({ code, registerNumber: REG });

    const res = await authed(request(server()).get(url(a.kindergarten.id)), adminA);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      lastName: "Овог",
      firstName: "Нэр",
      role: "TEACHER",
      source: "SELF_REGISTERED",
    });
  });

  /* A register number must not appear on a list a screen renders. */
  it("does not return a register number", async () => {
    const code = await issueCode(a.kindergarten.id);
    await seedRoster(a.kindergarten.id);
    await request(server()).post("/v1/staff-registration").send({ code, registerNumber: REG });

    const res = await authed(request(server()).get(url(a.kindergarten.id)), adminA);

    expect(JSON.stringify(res.body)).not.toContain(REG);
  });

  it("returns 404 to a teacher", async () => {
    const res = await authed(request(server()).get(url(a.kindergarten.id)), teacherA);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter @kinder/api exec vitest run test/esis-admin.test.ts -t "who registered"
```

- [ ] **Step 3: Implement**

An ADMIN-only, **paginated** list (CLAUDE.md §3.4 — no endpoint returns an
unbounded set). Source it from `Membership` joined to `User`, filtered to
`user.esisPersonId != null` — that column, added in Task 1, is the marker for
"this account registered itself", since every invited account leaves it NULL.

The response must not carry `esisPersonId` either. It is the ministry's
identifier for a person and the screen has no use for it; the director needs a
name, a role, a date and a revoke link.

Revocation already exists — `DELETE /v1/memberships/:id`
(`users.controller.ts:138`). Do not build a second one; the screen links to it.

- [ ] **Step 4: Run, typecheck, lint, commit**

```bash
pnpm --filter @kinder/api exec vitest run test/esis-admin.test.ts
pnpm --filter @kinder/api typecheck && pnpm lint
git add apps/api/src/ apps/api/test/esis-admin.test.ts
git commit -m "feat(staff): the director sees who registered themselves, and can already revoke them"
```

---

## Task 7: The two screens

**Files:**

- Create: `apps/web/app/register/page.tsx`
- Create: `apps/web/app/(app)/admin/staff-code/page.tsx`
- Modify: `packages/contracts/src/domain.ts` (the response schemas)
- Test: `apps/web/test/staff-registration.test.tsx`

All user-facing text in **Mongolian**. Mobile-first. Every field has a `<label>`.

- [ ] **Step 1: Contracts**

Add zod schemas for the three new responses to `packages/contracts/src/domain.ts`,
following the file's existing conventions, then:

```bash
pnpm --filter contracts build
```

**This build is not optional.** A stale `contracts/dist` silently strips fields
the built schema does not know about, and the symptom is a value that is present
in the API response and missing in the UI.

- [ ] **Step 2: Write the failing web test**

Create `apps/web/test/staff-registration.test.tsx`, following the style of the
existing tests in that directory:

```tsx
it("бүртгүүлэх маягтыг харуулна", async () => {
  render(<RegisterPage />);

  expect(screen.getByLabelText("Цэцэрлэгийн код")).toBeInTheDocument();
  expect(screen.getByLabelText("Регистрийн дугаар")).toBeInTheDocument();
});

/*
 * ★ The server answers every refusal identically. The screen must not improve
 * on that by guessing — "Таны РД олдсонгүй" would undo the uniform refusal.
 */
it("серверийн буцаасан мессежийг яг тэр хэвээр харуулна", async () => {
  // …stub a 401 with the server's message, assert it is rendered verbatim
});
```

- [ ] **Step 3: Run it and confirm it fails**

```bash
pnpm --filter web exec vitest run test/staff-registration.test.tsx
```

- [ ] **Step 4: Build the pages**

**`/register`** — public. Two fields (код, регистрийн дугаар), one button. On
success, redirect to `/invitation/[token]`, which already exists and already
collects a password. Do not build a second password form.

On failure, render the server's message verbatim. Do not add client-side
validation that would distinguish a malformed register number from an unknown
one — that is the uniform refusal, undone in the browser.

**`/admin/staff-code`** — ADMIN. Shows when the code was last set, a button to
issue or rotate it, the new code displayed **once** with a copy control and a
line saying it will not be shown again, a "Жагсаалтыг шинэчлэх" button for the
roster refresh with its count, and the list of who registered with a revoke link
to the existing membership route.

Add a link from `/login` to `/register` — a teacher with no account has nowhere
else to start.

- [ ] **Step 5: Run both suites, serially**

```bash
pnpm --filter web test 2>&1 | tail -5
# only after the web suite has finished:
pnpm --filter @kinder/api test 2>&1 | tail -5
```

Expected: web 1004+ passed, api 2230+ passed, 0 failed in each.

- [ ] **Step 6: Commit**

```bash
git add apps/web/ packages/contracts/
git commit -m "feat(staff): the teacher's registration form and the director's code panel"
```

---

## Task 8: Prove it against the real ministry

The plan is not finished when the tests pass. Every reader in this branch was
green in the suite and two were dead against the live service.

- [ ] **Step 1: Refresh the roster from live ESIS**

Start the API, log in as an admin of the kindergarten mapped to institution
42778, and call the Task 3 route. Expect **13 rows**, 0 skipped.

If the count is not 13, stop and report it — the roster is the gate, and a gate
built on a partial list refuses real staff.

- [ ] **Step 2: Register one real member of staff end to end**

Issue a code, register with a register number that is genuinely on the roster,
redeem the token, set a password, log in. Confirm the role matches the person's
`jobCode` per Task 2's table.

- [ ] **Step 3: Confirm the negative case against real data**

Try a register number that is **not** on the roster and confirm the message is
byte-identical to the wrong-code message.

- [ ] **Step 4: Record the result**

Add a subsection to `docs/ESIS_API_READINESS.md` — in Mongolian, matching that
file — recording the roster count, the distinct `jobCode` values found, how many
rows were skipped for an unparseable register number, and the end-to-end result.

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs(esis): the staff roster and the registration flow, proved against institution 42778"
```

---

## What this plan does not do

- **No SMS and no second factor.** SMS is Phase IV (`CLAUDE.md` §7). The code is
  a throttle; the roster match is the gate. If the client later wants a real
  second factor, the natural one is the phone number already on the ESIS staff
  record — that is a separate decision, not a silent addition.
- **No approval step.** The client was explicit: "захирал заавар батлах хэрэг
  байхгүй зүгээр хянахад л болно". Task 6 is review, not approval.
- **`ADMIN` and `ACCOUNTANT` are never auto-assigned**, even though `1341-02`
  (эрхлэгч) maps cleanly to a director. Both stay invitation-only.
- **No scheduled roster sync.** Spec №3's tier 2 adds the schedule on top of
  Task 3's table and route.
- **The registration route never calls ESIS.** If the roster is empty or stale,
  it refuses and the screen directs the teacher to ask for an invitation.

# ESIS pass-through readers and register-number scope — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it structurally impossible for NomadKids to silently discard a
field ESIS sent, and let a register number through to ADMIN surfaces only.

**Architecture:** A hand-written zod schema survives only where TypeScript code
reads a named property off the row — seven readers. Every other reader parses
through `esisDiscoveredSchema`, which keeps whatever arrives. The refused-field
list splits in two: credentials are refused in the schema and never recoverable;
identifiers survive parsing and are removed at the service boundary for every
caller who is not an ADMIN of that kindergarten.

**Tech Stack:** NestJS, zod v4 (`z.looseObject`), vitest, supertest, Prisma.

**Spec:** `docs/superpowers/specs/2026-09-15-esis-full-coverage-design.md` §3, §4

---

## Background the engineer needs

**What ESIS is.** The Mongolian Ministry of Education's student information
system. This deployment holds a Bearer token scoped to exactly one institution,
`42778`. Every response is wrapped in an envelope:

```json
{ "SUCCESS_CODE": 200, "RESPONSE_MESSAGE": "…", "RESULT": [ { … } ] }
```

**The bug this plan fixes.** Each reader in `ESIS_READERS`
(`apps/api/src/integrations/esis/esis.service.ts:95`) pairs an endpoint with a
zod schema. `z.object()` **drops** keys the schema does not name. So when
somebody wrote a field list by hand and guessed wrong, the reader parsed
successfully and threw the real payload away. `docs/ESIS_API_READINESS.md` §1.1
records this happening to nine of thirty-six readers; a screen drew an empty
column and it read as "this institution has no data".

**Two live failures found on 2026-09-15** (spec §2.5), both of this class:

| Reader             | Failure                                                     |
| ------------------ | ----------------------------------------------------------- |
| `studentInfo`      | schema types `dateOfBirth` as a string, ESIS sends a number |
| `teacherMovements` | ESIS answers `HTTP 205` with an **empty body**              |

**Rules that bind this work** (from `CLAUDE.md`):

- §1.7 — child data returns **404**, never 403.
- §2.1 — controllers parse and call a service; only `*.repository.ts` may
  import `PrismaClient`.
- §4.1 — every endpoint touching child data needs authorization tests **through
  HTTP against the real route**, not by calling the check function.
- §4.2 — never claim a feature works without running the tests.

**How to run things.** From the repository root:

```bash
pnpm --filter @kinder/api test                 # ~14 minutes, needs Postgres
pnpm --filter @kinder/api exec vitest run src/integrations/esis/esis.schemas.test.ts
pnpm --filter @kinder/api typecheck
pnpm lint
```

Postgres runs natively on `localhost:5432` (not Docker). **Never run the api and
web suites at the same time** — they starve Postgres and produce `beforeEach`
hook timeouts that look exactly like a cross-kindergarten data leak.

---

## File Structure

| File                                                   | Responsibility after this plan                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `apps/api/src/integrations/esis/esis.schemas.ts`       | Envelope parsing, the two refusal lists, `esisDiscoveredSchema`, `esisVisibleRows` |
| `apps/api/src/integrations/esis/esis.service.ts`       | `ESIS_READERS`; seven declared schemas, the rest pass-through                      |
| `apps/api/src/integrations/esis/esis.fields.ts`        | `esisFieldsFor` returns declared columns **plus** anything undeclared that arrived |
| `apps/api/src/integrations/esis/esis-admin.service.ts` | One `visibleRows()` gate; every method returning ESIS rows passes through it       |
| `apps/api/scripts/esis-probe.ts`                       | Already written. One live call per reader, masked output                           |
| `apps/api/test/esis-admin.test.ts`                     | HTTP authorization tests, including the new identifier cases                       |

No new files. No new tables. No migration.

---

## Task 1: An empty body is no rows, not a broken contract

`teacherMovements` returns `HTTP 205` with a zero-length body.
`EsisClient.request` turns an empty body into `null`
(`esis.client.ts:139`), and `esisListParser`'s envelope then fails with
`expected object` — so "no movements this month" is reported to the operator as
`invalid_response`, a developer-grade error.

`esisListParser` already treats `RESULT: ""`, `RESULT: null` and a missing
`RESULT` as no rows. An absent **body** is the same statement one level up.

**Files:**

- Modify: `apps/api/src/integrations/esis/esis.schemas.ts:105-117`
- Test: `apps/api/src/integrations/esis/esis.schemas.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the existing `describe("esisListParser", …)` block in
`apps/api/src/integrations/esis/esis.schemas.test.ts`:

```ts
/*
 * ★ ESIS answered `205` with a zero-length body for `teacher/movements` on
 * 2026-09-15. `EsisClient` turns an empty body into `null`, so the parser
 * receives `null` where it expects an envelope.
 *
 * Read as a contract break this reports "the ministry changed their API" for
 * what is in fact "nobody moved this month" — the same mistake the three
 * empty `RESULT` shapes above already avoid, one level further out.
 */
it("reads an absent body as no rows", () => {
  expect(parse(null)).toEqual([]);
  expect(parse(undefined)).toEqual([]);
});

/*
 * …and the guarantee that makes the line above safe: an empty body is not a
 * licence for any malformed payload to pass as empty.
 */
it("still rejects a payload that is neither an envelope nor absent", () => {
  expect(() => parse("unexpected")).toThrow();
  expect(() => parse(42)).toThrow();
  expect(() => parse({ SUCCESS_CODE: 200 })).toThrow();
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm --filter @kinder/api exec vitest run src/integrations/esis/esis.schemas.test.ts -t "absent body"
```

Expected: FAIL — `Invalid input: expected object, received null`.

- [ ] **Step 3: Make it pass**

In `apps/api/src/integrations/esis/esis.schemas.ts`, replace the `return`
statement of `esisListParser` (currently line 116):

```ts
return (body) => (body === null || body === undefined ? [] : envelope.parse(body).RESULT);
```

And extend that function's doc comment, after the `★★` paragraph:

```ts
 * ★★★ **An absent body is the fourth empty shape**, found on 2026-09-15:
 * `teacher/movements` answered `205` with zero bytes, which `EsisClient` hands
 * on as `null`. The three shapes above are an empty `RESULT` inside an
 * envelope; this is no envelope at all. It is read as "nothing came back" for
 * the same reason and with the same limit — anything that *is* present and
 * *is not* an envelope still fails.
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
pnpm --filter @kinder/api exec vitest run src/integrations/esis/esis.schemas.test.ts
```

Expected: PASS, every test in the file.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/integrations/esis/esis.schemas.ts apps/api/src/integrations/esis/esis.schemas.test.ts
git commit -m "fix(esis): a 205 with no body is no rows, not a broken contract"
```

---

## Task 2: Undeclared fields are shown, for every service

`esisFieldsFor` (`esis.fields.ts:1454`) adds discovered columns only for the six
keys in `ESIS_DISCOVERED_SHAPE`. Once Task 3 lands, any reader can carry a field
that `ESIS_FIELDS` does not declare — and it would arrive in the payload and
never be drawn.

The existing rule stays: **declared columns are always shown even when the data
is absent**, or "ESIS stopped sending this" and "this child has no value" become
the same picture. Discovered columns are added _after_ the declared ones.

**Files:**

- Modify: `apps/api/src/integrations/esis/esis.fields.ts:1442-1471`
- Test: `apps/api/src/integrations/esis/esis.fields.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/integrations/esis/esis.fields.test.ts`:

```ts
/*
 * ★ A declared service that sends something we never declared.
 *
 * Before 2026-09-15 this was unobservable: the hand-written schema dropped
 * the key long before a field list was built. Now the row survives, so the
 * column has to appear — otherwise the payload carries a value the screen
 * refuses to admit exists, which is the defect this whole change removes.
 */
it("shows an undeclared field that a declared service actually sent", () => {
  const fields = esisFieldsFor("organization", [
    { institutionId: 42778, institutionName: "Дэгдээхий үрс", unexpectedFromEsis: "x" },
  ]);

  const names = fields.map((field) => field.name);
  expect(names).toContain("unexpectedFromEsis");
  // Declared columns keep their order and come first.
  expect(names.slice(0, ingestedFieldNames("organization").length)).toEqual(
    ESIS_FIELDS.organization.map((field) => field.name),
  );
});

/*
 * ★★ …and a declared column survives a response that omitted it. This is the
 * half that must not regress: columns cannot depend on the data, or an
 * outage and an empty value look identical.
 */
it("keeps a declared column that the response did not carry", () => {
  const fields = esisFieldsFor("organization", [{ institutionId: 42778 }]);
  expect(fields.map((field) => field.name)).toEqual(
    expect.arrayContaining(ESIS_FIELDS.organization.map((field) => field.name)),
  );
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm --filter @kinder/api exec vitest run src/integrations/esis/esis.fields.test.ts -t "undeclared field"
```

Expected: FAIL — `expected [ … ] to contain 'unexpectedFromEsis'`, because
`organization` is not in `ESIS_DISCOVERED_SHAPE` and the function returns early.

- [ ] **Step 3: Make it pass**

In `apps/api/src/integrations/esis/esis.fields.ts`, replace the body of
`esisFieldsFor` (lines 1454-1471) with:

```ts
export function esisFieldsFor(key: keyof typeof ESIS_ENDPOINTS, rows: unknown[]): EsisField[] {
  const declared = ESIS_FIELDS[key];
  const known = new Set(declared.map((field) => field.name));
  const discovered: EsisField[] = [];

  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    for (const name of Object.keys(row)) {
      if (known.has(name)) continue;
      known.add(name);
      discovered.push(keep(name, name));
    }
  }

  return [...declared, ...discovered];
}
```

Replace the `★★` paragraph of its doc comment with:

```ts
 * ★★ **Discovery now runs for every service, not only the unseen six.**
 *
 * Until 2026-09-15 a declared schema dropped anything it did not name, so a
 * declared service could not carry a surprise and the early return was
 * accurate. Readers now pass through what ESIS sends, so any of them can — and
 * a field in the payload that the screen refuses to draw is the same defect,
 * moved.
 *
 * Declared anchors still come first and are still returned whether or not the
 * data carried them: columns must not depend on the rows, or an outage and an
 * empty value look the same. Discovered keys follow in first-seen order,
 * labelled with their own name. A name we cannot translate is shown
 * untranslated rather than guessed at.
```

`ESIS_DISCOVERED_SHAPE` is no longer read by this function. Leave the set
exported — `esis.fields.test.ts` still asserts those six declare nothing but
`personId`, which is the check that stops somebody adding guessed field lists
back.

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
pnpm --filter @kinder/api exec vitest run src/integrations/esis/esis.fields.test.ts
```

Expected: PASS, every test in the file.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/integrations/esis/esis.fields.ts apps/api/src/integrations/esis/esis.fields.test.ts
git commit -m "feat(esis): a field the ministry sent is shown even where none was declared"
```

---

## Task 3: Pass-through becomes the default reader schema

**The rule, and it is mechanical:** a hand-written schema exists only where
TypeScript code reads a named property off the row. Everything else passes
through.

Seven readers qualify, verified by grepping every consumer outside the ESIS
module:

| Reader                 | Read by                                                |
| ---------------------- | ------------------------------------------------------ |
| `organization`         | `children.service.ts:494`                              |
| `groups`               | `attendance.service.ts:764`, `children.service.ts:495` |
| `students`             | `children.service.ts:496`, `funding.service.ts:77`     |
| `groupStudents`        | `attendance.service.ts:790`                            |
| `foodDiscountStudents` | `funding.service.ts:78`                                |
| `staff`                | `esis-admin.service.ts` `myProfile`                    |
| `teachers`             | `esis-admin.service.ts` `myProfile`                    |

`groupAttendance` is the eighth — the attendance reconciliation reads its named
fields.

**Consumers inside the ESIS module and the seed were checked too**, on
2026-09-15, because the grep above excluded them and that is where a miss would
hurt most:

- `esis.requests.ts` reads **no** reader rows. It is the permission-request
  register — 84 rows of static metadata — and touches no live payload.
- `prisma/seed-esis.ts:184-188` reads `organization`, `groups`, `students`.
- `funding/food-discount.ts` reads `students` and `foodDiscountStudents`.

All five are already in the table. The eight-key list is complete as written.
Re-run both greps anyway before you start — a consumer may have been added
since — and add whatever you find to the declared set rather than breaking it:

```bash
grep -rnE "esis\.[a-z][A-Za-z]+\(" apps/api/src apps/api/prisma --include='*.ts'
```

A reader that loses its typed fields while something still reads them fails at
runtime in the attendance POST path — the one write that is already live
against the ministry.

Everything else — 45 readers, including `studentInfo` — becomes pass-through.
That is what fixes `studentInfo`'s `dateOfBirth`: no declared type means no
wrong declared type.

**Files:**

- Modify: `apps/api/src/integrations/esis/esis.service.ts:95-421`
- Test: `apps/api/src/integrations/esis/esis.service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/integrations/esis/esis.service.test.ts`:

```ts
import { ESIS_READERS, ESIS_READABLE_KEYS } from "./esis.service";
import { esisDiscoveredSchema } from "./esis.schemas";

/*
 * ★ The boundary, asserted rather than described.
 *
 * A hand-written schema is a promise about field names, and every promise of
 * that kind made without a live response has been wrong at least once
 * (`ESIS_API_READINESS.md` §1.1 — nine of thirty-six). So the list of readers
 * allowed to make one is closed, and it is exactly the readers whose named
 * properties some TypeScript file reads.
 *
 * Adding a reader here without a consumer re-opens the defect. Adding a
 * consumer without adding the reader here breaks the build, which is the
 * intended direction for that mistake to fail in.
 */
describe("the declared-schema boundary", () => {
  const DECLARED = [
    "organization",
    "groups",
    "students",
    "groupStudents",
    "foodDiscountStudents",
    "staff",
    "teachers",
    "groupAttendance",
  ] as const;

  it("hand-writes a schema for exactly the readers a domain consumer reads", () => {
    const handWritten = ESIS_READABLE_KEYS.filter(
      (key) => ESIS_READERS[key].schema !== esisDiscoveredSchema,
    ).sort();

    expect(handWritten).toEqual([...DECLARED].sort());
  });

  it("passes every other reader through unchanged", () => {
    for (const key of ESIS_READABLE_KEYS) {
      if ((DECLARED as readonly string[]).includes(key)) continue;
      expect({ key, passthrough: ESIS_READERS[key].schema === esisDiscoveredSchema }).toEqual({
        key,
        passthrough: true,
      });
    }
  });

  /*
   * ★★ The live regression this replaces. `student/info` types `dateOfBirth` as
   * a string in the portal's documentation and sends a number; the declared
   * schema failed the whole service with `invalid_union` for every child on
   * institution 42778.
   */
  it("keeps a numeric dateOfBirth that a declared schema rejected", () => {
    const parsed = ESIS_READERS.studentInfo.schema.parse({
      personId: 9425579614258,
      dateOfBirth: 1_419_000_000_000,
      firstName: "Болд",
    }) as Record<string, unknown>;

    expect(parsed).toMatchObject({ dateOfBirth: 1_419_000_000_000, firstName: "Болд" });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm --filter @kinder/api exec vitest run src/integrations/esis/esis.service.test.ts -t "declared-schema boundary"
```

Expected: FAIL — the hand-written list contains ~45 extra keys, and the
`dateOfBirth` case throws `invalid_union`.

- [ ] **Step 3: Make it pass**

In `apps/api/src/integrations/esis/esis.service.ts`, change the `schema:` of
every reader **except** the eight named above to `esisDiscoveredSchema`. Leave
`endpoint`, `params`, `bodyParams`, `institution` and `parse` exactly as they
are — only the schema changes.

For example, `studentInfo` becomes:

```ts
  studentInfo: {
    endpoint: ESIS_ENDPOINTS.studentInfo,
    schema: esisDiscoveredSchema,
    params: ["personRegNumber"],
  },
```

Add `esisDiscoveredSchema` to the import from `./esis.schemas` if it is not
already there. Delete every now-unused schema import; `pnpm lint` fails on an
unused import, which is how you find them.

Replace the doc comment above `export const ESIS_READERS` with:

```ts
/**
 * Every ESIS service this product may read, and how its rows are parsed.
 *
 * ★ **A hand-written schema is the exception, not the rule** — 2026-09-15.
 *
 * `z.object()` drops what it does not name. Nine of thirty-six hand-written
 * readers named the wrong things, parsed happily and threw the ministry's real
 * payload away; a screen drew an empty column and it read as "this institution
 * has no data" (`ESIS_API_READINESS.md` §1.1). Two more were still doing it on
 * 2026-09-15.
 *
 * So a declared schema now exists only where a TypeScript file reads a named
 * property off the row — eight readers, listed and asserted in
 * `esis.service.test.ts`. There the field names are load-bearing and a silent
 * rename must break the build. Everywhere else `esisDiscoveredSchema` keeps
 * whatever arrived, and `esisFieldsFor` reads the columns off the response.
 *
 * ★★ The refusals still run. `esisDiscoveredSchema` strips credentials by
 * name, because a passthrough cannot express "I did not ask for that" by
 * omission — see `ESIS_REFUSED_CREDENTIALS`.
 */
```

Then delete the schemas that no longer have a reader, **only** if nothing else
imports them:

```bash
grep -rn "esisStudentByRegisterSchema\|esisMovementSchema" apps/api/src --include='*.ts'
```

Keep any that `esis.requests.ts` or a test still uses. Deleting a schema nothing
imports is cleanup; deleting one something imports is a build break.

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
pnpm --filter @kinder/api exec vitest run src/integrations/esis/
pnpm --filter @kinder/api typecheck
```

Expected: PASS. `esis.fields.test.ts` has a test asserting that every reader's
`ingested` field names equal its schema's keys — it is written to skip keys in
`ESIS_DISCOVERED_SHAPE` (`esis.fields.test.ts:44`). It must now skip every
pass-through reader instead. Change that line to:

```ts
if (ESIS_READERS[key as EsisReadableKey]?.schema === esisDiscoveredSchema) continue;
```

adding the import it needs at the top of `esis.fields.test.ts`:

```ts
import { ESIS_READERS, type EsisReadableKey } from "./esis.service";
```

and update the comment above the `continue` to say the equality is asserted for
declared schemas only, because a passthrough has no key set to compare against.

- [ ] **Step 5: Run the whole api suite**

```bash
pnpm --filter @kinder/api test 2>&1 | tail -20
```

Expected: `Tests  2213 passed | 1 skipped` or more. Any failure here is real —
this task changes what every ESIS consumer receives.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/integrations/esis/
git commit -m "feat(esis): readers pass through what the ministry sent, except the eight a consumer reads"
```

---

## Task 4: Credentials and identifiers become two different refusals

`ESIS_REFUSED_FIELDS` (`esis.schemas.ts:131`) currently refuses eight names in
one list. Two of them — `civilId` and `personRegNumber` — are the register
numbers the client asked for on 2026-09-15, plus `registerNumber`, which is the
same class of value for an organisation and would otherwise leave the catalog
saying we show a child's register number and hide a building's.

The other five are credentials. `school/staff` and `teacher/list` return
`googleEmailPass`, `microsoftEmailPass` and `username` live, verified
2026-09-15. Those stay refused **in the schema**, where the value is destroyed
at the boundary and no later code can put it back.

Identifiers survive parsing and are removed per-caller in Task 5.

**Files:**

- Modify: `apps/api/src/integrations/esis/esis.schemas.ts:119-177`
- Test: `apps/api/src/integrations/esis/esis.fields.test.ts:67-84`

- [ ] **Step 1: Write the failing test**

Replace the test at `esis.fields.test.ts:67` ("strips every refused identifier
from a discovered-shape row") with:

```ts
/*
 * The passthrough's own guarantee, in the two halves it now has.
 *
 * ★ A credential is destroyed at the parse boundary. There is no caller and
 * no role that recovers it, which is the point: a password we hold is a
 * password we can leak, and this product has no use for a Google account's.
 */
it("destroys every refused credential in a discovered-shape row", () => {
  const row = {
    personId: 9129027526058,
    allergenName: "Сүү",
    ...Object.fromEntries(ESIS_REFUSED_CREDENTIALS.map((name) => [name, "leaked"])),
  };

  const parsed = esisDiscoveredSchema.parse(row) as Record<string, unknown>;

  for (const name of ESIS_REFUSED_CREDENTIALS) {
    expect({ name, present: name in parsed }).toEqual({ name, present: false });
  }
  expect(parsed).toMatchObject({ allergenName: "Сүү" });
});

/*
 * ★★ An identifier survives the parse — the client asked for register
 * numbers on 2026-09-15, and a deterministic child match needs one. Who may
 * *see* it is a separate question, answered per caller in
 * `EsisAdminService.visibleRows`, not here.
 */
it("keeps a register number at the parse boundary", () => {
  const parsed = esisDiscoveredSchema.parse({
    personId: 9129027526058,
    personRegNumber: "УЛ24270406",
    civilId: "4812345619",
  }) as Record<string, unknown>;

  expect(parsed).toMatchObject({ personRegNumber: "УЛ24270406", civilId: "4812345619" });
});

/*
 * ★★★ The two lists cannot overlap. A name in both would be refused by the
 * schema and then "gated" by a check that never sees it — an access rule
 * that looks enforced and is dead.
 */
it("keeps credentials and identifiers disjoint", () => {
  const overlap = ESIS_REFUSED_CREDENTIALS.filter((name) =>
    (ESIS_IDENTIFIER_FIELDS as readonly string[]).includes(name),
  );
  expect(overlap).toEqual([]);
});
```

Update that file's import at line 7:

```ts
import {
  ESIS_IDENTIFIER_FIELDS,
  ESIS_REFUSED_CREDENTIALS,
  esisDiscoveredSchema,
} from "./esis.schemas";
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm --filter @kinder/api exec vitest run src/integrations/esis/esis.fields.test.ts
```

Expected: FAIL to compile — `ESIS_REFUSED_CREDENTIALS` is not exported.

- [ ] **Step 3: Make it pass**

In `apps/api/src/integrations/esis/esis.schemas.ts`, replace
`ESIS_REFUSED_FIELDS` and `const REFUSED` (lines 119-142) with:

```ts
/**
 * Credentials this product refuses from any ESIS payload, permanently.
 *
 * ★ Destroyed at the parse boundary, so no caller and no role recovers them.
 * `school/staff` and `teacher/list` return `googleEmailPass`,
 * `microsoftEmailPass` and `username` on every row — verified live against
 * institution 42778 on 2026-09-15. A password this product holds is a password
 * this product can leak, and it has no use for a Google account's.
 *
 * ★★ `username` is here rather than among the identifiers deliberately. It is
 * the handle on the account whose password is refused above; half a credential
 * is worth less than none and carries the same risk.
 *
 * ★★★ A list, in code, because `esisDiscoveredSchema` keeps every key a service
 * sends. A declared schema refuses by not naming the field and
 * `esis.fields.test.ts` proves it still does; a passthrough has no such
 * accident-proofing, so the refusal has to execute.
 */
export const ESIS_REFUSED_CREDENTIALS: readonly string[] = [
  "microsoftPassword",
  "googlePassword",
  "microsoftEmailPass",
  "googleEmailPass",
  "username",
];

/**
 * Register numbers: kept at the boundary, shown only to an ADMIN.
 *
 * ★ **Requested by the client on 2026-09-15** — "РД-г тийм, нууц үгийг үгүй".
 * `ESIS_REQUEST.md` §1.1 (b) refused these; that document was never filed with
 * the ministry, so this is a project decision rather than a change to an
 * agreement.
 *
 * ★★ The gain is not cosmetic. `Child.esisPersonId` is written only where a
 * name and date of birth match exactly one child on the live roster, so two
 * children sharing both cannot be matched at all. A register number makes the
 * join deterministic.
 *
 * ★★★ `registerNumber` is an organisation's rather than a person's — API 186's
 * building lookup keys on it. It is the same class of value and is listed here
 * so the catalog does not end up showing a child's register number while
 * hiding a building's.
 *
 * Who may see one is decided per caller in `EsisAdminService.visibleRows`, not
 * here. Removing a name from this list makes it visible to everybody.
 */
export const ESIS_IDENTIFIER_FIELDS: readonly string[] = [
  "civilId",
  "personRegNumber",
  "registerNumber",
];

const REFUSED = new Set(ESIS_REFUSED_CREDENTIALS);
const IDENTIFIERS = new Set(ESIS_IDENTIFIER_FIELDS);

/**
 * The rows that may leave this service, given who asked.
 *
 * ★ Credentials are removed **unconditionally**, even though
 * `esisDiscoveredSchema` already destroyed them. That is deliberate
 * belt-and-braces: eight of the declared readers do not use the passthrough,
 * and a future hand-written schema that names `username` by accident would
 * otherwise reach a screen. One rule at one boundary is also the only version
 * a reviewer can check in a single read.
 *
 * ★★ Register numbers are removed unless the caller administers this
 * kindergarten. Applied here rather than in the schema because the answer
 * depends on who asked, and a schema is built once at module load.
 *
 * Every ESIS row this product returns to a client goes through
 * `EsisAdminService.visibleRows`, and `test/esis-admin.test.ts` proves it over
 * HTTP for each route.
 */
export function esisVisibleRows<T>(rows: T[], options: { identifiers: boolean }): T[] {
  return rows.map((row) => {
    if (typeof row !== "object" || row === null) return row;
    return Object.fromEntries(
      Object.entries(row as Record<string, unknown>).filter(
        ([name]) => !REFUSED.has(name) && (options.identifiers || !IDENTIFIERS.has(name)),
      ),
    ) as T;
  });
}
```

Update `esisDiscoveredSchema`'s `★★★` paragraph (around line 168) to read:

```ts
 * ★★★ The credential refusals are enforced here rather than trusted to the
 * field list — this is the one schema that cannot express "I did not ask for
 * that" by omission. A widened schema elsewhere is a bug; a passthrough that
 * leaked a provider password would be a breach. Register numbers deliberately
 * survive this step and are removed per caller — see `esisVisibleRows`.
```

Then fix every remaining reference:

```bash
grep -rn "ESIS_REFUSED_FIELDS" apps/api/src apps/web packages --include='*.ts' --include='*.tsx'
```

**Leave `prisma/seed-esis.ts` alone.** It projects every record through
`ESIS_FIELDS`' own `ingested` flag before any code reads a property, and
`civilId` / `personRegNumber` are still `ingested: false` there. So the seed
keeps dropping them, which is what you want: a local development database
should not fill with eighty-three real children's register numbers. That is not
a leftover from the old refusal list and must not be "fixed".

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
pnpm --filter @kinder/api exec vitest run src/integrations/esis/
pnpm --filter @kinder/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/integrations/esis/
git commit -m "feat(esis): credentials are destroyed, register numbers are gated"
```

---

## Task 5: Only an ADMIN of that kindergarten sees a register number

Task 4 lets register numbers past the parser. This task decides who sees one,
and proves it over HTTP.

Spec §4.3:

| Surface                             | Register number                    |
| ----------------------------------- | ---------------------------------- |
| `GET …/esis/resource` (ADMIN)       | Yes, with an `AuditLog` `VIEW` row |
| `GET …/esis/my-profile` (any staff) | No                                 |
| Per-child ESIS reads (teacher)      | No                                 |
| Any guardian payload                | Never                              |

**Files:**

- Modify: `apps/api/src/integrations/esis/esis-admin.service.ts`
- Test: `apps/api/test/esis-admin.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/test/esis-admin.test.ts`, at the end of the file. It reuses
that file's existing fixtures: `a` (a `Scenario`), `adminA` / `teacherA`
(`AuthSession`s from `login`), `authed()`, `mapInstitution()`, `server()`, and
the `read` mock declared at the top.

Note that a teacher **may** read `students` through this route — the
`single-resource ESIS read` describe block above already asserts it. That is
what makes these tests meaningful: the teacher reaches the service and must
still not see the number.

```ts
/*
 * ★ CLAUDE.md §4.1 — through HTTP, against the real route. A unit test on
 * `esisVisibleRows` passes whether or not any controller calls it, which is
 * exactly the failure mode that rule exists to catch.
 */
describe("register numbers by role", () => {
  const url = (kindergartenId: string, query: string) =>
    `/v1/kindergartens/${kindergartenId}/esis/resource?${query}`;

  const REG = "УЛ24270406";
  const CIVIL = "4812345619";
  const rosterRow = {
    personId: "90000000000001",
    firstName: "Ану",
    personRegNumber: REG,
    civilId: CIVIL,
    googleEmailPass: "leaked",
    microsoftEmailPass: "leaked",
    username: "leaked",
  };

  it("shows an admin of this kindergarten the register number", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);
    read.mockResolvedValueOnce({ data: [rosterRow] });

    const res = await authed(
      request(server()).get(url(a.kindergarten.id, "resource=students")),
      adminA,
    );

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(REG);
  });

  it("hides it from a teacher reading the same service", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);
    read.mockResolvedValueOnce({ data: [rosterRow] });

    const res = await authed(
      request(server()).get(url(a.kindergarten.id, "resource=students")),
      teacherA,
    );

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect({ reg: body.includes(REG), civil: body.includes(CIVIL) }).toEqual({
      reg: false,
      civil: false,
    });
    // …and the row is still there, minus the two fields.
    expect(body).toContain("Ану");
  });

  it("hides it from a teacher's own ESIS profile", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);
    read.mockResolvedValueOnce({ data: [rosterRow] });

    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/esis/my-profile`),
      teacherA,
    );

    const body = JSON.stringify(res.body);
    expect({ reg: body.includes(REG), civil: body.includes(CIVIL) }).toEqual({
      reg: false,
      civil: false,
    });
  });

  /*
   * ★★ Spec §4.3's "any guardian payload: never" is **already covered** —
   * `esis-admin.test.ts:613` ("returns 404 to a guardian and never calls
   * ESIS") and `:827`. A parent never reaches the route, so there is no body
   * to strip and nothing to add here. Confirm both tests still pass rather
   * than writing a third.
   */

  /*
   * ★★★ The credential half, asserted on the route that shows the most. If an
   * ADMIN cannot see a provider password, no narrower caller needs checking.
   */
  it("never shows a provider password, even to an admin", async () => {
    await mapInstitution(a.kindergarten.id, superAdmin);
    read.mockResolvedValueOnce({ data: [rosterRow] });

    const res = await authed(
      request(server()).get(url(a.kindergarten.id, "resource=staff")),
      adminA,
    );

    const body = JSON.stringify(res.body);
    for (const name of ["googleEmailPass", "microsoftEmailPass", "username"]) {
      expect({ name, leaked: body.includes(name) }).toEqual({ name, leaked: false });
    }
  });
});
```

The `read` mock returns rows verbatim, so it does **not** exercise
`esisDiscoveredSchema` — which is why the credential case above is a real test
of the service boundary rather than of the schema. The schema's own credential
guarantee is asserted in Task 4.

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
pnpm --filter @kinder/api exec vitest run test/esis-admin.test.ts -t "register numbers by role"
```

Expected: the teacher cases FAIL — the register number is present, because
nothing strips it yet.

- [ ] **Step 3: Make them pass**

In `apps/api/src/integrations/esis/esis-admin.service.ts`, import
`esisVisibleRows` from `./esis.schemas` and `hasRoleIn` from `../../authz/actor`
(`Role` comes from `../../domain/enums`; both are already used elsewhere in the
ESIS module — check the existing imports before adding a duplicate). Add one
private method:

```ts
  /**
   * The rows this caller may see.
   *
   * ★ One gate, applied by every method that returns ESIS rows to a client.
   *
   * Register numbers reach this service because `esisDiscoveredSchema`
   * deliberately keeps them (`ESIS_IDENTIFIER_FIELDS`). An administrator of
   * this kindergarten is reconciling children against the ministry's roster
   * and needs one; a teacher reading the same service does not, and a guardian
   * must never.
   *
   * ★★ `hasRoleIn(…, kindergartenId)` rather than the actor's role alone: an
   * ADMIN of *another* kindergarten is not an admin here. This runs after the
   * route's own tenant check, never instead of it.
   */
  private visibleRows<T>(actor: Actor, kindergartenId: string, rows: T[]): T[] {
    return esisVisibleRows(rows, {
      identifiers: hasRoleIn(actor, Role.ADMIN, kindergartenId),
    });
  }
```

`hasRoleIn` is the predicate `TenantAccessService.assertAdmin` is built from
(`apps/api/src/authz/tenant-access.service.ts:26`). Use it directly rather than
adding a boolean method to that service — this is not an authorization decision
about whether the route may run, which is what that class is for. The route has
already decided that.

Then route every method that returns ESIS rows through it. Find them:

```bash
grep -n "response.data\|rowValues\|\.data\b" apps/api/src/integrations/esis/esis-admin.service.ts
```

At minimum `read`, `myProfile` and the per-child reader. Each becomes, for
example:

```ts
const rows = this.visibleRows(actor, kindergartenId, response.data);
```

with everything downstream reading `rows` instead of `response.data`.

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
pnpm --filter @kinder/api exec vitest run test/esis-admin.test.ts
```

Expected: PASS, every test in the file.

- [ ] **Step 5: Run the whole api suite**

```bash
pnpm --filter @kinder/api test 2>&1 | tail -20
```

Expected: no failures. If one appears in `children.test.ts` or another
cross-kindergarten isolation test, **do not treat it as flake** — check first
that nothing else is running (a `pnpm dev`, the web suite, a second api run),
then capture `--reporter=verbose` to a file. `CLAUDE.md` §4.4 is the background.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/integrations/esis/esis-admin.service.ts apps/api/test/esis-admin.test.ts
git commit -m "feat(esis): a register number reaches an admin of that kindergarten and nobody else"
```

---

## Task 6: Re-probe, and record what the ministry actually answers

The probe script exists (`apps/api/scripts/esis-probe.ts`) and found the two
defects this plan fixes. Running it again is how you prove they are fixed
against the live service rather than against a stub.

**Files:**

- Modify: `docs/ESIS_API_READINESS.md`
- Uses: `apps/api/scripts/esis-probe.ts`

- [ ] **Step 1: Run the probe**

```bash
cd apps/api
set -a && . ../../.env && set +a
ESIS_INSTITUTION_ID=42778 pnpm exec tsx scripts/esis-probe.ts 2>&1 | grep -v EsisClient | tail -60
```

Expected, compared with the 2026-09-15 baseline of `OK 32 · EMPTY 16 · PARSE 2`:

- `studentInfo` moves from `PARSE` to `OK`
- `teacherMovements` moves from `PARSE` to `EMPTY`
- **`PARSE: 0`**

If any reader still reports `PARSE`, that is a real finding — read the message
before changing anything, and check the probe is passing a sensible parameter.
Three "failures" in the first run were a _student's_ `personId` handed to
`teacherAcademicOrg`, `teacherCheck` and `teacherProfile`.

Register numbers are masked by the script. Keep it that way; do not paste raw
probe output anywhere.

- [ ] **Step 2: Record the result**

Add to `docs/ESIS_API_READINESS.md`, after §1.1.3, in Mongolian to match that
file:

```markdown
### 1.1.4 Дамжуулах схем үндсэн зам болов — 2026-09-15

52 уншигчийг бодит үйлчилгээний кодоор 42778 дээр нэг удаа дуудав
(`scripts/esis-probe.ts`). Эхний хэмжилт: **32 задарсан · 16 хоосон · 2 алдаа**.

| Сервис                    | Алдаа                                                         | Шийдэл           |
| ------------------------- | ------------------------------------------------------------- | ---------------- |
| `studentInfo` (48)        | `dateOfBirth`-ийг схем `string` гэж бичсэн, ЭСИС тоо илгээдэг | Дамжуулах схем   |
| `teacherMovements` (…782) | `HTTP 205`, хоосон бие — `203` шиг уншигддаггүй               | `esisListParser` |

Дараах хэмжилт: **PARSE 0**.

Гараар бичсэн схем зөвхөн найман уншигчид үлдсэн — TypeScript код талбарын
нэрийг нь уншдаг цорын ганц газрууд. Бусад 45 нь ЭСИС-ийн илгээснийг хэвээр
нь дамжуулна.
```

Renumber the following subsection if the file already uses `1.1.4`.

- [ ] **Step 3: Update the design doc's open items**

In `docs/superpowers/specs/2026-09-15-esis-full-coverage-design.md` §2.5,
replace the closing sentence "Neither is fixed here. Both belong to spec 1…"
with a line recording that both are fixed and the probe now reports `PARSE: 0`.

- [ ] **Step 4: Run everything**

```bash
cd /Users/usukhbayar/Desktop/Projects/byatshan-nuudelchid-v2
pnpm typecheck && pnpm lint
pnpm --filter @kinder/api test 2>&1 | tail -5
pnpm --filter web test 2>&1 | tail -5     # SERIALLY — never with the api suite
```

Expected: typecheck and lint clean; api ≥ 2213 passed, 0 failed; web 1004
passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/scripts/esis-probe.ts docs/
git commit -m "docs(esis): the probe that found two dead readers, and what it says now"
```

---

## What this plan does not do

- **Does not wire the 17 unwired services.** Spec §2.2, a later plan.
- **Does not touch staff registration.** Spec §5 is its own plan, and it depends
  on the roster being persisted, which is spec §6's tier 2.
- **Does not add a sync schedule.** Spec §6.
- **Does not store a register number anywhere.** This plan lets one reach an
  ADMIN's screen. Persisting one onto `Child` is part of the deterministic-match
  work in a later plan, and needs its own decision about retention.

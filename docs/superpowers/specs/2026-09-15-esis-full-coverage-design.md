# ESIS — all 84 granted services, staff who register themselves, and a month the ministry is watching

**Date:** 2026-09-15
**Status:** approved by the client in conversation, 2026-09-15
**Baseline:** the **working tree**, not `fd54fa7` — see §2.4
**Touches:** `apps/api/src/integrations/esis/`, `apps/api/src/users/`,
`apps/api/src/auth/`, `apps/web/components/esis/`, `apps/api/prisma/schema.prisma`

---

## 1. What this is

The ministry granted this deployment access to **one** institution — 42778,
Дэгдээхий үрс цэцэрлэг — for a month. If the month goes well, more
institutions follow. The client's instruction:

> "edgeeriig yg zuw bugdiig ni ashiglana. garaltiin utguudiig bugdiig ni
> haruulna nuuj haaj bolohgui"

and, mid-conversation:

> "turshiltiinh c gesen buren bodit orchin deer ajillana gesen ug"

Two things follow from the second sentence and they shape everything below.
There is **no test environment**. Every `POST` this system sends during the
trial lands in the ministry's real records for a real kindergarten. And every
`GET` it sends is in a log somebody will read when deciding whether to grant
the next institutions.

### 1.1 "Use all of them" and "least privilege" are not in conflict

А/465 §4 requires access to be taken per service at the narrowest scope. A
nightly sweep calling the vaccination, disability and allergy services across
all 83 children would satisfy a literal reading of "use all of them" and would
be the **worst** evidence this project could file: purposeless bulk collection
of children's medical data.

The reading that satisfies both, and the one this design implements:

> Every granted service has a **named purpose**, a **named trigger**, and an
> **`AuditLog` row**; and a matrix proves that none of the 84 is unimplemented.

"We used all of them" and "we made no call we could not justify" are then the
same document. §7 is that document.

### 1.2 Three things "hiding" could mean

The instruction was checked against all three:

| Sense                                                             | Verdict                    |
| ----------------------------------------------------------------- | -------------------------- |
| (a) demo/fixture rows standing in for real answers                | Already deleted 2026-09-14 |
| (b) fields ESIS sent that a hand-written schema silently dropped  | **A real defect. Fix it.** |
| (c) fields refused in code, with the refusal shown in the catalog | Keep — but narrow it (§4)  |

(b) is the one that matters. `ESIS_API_READINESS.md` §1.1 records nine of
thirty-six readers getting this wrong: the reader parsed, the unnamed keys fell
away, and a screen drew an empty column that read as "this institution has no
data". §3 is the structural fix.

---

## 2. Verified baseline

Everything in this section was measured on 2026-09-15, not read from a
document. The docs disagree with themselves on coverage — `ESIS_API_READINESS.md`
says 17, 39, 40 and 67 in different sections, all stale snapshots of an
append-edited file.

### 2.1 Coverage: 67 of 84

`apis-granted.xlsx` (84 rows) joined against `ESIS_ENDPOINTS` on `apiId`,
method and path:

- **67 wired**, no disagreement on method or path.
- **0 endpoints in code that are not on the granted list.** This is the single
  most useful fact for the ministry: the adapter cannot call a service it was
  not granted, because it does not know of one.
- Three path differences are **placeholder spelling only** — `:personid` vs
  `:personId` (97, 99) and `:daydate` vs `:dayDate` (11). The generated matrix
  must case-normalize, or the artifact handed to the ministry shows three
  defects that do not exist.

### 2.2 The 17 not wired

| Count | Services                                                           | Disposition                                                                                    |
| ----- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 14    | 150, 152, 162, 119, 165, 167, 170, …784, 73, 129, 131, 85, 72, 186 | **Wire.** The seven writes go behind prepare → approve → send (§6)                             |
| 2     | …793 (`attendance/save`), 105 (`attendance/save/v2`)               | **SUPERSEDED** by 171 (v3), which is wired and live. Wiring all three invites divergent writes |
| 1     | …776 (`Суралцагчийн шилжилт хөдөлгөөний мэдээлэл`)                 | **URL column is empty in the ministry's own xlsx.** Matrix says "path requested from ministry" |

`SUPERSEDED` and `BLOCKED_ON_MINISTRY` are matrix states, not omissions. Both
are better evidence than a silent gap.

Two of the fourteen do not fit the client's path assumptions and need naming
before they are wired, not after:

- **119** is `/svc/api/zereg/get/request/:registerNum` — a different path root
  from every other service, which all sit under `/svc/api/hub/v2/`. The client
  builds paths on one base URL; 119 needs its root handled explicitly rather
  than assumed.
- **186** is `/svc/api/hub/v2/MOF/ORGANIZATION/BUILDING/{registerNumber}` —
  brace placeholders and upper-case segments, the only row in the file shaped
  that way, and tagged `OPEN` rather than `EBS`.

### 2.3 Two live probes that changed the design

Run against institution 42778 with the deployment token:

**`school/staff` (55) returns 13 rows; `teacher/list` (…812) returns 10.** Both
carry `personRegNumber` **and** `civilId`, non-null on every row. This is the
finding that makes §5 safe: staff self-registration can match a register number
against a 13-row roster and **never call the national-scope service at all**.

`esis.endpoints.ts:701` documents why that matters. API 49
(`/svc/api/public/worker/info/:primaryNidNumber`) takes no `institutionId`,
sits under `/public/`, and on 2026-09-14 resolved register numbers belonging to
staff of _other_ institutions. A registration route built on it would be an
unauthenticated national register-number lookup. It is not used in this design.

Both list services also return `googleEmailPass`, `microsoftEmailPass` and
`username` live — which is the concrete reason §4's password refusals stay.

### 2.4 The working tree is the baseline

Confirmed present and **uncommitted**: `esisDiscoveredSchema`,
`ESIS_DISCOVERED_SHAPE`, `esisFieldsFor`, `ESIS_REFUSED_FIELDS`,
`Child.esisPersonId` and migration `20260915090000_child_esis_person_id`
(applied; `prisma migrate status` reports 79 migrations, schema up to date).

This makes §3 **much smaller than it reads**. The pass-through schema is not
being built; it is being promoted from an exception used by six readers with
unknown contracts to the default for every reader.

Working tree at time of writing: 64 files changed, 6550 insertions, 3234
deletions, plus 12 untracked files. Verified on 2026-09-15, before any of this
design was implemented:

| Check                                          | Result                                      |
| ---------------------------------------------- | ------------------------------------------- |
| Conflict markers, `TODO`/`FIXME`, `@ts-ignore` | none                                        |
| `pnpm typecheck` (contracts, api, web)         | clean                                       |
| `pnpm lint`                                    | clean                                       |
| `prisma migrate status`                        | 79 migrations, schema up to date            |
| `pnpm --filter api test`                       | **2213 passed**, 1 skipped, 0 failed (811s) |
| `pnpm --filter web test`                       | **1004 passed**, 0 failed (42s)             |

The suites were run **serially**. Run concurrently they starve Postgres and
produce `beforeEach` hook timeouts that impersonate the CLAUDE.md §4.4 flake —
including a cross-kindergarten isolation failure that is not one.

The tree is therefore a sound baseline: complete, green, and not a half-finished
change this design would have to work around.

### 2.5 What the suites cannot see, and what a live probe found

**2213 passing tests say nothing about ESIS.** `test/setup.ts` deletes
`ESIS_TOKEN`, so every ESIS route under `vitest` answers from a stub. Whether a
reader parses what the ministry actually sends is unverified by construction.

So each of the 52 readers was called once against institution 42778 through the
real service code path — `EsisService.read()`, not a raw request — one call per
service, per-child services against one child (`scripts/esis-probe.ts`):

| Outcome           | Count |
| ----------------- | ----- |
| Parsed rows       | 32    |
| Empty (`203`)     | 16    |
| **Parse failure** | **2** |

Three further failures in the first pass were the probe's own fault — a
_student's_ `personId` passed to `teacherAcademicOrg`, `teacherCheck` and
`teacherProfile`. With a teacher's id all three return rows. They are recorded
here because the same mistake in product code would look exactly like a broken
reader.

The two real ones are both the §1.2(b) defect class, and both are fixed by §3:

**`studentInfo` (48) fails on every child.** The schema types `dateOfBirth` as
a string; ESIS sends a number. `invalid_union`, so the entire service returns
`invalid_response` — a hand-written field type that was never checked against a
live answer. §3.1 removes the hand-written schema.

**`teacherMovements` (…782) answers `HTTP 205` with an empty body.** The client
treats `203` as "no data" but not `205`, so an empty answer is read as a broken
contract. `ESIS_API_READINESS.md` §1.1 lists three empty shapes; this is a
**fourth**, and it is an empty _status_ rather than an empty `RESULT`. §3.3's
rule must be widened to cover it.

★ **Both are fixed, and the probe now reports `PARSE: 0`** across all 52
readers — 33 parsed, 19 empty. Shipped in #106;
`ESIS_API_READINESS.md` §1.1.5 records the measurements.

Three things the work turned up that this section did not anticipate:

- The empty-body rule had to be written into **three** parsers, not one. Each
  builds its own envelope, so the fix to `esisListParser` never reached
  `esisCheckParser` or `esisContactsParser`. The third matters most: two of the
  eighty-three children probed have a guardian-contacts record, so an empty
  answer is that service's ordinary case.
- Adding `civilId` to the hand-written schemas as a string **broke the roster
  on every row** — ESIS sends it as a JSON number from every service. The fix
  that closes §1.2(b) is capable of re-opening it; the live probe is what
  caught it, and 2228 passing tests did not.
- Seven readers keep a hand-written schema, not eight. `groupAttendance` was on
  the list in error — nothing reads its named fields.

---

## 3. A — coverage and field truth

### 3.1 Pass-through becomes the default

Today a reader is a hand-written zod object and anything ESIS sends that the
object does not name is dropped. That is §1.2(b).

After: every reader parses through `esisDiscoveredSchema`. Hand-written schemas
survive **only** where the response is mapped into a domain model and the field
names are load-bearing — attendance, the roster (`students`, `groups`,
`groupStudents`, `staff`, `teachers`), and the cook reference tables. Everywhere
else the screen reads its columns from the first real response, as
`ESIS_DISCOVERED_SHAPE` already does for the six services whose contract has
never been observed.

The invariant this buys: **a field ESIS sends cannot be lost because nobody
wrote its name down.** The only fields that can be absent are the ones refused
by name in §4, and the catalog shows each of those with its reason.

### 3.2 Probing

Field lists come from live responses, not from the portal documentation and not
from the `docs/*.md` contracts. Those are internal notes, they were never filed
with the ministry, and §1.1 of `ESIS_API_READINESS.md` records eleven of
thirty-six hand-written readers being fiction.

Probe discipline:

- **One call per service.** Per-child services are probed against **one** child,
  not the roster. A discovery sweep across 83 children is exactly the log
  pattern §1.1 exists to avoid.
- The seven `POST`s cannot be probed read-only. Their input shapes come from the
  single-real-record test in §6.
- Probe output is masked for register numbers in any transcript or log.

### 3.3 Empty is not absent

Three empty shapes are already handled (`RESULT: ""`, `RESULT: []`, `RESULT`
missing). The rule they serve is restated here because §3.1 widens its reach:
a `203` renders as **"мэдээлэл ирээгүй"** and never as "no vaccinations", "no
allergies" or "not eligible". `vaccine/history` returned 17 real records for a
child and `203` for the same child an hour later, same token, same institution.

A service whose shape has never been observed must **not** block. The screen
says the shape is unknown and renders whatever arrives when a real record
appears.

---

## 4. B — the register number, and what stays refused

**Client decision, 2026-09-15: register numbers yes, passwords no.**

`ESIS_REQUEST.md` §1.1(b) promised not to receive register numbers. That
document was never filed with the ministry — it is an internal note — so this
is a project decision, not a change to an agreement, and **no ministry
notification step exists**.

### 4.1 Out of `ESIS_REFUSED_FIELDS`

`civilId`, `personRegNumber`.

The gain is not cosmetic. `Child.esisPersonId` is today written only where a
live roster match on name + date of birth is unique; two children with the same
name and birthday cannot be matched at all. A register number makes the join
deterministic.

### 4.2 Stays refused

`microsoftPassword`, `googlePassword`, `microsoftEmailPass`, `googleEmailPass`
— all four, confirmed arriving live.

`username` **also stays refused.** It is neither a register number nor a
password, so it would otherwise be decided by accident. It is the handle on a
Google/Microsoft account whose password we refuse; it has no use in this product
and storing half a credential is worse than storing neither.

### 4.3 Where a register number may appear

The pass-through schema has no "not named ⇒ not taken" protection, so without
this table a register number lands in **every** discovered response body.

| Route / surface                      | Register number                              |
| ------------------------------------ | -------------------------------------------- |
| Staff registration match (§5)        | Compared internally, **never** in a response |
| `GET …/esis/resource` (ADMIN)        | Yes, with an `AuditLog` `VIEW` row           |
| Child ↔ ESIS reconciliation (ADMIN)  | Yes                                          |
| Teacher screens, `…/esis/my-profile` | No                                           |
| Any guardian payload                 | **Never**                                    |

`esis.fields.test.ts` pins the refused set. It is updated **deliberately** as
part of this work — not relaxed when it fails.

---

## 5. C — staff register themselves

**Client decision, 2026-09-15:** teachers register themselves with their
register number; the director does not approve each one, only reviews the list.
Invitations remain as a fallback.

### 5.1 The flow

```
Director → generates a kindergarten registration code
           (stored hashed on Kindergarten; viewable and rotatable)

Teacher  → enters code + register number
             ↓
           matched against the PERSISTED staff roster — the one tier 2 syncs
           daily from school/staff (55) + teacher/list (…812).
           No live ESIS call. API 49 is NOT called.
             ↓ on match
           one-time token → the teacher sets their own password
```

**The route is unauthenticated** — the teacher has no account yet — so it must
not reach ESIS. Calling the ministry on every registration attempt would put
public traffic into their logs and contradict §1.1's own reframe. It matches
against what tier 2 already stores.

**Fail closed.** If the persisted roster is absent, or its last successful sync
is older than the staleness threshold, registration **refuses** and the screen
directs the teacher to ask the director for an invitation. A stale roster must
never be treated as "not on the list", and never as a reason to fall back to a
live call.

Nobody ever types a password for somebody else. This reuses
`createInvitedAccount`, which already creates the account with an unusable
random hash and issues a one-time token, and `issuePasswordReset`, which already
issues a link rather than setting a password.

### 5.2 Rules

- **Uniform failure.** "Wrong code" and "register number not on this roster"
  return the same message. Distinguishing them turns the route into an oracle
  for "does this person work at this kindergarten".
- **The code is a throttle, not authentication.** It is a secret shared among
  thirteen people. The roster match is the real gate.
- **Attempt counter outside any interactive transaction** — CLAUDE.md §3.6.
  Written inside the failing request's transaction it rolls back and the
  counter silently resets, the exact shape of the `LoginAttempt` bug.
- **Rate limited** per register number and per IP.
- **Role from `positionName`/`jobCode`.** `ADMIN` and `ACCOUNTANT` are **never**
  auto-assigned — with no approval gate, a position string would otherwise
  decide privilege. Those two stay invitation-only.
- **Director's screen:** who registered, when, from which ESIS position, with a
  revoke control.

---

## 6. D — sync

Three tiers plus a manual button. All four paths run the same code and each
writes an `EsisSyncRun` row.

| Tier      | Services                                                                          | Trigger                                       |
| --------- | --------------------------------------------------------------------------------- | --------------------------------------------- |
| Reference | cook (111, 112, 123, 124, 125, 126, 127), programs, buildings, rooms, vaccine ref | Monthly                                       |
| Roster    | `movement/v2/:beginDate`, groups, students, staff, teachers                       | Daily, incremental from the last run's date   |
| Per-child | health, vaccination, allergy, disability, measurements, screening, awards (85)    | **Only when staff opens that child's screen** |

`stdnt/awards` (85, read) belongs to tier 3 with the rest of the per-child
reads. Its write half (72) belongs to §6.1, not to any tier — a write has an
operator, not a schedule. Naming both here so neither is left without a
trigger.

Per-child reads pass `assertCanReadEsisChild` and write an `AuditLog` row. This
is what makes tier 3 defensible in the ministry's log: every call has a person,
a child and a reason.

A manual **"Татах"** button sits over all three — same code, same audit row. It
answers "is the connection working right now", which no schedule can.

### 6.1 Writes

Attendance v3 (171) already works this way. The seven new writes — 150, 152,
162, 129, 131, 73, 72 — follow it:

**prepare → show the exact payload → a human approves → send.**

Because the trial runs against production data:

- Group **delete** (152) needs a second confirmation. There is no undo.
- Each write service is exercised against **one** real record first, its
  success response documented, and only then opened for bulk use.
- Writes go through BullMQ **after** the transaction commits (§3.5), with an
  idempotency key so a retry cannot double-post.

---

## 7. E — the evidence the ministry reads

One report, generated monthly from `AuditLog` and `EsisSyncRun`:

for each of the 84 services — purpose, trigger, last called, call count, and
state (`WIRED` · `SUPERSEDED` · `BLOCKED_ON_MINISTRY`).

That single page answers both questions at once: everything granted is in use,
and nothing was called without a reason. It is the artifact that argues for the
next institutions.

This report is **user-facing and ministry-facing**, so its text is Mongolian.

---

## 8. Order

| #   | Spec  | Contains                                          |
| --- | ----- | ------------------------------------------------- |
| 1   | A + B | §3, §4 — pass-through default, probe, refused set |
| 2   | C     | §5 — staff self-registration                      |
| 3   | D     | §6 — three tiers, manual pull, seven writes       |
| 4   | E     | §7 — the monthly matrix                           |

Each gets its own implementation plan and its own PR. A + B first because it
decides the shape every later screen reads.

---

## 9. Deliberately not done

- **API 49 is not used for registration.** §2.3. It stays in the catalog as an
  ADMIN lookup where an operator already holds the register number.
- **No ministry notification step.** §4 — the `.md` documents were never filed.
- **No bulk per-child discovery sweep.** §3.2.
- **Attendance v1/v2 are not wired.** §2.2.
- **No password is ever typed by anyone other than its owner.** §5.1.

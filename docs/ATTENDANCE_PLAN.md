# Attendance — technical scoping

**Status: decisions taken 2026-08-25. Cleared to build.** No code written yet.

Pulled forward from RFP Module 2 on 2026-08-25, after the dashboard KPI was
requested five times and declined five times for want of a model. The decision
is to build the model properly rather than fake the number.

The business rules below are **not invented**. `../ByatshanNuudelchid/apps/attendance`
is a complete, tested implementation, and CLAUDE.md names the Django project the
source of truth for business rules, validation and authorization. This plan ports
its _reasoning_; it does not port its structure.

---

## 1. The decision everything else follows from

**Attendance hangs off `Enrollment`, never off `Child`.**

The reference states it plainly, and it is the one choice that is expensive to
reverse:

> A child who transfers in January has two enrollments, and their March
> attendance belongs to whichever kindergarten they actually attended. Pointing
> at `Child` would attribute the whole year to wherever the child is _now_.

`Child.kindergartenId` is a denormalised "currently attending" pointer —
CLAUDE.md §1.2 already forbids using it for authorization, and this is the same
hazard with a date attached. A transfer would silently rewrite history.

`childId` is still stored, denormalised, so "this child's month" is a range scan
rather than a join. The enrollment stays the authority for _which kindergarten a
day belongs to_; the child column is for lookup and display only.

---

## 2. Proposed schema

```prisma
/// A closed vocabulary from the requirement, not configuration. Contrast
/// `DevelopmentDomain`, which is a table because a kindergarten invents its
/// own — CLAUDE.md §2.3 permits an enum exactly here.
///
/// ★ Five, settled 2026-08-25. The reference carries six; only `HALF_DAY`
/// is dropped.
///
/// `HALF_DAY` costs nothing to lose — its only purpose was a funding
/// fraction, and nothing here computes money.
///
/// `OTHER` was briefly dropped and reinstated the same day, which is worth
/// recording because the reasoning generalises. It is the escape hatch that
/// keeps a teacher from forcing an unusual day into a category that is
/// wrong; without it every odd day still gets counted, just under a status
/// that misstates it. `note` cannot rescue that — a note explains one row
/// and cannot be aggregated, so the error survives into every monthly total
/// silently. A vocabulary with no escape does not produce cleaner data, it
/// produces confidently wrong data.
enum AttendanceStatus {
  PRESENT  // Ирсэн
  ABSENT   // Тасалсан
  SICK     // Өвчтэй
  EXCUSED  // Чөлөөтэй
  OTHER    // Бусад — the escape hatch. Pairs with `note`, which is where the
           // teacher says what actually happened.
}

model Attendance {
  id             String           @id @default(uuid()) @db.Uuid
  kindergartenId String           @db.Uuid
  /// ★ The authority for which kindergarten this day belongs to. See §1.
  enrollmentId   String           @db.Uuid
  /// Denormalised for "this child's month" range scans. NOT the tenant anchor.
  childId        String           @db.Uuid
  date           DateTime         @db.Date
  status         AttendanceStatus
  note           String?

  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?
  recordedById String?  @db.Uuid   // who last wrote this day

  kindergarten Kindergarten @relation(fields: [kindergartenId], references: [id], onDelete: Restrict)
  enrollment   Enrollment   @relation(fields: [enrollmentId], references: [id], onDelete: Restrict)
  child        Child        @relation(fields: [childId], references: [id], onDelete: Cascade)
  recordedBy   User?        @relation(fields: [recordedById], references: [id], onDelete: SetNull)

  /// ★ One row per enrollment per day, enforced by the database.
  /// A double-submitted sheet cannot produce two rows for one day.
  @@unique([enrollmentId, date])
  /// The group day sheet: "every child in this group on this date".
  @@index([kindergartenId, date])
  /// The monthly view: always a range scan over one child.
  @@index([childId, date])
}
```

`Enrollment` and `Child` each gain an `attendances Attendance[]` back-relation.

### Why `@@unique` and not application logic

The reference calls this "the point" of the table. A teacher who opens the
register twice, or a form submitted twice on a slow connection, must not create
two rows for one day. In this MVP that is a wrong report; in Phase 3, when the
same rows feed a funding claim, it is a duplicated claim against a government
body. The constraint costs nothing now and is very hard to retrofit later.

**Caveat — the constraint interacts with soft delete.** Postgres treats `NULL`s
as distinct, so a plain `@@unique([enrollmentId, date])` blocks re-recording a
day that was soft-deleted. The reference solves it with a partial index
(`condition=Q(deleted_at__isnull=True)`). Prisma has no partial-unique syntax, so
this needs **hand-written SQL in the migration** — see §7.

---

## 3. Tenant scoping

`kindergartenId` is denormalised onto the row, per CLAUDE.md §3.1, even though it
is reachable through `Enrollment`. One filter enforces isolation.

`AttendanceRepository` carries the base filter every other repository does —
`deletedAt: null` plus tenant scope — and methods extend it, never replace it.
Per CLAUDE.md §2.2, it is the only layer importing `PrismaClient`.

The value is taken from `enrollment.kindergartenId` at write time, never from the
request body. A body-supplied tenant id is how a row ends up with a
`kindergartenId` and an `enrollmentId` pointing at different tenants —
`AssessmentService.createTerm` already guards the identical seam.

---

## 4. Soft delete — resolved

CLAUDE.md §3.2 asked for `deletedAt` **and** `deletedById`, and no model in the
schema had ever carried one. The rule and the code had disagreed from the
beginning; scoping a new table surfaced it.

**Decided: rely on `AuditLog`, and amend the rule.** Done in this PR.

`AuditLog` already stores `actorUserId` against a `DELETE` action and an
`objectId`. It is the better home than a column: a column can be overwritten by
the next writer, an append-only row cannot. The schema stays clean and thirty
tables stop silently violating a mandatory instruction.

The `recordedById` column above is separate and is _not_ soft-delete metadata:
it answers "whose register is this", which the teacher's screen shows.

---

## 5. Authorization

Every read and write goes through `apps/api/src/authz/` (CLAUDE.md §1.1). No new
authorization concepts — attendance reuses `canAccessChild` via the enrollment's
child.

| Actor                         | May                                         |
| ----------------------------- | ------------------------------------------- |
| Teacher assigned to the group | Read and write that group's attendance      |
| Teacher not assigned          | **404** — not 403                           |
| Admin of the kindergarten     | Read and write                              |
| Guardian                      | Read **their own child only** — never write |
| Any other kindergarten        | **404**                                     |

Two rules carried directly from the reference:

**Enrollment ids are resolved against the group, never trusted from the body.**
The group-day endpoint receives a map of enrollment id → status. Each id is
looked up _within the authorized group_; anything not in it is ignored rather
than written. A POST body is written by whoever sends it, and the alternative
writes attendance for another kindergarten's child.

**Guardians read, and only their own child.** Decided 2026-08-25: a family
tracking sick days is the point of the feature. Access is a _relationship_, not
a role — `canAccessChild` via the enrollment's child, the same derivation the
portfolio and observations already use, so a revoked guardianship loses it
automatically. Guardians reach `GET /children/:id/attendance` only; the group
day sheet is staff-only, because it names every other child in the group.

**404, never 403** (CLAUDE.md §1.7), including for a group in another
kindergarten. The mandatory three tests from §4.1 apply, plus a fourth:

```
teacher from another kindergarten          → 404
teacher assigned to no group containing it → 404
guardian of another child                  → 404
enrollment id from another group in body   → ignored, not written
guardian requesting the group day sheet    → 404
guardian requesting another child's range  → 404
```

---

## 6. Business rules

**No future dates.** The reference refuses them, with the reason: _"Recording the
future is how a month's funding gets claimed before the children have attended
it."_ A `400` with a Mongolian message.

**Writing is idempotent per day.** Re-submitting the register corrects the
existing rows rather than adding a second set. One transaction for a whole group
— _"a sheet that saved eleven of twelve children would leave the twelfth silently
unfunded, and the teacher would have no way to tell."_

**A no-op writes no audit row.** If status and note are unchanged, return early.
Otherwise every re-save of the sheet buries the real corrections under a pile of
identical entries.

**A correction records what it changed _from_.** RFP §14 asks for
`Хэн → Хэзээ → Юу → Өмнөх утга → Шинэ утга`. Creating is an ordinary `CREATE`
audit row; amending carries `previousStatus` and `newStatus` in the audit
metadata. This is the entry a later reconciliation has to be able to explain.

**A day locks 7 days after it happened.** Decided 2026-08-25. Inside the
window a teacher may correct freely; outside it the day is permanently closed and
a write returns `409` with a Mongolian message. The rule exists to stop
retrospective tampering, and it is what makes a recorded month trustworthy enough
to report from.

Two consequences, both real and both accepted:

- **A day missed for more than a week can never be recorded.** A teacher off sick
  for a fortnight returns to a permanently empty register. There is no back door
  by design — an admin override would reopen exactly the hole the rule closes.
  If that proves too strict in practice, the honest fix is a widened window or an
  explicit, audited `reopen` action, not a quiet exception.
- **The lock is computed from the attendance date, not from when the row was
  written.** Otherwise a row created late would carry its own fresh 7 days and
  the window would be trivially defeated by never recording on time.

The boundary is evaluated server-side against the request date. It is not a UI
concern: the register may grey out a locked day, but the service is what refuses
the write.

**Funding value is deliberately absent.** What a given status is _worth_ to a
subsidy claim is policy that varies by rule and by year — the reference keeps
that number out of the model for exactly that reason, and Phase 3 owns it.
Nothing in this plan computes money. (It is also why `HALF_DAY` costs nothing to
drop: a half-day only ever meant a funding fraction.)

---

## 7. Migration

Per CLAUDE.md §3.3 the generated SQL gets read by hand before it is applied. Two
things to check specifically:

1. **The partial unique index must be hand-written.** Prisma cannot express
   `WHERE "deletedAt" IS NULL`, so `prisma migrate dev` will emit a plain unique
   constraint. It has to be replaced with:
   ```sql
   CREATE UNIQUE INDEX "attendance_one_row_per_enrollment_per_day"
     ON "attendance" ("enrollmentId", "date") WHERE "deletedAt" IS NULL;
   ```
   With the plain constraint, a soft-deleted day can never be re-recorded.
2. No `DROP` of any kind. This migration is purely additive.

---

## 8. API surface

```
GET   /groups/:id/attendance?date=YYYY-MM-DD   the day sheet for a group
PUT   /groups/:id/attendance                   record/correct a whole day
GET   /children/:id/attendance?from=&to=       one child's range
GET   /dashboard/teacher                       += todayAttendance { present, total }
```

`PUT` rather than `POST`, because the operation is idempotent by design.

The dashboard KPI is the last step, not the first — it is one aggregate over a
table that must exist and be trusted before a number drawn from it means
anything.

---

## 9. Decisions taken — 2026-08-25

| Question            | Decision                                                                           |
| ------------------- | ---------------------------------------------------------------------------------- |
| `deletedById`       | Dropped. Rely on `AuditLog`; CLAUDE.md §3.2 amended in this PR.                    |
| Guardian visibility | **Yes** — their own child's range only, read-only. Group sheet stays staff-only.   |
| Correction lock     | **7 days**, rolling from the attendance date, then permanent. No override.         |
| Statuses            | `HALF_DAY` dropped. **Five**: `PRESENT` · `ABSENT` · `SICK` · `EXCUSED` · `OTHER`. |

`OTHER` was dropped and reinstated within the day. The argument that settled it:
a closed vocabulary does not make an unusual day disappear, it makes that day get
counted under a status which misstates it — and a `note` cannot undo this,
because a note explains one row and never reaches an aggregate. A vocabulary with
no escape hatch yields confidently wrong totals rather than clean ones.

## 10. Explicitly out of scope

Meal calculation · funding claims · state subsidy reports · monthly finance
export · medication reminders · temperature and health checks recorded at the
morning register (RFP line 972 pairs these with attendance — they are a separate
model and a separate decision).

This plan builds the table, the register, and one honest dashboard number.
Nothing else reads it yet.

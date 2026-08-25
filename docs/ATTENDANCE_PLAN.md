# Attendance — technical scoping

**Status: proposal for review. No code written.**

Pulled forward from RFP Module 2 on 2026-08-25, after the dashboard KPI was
requested five times and declined five times for want of a model. The decision
is to build the model properly rather than fake the number.

The business rules below are **not invented**. `../ByatshanNuudelchid/apps/attendance`
is a complete, tested implementation, and CLAUDE.md names the Django project the
source of truth for business rules, validation and authorization. This plan ports
its *reasoning*; it does not port its structure.

---

## 1. The decision everything else follows from

**Attendance hangs off `Enrollment`, never off `Child`.**

The reference states it plainly, and it is the one choice that is expensive to
reverse:

> A child who transfers in January has two enrollments, and their March
> attendance belongs to whichever kindergarten they actually attended. Pointing
> at `Child` would attribute the whole year to wherever the child is *now*.

`Child.kindergartenId` is a denormalised "currently attending" pointer —
CLAUDE.md §1.2 already forbids using it for authorization, and this is the same
hazard with a date attached. A transfer would silently rewrite history.

`childId` is still stored, denormalised, so "this child's month" is a range scan
rather than a join. The enrollment stays the authority for *which kindergarten a
day belongs to*; the child column is for lookup and display only.

---

## 2. Proposed schema

```prisma
/// The six states are a closed vocabulary from the requirement, not
/// configuration. Contrast `DevelopmentDomain`, which is a table because a
/// kindergarten invents its own — CLAUDE.md §2.3 permits an enum exactly here.
enum AttendanceStatus {
  PRESENT   // Ирсэн
  EXCUSED   // Чөлөөтэй
  SICK      // Өвчтэй
  ABSENT    // Тасалсан
  HALF_DAY  // Хагас өдөр
  OTHER     // Бусад — the escape hatch, so an unusual day is not forced
            // into a wrong category
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

## 4. Soft delete — and a rule the schema does not currently keep

CLAUDE.md §3.2: *"Set `deletedAt` and `deletedById`."*

**No model in this schema has `deletedById`. Zero of them.** The rule and the
code have disagreed since the beginning, and a new table forces the question.

Three options, and I recommend the third:

| | Approach | Cost |
|---|---|---|
| A | Add `deletedById` to `Attendance` only | One table follows the rule, thirty do not — the inconsistency becomes deliberate rather than historical |
| B | Add it everywhere | A migration across every table, for a fact already recorded elsewhere |
| C | **Rely on `AuditLog`, and correct §3.2** | `AuditLog` already stores `actorUserId` + `action: DELETE` + `objectId`, append-only, and is the *better* home — a mutable column can be overwritten, an audit row cannot |

**Recommendation: C.** The deletion actor is already captured, more durably than
a column would capture it. What is wrong is the rule's wording, not the schema.
I would amend CLAUDE.md §3.2 in the same PR rather than leave a mandatory rule
that nothing obeys — that is how rules stop being read.

**This needs your decision before I write the migration.**

The `recordedById` column above is separate and is *not* soft-delete metadata:
it answers "whose register is this", which the teacher's screen shows.

---

## 5. Authorization

Every read and write goes through `apps/api/src/authz/` (CLAUDE.md §1.1). No new
authorization concepts — attendance reuses `canAccessChild` via the enrollment's
child.

| Actor | May |
|---|---|
| Teacher assigned to the group | Read and write that group's attendance |
| Teacher not assigned | **404** — not 403 |
| Admin of the kindergarten | Read and write |
| Guardian | *Open question — see §9* |
| Any other kindergarten | **404** |

Two rules carried directly from the reference:

**Enrollment ids are resolved against the group, never trusted from the body.**
The group-day endpoint receives a map of enrollment id → status. Each id is
looked up *within the authorized group*; anything not in it is ignored rather
than written. A POST body is written by whoever sends it, and the alternative
writes attendance for another kindergarten's child.

**404, never 403** (CLAUDE.md §1.7), including for a group in another
kindergarten. The mandatory three tests from §4.1 apply, plus a fourth:

```
teacher from another kindergarten          → 404
teacher assigned to no group containing it → 404
guardian of another child                  → 404
enrollment id from another group in body   → ignored, not written
```

---

## 6. Business rules

**No future dates.** The reference refuses them, with the reason: *"Recording the
future is how a month's funding gets claimed before the children have attended
it."* A `400` with a Mongolian message.

**Writing is idempotent per day.** Re-submitting the register corrects the
existing rows rather than adding a second set. One transaction for a whole group
— *"a sheet that saved eleven of twelve children would leave the twelfth silently
unfunded, and the teacher would have no way to tell."*

**A no-op writes no audit row.** If status and note are unchanged, return early.
Otherwise every re-save of the sheet buries the real corrections under a pile of
identical entries.

**A correction records what it changed *from*.** RFP §14 asks for
`Хэн → Хэзээ → Юу → Өмнөх утга → Шинэ утга`. Creating is an ordinary `CREATE`
audit row; amending carries `previousStatus` and `newStatus` in the audit
metadata. This is the entry a later reconciliation has to be able to explain.

**Funding value is deliberately absent.** What "Хагас өдөр" is *worth* is policy
that varies by rule and by year. The reference keeps it out of this model for
that reason, and Phase 3 owns it. Nothing in this plan computes money.

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

## 9. Open questions — I need answers before building

1. **`deletedById` (§4).** Option C, and amend CLAUDE.md? This is the only one
   that blocks the migration.
2. **Do guardians see their own child's attendance?** The reference's screens are
   teacher-only. It is plausible and cheap, but it is a product decision with a
   privacy edge — a parent seeing "Тасалсан" against a day they thought was
   excused will generate a phone call. Default if you have no preference: **no**,
   staff only, revisit later.
3. **Is there a lock window?** The reference allows correcting any past day
   indefinitely. Once attendance feeds funding, most systems freeze a month after
   it is claimed. Not needed for the MVP; worth knowing whether to leave room.
4. **Half-day semantics.** `HALF_DAY` exists in the vocabulary. Does the
   kindergarten actually use it, or is it vestigial? It costs nothing to include
   and is confusing to show if unused.

---

## 10. Explicitly out of scope

Meal calculation · funding claims · state subsidy reports · monthly finance
export · medication reminders · temperature and health checks recorded at the
morning register (RFP line 972 pairs these with attendance — they are a separate
model and a separate decision).

This plan builds the table, the register, and one honest dashboard number.
Nothing else reads it yet.

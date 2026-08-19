# DATABASE.md — MVP data model

**Stack:** PostgreSQL 17 + Prisma
**Status:** design only. No `schema.prisma`, no migrations exist yet.
**Reference system:** the Django project at `../ByatshanNuudelchid` (37 models).
This document is a redesign, not a transcription — see
[MIGRATION_PLAN.md](MIGRATION_PLAN.md) for what was kept, changed and dropped.

**28 tables.** The reference system has 37. The reduction is deliberate and each
removal is justified in §9.

---

## 1. Conventions

| Rule           | Decision                                                          |
| -------------- | ----------------------------------------------------------------- |
| Primary key    | `String @id @default(uuid()) @db.Uuid`                            |
| Timestamps     | `createdAt`, `updatedAt` on every table                           |
| Authorship     | **not carried as columns** — see §1.4                             |
| Soft delete    | `deletedAt DateTime?`, `deletedById String?`                      |
| Tenant column  | `kindergartenId` on every tenant-scoped table, **denormalised**   |
| Naming         | `camelCase` fields in Prisma, `snake_case` in Postgres via `@map` |
| Money/decimals | none in MVP                                                       |

### 1.1 Why `kindergartenId` is denormalised onto every table

It is reachable through relations on most tables, so it is redundant in the
normal-form sense. It is carried anyway because tenant isolation then costs one
`WHERE` clause per query instead of a three-join traversal that somebody
eventually forgets to write. This is the single most load-bearing schema
decision for security; it is inherited from the reference system, where it
backs RFP §3.2.

### 1.2 Soft delete is not free in Prisma

Django's ORM hid deleted rows behind a custom manager. Prisma has no equivalent,
so **every query must filter `deletedAt: null` explicitly.** The mitigation is
architectural, not schema-level: repositories are the only layer allowed to call
`prisma.*`, and each exposes a base filter. See
[ARCHITECTURE.md](ARCHITECTURE.md) §4.

This is a real regression against the reference system and the most likely place
for a data leak to appear. It is listed as a risk.

### 1.3 UUIDs, not sequential integers

The reference system uses integer PKs and relies on `can_access_child()` to stop
enumeration; it has 128 tests asserting that a wrong id returns 404. UUIDs do not
replace those checks — they reduce the damage when one is missing. Both.

### 1.4 Authorship columns are deliberately absent

The reference system carries `created_by`, `updated_by` and `deleted_by` on
every table, inherited from its `BaseModel`. This schema does not, and the
decision was made when the first soft delete was written rather than by
omission.

**`AuditLog` already answers "who did this", for every action, with more
context** — the actor, their role, their name as text (so a deleted user's
actions stay attributable), the IP, and the affected child. Adding three
nullable FK columns to 25 tables would duplicate a subset of that, and two
records of the same fact drift: the audit row is written by the service, the
column by whoever remembered to pass an actor id.

Where authorship is part of the _domain_ rather than the audit trail, it is an
explicit named column: `Observation.reviewedById`, `Assessment.assessedById`,
`TermReport.authorId`, `Notification.authorId`. Those are shown in the UI and
mean something to a teacher; a generic `updatedById` does not.

**Consequence:** "who last edited this group" requires an `AuditLog` query
rather than a column read. That is the correct trade — it is a rare admin
question, not a hot path.

---

## 2. Entity map

```
Kindergarten ─┬─ SchoolYear ─── Group ─── GroupTeacher ─── Membership ─── User
              │                   │
              │                   └─ Enrollment ─── Child ─┬─ Guardianship ─── User
              │                                            │
              ├─ DevelopmentDomain ──┐                     ├─ ChildProfile (1:1)
              ├─ AssessmentLevel ────┤                     ├─ ChildAgeProfile (2–5)
              ├─ ObservationType ────┤                     ├─ BirthdayNote
              │                      │                     │
              ├─ Term ───────────────┼─ Assessment ────────┤
              │                      │  TermReport ────────┤
              │                      │                     │
              │                      └─ Observation ───────┤
              │                           └ ObservationDomain
              │                                            │
              ├─ MediaFile ────────────────────────────────┤
              ├─ Notification ─ NotificationTarget ────────┘
              │                 NotificationRead ─── User
              ├─ ReportJob
              └─ AuditLog

           AuthToken ─── User
           LoginAttempt (no FK — identifier is free text)
```

---

## 3. Identity and access (4 tables)

### 3.1 `User`

**Purpose:** one login. **Owner:** the platform, not a kindergarten — a user may
hold roles in more than one kindergarten. **Authorization boundary:** none by
itself; all authority comes from `Membership`.

| Field                                 | Type                  | Notes                                        |
| ------------------------------------- | --------------------- | -------------------------------------------- |
| `id`                                  | uuid                  |                                              |
| `username`                            | string, unique        | login identifier                             |
| `email`                               | string?, unique       |                                              |
| `phone`                               | string?, unique       | Mongolian numbers; used for account recovery |
| `passwordHash`                        | string                | argon2id — see [SECURITY.md](SECURITY.md) §2 |
| `lastName`, `firstName`               | string                |                                              |
| `isActive`                            | boolean, default true |                                              |
| `lastLoginAt`                         | datetime?             |                                              |
| `createdAt`, `updatedAt`, `deletedAt` |                       |                                              |

**Indexes:** unique on `username`, `email`, `phone`.

> **No `role` column.** Role lives on `Membership` because the same person can
> be a teacher in one kindergarten and a parent in another — the reference
> system already models it this way and its tests depend on it.

### 3.2 `Membership` ★ security-critical

**Purpose:** grants a user a role inside one kindergarten. This is the **only**
source of authority in the system.

| Field            | Type                                  | Notes                             |
| ---------------- | ------------------------------------- | --------------------------------- |
| `userId`         | uuid → User                           | cascade                           |
| `kindergartenId` | uuid → Kindergarten                   | restrict                          |
| `role`           | enum `ADMIN` \| `TEACHER` \| `PARENT` | see §8 on why this one is an enum |
| `isActive`       | boolean, default true                 | revocation without deletion       |
| `startedOn`      | date?                                 |                                   |

**Constraints:** unique `(userId, kindergartenId, role)` where `deletedAt IS NULL`.
**Indexes:** `(userId, isActive)`, `(kindergartenId, role, isActive)`.

**Cardinality:** User 1—N Membership N—1 Kindergarten.

**Why this table answers a gap in the brief.** The brief's §5 specifies the
teacher chain (`User → GroupTeacher → Group → Enrollment → Child`) and the
parent chain (`User → Guardianship → Child`), but gives admins no chain at all.
`Membership` is that chain: an admin sees exactly the kindergartens where they
hold an active `ADMIN` membership. Without it, cross-kindergarten isolation for
admins has no mechanism.

### 3.3 `AuthToken`

**Purpose:** one-time tokens for password reset and account activation.

| Field         | Type                                  | Notes                                            |
| ------------- | ------------------------------------- | ------------------------------------------------ |
| `userId`      | uuid → User                           | cascade                                          |
| `purpose`     | enum `PASSWORD_RESET` \| `INVITATION` |                                                  |
| `tokenHash`   | string, unique                        | **SHA-256 of the token; never the token itself** |
| `expiresAt`   | datetime                              |                                                  |
| `usedAt`      | datetime?                             | single use                                       |
| `requestedIp` | string?                               |                                                  |

**Merged from two reference tables** (`PasswordResetToken`, `Invitation`). They
had identical mechanics — hashed single-use token with an expiry — and differed
only in what the landing page does. A `purpose` discriminator is enough for the
MVP. The reference `Invitation.codeHash` (a short SMS code alongside the link) is
**dropped**: MVP has no SMS.

### 3.4 `LoginAttempt`

**Purpose:** brute-force lockout — 5 failures in 15 minutes.

| Field        | Type     | Notes                                                                     |
| ------------ | -------- | ------------------------------------------------------------------------- |
| `identifier` | string   | what was typed, not a FK — failures for non-existent users must count too |
| `ipAddress`  | string?  |                                                                           |
| `succeeded`  | boolean  |                                                                           |
| `createdAt`  | datetime |                                                                           |

**Indexes:** `(identifier, succeeded, createdAt desc)`, `(ipAddress, succeeded, createdAt desc)`.

> **Must survive a failed request.** In the reference system this required
> opting out of `ATOMIC_REQUESTS`. Nest has no implicit request transaction, so
> the rule becomes: **write `LoginAttempt` outside any interactive transaction.**
> If it is rolled back with the request, the lockout counter silently resets.

---

## 4. Tenancy (4 tables)

### 4.1 `Kindergarten`

`name`, `address`, `phone`, `email`, `description`, `isActive`. Root of every
authorization boundary. Nothing above it.

### 4.2 `SchoolYear`

`kindergartenId`, `name` (e.g. `2025-2026`), `startsOn`, `endsOn`, `isCurrent`.
**Constraint:** only one `isCurrent = true` per kindergarten (partial unique index).

### 4.3 `Group`

`kindergartenId`, `schoolYearId`, `name`, `ageBand`, `status`.
**Constraint:** unique `(schoolYearId, name)` among non-deleted rows.
**Indexes:** `(kindergartenId, status)`.

`ageBand` stays an enum (`JUNIOR` … `PREP`) — it is a Mongolian preschool
structure, not something an administrator configures.

### 4.4 `GroupTeacher` ★ security-critical

**Purpose:** assigns a teacher to a group for a period. **The teacher half of the
authorization graph.**

| Field                  | Type                       | Notes                                                                 |
| ---------------------- | -------------------------- | --------------------------------------------------------------------- |
| `groupId`              | uuid → Group               |                                                                       |
| `membershipId`         | uuid → Membership          | **not `userId`** — the assignment is of a _role in this kindergarten_ |
| `role`                 | enum `LEAD` \| `ASSISTANT` |                                                                       |
| `startedOn`, `endedOn` | date?                      | `endedOn` set = access revoked                                        |

**Indexes:** `(groupId, membershipId)`, `(membershipId, endedOn)`.

Pointing at `Membership` rather than `User` makes it structurally impossible to
assign a teacher to a group in a kindergarten they have no membership in.

---

## 5. Children (3 tables)

### 5.1 `Child`

| Field                   | Type                        | Notes                                                          |
| ----------------------- | --------------------------- | -------------------------------------------------------------- |
| `kindergartenId`        | uuid                        | **denormalised "currently attending"** — see the warning below |
| `lastName`, `firstName` | string                      |                                                                |
| `nationalId`            | string?                     | unique per kindergarten where present                          |
| `sex`                   | enum                        |                                                                |
| `dateOfBirth`           | date                        |                                                                |
| `status`                | enum `ACTIVE` \| `ARCHIVED` |                                                                |
| `photoMediaFileId`      | uuid? → MediaFile           |                                                                |

**Indexes:** `(kindergartenId, status)`, `(kindergartenId, lastName, firstName)`,
`(kindergartenId, dateOfBirth)`.

> ### `Child.kindergartenId` is for listing and filtering. It is **not** an
>
> ### authorization input.
>
> Authorization resolves the kindergarten from `Enrollment` history. If it read
> this column instead, a teacher would lose access to observations they wrote
> themselves the moment a child transfers. There is exactly **one** exception,
> carried over deliberately: when a child has _no enrollments at all_, fall back
> to this column so the staff who just registered the child are not locked out
> of the record they are still filling in. Once any enrollment exists the column
> is never read again. See [SECURITY.md](SECURITY.md) §5.2.

### 5.2 `Guardianship` ★ security-critical

`childId`, `guardianUserId`, `relation` (enum), `isPrimary`, `canView`,
`kindergartenId`.

**Constraint:** unique `(childId, guardianUserId)` among non-deleted rows.
**Indexes:** `(guardianUserId, canView)`, `(childId)`.

`canView = false` revokes a parent's access **without destroying the record of
the relationship** — needed for custody changes. The reference suite has two
tests specifically for revoked guardians.

### 5.3 `Enrollment` ★ security-critical

`childId`, `groupId`, `schoolYearId`, `startedOn`, `endedOn?`, `status`,
`kindergartenId`.

**Constraint:** at most one `status = ACTIVE` enrollment per `(childId, schoolYearId)`.
**Indexes:** `(groupId, status)`, `(schoolYearId, status)`, `(childId, schoolYearId)`.

**This table is the child's history.** It answers "which kindergartens has this
child ever attended" and therefore "who may see this child's records". Rows are
never deleted, only ended.

---

## 6. Portfolio (3 tables)

### 6.1 `ChildProfile` — "Миний тухай"

1:1 with `Child`. `introduction`, `nameMeaning`, `memorableSayings`, `dream`,
`distinguishingTraits`, `heightCm`, `weightKg`, `recordedOn`.

### 6.2 `ChildAgeProfile` — ages 2–5

`childId`, `age` (2–5), `schoolYearId?`, plus the favourites and free-text
fields (`favoriteColor`, `favoriteFood`, `favoriteToy`, `favoriteBook`,
`favoriteSong`, `favoriteStory`, `favoriteActivity`, `personality`,
`emotionalTraits`, `familyMembers`, `learningInterest`, `newSkills`,
`parentNote`, `teacherNote`).

**Constraint:** unique `(childId, age)`.

> The reference system has 18 such columns. They are kept as columns rather than
> collapsed into JSON because the PDF report renders them as a labelled list and
> the admin edits them as a form — both want named, typed fields. Two rarely used
> reference columns (`favoriteMovie`, `favoriteClothes`) are dropped.

### 6.3 `BirthdayNote`

`childId`, `age`, `note`. Constraint: unique `(childId, age)`.

---

## 7. Configuration — admin-editable (3 tables)

These exist as **tables, never enums**, because an administrator edits them.
This is a hard requirement, not a preference.

### 7.1 `DevelopmentDomain`

`kindergartenId?` (**null = system default, shared by all**), `name`, `code`,
`order`, `color`, `description`, `isActive`.

**Constraints:** unique `(kindergartenId, code)`; unique `(code)` where
`kindergartenId IS NULL`.

The nullable tenant column is the mechanism for "ships with sensible defaults,
each kindergarten may override". A kindergarten admin may create and edit their
own rows; they may **not** edit a system row — the reference suite tests exactly
this (`test_a_director_cannot_open_a_system_domains_edit_form`).

### 7.2 `AssessmentLevel`

`kindergartenId?`, `value` (1–4), `label`, `color`, `description`, `order`.
**Constraint:** unique `(kindergartenId, value)`.

> **Decision — `AssessmentScale` is dropped.** The reference system has
> `AssessmentScale → AssessmentLevel`, allowing several named scales per
> kindergarten with one marked default. Nothing in the MVP uses a second scale;
> every screen resolves the default. Levels therefore hang directly off the
> kindergarten. **Consequence:** supporting multiple scales later means a
> migration that reintroduces the parent table. Accepted for the MVP.
> _Requires your approval._

### 7.3 `ObservationType`

`kindergartenId?`, `name`, `code`, `order`, `isActive`. Same system/override
pattern.

> **`DevelopmentIndicator` is dropped.** The reference system can attach a
> specific indicator under a domain to an assessment; the column is nullable and
> the MVP screens assess at domain level only. Dropping it removes a table and a
> nullable FK. _Requires your approval._

---

## 8. Where enums are allowed

| Concept                                             | Representation | Why                                                |
| --------------------------------------------------- | -------------- | -------------------------------------------------- |
| `Role`                                              | enum           | System-level. Adding a role changes code, not data |
| `Child.status`, `Group.status`, `Enrollment.status` | enum           | Record lifecycle                                   |
| `Observation.source`, `.reviewStatus`               | enum           | Workflow states                                    |
| `MediaFile.status`                                  | enum           | Storage lifecycle                                  |
| `ReportJob.status`                                  | enum           | Job lifecycle                                      |
| `Group.ageBand`                                     | enum           | Fixed by the Mongolian preschool system            |
| **Development domains**                             | **table**      | Administrator-editable                             |
| **Assessment levels**                               | **table**      | Administrator-editable                             |
| **Observation types**                               | **table**      | Administrator-editable                             |

---

## 9. Observation and assessment (6 tables)

### 9.1 `Observation`

`kindergartenId`, `childId`, `enrollmentId`, `typeId`, `source`
(`TEACHER` \| `PARENT`), `observedOn`, `activityName`, `situation`, `childDid`,
`childSaid`, `teacherComment`, `nextSteps`, `visibleToParents` (**default
false**), `includeInReport`, `reviewStatus`, `reviewedById?`, `reviewedAt?`,
`reviewNote`.

**Indexes:** `(childId, observedOn desc)`, `(kindergartenId, observedOn desc)`,
`(enrollmentId, observedOn desc)`, `(source, reviewStatus)`.

`enrollmentId` pins the observation to the group and school year it was written
in, so a later transfer does not rewrite history.

`visibleToParents` defaults to **false**. A teacher's working note is private
until deliberately shared. The reference suite tests that a guardian cannot see
a hidden observation.

### 9.2 `ObservationDomain`

Join: `observationId`, `domainId`, optional `levelId`. Unique
`(observationId, domainId)`.

### 9.3 `Term`

`kindergartenId`, `schoolYearId`, `number` (1–3), `name`, `startsOn`, `endsOn`.
Unique `(schoolYearId, number)`.

> **Answers a gap in the brief.** §2 requires "term-based assessment" and §11
> lists assessment routes, but no `Term` entity appears in §4's list. Without it
> an assessment has no period to belong to and the term report has nothing to
> aggregate over.

### 9.4 `Assessment`

`kindergartenId`, `childId`, `enrollmentId`, `domainId`, `termId`, `levelId`,
`comment`, `visibleToParents`, `assessedById`, `assessedAt`.
**Constraint:** unique `(childId, termId, domainId)`.
**Indexes:** `(childId, termId)`, `(kindergartenId, termId)`, `(enrollmentId, termId)`.

### 9.5 `TermReport`

`kindergartenId`, `childId`, `enrollmentId`, `termId`, `strengths`,
`needsSupport`, `nextGoals`, `adviceForParents`, `authorId`, `status`
(`DRAFT` \| `FINAL`), `finalizedAt?`. Unique `(childId, termId)`.

---

## 10. Media (1 table)

### 10.1 `MediaFile` ★ security-critical

| Field                          | Type                                                   | Notes                                             |
| ------------------------------ | ------------------------------------------------------ | ------------------------------------------------- |
| `kindergartenId`               | uuid                                                   | tenant filter                                     |
| `childId`                      | uuid?                                                  | the authorization anchor                          |
| `observationId`                | uuid?                                                  | set when attached to an observation               |
| `order`                        | int, default 0                                         | gallery ordering within an observation            |
| `purpose`                      | enum `CHILD_PHOTO` \| `OBSERVATION` \| `REPORT_OUTPUT` |                                                   |
| `storageKey`                   | string, unique                                         | **random UUID path** — `children/{uuid}/{uuid}`   |
| `originalName`                 | string                                                 | display only; never used to build a path          |
| `mimeType`                     | string                                                 | **detected from content**, not from the extension |
| `sizeBytes`, `width`, `height` | int                                                    |                                                   |
| `checksum`                     | string                                                 | sha256, for duplicate detection                   |
| `status`                       | enum `READY` \| `ARCHIVED`                             | archived files stop being served                  |

**Indexes:** `(childId, purpose, uploadedAt desc)`, `(kindergartenId, uploadedAt desc)`,
`(observationId, order)`.

> **Decision — the `ObservationMedia` join table is dropped.** The reference
> system uses a join so one file could be attached to several observations;
> nothing in the MVP does that. A nullable `observationId` plus `order` on
> `MediaFile` covers every MVP screen with one table fewer.
> **Consequence:** a file cannot be shared between two observations without a
> migration. _Requires your approval._

`storageKey` is never derived from `originalName`, and `originalName` is never
used to build a URL. See [SECURITY.md](SECURITY.md) §7.

---

## 11. Notifications (3 tables)

### 11.1 `Notification`

`kindergartenId`, `title`, `body`, `startsOn?`, `endsOn?`, `isImportant`,
`status` (`DRAFT` \| `PUBLISHED`), `publishedAt?`, `authorId`.
**Index:** `(kindergartenId, status, publishedAt desc)`.

### 11.2 `NotificationTarget`

`notificationId`, `groupId?`, `childId?`. **Both null = the whole kindergarten.**

> **Answers a gap in the brief.** §4 lists `Notification` and `NotificationRead`
> only. Without a target table, every notice goes to every parent in the
> kindergarten — a teacher could not send "your child forgot their coat" to one
> family. Targeting granularity is kindergarten / group / child.
> _Requires your approval._

### 11.3 `NotificationRead`

`notificationId`, `userId`, `readAt`. Unique `(notificationId, userId)`.
Append-only; no soft delete.

---

## 12. Reports and audit (2 tables)

### 12.1 `ReportJob`

`kindergartenId`, `childId?`, `type`, `params` (jsonb), `requestedById`,
`status` (`QUEUED` \| `RUNNING` \| `DONE` \| `FAILED`), `progressPercent`,
`resultMediaFileId?`, `fileSize`, `pageCount`, `errorMessage`, `requestedAt`,
`startedAt?`, `completedAt?`, `expiresAt?`.
**Indexes:** `(childId, requestedAt desc)`, `(kindergartenId, status, requestedAt desc)`.

A finished report is a `MediaFile` like any other, so it inherits the same
private-bucket + presigned-URL path. The reference suite asserts that an
outsider cannot fetch a finished PDF even with the job id.

### 12.2 `AuditLog` — append-only

`kindergartenId?`, `actorUserId?`, `actorRole`, `actorLabel`, `action`,
`objectType`, `objectId`, `childId?`, `ipAddress`, `userAgent`, `metadata` (jsonb),
`createdAt`.
**Indexes:** `(childId, createdAt desc)`, `(actorUserId, createdAt desc)`,
`(kindergartenId, createdAt desc)`, `(action, createdAt desc)`.

**The only table with no soft delete, no `updatedAt` and no authorship columns.**
A record that can be edited is not an audit record. Enforced at the repository
layer: the audit repository exposes `append()` and nothing else.

`actorLabel` stores the user's name as a plain string so a deleted user's
actions remain attributable.

`view` is recorded selectively — opening a child's portfolio, viewing a report,
downloading a file — not on every page load.

---

## 13. Index summary

Beyond primary keys and the uniques already listed:

| Table          | Index                                        | Serves                                          |
| -------------- | -------------------------------------------- | ----------------------------------------------- |
| `Membership`   | `(userId, isActive)`                         | every request — resolving the actor's authority |
| `Membership`   | `(kindergartenId, role, isActive)`           | admin/teacher lists                             |
| `GroupTeacher` | `(membershipId, endedOn)`                    | "which groups is this teacher in"               |
| `Enrollment`   | `(childId, schoolYearId)`                    | the authorization lookup                        |
| `Enrollment`   | `(groupId, status)`                          | group roster                                    |
| `Guardianship` | `(guardianUserId, canView)`                  | parent's child list                             |
| `Child`        | `(kindergartenId, status)`                   | child list                                      |
| `Child`        | `(kindergartenId, lastName, firstName)`      | name search                                     |
| `Observation`  | `(childId, observedOn desc)`                 | child timeline                                  |
| `Assessment`   | `(childId, termId)`                          | term matrix                                     |
| `MediaFile`    | `(childId, purpose, uploadedAt desc)`        | gallery                                         |
| `Notification` | `(kindergartenId, status, publishedAt desc)` | parent home                                     |
| `AuditLog`     | `(childId, createdAt desc)`                  | "who accessed this child"                       |

Every list endpoint is paginated. No endpoint returns an unbounded set.

---

## 14. Decision record

Settled 2026-08-19. All approved as proposed.

| #   | Decision                                                                     | Outcome                                                                                            |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| D3  | Drop `AssessmentScale`, hang levels off the kindergarten                     | **Approved** — §7.2                                                                                |
| D4  | Drop `DevelopmentIndicator`, assess at the configured domain/level structure | **Approved** — §7.3                                                                                |
| D5  | Drop `ObservationMedia`, use `MediaFile.observationId`                       | **Approved** — §10.1                                                                               |
| D6  | Merge `Invitation` + `PasswordResetToken` into `AuthToken`                   | **Approved**, on the condition that `purpose` stays explicit and the token is stored hashed — §3.3 |
| D7  | Keep `NotificationTarget` (kindergarten / group / child)                     | **Approved** — §11.2                                                                               |
| D8  | Keep the no-enrollment fallback on `Child.kindergartenId`                    | **Approved**, with the trigger condition pinned in [SECURITY.md](SECURITY.md) §5.2                 |
| D9  | Drop `favoriteMovie` / `favoriteClothes`                                     | **Approved** — §6.2                                                                                |
| D12 | Do not migrate `django-simple-history` row history                           | **Approved** — `AuditLog` is sufficient for Phase 1                                                |

Security and infrastructure decisions D1, D2, D10, D11 and the open D13 are
recorded in [SECURITY.md](SECURITY.md) §16.

**The table count stands at 28.**

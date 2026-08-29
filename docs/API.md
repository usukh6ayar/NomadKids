# API.md — REST design

**Status:** implemented through Phase 10 (auth, tenants, users, children,
portfolio, observations, media, assessment, notifications, dashboard, audit,
reports). Sections 11 and 12b describe shipped routes; a full reconciliation
against the route map is scheduled before Phase 11.

**2026-08-22:** §12 (administrator-editable configuration) is now implemented,
at routes that differ from the shape this document proposed for it — the
reasoning is at the end of that section. §8 (media) gained pagination and album
metadata.
**Base:** `https://api.<domain>/v1`

---

## 1. Conventions

| Concern    | Decision                                                            |
| ---------- | ------------------------------------------------------------------- |
| Auth       | HttpOnly cookies; `credentials: "include"` on every call            |
| CSRF       | `X-CSRF-Token` header on every unsafe method                        |
| Ids        | UUID v4                                                             |
| Dates      | ISO-8601; dates without time as `YYYY-MM-DD`                        |
| Lists      | **always paginated** — `?page=1&pageSize=25`, max 100               |
| Errors     | RFC 7807 problem+json: `{ type, title, status, detail, requestId }` |
| Validation | Zod schemas from `packages/contracts`, shared with the web app      |
| Docs       | OpenAPI generated from the Nest decorators at `/v1/docs`            |

### 1.1 Status codes

| Code            | Meaning                                                                           |
| --------------- | --------------------------------------------------------------------------------- |
| 200 / 201 / 204 | success                                                                           |
| 400             | validation failed — body lists field errors                                       |
| 401             | not authenticated                                                                 |
| 403             | CSRF or origin rejection only — **never** an authorization outcome                |
| **404**         | **resource absent OR not permitted for this actor — child data always uses this** |
| 409             | conflict (duplicate, state violation)                                             |
| 413             | upload too large                                                                  |
| 429             | rate limited                                                                      |

**404 is the answer for every authorization failure**, not only for child data.
A 403 confirms the resource exists; absent and forbidden must be
indistinguishable.

This applies uniformly — a wrong-role user on an admin screen gets 404, the same
as a guardian reaching for another family's child. Two reasons:

- The reference implementation is uniformly 404, including for role gates
  (`test_a_teacher_cannot_reach_the_admin_screens` asserts 404). Those tests are
  the acceptance criteria, and D2 settled that authorization semantics do not
  change during the migration.
- One rule cannot be got wrong endpoint by endpoint. As soon as 403 and 404 both
  appear, every new route becomes a judgement call — and the difference between
  them is precisely the signal an attacker probes for.

403 survives for exactly one thing: a rejected CSRF token or a disallowed
`Origin`. That is a malformed request, not an authorization decision, and
conflating it with one would make a genuine CSRF failure indistinguishable from
a missing record while debugging.

See [SECURITY.md](SECURITY.md) §5.4.

### 1.2 The ownership column

Every route below names an ownership rule. These resolve to the two chains in
[SECURITY.md](SECURITY.md) §5.1:

| Shorthand     | Meaning                                                         |
| ------------- | --------------------------------------------------------------- |
| `—`           | none beyond the role                                            |
| `kg`          | actor holds an active membership in the resource's kindergarten |
| `kg:admin`    | active **ADMIN** membership in that kindergarten                |
| `child`       | `canAccessChild(actor, child)` — read                           |
| `child:write` | `canRecordForChild(actor, child)` — teachers and admins only    |
| `self`        | the resource belongs to the authenticated user                  |
| `sa`          | `User.isSuperAdmin` — platform level, no kindergarten at all    |

---

## 2. Auth

| Method | Route                          | Role   | Ownership      | Request                | Response                                                 |
| ------ | ------------------------------ | ------ | -------------- | ---------------------- | -------------------------------------------------------- |
| POST   | `/auth/login`                  | public | —              | identifier + password  | user summary + memberships; sets both cookies            |
| POST   | `/auth/refresh`                | public | refresh cookie | —                      | rotates refresh, sets new access cookie                  |
| POST   | `/auth/logout`                 | any    | self           | —                      | 204; revokes the refresh family                          |
| GET    | `/auth/me`                     | any    | self           | —                      | user, memberships, active role, CSRF token               |
| POST   | `/auth/password-reset`         | public | —              | identifier             | 204 **always** — timing-neutral, never reveals existence |
| POST   | `/auth/password-reset/confirm` | public | token          | token + new password   | 204                                                      |
| POST   | `/auth/invitation/accept`      | public | token          | token + password       | 204; activates the account                               |
| PATCH  | `/auth/password`               | any    | self           | current + new password | 204; revokes all other sessions                          |

Rate limits in [SECURITY.md](SECURITY.md) §9.

---

## 3. Users and profile

| Method | Route                         | Role  | Ownership | Request                  | Response                                 |
| ------ | ----------------------------- | ----- | --------- | ------------------------ | ---------------------------------------- |
| GET    | `/users`                      | admin | kg:admin  | `?role&q&isActive&page`  | paginated user summaries                 |
| POST   | `/users`                      | admin | kg:admin  | names, contact, role     | created user; issues an invitation       |
| GET    | `/users/:id`                  | admin | kg:admin  | —                        | user + memberships                       |
| PATCH  | `/users/:id`                  | admin | kg:admin  | names, contact, isActive | updated user                             |
| POST   | `/users/:id/memberships`      | admin | kg:admin  | kindergartenId, role     | membership                               |
| DELETE | `/users/:id/memberships/:mid` | admin | kg:admin  | —                        | 204; **deactivates**, never hard-deletes |
| GET    | `/me/profile`                 | any   | self      | —                        | own profile                              |
| PATCH  | `/me/profile`                 | any   | self      | names, contact, bio      | updated profile                          |

Deactivating a membership is how a teacher or guardian loses access. Reference
tests: `test_a_revoked_teacher_gets_404_on_the_child_detail`,
`test_a_revoked_guardian_cannot_open_the_child_page`.

---

## 4. Kindergarten, school year, group

| Method | Route                             | Role           | Ownership                        | Request                     | Response                                |
| ------ | --------------------------------- | -------------- | -------------------------------- | --------------------------- | --------------------------------------- |
| GET    | `/kindergartens`                  | any            | membership scope                 | —                           | only kindergartens the actor belongs to |
| GET    | `/kindergartens/:id`              | any            | kg                               | —                           | kindergarten detail                     |
| PATCH  | `/kindergartens/:id`              | admin          | kg:admin                         | name, address, contact      | updated                                 |
| GET    | `/kindergartens/:id/school-years` | any            | kg                               | —                           | list                                    |
| POST   | `/kindergartens/:id/school-years` | admin          | kg:admin                         | name, startsOn, endsOn      | created                                 |
| PATCH  | `/school-years/:id`               | admin          | kg:admin                         | name, dates, isCurrent      | updated; clears other `isCurrent`       |
| GET    | `/groups`                         | teacher, admin | teacher → own groups; admin → kg | `?schoolYearId&status&page` | paginated                               |
| POST   | `/groups`                         | admin          | kg:admin                         | name, schoolYearId, ageBand | created                                 |
| GET    | `/groups/:id`                     | teacher, admin | assigned or kg:admin             | —                           | group + teachers + roster count         |
| PATCH  | `/groups/:id`                     | admin          | kg:admin                         | name, status                | updated                                 |
| GET    | `/groups/:id/children`            | teacher, admin | assigned or kg:admin             | `?page`                     | roster                                  |
| POST   | `/groups/:id/teachers`            | admin          | kg:admin                         | membershipId, role          | assignment                              |
| DELETE | `/groups/:id/teachers/:gtId`      | admin          | kg:admin                         | —                           | 204; sets `endedOn`                     |

`GET /groups` for a teacher returns **only** their assigned groups. Reference:
`test_a_teacher_from_another_group_gets_404`,
`test_a_director_cannot_open_another_kindergartens_group`.

Both school-year writes answer **409** for a name already used in that
kindergarten — `@@unique([kindergartenId, name])`. Until 2026-08-27 they leaked
it as a 500: Prisma's `P2002` reached the problem filter as an unrecognised
exception, so an administrator who typed the same year twice was told the
system had broken. There is no `DELETE /school-years/:id` and no archive flag;
groups, enrolments, terms and age profiles reference a year with
`onDelete: Restrict`, and nothing retires one.

`PATCH /school-years/:id` moves `isCurrent` and never clears it as a side
effect: `updateSchoolYearSchema` leaves the field optional with **no** default,
unlike the create schema's `.default(false)`, so a rename arrives with it
`undefined` and the flag stays where it was. Sending `false` explicitly is
accepted and would leave the kindergarten with no current year at all — no
client does.

### 4.1 Platform routes

Registering a kindergarten cannot be scoped to one, so these sit outside the
membership model entirely. `sa` means `User.isSuperAdmin` and nothing more — a
platform operator holds no membership, so every other route in this document
still answers them with 404, including `GET /kindergartens`, which returns an
empty list. `test/platform.test.ts` asserts that over children, portfolios,
observations, guardians and the admin dashboard.

| Method | Route                         | Role | Ownership | Request                                         | Response                                         |
| ------ | ----------------------------- | ---- | --------- | ----------------------------------------------- | ------------------------------------------------ |
| POST   | `/platform/kindergartens`     | any  | sa        | name, address, phone, email, description, admin | kindergarten + admin + invitationToken           |
| GET    | `/platform/kindergartens`     | any  | sa        | `?q&isActive&page&pageSize`                     | paginated; **every** kindergarten                |
| GET    | `/platform/kindergartens/:id` | any  | sa        | —                                               | detail + group, enrollment and membership counts |
| PATCH  | `/platform/kindergartens/:id` | any  | sa        | name, address, contact, description, isActive   | updated                                          |

`admin` is `{ username, lastName, firstName, email?, phone? }` and always
becomes an ADMIN membership in the new kindergarten — the role is not accepted
from the body, or an operator could register a kindergarten whose only member is
a parent. Kindergarten, user, membership and invitation are written in one
transaction: a kindergarten with no director is unreachable, and a director with
no invitation token can never set a password.

The response's `invitationToken` is the director's one-time link, returned so the
operator can deliver it, exactly as the teacher-invites-a-family flow does. It is
never logged.

There is no DELETE. Deactivation is `PATCH { isActive: false }` — CLAUDE.md §3.2.

### 5.1 Roster filters and sorting — RFP §11

`?sex`, `?ageMin` and `?ageMax` (whole years, inclusive at both ends), plus
`?sort=name|dateOfBirth|age|updatedAt` and `?order=asc|desc`.

★ **`age` is `dateOfBirth` with the direction reversed.** A younger child has a
later birth date, so ascending _age_ is descending _date_. The flip happens once,
in `childOrderBy`, rather than at each call site — where it would be got right
twice and backwards once.

★★ **The age range is exclusive at the bottom: `ageMax + 1`.** "At most 4" means
every child who has not yet turned five, including one who is four years and 364
days old. An inclusive `today − 4 years` bound matches only children who are
exactly four _to the day_, which is nearly nobody — an empty roster that reads as
"no such children" rather than as a bug.

An inverted range (`ageMin > ageMax`) is a **400**, not a silent swap.

`GET /children/summary` takes the same filters and shares one builder with the
list, so the header cannot report a total the rows beneath it contradict.

---

## 5. Children, guardianships, enrollment

| Method | Route                       | Role           | Ownership           | Request                                                            | Response                              |
| ------ | --------------------------- | -------------- | ------------------- | ------------------------------------------------------------------ | ------------------------------------- |
| GET    | `/children`                 | any            | actor's visible set | `?q&groupId&schoolYearId&status&sex&ageMin&ageMax&sort&order&page` | paginated summaries                   |
| POST   | `/children`                 | admin, teacher | kg                  | names, sex, dateOfBirth, groupId                                   | created child + first enrollment      |
| GET    | `/children/:id`             | any            | child               | —                                                                  | detail + current group + guardians    |
| PATCH  | `/children/:id`             | admin, teacher | child:write         | names, dob, health notes, status                                   | updated                               |
| POST   | `/children/:id/photo`       | admin, teacher | child:write         | multipart image                                                    | MediaFile ref                         |
| GET    | `/children/:id/guardians`   | any            | child               | —                                                                  | guardians + relation                  |
| POST   | `/children/:id/guardians`   | admin          | kg:admin            | userId or new-user fields, relation                                | guardianship                          |
| PATCH  | `/guardianships/:id`        | admin          | kg:admin            | relation, isPrimary, **canView**                                   | updated                               |
| GET    | `/children/:id/enrollments` | any            | child               | —                                                                  | full history, newest first            |
| POST   | `/children/:id/enrollments` | admin          | kg:admin            | groupId, schoolYearId, startedOn                                   | created; ends the previous active one |
| PATCH  | `/enrollments/:id`          | admin          | kg:admin            | endedOn, status                                                    | updated                               |

`GET /children` returns the actor's visible set — a parent sees only their own
children, a teacher only their groups' children, an admin their kindergartens'.
It is never filtered by a client-supplied `kindergartenId`.

`PATCH /guardianships/:id` with `canView: false` is the revocation path. The
relationship record survives.

---

## 5.1b Milestones — RFP §4.5

| Method | Route                      | Role | Ownership             | Response               |
| ------ | -------------------------- | ---- | --------------------- | ---------------------- |
| GET    | `/children/:id/milestones` | any  | child                 | timeline, newest first |
| POST   | `/children/:id/milestones` | any  | child (guardians too) | the milestone          |
| PATCH  | `/milestones/:id`          | any  | own entry, or staff   | the milestone          |
| DELETE | `/milestones/:id`          | any  | own entry, or staff   | `{ id }`               |

`kind` is one of `MILESTONE_KINDS` (seven named firsts plus `CUSTOM`), a
suggested vocabulary rather than a closed set — §4.5 explicitly asks for a
family-invented event. A `CUSTOM` entry **must** carry a `title`.

★ **A guardian may edit only their own entry.** Either parent could otherwise
rewrite what the other wrote. 404, not 403.

★★ **Photographs attach through the ordinary child-media upload**, with
`milestoneId` instead of `observationId` (sending both is a 400). Unlike an
observation there is no author check: a milestone belongs to the family, so
either guardian may illustrate it. Milestone photos are visible to guardians
unconditionally — there is no review state to gate on.

---

## 5.1c Safety incidents — RFP Module 2.1

| Method | Route                          | Role           | Ownership   | Response                                          |
| ------ | ------------------------------ | -------------- | ----------- | ------------------------------------------------- |
| GET    | `/children/:id/incidents`      | any            | child       | timeline, newest first                            |
| POST   | `/children/:id/incidents`      | teacher, admin | child:write | the incident                                      |
| GET    | `/kindergartens/:id/incidents` | teacher, admin | kg          | paginated log; `?unreportedOnly&highPriorityOnly` |
| PATCH  | `/incidents/:id`               | teacher, admin | child:write | the incident                                      |
| POST   | `/incidents/:id/report`        | teacher, admin | child:write | the incident, now reported                        |
| DELETE | `/incidents/:id`               | teacher, admin | child:write | `{ id }`                                          |

★ **The child list has no role gate.** A family reads their own child's
incidents, including ones not yet reported: `reportedAt` records whether a notice
was _sent_, not whether the record is visible.

★★ **`report` creates a published, important notice targeted at that child
alone** and links it to the incident. Never the class board — naming a child's
injury to the whole group is the leak these rules exist to prevent. Reporting a
second time is a **400**: `reportedAt` is the record that the family was told and
by which notice, and overwriting it would orphan the first.

The kindergarten log orders high-priority first within recency, and is paginated
like every other list.

---

## 5.2 Growth — RFP §7

| Method | Route                        | Role | Ownership             | Request                          | Response                |
| ------ | ---------------------------- | ---- | --------------------- | -------------------------------- | ----------------------- |
| GET    | `/children/:id/growth`       | any  | child                 | `?from&to`                       | points + reference band |
| PUT    | `/children/:id/growth/:date` | any  | child (guardians too) | height, weight, head circ., note | the measurement         |
| DELETE | `/growth-measurements/:id`   | any  | child:write           | —                                | `{ id }`                |

★ **`PUT :date`, not `POST`.** One measurement per child per day is enforced by
a partial unique index, so the day _is_ the record's identity. A re-measurement
after a bad reading corrects that day rather than adding a second point — a
chart with two points on one date has no defined order.

★★ **Guardians may write and may not delete.** RFP §2.3 lists "Өсөлтийн
мэдээлэл оруулах" among what a parent does, so the write uses the same predicate
as the photo album rather than the staff-only `canRecordForChild`. Deleting
edits the record the kindergarten keeps; a wrong value is corrected by writing
the same day again. Same shape as the album.

★★★ **The reference band ships with its source and disclaimer, nested.** RFP
§7.2 requires the source, its version and its date to be shown, and requires the
system to state it gives no medical diagnosis. They live _inside_ the
`reference` object, so a screen cannot render the band without them — the
requirement is structural rather than a note somebody must remember.

`reference` is **null** when the child's sex is unknown. The WHO bands differ by
more than a centimetre at five years old, and a chart with the wrong band is
worse than one with none.

The band is **median ±2 SD, never a percentile**. "Your child is on the 12th
percentile" is a sentence that sends a family to a clinic; the question a
kindergarten has is whether a measurement sits inside the range most children of
that age fall in.

`heightChangeCm` and `weightChangeKg` are the change since the previous
measurement in the series — null on the first point, and null when the earlier
row did not carry that quantity, because a delta against a measurement nobody
took is a fabricated fact.

---

## 6. Portfolio

| Method | Route                               | Role           | Ownership   | Request                               | Response                                                   |
| ------ | ----------------------------------- | -------------- | ----------- | ------------------------------------- | ---------------------------------------------------------- |
| GET    | `/children/:id/profile`             | any            | child       | —                                     | "Миний тухай"                                              |
| PUT    | `/children/:id/profile`             | admin, teacher | child:write | introduction, dream, height, weight … | upserted                                                   |
| GET    | `/children/:id/age-profiles`        | any            | child       | —                                     | ages 2–5                                                   |
| PUT    | `/children/:id/age-profiles/:age`   | admin, teacher | child:write | favourites, personality, notes        | upserted; `age` must be 2–5                                |
| GET    | `/children/:id/birthday-notes`      | any            | child       | —                                     | list                                                       |
| PUT    | `/children/:id/birthday-notes/:age` | admin, teacher | child:write | note                                  | upserted                                                   |
| GET    | `/children/:id/portfolio`           | any            | child       | `?schoolYearId`                       | aggregate: profile, ages, observations, assessments, media |

`age` outside 2–5 returns 400. Reference: `test_age_outside_two_to_five_is_rejected`.

`GET /children/:id/portfolio` is the single read behind the parent's portfolio
screen and the PDF — one query set, not five round trips.

---

## 7. Observations

| Method | Route                        | Role           | Ownership                   | Request                                                             | Response                                             |
| ------ | ---------------------------- | -------------- | --------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------- |
| GET    | `/observations`              | any            | actor's visible set         | `?childId&groupId&typeId&domainId&from&to&source&reviewStatus&page` | paginated                                            |
| POST   | `/observations`              | teacher, admin | child:write                 | childId, typeId, observedOn, texts, domainIds, visibleToParents     | created                                              |
| GET    | `/observations/:id`          | any            | child (via the observation) | —                                                                   | detail + domains + media                             |
| PATCH  | `/observations/:id`          | teacher, admin | child:write                 | texts, visibility, includeInReport                                  | updated                                              |
| DELETE | `/observations/:id`          | teacher, admin | child:write                 | —                                                                   | 204; **soft delete**                                 |
| POST   | `/observations/parent`       | parent         | child (own)                 | childId, observedOn, texts                                          | created with `source=PARENT`, `reviewStatus=PENDING` |
| GET    | `/observations/review-queue` | teacher, admin | own groups                  | `?page`                                                             | parent submissions awaiting review                   |
| POST   | `/observations/:id/review`   | teacher, admin | child:write                 | decision, note                                                      | updated                                              |

A parent may **create** an observation about their own child and **read** ones
marked `visibleToParents`. They may not review, archive, edit, or use the
teacher form. Reference tests in [SECURITY.md](SECURITY.md) §6.5.

`visibleToParents` defaults to **false**.

---

## 8. Media

| Method | Route                           | Role           | Ownership            | Request                                             | Response                               |
| ------ | ------------------------------- | -------------- | -------------------- | --------------------------------------------------- | -------------------------------------- |
| GET    | `/children/:id/media`           | any            | child                | `?page&pageSize&purpose&observationId&category&age` | **paginated** page of MediaFile        |
| POST   | `/children/:id/media`           | teacher, admin | child:write          | multipart, 1–6 `file`, `purpose`, album metadata    | `{ items, failed }`                    |
| GET    | `/media/:id`                    | any            | child (via the file) | —                                                   | **302** to a 5-minute presigned R2 URL |
| GET    | `/media/:id/meta`               | any            | child                | —                                                   | metadata, no URL                       |
| PATCH  | `/media/:id`                    | teacher, admin | child:write          | caption, takenAt, age, category, attribution        | updated MediaFile                      |
| DELETE | `/media/:id`                    | teacher, admin | child:write          | —                                                   | 204; archives, stops serving           |
| POST   | `/observations/:id/media`       | teacher, admin | child:write          | mediaFileId, caption, order                         | attachment                             |
| DELETE | `/observations/:oid/media/:mid` | teacher, admin | child:write          | —                                                   | 204                                    |

**The gallery is paginated** (2026-08-22). It was the one list in this API that
was not, and a child with six hundred photographs answered with six hundred rows
and six hundred signed-URL redirects on one screen — CLAUDE.md §3.4, RFP §17.

`?observationId=` landed with it. The screen that shows one observation's photos
previously fetched the child's whole `OBSERVATION` set and filtered in the
browser, which page one of twenty-five silently breaks.

★ **The guardian visibility rule is one predicate, used twice.** The paginated
list and the per-file check behind `GET /media/:id` compose the same `where`
fragment. They were one method returning a list that the download path searched
in memory; paginating that would have made a guardian 404 on photo twenty-six of
their own child while the gallery showed it on page two.

**Album metadata** (RFP §4.4): `takenAt` — when the photograph was taken, not
uploaded; `age` (2–5); `category` from a closed vocabulary; `attribution`
(`TEACHER | PARENT | JOINT`), defaulted from who uploads and correctable; and
`uploadedBy`, taken from the authenticated actor and never from the body. On
`PATCH`, an absent field is left alone and an explicit `null` clears it — so
editing a caption cannot blank the date.

**Tenant images** — `KINDERGARTEN_LOGO`, `USER_PHOTO`, `GROUP_PHOTO` — are
served by `GET /media/:id` too, authorised by membership of the file's own
kindergarten rather than through a child. They are still never public: CLAUDE.md
§1.4 admits no exception for a logo.

| Route                          | Who                             | Sets                           |
| ------------------------------ | ------------------------------- | ------------------------------ |
| `POST /kindergartens/:id/logo` | administrator of that tenant    | `Kindergarten.logoMediaFileId` |
| `POST /users/:id/photo`        | **that account only**, any role | `User.photoMediaFileId`        |
| `POST /groups/:id/photo`       | teacher or admin of that tenant | `Group.photoMediaFileId`       |

★ **Three paths, not one `POST /images?owner=…`.** The three authorization
answers genuinely differ, and the parameterised version puts all three inside
one method behind a switch — the shape CLAUDE.md §1.1 exists to prevent.

★ **An administrator cannot set someone else's portrait.** They may create and
deactivate the account; replacing its face is not administration. RFP §3.3 puts
the profile photo under what a teacher does with their _own_ profile, and a
portrait anyone else can set stops being evidence that the person put it there.

Each column is `@unique`, so an upload **displaces** rather than adds: the
previous `MediaFile` is soft-deleted in the same transaction that attaches the
new one, and the audit row records `replacedMediaFileId`. Without that the old
row survives pointing at bytes nothing serves, and — because the column is
unique — the new row cannot claim the pointer at all.

The logo is embedded in both PDF templates (RFP §10.3), asserted by counting
embedded images before and after an upload rather than by searching the text
layer, which cannot see a picture.

**Upload takes a batch.** One request carries up to six repeated `file` parts
and answers `{ items: MediaFile[], failed: [{ name, reason }] }`. Six because
multer buffers every file in memory before the handler runs; the web client
slices a larger selection rather than refusing it.

Partial success is a **201** carrying both lists — nine photographs stored and
the tenth refused is not an error. A batch where **nothing** was stored is a
**400** with the first reason, so a renamed executable never comes back as
"created". Authorization is decided once for the child, before any file is
read.

Stored images are re-encoded (which is the EXIF strip) and bounded at 2000px on
the longest edge — past 300dpi at the size the PDF places them. HEIC is the one
format named in a rejection, with the camera setting to change: `sharp` here has
libheif without the HEVC decoder, and iOS converts to JPEG on its own when a
photo is chosen through `<input type="file">`, so it arrives essentially only
from a Mac.

**The permission check runs before the redirect**, always. Reference:
`test_the_permission_check_runs_before_the_redirect`.

**Guardians may build the album** — RFP §2.3, decided 2026-08-22. A family
uploads photographs of their own child, and those photographs are attributed
`PARENT` and carry the uploader. This **reverses** the reference system, which
refused guardian uploads; the RFP names the capability explicitly and outranks
the reference.

What did **not** widen, each still asserted:

- a guardian may attach only to **their own** parent observation, never to a
  teacher's — otherwise a family could illustrate a private teaching note
- a guardian may edit the caption, date and category of **photographs they
  uploaded**, and nobody else's
- a guardian may **not** delete any photograph, including their own upload —
  deletion stays a staff act, and is an open question rather than a settled one
- a guardian may **not** set the child's profile picture

Reference: `test_delete_refuses_the_childs_own_guardian` still holds.

`DELETE` never accepts a GET. Upload rules in [SECURITY.md](SECURITY.md) §7.3.

---

## 9. Assessment and terms

| Method | Route                                | Role           | Ownership            | Request                            | Response                            |
| ------ | ------------------------------------ | -------------- | -------------------- | ---------------------------------- | ----------------------------------- |
| GET    | `/terms`                             | any            | kg                   | `?schoolYearId`                    | list                                |
| POST   | `/terms`                             | admin          | kg:admin             | schoolYearId, number, name, dates  | created                             |
| PATCH  | `/terms/:id`                         | admin          | kg:admin             | name, dates                        | updated                             |
| GET    | `/children/:id/assessments`          | any            | child                | `?termId`                          | list                                |
| PUT    | `/children/:id/assessments`          | teacher, admin | child:write          | termId, domainId, levelId, comment | upserted on `(child, term, domain)` |
| GET    | `/groups/:id/assessments`            | teacher, admin | assigned or kg:admin | `?termId&domainId` (both required) | one column: every child, one domain |
| PUT    | `/groups/:id/assessments`            | teacher, admin | assigned             | termId, domainId, entries[]        | bulk upsert for that one domain     |
| GET    | `/children/:id/term-report`          | any            | child                | `?termId`                          | term report; parents see FINAL only |
| PUT    | `/children/:id/term-report`          | teacher, admin | child:write          | strengths, needs, goals, advice    | upserted as DRAFT                   |
| POST   | `/children/:id/term-report/finalize` | teacher, admin | child:write          | termId                             | status FINAL, `finalizedAt` set     |

### ★ One development domain at a time — corrected 2026-08-19

This section previously specified a `children × domains` grid. **That was
wrong**, and it was written in Phase 0 before the scope was fixed.

The instruction is explicit — _"MVP assessment UI remains one development domain
at a time"_, _"do NOT build the full 9-domain matrix"_ — and the reference
project reached the same conclusion independently: its own UI map records a P0
to build the matrix and then says **"That is now cancelled. Assessment stays one
domain at a time, which is what the backend does."**

So `GET /groups/:id/assessments` requires **both** `termId` and `domainId` and
returns one column: every child in the group, assessed on that single domain. A
teacher picks Group → School Year → Term → Domain, and works down the list.

That shape is also better for the actual job. A teacher assessing "Бие бялдрын
хөгжил" holds one rubric in mind and applies it to twenty children; a matrix
asks them to context-switch per cell, and on a phone it does not fit at all.

A parent may read a **finalized** term report and may not reach the editor.
Reference: `test_the_childs_own_guardian_cannot_reach_the_editor`.

---

## 10. Notifications

| Method | Route                         | Role           | Ownership          | Request                           | Response                                                                 |
| ------ | ----------------------------- | -------------- | ------------------ | --------------------------------- | ------------------------------------------------------------------------ |
| GET    | `/notifications`              | any            | audience scope     | `?unread&page`                    | parents see published ones aimed at them; staff see their kindergarten's |
| GET    | `/notifications/unread-count` | any            | audience scope     | —                                 | `{ count }` — polled while the tab is visible                            |
| POST   | `/notifications`              | teacher, admin | kg                 | title, body, targets, isImportant | created as DRAFT                                                         |
| GET    | `/notifications/:id`          | any            | audience or author | —                                 | detail; **a draft is only visible to staff**                             |
| PATCH  | `/notifications/:id`          | teacher, admin | kg + author        | title, body, targets              | updated while DRAFT                                                      |
| POST   | `/notifications/:id/publish`  | teacher, admin | kg                 | —                                 | published                                                                |
| POST   | `/notifications/:id/read`     | any            | audience           | —                                 | 204; idempotent                                                          |

Targets are kindergarten-wide, per group, or per child. A parent's audience is
computed from their children's enrollments — never from a client parameter.
Reference: `test_a_guardian_cannot_open_a_draft`,
`test_a_guardian_cannot_open_another_kindergartens_announcement`.

**No WebSocket.** `unread-count` is polled at 60 s while the tab is visible.

---

## 11. Reports

| Method | Route                      | Role | Ownership         | Request                  | Response                                 |
| ------ | -------------------------- | ---- | ----------------- | ------------------------ | ---------------------------------------- |
| POST   | `/reports`                 | any  | child             | `childId, type, termId?` | 201 + `ReportJob` (`QUEUED`)             |
| GET    | `/reports/:jobId`          | any  | requester + child | —                        | status, progress; **only the requester** |
| GET    | `/reports/:jobId/download` | any  | requester + child | —                        | `{ url, expiresIn }` — a presigned GET   |
| GET    | `/children/:id/reports`    | any  | child             | `?page`                  | this caller's past jobs for this child   |

Types: `CHILD_PORTFOLIO`, `TERM_REPORT` (`termId` required for the latter).

Generation is asynchronous — BullMQ, ~10 s for a photo-heavy portfolio
([PDF_SPIKE.md](PDF_SPIKE.md) §9). The client polls `GET /reports/:jobId` until
`downloadable` is true; there is no realtime channel in the MVP.

`POST /reports` is rate limited to **20 per user per hour**. One report is
seconds of Chromium against a 1 GB memory floor, so an unbounded loop is a
denial of service that costs the caller one line of JavaScript.

### ★ The audience is server-derived and frozen onto the job

A generated PDF is the only artefact in the system whose visibility filter is
applied **once**, at generation, and then baked into a file that outlives the
request. Every other read path re-derives visibility per request.

So `POST /reports` records an `audience` (`STAFF` | `GUARDIAN`) on the job,
derived from the requester's relationship to the child. It is **not accepted
from the client** — the request body is `.strict()`, so sending `audience`
is a 400.

Two independent checks gate every download, and both are required:

1. **Requester-only.** `requestedById` must equal the caller. Without this, a
   guardian passes `canAccessChild` for their own child and receives the
   _teacher's_ copy — private teaching notes and unpublished assessments
   included.
2. **Live child access.** Re-run at download time, so a teacher whose group
   assignment was revoked after generating a portfolio gets a 404.

Both failures are 404, never 403. `GET /children/:id/reports` lists only the
caller's own jobs: a parent has no business seeing that staff exported a copy
last Tuesday.

### Retention

A finished PDF expires after **14 days**, swept nightly. The `ReportJob` row
survives with `resultMediaFileId` cleared — what was generated for whom stays
auditable — and the download route returns 404 once `expiresAt` has passed. A
stored report is a copy of a child's record sitting outside the permission
system that produced it, and D13 placed that storage outside Mongolia; "how
long do copies live" is a question the client can now be given an answer to.

---

## 12. Configuration (admin)

Implemented 2026-08-22. **The routes differ from the `/config/...` shape this
section proposed before it was built** — see the note at the end for why.

### Management surface — admin only

| Method | Route                                    | Role  | Ownership | Request                       | Response                        |
| ------ | ---------------------------------------- | ----- | --------- | ----------------------------- | ------------------------------- |
| GET    | `/kindergartens/:id/development-domains` | admin | kg:admin  | —                             | own + system rows, `isSystem`   |
| POST   | `/kindergartens/:id/development-domains` | admin | kg:admin  | name, code, color, order      | created for this kindergarten   |
| PATCH  | `/development-domains/:id`               | admin | kg:admin  | name, color, order, isActive  | updated                         |
| DELETE | `/development-domains/:id`               | admin | kg:admin  | —                             | **deactivates**, `{ isActive }` |
| GET    | `/kindergartens/:id/assessment-levels`   | admin | kg:admin  | —                             | own + system rows               |
| POST   | `/kindergartens/:id/assessment-levels`   | admin | kg:admin  | value (1–4), label, color     | created                         |
| PATCH  | `/assessment-levels/:id`                 | admin | kg:admin  | label, color, order, isActive | updated                         |
| DELETE | `/assessment-levels/:id`                 | admin | kg:admin  | —                             | deactivates                     |
| GET    | `/kindergartens/:id/observation-types`   | admin | kg:admin  | —                             | own + system rows               |
| POST   | `/kindergartens/:id/observation-types`   | admin | kg:admin  | name, code, order             | created                         |
| PATCH  | `/observation-types/:id`                 | admin | kg:admin  | name, order, isActive         | updated                         |
| DELETE | `/observation-types/:id`                 | admin | kg:admin  | —                             | deactivates                     |

### Read surface — everyone else, unchanged

| Method | Route                                  | Role | Ownership | Response                 |
| ------ | -------------------------------------- | ---- | --------- | ------------------------ |
| GET    | `/kindergartens/:id/assessment-config` | any  | kg        | active domains + levels  |
| GET    | `/children/:id/observations/types`     | any  | child     | active observation types |

Two surfaces rather than one because the audiences differ: a parent's screen
needs domain names to render and must not see deactivated rows or the
management affordances, while an administrator needs exactly those. The read
path already existed and is untouched.

**A kindergarten admin may not edit a system row** (`kindergartenId IS NULL`);
they create an override instead. Attempting it returns 404 — enforced by
loading every write through a scope that cannot match a null, so it fails at
the load rather than in a check a later method could forget. Reference:
`test_a_director_cannot_open_a_system_domains_edit_form`.

Teachers and parents may **read** configuration but never write it. Reference:
`test_a_teacher_cannot_reach_the_configuration`.

### Three rules worth knowing before you call these

- **`DELETE` deactivates — and deactivation is enforced, not cosmetic.**
  `isActive: false` removes a row from the pickers **and** from the write paths:
  a retired domain or level is refused by `PUT /children/:id/assessments` and
  `PUT /groups/:id/assessments`, and a retired observation type is refused by
  `POST /children/:id/observations`, each with a **400**. Records already filed
  against it keep reading normally — the read paths join the row without
  filtering on `isActive`, so last year's term report still renders the level it
  was written with. `deletedAt` would orphan that history and is not offered
  here. The response carries the number of records still attached.

  **The stated consequence:** an existing assessment on a retired domain becomes
  read-only, because the update path runs the same check as the create path. An
  administrator retiring a criterion mid-term should expect that.

- **The lists are bounded by construction, not by paging.** They deliberately
  return whole arrays — the group assessment grid needs every active domain to
  render. CLAUDE.md §3.4 is satisfied at the other end: a kindergarten may own
  at most **40** rows per kind, and the 41st `POST` is a **409**. System rows do
  not count against it.
- **Identity is immutable.** `DevelopmentDomain.code` and
  `AssessmentLevel.value` are absent from the PATCH schemas. A rename is a
  display change; re-coding silently repoints everything that looks the row up,
  and re-numbering a level rewrites what a family was already told.
- **A duplicate `code` or `value` is a 409**, not a 500.

### ★ Why not `/config/...`

This section originally proposed `/config/development-domains`, with the
kindergarten implied by the caller. That cannot be expressed: an actor may hold
`ADMIN` in more than one kindergarten — `adminKindergartenIds()` returns an
array — so `POST /config/development-domains` has no way to say which one it
creates in, and the answer would have to be guessed. Every other create route
in this API is nested under `/kindergartens/:id/…` for the same reason, and
every single-row route is addressed by the row's own id with the tenant read
back from it. The implemented shape follows that convention rather than
inventing a second one.

---

## 12b. Health

| Method | Route               | Role       | Ownership | Response                                            |
| ------ | ------------------- | ---------- | --------- | --------------------------------------------------- |
| GET    | `/health`           | **public** | —         | `{ status: "ok" }` — liveness only, reveals nothing |
| GET    | `/health/readiness` | admin      | —         | storage, chromium, redis, cyrillicFont              |

`/health` is `@Public()` deliberately: authentication is global, and without it
every platform liveness probe gets a 401 and restart-loops the deployment. It
returns no version, no database name and no dependency detail — an
unauthenticated endpoint that enumerates infrastructure is free reconnaissance.

`/health/readiness` is authenticated **because** it names dependencies. It
exists for the pre-launch checklist, where it catches the expensive failure: an
image built without Cyrillic fonts renders every PDF completely blank and
reports success doing it.

---

## 12c. Meal register — нэмэлт.md §2

| Method | Route                         | Role           | Ownership            | Request                      | Response                           |
| ------ | ----------------------------- | -------------- | -------------------- | ---------------------------- | ---------------------------------- |
| GET    | `/groups/:id/meals`           | teacher, admin | assigned or kg:admin | `?date&kind` — both required | roster; `record` null if unmarked  |
| PUT    | `/groups/:id/meals`           | teacher, admin | assigned or kg:admin | `{ date, kind, entries[] }`  | the saved records                  |
| GET    | `/children/:id/meals/summary` | any            | child                | `?month=YYYY-MM`             | counts by kind × status, `daysFed` |

**This is not the menu.** `MenuDay` (§12d) is what the kitchen planned to cook,
one row per kindergarten per day, readable by a parent. `MealRecord` is what one
child actually ate at one sitting. They share the `MealKind` vocabulary and
nothing else — no foreign key, no join.

Nor is it derivable from `Attendance`, which is why it is a separate table.
`нэмэлт.md` §3 computes the food cost from **хооллосон өдөр** — days eaten — and
a child collected before lunch attended and did not eat. Inferring one from the
other makes the cost silently wrong.

`kind` is one of `BREAKFAST · LUNCH · AFTERNOON_SNACK · EXTRA`; each entry's
`status` is one of `TAKEN · NOT_TAKEN · PARTIAL · SPECIAL`, plus an optional
`note` of at most 500 characters. There is no "unrecorded" status: a child
nobody has marked is one the sheet returns with `record: null`, and the roster
comes from `Enrollment` rather than from the meal rows so that they appear at
all.

The write is a **batch** — one request per sitting, not per child — because a
teacher marks a whole group at a serving hatch. Three behaviours follow from
that and are asserted in `meal-register.test.ts`:

- an entry for a child not actively enrolled in the group is **dropped**, not an
  error: a stale roster must not lose the nineteen marks that are correct, and
  must not bill a meal to the wrong group;
- if every entry is dropped the request is a 400, rather than a silent no-op;
- a future date is refused.

One audit row is written per sitting — the act the teacher performed — not one
per child. §14 asks for a financial audit trail and this feeds the food cost.

There is **no `DELETE`**. A saved mark is changed to another status; nothing
un-records it. `MealRecord.deletedAt` exists and no endpoint sets it, which is
why the repository hand-rolls find-then-write instead of Prisma's `upsert()`:
the unique index is partial (`WHERE "deletedAt" IS NULL`), so a soft-deleted row
leaves its sitting free and `upsert()` cannot see that.

★ Authorization is the same on both group routes: staff, **and** — for a
non-admin — a group the teacher is actively assigned to. Membership of the
kindergarten is not enough. The check was missing from the write until
2026-08-27, so a teacher could record meals for any group in their kindergarten;
the read had always carried it.

`GET /children/:id/meals/summary` is a different controller with a different
rule — no `@Roles`, authorized by `canAccessChild`, so a guardian may read their
own child's month. Nothing in the web app calls it yet; whether parents should
see it is an open product decision.

---

## 13. Dashboard

| Method | Route                | Role    | Ownership    | Request | Response                                                       |
| ------ | -------------------- | ------- | ------------ | ------- | -------------------------------------------------------------- |
| GET    | `/dashboard/teacher` | teacher | own groups   | —       | see below                                                      |
| GET    | `/dashboard/admin`   | admin   | kg:admin     | —       | counts, assessment coverage, recent activity                   |
| GET    | `/dashboard/parent`  | parent  | own children | —       | recent visible observations, unread notices, latest assessment |

`GET /dashboard/teacher` answers with, all scoped to the teacher's own groups:

| Field                                       | RFP   | Meaning                                     |
| ------------------------------------------- | ----- | ------------------------------------------- |
| `counts.children / groups / pendingReviews` | §12.1 | roster size, groups taught, review queue    |
| `needsAttention.childrenMissingAssessment`  | §12.1 | the **gap**, not the coverage               |
| `birthdaysToday`                            | §12.1 | added 2026-08-22; month/day matched in SQL  |
| `termProgress { assessed, total }`          | §12.1 | added 2026-08-22; children, not domain rows |
| `recentObservations`                        | §12.1 | so a teacher can resume                     |
| `currentTerm`                               | —     | what "this term" means, or `null`           |

★ `birthdaysToday` is child data and is scoped like child data. A teacher must
not learn that a child in another group — or another kindergarten — has a
birthday today, which is exactly the leak a "harmless" dashboard widget
introduces. Asserted in `dashboard.test.ts`.

Still **not** implemented from §12.1: the per-domain average. §12.2 is missing
storage size and report statistics. Everything the requested dashboard design
also asked for — attendance, medication, pick-up, lunch menu, messages, a radar
chart — is excluded from the MVP by CLAUDE.md §7 and is not served here.

Cross-role access returns 404, like every other authorization failure (§1.1).
Reference: `test_a_guardian_cannot_open_the_teacher_dashboard`,
`test_a_teacher_cannot_open_the_admin_dashboard`.

---

## 14. Audit (admin, read-only)

| Method | Route    | Role  | Ownership | Request                                    | Response          |
| ------ | -------- | ----- | --------- | ------------------------------------------ | ----------------- |
| GET    | `/audit` | admin | kg:admin  | `?childId&actorUserId&action&from&to&page` | paginated entries |

No write endpoint exists. The log is append-only and appended to internally.

---

## 15. Not in the MVP

`/attendance` · `/invoices` · `/payments` · `/tariffs` · `/health` ·
`/medications` · `/surveys` · `/chat` · `/messages` · `/exports/excel` ·
`/analytics` · `/push` · WebSocket endpoints.

These are Phase 2 or Phase 3. Do not add them without pulling the phase forward
explicitly.

★ `/meals` left this list on 2026-08-27. The meal register shipped with
`нэмэлт.md`'s foundation and CLAUDE.md §7 moved the scope line to match, so the
entry had become actively false — a document that says a live route does not
exist teaches people to stop reading it, which is the reasoning §7 records for
itself. The routes are §12c.

★★ Several of the entries still above are in the same state — `/attendance`,
`/health`, `/medications`, `/surveys` and `/exports/excel` are all built and
some are documented in this very file. Reconciling the whole list is its own
pass and is deliberately not folded into this one; only the line this change
made false was corrected.

# PHASE_3_BUILD.md

The RFP Phase II–III build, requested by the client on 2026-08-25 after the
Phase 1 MVP was accepted.

Same rule as `IMPLEMENTATION_STATUS.md`: nothing is marked done without a
command and its real output. Where something is partial, it says what is
missing rather than rounding up.

**Scope boundary:** CLAUDE.md §7. Phase IV — native apps, chat, SMS, push, QR
pick-up, e-signature, payments and QPay, multi-language, AI, voice-to-text —
stays out.

---

## Starting state, measured

Verified on `ad7de86` before any of this work, after
`pnpm --filter @kinder/api prisma:generate` and
`pnpm --filter @kinder/contracts build` (both stale artefacts, both silent
until they are not — see the note below):

```
apps/api       854 passed | 1 skipped (35 files)
apps/web       169 passed (16 files)
contracts        6 passed
typecheck      3/3 clean
lint           0 findings
format:check   FAILED — 18 files
```

37 models · 10 migrations · 137 endpoints across 27 modules · 33 web pages ·
159 `toBe(404)` authorization assertions.

★ **Two stale local artefacts produced 25 test failures that were not real.**
`prisma:generate` and the contracts `dist` are both build outputs that no test
depends on and nothing rebuilds automatically. Against a stale Prisma client the
attendance, meals and survey suites fail with 500s — a missing model on
`PrismaService` looks exactly like broken code. CI does not have this problem
because it generates both before typechecking. Worth knowing before debugging a
red suite that main is actually green on.

---

## The production migration incident

Recorded here because it shapes the deploy order for everything below.

`20260825054800_add_attendance` was merged to main in af65bdf and **applied to
the production database** (deploy `ce6ebaf7`, SUCCESS, 07:15 UTC). It was then
rewritten on a branch as `20260824132405_add_attendance` — a different name for
overlapping DDL, with `OTHER` dropped from `AttendanceStatus` and `HALF_DAY`
added. The next deploy (`8495ef02`, ad7de86) died in the entrypoint:

```
Applying migration `20260824132405_add_attendance`
Error: P3018 — Database error code: 42710
ERROR: type "AttendanceStatus" already exists
```

Consequences, all verified rather than assumed:

|                                                                  |                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Live API                                                         | Serving af65bdf. `/v1/health` → 200                                                              |
| `/v1/kindergartens/…/surveys`, `/menu`, `/children/…/attendance` | **404** — routes absent from the running build                                                   |
| `/v1/children/…/observations`                                    | 401 — a route that does exist, for contrast                                                      |
| Production `_prisma_migrations`                                  | Holds a failed row, so every later deploy stops at P3009                                         |
| CI                                                               | Green on migrations — it always migrates a fresh container, so it cannot see this class of fault |

**A rewritten migration is only invisible on a database that has never run the
original.** Every environment that had is now stuck, which is both local
databases and production.

★ **The original note here said recovery was deferred because each new feature
would "re-break" a repaired database. That reasoning was wrong.** Every
migration added since has a fresh name production has never seen, so they apply
cleanly on top of a repaired schema — there was nothing to re-break. Corrected
rather than quietly deleted, because the wrong reason had already been used to
postpone the work once.

Recovery is now prepared in full at `docs/PROD_RECOVERY.md`, including the
measured contents (four seed users, one demo child, all dated 2026-08-19) and a
durable backup. The one destructive command is left for a human to run: it
drops the production schema, and Claude Code's classifier refuses it, which is
the right answer for a decision that is not an assistant's to make.

---

## Progress

| #   | RFP                     | Item                                                      | State      |
| --- | ----------------------- | --------------------------------------------------------- | ---------- |
| 1   | —                       | Rules and stale docs reconciled with the new scope        | ✅         |
| 2   | §4.2                    | Zodiac sign and Mongolian year animal                     | ✅         |
| 3   | §3.2, §3.3, §10.3       | Logo, teacher photo, group photo uploads; logo in the PDF | ✅         |
| 4   | §11                     | Age and sex filters, sort control                         | ✅         |
| 5   | §12.2, §2.1             | Storage size, report statistics, audit browser            | ⬜         |
| 6   | §6.1, §6.2              | Assessment configuration admin UI                         | ✅         |
| 7   | §7                      | Growth measurements and charts                            | ✅         |
| 8   | §4.5                    | Milestones                                                | ✅         |
| 9   | Module 2                | Allergies, medication, vaccination                        | ✅         |
| 10  | Module 2.1              | Safety incident log                                       | ✅         |
| 11  | Module 2                | Menu-versus-allergy cross-check                           | ✅         |
| 12  | §5.3                    | Artwork development comparison                            | ✅         |
| 13  | Module 1.1, 1.2         | Matrix questions, begin-to-end comparison                 | ⬜         |
| 14  | §9                      | Document library                                          | ✅         |
| 15  | §6.5, §10.2             | The remaining five report types                           | ⬜         |
| 16  | §3.4, §12.3, Module 1.3 | Excel import and export                                   | ⬜         |
| 17  | §16                     | Photo publishing consent                                  | ⬜         |
| 18  | —                       | Production recovery: reset, deploy, seed                  | ⬜ blocked |

---

## 1 — Rules and stale docs ✅

Not housekeeping. CLAUDE.md §7 forbade attendance, meals, surveys, health,
allergies, medication, Excel and growth percentiles; three of those were already
merged, and the rest are the work that was just commissioned. Writing fifteen
features against a mandatory rule that forbids them teaches whoever reads the
file next that it is decoration. So the rule moved first, in one commit, with
the reason on the record.

- **CLAUDE.md §7** now runs to RFP Phase III and names what is still out.
- **CLAUDE.md §3.2** said "no table ever carried one" of `deletedById`. Five
  did, added the same day on a branch that predated the rule, written by
  nothing. `20260825170000_drop_vestigial_deleted_by` drops all five — the one
  shape of `DROP COLUMN` that cannot lose data, argued in the migration's own
  comment per §3.3.
- **IMPLEMENTATION_STATUS.md** claimed phases 11–13 pending while its own
  sections marked them complete, and "no commits" against 60-odd.
- **PHASE_1_ACCEPTANCE.md** item 5 said the admin screens were deliberately not
  built. They exist and are linked; marked superseded, with the one genuinely
  unlinked area (assessment configuration) carried forward as item 6 above.
- `pnpm format` over the 18 files CI was failing on.

---

## 2 — Birth facts ✅

RFP §4.2 wants the birth date, the age, the өрнийн орд and the монгол жилийн
амьтан. `GET /children/:id/birthday-notes` returned notes alone, so the screen
had a birth date only because the page above it held the child, and the PDF —
which has no page above it — had neither.

The derived facts live in `@kinder/contracts` because two consumers need the
same answer: the API response and the report templates.

- **The lunar boundary is reported, not guessed.** Цагаан сар moves every year
  and diverges from the Chinese calendar by a whole month in some years. A table
  that cannot be checked here would put a wrong animal in a permanent record
  with no sign it was wrong, so `beforeLunarNewYear` marks the window and the UI
  qualifies it. Five births in six are unambiguous.
- **Dates are parsed by hand.** `new Date("2024-03-21")` is UTC midnight; read
  with local getters that is the 20th anywhere west of UTC, which moves a child
  across a zodiac boundary about once every twelve births.
- **The PDF section no longer depends on a note existing** — a two-year-old's
  portfolio printed no birthday section at all.

```
api  portfolio + reports   72 passed
contracts                  32 passed
```

---

## 3 — Tenant images, and the logo in the PDF ✅

Three columns had existed since the tenant-image migration with no route able to
write them; `media.service.ts` said so in a comment.

| Route                          | Who                                      |
| ------------------------------ | ---------------------------------------- |
| `POST /kindergartens/:id/logo` | administrator of that tenant             |
| `POST /users/:id/photo`        | **that account only**, whatever the role |
| `POST /groups/:id/photo`       | teacher or admin of that tenant          |

- **An administrator cannot set someone else's portrait.** RFP §3.3 puts the
  profile photo under what a teacher does with their own profile, and a portrait
  somebody else can set stops being evidence the person put it there.
- **Each column is `@unique`, so an upload displaces rather than adds.** The
  previous file is soft-deleted in the same transaction; otherwise it survives
  pointing at bytes nothing serves, and the new row cannot claim the pointer.
- **The PDF logo is measured by counting embedded images**, before and after an
  upload. The text layer cannot see a picture, and the kindergarten's _name_ was
  always printed — so a text-based assertion would have passed for months
  against a PDF with no logo in it.

```
api   871 passed | 1 skipped   (was 854)
web   169 passed
```

The web design-token guard caught two raw Tailwind radii in the new component
before it landed, which is the second time that test has paid for itself.

---

## 4 — Roster filters and sorting ✅

RFP §11's sex filter, age range and sort control, on `GET /children` and its
summary.

- **`sort=age` is `dateOfBirth` reversed**, in one place. Ascending age is
  youngest first, which is the _latest_ birth date. The first draft of the test
  asserted this backwards — which is the mistake the single mapping exists to
  prevent at the call sites.
- **The age range is exclusive at the bottom (`ageMax + 1`).** "At most 4" has
  to include a child of four years and 364 days; an inclusive `today − 4 years`
  bound matches only children who are exactly four to the day, and the roster
  comes back empty in a way that reads as data rather than as a bug.
- **The list and the summary share one filter builder**, on both sides of the
  wire — `childFilters` in the service, `rosterParams` in the web app. They each
  had a hand-copied literal, which is how a header comes to report twelve
  children above a list showing four.

```
api  children + query-counts + authz-consistency   104 passed
web  169 passed
```

---

## 7 — Growth measurements and charts ✅

A `GrowthMeasurement` time series, a chart, and the reference comparison §7.2
asks for.

**`ChildProfile.heightCm` stays where it is.** Those two columns answer §4.1 —
the height and weight printed in "Миний тухай", one pair, edited in place. This
table answers §7.2, which wants a chart over time and a comparison with the
previous measurement. Folding either into the other deletes a requirement.

**Anchored to `Child`, not `Enrollment`.** Attendance hangs off an enrollment
because a day of attendance belongs to whichever kindergarten the child attended
that day. A child's height belongs to the child: it is the same body before and
after a transfer, and a growth chart that reset on moving kindergarten would be
worse than useless.

**A partial unique index, like `Attendance`.** `WHERE "deletedAt" IS NULL`,
hand-written because Prisma cannot express it. Without it a soft-deleted
measurement occupies its date for ever and the day can never be recorded again —
a unique violation against a row nobody can see. Asserted directly.

**Guardians write, staff delete.** RFP §2.3 lists "Өсөлтийн мэдээлэл оруулах"
under what a parent does, so the write uses the album's predicate rather than
the staff-only check. Deleting edits the kindergarten's record; a wrong value is
corrected by writing the same day again.

**The reference band is median ±2 SD and never a percentile**, and its source,
version, date and "not a medical diagnosis" notice are nested _inside_ the
reference object so no screen can draw the band without them. It is null when
the child's sex is unknown — the WHO bands differ by more than a centimetre at
five, and a wrong band is worse than none.

**The delta is against the previous measurement in the series**, not the
previous month: measurements are irregular, and a rate divided by an assumed
interval reports something nobody measured. It is null when the earlier row
lacked that quantity — never zero, which would claim a comparison nobody made.

```
api  test/growth.test.ts   21 passed  (first run)
api  test/schema.test.ts   25 passed
web  169 passed
```

Two guards fired during this work and both were right: the design-token test
rejected a `text-[9px]` invented for the SVG axis labels — the scale now renders
as HTML beneath the figure, which is what `DevelopmentRadar` already does and is
better for a screen reader — and `eqeqeq` rejected `!= null`, which is now a
named `isPresent` helper. A measurement of `0` is absurd and a _missing_ one is
ordinary, so `value ? …` would have been the wrong test.

---

## 8 — Milestones ✅

RFP §4.5's "Онцгой үйл явдал": the seven named firsts, plus the family's own.

**Its own table, not an `Observation` with a special type.** An observation
carries a development domain, an assessment level, a review status and a
next-steps plan, and stays invisible to a family until a teacher approves it. A
milestone is a memory, usually written by that family, which needs none of that
and must never wait for review to appear in the child's own portfolio.

**`kind` is a free string with a suggested vocabulary.** §4.5 names seven and
then asks for "хэрэглэгчийн өөрөө үүсгэсэн үйл явдал". An enum cannot hold the
eighth without a migration; a configuration table would put an administrator in
charge of curating one family's memory. CLAUDE.md §2.3 binds on what an
_administrator_ edits, which this is not. A `CUSTOM` row must carry a title —
without one it renders as the generic label and tells the family nothing.

**A guardian may edit only what they wrote; staff may edit anything.** Without
the author check either parent could silently rewrite the other's entry, which
is the sort of thing that surfaces during a custody dispute. 404, not 403.

**★ The photograph branch was a real bug, caught by writing the test.** A
`MILESTONE` media row has `observationId: null` but is not `CHILD_PHOTO`, so
neither existing branch of `guardianVisibleWhere` matched it: a family would
have uploaded a photograph of their child's first steps, received a 201, and
never seen it again — while staff saw it fine. The predicate now admits
`purpose: "MILESTONE"` outright, since a milestone has no review state to gate
on, and the test asserts the _serve_ path rather than only the list.

```
api  test/milestones.test.ts   20 passed
web  169 passed
```

---

## 9 and 11 — Health records, and the menu cross-check ✅

Shipped together because the cross-check is the reason the allergy table is
queryable at all.

**Three tables, not one "health record" with a `type` column.** They answer
different questions, are written by different people, and have different
lifetimes: an allergy is standing information a teacher reads before every meal,
a medication authorisation is a dated instruction that expires, a vaccination is
a historical fact. One table with a discriminator gives all three the union of
their columns and none of their constraints.

**`Child.healthNotes` stays.** It is RFP §3.4's free-text "анхаарах шаардлагатай
товч мэдээлэл" and remains right for anything that is not one of the three. What
it cannot do is be _queried_ — which is exactly what the cross-check needs.

Who writes what, and why it differs:

| Record      | Author       | Reason                                                                                                                    |
| ----------- | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Allergy     | staff        | It is an instruction other people act on — it changes what a kitchen cooks. RFP Module 2 puts it "багшийн систем дээр".   |
| Medication  | **guardian** | The row _is_ the consent. Module 2: "Эцэг эхчүүд … баталгаажуулан үлдээх". `authorisedById` is the actor, never the body. |
| Vaccination | staff        | The kindergarten's immunisation register.                                                                                 |

`isActive` on a medication is computed by the API, not by each screen: it
decides whether a teacher gives a child medicine, and two clients deriving it
from two date comparisons is two chances to get the boundary wrong.

### ★ The matching rule was wrong, and the test found it

The obvious cross-check is "either string contains the other". It was written
first, and failed on the case the feature exists for: **самар** (nut) becomes
**самрын** in the genitive and the second _а_ elides, so `"самрын тос"` does not
contain `"самар"`. Mongolian is agglutinative and suffixation routinely changes
the stem — this is the ordinary case, not an edge one, and it would have failed
silently: the warning simply would not appear.

`allergenMatches` now also accepts a shared three-character stem, which catches
самар/самрын, сүү/сүүтэй, загас/загасны. It errs towards warning on purpose —
a stem match also fires on сүү/сүүж, milk against hip — and there is a test
asserting that false positive so nobody "fixes" it later. A false positive costs
ten seconds of reading; a false negative feeds a child something that stops
their breathing.

**The warnings are a separate, staff-only route.** They name other people's
children and what they react to, which is medical information about another
family. The plain menu stays open to everyone.

```
api  test/health-records.test.ts        27 passed
api  src/meals/allergen-match.test.ts   12 passed
```

The child hero's health-badge comment was also corrected: it said structured
allergies did not exist. They do now, and the badge is _still_ the free-text
note, because "⚠ Эрүүл мэнд" meaning either "read the note" or "this child stops
breathing near nuts" is a chip that means nothing. The structured alert lives
where it can name the allergen.

---

## 10 — Safety incidents ✅

RFP Module 2.1's "Аюулгүй байдлын тэмдэглэл": what happened, when, where, to
which part of the body, what was done about it, and whether the family has been
told.

**Not an `Observation` and not a `Notification`.** An observation is a
developmental note built up over a term; this is an event with a time, a body
part and a first-aid response that a family must hear about today. A
notification is the _delivery_, and one is created from an incident when it is
reported — but a notification has no `bodyPart`, no follow-up and no priority,
so folding the record into the message would lose the record the moment the
message was read.

**`reportedAt` is a workflow state, not a permission.** A family reads their own
child's incidents whether or not the notice has gone out. A parent opening the
app before the teacher finishes writing must not find their child's injury
hidden from them — Module 2.1 is about telling families quickly, not about
staging what they may know. Asserted directly.

**High priority is a flag, not a scale.** Module 2.1 asks for one thing: mark
the serious ones and alert management and the family. A three-level scale invites
a middle value meaning "somewhat urgent", which nobody acts on.

**Reporting reuses the notice machinery**, which already owns delivery, read
receipts and the unread badge — and Module 2.1 asks for "Илгээлтийн бүртгэл …
эцэг эх хэзээ уншсан" in the same breath. Two decisions are pinned by tests:

- The notice is **targeted at that child alone**, never the class board. Naming
  a child's injury to the whole group is the leak most of this system's rules
  exist to prevent.
- It is **published immediately**, and **reporting twice is refused**.
  `reportedAt` records that the family was told and by which notice; overwriting
  it would orphan the first notice and lose the time that matters. A correction
  is a new notice, which is a deliberate act.

Incident photographs are staff-only to _add_ and family-readable — the evidence
of an injury is the kindergarten's record, but a parent may see it. That is the
mirror of milestones, where the family adds and staff read.

```
api  test/incidents.test.ts   20 passed
web  169 passed
```

---

## 6, 12, 14 — Configuration UI, artwork comparison, document library ✅

**6 — Assessment configuration (§6.1, §6.2).** The CRUD API shipped complete
and tested in the Phase 2 catalog work and nothing linked to it. CLAUDE.md §2.3
made these three tables rather than TypeScript enums precisely so an
administrator could edit them; until this screen they could not. System rows
are listed, marked and carry no controls — hiding them would show two domains
where the assessment grid shows seven, and the API refuses the write anyway.

**12 — Artwork comparison (§5.3).** Only the conclusion was new: several
artwork photos per observation, dates and captions already existed. The pair is
**ordered by the service** from when each work was made, because a teacher who
picked them backwards would store a comparison that reads as development
running in reverse. Comparisons and milestones now both print in the portfolio
PDF, each embedding two images through the same `ImageBudget` — a report at its
ceiling loses the comparison's pictures rather than an observation's, and the
template renders a missing image as a labelled gap so the conclusion still
prints.

**14 — Document library (§9).** A whole RFP section with nothing built.

★ The security decision worth recording: documents are **staff-only on
reading**, which meant a new `STAFF_ONLY_TENANT_PURPOSES` set in
`MediaService` rather than adding them to `TENANT_IMAGE_PURPOSES`. That set
authorises by `assertMember` — correct for a logo, which appears on every
report a family receives, and a leak for a curriculum. §9 opens with "Багшид
зориулсан", and the test asserts a guardian gets 404 on the file through
`/media/:id`, not merely on the list.

★★ PDFs get their own content validator. There is no re-encode (a PDF cannot be
normalised without a renderer, and running one over untrusted input is a larger
surface than it closes), so the check is the signature at **offset zero** —
a header preceded by junk is refused, because accepting it means accepting a
polyglot.

```
api  1016 passed | 1 skipped   (was 979)
web  169 passed
```

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

Recovery is deliberately deferred to the end of this build rather than done
first: each feature below adds migrations, and a database repaired now would be
re-broken by the next one. Production is stale but stable in the meantime.

---

## Progress

| #   | RFP                     | Item                                                      | State      |
| --- | ----------------------- | --------------------------------------------------------- | ---------- |
| 1   | —                       | Rules and stale docs reconciled with the new scope        | ✅         |
| 2   | §4.2                    | Zodiac sign and Mongolian year animal                     | ✅         |
| 3   | §3.2, §3.3, §10.3       | Logo, teacher photo, group photo uploads; logo in the PDF | ✅         |
| 4   | §11                     | Age and sex filters, sort control                         | ✅         |
| 5   | §12.2, §2.1             | Storage size, report statistics, audit browser            | ⬜         |
| 6   | §6.1, §6.2              | Assessment configuration admin UI                         | ⬜         |
| 7   | §7                      | Growth measurements and charts                            | ✅         |
| 8   | §4.5                    | Milestones                                                | ⬜         |
| 9   | Module 2                | Allergies, medication, vaccination                        | ⬜         |
| 10  | Module 2.1              | Safety incident log                                       | ⬜         |
| 11  | Module 2                | Menu-versus-allergy cross-check                           | ⬜         |
| 12  | §5.3                    | Artwork development comparison                            | ⬜         |
| 13  | Module 1.1, 1.2         | Matrix questions, begin-to-end comparison                 | ⬜         |
| 14  | §9                      | Document library                                          | ⬜         |
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

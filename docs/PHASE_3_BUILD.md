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
| 2   | §4.2                    | Zodiac sign and Mongolian year animal                     | ⬜         |
| 3   | §3.2, §3.3, §10.3       | Logo, teacher photo, group photo uploads; logo in the PDF | ⬜         |
| 4   | §11                     | Age and sex filters, sort control                         | ⬜         |
| 5   | §12.2, §2.1             | Storage size, report statistics, audit browser            | ⬜         |
| 6   | §6.1, §6.2              | Assessment configuration admin UI                         | ⬜         |
| 7   | §7                      | Growth measurements and charts                            | ⬜         |
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

# PHASE_1_ACCEPTANCE.md

Phase 1 MVP acceptance, verified in Phase 12 on **2026-08-20**.

Each item is PASS, FAIL, BLOCKED or N/A **with the evidence that produced it**.
Where something could not be verified in this environment it is BLOCKED and says
what would unblock it — not marked PASS on the strength of the code looking
right.

**Environment:** macOS arm64 · Node 25 · PostgreSQL 17 · Redis 7 · MinIO
(standing in for Cloudflare R2) · Chromium via Puppeteer.

**Evidence sources**

| Ref       | What                                                                       |
| --------- | -------------------------------------------------------------------------- |
| `SUITE`   | `pnpm --filter <pkg> test` — 690 tests                                     |
| `PROBE`   | 80 live HTTP security probes: RBAC, tenancy, IDOR, media, privacy, reports |
| `AUTH`    | 41 live probes: authentication, CORS, CSRF, headers                        |
| `RESET`   | 30 live probes: password-reset lifecycle and PDF content                   |
| `PERF`    | 8 in-process N+1 guards (`test/query-counts.test.ts`) + pagination probes  |
| `BACKUP`  | `pg_dump` → `pg_restore` into a scratch database, with integrity checks    |
| `MIGRATE` | `prisma migrate deploy` from an empty database                             |

---

## The 15 acceptance items

### 1. Role-based access — **PASS**

Three roles (ADMIN, TEACHER, PARENT) enforced server-side on every request.

`PROBE`: 12 RBAC assertions. A parent is refused `/dashboard/admin`,
`/dashboard/teacher`, `/observations/review-queue`, `/audit`, `/users`,
`/groups`, notification creation and assessment writes — all **404**, never 403.
An admin and a teacher reach their own dashboards.

Frontend role checks are UX only and documented as such in
`components/shell/require-role.tsx`; `SUITE` (web) asserts a parent is redirected
away from admin routes, and `PROBE` proves the API refuses regardless.

### 2. Teacher child access — **PASS**

A teacher reaches children in groups they are assigned to, and no others.

`PROBE`: assigned child → 200; unassigned child in the _same_ kindergarten →
404; **revoked** `GroupTeacher` (assignment ended) → 404 on the child, its
observations and its group assessment.

### 3. Parent child access — **PASS**

`PROBE`: own child → 200; another parent's child in the same kindergarten →
404; **revoked** guardianship (`canView: false`) → 404 on the child, its
observations and its portfolio.

### 4. IDOR protection — **PASS**

Direct id substitution attempted across `childId`, `groupId`, `enrollmentId`,
`observationId`, `assessmentId`, `notificationId`, `reportJobId`, `mediaId`.

`PROBE`: 16 IDOR assertions plus 16 tenant-isolation assertions. A teacher in
kindergarten B cannot read, PATCH or review an observation belonging to
kindergarten A. A nonexistent id is 404; a malformed id is 400 — and a
forbidden id is indistinguishable from an absent one.

`SUITE`: `test/authz-consistency.test.ts` additionally holds the list query and
the detail path to identical answers across 19 cases, so a child cannot appear
in one and 404 in the other.

### 5. Child / teacher / parent management — **PASS (API), PARTIAL (UI, by decision)**

The API implements children, guardianships, enrollment, users, memberships,
groups and school years, all covered by `SUITE`.

**Admin CRUD screens are deliberately not built or linked.** Confirmed with the
client as an intentional Phase 1 decision. Nothing in the UI points at them, so
there is no dead navigation — `SUITE` (web) asserts the admin shell links only
to implemented routes. Administration is done through the API and the seed
tooling in this phase.

> **Superseded 2026-08-25.** The admin screens exist now — `/admin/school-years`,
> `/admin/groups`, `/admin/users`, `/admin/terms` and `/admin/kindergarten`, all
> linked from `/admin` (`admin/page.tsx:94–99`). The PARTIAL above records what
> was true at acceptance; this item now reads **PASS** on both halves. What is
> still unlinked is the assessment-configuration CRUD (domains, levels,
> observation types) — API complete, no screen — and that is tracked as its own
> item in the Phase III build.

### 6. Observations — **PASS**

Create, read, update, review. Teacher and parent submission paths are separate
endpoints with different accepted fields (RFP §5.4).

`PROBE`: a teacher-created observation defaults to `visibleToParents: false`,
verified against a live response. `SUITE` (web) guards the same default in the
form, because a pre-checked box would publish every private note by default.

### 7. Assessments — **PASS**

`PROBE`: a parent does not see an unpublished assessment; a teacher does. The
group endpoint **requires** `domainId` — omitting it is a 400, which is what
keeps the cancelled nine-domain matrix from reappearing. `SUITE` (web) asserts
exactly one domain selector and one radiogroup per child.

`SUITE`: `assessment.test.ts` measures 2 queries for a group of 2 and 2 for a
group of 20.

### 8. Photos — **PASS**

Upload through the API (never a presigned PUT), content-sniffed, EXIF stripped.

`PROBE`: a valid PNG is accepted; a text file named `.jpg` is **rejected**; an
executable named `.png` is **rejected**; an 11 MB upload is rejected. Serving is
covered by item 13.

### 9. Age information — **PASS**

"Миний тухай" plus ages 2–5 plus birthday notes, with the two-voices rule: a
guardian writes `parentNote`, a teacher writes `teacherNote`, neither
overwrites the other. `SUITE`: `portfolio.test.ts`. The UI never renders the
field it may not write.

### 10. Term report — **PASS**

`PROBE`: a parent sees `{ exists: false }` for a DRAFT term report — the same
shape as "not written", so the existence of an unfinished report is not
disclosed. A teacher sees the draft.

`RESET`: a teacher previewing an unfinalised report gets a PDF stamped
**ТӨСӨЛ** with the signature block suppressed, so a draft cannot be handed to a
parent as though it were final.

### 11. PDF — **PASS**

`RESET`, on a real generated file:

| Check                                          | Result                                       |
| ---------------------------------------------- | -------------------------------------------- |
| Extractable text (not a blank render)          | ✓                                            |
| Cyrillic present                               | ✓                                            |
| Mongolian-specific `өүӨҮ`                      | ✓ (a Russian-only fallback would drop these) |
| Page size                                      | ✓ **A4** (595.28 × 841.89 pt)                |
| Cyrillic font embedded                         | ✓ NotoSans                                   |
| No serif fallback                              | ✓ no Times/Helvetica/Courier                 |
| Page numbering                                 | ✓                                            |
| Child's name and published observation present | ✓                                            |
| **Teacher's copy includes the private note**   | ✓                                            |
| **Parent's copy EXCLUDES the private note**    | ✓                                            |

The last two are the acceptance-critical pair: the report is the one artefact
whose visibility filter is frozen into a file.

### 12. Mobile / tablet / desktop — **PASS (contract), BLOCKED (real devices)**

`SUITE` (web) asserts the sizing and overflow contract: every button ≥ 44px,
inputs and selects 48px, all text controls 16px, `overflow-x: hidden` on `html`,
`overflow-wrap: break-word` for long Mongolian words, a focus ring that is never
removed. The served CSS bundle was checked in the running app for the tokens and
both size floors.

**BLOCKED:** rendering at 375 / 390 / 768 / 1024 / 1440 px was not visually
confirmed. jsdom has no layout engine, so a test of real geometry would pass
while asserting nothing. See `FINAL_DEVICE_QA.md`.

### 13. Private file access — **PASS**

`PROBE`, against live MinIO:

- The owner gets a **302** to a presigned URL carrying a signature and an expiry.
- Fetching the object **without** the query string returns 403 — the bucket is
  private.
- A teacher from another kindergarten, a **revoked** teacher, a **revoked**
  guardian and a parent from another tenant all get 404 when asking for a URL.
- An unauthenticated request gets 401.
- Metadata does not expose `storageKey` or any bucket path.

Revocation is checked **at signing time**, so losing access stops future URLs
immediately; an already-issued URL remains valid until it expires (minutes),
which is inherent to presigning and is documented.

### 14. Backup / restore — **PASS**

`BACKUP`, a real round trip — not a claim:

```
pg_dump -Fc            → 114,419 bytes, exit 0
pg_restore --no-owner  → exit 0, 0 errors
```

Verified in the restored database: row counts identical
(`children=1 obs=25 users=3`), **5 partial unique indexes** present, **71
foreign keys** present, argon2id password hashes intact, and the Prisma
migration history preserved. Procedure documented in `PRODUCTION_READINESS.md`.

### 15. Approved Phase 1 UI direction — **SUPERSEDED, needs re-approval**

**Verified 2026-08-20 as PASS**, against the palette approved for Phase 1:
`#F8F7F4` canvas, `#6C63FF` primary, `#26242B` ink, `#77737D` muted, `#E9E6E0`
border, 12px control radius, 16px card radius, 48px controls, 44px tap targets.
No charts, no hero sections, no dense tables. 18 routes, no dead navigation.

> ### ★ Repainted 2026-08-22 — this item no longer describes what ships
>
> The client instructed a change to a white ground with a soft sky-blue accent.
> The tokens in `globals.css` are now `#f8fafc` canvas, `#0ea5e9` primary
> (`#0369a1` where it is coloured text, because sky-500 on white is 3.0:1 and
> fails as a link), `#0f172a` ink, `#64748b` muted, `#e2e8f0` border. The two
> radial background washes were removed rather than recoloured — the new brief
> asks for pure white and ample whitespace, and a tinted corner is the first
> thing that reads as decoration in a layout whose argument is restraint.
>
> **What did not change:** the sizing floors (48px controls, 44px tap targets),
> the radii, "no charts", and the token structure itself — every screen reads
> the tokens, so the repaint was one file rather than 27.
> `responsive.test.tsx` was updated to assert the new values.
>
> **This item is therefore no longer a PASS against a client-approved design.**
> Acceptance criterion 15 of the RFP is "Захиалагчийн баталсан дизайн болон
> хэрэглэгчийн урсгалтай тохирч байх" — the palette that was approved is not the
> palette that ships. It needs re-approving before sign-off, and that is a
> conversation, not a code change.

---

## Summary

| #   | Item                            | Status                                               |
| --- | ------------------------------- | ---------------------------------------------------- |
| 1   | Role-based access               | **PASS**                                             |
| 2   | Teacher child access            | **PASS**                                             |
| 3   | Parent child access             | **PASS**                                             |
| 4   | IDOR protection                 | **PASS**                                             |
| 5   | Child/teacher/parent management | **PASS** (admin UI intentionally out of scope)       |
| 6   | Observations                    | **PASS**                                             |
| 7   | Assessments                     | **PASS**                                             |
| 8   | Photos                          | **PASS**                                             |
| 9   | Age information                 | **PASS**                                             |
| 10  | Term report                     | **PASS**                                             |
| 11  | PDF                             | **PASS**                                             |
| 12  | Mobile/tablet/desktop           | **PASS** (contract) · **BLOCKED** (device rendering) |
| 13  | Private file access             | **PASS**                                             |
| 14  | Backup/restore                  | **PASS**                                             |
| 15  | Phase 1 UI direction            | **SUPERSEDED** — repainted 2026-08-22, re-approve    |

**13 PASS · 1 partially BLOCKED · 1 SUPERSEDED · 0 FAIL.**

The single blocked item is device rendering, which needs a browser this
environment does not have. It blocks sign-off, not deployment, and
`FINAL_DEVICE_QA.md` sets out exactly what a person with a phone must check.

### Re-verified in Phase 13 against the production Docker container

Items 1–4, 6–8, 10, 11 and 13 were re-run against the built image rather than a
dev server — 121 probes, 0 failures — with `CORS_ORIGINS=https://nomadkids.mn`.
Item 11 in particular was re-proven from inside the container: A4, 945
characters of extracted text, `өүӨҮ` present, NotoSans embedded, no serif
fallback.

Item 14 (backup/restore) was rehearsed a second time against data the container
itself had written.

**Password-reset delivery**, listed in Phase 12 as an accepted gap, is now
implemented and verified end to end against a real SMTP server.

# Явцын үнэлгээ — parity with the reference, and then past it

**Date:** 2026-09-09
**Status:** approved by the client in conversation, 2026-09-09
**Touches:** `apps/api/prisma/`, `apps/api/src/assessment/`, `apps/web/app/(app)/groups/[groupId]/assessment/`, `docs/MIGRATION_PLAN.md`

---

## 1. What was actually asked, and what was found

"багшийн хэсгийн явцын үнэлгээг яг адилхнаар оруулаад ир backend ntr-тэй нь."

★ **"Яг адилхан" cannot be taken literally, and CLAUDE.md is why.** The Django
project is the source of truth for business rules, terminology and validation —
**not** for architecture, models, templates or services, which the file states
in as many words: "Do not port its structure." So what follows matches the
teacher's _screen and its rules_, built on v2's own layering.

Three findings changed the shape of the work:

**(a) v2's backend is already ahead.** Route for route it covers every Django
view, plus `GET /children/:id/assessment-radar`, a publish action, and full CRUD
for domains, levels _and_ observation types (`catalog`) where Django has domain
CRUD alone.

**(b) Three of the four panels the client is pointing at do not work in
Django.** `templates/assessment/group_grid.html` writes `width:0%` and `<b>0</b>`
inline; `selectors.group_grid` returns no coverage keys, and no JavaScript fills
them — only `static/css/assessment-coverage.css` exists. The template says so
itself: "бодит өгөгдөлтэй холбогдоход энд харагдана."

So "backend ntr-тэй нь" is the whole request: **the same screen, actually
wired.** That is not a port. It is building what the reference only drew.

**★★ CORRECTION, found while building stage 1: stage 2 was already built.**
`apps/web/components/assessment/group-coverage.tsx` (412 lines) is mounted on
this very screen and already draws all four panels — the goal board
("Хүүхэд бүрийн үнэлгээний хамралт"), observation-type coverage, domain
coverage, activity progress and monthly note coverage — backed by a real
endpoint, `GET /groups/:id/observation-stats`, whose repository does the whole
thing in one `Promise.all` of `groupBy`s (§3.4). §4 below described building
what exists. **Stage 2 is struck**; the finding stands as a warning that this
screen is larger than it reads, and that the reference's dead panels have live
counterparts here under different names.

★★★ That also softens (c): v2's third chart is real, it simply groups by the
free-text `activityName` and shows whatever teachers actually typed, rather
than the reference's four invented categories. The client's decision to drop
the categorised version therefore costs nothing at all — the panel is already
there and already honest.

**(c) One panel has no data anywhere.** "Үйл ажиллагааны явц" charts four fixed
categories — Чөлөөт тоглоом, Хичээл, Гадаа, Өдөр тутмын дэглэм. Neither project
has such a field: Django's `activity_name` is a free-text `CharField(200)` and
so is v2's `activityName`. The categories exist only as literals in a dead
template.

★ **Dropped, at the client's decision (2026-09-09), and the reasoning is worth
keeping.** Building it means a configuration table (§2.3 forbids an enum), an
admin screen, a new control on every observation a teacher writes — and then a
chart that reads **zero** until staff have been filling that control for weeks,
because every existing row is NULL. That is the Django screen, reached
expensively. The other two charts run on data this product already has.

---

## 2. Scope, in three stages

Deliberately three branches, smallest and least risky first.

| Stage     | What                                                                    | Backend                    |
| --------- | ----------------------------------------------------------------------- | -------------------------- |
| **1**     | Child search on the grid · child-progress drawer with the radar         | none — the endpoint exists |
| ~~**2**~~ | ~~Coverage · goal board~~ — **already built**, see the correction in §1 | —                          |
| **3**     | `DevelopmentIndicator` — per-criterion assessment                       | schema, migration, API, UI |

---

## 3. Stage 1 — UI only

**Child search.** The grid lists a whole group; Django puts a "Хүүхэд хайх,
эсвэл сонгох..." box above it. v2 gets the same, using the shared `SearchField`
— the control Order А/261 шалгуур 21 exists to keep identical everywhere, and
the one every list search moved to earlier today. Filtering is client-side over
the rows already loaded: the group is one page, not a paginated set, so a
round trip would be slower and would lose the teacher's half-typed row.

**Child progress drawer.** Pressing a child opens their progress beside the
grid. Django draws a dialog captioned "ХҮҮХДИЙН АХИЦ" with a radar placeholder
and the sentence "…бодит өгөгдөлтэй холбогдоход энд харагдана"; v2 already has
`GET /children/:id/assessment-radar`, so it renders the real thing.

---

## 4. Stage 2 — coverage that is computed

One endpoint, `GET /groups/:id/assessment-coverage?termId=…`, returning:

- **per observation type** — count over `Observation.typeId` (RFP's three:
  ажиглалт, ярилцлага, бүтээл, plus whatever the kindergarten has configured)
- **per development domain** — count over `ObservationDomain`
- **per month** — count over `observedOn`, for the term's months
- **assessed / total** — how many of the group's enrolled children have an
  assessment this term, which is the goal board

★ **The goal board's "target" is the group's enrolled count**, not a stored
figure. Django's is a static number with no model behind it, and
"Хүүхэд бүрийн үнэлгээний хамралт" reads naturally as assessed-of-total — which
needs no new field and cannot go stale.

★★ **§3.4 binds hard here.** Every figure is a grouped aggregate over the whole
group, never a query per child. A group of thirty must cost a fixed number of
queries.

★★★ **§4.1 applies** — this is child data in aggregate. A teacher from another
group, a guardian, and a user from another kindergarten each get **404**,
asserted through HTTP against the real route.

---

## 5. Stage 3 — `DevelopmentIndicator`

★ **This reverses a written decision.** `docs/MIGRATION_PLAN.md:76` records
`DevelopmentIndicator` as deliberately dropped — "The MVP assesses at domain
level; the FK on `Assessment` is already nullable and unused by every screen."
The client asked for it on 2026-09-09. **That line must be amended in the same
commit**, saying what changed and when: a document the codebase contradicts
stops being read, which is the argument CLAUDE.md §7 makes four times over.

**The model**, following Django's fields and v2's conventions:

```prisma
model DevelopmentIndicator {
  id             String  @id @default(uuid()) @db.Uuid
  kindergartenId String  @db.Uuid          // §3.1, denormalised
  domainId       String  @db.Uuid
  name           String
  ageFrom        Int     @default(2) @db.SmallInt
  ageTo          Int     @default(5) @db.SmallInt
  order          Int     @default(0)
  isActive       Boolean @default(true)
  deletedAt      DateTime?                  // §3.2
}
```

`ageFrom`/`ageTo` are Django's `age_from`/`age_to`: an indicator applies to part
of the 2–5 range, so a two-year-old's grid does not show a five-year-old's
criteria.

### The constraint, which decides the migration

`Assessment` carries `@@unique([childId, termId, domainId])` and both write
paths upsert on it (`assessment.repository.ts`). Adding a nullable `indicatorId`
naively breaks that: Postgres treats NULLs as **distinct**, so a child could
accumulate unlimited domain-level rows for one term.

★ **Postgres 17 in both production and CI**, so the fix is exact:

```sql
ALTER TABLE assessments DROP CONSTRAINT assessments_childId_termId_domainId_key;
ALTER TABLE assessments
  ADD CONSTRAINT assessments_child_term_domain_indicator_key
  UNIQUE NULLS NOT DISTINCT ("childId", "termId", "domainId", "indicatorId");
```

`NULLS NOT DISTINCT` (PG 15+) makes two domain-level rows collide exactly as
before, while allowing one row per indicator. The compound stays declared in
`schema.prisma` so Prisma keeps generating the upsert `where` input — the
generated SQL differs from the hand-written migration in that one clause, and
the migration says why.

### What stays domain-level

A dish of nuance worth stating: assessing by indicator does **not** remove
assessing by domain. `indicatorId` is nullable, the existing rows keep meaning
what they meant, and the group grid keeps its domain column. Indicators are an
additional depth on the child's own screen, which is where Django puts them.

---

## 6. Not in this spec

- "Үйл ажиллагааны явц" — §1(c).
- Porting Django's templates, views, selectors or services. §1.
- Any change to how a term is published; `POST /children/:id/assessments/publish`
  and the term report's `finalize` already own that and are not touched.

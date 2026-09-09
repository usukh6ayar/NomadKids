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

## 5. Stage 3 — `DevelopmentIndicator` — **struck 2026-09-09**

★ **It is unused in the reference too**, which the first draft of this spec did
not know. `grep -rn indicator` over the whole Django project outside migrations
returns `apps/assessment/models.py` and nothing else — no admin, no view, no
template, no selector, no service. The model's own docstring says why:

> "Deliberately unused in Phase 1: assessment happens at the domain level
> (§6.4, §6.5 and §12.3 all aggregate per domain). The table and the nullable
> `Assessment.indicator` column exist now so that criteria can be added later."

And on `Assessment`: "`indicator` stays NULL in Phase 1 and is deliberately
left out of the constraint."

So `MIGRATION_PLAN.md`'s DROP line was never a v2 decision — it faithfully
carried over the reference's own.

★★ **The RFP does not ask for it either.** "Шалгуур" appears three times, and
all three mean the **domains**: §6.1 is titled "Хөгжлийн чиглэл" and its
examples are Бие бялдар, Хэл яриа, Танин мэдэхүй; §6.3's "Хөгжлийн шалгуураар
шүүх" is the grid's one-domain-at-a-time filter; the admin list's entry is
domain and level configuration. All three already ship — `catalog` has CRUD for
domains, levels _and_ observation types.

★★★ So building it would have been **inventing a feature, not porting one**:
the teacher's screen, the admin screen, the age filter and how sub-criteria sit
beside the domain-level grid would all have been mine to design, against a
production migration and two reversed decisions. The client was told and chose
to drop it — which is what "яг адилхан" pointed at all along.

The migration analysis is kept below, because it was correct and the next
person to consider this should not redo it.

> `Assessment` carries `@@unique([childId, termId, domainId])` and both write
> paths upsert on it. Adding a nullable `indicatorId` naively breaks that:
> Postgres treats NULLs as distinct, so a child could accumulate unlimited
> domain-level rows for one term. Postgres 17 runs in both production and CI,
> so the fix would be `UNIQUE NULLS NOT DISTINCT ("childId", "termId",
"domainId", "indicatorId")` — two domain-level rows collide exactly as
> before, one row per indicator is allowed. Django hit the same wall and chose
> the other way: leave `indicator` out of the constraint and never write it.

## 6. Not in this spec

- "Үйл ажиллагааны явц" — §1(c).
- Porting Django's templates, views, selectors or services. §1.
- Any change to how a term is published; `POST /children/:id/assessments/publish`
  and the term report's `finalize` already own that and are not touched.

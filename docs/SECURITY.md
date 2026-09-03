# SECURITY.md — security design

**Stack:** Next.js (Vercel) ↔ NestJS (Railway/Fly) ↔ PostgreSQL ↔ Cloudflare R2
**Production:** `https://nomadkids.mn` (web) · `https://api.nomadkids.mn` (API)
**Status:** built. Authentication (`apps/api/src/auth/`), the authorization
module (`apps/api/src/authz/`), the media path and the audit trail all ship —
phases 3 and 12 in `IMPLEMENTATION_STATUS.md`. This file remains the design
those were built to: where a section and the code disagree, one of the two is a
bug, and neither is allowed to stay wrong.

★ **This line said "design — authentication is _not implemented yet_" until
2026-08-31.** By then `auth/` had shipped argon2id hashing, the HttpOnly cookie
pair, the CSRF guard, the lockout counter and `test/auth.test.ts`. A security
document whose first paragraph understates what exists reads as a draft, and a
draft's rules stop being treated as mandatory — the same failure CLAUDE.md §7
has now corrected three times, for the same reason.

**Where this file is still design rather than record, it says so in place.** In
particular §6's 108 acceptance cases are the integration suite's specification,
not a claim that 108 of them pass; `IMPLEMENTATION_STATUS.md` is the record of
what was actually run, and it is the one to trust on coverage.

The reference Django system passes RFP §21 today. Its 108 named authorization
tests are reproduced here as an acceptance matrix (§6) — they are the
requirements this system must meet, not code to port.

---

## 1. The one rule

**Authorization lives in exactly one module.** Every access to child data goes
through it. Not in controllers, not in services, not in the frontend.

```
apps/api/src/authz/
    actor.ts                    who is asking — userId + memberships, rebuilt per request
    child-access.ts             the pure decision: canAccessChild(actor, facts)
    child-access.service.ts     loads the facts, then throws 404 — assertCanAccess,
                                assertCanRecord, assertCanContributeMedia,
                                assertCanAdminister
    chat-access.{ts,service.ts} the same shape for a chat room
    platform-access.service.ts  isSuperAdmin — the operator's own screens
    tenant-access.service.ts    assertAdmin / adminKindergartenIds
    authz.repository.ts         the only Prisma access in the module

apps/api/src/auth/guards/       auth · csrf · roles · super-admin
```

★ **The decision and the loading are deliberately separate files.** `*.ts` is a
pure function over facts already fetched — it is unit-testable without a
database (`child-access.test.ts`), and it cannot accidentally widen a query.
`*.service.ts` fetches those facts and turns a `false` into a 404. Guards live
under `auth/` because they are transport concerns: they extract the actor from
a cookie and call into this module.

> This block listed `scope.ts` and `authz/guards/` until 2026-08-31. Neither
> ever existed under those names — the file was written before the module was,
> and nobody came back to it. A map that names files a reader cannot open
> teaches them to stop opening the map.

If the logic exists in two places the REST API and the future mobile client will
answer differently, and §21 fails. In the reference system this module is 430
lines across 19 functions and its own docs call it _"the most important 30 lines
in the system."_

---

## 2. Authentication

| Concern         | Decision                                                         |
| --------------- | ---------------------------------------------------------------- |
| Hashing         | **argon2id** (`argon2` npm), memory 64 MB, time 3, parallelism 1 |
| Password policy | ≥ 8 chars, upper + lower + digit — **Cyrillic counts, see ★**    |
| Lockout         | 5 failures per identifier in 15 min → 15 min block               |
| Reset token     | Single-use, **SHA-256 hashed at rest**, 1 h expiry               |
| Invitation      | Single-use, **SHA-256 hashed at rest**, **7 days** — see ★★      |
| Session         | HttpOnly cookie pair — see §3                                    |

★ **The complexity rule is enforced in the service, not in the Zod schema — and
that is easy to misread.** `apps/api/src/auth/auth.dto.ts` carries only
`z.string().min(8).max(200)`, so reading the DTOs alone suggests there is no
policy. There is: `validatePasswordStrength()` in `password.service.ts` runs on
all three write paths — `confirmPasswordReset`, `acceptInvitation` and
`changePassword` — and rejects with the Mongolian message the user is shown.

**The character classes are deliberately Cyrillic-aware:** `[A-ZА-ЯӨҮ]` and
`[a-zа-яөү]`, not `[A-Z]`/`[a-z]`. A Mongolian parent typing `Нууцүг123` passes;
a Latin-only rule would have rejected a perfectly good password in the language
the product is written in. `password.service.test.ts` pins that case.

The one thing a reader should not conclude from this split is that the DTO is
the place to add the next rule. Validation that produces a user-facing sentence
belongs where the sentence is built.

★★ **Reset and invitation deliberately differ, and the difference is not a
mistake.** A reset is recovery of an account someone already has, minutes after
they asked for it; an hour is generous. An invitation is a kindergarten handing
a QR code to a parent at pick-up — the parent gets to it that evening, or on the
weekend. Seven days is the number in `users.service.ts`
(`INVITATION_TTL_MS`), and both are single-use: the row is consumed on
acceptance, so a long window is a window on an unused credential, not a
re-usable one. This table said "1 h" for both until 2026-08-31 and had never
matched the code.

> **The lockout counter must survive a failed request.** `LoginAttempt` rows and
> `AuditLog` rows for `login_failed` exist to record things that went wrong. If
> they are written inside a transaction that the failing request rolls back, the
> counter silently resets and the lockout never fires. **Write them outside any
> interactive transaction.** The reference system needed an explicit
> `@transaction.non_atomic_requests` for this; Nest has no implicit request
> transaction, so the requirement is simply "do not wrap them."

Password reset must be **timing-neutral**: an unknown email returns the same
response and takes the same time as a known one.

---

## 3. Auth transport

**Confirmed production origins (D1 + D13, 2026-08-19):**

| Role | Origin                     | Hosted on   |
| ---- | -------------------------- | ----------- |
| Web  | `https://nomadkids.mn`     | Vercel      |
| API  | `https://api.nomadkids.mn` | Railway/Fly |

Two different **origins**, but one registrable domain — `nomadkids.mn` — and
therefore **same-site**. That single fact is what keeps the browser's own CSRF
protection working, and it is why the domain was settled before the auth module
was written rather than after.

### 3.1 Cookies

| Attribute  | Value                                       | Why                                        |
| ---------- | ------------------------------------------- | ------------------------------------------ |
| `HttpOnly` | yes                                         | JavaScript must never read the token       |
| `Secure`   | yes                                         | HTTPS only                                 |
| `SameSite` | **`Lax`**                                   | the two origins are same-site              |
| `Domain`   | **not set** — host-only                     | see below                                  |
| `Path`     | `/` for access, `/auth/refresh` for refresh | refresh token is not sent on every request |

#### Why `Domain` is deliberately left unset

The instinct is to set `Domain=.nomadkids.mn` so the apex and the API "share"
the cookie. **That is not needed, and it is weaker.**

The cookie is issued by `api.nomadkids.mn` and only ever needs to travel back to
`api.nomadkids.mn`. A host-only cookie already does that: when the page at
`https://nomadkids.mn` calls the API with `credentials: "include"`, the request
goes to `api.nomadkids.mn`, so the host-only cookie matches. `SameSite=Lax` does
not interfere, because Lax restricts cross-**site** requests and these two
origins are same-site.

Setting `Domain=.nomadkids.mn` would broadcast the session cookie to _every_
present and future subdomain — a marketing site, a staging box, a third-party
tool on `status.nomadkids.mn` — for no gain. `COOKIE_DOMAIN` is therefore empty
in production, and `apps/api/src/config/env.ts` accepts that as correct while
rejecting a value that is missing its leading dot.

The web app never reads the cookie in any case; it is `HttpOnly`.

> `SameSite=Lax` still permits top-level cross-site **GET** navigation to carry
> the cookie. That is safe here only because no GET endpoint mutates state — a
> rule §3.3's origin check enforces regardless.
>
> The explicit CSRF defence in §3.3 is kept anyway. `Lax` is a second layer, not
> a replacement: it would silently stop protecting anything if a future
> deployment moved the API to a different registrable domain.

**No token ever goes in `localStorage`.** Not the access token, not the refresh
token. Anything readable by JavaScript is readable by an XSS payload.

### 3.2 Token lifecycle

```
POST /auth/login
  → verify password, check lockout
  → set  access  cookie (JWT, 15 min, HttpOnly Secure SameSite=Lax, no Domain)
  → set  refresh cookie (opaque random 256-bit, 30 days, Path=/auth/refresh)
  → store SHA-256(refresh) in the session table with a family id
  → audit: login

POST /auth/refresh    (only endpoint that reads the refresh cookie)
  → look up SHA-256(presented), reject if unknown / expired / revoked
  → ROTATE: issue a new refresh token, revoke the old one
  → if a REVOKED token is presented → the family was stolen:
      revoke every session in the family, force re-login, audit
  → issue a new access cookie

POST /auth/logout
  → revoke the refresh family, clear both cookies, audit: logout
```

Access tokens are JWTs so the API need not hit the database on every request,
but they carry **only** `userId` and `sessionId` — never roles, never
kindergarten ids. Authority is re-read from `Membership` per request; otherwise
revoking a teacher's assignment would not take effect until their token expires.

**No tokens in `localStorage`, ever.**

### 3.3 CSRF

`SameSite=Lax` already stops a third-party site from causing a credentialed
`POST`. The explicit defence below is kept anyway, for three reasons:

- `Lax` still allows the cookie on a **top-level cross-site GET navigation**.
  That is safe only as long as no `GET` endpoint mutates state — a property that
  has to hold forever, not just today.
- `Lax` protects nothing against a request from another host on
  `nomadkids.mn` itself. Same-site is a weaker statement than same-origin.
- If a future deployment moved the API to a different registrable domain, `Lax`
  would silently stop applying. The layer that does not depend on deployment
  topology should be the one carrying the guarantee.

Two layers:

1. **Double-submit token.** A `csrfToken` cookie plus an `X-CSRF-Token` header
   carrying the same value. Required on every `POST`/`PATCH`/`DELETE`. Rejected
   mismatches return 403 and are audited.

   ★ **The frontend does not copy the header value out of the cookie.** It takes
   it from the session response — `/auth/login` and `/auth/me` both return
   `csrfToken` — because `document.cookie` cannot reach it. The cookie is
   host-only on `api.nomadkids.mn` (§3.1) and cookies scope by **domain**, not
   by site, so a page on `nomadkids.mn` cannot read it even though the browser
   attaches it to every request going to the API. Reading it from the cookie is
   what the client used to do, and it 403'd every write; corrected 2026-08-20,
   see `IMPLEMENTATION_STATUS.md`.

   The browser still supplies the cookie half by itself, which is what makes it
   a double submit: an attacker's page can cause the cookie to be sent but
   cannot learn the value to echo in the header.

2. **Origin check.** Reject unsafe methods whose `Origin` is not in the
   allowlist — in production, exactly `https://nomadkids.mn`.

### 3.4 CORS

```
origin:      exact allowlist from CORS_ORIGINS — never "*", never a regex over *.vercel.app
             production: https://nomadkids.mn
             development: http://localhost:3000
credentials: true
methods:     GET POST PATCH DELETE
headers:     Content-Type, X-CSRF-Token
```

`credentials: true` with a wildcard origin would let any site read authenticated
responses. The environment loader refuses a production `CORS_ORIGINS` containing
`localhost` or a plaintext `http://` origin, so this cannot be got wrong by
copying a development `.env`.

Preview deployments get an explicit allowlist entry or they do not talk to the
production API. A Vercel preview URL is a different registrable domain from
`nomadkids.mn`, so a preview pointed at the production API would be cross-site —
`SameSite=Lax` would drop the cookie and the preview simply would not
authenticate. That is the correct outcome; previews get their own API.

### 3.5 Future mobile

Mobile clients get `Authorization: Bearer` against the same endpoints, issued by
a separate `/auth/token` route. **Cookie auth and bearer auth must never both be
accepted on one request** — pick a scheme per request and reject ambiguity, or
the CSRF protection can be bypassed by presenting a bearer header.

---

## 4. RBAC

Three roles, held per kindergarten via `Membership`: `ADMIN`, `TEACHER`,
`PARENT`.

Role alone is never sufficient for child data. A teacher's role lets them use
teacher screens; it does not tell you _which children_. Every child-scoped
endpoint runs a role check **and** an ownership check.

| Role      | May reach                                                               |
| --------- | ----------------------------------------------------------------------- |
| `ADMIN`   | every child in kindergartens where they hold an active ADMIN membership |
| `TEACHER` | children enrolled in groups they are actively assigned to               |
| `PARENT`  | children they have an active `Guardianship` for with `canView = true`   |

---

## 5. Child authorization — the ownership rules

### 5.1 The two chains

```
TEACHER:  User → Membership(active, TEACHER)
               → GroupTeacher(endedOn IS NULL)
               → Group
               → Enrollment
               → Child

PARENT:   User → Guardianship(canView = true, deletedAt IS NULL)
               → Child

ADMIN:    User → Membership(active, ADMIN) → Kindergarten
               → Child.kindergartenId ∈ those kindergartens
```

### 5.2 Resolve the kindergarten from enrollment history

`Child.kindergartenId` is a denormalised "currently attending" pointer for
listing and filtering. **It is not an authorization input**, with exactly one
deliberate exception.

```ts
// ✅ reads Enrollment history internally
if (!(await canAccessChild(actor, child))) throw new NotFoundException();

// ❌ after a transfer, the previous teacher loses access to observations
//    they wrote themselves
if (!actor.kindergartenIds.includes(child.kindergartenId)) throw ...
```

**The one exception — kept deliberately (D8, decided 2026-08-19).**

The fallback exists for exactly one situation: a child has just been created and
has **no enrollment rows at all**, so the enrollment-derived kindergarten set is
empty and every user — including the staff member who is still filling the record
in — would be locked out.

The rule, precisely:

```ts
function childKindergartenIds(child, enrollments): Set<string> {
  // Any enrollment at all — active, ended, from a previous school year —
  // means history is authoritative and the column is never consulted.
  if (enrollments.length > 0) return new Set(enrollments.map((e) => e.kindergartenId));

  // Only when the child has no history whatsoever.
  return new Set([child.kindergartenId]);
}
```

Three properties this must have, and which the tests must assert:

1. **The trigger is `enrollments.length === 0`, not "no _active_ enrollment".**
   A child whose only enrollment has ended still resolves from history. Using
   "no active enrollment" instead would silently re-grant the current
   kindergarten access to every archived child — a much wider hole that looks
   almost identical in code review.
2. **It can never override an active enrollment**, because it is only reached
   when the enrollment list is empty. It is a fallback, never an addition — the
   two sets are never unioned.
3. **It widens nothing else.** It supplies a kindergarten set; the role and
   ownership checks that consume that set are unchanged.

Do not add a second exception.

### 5.3 Post-transfer access — preserved unchanged (D2, decided 2026-08-19)

A teacher who wrote observations about a child **retains access to that child's
record after the child transfers away**, because the kindergarten set is derived
from the child's full enrollment history rather than their current placement.

This is intentional: the alternative is a teacher losing their own professional
records.

**Phase 1 preserves this behaviour exactly as the reference system implements
it.** Authorization semantics are not changed during the stack migration.

The reasoning is worth stating, because the narrower policy is tempting: a stack
migration is the one time you cannot tell a behaviour change from a porting bug.
If access rules shift at the same moment the framework, ORM and language shift,
then any 404 a teacher reports is ambiguous — policy or defect? Holding the
semantics fixed makes the reference suite's 108 cases a true oracle: **any
divergence is a bug, by definition.**

> **Open product question — Phase 2, not Phase 1.**
> Should a previous teacher reach only _observations and assessments from the
> period they taught the child_, rather than the child's current portfolio? The
> current behaviour means they keep seeing new material added by the child's new
> kindergarten. This is a product and privacy decision for the client, not a
> technical one. **Do not implement it in Phase 1.** Recorded here so it is not
> lost, and so the current behaviour is understood as chosen rather than
> inherited by accident.

### 5.4 404, never 403 — for every authorization failure

**Every** authorization failure returns 404. Not only child data: a wrong-role
user on an admin screen, a director reaching for another kindergarten's group, a
guardian probing another family's child — all 404.

A 403 confirms the resource exists, which is itself a disclosure. "Is there a
child with id X in this system" must not be answerable, and neither should "does
this kindergarten have a group with id Y".

**Corollary:** an id that does not exist and an id the actor may not see must be
**indistinguishable**, in both status code and response time.

#### The one exception — 402, the portal access fee

★ Added 2026-09-01 with the access-fee module. It is the only status other than
404 an authorization failure may produce, and it is worth stating why the rule
above does not reach it.

The rule protects one fact: _whether a record exists_. A 402 is only ever shown
to someone who has **already been authorized for that child** — one of their own
guardians. They know the child exists; they see them every afternoon. Nothing is
disclosed. What a 404 would do instead is hide the one thing that would let them
act: a fee is owed, and here is where to pay it.

So the order is not negotiable, and it is what makes the exception safe:

```
canAccessChild(actor, facts)   →  false  →  404      (never reaches the fee)
                               →  true
                                     ↓
isPortalAccessBlocked(...)     →  true   →  402
```

A stranger is refused **before** the fee is consulted, so the 402 can never
answer "is there a child with id X". `authz/portal-access.ts` throws a distinct
exception type for exactly this reason — so the status cannot be widened by
accident into a path where 404 is load-bearing — and
`apps/api/test/portal-access.test.ts` pins the stranger's 404 both before and
after a subscription is paid.

Staff are never gated: a teacher, admin or accountant is doing the
kindergarten's work, and locking them out because a family has not paid would
break the classroom to punish the family.

#### Why uniform, when a role gate arguably reveals nothing

The narrower rule — 404 for resources, 403 for pure role gates — is defensible:
nothing is hidden by admitting an admin section exists. It is rejected anyway,
for two reasons:

1. **The reference implementation is uniformly 404.** Its own tests assert it
   for role gates too (`test_a_teacher_cannot_reach_the_admin_screens`,
   `test_a_guardian_cannot_open_the_teacher_dashboard`). Those are acceptance
   criteria, and D2 settled that authorization semantics do not change during
   the stack migration.

2. **Two rules cannot be applied consistently across dozens of endpoints.** Each
   new route becomes a judgement call about which case it is — and the
   difference between 403 and 404 is exactly what an attacker enumerates. A
   single answer has no judgement calls to get wrong.

**The one exception: 403 means CSRF or origin rejection.** That is a malformed
request rather than an authorization decision. Keeping it distinct means a
genuine CSRF failure is diagnosable instead of looking like a missing record.

Implemented in `RolesGuard` (throws `NotFoundException`) and
`ChildAccessService` (likewise). `CsrfGuard` is the only guard that throws 403.

### 5.5 Never trust the client

Never taken from the request: `childId` as proof of access, `groupId` in a body,
`kindergartenId` in a body or query, `parentId`, any role claim, any "is this
mine" flag. Frontend route guards are UX, not security. Every one of these is
re-derived server-side from the authenticated user.

---

## 6. Acceptance matrix

Extracted from the reference suite: **108 named tests across 23 files** that
assert a 404. These are the cases the new system must reproduce. Each maps to
one of the seven attack classes named in the brief.

### 6.1 IDOR — changing an id in the URL

| Case                                                 | Reference test                                                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Child detail, another child                          | `test_guardian_of_another_child_gets_404` (children, assessment, observations, portfolio, media, reports, term_report) |
| Child edit                                           | `test_a_guardian_cannot_edit_their_own_child`                                                                          |
| Observation detail of another child's observation    | `test_detail_of_another_childs_observation_gets_404`                                                                   |
| POST an observation for another child                | `test_posting_an_observation_for_another_child_gets_404`                                                               |
| POST an assessment for another child                 | `test_posting_an_assessment_for_another_child_gets_404`                                                                |
| POST to another child's portfolio                    | `test_posting_to_another_childs_portfolio_gets_404`                                                                    |
| Upload screen with another child's id                | `test_the_upload_screen_refuses_another_childs_id`                                                                     |
| Attach media to another child's observation          | `test_attach_refuses_an_observation_belonging_to_another_child`                                                        |
| Delete a file belonging to another child             | `test_delete_refuses_a_file_belonging_to_another_child`                                                                |
| Unknown media id is indistinguishable from forbidden | `test_an_unknown_id_gets_404_not_a_different_answer`                                                                   |
| Parent "switch child" to a child that is not theirs  | `test_switching_to_a_child_that_is_not_theirs_gets_404`                                                                |

### 6.2 Cross-kindergarten isolation

| Case                                                         | Reference test                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------- |
| Any child screen, user from another kindergarten             | `test_user_from_another_kindergarten_gets_404` (×7 modules)      |
| Group assessment grid of another kindergarten                | `test_the_group_grid_of_another_kindergarten_gets_404`           |
| Admin edit form of another kindergarten                      | `test_a_director_cannot_open_another_kindergartens_edit_form`    |
| Admin group of another kindergarten                          | `test_a_director_cannot_open_another_kindergartens_group`        |
| Create a term in another kindergarten                        | `test_a_director_cannot_create_terms_in_another_kindergarten`    |
| Edit another kindergarten's term                             | `test_a_director_cannot_edit_another_kindergartens_term`         |
| End another kindergarten's posting                           | `test_a_director_cannot_end_another_kindergartens_posting`       |
| Announcement of another kindergarten                         | `test_a_guardian_cannot_open_another_kindergartens_announcement` |
| Media: previous kindergarten cannot fetch the new one's file | `test_the_previous_kindergarten_cannot_fetch_the_new_ones_file`  |
| Term from another school year                                | `test_a_term_from_another_year_gets_404`                         |
| Kindergarten admin may not edit a **system** config row      | `test_a_director_cannot_open_a_system_domains_edit_form`         |

### 6.3 Revoked access

| Case                                  | Reference test                                                        |
| ------------------------------------- | --------------------------------------------------------------------- |
| Revoked guardian → child page         | `test_a_revoked_guardian_cannot_open_the_child_page`                  |
| Revoked guardian → via child switcher | `test_a_revoked_guardian_cannot_reach_the_child_through_the_switcher` |
| Revoked teacher → child detail        | `test_a_revoked_teacher_gets_404_on_the_child_detail`                 |
| Revoked teacher → group screens       | `test_a_revoked_teacher_cannot_reach_the_group_screens`               |

### 6.4 Teacher scope within a kindergarten

`test_teacher_from_another_group_gets_404` — asserted independently in
children, assessment, observations, portfolio, media, reports and term reports.
Same kindergarten, wrong group, still 404.

### 6.5 Private observation leakage

| Case                                                     | Reference test                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------- |
| Guardian does not see a hidden observation               | `test_guardian_does_not_see_a_hidden_observation`                         |
| Guardian cannot open the teacher's form                  | `test_a_guardian_cannot_open_the_teachers_form`                           |
| Guardian cannot write a teacher observation              | `test_guardian_cannot_write_a_teacher_observation`                        |
| Guardian cannot review a submitted observation           | `test_a_guardian_cannot_review`                                           |
| Guardian cannot archive an observation                   | `test_a_guardian_cannot_archive_an_observation`                           |
| Teacher cannot use the parent form                       | `test_a_teacher_cannot_use_the_parent_form`                               |
| Parent form refused for another child's parent           | `test_the_parent_form_is_refused_for_another_childs_parent`               |
| Guardian cannot assess / finalize a term                 | `test_a_guardian_cannot_assess`, `test_a_guardian_cannot_finalize_a_term` |
| Child's own guardian cannot reach the term-report editor | `test_the_childs_own_guardian_cannot_reach_the_editor`                    |

### 6.6 Private media leakage

| Case                                                            | Reference test                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Permission check runs **before** the redirect to the signed URL | `test_the_permission_check_runs_before_the_redirect`                   |
| Archived file is no longer served                               | `test_an_archived_file_is_no_longer_served`                            |
| Unknown variant → 404                                           | `test_an_unknown_variant_gets_404`                                     |
| Child's own guardian cannot **delete** media                    | `test_delete_refuses_the_childs_own_guardian`                          |
| Child's own guardian cannot attach to a **teacher's** note      | `test_attach_refuses_the_childs_own_guardian` — **amended, see below** |
| Delete refuses a GET                                            | `test_delete_refuses_a_get`                                            |

> ### ★ Amendment — guardian uploads, 2026-08-22
>
> `test_attach_refuses_the_childs_own_guardian` originally asserted that a
> child's own guardian is refused **all** media attachment. **The client
> instructed on 2026-08-22 that parents may build the photo album**, which RFP
> §2.3 states explicitly ("Хүүхдийн зураг болон зургийн цомог үүсгэх") and which
> §4.4's teacher/parent/joint attribution presumes. The RFP outranks the
> reference implementation.
>
> The case is therefore **narrowed, not dropped**. What it now asserts:
>
> - a guardian may upload to their own child's album, and to **their own**
>   parent observation
> - a guardian is still refused attachment to a **teacher's** observation —
>   otherwise a family could illustrate a private teaching note, which is the
>   leak the original case existed to prevent
> - a guardian may edit metadata only on photographs they uploaded
> - deletion and the profile picture stay staff-only, unchanged
>
> This is the only one of the 108 cases whose meaning has changed. It is
> recorded here rather than in a commit message so the acceptance count stays
> honest: 108 cases, one amended by the client, none silently dropped.

### 6.7 Unauthorized report download

| Case                                                  | Reference test                                        |
| ----------------------------------------------------- | ----------------------------------------------------- |
| Outsider cannot fetch the finished PDF                | `test_an_outsider_cannot_fetch_the_finished_pdf`      |
| A job belongs to whoever asked for it                 | `test_a_job_belongs_to_whoever_asked_for_it`          |
| Report screen offers nothing for an unreachable child | `test_a_child_the_viewer_cannot_reach_offers_nothing` |

### 6.8 Role separation on non-child screens

`test_a_guardian_cannot_reach_the_admin_screens`,
`test_a_teacher_cannot_reach_the_admin_screens`,
`test_a_guardian_cannot_open_the_teacher_dashboard`,
`test_a_teacher_cannot_open_the_admin_dashboard`,
`test_a_guardian_cannot_reach_the_configuration`,
`test_a_teacher_cannot_reach_the_configuration`,
`test_a_guardian_cannot_create_one` (announcement),
`test_a_guardian_cannot_open_a_draft`.

### 6.9 How these must be tested

**Through HTTP, against the real route.** A unit test of `canAccessChild()`
passes even when a controller forgets to call it.

```ts
// ✅ proves the endpoint checks
const res = await request(app).get(`/children/${otherChild.id}`).set(cookie);
expect(res.status).toBe(404);

// ❌ insufficient — passes even if the controller never calls it
expect(await canAccessChild(user, otherChild)).toBe(false);
```

**Every new endpoint touching child data requires, at minimum:**
`teacher from another group → 404`, `guardian of another child → 404`,
`user from another kindergarten → 404`.

---

## 7. Media security

### 7.1 Rules

- **Private R2 bucket.** No public access, no custom public domain, no
  `MEDIA_URL` that serves files directly.
- **`storageKey` is a random UUID path** — `children/{uuid}/{uuid}`. Never
  derived from the child's name, id, or the uploaded filename. The real filename
  lives only in `originalName`, for display.
- **Authorization precedes URL issuance**, always. The reference suite tests
  this ordering explicitly.
- **Presigned URLs are short-lived** — 5 minutes, download only.

### 7.2 Download flow

```
GET /media/:id
  → load MediaFile (deletedAt: null, status: READY)
  → canAccessChild(actor, mediaFile.child)      ← BEFORE anything else
  → audit: download
  → 302 to a 5-minute presigned R2 GET URL
```

Failure at any step → **404**, not 403.

### 7.3 Upload flow

```
POST /children/:childId/media  (multipart, through the API — not direct-to-R2)
  → canRecordForChild(actor, child)
  → size limit enforced before reading the body (10 MB)
  → sniff the real MIME type from CONTENT (file-type), not the extension
  → allowlist: image/jpeg, image/png, image/webp — reject everything else
  → strip EXIF (location data on photographs of children)
  → generate a random storageKey
  → PUT to R2
  → insert the MediaFile row
  → audit: create
```

> **Uploads go through the API, not by presigned PUT direct to R2.** A presigned
> PUT hands the client a URL it can write anything to; content-type sniffing and
> EXIF stripping cannot be enforced. The cost is bandwidth through the API
> container, which at MVP volume is irrelevant. **Revisit only if upload volume
> demands it, and then only with post-upload validation.**

**Never trust the extension.** A `.jpg` can be an executable.

### 7.4 Delete and orphans

Deleting sets `deletedAt` and `status = ARCHIVED`; the object stays in R2.
Archived files stop being served immediately (reference test:
`test_an_archived_file_is_no_longer_served`).

Two orphan classes, both handled by one nightly job:

- **R2 objects with no row** — an upload that failed after PUT but before insert.
- **Rows archived more than 90 days ago** — object deleted, row kept for audit.

The job lists R2 by prefix, diffs against `MediaFile.storageKey`, and only ever
deletes objects older than 24 hours (so an in-flight upload is never collected).

### 7.5 Report output

A generated PDF is a `MediaFile` with `purpose = REPORT_OUTPUT` and inherits
this whole path. There is no separate, weaker route for reports.

---

## 8. Tenant isolation

Every tenant-scoped table carries `kindergartenId`. Every repository method
takes a scope derived from the authenticated user and applies it as a `WHERE`
clause. No query reaches Prisma without one.

**Prisma has no soft-delete or row-level-security equivalent to Django's
manager.** Two mitigations:

1. `prisma.*` is callable **only** from `*.repository.ts`. Enforced by an ESLint
   `no-restricted-imports` rule, so a service that reaches for the client fails
   CI.
2. Each repository exposes a base filter including `deletedAt: null` and the
   tenant scope; methods extend it rather than replacing it.

Postgres row-level security is the stronger answer and is **not** proposed for
the MVP — it needs a per-request session variable and complicates Prisma's
connection pooling. Recorded as a Phase 2 option.

---

## 9. Rate limiting

Corrected against the implementation in Phase 12 — the table below previously
described limits the code did not have.

| Endpoint                            | Limit                                    | Keyed by              |
| ----------------------------------- | ---------------------------------------- | --------------------- |
| `POST /auth/login`                  | **60 / 15 min**                          | IP                    |
| `POST /auth/login`                  | **5 failures / 15 min → 15 min lockout** | identifier (database) |
| `POST /auth/password-reset`         | 20 / hour                                | IP                    |
| `POST /auth/password-reset/confirm` | 10 / hour                                | IP                    |
| `POST /auth/refresh`                | 60 / hour                                | IP                    |
| `PATCH /auth/password`              | 10 / hour                                | user                  |
| `POST /children/:id/media`          | 60 / hour                                | user                  |
| `POST /reports`                     | 20 / hour                                | user                  |

There is deliberately **no global limit** on ordinary reads. Every one of them
is already authorized per request, and a blanket ceiling would be the first
thing to misfire on a busy morning while adding nothing an attacker cannot get
around with a second account.

### ★ Why the per-IP login limit is 60 and not 10

It was 10, and that is wrong in a way that only shows up on the first morning of
real use.

Brute force is stopped by the **per-identifier lockout**: five failures against
one account locks it for fifteen minutes, recorded in the database so it
survives a restart and holds across instances (`AuthService.login`, and §6.2 of
CLAUDE.md explains why those writes are non-transactional). That is the control
doing the real work.

The per-IP limit is supplementary — and an IP, in a kindergarten, is _one
address for the whole building_. At 10 per fifteen minutes, eight teachers
signing in at 8am plus one person mistyping twice exhausts it, and nobody in the
building can log in until the window rolls. Staff would experience the security
control as the product being broken, with nothing to tell them why.

60 is unreachable by shared-NAT staff and still only four attempts a minute —
useless as a spray rate against accounts that each lock after five failures.

Found by running the Phase 12 probes: they tripped the limit, locked out the
test suite, and made the cause obvious.

### Trusting the client IP

Behind a proxy, `X-Forwarded-For` is trusted for exactly **one hop**
(`app.set("trust proxy", 1)`). Trusting all hops lets a client forge the header
and escape every per-IP limit; trusting none collapses every limit into a single
bucket for the load balancer's own address.

### Storage

In-memory, per instance — an accepted MVP trade-off recorded in
`RateLimitService`. With one API container that is the real limit; with several
it becomes N× the configured value. The account lockout that actually protects
passwords is in the database and does not have this property. Redis is already
in the stack for BullMQ if this needs to change.

---

## 10. Secrets

All configuration from the environment. `.env` gitignored, `.env.example`
updated with every new key. No secret in source, in a commit, or in a log line.

`DATABASE_URL`, `JWT_SECRET`, `REFRESH_SECRET`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`, `REDIS_URL`, `SMTP_*`,
`CORS_ORIGINS`, `COOKIE_DOMAIN`.

Rotation: JWT signing keys carry a `kid` so a rotation does not invalidate every
live session at once.

---

## 11. Logging

**Never logged:** passwords, tokens, cookies, `Authorization` headers, reset
tokens, presigned URLs (they are credentials), children's names or national ids
in error messages.

Logs are structured JSON with a request id. Errors report the id to the user;
the detail stays server-side. Stack traces never reach the browser in
production.

---

## 12. Audit trail

`AuditLog` is append-only: no update, no delete, no soft delete. Enforced at the
repository layer, which exposes only `append()`.

Recorded: `login`, `login_failed`, `logout`, `view` (selectively — opening a
child's portfolio, viewing a report, downloading a file), `create`, `update`,
`delete`, `restore`, `download`, `export`, `permission_change`,
`password_reset`, `invite`, `activate`.

Each row stores the actor's name as text (`actorLabel`) so a deleted user's
actions stay attributable, plus IP, user agent, the object touched, and
`childId` when child data was involved — so "who has accessed this child's
record" is one indexed query.

**Written in the same transaction as the action it records**, except the
authentication failures of §2.

---

## 13. Backup and restore

| Item              | Decision                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres          | Managed provider's automated daily backup + PITR; verify the provider's retention before launch                                                               |
| Independent dump  | Nightly `pg_dump` to R2, 30-day retention — do not rely solely on the provider                                                                                |
| R2                | Object versioning on; lifecycle rule expiring noncurrent versions after 30 days                                                                               |
| Encryption        | Dumps encrypted before upload; the key is not stored beside them                                                                                              |
| **Restore drill** | **A backup that has never been restored is not a backup.** Restore into a scratch database and run the seed-verification script before launch, then quarterly |

---

## 14. Privacy

This system holds identifiable data about **children**: names, national ids,
dates of birth, health notes, photographs, and developmental assessments.

### 14.1 Data residency — D13, ✅ APPROVED 2026-08-19

**The client has approved storing this application's data in cloud
infrastructure outside Mongolia.** Vercel, Railway/Fly and Cloudflare R2 are
therefore confirmed, and the production domain is `nomadkids.mn`.

The question was put to them explicitly rather than settled by an infrastructure
default, because "where does children's personal data live" is a contractual
question, not a hosting preference. It is recorded here so a future reader knows
the answer was obtained, from whom, and when — and does not have to re-litigate
it.

**What the approval does not change.** The foundation still reaches Postgres
through `DATABASE_URL` and object storage through an S3-compatible client
(MinIO locally, R2 in production). That indirection was built so a "must be
hosted in Mongolia" answer would be a deployment change rather than a rewrite.
The answer went the other way, but the property is worth keeping: regulation
changes, and clients change their minds. **Do not hard-code an R2-specific or
Vercel-specific assumption into application code.**

Consequent obligations that the approval does _not_ discharge:

- **Deletion still has to work.** A parent or the client may ask for a child's
  data to be removed; "it is in someone else's cloud" is not an answer. Retention
  and purge remain a real requirement.
- **Sub-processors.** The client has approved cloud hosting in general; if a new
  third-party service that touches child data is introduced later, that is a new
  question, not a use of this approval.

Other commitments:

- **Consent for photographs** is a Phase 2 feature (`ConsentType` in the RFP).
  Until it exists, photo visibility is governed by `visibleToParents` alone.
- **Minimise.** No field is collected because it might be useful later.
- **EXIF stripped** from every uploaded image — a photograph taken in the
  classroom otherwise carries its GPS coordinates.
- **Retention.** Archived children's data is kept for the period the client
  specifies, then purged; the audit log outlives it by design.

---

## 15. Pre-launch checklist

- [ ] All 108 acceptance cases in §6 have an HTTP-level test, and they pass
- [ ] Cookies verified `HttpOnly; Secure; SameSite=Lax` in production, with **no
      `Domain` attribute** — inspect the real `Set-Cookie` header, not the code
- [ ] `https://nomadkids.mn` authenticates against `https://api.nomadkids.mn`
      end to end in a real browser
- [ ] `CORS_ORIGINS` is exactly `https://nomadkids.mn` — no wildcard, no
      `*.vercel.app`, no leftover localhost
- [ ] CSRF rejection verified with a real cross-origin request
- [ ] `localStorage` and `sessionStorage` contain no token — checked in the browser
- [ ] R2 bucket confirmed private; a raw object URL returns 403
- [ ] Presigned URL expires at 5 minutes — verified by waiting
- [ ] Upload rejects a renamed executable and a 50 MB file
- [ ] EXIF absent from a stored image that had GPS data
- [ ] Lockout still fires when the surrounding request errors
- [ ] Report worker refuses to boot without a Cyrillic font ([PDF_SPIKE.md](PDF_SPIKE.md) §5)
- [ ] A generated PDF is verified by **extracted text**, not by file size
- [ ] Backup restored into a scratch database successfully
- [ ] No secret in the repository — history scanned
- [x] Data-residency approved by the client (§14.1, 2026-08-19)

---

## 16. Decision record

Settled 2026-08-19.

| #       | Decision                                         | Outcome                                                                                                                           |
| ------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| D1      | Single registrable domain for web + API          | **Approved.** `nomadkids.mn` (web) + `api.nomadkids.mn` (API), `SameSite=Lax`, host-only cookie (§3.1)                            |
| D2      | Post-transfer teacher access                     | **Preserved unchanged.** Narrowing deferred to Phase 2 as a product decision (§5.3)                                               |
| D8      | No-enrollment fallback on `Child.kindergartenId` | **Kept**, with the trigger condition pinned (§5.2)                                                                                |
| D10     | Uploads through the API, not presigned PUT       | **Approved** (§7.3)                                                                                                               |
| D11     | Postgres RLS                                     | **Phase 2.** Phase 1 relies on the repository layer, centralised authz, tenant filtering, HTTP tests and the ESLint boundary (§8) |
| D12     | Row-level history (`django-simple-history`)      | **Not migrated.** `AuditLog` is sufficient for Phase 1                                                                            |
| **D13** | **Data residency outside Mongolia**              | ✅ **APPROVED by the client**, 2026-08-19. Production domain `nomadkids.mn` (§14.1)                                               |

Schema decisions D3–D7 and D9 are recorded in
[DATABASE.md](DATABASE.md) §14.

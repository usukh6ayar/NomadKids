# Superadmin — kindergarten registration

**Date:** 2026-08-21 · **Status:** approved, not yet implemented

Gives the platform operator a way to register a kindergarten and its first
director. Everything else in the system is tenant-scoped; this is the one
capability that cannot be, because a kindergarten that does not exist yet has
nobody who can create it.

---

## 1. The problem

`seed.ts` creates a user called `superadmin` with no memberships. Every
authorization primitive in the API reads `actor.memberships`:

- `Role` is `ADMIN | TEACHER | PARENT`. There is no platform role.
- `Actor` is `{ userId, sessionId, memberships[] }` — nothing platform-level.
- `RolesGuard` gates on the roles held in those memberships.
- `TenantAccessService` and every repository derive scope from membership
  kindergarten ids; an empty scope correctly matches nothing.

So the seeded superadmin can log in and reach nothing. `MIGRATION_PLAN.md` §5
step 3 ("create the real kindergarten … through the admin UI") has no route that
works today, and `ROADMAP-django.md` §3 assigns kindergarten registration to the
superadmin. This is launch-path work, not a Phase 2 pull-forward.

## 2. How the platform actor exists

**A boolean on `User`, not a role on `Membership`.**

```prisma
model User {
  …
  /// Platform-level operator. Deliberately NOT a Membership role: every
  /// authorization primitive here is tenant-derived, and a system-wide
  /// membership row has no kindergarten to point at.
  isSuperAdmin Boolean @default(false)
}
```

The reference system does it the other way — `Role.SUPERADMIN` on a `Membership`
whose `kindergarten` is null, held in place by a check constraint
(`apps/accounts/models.py:125`). That was considered and rejected. Porting it
would mean making `Membership.kindergartenId` nullable, which breaks CLAUDE.md
§3.1, invalidates `@@unique([userId, kindergartenId, role])`, and adds a null
case to every `kindergartenId: { in: [...] }` filter in the system. That last
consequence is precisely the cross-tenant leak surface §2.2 exists to prevent.
CLAUDE.md's precedence rule puts the Django project ahead on *authorization
requirements* — the requirement is "a system-wide operator registers
kindergartens", and that requirement is satisfied either way. The storage shape
is architecture, where the reference is explicitly not authoritative.

The migration is `ALTER TABLE users ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL
DEFAULT false` — additive, reviewed by hand per §3.3.

`seed.ts` sets the flag on the account it creates, and sets it on an existing
row if the flag is false, so re-running the seed on a database that predates
this change repairs it. Still idempotent.

## 3. Actor and authorization

`Actor` gains `readonly isSuperAdmin: boolean`. `AuthService.resolveActor`
already loads the user row, so it is populated with no extra query.

Nothing is added to the token. The flag is re-read on every request like
everything else — CLAUDE.md §1.3 — so clearing it takes effect immediately
rather than at token expiry.

A new `PlatformAccessService` in `apps/api/src/authz/` holds the decision:

```ts
assertSuperAdmin(actor: Actor): void   // throws NotFoundException
```

**`TenantAccessService` and `ChildAccessService` are not touched.** The flag
grants platform reach and nothing else: a superadmin does not become an admin of
every kindergarten and cannot read a child, its portfolio, its observations or
its guardians. §7 makes that a tested property rather than an intention.

A `@SuperAdmin()` decorator plus a guard provides the coarse gate, mirroring
`RolesGuard` — 404, never 403 (§1.7). The guard is a filter, not the decision;
the service still calls `assertSuperAdmin`.

## 4. Endpoints

A separate `platform` module, under its own prefix:

| Method | Route                            | Body / query                          | Result                       |
| ------ | -------------------------------- | ------------------------------------- | ---------------------------- |
| POST   | `/platform/kindergartens`        | name, address?, phone?, email?, description?, admin{} | kindergarten + admin + invitation token |
| GET    | `/platform/kindergartens`        | `?q=&isActive=&page=&pageSize=`       | paginated list of all        |
| GET    | `/platform/kindergartens/:id`    | —                                     | detail + counts              |
| PATCH  | `/platform/kindergartens/:id`    | any of the above fields, `isActive`   | updated                      |

"Counts" on the detail route means three numbers, each over live rows only:
active groups, active enrollments, and active memberships. Both list and detail
exclude soft-deleted kindergartens; `isActive` is a filter, not a delete.

No DELETE. Deactivation is `PATCH { isActive: false }` — §3.2, and the reference
system describes the superadmin as deactivating kindergartens, not deleting
them.

**Why a separate module rather than a superadmin branch inside `TenantsService`.**
`memberScope()` and `adminScope()` are the tenant isolation. Adding "…unless the
actor is a superadmin" inside them puts platform logic on the path every teacher
and parent request takes, which is the two-places problem §1.1 warns about. A
separate module leaves those methods provably unchanged.

The existing `GET /kindergartens` stays membership-scoped and is not modified. A
superadmin with no memberships gets an empty list from it, which is correct.

## 5. Create semantics

```
POST /platform/kindergartens
{
  name, address?, phone?, email?, description?,
  admin: { username, lastName, firstName, email?, phone? }
}
```

Creating a kindergarten with no director produces a tenant nobody can reach, so
the two are one call.

One `$transaction` in the repository, in order:

1. `Kindergarten`
2. `User` — password hash is `randomBytes(32)`, unusable by construction. No
   admin ever types a password for someone else.
3. `Membership` — role `ADMIN`, in the new kindergarten.
4. `AuthToken` — purpose `INVITATION`, 7-day TTL, matching `UsersService`.

The service computes the password hash and the one-time token (`PasswordService`,
`TokenService`) and passes the results into the repository, which does the
atomic writes. Username, email and phone collisions are checked first through
`UsersRepository` and answered as 409 rather than surfacing as a 500 from a
unique-constraint violation; a collision detected inside the transaction rolls
the kindergarten back with it.

This overlaps `UsersService.createInvitedAccount` by roughly ten lines. The
overlap is accepted rather than extracted: that method's non-transactional
sequence is correct for its own callers, and reshaping it to serve a second one
would touch the teacher-invites-a-family path for no benefit to it.

Response: `{ kindergarten, admin: { id, username }, invitationToken }`. The
token is returned so the operator can deliver it, exactly as the existing invite
flow does, and is never logged.

No uniqueness rule on kindergarten name. The schema has no such constraint and
this is not the place to invent one.

## 6. Audit

Appended after the transaction commits (§3.5 ordering discipline):

- `CREATE` · `Kindergarten` · `kindergartenId` = the new id
- `INVITE` · `User` · metadata `{ role: "ADMIN" }`
- `UPDATE` · `Kindergarten` on PATCH, metadata `{ fields }`

## 7. Tests

`apps/api/test/platform.test.ts`, every assertion through a real HTTP request
against the real route — §4.1.

| Case                                                                    | Expected |
| ----------------------------------------------------------------------- | -------- |
| superadmin creates a kindergarten                                       | 201; kindergarten, user, ADMIN membership and invitation token all exist |
| the returned token sets a password, then that account logs in           | 200, and it is an ADMIN of the new kindergarten |
| ADMIN of an existing kindergarten → POST / GET / GET :id / PATCH        | **404** on all four |
| TEACHER → all four                                                      | **404**  |
| PARENT → all four                                                       | **404**  |
| unauthenticated → all four                                              | 401      |
| superadmin lists                                                        | both kindergarten A and kindergarten B appear |
| superadmin → a child, its portfolio, its observations, its guardians    | **404** — the flag did not widen child access |
| superadmin → `/dashboard/admin`, and `GET /kindergartens`               | 404, and an empty list — membership scope is unchanged |
| duplicate username                                                      | 409, **and** no kindergarten row was created |
| PATCH `{ isActive: false }`                                             | 200, row updated |

`schema.test.ts` is updated for the new column.

## 8. Out of scope

- **Web UI.** No superadmin screens. The endpoint is the deliverable.
- **ESIS integration.** `developerv2.esis.edu.mn` is behind a login and its API
  surface could not be inspected. Pulling kindergarten records from it is a
  separate feature with its own scope question.
- **Widening superadmin reach.** Backups, all-users administration and
  cross-tenant child access are named in `ROADMAP-django.md` §3 and are not part
  of this work.
- **Login gating on `Kindergarten.isActive`.** The column is stored and edited;
  what an inactive kindergarten does to its users' sessions is not changed here.

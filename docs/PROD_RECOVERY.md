# PROD_RECOVERY.md

Recovering the production database from the rewritten-migration incident.

**Status: prepared, not executed.** The destructive step needs a human to run
it — see §3.

---

## 1. What is wrong

`20260825054800_add_attendance` was merged to main and **applied to production**
(deploy `ce6ebaf7`, SUCCESS, 2026-08-25 07:15 UTC). It was then rewritten on a
branch as `20260824132405_add_attendance` — a different name for overlapping
DDL. The next deploy died in the container entrypoint:

```
Applying migration `20260824132405_add_attendance`
Error: P3018 — Database error code: 42710
ERROR: type "AttendanceStatus" already exists
```

Production has held a **failed migration row** ever since, so every later deploy
stops at P3009 before the application starts. The live API is still serving
`af65bdf`: `/v1/health` answers 200, and every route added since — attendance,
meals, surveys, growth, milestones, health — answers 404.

CI cannot see this class of fault: it migrates a fresh container every run, and
a rewritten migration is only invisible on a database that never ran the
original.

---

## 2. What is in production, measured

Checked 2026-08-25 19:16 via `railway ssh --service Postgres`:

```
children=1  users=4  kindergartens=1  observations=1
media=1     assessments=0  notifications=0  audit=26
```

Every row was created on **2026-08-19**, the deployment day, and they are
exactly the `seed-demo` fixtures:

|              |                                                                                |
| ------------ | ------------------------------------------------------------------------------ |
| Users        | `superadmin`, `admin` (Ням Болд), `bagsh` (Дорж Сарантуяа), `eej` (Бат Оюунаа) |
| Child        | Ганболд Батбаяр                                                                |
| Kindergarten | NomadKids цэцэрлэг                                                             |

No real kindergarten has been onboarded. This matches
`PHASE_1_ACCEPTANCE.md`, whose backup drill also reports `children=1`.

★ **One consequence to accept:** the single `media_files` row points at an
object in R2 that the reset will orphan. It is a smoke-test upload. Nothing
else in the bucket is referenced by a row that survives.

**Backup taken before anything:**

```
~/nomadkids-prod-backup-20260825-191625.sql   101 KB, 32 tables, ends cleanly
```

---

## 3. The recovery — run these yourself

The first command destroys the production schema. Claude Code's classifier
refuses it, which is correct: it is a production data-losing operation and the
decision is yours. Everything before and after it is prepared.

Paste each line into the Claude Code prompt with a leading `!`, or run them in a
terminal from the repository root.

### 3.1 Reset the schema

```
! railway ssh --service Postgres "psql -U postgres -d railway -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;'"
```

This clears the failed migration row along with everything else, which is why
no `prisma migrate resolve` is needed.

### 3.2 Redeploy

```
! railway redeploy --service api --yes
```

`apps/api/docker-entrypoint.sh` runs `prisma migrate deploy` before starting the
app, so the redeploy applies all migrations to the empty schema. Watch it with:

```
! railway logs --service api
```

Expect `[entrypoint] applying database migrations…` followed by every migration
name, then `[entrypoint] migrations applied; starting the API`.

### 3.3 Seed the system configuration

The five development domains, four assessment levels and five observation types
every kindergarten inherits, plus one superadmin.

```
! railway ssh --service api "cd /app/apps/api && SEED_ADMIN_USERNAME=superadmin SEED_ADMIN_PASSWORD='<a real password, 12+ chars>' node_modules/.bin/tsx prisma/seed.ts"
```

★ `seed.ts` refuses to invent a default password — a seeded `admin/admin123`
that nobody remembers to change is a production backdoor. Choose a real one and
store it in a password manager, not in this file.

★★ **The old `superadmin` account had `isSuperAdmin = false`** in the database
that is being replaced, which would have made the platform routes unreachable
for it. `seed.ts` repairs that flag on an existing account and sets it correctly
on a new one, so the reseed fixes it either way.

### 3.4 Verify

```
! curl -s -o /dev/null -w '%{http_code}\n' https://nomadkids.up.railway.app/v1/health
! curl -s -o /dev/null -w '%{http_code}\n' https://nomadkids.up.railway.app/v1/children/00000000-0000-0000-0000-000000000000/growth
```

The first must be **200**. The second must be **401** — unauthenticated, which
proves the route _exists_. A **404** there means the deploy is still serving the
old build.

Repeat for a route from each new module:

| Path                             | Was | Should be |
| -------------------------------- | --- | --------- |
| `/v1/children/<uuid>/attendance` | 404 | 401       |
| `/v1/kindergartens/<uuid>/menu`  | 404 | 401       |
| `/v1/children/<uuid>/growth`     | 404 | 401       |
| `/v1/children/<uuid>/milestones` | 404 | 401       |
| `/v1/children/<uuid>/health`     | 404 | 401       |

---

## 4. Why this can happen again, and what stops it

The root cause was not the migration itself but **editing one that had already
been applied somewhere**. A migration is immutable the moment it leaves your
machine.

Two things now make a repeat visible earlier:

- CI runs `prisma migrate deploy` against a container that has replayed the full
  history — but from empty, so it still cannot catch a _rewrite_. What catches a
  rewrite is that the deploy fails loudly in the entrypoint rather than starting
  an app against a schema that is not there, which is why migrations run there
  and not in a Railway pre-deploy step.
- `docs/PHASE_3_BUILD.md` records the incident, so the next person to reach for
  `--create-only` on an existing name meets the story first.

If a migration is genuinely wrong after it has shipped, the fix is a **new**
migration that corrects it — as
`20260825120000_partial_unique_attendance_day` and
`20260825170000_drop_vestigial_deleted_by` both do.

---

## 5. The development database had the same fault — repaired 2026-08-25

A running dev API returned **500** on
`GET /v1/attendance-requests/review-queue`, and the cause was this same
incident rather than a bug in that route: `localhost:5433/kinder` still had
`20260825054800_add_attendance` applied and none of the eight migrations after
it, so the code queried `attendance_requests`, a table that did not exist.

It was repaired **without dropping the schema**, because unlike production it
held real demo data — 10 children, 36 observations, 50 assessments:

```sql
BEGIN;
DROP TABLE IF EXISTS attendance;            -- 0 rows, checked first
DROP TYPE  IF EXISTS "AttendanceStatus";    -- used only by that table
DELETE FROM _prisma_migrations
  WHERE migration_name = '20260825054800_add_attendance';
COMMIT;
```

then `prisma migrate deploy`, which replayed the real history from
`20260824132405_add_attendance` onwards. Result: 47 tables, the demo data
untouched, `AttendanceStatus` now the correct
`PRESENT HALF_DAY EXCUSED SICK ABSENT`, and the endpoint answering **401**
(unauthenticated) instead of 500.

★ **This is the repair production cannot use.** It works only because the old
`attendance` table was empty. Production's is too, so the same three statements
would work there — but the schema reset in §3 is still the better choice there,
since production's remaining data is four seed accounts and one demo child,
and a clean replay of the whole history is easier to trust than a hand-patched
one. A backup was taken either way:
`~/nomadkids-dev-backup-20260825-200704.sql`.

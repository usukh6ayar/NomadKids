# PROD_RECOVERY.md

Recovering the production database from the rewritten-migration incident.

**Status: executed 2026-08-26.** §3.1's surgical repair ran (`DELETE 2`), the
redeploy applied all 21 migrations, and the API answers **401** — not 404 — on
attendance, meals, growth, milestones and health. §6 records what it cost.

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

The first command changes production irreversibly. Claude Code's classifier
refuses it, which is correct: the decision is yours. Everything before and after
it is prepared.

Paste each line into the Claude Code prompt with a leading `!`, or run them in a
terminal from the repository root.

### 3.1 Clear the rewritten migration

★ **Chosen 2026-08-26 over the schema reset below**, once production was
measured rather than assumed. Everything the rewritten migration left behind is
empty, so §5's surgical repair works here too and keeps the `media_files` row
whose R2 object a reset would orphan.

Measured before choosing, on production:

```
attendance                 →  0 rows
"AttendanceStatus"         →  used by that table and nothing else
attendance_requests, menu_days, surveys, "AttendanceRequestStatus"
                           →  do not exist — the failed migration created nothing
```

```
! railway ssh --service Postgres "psql -U postgres -d railway -c \"BEGIN; DROP TABLE IF EXISTS attendance; DROP TYPE IF EXISTS \\\"AttendanceStatus\\\"; DELETE FROM _prisma_migrations WHERE migration_name IN ('20260824132405_add_attendance','20260825054800_add_attendance'); COMMIT;\""
```

★★ **Two migration names, where §5's dev repair deletes one.** Development had
the old `20260825054800` applied and had never attempted the new one, so it had
no failed row. Production attempted it and failed, so it holds both: the applied
old name and the failed new one. Deleting only the first leaves the P3009 that
stops every deploy; deleting both lets `migrate deploy` replay the real history
from `20260824132405_add_attendance` onwards.

The table really is called `attendance` here — that is the _old_ migration's
name for it. The current one creates `attendance_records`, which is why the
`DROP` above would silently no-op on a database that had never run the old
migration.

<details>
<summary>The schema reset, if the surgical repair is ever the wrong call</summary>

```
! railway ssh --service Postgres "psql -U postgres -d railway -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;'"
```

This clears the failed migration row along with everything else, which is why
no `prisma migrate resolve` is needed. It also destroys the four seed accounts,
the demo child, and the reference from the surviving `media_files` row to its
object in R2.

</details>

### 3.2 Redeploy

```
! railway redeploy --service api --yes
```

`apps/api/docker-entrypoint.sh` runs `prisma migrate deploy` before starting the
app, so the redeploy applies the migrations the cleared history no longer
claims. Watch it with:

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

★★★ `tsx` and `dotenv` were devDependencies until 2026-08-26, so
`pnpm prune --prod` deleted them from the image and **the command above could
not have run** — it would have failed with `tsx: not found`, during a recovery,
which is the only time anybody reads this file. Both are runtime dependencies
now; see the note in `apps/api/Dockerfile`. Confirm before trusting it:

```
! railway ssh --service api "ls /app/apps/api/node_modules/.bin/tsx && ls /app/apps/api/prisma"
```

### 3.3b Demo data, for a client walkthrough

Optional, and separate from §3.3 on purpose: that one creates the superadmin who
registers a real kindergarten, this one creates a **demo** kindergarten with
enough rows that the screens are not empty states — ten children, four weeks of
attendance, the weekly menu and meal register, surveys with answers, growth
measurements, milestones, health records, incidents, consent and the funding
calculations from `нэмэлт.md`.

```
! railway ssh --service api "cd /app/apps/api && SEED_DEMO_PASSWORD='<12+ chars>' node_modules/.bin/tsx prisma/seed-showcase.ts"
```

Accounts, all with that one password: `zahiral` (ADMIN), `bagsh1` and `bagsh2`
(TEACHER), `etseg1`… (PARENT — `etseg1` has two children, which is the case the
child switcher exists for).

★ `seed-showcase.ts` applies the system configuration itself, so it does not
need §3.3 to have run first. It is still not a substitute for it: only §3.3
creates the superadmin, and only the superadmin reaches `/platform`.

★★ These are demo accounts with a shared password on a real deployment. Remove
the kindergarten, or rotate the password, once the walkthrough is over.

### 3.4 Verify

```
! curl -s -o /dev/null -w '%{http_code}\n' https://api.nomadkids.mn/v1/health
! curl -s -o /dev/null -w '%{http_code}\n' https://api.nomadkids.mn/v1/children/00000000-0000-0000-0000-000000000000/growth
```

★ `api.nomadkids.mn` rather than the Railway hostname: DNS was published on
2026-08-26 and both origins now answer, so the checks below should exercise the
name the browser actually uses. `www.nomadkids.mn` gets
`access-control-allow-origin: https://www.nomadkids.mn` back from the API,
verified the same day — the cookie topology `docs/DEPLOYMENT.md` §1 depends on
is in place.

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

★ **This was written as "the repair production cannot use."** It works only
because the old `attendance` table was empty — and when production was finally
measured rather than reasoned about, its table was empty too. §3.1 is now this
same repair, with one extra migration name; the schema reset is the folded-away
alternative. A backup was taken either way:
`~/nomadkids-dev-backup-20260825-200704.sql`.

---

## 6. What it cost, 2026-08-26

The recovery ran. Three findings, in the order they bit, all of them in the
image rather than the database:

1. **`tsx` and `dotenv` were pruned from the image**, so §3.3's command — the
   one this file has documented since it was written — could not have run at
   all. Both are runtime dependencies now.
2. **`src/generated` was not copied into the image**, so with `tsx` present the
   scripts got one step further and died on
   `Cannot find module '../src/generated/prisma/client'`. The runtime stage now
   copies it.
3. The repair itself was **one statement and no data loss**: `DROP TABLE`,
   `DROP TYPE`, `DELETE 2`, `COMMIT`. The migrations then applied on the first
   redeploy.

Each of the first two cost a build-and-deploy cycle, in the middle of a
recovery, because the seed path had never been executed anywhere but a laptop —
where `node_modules` is the dev tree and `src/` is right there. **A command that
only runs during an incident is only tested during an incident.** If a fourth
thing in this file has never been run against the real image, it is the next one
to fail.

Verified afterwards, over HTTPS against `api.nomadkids.mn` with a real session:
`/children`, `/dashboard/teacher`, `/dashboard/parent`, the weekly menu,
`/children/:id/growth`, `/children/:id/health`,
`/children/:id/attendance?month=…`, `/kindergartens/:id/surveys` and
`/kindergartens/:id/funding?month=…` all answer **200** with the seeded rows.

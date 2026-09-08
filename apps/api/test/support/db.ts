/**
 * Test database helpers.
 *
 * Integration tests run against a REAL Postgres, never a mocked Prisma client.
 * A test against a mock proves the mock works — and the constraints this
 * project depends on (partial unique indexes, FK restrictions, cascade rules)
 * exist only in the database.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import IORedis, { type Redis } from "ioredis";
import { PrismaClient } from "../../src/generated/prisma/client";
import { applySystemConfig } from "../../prisma/system-config";

let client: PrismaClient | undefined;

/**
 * The shared client.
 *
 * ★ Test files call this at module scope (`const db = testDb()`), which runs at
 * import time — before any file's hooks. They therefore all capture the *same*
 * instance. That is why disconnecting is a global teardown (`test/teardown.ts`)
 * rather than something each file does in `afterAll`: the first file to finish
 * would otherwise disconnect the client every later file is still holding, and
 * the failures land in whichever file happens to run second.
 */
export function testDb(): PrismaClient {
  client ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  return client;
}

/** Called once by the global teardown. Not from individual test files. */
export async function closeTestDb(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
  await rateLimitRedis?.quit().catch(() => rateLimitRedis?.disconnect());
  rateLimitRedis = undefined;
}

/**
 * Empties every table, then restores the system configuration rows.
 *
 * The re-seed is not optional. Emptying `kindergartens` empties the dependent
 * config tables *entirely* — including the `kindergartenId IS NULL` system
 * rows, which have no kindergarten to cascade from. Without restoring them,
 * every test that reaches for a development domain or observation type fails
 * on the second case.
 */
export async function resetData(): Promise<void> {
  const db = testDb();
  await emptyEveryTable(db);
  await applySystemConfig(db);
  await resetRateLimits();
}

/**
 * ★ `DELETE`, not `TRUNCATE`. This one statement was two thirds of the suite.
 *
 * Measured 2026-09-08 against `kinder_test`, twenty calls each:
 *
 * | reset                                    | per call |
 * | ---------------------------------------- | -------- |
 * | `TRUNCATE` 31 tables `CASCADE` (was)     |   412 ms |
 * | `TRUNCATE` all 73 tables named           |  1876 ms |
 * | `DELETE` all 73 tables, FK triggers off  |     3 ms |
 *
 * The mean test case took 556 ms and the whole run 19.5 minutes, so ~410 ms of
 * every one of the 1886 cases — 66% of the suite — was this. `TRUNCATE` writes
 * a new relfilenode for every table *and every index* and takes an ACCESS
 * EXCLUSIVE lock on each; that cost is paid per table regardless of how many
 * rows are in it, and these tables hold a fixture set. It is the wrong tool for
 * a table with fifty rows in it, and naming more tables makes it worse, not
 * better — which is why the 73-table variant above is four times slower again.
 *
 * ★★ Two obvious-looking alternatives were measured and rejected, so nobody
 * repeats them: `synchronous_commit = off` moved 412 ms to 398 ms (the cost is
 * catalog and file churn, not WAL fsync), and `fsync = off` addresses the same
 * non-problem.
 *
 * `RESTART IDENTITY` is dropped with nothing lost: the schema has **zero**
 * `serial`/`identity` columns — every key is a UUID — so it was already a no-op
 * (`select count(*) from information_schema.columns where is_identity = 'YES'
 * or column_default like 'nextval%'` → 0). Add one and this needs revisiting.
 */
async function emptyEveryTable(db: PrismaClient): Promise<void> {
  if (strategy !== "truncate") {
    deleteEverything ??= await buildDeleteStatement(db);
    try {
      await db.$executeRawUnsafe(deleteEverything);
      strategy = "delete";
      return;
    } catch (error) {
      // Once it has worked, a later failure is a real one and must surface —
      // silently degrading to the slow path would hide a broken reset.
      if (strategy === "delete") throw error;
      strategy = "truncate";
      console.warn(
        "\n⚠  Falling back to TRUNCATE to reset the test database.\n" +
          `   ${error instanceof Error ? error.message.split("\n")[0] : String(error)}\n` +
          "   `session_replication_role` needs a superuser. The suite still\n" +
          "   passes, and takes about three times as long.\n",
      );
    }
  }
  await db.$executeRawUnsafe(TRUNCATE_EVERYTHING);
}

type ResetStrategy = "delete" | "truncate";

let strategy: ResetStrategy | undefined;
let deleteEverything: string | undefined;

/**
 * Builds the reset from `pg_tables`, once per process.
 *
 * ★ The list is read from the database rather than hand-maintained, and that
 * closes a hole the old one documented at length. Its thirty names relied on
 * `CASCADE` reaching the rest, which held — but only for tables with a foreign
 * key path to a kindergarten, a child or a user. `revenue_partners` has none,
 * survived every reset, and the first test to register a 60% share turned the
 * next test's 60% share into a 120% total. `special_needs_categories` needed
 * naming for the neighbouring reason. Both were found by their symptoms, weeks
 * apart. Every table is now named because the catalog names them, so the next
 * table with no tenant relation cannot repeat it.
 *
 * ★★ `SET LOCAL` inside an explicit transaction, so FK enforcement is restored
 * by COMMIT *and* by ROLLBACK. That matters more here than it looks: this suite
 * exists to prove the database's own constraints hold (see the header), and a
 * connection left in `replica` after a failed reset would keep enforcing
 * nothing for every test that followed on it. Both this and the bare
 * multi-statement form were checked on 2026-09-08 by forcing a failure inside
 * the string and reading `SHOW session_replication_role` back — both unwound.
 * The explicit transaction is used anyway, because it is the form that says so
 * rather than the form that happens to.
 *
 * Disabling the FK triggers is also what removes the ordering problem: with
 * them off there is no dependency order to maintain, which is the one property
 * that made `TRUNCATE ... CASCADE` worth its cost.
 */
async function buildDeleteStatement(db: PrismaClient): Promise<string> {
  const rows = await db.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
     ORDER BY tablename`,
  );

  if (rows.length === 0) {
    throw new Error(
      "No tables found in the public schema. Has the test database been migrated? " +
        "Run: pnpm --filter @kinder/api test:db:setup",
    );
  }

  const deletes = rows
    .map((row) => `DELETE FROM "${row.tablename.replace(/"/g, '""')}";`)
    .join("\n      ");

  return `
    BEGIN;
      SET LOCAL session_replication_role = replica;
      ${deletes}
    COMMIT;
  `;
}

/**
 * The fallback, kept verbatim from what ran until 2026-09-08.
 *
 * Reached only where `session_replication_role` cannot be set — a non-superuser
 * connection. That is nowhere we run today (the local container and the CI
 * service both connect as `kinder`, which owns the cluster), so this is dead
 * code by design rather than by accident. It stays because the alternative to a
 * slow suite is a broken one, and the warning above makes the choice visible.
 */
const TRUNCATE_EVERYTHING = `
  TRUNCATE TABLE
    "audit_logs", "report_jobs", "notification_reads", "notification_targets",
    "notifications", "media_files", "term_reports", "assessments", "terms",
    "observation_domains", "observations", "birthday_notes",
    "child_age_profiles", "child_profiles", "enrollments", "guardianships",
    "children", "group_teachers", "groups", "school_years", "memberships",
    "sessions", "auth_tokens", "login_attempts", "kindergartens", "users",
    "development_domains", "assessment_levels", "observation_types",
    "special_needs_categories",
    "revenue_partners"
  RESTART IDENTITY CASCADE
`;

/**
 * Clears the rate-limit counters between tests.
 *
 * ★ Part of `resetData()` since 2026-09-05, and that is the point.
 *
 * The counters moved to Redis so the API could run as several processes
 * (А/261 шалгуур 6), which made them shared state that survives a database
 * truncate. Every high-login test file already called
 * `RateLimitService.resetAll()` by hand in its own `beforeEach` — forty of
 * them — and CLAUDE.md §4.4 records what happens to the file that forgets:
 * `attendance-register.test.ts` did 21 tests × 5 logins against a
 * 60-per-15-minutes limit and its 429s read as register defects.
 *
 * A guarantee reconstructed by hand at forty call sites is a guarantee that
 * will eventually be forgotten at one of them, so it belongs here, beside the
 * truncate, where "reset the world" already means what it says. The per-file
 * calls are harmless and stay: they document the intent at the point it
 * matters.
 *
 * ★★ Its own connection rather than the Nest app's. `resetData()` is called
 * from module scope in files that have no app yet, and reaching into the
 * container for a service would make this helper depend on Nest.
 */
let rateLimitRedis: Redis | undefined;

async function resetRateLimits(): Promise<void> {
  if (!process.env.REDIS_URL) return;

  rateLimitRedis ??= new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
  });

  try {
    // The same namespace `RateLimitService` writes under in NODE_ENV=test.
    let cursor = "0";
    do {
      const [next, keys] = await rateLimitRedis.scan(cursor, "MATCH", "rl-test:*", "COUNT", 500);
      cursor = next;
      if (keys.length > 0) await rateLimitRedis.del(...keys);
    } while (cursor !== "0");
  } catch {
    // A suite that cannot reach Redis will fail on its own terms in a moment;
    // failing here would report it as a fixture problem.
  }
}

/** A unique-enough suffix so fixtures never collide on unique columns. */
export function uniq(prefix = "t"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

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
 * TRUNCATE ... CASCADE rather than per-table deletes: one statement, no FK
 * ordering to maintain, and it recovers cleanly when a previous test failed
 * halfway through.
 *
 * The re-seed is not optional. `TRUNCATE kindergartens CASCADE` empties the
 * dependent config tables *entirely* — including the `kindergartenId IS NULL`
 * system rows, which have no kindergarten to cascade from. Postgres cascades
 * by table, not by row. Without restoring them, every test that reaches for a
 * development domain or observation type fails on the second case.
 */
/*
 * ★ `special_needs_categories` is named explicitly, added 2026-09-05, for the
 * same reason `development_domains` and its two neighbours are: its system rows
 * carry `kindergartenId IS NULL` and so have no kindergarten to cascade from.
 * A test that deactivated one would leak that into every later file.
 *
 * ★★ `revenue_partners` is named explicitly, and it is the only table here that
 * has to be.
 *
 * Every other name below is reachable by CASCADE from "kindergartens" or
 * "users". That one has no foreign key at all — it is platform-level, an
 * agreement between the platform's owners rather than any kindergarten's record
 * (the model explains why it carries no `kindergartenId`). So it survived every
 * reset, and the first test to create a 60% share turned the next test's 60%
 * share into a 120% total. Any future table with no tenant relation needs the
 * same line.
 */
/**
 * Truncates everything between tests.
 *
 * ★ The table list is hand-maintained and looks like it rots — it names about
 * thirty tables and the schema has sixty-five. It does not rot, because of
 * `CASCADE`: every table not named here reaches one that is through a foreign
 * key. Verified empirically on 2026-09-02 by truncating and then counting rows
 * in all sixty-five — none survived. If a future table is ever added with no FK
 * path to a kindergarten, a child or a user, it will leak between test files
 * and that check is how to find it.
 */
export async function resetData(): Promise<void> {
  const db = testDb();
  await db.$executeRawUnsafe(`
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
  `);
  await applySystemConfig(db);
  await resetRateLimits();
}

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

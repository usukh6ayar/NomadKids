/**
 * Test database helpers.
 *
 * Integration tests run against a REAL Postgres, never a mocked Prisma client.
 * A test against a mock proves the mock works — and the constraints this
 * project depends on (partial unique indexes, FK restrictions, cascade rules)
 * exist only in the database.
 */

import { PrismaPg } from "@prisma/adapter-pg";
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
      "development_domains", "assessment_levels", "observation_types"
    RESTART IDENTITY CASCADE
  `);
  await applySystemConfig(db);
}

/** A unique-enough suffix so fixtures never collide on unique columns. */
export function uniq(prefix = "t"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

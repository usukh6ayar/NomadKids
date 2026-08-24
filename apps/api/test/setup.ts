/**
 * Vitest setup for the API package.
 *
 * Loads `.env` so integration tests reach the local Postgres. Tests run against
 * a real database by choice — see test/support/db.ts.
 */

import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(__dirname, "../../../.env"), quiet: true });

/**
 * ★ The suite gets its own database, because it destroys the one it runs on.
 *
 * `resetData()` issues `TRUNCATE … CASCADE` over every table before each case.
 * Pointed at `DATABASE_URL` — which on a developer machine is the database
 * `seed:demo` just filled — that silently empties their work every time they
 * run the tests. It is not a flaky failure or a visible error; the next
 * `pnpm dev` simply shows an empty kindergarten, and the cause is one command
 * ago in the scrollback.
 *
 * `TEST_DATABASE_URL` is overridden onto `DATABASE_URL` rather than read
 * separately, because everything downstream — `testDb()`, the Nest application
 * the tests boot, `PrismaService` — resolves the connection from that one
 * variable. Handing the two halves different URLs is how a suite ends up
 * asserting against one database while the app under test writes to another.
 *
 * Optional on purpose: CI runs against a throwaway Postgres service container
 * where `DATABASE_URL` *is* the scratch database, and requiring a second
 * variable there would fail every run for no benefit.
 */
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  // Loud, because the cost of not knowing is someone's seeded data.
  console.warn(
    "\n⚠  TEST_DATABASE_URL is not set.\n" +
      `   The integration suite will TRUNCATE every table in ${redacted(process.env.DATABASE_URL)}.\n` +
      "   On a development machine, set TEST_DATABASE_URL in .env — see .env.example.\n",
  );
}

/** The database name alone. A connection string in a log carries the password. */
function redacted(url: string | undefined): string {
  if (!url) return "(unset)";
  try {
    return new URL(url).pathname.replace(/^\//, "") || url;
  } catch {
    return "(unparseable)";
  }
}

// Signals to PasswordService that argon2 should run at reduced cost. The
// production parameters stay under test in src/auth/password.service.test.ts,
// which constructs a service with them explicitly.
process.env.NODE_ENV = "test";

// ★ The report worker never runs in tests. A background consumer draining the
// queue would race every assertion about a job's status — a test that reads
// QUEUED would sometimes read DONE, depending on how fast Chromium started.
// The generator is exercised directly instead, by calling
// `ReportGeneratorService.run()`, which is the same code the worker calls.
process.env.REPORTS_WORKER_ENABLED = "false";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Integration tests need a database:\n" +
      "  docker compose up -d db\n" +
      "  cp .env.example .env",
  );
}

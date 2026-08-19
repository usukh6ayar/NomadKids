/**
 * Vitest setup for the API package.
 *
 * Loads `.env` so integration tests reach the local Postgres. Tests run against
 * a real database by choice — see test/support/db.ts.
 */

import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(__dirname, "../../../.env"), quiet: true });

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

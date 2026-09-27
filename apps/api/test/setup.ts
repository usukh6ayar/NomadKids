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
/*
 * ★ And the ESIS write worker, for a second reason on top of the timing one:
 * a suite that drained this queue would post an approved group write at a real
 * ministry service. `EsisWriteSender` is called directly in the tests instead.
 */
process.env.ESIS_WRITE_WORKER_ENABLED = "false";

// ★ QPay is unconfigured under test, always — never "unconfigured if the
// developer happens not to have filled it in".
//
// `.env` is loaded above so the integration suite can reach Postgres, and it
// brings whatever else is in it. A machine with QPay credentials set would
// make `QpayConfig.isConfigured` true, and the suite would then try to reach
// merchant.qpay.mn over the network: slow, flaky, and on a real merchant
// account it would create real invoices. The tests that assert the
// unconfigured path pinned "as it is in a fresh .env" and failed on any
// machine where it was not.
//
// The paths that need a configured client stub `QpayClient` rather than
// relying on ambient environment, which is why clearing this costs nothing.
// ★ The portal access gate is OFF by default under test. It is a deployment
// decision, not a property of the product, and leaving it on would make every
// guardian-facing test in the suite depend on a subscription fixture that has
// nothing to do with what it is testing. `test/qpay.test.ts` and
// `test/portal-access.test.ts` set a price themselves.
process.env.ACCESS_FEE_AMOUNT ??= "0";

/*
 * ★★ ESIS gets the same treatment, and for a sharper reason — 2026-09-11.
 *
 * The paragraph above is written about QPay, but every word of it applies
 * here: `.env` is loaded above, and it carries a real ministry token. Without
 * the deletion below, `pnpm test` would run against hubv2.esis.edu.mn — a
 * government system, on someone else's quota.
 *
 * ★★★ **Deleting the token is now the whole of the protection — 2026-09-14.**
 *
 * This block also set `ESIS_DEMO_MODE = "true"`, which routed every read to a
 * committed fixture so the suite could exercise the ESIS paths without a
 * token. Demo mode is gone, and the consequence is worth stating plainly:
 * with no token, `isConfigured` is false and every ESIS-dependent route
 * answers 503 or 502 rather than a fixture. The tests assert that, because it
 * is what the product now does.
 *
 * A test that needs a *successful* ESIS read has to stub `EsisService` for
 * itself. That is more work than a global fixture and it is the point — a
 * fixture reachable from anywhere is how invented data got onto the screens.
 */
for (const key of [
  "QPAY_BASE_URL",
  "QPAY_USERNAME",
  "QPAY_PASSWORD",
  "QPAY_INVOICE_CODE",
  "QPAY_CALLBACK_URL",
  "ESIS_TOKEN",
  "ESIS_BASE_URL",
]) {
  delete process.env[key];
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Integration tests need a database:\n" +
      "  docker compose up -d db\n" +
      "  cp .env.example .env",
  );
}

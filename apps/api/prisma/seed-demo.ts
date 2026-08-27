/**
 * Demo data, for local development only.
 *
 * ★ This is the file `seed.ts` deliberately is not.
 *
 * `seed.ts` creates the system configuration a real deployment needs. This one
 * fills a local database with a kindergarten that has enough shape to *look at*
 * — children with enrolments, observations in every review state, a term's
 * assessments, announcements, and the Phase II/III modules. Screens that render
 * an empty state cannot be compared against a design, and every list, card,
 * table and pagination control in this product only exists once there are rows.
 *
 * Written for `docs/UI_MIGRATION_STATUS.md`, which needs the two applications
 * side by side with comparable content.
 *
 * ★★ It refuses to run anywhere but a local database. See `assertLocalOnly`.
 * The deployment-facing counterpart is `seed-showcase.ts`, which carries its own
 * guard rather than turning this one off.
 *
 * The content itself lives in `demo-data.ts`, shared by both.
 *
 * Idempotent by kindergarten: run it twice and it reports what already exists
 * rather than creating a second copy.
 *
 * Run: pnpm --filter @kinder/api seed:demo
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { DEMO_KINDERGARTEN_NAME, printSummary, seedDemoKindergarten } from "./demo-data";

// ★ Loads the repository-root `.env`, for the same reason `prisma.config.ts`
// does: this script runs as its own process and never imports the application,
// so nothing else has put `DATABASE_URL` into `process.env`. Without it the
// documented `pnpm --filter @kinder/api seed:demo` fails on every machine that
// has not exported the variable by hand.
//
// `override` is off, so an explicitly exported variable always wins over the
// file. `assertLocalOnly` below still refuses anything but a local host.
loadDotenv({ path: resolve(__dirname, "..", "..", "..", ".env"), quiet: true });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/**
 * The one place a default password is acceptable in this repository.
 *
 * `seed.ts` refuses to invent one, and it is right to: a seeded `admin/admin123`
 * nobody remembers to change is a production backdoor. The difference here is
 * that this script **cannot reach a production database** — `assertLocalOnly`
 * stops it — so the account it creates cannot exist anywhere that matters.
 *
 * Override with `SEED_DEMO_PASSWORD` if you want a different one.
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo-password-123";

/**
 * Refuses anything but a local database.
 *
 * Two independent checks, because either alone has a plausible failure: an
 * unset `NODE_ENV` looks like development on a production box, and a tunnelled
 * production database really can answer on `localhost`. Both have to pass.
 */
function assertLocalOnly(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seed-demo refuses to run with NODE_ENV=production");
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "db"].includes(host)) {
    throw new Error(
      `seed-demo refuses to run against a non-local database (host: ${host}).\n` +
        "It creates accounts with a known password. That is safe on a laptop and nowhere else.\n" +
        "For a deployment, use seed-showcase.ts, which requires a password of its own.",
    );
  }
}

async function main(): Promise<void> {
  assertLocalOnly();

  const existing = await prisma.kindergarten.findFirst({
    where: { name: DEMO_KINDERGARTEN_NAME, deletedAt: null },
  });
  if (existing) {
    console.log(`Demo kindergarten already exists (${existing.id}). Nothing to do.`);
    return;
  }

  const summary = await seedDemoKindergarten(prisma, { password: PASSWORD });
  printSummary(summary, PASSWORD);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

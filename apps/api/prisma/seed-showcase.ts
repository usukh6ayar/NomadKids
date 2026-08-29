/**
 * The demo kindergarten, on a deployment — for a client walkthrough.
 *
 * ★ Why this exists at all, given `seed-demo.ts`.
 *
 * `seed-demo.ts` refuses any database that is not local, and that guard is
 * doing real work: a stale `DATABASE_URL` left pointing at production is an
 * ordinary accident, and the script creates accounts with a password written in
 * its own source. Weakening it so it could also run on a deployment would put
 * `demo-password-123` one environment variable away from a live system, for
 * ever, in a file whose whole point is that it cannot.
 *
 * So the guard stays and this is the second entry point, with the opposite
 * trade: it will run anywhere, and therefore **refuses to invent a password**.
 * `SEED_DEMO_PASSWORD` must be set, and must be twelve characters or more —
 * the rule `seed.ts` applies to the superadmin, for the same reason.
 *
 * The content is `demo-data.ts`, identical to what a developer sees locally.
 * That identity is the point: what the client walks through is the same
 * fixture the UI was built against.
 *
 * ★★ These are demo accounts on a real deployment. They are for a walkthrough
 * and should be removed, or their passwords rotated, once it is over. The
 * kindergarten is named so nobody mistakes it for a tenant.
 *
 * Run (Railway):
 *
 *   railway ssh --service api "cd /app/apps/api && \
 *     SEED_DEMO_PASSWORD='…' node_modules/.bin/tsx prisma/seed-showcase.ts"
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { printSummary, seedDemoKindergarten } from "./demo-data";
import { applySystemConfig } from "./system-config";

// Harmless where there is no file — a container has none, and the platform's
// own environment is already in `process.env`. `override` is off, so a real
// variable always wins. Same reasoning as `seed.ts`.
loadDotenv({ path: resolve(__dirname, "..", "..", "..", ".env"), quiet: true });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/**
 * Named so it cannot be mistaken for a real kindergarten in a list of them.
 * Overridable, because a second walkthrough may want its own copy.
 */
const KINDERGARTEN_NAME = process.env.SEED_SHOWCASE_NAME ?? "Бяцхан нүүдэлчид (үзүүлэн)";

function requirePassword(): string {
  const password = process.env.SEED_DEMO_PASSWORD;

  if (!password) {
    throw new Error(
      "SEED_DEMO_PASSWORD is not set.\n" +
        "This script creates sign-in accounts on whatever database it is pointed at, " +
        "so it will not invent one. Choose a password, store it in a password manager, " +
        "and pass it in.",
    );
  }

  if (password.length < 12) {
    throw new Error("SEED_DEMO_PASSWORD must be at least 12 characters");
  }

  return password;
}

async function main(): Promise<void> {
  const password = requirePassword();

  const existing = await prisma.kindergarten.findFirst({
    where: { name: KINDERGARTEN_NAME, deletedAt: null },
  });
  if (existing) {
    console.log(`"${KINDERGARTEN_NAME}" already exists (${existing.id}). Nothing to do.`);
    console.log("Delete it, or set SEED_SHOWCASE_NAME, to seed a second copy.");
    return;
  }

  // The shared configuration rows the demo data needs. `seed.ts` writes these
  // too and both are idempotent — running this on a database that has already
  // been seeded changes nothing, and running it on one that has not saves a
  // second command that is easy to forget.
  console.log("Applying system configuration…");
  await applySystemConfig(prisma);

  const summary = await seedDemoKindergarten(prisma, {
    password,
    kindergartenName: KINDERGARTEN_NAME,
    // Unset by default, which keeps the documented `zahiral` / `bagsh1`
    // accounts on a fresh database. Set it when this runs alongside an
    // existing seeded kindergarten — otherwise `makeUser` stops with the
    // reason, rather than quietly giving one teacher two kindergartens.
    accountSuffix: process.env.SEED_SHOWCASE_ACCOUNT_SUFFIX,
  });

  // ★ The password is deliberately not printed. It was typed into the command
  // that started this process; echoing it puts it into a deploy log as well.
  printSummary(summary, null);
  console.log("\n  ★ Demo accounts on a deployment. Remove them when the walkthrough is over.");
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

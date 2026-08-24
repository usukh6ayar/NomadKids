/**
 * Seeds the system configuration a fresh database needs to be usable.
 *
 * This is NOT demo data. It creates the shared rows every kindergarten inherits
 * — development domains, assessment levels, observation types — plus one
 * superadmin so somebody can log in and create the first kindergarten.
 *
 * Idempotent: safe to run repeatedly.
 *
 * Run: pnpm --filter @kinder/api seed
 */

import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  applySystemConfig,
  SYSTEM_DOMAINS,
  SYSTEM_LEVELS,
  SYSTEM_OBSERVATION_TYPES,
} from "./system-config";

// ★ Loads the repository-root `.env` — see `prisma.config.ts`. A seed script is
// its own process and never imports the application, so nothing else has read
// the file. `override` is off: a real environment variable, which is how this
// runs against a deployment, always wins.
loadDotenv({ path: resolve(__dirname, "..", "..", "..", ".env"), quiet: true });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function seedSuperadmin(): Promise<void> {
  const username = process.env.SEED_ADMIN_USERNAME ?? "superadmin";
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    // Refusing to invent a default is the point. A seeded "admin/admin123"
    // that nobody remembers to change is a production backdoor.
    console.log("  superadmin: SKIPPED — set SEED_ADMIN_PASSWORD to create one");
    return;
  }

  if (password.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters");
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    // A database seeded before the column existed has the account but not the
    // flag. Repairing it here keeps `seed` the one command that produces a
    // working system, rather than a command plus a remembered SQL statement.
    if (!existing.isSuperAdmin) {
      await prisma.user.update({ where: { id: existing.id }, data: { isSuperAdmin: true } });
      console.log(`  superadmin: flag repaired (${username})`);
    } else {
      console.log(`  superadmin: exists (${username})`);
    }
    return;
  }

  await prisma.user.create({
    data: {
      username,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      lastName: "Систем",
      firstName: "Админ",
      isSuperAdmin: true,
    },
  });
  console.log(`  superadmin: created (${username})`);
}

async function main(): Promise<void> {
  console.log("Seeding system configuration…");
  await applySystemConfig(prisma);
  console.log(`  development domains: ${SYSTEM_DOMAINS.length}`);
  console.log(`  assessment levels: ${SYSTEM_LEVELS.length}`);
  console.log(`  observation types: ${SYSTEM_OBSERVATION_TYPES.length}`);
  await seedSuperadmin();
  console.log("Done.");
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

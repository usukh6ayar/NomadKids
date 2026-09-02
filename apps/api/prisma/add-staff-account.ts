/**
 * Adds one staff account to a kindergarten that already exists.
 *
 * ★ Why this exists beside `seed-showcase.ts`, which creates accounts too.
 *
 * That script is idempotent **by kindergarten**: it finds the demo
 * kindergarten already there and does nothing, which is correct — a re-run
 * must not duplicate ten children. The consequence is that an account added to
 * `DEMO_ACCOUNTS` afterwards never reaches a deployment seeded before the
 * addition. `togooch` and `nyagtlan` were added on 2026-09-02, long after the
 * live demo was seeded, and this is how they get there.
 *
 * It is a general tool, not a one-off: the same gap opens every time a role is
 * added to the product, which has now happened twice (COOK with the kitchen
 * module, ACCOUNTANT with the finance one).
 *
 * ★★ It refuses to touch an account that already exists rather than resetting
 * its password. On a deployment the existing account may be a real person's.
 *
 * Run:
 *   USERNAME=togooch ROLE=COOK LAST_NAME=… FIRST_NAME=… \
 *   KINDERGARTEN_ID=… PASSWORD=… \
 *     pnpm --filter @kinder/api exec tsx prisma/add-staff-account.ts
 */

import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient, type Role } from "../src/generated/prisma/client";

loadDotenv({ path: resolve(__dirname, "../../../.env"), quiet: true });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const ROLES: Role[] = ["ADMIN", "TEACHER", "PARENT", "COOK", "ACCOUNTANT"];

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function main(): Promise<void> {
  const username = required("USERNAME");
  const role = required("ROLE") as Role;
  const kindergartenId = required("KINDERGARTEN_ID");
  const lastName = required("LAST_NAME");
  const firstName = required("FIRST_NAME");
  const password = required("PASSWORD");

  if (!ROLES.includes(role)) {
    throw new Error(`ROLE must be one of ${ROLES.join(", ")} — got ${role}`);
  }
  /*
   * ★ The same floor `seed.ts` applies to the superadmin. A demo account on a
   * deployment is reachable from the internet like any other, and "it is only
   * the demo" is what every weak password on a public system was called.
   */
  if (password.length < 12) throw new Error("PASSWORD must be at least 12 characters");

  const kindergarten = await prisma.kindergarten.findFirst({
    where: { id: kindergartenId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!kindergarten) throw new Error(`No live kindergarten with id ${kindergartenId}`);

  const existing = await prisma.user.findUnique({
    where: { username },
    select: { id: true },
  });
  if (existing) {
    console.log(`${username}: already exists — not touched.`);
    return;
  }

  const user = await prisma.user.create({
    data: {
      username,
      lastName,
      firstName,
      email: `${username}@nomadkids.mn`,
      // ★ `argon2id` named explicitly, matching `seed.ts` and the password
      // service. The library's default has changed between major versions
      // before, and a hash written under a different variant verifies fine
      // until the day it does not.
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      isActive: true,
    },
    select: { id: true },
  });

  await prisma.membership.create({
    data: { userId: user.id, kindergartenId, role },
  });

  console.log(`${username}: created as ${role} in "${kindergarten.name}"`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

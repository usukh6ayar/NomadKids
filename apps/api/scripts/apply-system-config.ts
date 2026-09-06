/**
 * Brings the system catalogue in `DATABASE_URL` up to date with
 * `prisma/system-config.ts` — the development domains, the assessment levels
 * and the observation types.
 *
 * ★ Why this exists separately from the seed.
 *
 * `seed.ts` calls `applySystemConfig` too, but it also creates a kindergarten,
 * users and demo children — so "the catalogue changed" cannot be applied to a
 * running development database without either wiping it or re-seeding over the
 * top of it. `applySystemConfig` is idempotent by construction: it matches on
 * `code`, updates the name and order, and soft-deletes the system rows the list
 * no longer names. Nothing else in the database is read or written.
 *
 * Added 2026-09-06, when the client replaced the five invented observation
 * types with the three they actually use (Ажиглалт, Ярилцлага, Бүтээл) plus the
 * family's own — a change that is worthless until it reaches the database the
 * app is reading from.
 *
 *   pnpm --filter api exec tsx scripts/apply-system-config.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(__dirname, "../../../.env"), quiet: true });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { applySystemConfig } from "../prisma/system-config";

async function main() {
  // The same driver adapter `prisma/seed.ts` builds — Prisma 7 has no implicit
  // connection, so a bare `new PrismaClient()` throws before it reaches the
  // database.
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  await applySystemConfig(prisma);

  const rows = await prisma.observationType.findMany({
    where: { kindergartenId: null },
    orderBy: { order: "asc" },
    select: { code: true, name: true, deletedAt: true },
  });

  console.table(rows.map((r) => ({ code: r.code, name: r.name, active: r.deletedAt === null })));
  await prisma.$disconnect();
}

void main();

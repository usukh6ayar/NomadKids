/**
 * Fills the demo sections `demo-data.ts` does not create, on a database that
 * has already been seeded.
 *
 * ★ Exists because `seed:demo` is idempotent **by kindergarten**: it finds the
 * tenant already there and stops, so new content added to the seed never
 * reaches a database that was populated before it was written. The alternative
 * is `db:reset`, which throws away whatever anybody has typed in since.
 *
 * ★★ Local only, by the same rule and for the same reason as `seed-demo.ts`.
 * This writes invented invoices and staff certificates; a production database
 * is the one place they must never appear.
 *
 * Run:
 *   KINDERGARTEN_ID=… pnpm --filter @kinder/api exec tsx prisma/seed-demo-extras.ts
 *
 * Omit `KINDERGARTEN_ID` and it uses the only kindergarten, refusing if there
 * is more than one — guessing "the first" is right exactly once.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedDemoExtras } from "./demo-extras";

loadDotenv({ path: resolve(__dirname, "..", "..", "..", ".env"), quiet: true });

const url = process.env.DATABASE_URL ?? "";

/** The same guard `seed-demo.ts` carries, restated rather than exported. */
function assertLocalOnly(): void {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    throw new Error(
      `Refusing to seed demo content into a non-local database.\n  DATABASE_URL host is not localhost.`,
    );
  }
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

async function main(): Promise<void> {
  assertLocalOnly();

  let kindergartenId = process.env.KINDERGARTEN_ID;
  if (!kindergartenId) {
    const all = await prisma.kindergarten.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });
    if (all.length !== 1) {
      throw new Error(
        `Set KINDERGARTEN_ID — found ${all.length} kindergartens:\n` +
          all.map((k) => `  ${k.id}  ${k.name}`).join("\n"),
      );
    }
    kindergartenId = all[0]!.id;
  }

  const kindergarten = await prisma.kindergarten.findFirst({
    where: { id: kindergartenId, deletedAt: null },
    select: { name: true },
  });
  if (!kindergarten) throw new Error(`No kindergarten ${kindergartenId}`);

  console.log(`Filling demo content for "${kindergarten.name}"…`);
  await seedDemoExtras(prisma, kindergartenId);
  console.log("\nDone.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

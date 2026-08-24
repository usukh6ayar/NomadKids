/**
 * Creates the integration suite's database and brings its schema up to date.
 *
 * ★ Why the suite needs one of its own.
 *
 * `test/support/db.ts` runs `TRUNCATE … CASCADE` over every table before each
 * case. Pointed at the development database that is exactly what it does to it,
 * so `pnpm test` quietly deletes whatever `seed:demo` put there. Nothing fails;
 * the data is simply gone the next time the app is opened.
 *
 * Idempotent: run it after a migration and it applies the new ones, run it
 * twice and the second says there was nothing to do.
 *
 * Run:
 *   pnpm --filter @kinder/api test:db:setup
 */

import { config as loadDotenv } from "dotenv";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { Client } from "pg";

loadDotenv({ path: resolve(__dirname, "..", "..", "..", ".env"), quiet: true });

const testUrl = process.env.TEST_DATABASE_URL;

if (!testUrl) {
  console.error(
    "TEST_DATABASE_URL is not set.\n" +
      "Add it to .env — .env.example carries the local default:\n" +
      "  TEST_DATABASE_URL=postgresql://kinder:kinder@localhost:5433/kinder_test",
  );
  process.exit(1);
}

const parsed = new URL(testUrl);
const database = parsed.pathname.replace(/^\//, "");

if (!database) {
  console.error(`TEST_DATABASE_URL names no database: ${parsed.host}${parsed.pathname}`);
  process.exit(1);
}

/**
 * ★ Refuses to point the suite at the development database.
 *
 * The whole purpose of this script is separation, and a copy-paste that leaves
 * both variables identical would produce a setup that looks correct and still
 * truncates someone's seed. Compared on the full URL rather than the name so a
 * test database on a different host is still allowed.
 */
if (process.env.DATABASE_URL && process.env.DATABASE_URL === testUrl) {
  console.error(
    "TEST_DATABASE_URL and DATABASE_URL are the same database.\n" +
      "The test suite truncates every table it runs against — these must differ.",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  // Connect to `postgres`, not to the database being created: CREATE DATABASE
  // cannot run from inside the database it creates.
  const admin = new URL(testUrl!);
  admin.pathname = "/postgres";

  const client = new Client({ connectionString: admin.toString() });
  await client.connect();

  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      database,
    ]);

    if (rowCount === 0) {
      // The name comes from a URL the developer wrote, not from user input, but
      // it still cannot be a bound parameter — CREATE DATABASE takes no
      // placeholders — so it is quoted as an identifier.
      await client.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
      console.log(`Created database ${database}.`);
    } else {
      console.log(`Database ${database} already exists.`);
    }
  } finally {
    await client.end();
  }

  console.log("Applying migrations…");
  // `require.resolve` to Prisma's own CLI entrypoint, run under `node`
  // directly — not a `.bin/prisma` path. On Windows the installed shim is
  // `prisma.CMD`, not the extensionless POSIX name, and `spawnSync` without a
  // shell fails to resolve it (ENOENT); a shell fixes that but reintroduces
  // argument-escaping risk for no reason when the real entrypoint is one
  // `require.resolve` away.
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
    cwd: resolve(__dirname, ".."),
    stdio: "inherit",
    // `prisma.config.ts` reads DATABASE_URL, and `migrate deploy` must land in
    // the test database rather than in whatever .env names.
    env: { ...process.env, DATABASE_URL: testUrl },
  });

  console.log(`\nDone. ${database} is ready — \`pnpm test\` will use it instead of your dev data.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

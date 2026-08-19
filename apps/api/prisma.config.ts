import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { defineConfig, env } from "prisma/config";

/**
 * ★ Prisma 7 no longer auto-loads `.env`.
 *
 * Earlier versions read it implicitly, so a `prisma.config.ts` that only calls
 * `env("DATABASE_URL")` fails with "Cannot resolve environment variable" on a
 * machine where the variable is not already exported — which is every developer
 * machine, since this project keeps `.env` at the repository root.
 *
 * `src/main.ts` loads it for the same reason. Both are needed: the CLI runs as
 * its own process and never imports the application.
 *
 * `override` is deliberately off, so a real environment variable in CI or on the
 * platform always wins over a file that happens to be present.
 */
loadDotenv({ path: resolve(__dirname, "..", "..", ".env"), quiet: true });

/**
 * Prisma CLI configuration.
 *
 * In Prisma 7 the connection URL moved out of schema.prisma and into this file;
 * the runtime client receives a driver adapter instead (see
 * src/prisma/prisma.service.ts). The URL here is used by the CLI only — for
 * migrations and introspection.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),

    /**
     * A scratch database Prisma replays the migration history into, to work out
     * what a new migration should contain. Only `migrate diff` needs it.
     *
     * ★ It is DROPPED AND RECREATED on every use. Pointing it at a database
     * holding anything you care about destroys that database. It is read from
     * its own variable rather than derived from `DATABASE_URL` so the two can
     * never end up the same string.
     *
     * Optional on purpose: `env()` throws when the variable is unset, which
     * would make `migrate deploy` — the production command — fail on a machine
     * that has no reason to own a scratch database.
     */
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },
});

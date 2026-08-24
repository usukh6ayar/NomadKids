/**
 * Sets a user's password from the command line.
 *
 * ★ The operator's way in when e-mail delivery is not available.
 *
 * `POST /auth/password-reset` issues a token and mails it. Until SMTP is
 * configured — and on any deployment where it never will be — that leaves an
 * administrator who has forgotten their password with no route back into their
 * own system. This is that route.
 *
 * It is deliberately *not* an endpoint. Anything reachable over HTTP that sets
 * a password without proving who you are is a back door regardless of how it is
 * guarded; this needs a shell and the database URL, which is the same bar as
 * editing the row by hand — only without the chance of writing a malformed
 * hash.
 *
 * Run:
 *   DATABASE_URL=… tsx scripts/reset-password.ts <username> <password>
 *
 * Against Railway, open a tunnel first — it needs no public database:
 *   railway connect Postgres --tunnel-only
 */

import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * The production parameters from `PasswordService`.
 *
 * `argon2.verify` reads cost parameters out of the hash string, so a hash made
 * with different ones would still verify — but it would also silently make this
 * account cheaper to attack than every other. Matching them is the point.
 */
const ARGON2 = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;

const MIN_LENGTH = 12;

async function main(): Promise<void> {
  const [username, password] = process.argv.slice(2);

  if (!username || !password) {
    console.error("Usage: tsx scripts/reset-password.ts <username> <password>");
    process.exitCode = 1;
    return;
  }

  if (password.length < MIN_LENGTH) {
    console.error(`Password must be at least ${MIN_LENGTH} characters.`);
    process.exitCode = 1;
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const user = await prisma.user.findFirst({
      where: { username, deletedAt: null },
      select: { id: true, lastName: true, firstName: true },
    });

    if (!user) {
      console.error(`No active user named "${username}".`);
      process.exitCode = 1;
      return;
    }

    const passwordHash = await argon2.hash(password, ARGON2);

    /*
     * ★ The same three writes the reset endpoint performs, for the same
     * reasons.
     *
     * Revoking sessions: someone resetting because they believe they were
     * compromised must not leave the intruder logged in.
     *
     * Clearing login attempts: `LoginAttempt.identifier` is whatever was typed,
     * so a lockout cannot be cleared by user id — and an account still locked
     * after a successful reset reads as the reset not having worked.
     */
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      prisma.session.deleteMany({ where: { userId: user.id } }),
      prisma.loginAttempt.deleteMany({ where: { identifier: username } }),
    ]);

    /*
     * `console.log` rather than the logger: this is a CLI tool whose output IS
     * the result. An operator running it at 2am needs to read what happened, not
     * find it in a structured log stream.
     */
    console.log(`Password set for ${username} (${user.lastName} ${user.firstName}).`);
    console.log("Existing sessions revoked and any lockout cleared.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

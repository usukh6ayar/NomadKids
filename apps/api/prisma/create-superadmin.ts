/**
 * Creates a platform operator (`isSuperAdmin`) from the command line.
 *
 * ★ A new account, never a flag on an existing one. The web routes a
 * superadmin to `/platform` ahead of every role, so flagging a director's own
 * account would hide their kindergarten from them — and `isSuperAdmin` is
 * deliberately not a membership (schema, `User.isSuperAdmin`). A person who is
 * both gets two usernames.
 *
 * ★ Unlike `seed.ts`, this writes one row and nothing else: the seed also
 * re-applies the system configuration, which is not something to run on a
 * live database just to add a person. It refuses a username that exists
 * rather than promoting it, for the same reason.
 *
 * It lives in `prisma/` because that folder is in the api image.
 *
 * The password comes from the environment, not argv, so it is not in `ps`.
 * It is temporary: the person changes it under «Хувийн тохиргоо».
 *
 * Run (in the api container):
 *   NEW_PASSWORD='…' node_modules/.bin/tsx prisma/create-superadmin.ts <username> <lastName> <firstName>
 */

import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import { PrismaClient } from "../src/generated/prisma/client";

/** `PasswordService`'s production parameters, as in `scripts/reset-password.ts`. */
const ARGON2 = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;

const USERNAME = /^[a-zA-Z0-9._-]{3,64}$/;

async function main(): Promise<void> {
  const [username, lastName, firstName] = process.argv.slice(2);
  const password = process.env.NEW_PASSWORD;

  if (!username || !lastName || !firstName) {
    console.error(
      "Usage: NEW_PASSWORD=… tsx prisma/create-superadmin.ts <username> <lastName> <firstName>",
    );
    process.exitCode = 1;
    return;
  }
  if (!USERNAME.test(username)) {
    console.error("The username takes Latin letters, digits and . _ - (3–64).");
    process.exitCode = 1;
    return;
  }
  if (!password || password.length < 12) {
    console.error("Set NEW_PASSWORD to at least 12 characters.");
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
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      console.error(`"${username}" already exists. Choose another username.`);
      process.exitCode = 1;
      return;
    }

    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: await argon2.hash(password, ARGON2),
        lastName,
        firstName,
        isSuperAdmin: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "CREATE",
        actorLabel: "create-superadmin.ts (command line)",
        objectType: "User",
        objectId: user.id,
        metadata: { isSuperAdmin: true },
      },
    });

    console.log(`Platform operator created: ${username} (${lastName} ${firstName}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

/**
 * Creates one **named** platform operator, invited rather than given a password.
 *
 * ★★★ Why this exists: a shared `superadmin` account destroys the audit trail.
 *
 * `AuditLog` records `actorUserId` against every action, which is the whole
 * basis for answering "who changed this figure". If two people sign in as the
 * same account, every row names the same user and the log answers nothing —
 * and it answers nothing precisely in the case it was built for, where two
 * parties with a revenue agreement need to be able to check each other.
 *
 * So: one account per person, named, and the shared one retired once both have
 * signed in. `docs/PLATFORM_ACCOUNTS.md`.
 *
 * ★★ **No password is set, generated or printed.** The account is created with
 * an unusable hash — a random 32-byte string nobody, including this script,
 * retains — and a one-time invitation. The person sets their own password at
 * `/invitation/<token>`, so at no point does a password exist anywhere but in
 * their head. This is the same construction `UsersService.invite` uses.
 *
 * ★ **The invitation URL is written to a file, not to stdout.** A token echoed
 * into a terminal ends up in scrollback, in a screen recording, in a pasted
 * support thread. The file is `chmod 600` and the operator reads it themselves.
 *
 * ☆ A superadmin holds **no `Membership`** — CLAUDE.md §1.1. `isSuperAdmin`
 * grants registering kindergartens and reading platform totals, and nothing
 * about a child. `platform.test.ts` asserts a superadmin still gets 404 on a
 * child, its portfolio, its observations and its guardians.
 *
 * Run, on the server:
 *   USERNAME=… LAST_NAME=… FIRST_NAME=… EMAIL=… \
 *     pnpm --filter @kinder/api exec tsx prisma/add-superadmin.ts
 */

import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadDotenv } from "dotenv";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";

loadDotenv({ path: resolve(__dirname, "../../../.env"), quiet: true });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/** Matches `UsersService` and `PlatformService`. An invitation is an invitation. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * The same one-time token construction `TokenService` uses: a random secret
 * handed over once, and only its SHA-256 kept.
 *
 * ★ Re-implemented here rather than imported because this is a standalone
 * script with no Nest container. If `TokenService` ever changes its hashing,
 * this breaks loudly at acceptance time — which is why the algorithm is named
 * in a comment rather than left to be inferred.
 */
function createOneTimeToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

async function main(): Promise<void> {
  const username = required("USERNAME");
  const lastName = required("LAST_NAME");
  const firstName = required("FIRST_NAME");
  const email = required("EMAIL");
  const webOrigin = process.env.WEB_ORIGIN ?? "https://nomadkids.mn";

  const existing = await prisma.user.findFirst({
    where: { OR: [{ username }, { email }] },
    select: { id: true, username: true, isSuperAdmin: true },
  });
  if (existing) {
    /*
     * ★ Refuses rather than resetting. On a live deployment the existing
     * account may be a real person's, and quietly re-inviting it would revoke
     * a password somebody is using — the same reason `add-staff-account.ts`
     * refuses.
     */
    console.log(
      `${username}: an account with this username or email already exists ` +
        `(${existing.username}, superadmin=${existing.isSuperAdmin}). Nothing changed.`,
    );
    return;
  }

  const { token, hash } = createOneTimeToken();

  const user = await prisma.user.create({
    data: {
      username,
      email,
      lastName,
      firstName,
      // Unusable by construction: the input is thrown away in the next
      // statement, so nobody — not even whoever runs this — can sign in until
      // the invitation is accepted.
      passwordHash: await argon2.hash(randomBytes(32).toString("hex"), { type: argon2.argon2id }),
      isSuperAdmin: true,
      isActive: true,
      authTokens: {
        create: {
          purpose: "INVITATION",
          tokenHash: hash,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          requestedIp: null,
        },
      },
    },
    select: { id: true },
  });

  /*
   * ★ `actorUserId` is null: this runs from a shell, not from a session. The
   * row still matters — it is the record that a platform operator was created
   * outside the product, which is exactly the event somebody auditing the
   * account list would want to find.
   */
  await prisma.auditLog.create({
    data: {
      action: "CREATE",
      objectType: "User",
      objectId: user.id,
      actorLabel: "prisma/add-superadmin.ts",
      metadata: { username, isSuperAdmin: true },
    },
  });

  const path = resolve(process.cwd(), `invite-${username}.txt`);
  writeFileSync(
    path,
    [
      `${lastName} ${firstName} — платформын оператор`,
      `Нэвтрэх нэр: ${username}`,
      "",
      "Дараах холбоосоор орж нууц үгээ өөрөө тохируулна уу.",
      "Холбоос 7 хоног хүчинтэй, зөвхөн нэг удаа ажиллана.",
      "",
      `${webOrigin}/invitation/${token}`,
      "",
      "Ашигласны дараа энэ файлыг устгана уу:",
      `  rm ${path}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  chmodSync(path, 0o600);

  console.log(`${username}: created as a platform operator (no password set).`);
  console.log(`Invitation written to ${path} — read it, hand it over, then delete it.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

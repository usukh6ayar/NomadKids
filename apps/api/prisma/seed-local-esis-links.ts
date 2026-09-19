/**
 * Wires demo logins onto the **real** kindergarten a local database already
 * holds, so the product can be walked end to end without inventing children.
 *
 * ★ The problem it solves. `seed-esis.ts` pulls institution 42778's actual
 * roster — 83 children in four groups, thirteen staff — and that is by far the
 * most useful thing to develop against. But it arrives with nobody attached:
 * measured on 2026-09-19, those four groups had **no teacher assigned** and the
 * 83 children had **no guardian at all**, so a teacher's screens were empty and
 * a parent could not sign in to anything. `seed-demo.ts` fills that gap for a
 * second, invented kindergarten, which is where everyone ended up working
 * instead.
 *
 * This is the join between the two: real children, real groups, real staff
 * names from the ministry — and demo accounts in front of them. The client's
 * framing: "бодит дата ашиглана гэхдээ демо хэрэглэгчид байна".
 *
 * ★★ **The people are the ministry's, the logins are ours.** Each teacher is
 * created from an `EsisStaffRoster` row, so the names on screen are the ones
 * ESIS holds for 42778 and the ones staff self-registration would match. Only
 * the handle and the password are invented, because ESIS has neither.
 *
 * ★★★ Local only, and for the same reason `seed-demo.ts` is: it creates
 * accounts with a password printed to the terminal. `assertLocalOnly` is a copy
 * rather than an import because that file's copy guards a different script and
 * neither should be able to loosen the other.
 *
 * ★★★★ Idempotent, and the parent half had to be fixed to make that true.
 *
 * It skips a group that already has a teacher and a username that already
 * exists. The families are capped **per group** — "does this group already
 * have its demo families" — rather than filtered on "children with no
 * guardian", which is what the first version did: that reads as idempotent and
 * is not, because a second run finds the *next* two unguarded children and
 * makes two more accounts. Eight guardianships became sixteen on the re-run
 * that caught it.
 *
 * Run:
 *   pnpm --filter @kinder/api exec tsx prisma/seed-local-esis-links.ts
 */

import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient, type Role } from "../src/generated/prisma/client";

loadDotenv({ path: resolve(__dirname, "..", "..", "..", ".env"), quiet: true });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/** The same default `seed-demo.ts` uses, so one password opens everything. */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo-password-123";

/** How many families per group get a login. Enough to browse, not 83 accounts. */
const GUARDIANS_PER_GROUP = 2;

/**
 * Refuses anything but a local database.
 *
 * Two independent checks, because either alone has a plausible failure: an
 * unset `NODE_ENV` looks like development on a production box, and a tunnelled
 * production database really can answer on `localhost`. Both have to pass.
 */
function assertLocalOnly(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seed-local-esis-links refuses to run with NODE_ENV=production");
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "db"].includes(host)) {
    throw new Error(
      `seed-local-esis-links refuses to run against a non-local database (host: ${host}).\n` +
        "It creates accounts with a known password. That is safe on a laptop and nowhere else.",
    );
  }
}

/** Latin handles, because a Mongolian name has no single obvious latin form. */
function handle(prefix: string, index: number): string {
  return index === 0 ? prefix : `${prefix}${index + 1}`;
}

async function ensureUser(input: {
  username: string;
  lastName: string;
  firstName: string;
  kindergartenId: string;
  role: Role;
}): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.user.findUnique({
    where: { username: input.username },
    select: { id: true },
  });
  if (existing) {
    // The membership may still be missing if a previous run stopped between
    // the two writes.
    await prisma.membership.upsert({
      where: {
        userId_kindergartenId_role: {
          userId: existing.id,
          kindergartenId: input.kindergartenId,
          role: input.role,
        },
      },
      update: { deletedAt: null, isActive: true },
      create: { userId: existing.id, kindergartenId: input.kindergartenId, role: input.role },
    });
    return { id: existing.id, created: false };
  }

  const user = await prisma.user.create({
    data: {
      username: input.username,
      email: `${input.username}@nomadkids.local`,
      lastName: input.lastName,
      firstName: input.firstName,
      // `argon2id` named explicitly, matching `seed.ts` and the password
      // service: the library's default variant has changed between majors.
      passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      isActive: true,
      memberships: { create: { kindergartenId: input.kindergartenId, role: input.role } },
    },
    select: { id: true },
  });

  return { id: user.id, created: true };
}

async function main(): Promise<void> {
  assertLocalOnly();

  const kindergarten = await prisma.kindergarten.findFirst({
    where: {
      deletedAt: null,
      ...(process.env.KINDERGARTEN_ID
        ? { id: process.env.KINDERGARTEN_ID }
        : { esisInstitutionId: { not: null } }),
    },
    select: { id: true, name: true, esisInstitutionId: true },
  });

  if (!kindergarten) {
    throw new Error(
      "No ESIS-mapped kindergarten found. Run `pnpm --filter @kinder/api seed:esis` first, " +
        "or pass KINDERGARTEN_ID=… for a specific one.",
    );
  }

  console.log(`${kindergarten.name} (institution ${kindergarten.esisInstitutionId})`);

  const groups = await prisma.group.findMany({
    where: { kindergartenId: kindergarten.id, deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  /*
   * ★ Teachers come from the roster's `isInstructor` rows — the people ESIS
   * itself calls teaching staff — so the names in the product are the ministry's
   * own. Ordered by surname purely so a re-run against an unchanged roster
   * assigns the same person to the same group.
   */
  const instructors = await prisma.esisStaffRoster.findMany({
    where: { kindergartenId: kindergarten.id, isInstructor: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: { lastName: true, firstName: true, positionName: true },
  });

  let teacherIndex = 0;
  const created: string[] = [];

  for (const group of groups) {
    const assigned = await prisma.groupTeacher.count({
      where: { groupId: group.id, endedOn: null, deletedAt: null },
    });
    if (assigned > 0) {
      console.log(`  ${group.name}: already has a teacher — skipped`);
      continue;
    }

    const person = instructors[teacherIndex];
    if (!person) {
      console.log(`  ${group.name}: the ESIS roster has no teacher left to assign`);
      continue;
    }

    const username = handle("bagsh", teacherIndex);
    const { id: userId } = await ensureUser({
      username,
      lastName: person.lastName,
      firstName: person.firstName,
      kindergartenId: kindergarten.id,
      role: "TEACHER",
    });

    const membership = await prisma.membership.findFirst({
      where: { userId, kindergartenId: kindergarten.id, role: "TEACHER", deletedAt: null },
      select: { id: true },
    });

    await prisma.groupTeacher.create({
      data: {
        kindergartenId: kindergarten.id,
        groupId: group.id,
        membershipId: membership!.id,
        role: "LEAD",
      },
    });

    created.push(`${username} — ${person.lastName} ${person.firstName} → ${group.name}`);
    teacherIndex += 1;
  }

  /*
   * The two support roles. `Тогооч` is on the ministry's roster; an accountant
   * is not — 42778 employs none that ESIS lists — so that one is plainly ours
   * and named as such rather than borrowing somebody else's row.
   */
  const cook = await prisma.esisStaffRoster.findFirst({
    where: { kindergartenId: kindergarten.id, positionName: { contains: "огооч" } },
    select: { lastName: true, firstName: true },
  });

  const support: { username: string; lastName: string; firstName: string; role: Role }[] = [
    {
      username: "togooch",
      lastName: cook?.lastName ?? "Тогооч",
      firstName: cook?.firstName ?? "Демо",
      role: "COOK",
    },
    { username: "nyagtlan", lastName: "Нягтлан", firstName: "Демо", role: "ACCOUNTANT" },
  ];

  for (const person of support) {
    const { created: isNew } = await ensureUser({ ...person, kindergartenId: kindergarten.id });
    created.push(
      `${person.username} — ${person.lastName} ${person.firstName}${isNew ? "" : " (байсан)"}`,
    );
  }

  /*
   * ★ A handful of families, not 83. Enough that a parent login opens a real
   * child's portfolio — with real observations, attendance and meals behind it
   * — without filling the user table with accounts nobody signs in to.
   *
   * `relation: "MOTHER"` rather than `OTHER`: this is seed data, and the
   * product's own invitation flow leaves it `OTHER` only because a teacher must
   * not guess on a real person's behalf. Here there is nobody to guess about.
   */
  let parentIndex = 0;
  for (const group of groups) {
    /*
     * ★ Counted against the group, not against "children with no guardian".
     *
     * The first version filtered on the latter and read as idempotent because
     * the teacher half is — but a second run simply found the *next* two
     * unguarded children and made two more accounts, 8 guardianships becoming
     * 16. Measured, not reasoned about: the re-run is what caught it.
     */
    const alreadyLinked = await prisma.guardianship.count({
      where: {
        deletedAt: null,
        child: {
          enrollments: { some: { groupId: group.id, deletedAt: null, status: "ACTIVE" } },
        },
      },
    });
    const wanted = GUARDIANS_PER_GROUP - alreadyLinked;
    if (wanted <= 0) {
      console.log(`  ${group.name}: already has demo families — skipped`);
      parentIndex += GUARDIANS_PER_GROUP;
      continue;
    }

    const children = await prisma.child.findMany({
      where: {
        kindergartenId: kindergarten.id,
        deletedAt: null,
        enrollments: { some: { groupId: group.id, deletedAt: null, status: "ACTIVE" } },
        guardianships: { none: { deletedAt: null } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: wanted,
      select: { id: true, lastName: true, firstName: true },
    });

    for (const child of children) {
      const username = handle("etseg", parentIndex);
      const { id: userId } = await ensureUser({
        username,
        lastName: child.lastName,
        firstName: `${child.firstName}-ийн ээж`,
        kindergartenId: kindergarten.id,
        role: "PARENT",
      });

      await prisma.guardianship.upsert({
        where: { childId_guardianUserId: { childId: child.id, guardianUserId: userId } },
        update: { deletedAt: null, canView: true },
        create: {
          kindergartenId: kindergarten.id,
          childId: child.id,
          guardianUserId: userId,
          relation: "MOTHER",
          isPrimary: true,
        },
      });

      created.push(`${username} → ${child.lastName} ${child.firstName} (${group.name})`);
      parentIndex += 1;
    }
  }

  console.log("");
  for (const line of created) console.log(`  ${line}`);
  console.log("");
  console.log(`  Нууц үг: ${PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

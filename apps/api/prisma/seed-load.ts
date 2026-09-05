/**
 * Builds a kindergarten large enough for the load test to mean something.
 *
 * ★ A/261 Хавсралт 1 #6 — the concurrency requirement — is measured against
 * `docs/LOAD_TEST.md`, and a measurement is only as honest as the data under
 * it. The demo seed creates ten children; a `GET /children` over ten rows
 * measures the framework's request overhead and nothing about this product.
 * This creates a kindergarten of a realistic size with a term of real
 * attendance behind it, so the queries under test do the work they will do in
 * a kindergarten.
 *
 * ★★ **It refuses to run against anything that is not obviously a load-test
 * database.** Two independent guards, both required:
 *
 *   1. the database name must contain `load`, and
 *   2. `LOAD_TEST_CONFIRM=yes` must be set.
 *
 * The script writes tens of thousands of rows and is not idempotent. One
 * mistyped `DATABASE_URL` against a kindergarten's real database would be
 * unrecoverable without a restore, and a `.env` that already points at
 * something real is the normal state of a developer's shell — which is exactly
 * why the guard cannot be a comment saying "be careful".
 *
 * Run:
 *   DATABASE_URL=postgresql://kinder:kinder@localhost:5434/kinder_load \
 *   LOAD_TEST_CONFIRM=yes CHILDREN=200 DAYS=60 \
 *     pnpm --filter @kinder/api exec tsx prisma/seed-load.ts
 */

import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import {
  PrismaClient,
  type AgeBand,
  type AttendanceStatus,
  type Sex,
} from "../src/generated/prisma/client";

loadDotenv({ path: resolve(__dirname, "../../../.env"), quiet: true });

const DATABASE_URL = process.env.DATABASE_URL ?? "";

function assertSafeTarget(): void {
  if (process.env.LOAD_TEST_CONFIRM !== "yes") {
    throw new Error("Refusing to run: set LOAD_TEST_CONFIRM=yes when you mean it.");
  }
  let database: string;
  try {
    database = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  } catch {
    throw new Error("DATABASE_URL is not a URL.");
  }
  if (!database.toLowerCase().includes("load")) {
    throw new Error(
      `Refusing to run against database "${database}". ` +
        "This script writes tens of thousands of rows and is not idempotent; " +
        "point it at a database whose name contains 'load'.",
    );
  }
}

assertSafeTarget();

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const CHILDREN = Number(process.env.CHILDREN ?? 200);
const DAYS = Number(process.env.DAYS ?? 60);
const PASSWORD = process.env.LOAD_TEST_PASSWORD ?? "load-test-password-1";

const LAST_NAMES = [
  "Батбаяр",
  "Ганболд",
  "Дорж",
  "Сүхбаатар",
  "Мөнх",
  "Энхбаяр",
  "Түвшин",
  "Наранбаатар",
  "Оюунчимэг",
  "Цэрэн",
  "Баасандорж",
  "Эрдэнэ",
];
const FIRST_NAMES = [
  "Тэмүүлэн",
  "Ануужин",
  "Билгүүн",
  "Хулан",
  "Тэмүүжин",
  "Сарнай",
  "Ундрам",
  "Мандах",
  "Номин",
  "Зул",
  "Тэгшбаяр",
  "Алтан",
  "Хишиг",
  "Дулмаа",
  "Оргил",
];
const AGE_BANDS: AgeBand[] = ["NURSERY", "JUNIOR", "MIDDLE", "SENIOR"];

/**
 * ★ A fixed, seeded pseudo-random sequence rather than `Math.random`.
 *
 * Two runs with the same `CHILDREN`/`DAYS` produce the same data, so a
 * before-and-after comparison of two builds is comparing the same queries over
 * the same rows. A load-test number that moves because the data moved is
 * indistinguishable from one that moves because the code did.
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
const random = makeRandom(20260902);

const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

/** School days only — a term's attendance has no Saturdays in it. */
function schoolDays(count: number): Date[] {
  const days: Date[] = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  while (days.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(new Date(cursor));
  }
  return days.reverse();
}

/**
 * The real distribution, not "everybody present".
 *
 * A register that is 100% PRESENT makes every filter in the attendance journal
 * return either everything or nothing, so the index behaviour under test is not
 * the index behaviour in production.
 */
function attendanceStatus(): AttendanceStatus {
  const roll = random();
  if (roll < 0.82) return "PRESENT";
  if (roll < 0.88) return "SICK";
  if (roll < 0.93) return "EXCUSED";
  if (roll < 0.97) return "ABSENT";
  if (roll < 0.99) return "HALF_DAY";
  return "OTHER";
}

async function main(): Promise<void> {
  const started = Date.now();
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const suffix = Date.now().toString(36);

  console.log(`Seeding ${CHILDREN} children × ${DAYS} school days into ${DATABASE_URL}\n`);

  const kindergarten = await prisma.kindergarten.create({
    data: { name: `Ачааллын сорил ${suffix}`, isActive: true },
    select: { id: true },
  });

  const year = new Date().getFullYear();
  const schoolYear = await prisma.schoolYear.create({
    data: {
      kindergartenId: kindergarten.id,
      name: `${year}-${year + 1}`,
      startsOn: new Date(Date.UTC(year, 8, 1)),
      endsOn: new Date(Date.UTC(year + 1, 5, 30)),
      isCurrent: true,
    },
    select: { id: true },
  });

  // ── Staff ──────────────────────────────────────────────────────────────────
  const admin = await prisma.user.create({
    data: {
      username: `load-admin-${suffix}`,
      lastName: "Ачаалал",
      firstName: "Захирал",
      passwordHash,
      isActive: true,
      memberships: { create: { kindergartenId: kindergarten.id, role: "ADMIN" } },
    },
    select: { id: true, username: true },
  });

  /*
   * ★ Groups of ~25, which is what the ministry's own norm produces. The count
   * follows from CHILDREN rather than being fixed: a load test on 500 children
   * across four groups would measure a group filter that never narrows
   * anything, and the group filter is the attendance journal's hot path.
   */
  const groupCount = Math.max(2, Math.ceil(CHILDREN / 25));
  const groups: { id: string }[] = [];
  for (let i = 0; i < groupCount; i += 1) {
    groups.push(
      await prisma.group.create({
        data: {
          kindergartenId: kindergarten.id,
          schoolYearId: schoolYear.id,
          name: `${i + 1}-р бүлэг`,
          ageBand: AGE_BANDS[i % AGE_BANDS.length]!,
        },
        select: { id: true },
      }),
    );
  }

  const teachers: { id: string; membershipId: string }[] = [];
  for (let i = 0; i < groupCount; i += 1) {
    const teacher = await prisma.user.create({
      data: {
        username: `load-bagsh${i + 1}-${suffix}`,
        lastName: pick(LAST_NAMES),
        firstName: pick(FIRST_NAMES),
        passwordHash,
        isActive: true,
        memberships: { create: { kindergartenId: kindergarten.id, role: "TEACHER" } },
      },
      select: { id: true, memberships: { select: { id: true } } },
    });
    const membershipId = teacher.memberships[0]!.id;
    teachers.push({ id: teacher.id, membershipId });
    await prisma.groupTeacher.create({
      data: {
        kindergartenId: kindergarten.id,
        groupId: groups[i]!.id,
        membershipId,
        role: "LEAD",
      },
    });
  }
  console.log(`  staff:      1 admin, ${teachers.length} teachers, ${groups.length} groups`);

  // ── Children, enrolments, one guardian each ────────────────────────────────
  const childIds: string[] = [];
  const enrollmentByChild = new Map<string, string>();

  for (let i = 0; i < CHILDREN; i += 1) {
    const group = groups[i % groups.length]!;
    const child = await prisma.child.create({
      data: {
        kindergartenId: kindergarten.id,
        lastName: pick(LAST_NAMES),
        firstName: pick(FIRST_NAMES),
        sex: (random() < 0.5 ? "MALE" : "FEMALE") as Sex,
        dateOfBirth: new Date(
          Date.UTC(year - 3 - (i % 4), Math.floor(random() * 12), 1 + Math.floor(random() * 27)),
        ),
        status: "ACTIVE",
        enrollments: {
          create: {
            kindergartenId: kindergarten.id,
            groupId: group.id,
            schoolYearId: schoolYear.id,
            startedOn: new Date(Date.UTC(year, 8, 1)),
            status: "ACTIVE",
          },
        },
      },
      select: { id: true, enrollments: { select: { id: true } } },
    });
    childIds.push(child.id);
    enrollmentByChild.set(child.id, child.enrollments[0]!.id);

    /*
     * ★ One guardian per child, each their own account — not one parent shared
     * across two hundred children. `canAccessChild` walks `Guardianship`, and a
     * single guardian row with two hundred children is a query shape no real
     * kindergarten has.
     */
    const guardian = await prisma.user.create({
      data: {
        username: `load-etseg${i + 1}-${suffix}`,
        lastName: pick(LAST_NAMES),
        firstName: pick(FIRST_NAMES),
        passwordHash,
        isActive: true,
        memberships: { create: { kindergartenId: kindergarten.id, role: "PARENT" } },
      },
      select: { id: true },
    });
    await prisma.guardianship.create({
      data: {
        kindergartenId: kindergarten.id,
        childId: child.id,
        guardianUserId: guardian.id,
        relation: random() < 0.5 ? "MOTHER" : "FATHER",
        isPrimary: true,
        canView: true,
      },
    });

    if ((i + 1) % 50 === 0) console.log(`  children:   ${i + 1}/${CHILDREN}`);
  }

  // ── Attendance ─────────────────────────────────────────────────────────────
  const days = schoolDays(DAYS);
  let written = 0;
  for (const day of days) {
    // `createMany` per day rather than per row: 200 inserts in one statement
    // instead of 200 round trips, which is the difference between this script
    // taking a minute and taking an hour.
    const rows = childIds.map((childId) => ({
      kindergartenId: kindergarten.id,
      childId,
      enrollmentId: enrollmentByChild.get(childId)!,
      date: day,
      status: attendanceStatus(),
      recordedById: teachers[0]!.id,
    }));
    const result = await prisma.attendance.createMany({ data: rows, skipDuplicates: true });
    written += result.count;
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`  attendance: ${written} rows over ${days.length} school days`);
  console.log(`\nDone in ${seconds}s.`);
  console.log(`\n  kindergartenId: ${kindergarten.id}`);
  console.log(`  admin:          ${admin.username}`);
  console.log(`  password:       ${PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

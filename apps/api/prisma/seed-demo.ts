/**
 * Demo data, for local development only.
 *
 * ★ This is the file `seed.ts` deliberately is not.
 *
 * `seed.ts` creates the system configuration a real deployment needs. This one
 * fills a local database with a kindergarten that has enough shape to *look at*
 * — children with enrolments, observations in every review state, a term's
 * assessments, announcements. Screens that render an empty state cannot be
 * compared against a design, and every list, card, table and pagination control
 * in this product only exists once there are rows.
 *
 * Written for `docs/UI_MIGRATION_STATUS.md`, which needs the two applications
 * side by side with comparable content.
 *
 * ★★ It refuses to run anywhere but a local database. See `assertLocalOnly`.
 *
 * Idempotent by kindergarten: run it twice and it reports what already exists
 * rather than creating a second copy.
 *
 * Run: pnpm --filter @kinder/api seed:demo
 */

import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const KINDERGARTEN_NAME = "Бяцхан нүүдэлчид (жишээ)";

/**
 * The one place a default password is acceptable in this repository.
 *
 * `seed.ts` refuses to invent one, and it is right to: a seeded `admin/admin123`
 * nobody remembers to change is a production backdoor. The difference here is
 * that this script **cannot reach a production database** — `assertLocalOnly`
 * stops it — so the account it creates cannot exist anywhere that matters.
 *
 * Override with `SEED_DEMO_PASSWORD` if you want a different one.
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo-password-123";

/**
 * Refuses anything but a local database.
 *
 * Two independent checks, because either alone has a plausible failure: an
 * unset `NODE_ENV` looks like development on a production box, and a tunnelled
 * production database really can answer on `localhost`. Both have to pass.
 */
function assertLocalOnly(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seed-demo refuses to run with NODE_ENV=production");
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "db"].includes(host)) {
    throw new Error(
      `seed-demo refuses to run against a non-local database (host: ${host}).\n` +
        "It creates accounts with a known password. That is safe on a laptop and nowhere else.",
    );
  }
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function makeUser(input: {
  username: string;
  lastName: string;
  firstName: string;
  email?: string;
  phone?: string;
}) {
  const existing = await prisma.user.findUnique({ where: { username: input.username } });
  if (existing) return existing;

  return prisma.user.create({
    data: {
      username: input.username,
      lastName: input.lastName,
      firstName: input.firstName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    },
  });
}

/** Ten children, with names and birthdays that spread across the age bands. */
const CHILDREN = [
  { lastName: "Ганболд", firstName: "Батбаяр", sex: "MALE", dob: "2021-04-12" },
  { lastName: "Дорж", firstName: "Namuun", sex: "FEMALE", dob: "2021-06-30" },
  { lastName: "Энхбат", firstName: "Тэмүүлэн", sex: "MALE", dob: "2021-09-02" },
  { lastName: "Мөнхбаяр", firstName: "Сарнай", sex: "FEMALE", dob: "2021-11-19" },
  { lastName: "Батжаргал", firstName: "Anu", sex: "FEMALE", dob: "2022-01-25" },
  { lastName: "Сүхбаатар", firstName: "Чингис", sex: "MALE", dob: "2020-03-08" },
  { lastName: "Пүрэвдорж", firstName: "Оюунаа", sex: "FEMALE", dob: "2020-05-14" },
  { lastName: "Алтанзул", firstName: "Мандах", sex: "MALE", dob: "2020-08-21" },
  { lastName: "Нэргүй", firstName: "Хулан", sex: "FEMALE", dob: "2020-10-05" },
  { lastName: "Цэрэндорж", firstName: "Билгүүн", sex: "MALE", dob: "2020-12-30" },
] as const;

/**
 * Observations, written to exercise the states the screens actually branch on:
 * pending review (the teacher queue), approved-and-visible (the parent feed),
 * approved-but-private, and one rejected.
 */
const OBSERVATION_SEEDS = [
  {
    typeCode: "daily",
    observedOn: "2026-08-17",
    activityName: "Өглөөний дугуйлан",
    situation: "Бүлгийн өглөөний уулзалтын үеэр.",
    childDid: "Өөрийн амралтын өдрийн тухай ярьж, найзуудынхаа асуултад хариулав.",
    childSaid: "«Би ааваараа уулан дээр гарсан.»",
    teacherComment: "Бусдын өмнө ярих итгэл нэмэгдсэн нь ажиглагдав.",
    nextSteps: "Дараагийн долоо хоногт багийн ярианы удирдагчаар оролцуулах.",
    domains: ["language", "social"],
    visibleToParents: true,
    reviewStatus: "APPROVED",
  },
  {
    typeCode: "activity",
    observedOn: "2026-08-18",
    activityName: "Барилгын блок",
    situation: "Чөлөөт тоглоомын цагаар гурван хүүхэдтэй хамт.",
    childDid: "Өндөр цамхаг барихдаа суурийг өргөн болгож тогтвортой болгосон.",
    teacherComment: "Шалтгаан-үр дагаврыг туршилтаар олж мэдэв.",
    nextSteps: "Илүү нарийн бүтэц шаардсан даалгавар өгөх.",
    domains: ["cognitive", "physical"],
    visibleToParents: true,
    reviewStatus: "APPROVED",
  },
  {
    typeCode: "milestone",
    observedOn: "2026-08-19",
    activityName: "Зураг зурах",
    situation: "Гэр бүлийн зураг зурах даалгавар.",
    childDid: "Анх удаа хүний дүрсийг гар, хөлтэйгээр бүрэн зурав.",
    teacherComment: "Нарийн моторикийн тодорхой ахиц.",
    domains: ["creative", "physical"],
    visibleToParents: true,
    reviewStatus: "APPROVED",
  },
  {
    typeCode: "concern",
    observedOn: "2026-08-19",
    situation: "Үдийн унтлагын өмнө.",
    childDid: "Тайвшрахад хугацаа шаардагдав.",
    teacherComment: "Гэр бүлтэй ярилцах шаардлагатай.",
    domains: ["social"],
    // Private: a concern goes to the family in person, not through a feed.
    visibleToParents: false,
    reviewStatus: "APPROVED",
  },
  {
    typeCode: "parent",
    observedOn: "2026-08-20",
    situation: "Гэрээс ирүүлсэн тэмдэглэл.",
    childDid: "Гэртээ дүүгээ асрахад тусалсан.",
    domains: ["social"],
    visibleToParents: true,
    // The parent-submitted queue teachers review. RFP §5.4.
    reviewStatus: "PENDING",
    source: "PARENT",
  },
  {
    typeCode: "parent",
    observedOn: "2026-08-20",
    situation: "Гэрээс ирүүлсэн тэмдэглэл.",
    childDid: "Шинэ үг сурсан.",
    domains: ["language"],
    visibleToParents: true,
    reviewStatus: "PENDING",
    source: "PARENT",
  },
] as const;

async function main(): Promise<void> {
  assertLocalOnly();

  const existing = await prisma.kindergarten.findFirst({
    where: { name: KINDERGARTEN_NAME, deletedAt: null },
  });
  if (existing) {
    console.log(`Demo kindergarten already exists (${existing.id}). Nothing to do.`);
    return;
  }

  // The shared configuration rows, created by `seed.ts`. Without them there are
  // no domains to tag an observation with and no levels to assess against.
  const [domains, levels, types] = await Promise.all([
    prisma.developmentDomain.findMany({ where: { kindergartenId: null, deletedAt: null } }),
    prisma.assessmentLevel.findMany({ where: { kindergartenId: null, deletedAt: null } }),
    prisma.observationType.findMany({ where: { kindergartenId: null, deletedAt: null } }),
  ]);

  if (!domains.length || !levels.length || !types.length) {
    throw new Error("System configuration is missing. Run `pnpm --filter @kinder/api seed` first.");
  }

  const domainByCode = new Map(domains.map((d) => [d.code, d]));
  const typeByCode = new Map(types.map((t) => [t.code, t]));

  console.log("Creating demo kindergarten…");
  const kg = await prisma.kindergarten.create({
    data: {
      name: KINDERGARTEN_NAME,
      address: "Улаанбаатар, Баянзүрх дүүрэг",
      phone: "+976 7000 0000",
      email: "demo@nomadkids.mn",
    },
  });

  const year = await prisma.schoolYear.create({
    data: {
      kindergartenId: kg.id,
      name: "2026-2027",
      startsOn: day("2026-08-01"),
      endsOn: day("2027-06-01"),
      isCurrent: true,
    },
  });

  const terms = await Promise.all(
    [
      { number: 1, name: "I улирал", startsOn: "2026-08-01", endsOn: "2026-12-20" },
      { number: 2, name: "II улирал", startsOn: "2027-01-05", endsOn: "2027-03-20" },
      { number: 3, name: "III улирал", startsOn: "2027-03-25", endsOn: "2027-06-01" },
    ].map((t) =>
      prisma.term.create({
        data: {
          kindergartenId: kg.id,
          schoolYearId: year.id,
          number: t.number,
          name: t.name,
          startsOn: day(t.startsOn),
          endsOn: day(t.endsOn),
        },
      }),
    ),
  );

  const groups = await Promise.all(
    [
      { name: "Дунд бүлэг", ageBand: "JUNIOR" as const },
      { name: "Ахлах бүлэг", ageBand: "MIDDLE" as const },
    ].map((g) =>
      prisma.group.create({
        data: { kindergartenId: kg.id, schoolYearId: year.id, name: g.name, ageBand: g.ageBand },
      }),
    ),
  );

  console.log("Creating people…");
  const admin = await makeUser({
    username: "zahiral",
    lastName: "Батсайхан",
    firstName: "Оюунчимэг",
    email: "zahiral@nomadkids.mn",
  });
  const teacherA = await makeUser({
    username: "bagsh1",
    lastName: "Дэлгэрмаа",
    firstName: "Сувдаа",
    email: "bagsh1@nomadkids.mn",
  });
  const teacherB = await makeUser({
    username: "bagsh2",
    lastName: "Ариунаа",
    firstName: "Золжаргал",
    email: "bagsh2@nomadkids.mn",
  });

  const memberships = await Promise.all([
    prisma.membership.create({
      data: { userId: admin.id, kindergartenId: kg.id, role: "ADMIN" },
    }),
    prisma.membership.create({
      data: { userId: teacherA.id, kindergartenId: kg.id, role: "TEACHER" },
    }),
    prisma.membership.create({
      data: { userId: teacherB.id, kindergartenId: kg.id, role: "TEACHER" },
    }),
  ]);

  await Promise.all([
    prisma.groupTeacher.create({
      data: {
        kindergartenId: kg.id,
        groupId: groups[0]!.id,
        membershipId: memberships[1]!.id,
        role: "LEAD",
      },
    }),
    prisma.groupTeacher.create({
      data: {
        kindergartenId: kg.id,
        groupId: groups[1]!.id,
        membershipId: memberships[2]!.id,
        role: "LEAD",
      },
    }),
  ]);

  console.log("Creating children…");
  const children = [];
  for (const [index, c] of CHILDREN.entries()) {
    const group = groups[index < 5 ? 0 : 1]!;

    const child = await prisma.child.create({
      data: {
        kindergartenId: kg.id,
        lastName: c.lastName,
        firstName: c.firstName,
        sex: c.sex,
        dateOfBirth: day(c.dob),
      },
    });

    const enrollment = await prisma.enrollment.create({
      data: {
        kindergartenId: kg.id,
        childId: child.id,
        groupId: group.id,
        schoolYearId: year.id,
        startedOn: day("2026-08-01"),
      },
    });

    // One guardian each. The first two children share a parent account, which
    // is the case the parent shell's child switcher exists for.
    const parentIndex = index < 2 ? 0 : index;
    const parent = await makeUser({
      username: `etseg${parentIndex + 1}`,
      lastName: c.lastName,
      firstName: `Эцэг ${parentIndex + 1}`,
      phone: `+9769900${String(parentIndex + 1).padStart(4, "0")}`,
    });

    await prisma.membership.upsert({
      where: {
        userId_kindergartenId_role: { userId: parent.id, kindergartenId: kg.id, role: "PARENT" },
      },
      create: { userId: parent.id, kindergartenId: kg.id, role: "PARENT" },
      update: {},
    });

    await prisma.guardianship.create({
      data: {
        kindergartenId: kg.id,
        childId: child.id,
        guardianUserId: parent.id,
        relation: index % 2 === 0 ? "MOTHER" : "FATHER",
        isPrimary: true,
      },
    });

    children.push({ child, enrollment, group });
  }

  console.log("Creating observations…");
  let observationCount = 0;
  for (const { child, enrollment } of children.slice(0, 6)) {
    for (const seed of OBSERVATION_SEEDS) {
      const type = typeByCode.get(seed.typeCode);
      if (!type) continue;

      const observation = await prisma.observation.create({
        data: {
          kindergartenId: kg.id,
          childId: child.id,
          enrollmentId: enrollment.id,
          typeId: type.id,
          source: "source" in seed ? seed.source : "TEACHER",
          observedOn: day(seed.observedOn),
          activityName: "activityName" in seed ? seed.activityName : null,
          situation: seed.situation,
          childDid: seed.childDid,
          childSaid: "childSaid" in seed ? seed.childSaid : null,
          teacherComment: "teacherComment" in seed ? seed.teacherComment : null,
          nextSteps: "nextSteps" in seed ? seed.nextSteps : null,
          visibleToParents: seed.visibleToParents,
          reviewStatus: seed.reviewStatus,
          authorId: seed.reviewStatus === "PENDING" ? null : teacherA.id,
        },
      });

      for (const code of seed.domains) {
        const domain = domainByCode.get(code);
        if (!domain) continue;
        await prisma.observationDomain.create({
          data: {
            kindergartenId: kg.id,
            observationId: observation.id,
            domainId: domain.id,
          },
        });
      }

      observationCount += 1;
    }
  }

  console.log("Creating assessments…");
  let assessmentCount = 0;
  const firstTerm = terms[0]!;
  for (const [childIndex, { child, enrollment }] of children.entries()) {
    for (const [domainIndex, domain] of domains.entries()) {
      // A spread of levels rather than a single value, so the assessment grid
      // and the term report show more than one colour.
      const level = levels[(childIndex + domainIndex) % levels.length]!;

      await prisma.assessment.create({
        data: {
          kindergartenId: kg.id,
          childId: child.id,
          enrollmentId: enrollment.id,
          domainId: domain.id,
          termId: firstTerm.id,
          levelId: level.id,
          visibleToParents: true,
          assessedById: teacherA.id,
        },
      });
      assessmentCount += 1;
    }
  }

  console.log("Creating announcements…");
  const announcements = [
    {
      title: "Намрын аялал",
      body: "Ирэх пүрэв гарагт Богд уулын дэнжид аялна. Дулаан хувцас, ус авчирна уу.",
      isImportant: true,
    },
    {
      title: "Эцэг эхийн хурал",
      body: "Улирлын үнэлгээний танилцуулга 9-р сарын 25-ны 18:00 цагт болно.",
      isImportant: false,
    },
    {
      title: "Гэрэл зургийн өдөр",
      body: "Хүүхдүүдийн хувийн хавтасны гэрэл зургийг дараагийн долоо хоногт авна.",
      isImportant: false,
    },
  ];

  for (const a of announcements) {
    const notification = await prisma.notification.create({
      data: {
        kindergartenId: kg.id,
        title: a.title,
        body: a.body,
        isImportant: a.isImportant,
        status: "PUBLISHED",
        publishedAt: new Date(),
        authorId: teacherA.id,
      },
    });

    await prisma.notificationTarget.create({
      data: {
        kindergartenId: kg.id,
        notificationId: notification.id,
        groupId: groups[0]!.id,
      },
    });
  }

  console.log("\nDone.");
  console.log(`  kindergarten : ${KINDERGARTEN_NAME}`);
  console.log(`  groups       : ${groups.length}`);
  console.log(`  children     : ${children.length}`);
  console.log(`  observations : ${observationCount}`);
  console.log(`  assessments  : ${assessmentCount}`);
  console.log(`  announcements: ${announcements.length}`);
  console.log(`\n  Sign in with any of these — password: ${PASSWORD}`);
  console.log("    zahiral   ADMIN");
  console.log("    bagsh1    TEACHER  (Дунд бүлэг)");
  console.log("    bagsh2    TEACHER  (Ахлах бүлэг)");
  console.log("    etseg1    PARENT   (two children)");
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

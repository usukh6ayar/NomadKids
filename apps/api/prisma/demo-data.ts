/**
 * The demo kindergarten, as data.
 *
 * ★ This module holds the content. It decides nothing about *where* it may be
 * written — that is the caller's job, and the reason the two callers exist:
 *
 *   seed-demo.ts      refuses anything but a local database, and may therefore
 *                     use a known default password.
 *   seed-showcase.ts  runs against a deployment, and therefore refuses to run
 *                     without a password given to it explicitly.
 *
 * Keeping the guard out of here is what makes the second script possible
 * without weakening the first. `assertLocalOnly` in `seed-demo.ts` is doing
 * real work — a stale `DATABASE_URL` pointing at production is a normal
 * accident — and the fix for "I need demo data on a deployment" is a second
 * entry point with its own guard, not a flag that turns the first one off.
 *
 * What it builds: a kindergarten with enough shape to *look at*. Every screen
 * in this product renders an empty state until there are rows, and an empty
 * state is not something a client can evaluate. So: two groups, ten children
 * with guardians, observations in every review state, a term's assessments,
 * announcements — and then the Phase II/III modules, which are the reason this
 * file exists rather than the original 500-line script: attendance, meals and
 * the weekly menu, surveys with answers, growth measurements over a year,
 * milestones, allergies, medication, vaccination, incidents, consent, and the
 * funding rules and monthly calculations from `нэмэлт.md`.
 *
 * ★★ Two modules are deliberately absent: the **document library** (RFP §9) and
 * **artwork comparison** (§5.3). Both are rows that point at objects in R2, and
 * a `MediaFile` row whose `storageKey` names nothing gives a 404 on the first
 * click — worse to demonstrate than an empty state that says what to upload.
 * They need real uploads through the API, which is a person with files, not a
 * seed script.
 *
 * Idempotent by kindergarten: the caller checks for the name first and does
 * nothing if it is already there.
 */

import argon2 from "argon2";
import type { PrismaClient } from "../src/generated/prisma/client";

export const DEMO_KINDERGARTEN_NAME = "Бяцхан нүүдэлчид (жишээ)";

export interface DemoSeedOptions {
  /** The password every demo account gets. The caller decides where it came from. */
  password: string;
  /** Defaults to `DEMO_KINDERGARTEN_NAME`. */
  kindergartenName?: string;
  /**
   * Appended to every seeded username — `bagsh1` becomes `bagsh1-uzuulen`.
   *
   * ★ Required whenever a second kindergarten is seeded into a database that
   * already holds one, and the reason is the whole point of this option.
   *
   * `User.username` is globally unique; a kindergarten is per-run. Without a
   * suffix the second run finds the existing `bagsh1` and adds a **second
   * membership** to them, so one teacher ends up staffing two kindergartens.
   * That contradicts the product's own model — one teacher, one group — and it
   * breaks anything that resolves a single tenant from an actor, which is how
   * the teacher dashboard came to read the wrong kindergarten's weekly menu:
   * `useSession().primaryKindergartenId` takes the first membership, and the
   * first membership was the older kindergarten.
   *
   * Left unset the seeder keeps the plain names and **refuses** to attach an
   * existing account to a new kindergarten — see `makeUser`.
   */
  accountSuffix?: string;
}

export interface DemoSeedSummary {
  kindergartenId: string;
  kindergartenName: string;
  /**
   * What was appended to every username, so `printSummary` reports the
   * credentials that actually exist rather than the default ones.
   */
  accountSuffix: string;
  groups: number;
  children: number;
  observations: number;
  assessments: number;
  announcements: number;
  attendance: number;
  attendanceRequests: number;
  menuDays: number;
  mealRecords: number;
  surveys: number;
  surveyResponses: number;
  growthMeasurements: number;
  milestones: number;
  allergies: number;
  medications: number;
  vaccinations: number;
  incidents: number;
  consents: number;
  fundingRules: number;
  fundingCalculations: number;
}

/** The accounts the summary tells the reader to sign in with. */
export const DEMO_ACCOUNTS = [
  { username: "zahiral", role: "ADMIN", note: "Захирал — бүх модуль" },
  { username: "bagsh1", role: "TEACHER", note: "Багш — Дунд бүлэг" },
  { username: "bagsh2", role: "TEACHER", note: "Багш — Ахлах бүлэг" },
  { username: "etseg1", role: "PARENT", note: "Эцэг эх — хоёр хүүхэдтэй" },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Dates
//
// Everything is anchored to the day the script runs rather than to fixed
// literals, so a demo seeded in March does not open on an attendance sheet from
// last August. `day()` keeps every date at UTC midnight, which is what
// `@db.Date` stores and what the API compares against.
// ─────────────────────────────────────────────────────────────────────────────

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const iso = (d: Date) => d.toISOString().slice(0, 10);

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCMonth(out.getUTCMonth() + n);
  return out;
}

const isWeekday = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;

/** The weekdays in `[from, to]`, inclusive. */
function weekdaysBetween(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    if (isWeekday(d)) out.push(new Date(d));
  }
  return out;
}

/** The Monday of the week containing `d`. */
function mondayOf(d: Date): Date {
  const offset = (d.getUTCDay() + 6) % 7;
  return addDays(startOfUtcDay(d), -offset);
}

const firstOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

// ─────────────────────────────────────────────────────────────────────────────
// The people and the children
// ─────────────────────────────────────────────────────────────────────────────

/** Ten children, with names and birthdays that spread across the age bands. */
const CHILDREN = [
  { lastName: "Ганболд", firstName: "Батбаяр", sex: "MALE", dob: "2021-04-12" },
  { lastName: "Дорж", firstName: "Намуун", sex: "FEMALE", dob: "2021-06-30" },
  { lastName: "Энхбат", firstName: "Тэмүүлэн", sex: "MALE", dob: "2021-09-02" },
  { lastName: "Мөнхбаяр", firstName: "Сарнай", sex: "FEMALE", dob: "2021-11-19" },
  { lastName: "Батжаргал", firstName: "Ану", sex: "FEMALE", dob: "2022-01-25" },
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
    daysAgo: 8,
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
    daysAgo: 7,
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
    daysAgo: 6,
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
    daysAgo: 5,
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
    daysAgo: 3,
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
    daysAgo: 2,
    situation: "Гэрээс ирүүлсэн тэмдэглэл.",
    childDid: "Шинэ үг сурсан.",
    domains: ["language"],
    visibleToParents: true,
    reviewStatus: "PENDING",
    source: "PARENT",
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Meals — нэмэлт.md §2 and §12
//
// ★ One dish carries the allergen a child in this demo actually reacts to
// ("самар"), so the menu cross-check has something to find. A cross-check that
// never fires on demo data looks like a cross-check that does not work.
// ─────────────────────────────────────────────────────────────────────────────

const MENU_WEEK = [
  {
    dishes: [
      { name: "Сүүтэй цай, боов", allergenTags: ["сүү", "улаан буудай"] },
      { name: "Хуушуур, ногооны шөл", allergenTags: ["улаан буудай", "өндөг"] },
      { name: "Жимс, тараг", allergenTags: ["сүү"] },
    ],
  },
  {
    dishes: [
      { name: "Овъёосны будаа", allergenTags: ["сүү"] },
      { name: "Гурилтай шөл", allergenTags: ["улаан буудай"] },
      { name: "Алим, самрын зутан", allergenTags: ["самар"] },
    ],
  },
  {
    dishes: [
      { name: "Өндөгтэй талх", allergenTags: ["өндөг", "улаан буудай"] },
      { name: "Цуйван", allergenTags: ["улаан буудай"] },
      { name: "Жүрж, жигнэмэг", allergenTags: ["улаан буудай"] },
    ],
  },
  {
    dishes: [
      { name: "Сүүтэй будаа", allergenTags: ["сүү"] },
      { name: "Банштай шөл", allergenTags: ["улаан буудай"] },
      { name: "Кефир, хатаасан жимс", allergenTags: ["сүү"] },
    ],
  },
  {
    dishes: [
      { name: "Тарагтай мюсли", allergenTags: ["сүү", "самар"] },
      { name: "Ногоотой хуурга, цагаан будаа", allergenTags: [] },
      { name: "Жимсний зөөлөн", allergenTags: [] },
    ],
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// The builder
// ─────────────────────────────────────────────────────────────────────────────

export async function seedDemoKindergarten(
  prisma: PrismaClient,
  options: DemoSeedOptions,
): Promise<DemoSeedSummary> {
  const { password } = options;
  const kindergartenName = options.kindergartenName ?? DEMO_KINDERGARTEN_NAME;
  const suffix = options.accountSuffix ?? "";

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  /**
   * Finds or creates a demo account, and refuses to make it multi-tenant.
   *
   * ★ Reuse is correct *within* one seeding run — the parent of two children is
   * one account — and wrong *across* kindergartens.
   *
   * The check is deliberately loud rather than clever. It would be easy to
   * silently append a suffix here, but then two databases seeded by the same
   * command would hold different usernames and the printed credentials would
   * stop matching the documentation. An operator seeding a second kindergarten
   * has to say which accounts it gets.
   */
  async function makeUser(input: {
    username: string;
    lastName: string;
    firstName: string;
    email?: string;
    phone?: string;
  }) {
    const username = `${input.username}${suffix}`;

    const existing = await prisma.user.findUnique({
      where: { username },
      include: { memberships: { where: { deletedAt: null }, select: { kindergartenId: true } } },
    });

    if (existing) {
      const elsewhere = existing.memberships.some((m) => m.kindergartenId !== kg.id);
      if (elsewhere) {
        throw new Error(
          `"${username}" already staffs another kindergarten.\n` +
            "Seeding this one would give the account a second membership, and a teacher\n" +
            "who belongs to two kindergartens is not a case this product models — the\n" +
            "dashboard resolves a single tenant from the first membership.\n\n" +
            "Set an account suffix so this kindergarten gets its own accounts:\n" +
            "  SEED_SHOWCASE_ACCOUNT_SUFFIX=-uzuulen pnpm --filter @kinder/api seed:showcase\n" +
            "or drop the existing kindergarten first.",
        );
      }
      return existing;
    }

    return prisma.user.create({
      data: {
        username,
        lastName: input.lastName,
        firstName: input.firstName,
        email: input.email ?? null,
        phone: input.phone ?? null,
        passwordHash,
      },
    });
  }

  // The shared configuration rows, created by `seed.ts`. Without them there are
  // no domains to tag an observation with and no levels to assess against.
  const [domains, levels, types] = await Promise.all([
    prisma.developmentDomain.findMany({ where: { kindergartenId: null, deletedAt: null } }),
    prisma.assessmentLevel.findMany({ where: { kindergartenId: null, deletedAt: null } }),
    prisma.observationType.findMany({ where: { kindergartenId: null, deletedAt: null } }),
  ]);

  if (!domains.length || !levels.length || !types.length) {
    throw new Error("System configuration is missing. Run the `seed` script first.");
  }

  const domainByCode = new Map(domains.map((d) => [d.code, d]));
  const typeByCode = new Map(types.map((t) => [t.code, t]));

  const today = startOfUtcDay(new Date());
  const yearStart =
    day(`${today.getUTCFullYear()}-08-01`) <= today
      ? day(`${today.getUTCFullYear()}-08-01`)
      : day(`${today.getUTCFullYear() - 1}-08-01`);
  const yearEnd = addMonths(yearStart, 10);
  const yearName = `${yearStart.getUTCFullYear()}-${yearStart.getUTCFullYear() + 1}`;

  console.log("Creating demo kindergarten…");
  const kg = await prisma.kindergarten.create({
    data: {
      name: kindergartenName,
      address: "Улаанбаатар, Баянзүрх дүүрэг, 26-р хороо",
      phone: "+976 7000 0000",
      email: "demo@nomadkids.mn",
    },
  });

  const year = await prisma.schoolYear.create({
    data: {
      kindergartenId: kg.id,
      name: yearName,
      startsOn: yearStart,
      endsOn: yearEnd,
      isCurrent: true,
    },
  });

  const terms = await Promise.all(
    [
      { number: 1, name: "I улирал", startsOn: yearStart, endsOn: addMonths(yearStart, 4) },
      {
        number: 2,
        name: "II улирал",
        startsOn: addMonths(yearStart, 5),
        endsOn: addMonths(yearStart, 7),
      },
      {
        number: 3,
        name: "III улирал",
        startsOn: addMonths(yearStart, 7),
        endsOn: yearEnd,
      },
    ].map((t) =>
      prisma.term.create({
        data: {
          kindergartenId: kg.id,
          schoolYearId: year.id,
          number: t.number,
          name: t.name,
          startsOn: t.startsOn,
          endsOn: t.endsOn,
        },
      }),
    ),
  );

  const groups = await Promise.all(
    [
      /*
       * ★ Named the way a kindergarten names a group, not after its age band.
       *
       * These were "Дунд бүлэг" (JUNIOR) and "Ахлах бүлэг" (MIDDLE) — each
       * group's name was character-for-character the label of its own band, so
       * every screen that shows both showed the same two words twice: the
       * admin list printed them one column apart and it read as a bug.
       *
       * Real kindergartens name groups after flowers, animals or the sun; the
       * band is a separate fact about the same group, which is the distinction
       * a demo has to show for the two fields to look like two fields.
       */
      { name: "Дэлбээ бүлэг", ageBand: "JUNIOR" as const },
      { name: "Наран бүлэг", ageBand: "MIDDLE" as const },
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
  const children: {
    child: { id: string; lastName: string; firstName: string };
    enrollment: { id: string };
    group: { id: string };
    parent: { id: string };
  }[] = [];

  for (const [index, c] of CHILDREN.entries()) {
    const group = groups[index < 5 ? 0 : 1]!;

    const child = await prisma.child.create({
      data: {
        kindergartenId: kg.id,
        lastName: c.lastName,
        firstName: c.firstName,
        sex: c.sex,
        dateOfBirth: day(c.dob),
        healthNotes: index === 4 ? "Самар агуулсан хоол өгөхгүй. Харшлын бүртгэл харна уу." : null,
      },
    });

    const enrollment = await prisma.enrollment.create({
      data: {
        kindergartenId: kg.id,
        childId: child.id,
        groupId: group.id,
        schoolYearId: year.id,
        startedOn: yearStart,
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

    children.push({ child, enrollment, group, parent });
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
          observedOn: addDays(today, -seed.daysAgo),
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
  /*
   * ★ One of each category, so the board's filter row has something to filter.
   *
   * A demo where every notice is an ANNOUNCEMENT shows a chip row in which two
   * of the three chips return nothing — which reads as a broken filter rather
   * than as an honest empty result.
   */
  const announcements = [
    {
      title: "Намрын аялал",
      body: "Ирэх пүрэв гарагт Богд уулын дэнжид аялна. Дулаан хувцас, ус авчирна уу.",
      category: "ACTIVITY" as const,
      isImportant: true,
    },
    {
      title: "Эцэг эхийн хурал",
      body: "Улирлын үнэлгээний танилцуулга ирэх сарын 25-ны 18:00 цагт болно.",
      // ★ `EVENT`, not `TRAINING` — the latter is not a `NotificationCategory`
      // and never has been. `as const` on a string literal satisfies TypeScript
      // against the DTO's own union while telling Prisma nothing, so the whole
      // seed died at the announcement step with "Invalid value for argument
      // `category`" the first time it was run on a deployment (2026-09-01).
      category: "EVENT" as const,
      isImportant: false,
    },
    {
      title: "Гэрэл зургийн өдөр",
      body: "Хүүхдүүдийн хувийн хавтасны гэрэл зургийг дараагийн долоо хоногт авна.",
      category: "ANNOUNCEMENT" as const,
      isImportant: false,
    },
  ];

  for (const a of announcements) {
    const notification = await prisma.notification.create({
      data: {
        kindergartenId: kg.id,
        title: a.title,
        body: a.body,
        category: a.category,
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

  // ───────────────────────────────────────────────────────────────────────────
  // Attendance — нэмэлт.md §1
  //
  // Four weeks of weekdays ending yesterday. Today is left blank on purpose:
  // the teacher's day sheet is the screen staff open first, and it should have
  // something to do rather than a completed register.
  // ───────────────────────────────────────────────────────────────────────────

  console.log("Creating attendance…");
  const attendanceDays = weekdaysBetween(addDays(today, -28), addDays(today, -1)).filter(
    (d) => d >= yearStart,
  );

  /** Days each child was present in a given month, for the funding figures. */
  const attendedByChildMonth = new Map<string, number>();

  /**
   * What was recorded for each child on each day.
   *
   * ★ The meal register below reads this rather than recomputing the status
   * from the same formula. Two copies of "which days was this child away"
   * drift the moment either is edited, and the symptom would be a meal served
   * to an absent child — in a demo whose funding figures are supposed to
   * reconcile against the register.
   */
  const statusByChildDate = new Map<string, string>();

  let attendanceCount = 0;
  for (const [childIndex, { child, enrollment }] of children.entries()) {
    for (const [dayIndex, date] of attendanceDays.entries()) {
      // Deterministic rather than random: two runs of the seed produce the same
      // register, so a screenshot taken today still matches the data tomorrow.
      const slot = (childIndex * 7 + dayIndex * 3) % 20;
      const status =
        slot === 0
          ? "SICK"
          : slot === 5
            ? "EXCUSED"
            : slot === 11
              ? "HALF_DAY"
              : slot === 17
                ? "ABSENT"
                : // ★ The sixth status, нэмэлт.md §1. Rare, and present on
                  // purpose: it was dropped once already, and a demo that never
                  // shows it is how that goes unnoticed a second time.
                  slot === 13
                  ? "OTHER"
                  : "PRESENT";

      statusByChildDate.set(`${child.id}:${iso(date)}`, status);

      await prisma.attendance.create({
        data: {
          kindergartenId: kg.id,
          childId: child.id,
          enrollmentId: enrollment.id,
          date,
          status,
          note:
            status === "SICK"
              ? "Гэрээс мэдэгдсэн. Халуурсан."
              : status === "OTHER"
                ? "Эмнэлгийн үзлэгт явсан — өдрийн хагасаас хойш ирээгүй."
                : null,
          recordedById: childIndex < 5 ? teacherA.id : teacherB.id,
        },
      });
      attendanceCount += 1;

      if (status === "PRESENT" || status === "HALF_DAY") {
        const key = `${child.id}:${iso(firstOfMonth(date))}`;
        attendedByChildMonth.set(key, (attendedByChildMonth.get(key) ?? 0) + 1);
      }
    }
  }

  // One of each review state, so the request queue is not empty and the history
  // shows what a decided request looks like.
  console.log("Creating attendance requests…");
  const requestSeeds = [
    {
      childIndex: 0,
      from: addDays(today, 2),
      to: addDays(today, 3),
      requestedStatus: "EXCUSED" as const,
      reason: "Гэр бүлээрээ хөдөө явна.",
      reviewStatus: "PENDING" as const,
    },
    {
      childIndex: 3,
      from: addDays(today, 1),
      to: addDays(today, 1),
      requestedStatus: "SICK" as const,
      reason: "Эмнэлгийн үзлэгт орно.",
      reviewStatus: "PENDING" as const,
    },
    {
      childIndex: 6,
      from: addDays(today, -6),
      to: addDays(today, -5),
      requestedStatus: "EXCUSED" as const,
      reason: "Төрсөн өдрийн аялал.",
      reviewStatus: "APPROVED" as const,
    },
    {
      childIndex: 8,
      from: addDays(today, -9),
      to: addDays(today, -9),
      requestedStatus: "EXCUSED" as const,
      reason: "Хүсэлт хоцорч ирсэн.",
      reviewStatus: "REJECTED" as const,
    },
  ];

  for (const r of requestSeeds) {
    const entry = children[r.childIndex]!;
    await prisma.attendanceRequest.create({
      data: {
        kindergartenId: kg.id,
        childId: entry.child.id,
        enrollmentId: entry.enrollment.id,
        requestedById: entry.parent.id,
        dateFrom: r.from,
        dateTo: r.to,
        requestedStatus: r.requestedStatus,
        reason: r.reason,
        reviewStatus: r.reviewStatus,
        reviewedById: r.reviewStatus === "PENDING" ? null : teacherA.id,
        reviewedAt: r.reviewStatus === "PENDING" ? null : addDays(today, -4),
      },
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // The weekly menu and the meal register — нэмэлт.md §2, §12
  // ───────────────────────────────────────────────────────────────────────────

  console.log("Creating the menu and meal records…");
  const menuStart = addDays(mondayOf(today), -7); // last week, this week, next
  let menuDayCount = 0;
  for (let week = 0; week < 3; week += 1) {
    for (const [index, entry] of MENU_WEEK.entries()) {
      const date = addDays(menuStart, week * 7 + index);
      await prisma.menuDay.create({
        data: {
          kindergartenId: kg.id,
          date,
          dishes: entry.dishes as unknown as object,
          createdById: admin.id,
        },
      });
      menuDayCount += 1;
    }
  }

  const mealKinds = ["BREAKFAST", "LUNCH", "AFTERNOON_SNACK"] as const;
  /** Days each child ate, per month — §3's "хооллосон өдөр", the cost driver. */
  const fedByChildMonth = new Map<string, number>();

  let mealRecordCount = 0;

  // ★ One month's weekdays, not all four weeks of the register.
  //
  // The funding calculation below covers one month and counts days fed. If the
  // meal register stopped short of the month the attendance register covers,
  // "days fed" would come out lower than "days attended" for a reason that is
  // an artefact of the seed rather than anything visible on screen — and
  // reconciling those two numbers is the first thing anyone checks.
  //
  // Seeded on the 2nd of a month, "this month" is one weekday, so the whole
  // demo would open on an empty meal register and a funding figure of zero.
  // Then last month is the month with the data in it.
  const thisMonth = firstOfMonth(today);
  const daysThisMonth = attendanceDays.filter((d) => d >= thisMonth);
  const fundingMonth = daysThisMonth.length >= 5 ? thisMonth : firstOfMonth(addDays(thisMonth, -1));
  const mealDays = attendanceDays.filter(
    (d) => d >= fundingMonth && d < addMonths(fundingMonth, 1),
  );

  for (const [childIndex, { child, enrollment }] of children.entries()) {
    for (const [dayIndex, date] of mealDays.entries()) {
      // A child who was not there did not eat. Read from the register written
      // above rather than recomputing it — see `statusByChildDate`.
      const attendanceStatus = statusByChildDate.get(`${child.id}:${iso(date)}`);
      if (attendanceStatus !== "PRESENT" && attendanceStatus !== "HALF_DAY") continue;

      // ★ Attended, and ate nothing. This is нэмэлт.md §3's whole point made
      // visible: the food cost is driven by **хооллосон өдөр**, which is not
      // the same count as days attended. If every present child ate, the two
      // columns on the funding screen would be the same number twice and the
      // distinction the module is built on would be invisible.
      const broughtOwnFood = attendanceStatus === "HALF_DAY" && childIndex % 3 === 0;

      let ateSomething = false;
      for (const [kindIndex, kind] of mealKinds.entries()) {
        // A half day ends before the afternoon sitting.
        if (attendanceStatus === "HALF_DAY" && kind === "AFTERNOON_SNACK") continue;

        const slot = (childIndex + dayIndex + kindIndex) % 11;
        const status = broughtOwnFood
          ? "NOT_TAKEN"
          : slot === 4
            ? "PARTIAL"
            : slot === 9
              ? "NOT_TAKEN"
              : childIndex === 4 && kind === "LUNCH"
                ? "SPECIAL"
                : "TAKEN";

        await prisma.mealRecord.create({
          data: {
            kindergartenId: kg.id,
            childId: child.id,
            enrollmentId: enrollment.id,
            date,
            kind,
            status,
            note: broughtOwnFood
              ? "Гэрээсээ хоолтой ирсэн."
              : status === "SPECIAL"
                ? "Харшлын улмаас тусгай хоол."
                : null,
            recordedById: childIndex < 5 ? teacherA.id : teacherB.id,
          },
        });
        mealRecordCount += 1;
        if (status !== "NOT_TAKEN") ateSomething = true;
      }

      if (ateSomething) {
        const key = `${child.id}:${iso(firstOfMonth(date))}`;
        fedByChildMonth.set(key, (fedByChildMonth.get(key) ?? 0) + 1);
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Surveys — RFP Module 1
  // ───────────────────────────────────────────────────────────────────────────

  console.log("Creating surveys…");
  const survey = await prisma.survey.create({
    data: {
      kindergartenId: kg.id,
      title: "Эцэг эхийн сэтгэл ханамжийн судалгаа",
      description: "Хичээлийн жилийн эхний улирлын үйл ажиллагааны талаарх санал.",
      scope: "CHILD",
      status: "PUBLISHED",
      createdById: admin.id,
      publishedAt: addDays(today, -10),
    },
  });

  const questions = await Promise.all(
    [
      {
        order: 1,
        type: "RATING" as const,
        prompt: "Хүүхдийн дасан зохицолтод сэтгэл хангалуун уу?",
      },
      { order: 2, type: "YES_NO" as const, prompt: "Багштай харилцах боломж хангалттай байна уу?" },
      {
        order: 3,
        type: "CHECKBOX" as const,
        prompt: "Аль үйл ажиллагааг нэмэгдүүлэх нь зүйтэй вэ?",
        options: ["Хөгжим", "Спорт", "Урлан", "Гадаа тоглоом", "Гадаад хэл"],
      },
      { order: 4, type: "TEXT" as const, prompt: "Нэмэлт санал, хүсэлт." },
    ].map((q) =>
      prisma.surveyQuestion.create({
        data: {
          kindergartenId: kg.id,
          surveyId: survey.id,
          order: q.order,
          type: q.type,
          prompt: q.prompt,
          options: "options" in q ? (q.options as unknown as object) : undefined,
        },
      }),
    ),
  );

  const TEXT_ANSWERS = [
    "Багш нар маш анхааралтай ханддаг. Баярлалаа.",
    "Гадаа тоглох цагийг нэмэгдүүлбэл сайн байна.",
    "Хоолны цэсийг долоо хоног бүр урьдчилан харах боломжтой болсонд баяртай байна.",
    "Хөгжмийн хичээл хүүхдэд их таалагдаж байна.",
    "Ирцийн мэдээллийг утаснаас харах нь тохиромжтой.",
    "Зурган тайлан илүү олон байвал сайн.",
  ];

  let surveyResponseCount = 0;
  // Six of the ten families have answered: a survey with a 100% response rate
  // hides the "хариулаагүй" column the analytics screen exists to show.
  for (const [index, entry] of children.slice(0, 6).entries()) {
    const response = await prisma.surveyResponse.create({
      data: {
        kindergartenId: kg.id,
        surveyId: survey.id,
        childId: entry.child.id,
        respondentId: entry.parent.id,
        submittedAt: addDays(today, -(index + 1)),
      },
    });
    surveyResponseCount += 1;

    const answers: unknown[] = [
      3 + (index % 3), // RATING: 3, 4 or 5
      index % 4 !== 0, // YES_NO: mostly yes
      [["Спорт", "Хөгжим"], ["Урлан"], ["Гадаад хэл", "Гадаа тоглоом"]][index % 3],
      TEXT_ANSWERS[index % TEXT_ANSWERS.length],
    ];

    for (const [qIndex, question] of questions.entries()) {
      await prisma.surveyAnswer.create({
        data: {
          kindergartenId: kg.id,
          responseId: response.id,
          questionId: question.id,
          value: answers[qIndex] as object,
        },
      });
    }
  }

  // A draft, so the survey list shows more than one state.
  await prisma.survey.create({
    data: {
      kindergartenId: kg.id,
      title: "Хоолны цэсийн санал асуулга",
      description: "Хавар шинэчлэх цэсэд оруулах саналыг цуглуулна.",
      scope: "KINDERGARTEN",
      status: "DRAFT",
      createdById: admin.id,
    },
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Growth — RFP §7
  //
  // Six measurements two months apart, so the chart has a line rather than a
  // point and "өмнөх хэмжилттэй харьцуулах" has a previous measurement to use.
  // ───────────────────────────────────────────────────────────────────────────

  console.log("Creating growth measurements…");
  let growthCount = 0;
  for (const [childIndex, { child }] of children.entries()) {
    const baseHeight = 92 + (childIndex % 5) * 3;
    const baseWeight = 13.5 + (childIndex % 5) * 1.2;

    for (let step = 5; step >= 0; step -= 1) {
      const measuredOn = addDays(addMonths(today, -2 * step), -(childIndex % 5));
      await prisma.growthMeasurement.create({
        data: {
          kindergartenId: kg.id,
          childId: child.id,
          measuredOn,
          heightCm: (baseHeight + (5 - step) * 1.4).toFixed(1),
          weightKg: (baseWeight + (5 - step) * 0.55).toFixed(2),
          note: step === 0 ? "Улирлын үзлэг." : null,
          recordedById: teacherA.id,
        },
      });
      growthCount += 1;
    }

    // RFP §4.1's "Миний тухай" pair — the portfolio page's own height and
    // weight, which is a different question from the chart above.
    await prisma.childProfile.create({
      data: {
        kindergartenId: kg.id,
        childId: child.id,
        introduction: "Хөгжилтэй, найзуудтайгаа хамт тоглох дуртай.",
        dream: ["Нисгэгч", "Эмч", "Багш", "Малчин", "Инженер"][childIndex % 5],
        heightCm: (baseHeight + 7).toFixed(1),
        weightKg: (baseWeight + 2.75).toFixed(2),
        recordedOn: today,
      },
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Milestones — RFP §4.5
  // ───────────────────────────────────────────────────────────────────────────

  console.log("Creating milestones…");
  const MILESTONES = [
    {
      kind: "FIRST_DAY_AT_KINDERGARTEN",
      monthsAgo: 12,
      description: "Ээжийгээ үдээд өөрөө орсон.",
    },
    { kind: "DRESSED_ALONE", monthsAgo: 6, description: "Гутлаа өөрөө өмссөн." },
    {
      kind: "RECITED_A_POEM",
      monthsAgo: 2,
      description: "«Намрын өнгө» шүлгийг тайзан дээр уншсан.",
    },
    {
      kind: "CUSTOM",
      title: "Анх морь унасан",
      monthsAgo: 1,
      description: "Өвөөгийнхөө морийг ганцаараа унасан.",
    },
  ] as const;

  let milestoneCount = 0;
  for (const [childIndex, entry] of children.entries()) {
    for (const m of MILESTONES.slice(0, 2 + (childIndex % 3))) {
      await prisma.milestone.create({
        data: {
          kindergartenId: kg.id,
          childId: entry.child.id,
          kind: m.kind,
          title: "title" in m ? m.title : null,
          occurredOn: addMonths(today, -m.monthsAgo),
          description: m.description,
          recordedById: entry.parent.id,
        },
      });
      milestoneCount += 1;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Health — RFP Module 2
  // ───────────────────────────────────────────────────────────────────────────

  console.log("Creating health records…");
  const allergySeeds = [
    {
      childIndex: 4,
      kind: "FOOD" as const,
      severity: "SEVERE" as const,
      allergen: "самар",
      reaction: "Амьсгал давчдах, арьс улайх.",
      treatment: "Яаралтай тусламж дуудна. Эпинефрин хэрэглэнэ.",
    },
    {
      childIndex: 1,
      kind: "FOOD" as const,
      severity: "MODERATE" as const,
      allergen: "сүү",
      reaction: "Гэдэс өвдөх.",
      treatment: "Сүүгүй хувилбараар солино.",
    },
    {
      childIndex: 7,
      kind: "ENVIRONMENTAL" as const,
      severity: "MILD" as const,
      allergen: "цэцгийн тоос",
      reaction: "Найтаах, нүд загатнах.",
      treatment: "Хаврын улиралд гадаа тоглох цагийг богиносгоно.",
    },
  ];

  for (const a of allergySeeds) {
    await prisma.allergyRecord.create({
      data: {
        kindergartenId: kg.id,
        childId: children[a.childIndex]!.child.id,
        kind: a.kind,
        severity: a.severity,
        allergen: a.allergen,
        reaction: a.reaction,
        treatment: a.treatment,
        notedOn: addMonths(today, -8),
        recordedById: teacherA.id,
      },
    });
  }

  const medicationSeeds = [
    {
      childIndex: 2,
      medicineName: "Амоксициллин",
      dosage: "5 мл",
      timesOfDay: ["12:00", "16:30"],
      instructions: "Хоолны дараа өгнө.",
      startsOn: addDays(today, -2),
      endsOn: addDays(today, 4),
    },
    {
      childIndex: 6,
      medicineName: "Д аминдэм",
      dosage: "1 дусал",
      timesOfDay: ["09:00"],
      instructions: "Өглөөний цайны дараа.",
      startsOn: addDays(today, -20),
      endsOn: addDays(today, 40),
    },
  ];

  for (const m of medicationSeeds) {
    const entry = children[m.childIndex]!;
    await prisma.medicationAuthorisation.create({
      data: {
        kindergartenId: kg.id,
        childId: entry.child.id,
        medicineName: m.medicineName,
        dosage: m.dosage,
        timesOfDay: m.timesOfDay as unknown as object,
        instructions: m.instructions,
        startsOn: m.startsOn,
        endsOn: m.endsOn,
        authorisedById: entry.parent.id,
      },
    });
  }

  const VACCINES = [
    {
      vaccineName: "Улаанбурхан (MMR)",
      doseLabel: "2-р тун",
      monthsAgo: 14,
      provider: "Өрхийн эмнэлэг",
    },
    { vaccineName: "Гепатит В", doseLabel: "3-р тун", monthsAgo: 20, provider: "Өрхийн эмнэлэг" },
    { vaccineName: "А аминдэм", doseLabel: null, monthsAgo: 4, provider: "Цэцэрлэг дээр" },
  ];

  let vaccinationCount = 0;
  for (const [childIndex, entry] of children.entries()) {
    for (const v of VACCINES.slice(0, 2 + (childIndex % 2))) {
      await prisma.vaccinationRecord.create({
        data: {
          kindergartenId: kg.id,
          childId: entry.child.id,
          vaccineName: v.vaccineName,
          doseLabel: v.doseLabel,
          administeredOn: addMonths(today, -v.monthsAgo),
          provider: v.provider,
          recordedById: teacherA.id,
        },
      });
      vaccinationCount += 1;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Safety incidents — RFP Module 2.1
  //
  // One of the three is unreported on purpose: "recorded, family not yet told"
  // is the state the review screen exists to surface, and a demo where every
  // incident is closed never shows it.
  // ───────────────────────────────────────────────────────────────────────────

  console.log("Creating safety incidents…");
  const incidentSeeds = [
    {
      childIndex: 5,
      kind: "FALL" as const,
      hoursAgo: 26,
      location: "Тоглоомын талбай",
      bodyPart: "Өвдөг",
      description: "Гулсуураас буухдаа бүдэрч унав.",
      firstAid: "Шархыг угааж, ариутгав.",
      followUp: "Маргааш шалгана.",
      isHighPriority: false,
      reported: true,
    },
    {
      childIndex: 2,
      kind: "FEVER" as const,
      hoursAgo: 5,
      location: "Бүлгийн өрөө",
      bodyPart: null,
      description: "Үдийн унтлагын дараа 38.2 хэм халуурав.",
      firstAid: "Тусгаарлаж, эцэг эхэд залгав.",
      followUp: "Эмнэлгийн үзлэг санал болгов.",
      isHighPriority: true,
      reported: true,
    },
    {
      childIndex: 9,
      kind: "SCRATCH" as const,
      hoursAgo: 3,
      location: "Хоолны өрөө",
      bodyPart: "Гарын шуу",
      description: "Ширээний ирмэгт маажуулав.",
      firstAid: "Ариутгаж, наалт наав.",
      followUp: null,
      isHighPriority: false,
      reported: false,
    },
  ];

  for (const i of incidentSeeds) {
    const entry = children[i.childIndex]!;
    const occurredAt = new Date(Date.now() - i.hoursAgo * 3600 * 1000);

    let notificationId: string | null = null;
    if (i.reported) {
      const notification = await prisma.notification.create({
        data: {
          kindergartenId: kg.id,
          title: `Аюулгүй байдлын мэдэгдэл — ${entry.child.lastName} ${entry.child.firstName}`,
          body: `${i.description} ${i.firstAid ?? ""}`.trim(),
          // The same classification `IncidentsService.report` gives a real one.
          category: "ANNOUNCEMENT",
          isImportant: i.isHighPriority,
          status: "PUBLISHED",
          publishedAt: occurredAt,
          authorId: teacherA.id,
        },
      });
      await prisma.notificationTarget.create({
        data: {
          kindergartenId: kg.id,
          notificationId: notification.id,
          childId: entry.child.id,
        },
      });
      notificationId = notification.id;
    }

    await prisma.safetyIncident.create({
      data: {
        kindergartenId: kg.id,
        childId: entry.child.id,
        kind: i.kind,
        occurredAt,
        location: i.location,
        bodyPart: i.bodyPart,
        description: i.description,
        firstAid: i.firstAid,
        followUp: i.followUp,
        isHighPriority: i.isHighPriority,
        recordedById: teacherA.id,
        reportedAt: i.reported ? occurredAt : null,
        notificationId,
      },
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Consent — RFP §16
  //
  // One family has refused photo publishing. That is the case the whole feature
  // exists for, and the screens that hide a photo cannot be checked without it.
  // ───────────────────────────────────────────────────────────────────────────

  console.log("Creating consent records…");
  let consentCount = 0;
  for (const [childIndex, entry] of children.entries()) {
    await prisma.consentRecord.create({
      data: {
        kindergartenId: kg.id,
        childId: entry.child.id,
        kind: "DATA_PROCESSING",
        granted: true,
        decidedById: entry.parent.id,
        decidedAt: addMonths(today, -11),
        note: "Элсэлтийн гэрээтэй хамт баталгаажсан.",
      },
    });
    consentCount += 1;

    await prisma.consentRecord.create({
      data: {
        kindergartenId: kg.id,
        childId: entry.child.id,
        kind: "PHOTO_PUBLISHING",
        granted: childIndex !== 3,
        decidedById: entry.parent.id,
        decidedAt: addMonths(today, -11),
        note:
          childIndex === 3
            ? "Гэр бүл зөвшөөрөөгүй — зургийг зөвхөн эцэг эх өөрөө харна."
            : "Цэцэрлэгийн цахим хуудсанд нийтлэхийг зөвшөөрсөн.",
      },
    });
    consentCount += 1;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Funding — нэмэлт.md §3–§6
  //
  // ★ The calculations are computed from the attendance and meal rows created
  // above, not invented. A demo where the funding figure does not reconcile
  // with the register on the next screen is a demo of a bug.
  // ───────────────────────────────────────────────────────────────────────────

  console.log("Creating funding rules and calculations…");
  const rules = await Promise.all(
    [
      {
        name: "Улсын хоолны хөнгөлөлт",
        source: "STATE" as const,
        dailyRate: "3200.00",
        dependsOnAttendance: false,
        dependsOnMeals: true,
        note: "Хооллосон өдрөөр тооцно.",
      },
      {
        name: "Эцэг эхийн хоолны төлбөр",
        source: "PARENT" as const,
        dailyRate: "1500.00",
        dependsOnAttendance: false,
        dependsOnMeals: true,
        note: "Хооллосон өдрөөр тооцож, сар бүр нэхэмжилнэ.",
      },
      {
        name: "Цэцэрлэгийн сарын хураамж",
        source: "KINDERGARTEN" as const,
        monthlyRate: "45000.00",
        dependsOnAttendance: false,
        dependsOnMeals: false,
        note: "Ирцээс үл хамаарах тогтмол хураамж.",
      },
    ].map((r) =>
      prisma.fundingRule.create({
        data: {
          kindergartenId: kg.id,
          name: r.name,
          source: r.source,
          effectiveFrom: yearStart,
          dailyRate: "dailyRate" in r ? r.dailyRate : null,
          monthlyRate: "monthlyRate" in r ? r.monthlyRate : null,
          dependsOnAttendance: r.dependsOnAttendance,
          dependsOnMeals: r.dependsOnMeals,
          note: r.note,
        },
      }),
    ),
  );

  const stateRule = rules[0]!;
  const parentRule = rules[1]!;
  const month = firstOfMonth(today);
  const monthKeySuffix = iso(month);

  let fundingCalculationCount = 0;
  for (const [childIndex, entry] of children.entries()) {
    const daysAttended = attendedByChildMonth.get(`${entry.child.id}:${monthKeySuffix}`) ?? 0;
    const daysFed = fedByChildMonth.get(`${entry.child.id}:${monthKeySuffix}`) ?? 0;

    for (const rule of [stateRule, parentRule]) {
      const rate = Number(rule.dailyRate);
      const calculated = (daysFed * rate).toFixed(2);

      // A spread of states: the first four are approved, the first two also
      // received. §6's Draft → Approved → Paid, visible on one screen.
      const approved = childIndex < 4 ? calculated : null;
      const received = childIndex < 2 ? calculated : null;

      await prisma.fundingCalculation.create({
        data: {
          kindergartenId: kg.id,
          childId: entry.child.id,
          source: rule.source,
          month,
          daysAttended,
          daysFed,
          dailyRate: rule.dailyRate,
          fundingRuleId: rule.id,
          calculatedAmount: calculated,
          approvedAmount: approved,
          receivedAmount: received,
          note: received ? "Банкны хуулгаар баталгаажсан." : null,
        },
      });
      fundingCalculationCount += 1;
    }
  }

  return {
    kindergartenId: kg.id,
    kindergartenName,
    accountSuffix: suffix,
    groups: groups.length,
    children: children.length,
    observations: observationCount,
    assessments: assessmentCount,
    announcements: announcements.length,
    attendance: attendanceCount,
    attendanceRequests: requestSeeds.length,
    menuDays: menuDayCount,
    mealRecords: mealRecordCount,
    surveys: 2,
    surveyResponses: surveyResponseCount,
    growthMeasurements: growthCount,
    milestones: milestoneCount,
    allergies: allergySeeds.length,
    medications: medicationSeeds.length,
    vaccinations: vaccinationCount,
    incidents: incidentSeeds.length,
    consents: consentCount,
    fundingRules: rules.length,
    fundingCalculations: fundingCalculationCount,
  };
}

/** The lines both seed scripts print when they finish. */
export function printSummary(summary: DemoSeedSummary, password: string | null): void {
  console.log("\nDone.");
  console.log(`  kindergarten        : ${summary.kindergartenName}`);
  console.log(`  groups              : ${summary.groups}`);
  console.log(`  children            : ${summary.children}`);
  console.log(`  observations        : ${summary.observations}`);
  console.log(`  assessments         : ${summary.assessments}`);
  console.log(`  announcements       : ${summary.announcements}`);
  console.log(`  attendance          : ${summary.attendance}`);
  console.log(`  attendance requests : ${summary.attendanceRequests}`);
  console.log(`  menu days           : ${summary.menuDays}`);
  console.log(`  meal records        : ${summary.mealRecords}`);
  console.log(`  surveys / responses : ${summary.surveys} / ${summary.surveyResponses}`);
  console.log(`  growth measurements : ${summary.growthMeasurements}`);
  console.log(`  milestones          : ${summary.milestones}`);
  console.log(`  allergies           : ${summary.allergies}`);
  console.log(`  medications         : ${summary.medications}`);
  console.log(`  vaccinations        : ${summary.vaccinations}`);
  console.log(`  safety incidents    : ${summary.incidents}`);
  console.log(`  consent records     : ${summary.consents}`);
  console.log(`  funding rules       : ${summary.fundingRules}`);
  console.log(`  funding calculations: ${summary.fundingCalculations}`);

  console.log("\n  Accounts:");
  // The suffix is part of the username that exists, so it is part of what is
  // printed. Reporting `bagsh1` for an account created as `bagsh1-uzuulen` is
  // how an operator ends up certain the seed failed.
  for (const a of DEMO_ACCOUNTS) {
    const username = `${a.username}${summary.accountSuffix}`;
    console.log(`    ${username.padEnd(18)} ${a.role.padEnd(8)} ${a.note}`);
  }
  if (password) {
    console.log(`\n  Password: ${password}`);
  } else {
    console.log("\n  Password: the one you passed in SEED_DEMO_PASSWORD.");
  }
}

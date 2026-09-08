/**
 * The demo content `demo-data.ts` did not reach.
 *
 * ★ Why a second file rather than more of the first. `demo-data.ts` builds a
 * kindergarten from nothing and its sections depend on each other in order —
 * children need groups, assessments need terms. These sections depend only on
 * *ids that already exist*, which makes them runnable against a database that
 * was seeded months ago. Folding them into `demo-data.ts` would have made them
 * reachable only by wiping and re-seeding, and a demo database is exactly the
 * one nobody wants to wipe.
 *
 * ★★ Idempotent per section, not per run. Each block asks "does this
 * kindergarten already have any?" and returns if so. That is deliberately
 * coarser than checking each row: a half-filled section means somebody has been
 * editing it by hand, and topping it up behind their back is worse than
 * leaving it.
 *
 * ★★★ **Documents and artwork comparisons are absent on purpose.** Both are
 * rows that point at a `MediaFile`, and `demo-data.ts` explains why a seed must
 * not invent one: a `storageKey` naming an object that was never uploaded gives
 * a 404 on the first click, which demonstrates worse than an empty state that
 * says what to upload. They need real files through the API.
 *
 * Run standalone:
 *   KINDERGARTEN_ID=… pnpm --filter @kinder/api exec tsx prisma/seed-demo-extras.ts
 */

import type { PrismaClient } from "../src/generated/prisma/client";

/** Money is a string all the way to Prisma — never a float. `invoice-math.ts`. */
type Money = string;

/**
 * Two decimal places, always.
 *
 * ★ The amounts here are whole tugriks chosen by hand, so ordinary arithmetic
 * is exact for every one of them — but a seed that emits `"346000"` where the
 * column is `Decimal(12,2)` teaches the next person that money strings are
 * casual. `invoice-math.ts` is the real rule; this keeps the seed from
 * contradicting it in passing.
 */
const money = (value: number): Money => value.toFixed(2);

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** The last `count` weekdays, oldest first. A kindergarten does not run weekends. */
function recentWeekdays(count: number, from = startOfUtcDay(new Date())): Date[] {
  const days: Date[] = [];
  let cursor = from;
  while (days.length < count) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(cursor);
    cursor = addDays(cursor, -1);
  }
  return days.reverse();
}

const firstOfMonth = (date: Date, monthsBack = 0) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - monthsBack, 1));

export async function seedDemoExtras(prisma: PrismaClient, kindergartenId: string): Promise<void> {
  const [groups, children, staff, terms, ingredients, notifications, categories] =
    await Promise.all([
      prisma.group.findMany({
        where: { kindergartenId, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.child.findMany({
        where: { kindergartenId, deletedAt: null },
        select: { id: true, lastName: true, firstName: true },
        orderBy: { lastName: "asc" },
      }),
      prisma.membership.findMany({
        // `isActive`, not a `revokedAt` — a revoked membership is deactivated.
        where: { kindergartenId, deletedAt: null, isActive: true },
        select: { userId: true, role: true, user: { select: { lastName: true, firstName: true } } },
      }),
      prisma.term.findMany({
        where: { kindergartenId, deletedAt: null },
        select: { id: true, name: true, number: true },
        orderBy: { number: "asc" },
      }),
      prisma.ingredient.findMany({
        where: { kindergartenId, deletedAt: null },
        select: { id: true, name: true, unit: true },
        orderBy: { name: "asc" },
      }),
      prisma.notification.findMany({
        where: { kindergartenId, deletedAt: null },
        select: { id: true },
        take: 4,
      }),
      prisma.specialNeedsCategory.findMany({ select: { id: true, name: true }, take: 3 }),
    ]);

  if (groups.length === 0 || children.length === 0) {
    console.log("  no groups or children — run seed:demo first");
    return;
  }

  const teacher = staff.find((m) => m.role === "TEACHER");
  const admin = staff.find((m) => m.role === "ADMIN");
  const cook = staff.find((m) => m.role === "COOK");
  const accountant = staff.find((m) => m.role === "ACCOUNTANT");
  const actorId = admin?.userId ?? teacher?.userId ?? null;

  await seedSuppliersAndOrders(prisma, kindergartenId, ingredients, actorId);
  await seedStockMovements(prisma, kindergartenId, ingredients, actorId);
  await seedMealServings(prisma, kindergartenId, groups, cook?.userId ?? actorId);
  await seedAttendanceSubmissions(prisma, kindergartenId, groups, teacher?.userId ?? actorId);
  await seedInvoices(prisma, kindergartenId, children, accountant?.userId ?? actorId);
  await seedStaffRecords(prisma, kindergartenId, staff, actorId);
  await seedSpecialNeeds(prisma, kindergartenId, children, categories, actorId);
  await seedTermReports(prisma, kindergartenId, children, terms, teacher?.userId ?? actorId);
  await seedAgeProfiles(prisma, kindergartenId, children);
  await seedBirthdayNotes(prisma, kindergartenId, children);
  await seedNotificationReactions(prisma, kindergartenId, notifications, staff);
}

/* ── Гал тогоо: нийлүүлэгч ба захиалга ─────────────────────────────────────── */

async function seedSuppliersAndOrders(
  prisma: PrismaClient,
  kindergartenId: string,
  ingredients: { id: string; name: string }[],
  createdById: string | null,
) {
  if ((await prisma.supplier.count({ where: { kindergartenId } })) > 0) {
    console.log("  suppliers: already there");
    return;
  }

  const suppliers = await Promise.all(
    [
      {
        name: "Идэвх Трейд ХХК",
        registrationNumber: "2712345",
        contactPerson: "Б.Ганбат",
        contactPhone: "+976 9911 2233",
        address: "Улаанбаатар, ХУД, 3-р хороо",
        originNote: "Мах, махан бүтээгдэхүүн",
      },
      {
        name: "Ногоон талбай ХХК",
        registrationNumber: "2798765",
        contactPerson: "С.Оюунчимэг",
        contactPhone: "+976 9944 5566",
        address: "Улаанбаатар, БЗД, 12-р хороо",
        originNote: "Хүнсний ногоо, жимс",
      },
      {
        name: "Сүү Проду ХХК",
        registrationNumber: "2755443",
        contactPerson: "Д.Мөнхбат",
        contactPhone: "+976 9977 8899",
        address: "Төв аймаг, Батсүмбэр сум",
        originNote: "Сүү, сүүн бүтээгдэхүүн",
      },
    ].map((data) => prisma.supplier.create({ data: { kindergartenId, ...data } })),
  );

  const today = startOfUtcDay(new Date());
  /*
   * Three orders in three states, because the screen's whole shape is the
   * status filter: one delivered, one placed and waiting, one still a draft.
   * A demo with three RECEIVED orders shows a list, not a workflow.
   */
  const plans: { supplier: number; daysAgo: number; status: "RECEIVED" | "ORDERED" | "DRAFT" }[] = [
    { supplier: 0, daysAgo: 6, status: "RECEIVED" },
    { supplier: 1, daysAgo: 2, status: "ORDERED" },
    { supplier: 2, daysAgo: 0, status: "DRAFT" },
  ];

  for (const [index, plan] of plans.entries()) {
    const lines = ingredients.slice(index * 3, index * 3 + 3);
    if (lines.length === 0) continue;

    await prisma.foodOrder.create({
      data: {
        kindergartenId,
        supplierId: suppliers[plan.supplier]!.id,
        orderDate: addDays(today, -plan.daysAgo),
        status: plan.status,
        note: plan.status === "DRAFT" ? "Ирэх долоо хоногийн захиалга" : null,
        createdById,
        lines: {
          create: lines.map((ingredient, line) => {
            const quantity = String(5 + line * 2);
            const unitPrice = String(4500 + line * 1200);
            return {
              ingredientId: ingredient.id,
              quantity,
              unitPrice,
              totalPrice: String(Number(quantity) * Number(unitPrice)),
              receivedQuantity: plan.status === "RECEIVED" ? quantity : null,
            };
          }),
        },
      },
    });
  }
  console.log(`  suppliers: 3, food orders: ${plans.length}`);
}

/* ── Зарцуулалт ───────────────────────────────────────────────────────────── */

async function seedStockMovements(
  prisma: PrismaClient,
  kindergartenId: string,
  ingredients: { id: string; name: string }[],
  createdById: string | null,
) {
  if ((await prisma.stockMovement.count({ where: { kindergartenId } })) > 0) {
    console.log("  stock movements: already there");
    return;
  }
  if (ingredients.length === 0) return;

  const days = recentWeekdays(10);
  const rows: {
    kindergartenId: string;
    ingredientId: string;
    date: Date;
    direction: "IN" | "OUT";
    quantity: Money;
    sourceType: "PURCHASE" | "CONSUMPTION";
    note: string | null;
    createdById: string | null;
  }[] = [];

  for (const ingredient of ingredients.slice(0, 8)) {
    // One delivery, then daily draw-down — the shape a stock chart needs.
    rows.push({
      kindergartenId,
      ingredientId: ingredient.id,
      date: days[0]!,
      direction: "IN",
      quantity: "40.00",
      sourceType: "PURCHASE",
      note: "Долоо хоногийн нийлүүлэлт",
      createdById,
    });
    for (const date of days.slice(1)) {
      rows.push({
        kindergartenId,
        ingredientId: ingredient.id,
        date,
        direction: "OUT",
        quantity: "3.50",
        sourceType: "CONSUMPTION",
        note: null,
        createdById,
      });
    }
  }

  await prisma.stockMovement.createMany({ data: rows });
  console.log(`  stock movements: ${rows.length}`);
}

/* ── Хоол тараалт ─────────────────────────────────────────────────────────── */

async function seedMealServings(
  prisma: PrismaClient,
  kindergartenId: string,
  groups: { id: string }[],
  servedById: string | null,
) {
  if ((await prisma.mealServing.count({ where: { kindergartenId } })) > 0) {
    console.log("  meal servings: already there");
    return;
  }

  const kinds = ["BREAKFAST", "MID_MORNING_SNACK", "LUNCH", "AFTERNOON_SNACK"] as const;
  const rows = recentWeekdays(10).flatMap((date) =>
    groups.flatMap((group) =>
      kinds.map((kind) => ({ kindergartenId, groupId: group.id, date, kind, servedById })),
    ),
  );

  await prisma.mealServing.createMany({ data: rows, skipDuplicates: true });
  console.log(`  meal servings: ${rows.length}`);
}

/* ── Ирцийн баталгаажуулалт ───────────────────────────────────────────────── */

async function seedAttendanceSubmissions(
  prisma: PrismaClient,
  kindergartenId: string,
  groups: { id: string }[],
  submittedById: string | null,
) {
  if (!submittedById) return;
  if ((await prisma.attendanceSubmission.count({ where: { kindergartenId } })) > 0) {
    console.log("  attendance submissions: already there");
    return;
  }

  const rows = [];
  for (const date of recentWeekdays(10)) {
    for (const group of groups) {
      /*
       * `Attendance`, mapped to `attendance_records` — the table and model
       * names differ, and the delegate follows the model. It carries no
       * `groupId` of its own: a child's group is a fact about their
       * enrollment, so the count reaches it through that relation rather than
       * through a column that would have to be kept in step with transfers.
       */
      const childCount = await prisma.attendance.count({
        where: { kindergartenId, date, enrollment: { groupId: group.id } },
      });
      if (childCount > 0) {
        rows.push({ kindergartenId, groupId: group.id, date, submittedById, childCount });
      }
    }
  }
  if (rows.length > 0) await prisma.attendanceSubmission.createMany({ data: rows });
  console.log(`  attendance submissions: ${rows.length}`);
}

/* ── Нэхэмжлэл, төлбөр ────────────────────────────────────────────────────── */

async function seedInvoices(
  prisma: PrismaClient,
  kindergartenId: string,
  children: { id: string }[],
  recordedById: string | null,
) {
  if ((await prisma.invoice.count({ where: { kindergartenId } })) > 0) {
    console.log("  invoices: already there");
    return;
  }

  const today = startOfUtcDay(new Date());
  const months = [firstOfMonth(today, 1), firstOfMonth(today, 0)];
  let sequence = 1;
  let created = 0;

  for (const [monthIndex, month] of months.entries()) {
    const isPastMonth = monthIndex === 0;

    for (const [childIndex, child] of children.entries()) {
      const baseAmount = money(250_000);
      const mealAmount = money(96_000);
      // Every fifth child on a discount, so the column is not uniformly zero.
      const discountAmount = money(childIndex % 5 === 0 ? 30_000 : 0);
      const totalDue = money(Number(baseAmount) + Number(mealAmount) - Number(discountAmount));

      /*
       * Last month is mostly settled, this month mostly is not — which is what
       * makes the dashboard's "төлөгдөөгүй үлдэгдэл" a number worth looking at
       * rather than 0 or the whole ledger.
       */
      const paidInFull = isPastMonth && childIndex % 4 !== 0;
      const partial = isPastMonth && childIndex % 4 === 0 && childIndex % 8 !== 0;
      const paidAmount = paidInFull ? totalDue : partial ? money(150_000) : money(0);
      const balance = money(Number(totalDue) - Number(paidAmount));
      const status = paidInFull
        ? ("PAID" as const)
        : partial
          ? ("PARTIALLY_PAID" as const)
          : isPastMonth
            ? ("OVERDUE" as const)
            : ("UNPAID" as const);

      const invoice = await prisma.invoice.create({
        data: {
          kindergartenId,
          childId: child.id,
          month,
          number: `INV-${month.getUTCFullYear()}${String(month.getUTCMonth() + 1).padStart(2, "0")}-${String(sequence++).padStart(4, "0")}`,
          baseAmount,
          mealAmount,
          extraAmount: "0.00",
          discountAmount,
          previousBalance: "0.00",
          totalDue,
          paidAmount,
          balance,
          dueDate: new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 25)),
          status,
          lineItems: {
            create: [
              { type: "TUITION" as const, description: "Сургалтын төлбөр", amount: baseAmount },
              { type: "MEAL" as const, description: "Хоолны мөнгө", amount: mealAmount },
              ...(Number(discountAmount) === 0
                ? []
                : [
                    {
                      type: "OTHER" as const,
                      description: "Ах дүүгийн хөнгөлөлт",
                      amount: money(-Number(discountAmount)),
                    },
                  ]),
            ],
          },
        },
      });
      created += 1;

      if (Number(paidAmount) > 0) {
        await prisma.payment.create({
          data: {
            kindergartenId,
            invoiceId: invoice.id,
            amount: paidAmount,
            method: childIndex % 2 === 0 ? "BANK_TRANSFER" : "CASH",
            recordedById,
            note: partial ? "Хэсэгчлэн төлсөн" : null,
          },
        });
      }
    }
  }
  console.log(`  invoices: ${created} (+ line items and payments)`);
}

/* ── Ажилтны хувийн хэрэг — А/261 #51 ─────────────────────────────────────── */

async function seedStaffRecords(
  prisma: PrismaClient,
  kindergartenId: string,
  staff: { userId: string; role: string }[],
  createdById: string | null,
) {
  if ((await prisma.staffRecord.count({ where: { kindergartenId } })) > 0) {
    console.log("  staff records: already there");
    return;
  }

  const employed = staff.filter((m) => m.role !== "PARENT");
  const rows = employed.flatMap((member) => [
    {
      kindergartenId,
      userId: member.userId,
      kind: "QUALIFICATION" as const,
      title: member.role === "TEACHER" ? "Бакалавр — сургуулийн өмнөх боловсрол" : "Бакалавр",
      issuer: "МУБИС",
      documentNo: "БД-2014-3312",
      startedOn: day("2014-06-20"),
      endedOn: null,
      createdById,
    },
    {
      kindergartenId,
      userId: member.userId,
      kind: "CERTIFICATE" as const,
      title: "Хүүхэд хамгааллын сургалт",
      issuer: "БМДИ",
      documentNo: "ГЭР-2025-0918",
      startedOn: day("2025-09-18"),
      endedOn: day("2028-09-18"),
      createdById,
    },
    {
      kindergartenId,
      userId: member.userId,
      kind: "EXPERIENCE" as const,
      title: "Бяцхан нүүдэлчид цэцэрлэг — багш",
      issuer: null,
      documentNo: null,
      note: "Одоог хүртэл",
      startedOn: day("2021-09-01"),
      endedOn: null,
      createdById,
    },
  ]);

  await prisma.staffRecord.createMany({ data: rows });
  console.log(`  staff records: ${rows.length}`);
}

/* ── Онцгой хэрэгцээ ──────────────────────────────────────────────────────── */

async function seedSpecialNeeds(
  prisma: PrismaClient,
  kindergartenId: string,
  children: { id: string }[],
  categories: { id: string }[],
  recordedById: string | null,
) {
  if (categories.length === 0) return;
  if ((await prisma.specialNeedRecord.count({ where: { kindergartenId } })) > 0) {
    console.log("  special need records: already there");
    return;
  }

  await prisma.specialNeedRecord.createMany({
    data: [
      {
        kindergartenId,
        childId: children[2]!.id,
        categoryId: categories[0]!.id,
        note: "Ярианы хөгжилд дэмжлэг шаардлагатай. Логопедын хичээлд долоо хоногт 2 удаа хамрагдана.",
        documentNo: "ОХ-2026-014",
        assessedOn: day("2026-03-11"),
        recordedById,
      },
      {
        kindergartenId,
        childId: children[6]!.id,
        categoryId: categories[Math.min(1, categories.length - 1)]!.id,
        note: "Сонсголын багатай бэрхшээл. Урд эгнээнд суулгах, чанга дуугаар давтаж хэлэх.",
        documentNo: "ОХ-2026-021",
        assessedOn: day("2026-05-04"),
        recordedById,
      },
    ],
  });
  console.log("  special need records: 2");
}

/* ── Улирлын тайлан ───────────────────────────────────────────────────────── */

async function seedTermReports(
  prisma: PrismaClient,
  kindergartenId: string,
  children: { id: string }[],
  terms: { id: string; number: number }[],
  authorId: string | null,
) {
  if (terms.length === 0) return;
  if ((await prisma.termReport.count({ where: { kindergartenId } })) > 0) {
    console.log("  term reports: already there");
    return;
  }

  const term = terms[0]!;
  const enrollments = await prisma.enrollment.findMany({
    where: { kindergartenId, deletedAt: null, status: "ACTIVE" },
    select: { id: true, childId: true },
  });

  const rows = enrollments.map((enrollment, index) => ({
    kindergartenId,
    childId: enrollment.childId,
    enrollmentId: enrollment.id,
    termId: term.id,
    strengths:
      "Найзуудтайгаа эвтэй тоглодог, шинэ зүйл сурахдаа идэвхтэй. Хөдөлгөөнт тоглоомд дуртай.",
    needsSupport: "Анхаарлаа удаан төвлөрүүлэхэд дэмжлэг хэрэгтэй.",
    nextGoals: "10 хүртэл тоолох, өөрийн нэрийг бичих дасгал.",
    adviceForParents: "Гэртээ өдөрт 15 минут хамт ном уншиж, ярилцаж байхыг зөвлөж байна.",
    // A quarter left in draft: the screen's "ноорог / эцэслэсэн" filter needs both.
    status: index % 4 === 0 ? ("DRAFT" as const) : ("FINAL" as const),
    authorId,
    finalizedAt: index % 4 === 0 ? null : new Date(),
  }));

  if (rows.length > 0) await prisma.termReport.createMany({ data: rows });
  console.log(`  term reports: ${rows.length}`);
}

/* ── Насны танилцуулга ────────────────────────────────────────────────────── */

async function seedAgeProfiles(
  prisma: PrismaClient,
  kindergartenId: string,
  children: { id: string }[],
) {
  if ((await prisma.childAgeProfile.count({ where: { kindergartenId } })) > 0) {
    console.log("  child age profiles: already there");
    return;
  }

  const palette = ["Улаан", "Цэнхэр", "Ногоон", "Шар", "Ягаан"];
  const foods = ["Бууз", "Цуйван", "Гурилтай шөл", "Алим", "Зайрмаг"];
  const toys = ["Лего", "Бөмбөг", "Тоглоомон машин", "Хүүхэлдэй", "Тоглоомон галт тэрэг"];

  const rows = children.map((child, index) => ({
    kindergartenId,
    childId: child.id,
    age: 4 + (index % 2),
    favoriteColor: palette[index % palette.length]!,
    favoriteFood: foods[index % foods.length]!,
    favoriteToy: toys[index % toys.length]!,
    favoriteBook: "Алтан загасны үлгэр",
    favoriteSong: "Ээжийн дуу",
    favoriteActivity: "Зурах, будах",
    personality: "Нээлттэй, найрсаг, сониуч",
    emotionalTraits: "Бусдыг өрөвддөг, уурлахдаа хурдан тайвширдаг",
    familyMembers: "Ээж, аав, ах",
    learningInterest: "Амьтад, байгаль",
    newSkills: "Хайчаар тайрах, өөрөө хувцаслах",
    parentNote: "Гэртээ өдөр бүр зурдаг.",
    teacherNote: "Бүлгийн үйл ажиллагаанд идэвхтэй оролцдог.",
  }));

  await prisma.childAgeProfile.createMany({ data: rows, skipDuplicates: true });
  console.log(`  child age profiles: ${rows.length}`);
}

/* ── Төрсөн өдрийн тэмдэглэл ──────────────────────────────────────────────── */

async function seedBirthdayNotes(
  prisma: PrismaClient,
  kindergartenId: string,
  children: { id: string }[],
) {
  if ((await prisma.birthdayNote.count({ where: { kindergartenId } })) > 0) {
    console.log("  birthday notes: already there");
    return;
  }

  const rows = children.slice(0, 5).map((child, index) => ({
    kindergartenId,
    childId: child.id,
    age: 4 + (index % 2),
    note: "Бүлгээрээ төрсөн өдрийг тэмдэглэж, дуу дуулж, гэрэл зураг авлаа.",
  }));

  await prisma.birthdayNote.createMany({ data: rows, skipDuplicates: true });
  console.log(`  birthday notes: ${rows.length}`);
}

/* ── Мэдэгдлийн хариу үйлдэл ──────────────────────────────────────────────── */

async function seedNotificationReactions(
  prisma: PrismaClient,
  kindergartenId: string,
  notifications: { id: string }[],
  staff: { userId: string; role: string }[],
) {
  if (notifications.length === 0) return;
  if ((await prisma.notificationReaction.count({ where: { kindergartenId } })) > 0) {
    console.log("  notification reactions: already there");
    return;
  }

  const parents = staff.filter((m) => m.role === "PARENT").slice(0, 4);
  const rows = notifications.flatMap((notification) =>
    parents.map((parent) => ({
      kindergartenId,
      notificationId: notification.id,
      userId: parent.userId,
    })),
  );

  if (rows.length > 0) {
    await prisma.notificationReaction.createMany({ data: rows, skipDuplicates: true });
  }
  console.log(`  notification reactions: ${rows.length}`);
}

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { MealKind, MealStatus } from "../domain/enums";

/** The weekly menu — RFP §989. Kindergarten-wide, one row per day. */
@Injectable()
export class MealsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findInRange(kindergartenId: string, from: Date, to: Date) {
    return this.prisma.menuDay.findMany({
      where: { kindergartenId, deletedAt: null, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
    });
  }

  /** The day's approval/consumption state, for `saveDay`'s guard — cheaper
   * than fetching the whole row when only these three fields are needed. */
  async findDayState(kindergartenId: string, date: Date) {
    return this.prisma.menuDay.findFirst({
      where: { kindergartenId, date, deletedAt: null },
      select: { id: true, status: true, consumedAt: true },
    });
  }

  /** The whole day — `approveDay` and `consumeDay` need `dishes` too. */
  async findDay(kindergartenId: string, date: Date) {
    return this.prisma.menuDay.findFirst({ where: { kindergartenId, date, deletedAt: null } });
  }

  /**
   * Create-or-update, keyed by the `(kindergartenId, date)` uniqueness.
   *
   * ★ A save always writes `status: DRAFT` and clears the approval.
   *
   * Approving a day is a deliberate second act (`approveDay`) — a plan that
   * has just been edited is, by definition, not the plan somebody signed off
   * on, whether it was DRAFT already or APPROVED a moment ago.
   */
  async upsertDay(
    kindergartenId: string,
    date: Date,
    dishes: unknown,
    totalCalories: number | null,
    createdById: string,
  ) {
    return this.prisma.menuDay.upsert({
      where: { kindergartenId_date: { kindergartenId, date } },
      create: { kindergartenId, date, dishes: dishes as object, totalCalories, createdById },
      update: {
        dishes: dishes as object,
        totalCalories,
        createdById,
        status: "DRAFT",
        approvedById: null,
        approvedAt: null,
      },
    });
  }

  /** Signs a day off — `POST .../approve`. */
  async approveDay(id: string, approvedById: string) {
    return this.prisma.menuDay.update({
      where: { id },
      data: { status: "APPROVED", approvedById, approvedAt: new Date() },
    });
  }

  // ── The meal register — нэмэлт.md §2 ───────────────────────────────────────

  /**
   * A group's sitting for one day: everyone enrolled, plus whatever is marked.
   *
   * ★ The roster comes from `Enrollment`, not from the meal rows.
   *
   * A child nobody has marked yet must appear as *unmarked* rather than be
   * absent from the list — that is the whole point of a register, and the same
   * shape `AttendanceRepository.groupDaySheet` uses.
   */
  async groupMealSheet(groupId: string, date: Date, kind: MealKind) {
    const [enrollments, records] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { groupId, status: "ACTIVE", deletedAt: null },
        select: {
          id: true,
          childId: true,
          child: { select: { id: true, lastName: true, firstName: true } },
        },
      }),
      this.prisma.mealRecord.findMany({
        where: { deletedAt: null, date, kind, enrollment: { groupId, deletedAt: null } },
      }),
    ]);

    return { enrollments, records };
  }

  /**
   * Writes a whole sitting at once — §2's "нэг дэлгэцээс хурдан бүртгэх".
   *
   * ★ One transaction, and create-or-update per row rather than `upsert()`.
   *
   * The unique index is **partial**, so Prisma's `upsert` cannot see that a
   * soft-deleted row leaves the sitting free — the same correction `Attendance`
   * needed. The transaction is what makes a dropped connection leave either the
   * whole sitting recorded or none of it, rather than the first eleven children
   * of twenty.
   */
  async recordGroupMeals(
    rows: {
      kindergartenId: string;
      childId: string;
      enrollmentId: string;
      date: Date;
      kind: MealKind;
      status: MealStatus;
      note: string | null;
      recordedById: string;
    }[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const saved = [];

      for (const row of rows) {
        const existing = await tx.mealRecord.findFirst({
          where: {
            enrollmentId: row.enrollmentId,
            date: row.date,
            kind: row.kind,
            deletedAt: null,
          },
          select: { id: true },
        });

        saved.push(
          existing
            ? await tx.mealRecord.update({
                where: { id: existing.id },
                data: { status: row.status, note: row.note, recordedById: row.recordedById },
              })
            : await tx.mealRecord.create({ data: row }),
        );
      }

      return saved;
    });
  }

  /**
   * How many days a child actually ate, per sitting — нэмэлт.md §3.
   *
   * ★ This is the number a food-cost calculation multiplies, and it is why
   * `MealRecord` exists apart from `Attendance`: §3 computes from **хооллосон
   * өдөр**, not from days attended. A child present on a half day, or collected
   * before lunch, attended and did not eat.
   *
   * `PARTIAL` and `SPECIAL` are counted separately rather than folded into
   * `TAKEN`: a tariff may price them differently, and a repository that had
   * already merged them could not tell anyone how many there were.
   */
  async monthlyMealCounts(childId: string, from: Date, to: Date) {
    const [rows, fedDates] = await Promise.all([
      // The per-(kind, status) breakdown, unchanged: §6 reports it, and a
      // tariff that prices PARTIAL differently would read it.
      this.prisma.mealRecord.groupBy({
        by: ["kind", "status"],
        where: { childId, deletedAt: null, date: { gte: from, lte: to } },
        _count: { _all: true },
      }),
      /*
       * ★ Fed days, counted as distinct dates — not as rows.
       *
       * A separate query rather than a derivation from `rows` above, because
       * that breakdown has already collapsed the dates away: three sittings on
       * one day and one sitting on three days are indistinguishable in it.
       * Summing it was the original defect, and it is not recoverable from
       * that shape at all.
       *
       * Grouping by `date` yields one group per date carrying at least one
       * qualifying row, which is the definition of "хооллосон өдөр".
       */
      this.prisma.mealRecord.groupBy({
        by: ["date"],
        where: {
          childId,
          deletedAt: null,
          date: { gte: from, lte: to },
          // Same statuses as before — the unit changed, the meanings did not.
          status: { in: ["TAKEN", "PARTIAL", "SPECIAL"] },
        },
      }),
    ]);

    return {
      counts: rows.map((row) => ({ kind: row.kind, status: row.status, count: row._count._all })),
      daysFed: fedDates.length,
    };
  }

  /** The group a register is being written for, with its tenant. */
  async findGroupForMeals(groupId: string, kindergartenIds: string[]) {
    return this.prisma.group.findFirst({
      where: { id: groupId, deletedAt: null, kindergartenId: { in: kindergartenIds } },
      select: { id: true, kindergartenId: true },
    });
  }

  /** The kindergarten's name, for the exported workbook's Тайлбар sheet. */
  async kindergartenName(kindergartenId: string) {
    const row = await this.prisma.kindergarten.findFirst({
      where: { id: kindergartenId, deletedAt: null },
      select: { name: true },
    });
    return row?.name ?? "";
  }
}

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

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

  /** Create-or-update, keyed by the `(kindergartenId, date)` uniqueness. */
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
      update: { dishes: dishes as object, totalCalories, createdById },
    });
  }
}

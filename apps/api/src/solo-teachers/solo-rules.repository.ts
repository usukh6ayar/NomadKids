import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SoloRulesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The kind of a live kindergarten; `null` if there is none. */
  async kindOf(kindergartenId: string) {
    const row = await this.prisma.kindergarten.findFirst({
      where: { id: kindergartenId, deletedAt: null },
      select: { kind: true },
    });
    return row?.kind ?? null;
  }

  /** School years not archived and not yet over on `today`. */
  countOpenSchoolYears(kindergartenId: string, today: Date) {
    return this.prisma.schoolYear.count({
      where: { kindergartenId, deletedAt: null, endsOn: { gte: today } },
    });
  }

  countLiveGroups(kindergartenId: string, schoolYearId: string) {
    return this.prisma.group.count({ where: { kindergartenId, schoolYearId, deletedAt: null } });
  }
}

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

  countLiveGroups(kindergartenId: string, schoolYearId: string) {
    return this.prisma.group.count({ where: { kindergartenId, schoolYearId, deletedAt: null } });
  }
}

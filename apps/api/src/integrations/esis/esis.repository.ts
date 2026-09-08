import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { Prisma } from "../../generated/prisma/client";

@Injectable()
export class EsisRepository {
  constructor(private readonly prisma: PrismaService) {}

  findKindergarten(id: string) {
    return this.prisma.kindergarten.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        esisInstitutionId: true,
        esisEnvironment: true,
        esisMappedAt: true,
      },
    });
  }

  findUserIdentity(userId: string) {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { lastName: true, firstName: true, email: true },
    });
  }

  updateMapping(
    id: string,
    mapping:
      | { esisInstitutionId: null; esisEnvironment: null; esisMappedAt: null }
      | {
          esisInstitutionId: string;
          esisEnvironment: "TEST" | "PRODUCTION";
          esisMappedAt: Date;
        },
  ) {
    return this.prisma.kindergarten.update({
      where: { id },
      data: mapping,
      select: {
        id: true,
        esisInstitutionId: true,
        esisEnvironment: true,
        esisMappedAt: true,
      },
    });
  }

  findRunning(kindergartenId: string) {
    return this.prisma.esisSyncRun.findFirst({
      where: { kindergartenId, status: "RUNNING" },
      select: { id: true, startedAt: true },
    });
  }

  expireStaleRuns(kindergartenId: string, cutoff: Date) {
    return this.prisma.esisSyncRun.updateMany({
      where: { kindergartenId, status: "RUNNING", startedAt: { lt: cutoff } },
      data: {
        status: "FAILED",
        errorCode: "STALE_RUN_RECOVERED",
        finishedAt: new Date(),
      },
    });
  }

  createRun(kindergartenId: string, initiatedById: string, resources: string[]) {
    return this.prisma.esisSyncRun.create({
      data: { kindergartenId, initiatedById, resources },
      select: { id: true, status: true, startedAt: true },
    });
  }

  finishRun(
    id: string,
    data: {
      status: "SUCCEEDED" | "PARTIAL" | "FAILED";
      summary: Prisma.InputJsonValue;
      errorCode?: string | null;
    },
  ) {
    return this.prisma.esisSyncRun.update({
      where: { id },
      data: { ...data, finishedAt: new Date() },
    });
  }

  listRecentRuns(kindergartenId: string) {
    return this.prisma.esisSyncRun.findMany({
      where: { kindergartenId },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: {
        id: true,
        status: true,
        resources: true,
        summary: true,
        errorCode: true,
        startedAt: true,
        finishedAt: true,
        initiatedBy: { select: { firstName: true, lastName: true } },
      },
    });
  }
}

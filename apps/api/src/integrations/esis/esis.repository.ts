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

  /**
   * The child an ESIS `personId` refers to, within one kindergarten.
   *
   * ★ This is an **authorization** lookup, so it deliberately does not filter
   * on `status` or anything else a screen might care about: a child who has
   * left is still a child whose record has an owner, and narrowing here would
   * quietly turn "you may not see this" into "this does not exist" for a
   * teacher who legitimately kept the record.
   *
   * ★★ `deletedAt: null` stays, per CLAUDE.md §2.2 — the base filter every
   * repository query carries. A soft-deleted child is not reachable by any
   * route, and an ESIS read must not be the exception that resurrects one.
   */
  findChildIdByEsisPersonId(kindergartenId: string, esisPersonId: string) {
    return this.prisma.child.findFirst({
      where: { kindergartenId, esisPersonId, deletedAt: null },
      select: { id: true },
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

  /**
   * Swaps one kindergarten's stored roster for the list ESIS just returned.
   *
   * ★ Delete-then-insert inside one transaction, so a reader never sees a
   * half-written roster and a failed refresh leaves the previous one intact.
   * A registration attempt landing mid-refresh must match against a complete
   * list or an old one, never a partial one.
   *
   * ★★ Hard delete. CLAUDE.md §3.2 protects records somebody may need to read
   * back; a superseded copy of somebody else's list is not one, and keeping
   * them would leave a person who has left the kindergarten able to register.
   * `AuditLog` records that the refresh happened and who ran it.
   */
  replaceStaffRoster(
    kindergartenId: string,
    rows: {
      esisPersonId: string;
      registerNumber: string;
      lastName: string;
      firstName: string;
      jobCode: string | null;
      positionName: string | null;
      isInstructor: boolean;
    }[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.esisStaffRoster.deleteMany({ where: { kindergartenId } });
      if (rows.length === 0) return 0;
      const created = await tx.esisStaffRoster.createMany({
        data: rows.map((row) => ({ ...row, kindergartenId })),
      });
      return created.count;
    });
  }

  /**
   * The stored roster row for one kindergarten's register number, if any.
   *
   * ★ This is the only ESIS-derived read `POST /v1/staff-registration`
   * (`StaffRegistrationService`) is allowed to make — it is a public route
   * and must never call ESIS itself (design §1.1, plan §0). The compound
   * unique index (`kindergartenId`, `registerNumber`) is what makes this an
   * equality lookup rather than a scan, which only works because
   * `registerNumber` is stored normalised — see `normalizeRegisterNumber`.
   */
  findRosterEntryByRegisterNumber(kindergartenId: string, registerNumber: string) {
    return this.prisma.esisStaffRoster.findUnique({
      where: { kindergartenId_registerNumber: { kindergartenId, registerNumber } },
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

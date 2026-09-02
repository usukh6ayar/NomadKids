import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Applications and contracts — CLAUDE.md §2.2's only Prisma layer for them.
 *
 * ★ **No `kindergartenId` base filter here, and it is not an oversight.**
 *
 * §3.1's tenant scope applies to tenant-scoped tables. An application exists
 * *before* the kindergarten does — that is the entire point of the table — so
 * there is no tenant to scope it to. What protects it instead is that nothing
 * outside `PlatformAccessService` may read it: every read below is reached only
 * through a controller that has already called `assertSuperAdmin`.
 *
 * `deletedAt: null` is still applied everywhere, as §3.2 requires.
 */
@Injectable()
export class OnboardingRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly live = { deletedAt: null };

  private readonly contractSelect = {
    id: true,
    number: true,
    version: true,
    status: true,
    pdfMediaFileId: true,
  } as const;

  private readonly applicationSelect = {
    id: true,
    kindergartenName: true,
    registrationNumber: true,
    address: true,
    directorName: true,
    phone: true,
    email: true,
    childCount: true,
    note: true,
    status: true,
    reviewedAt: true,
    reviewNote: true,
    kindergartenId: true,
    createdAt: true,
    contract: { select: this.contractSelect },
  } as const;

  async createApplication(data: {
    kindergartenName: string;
    registrationNumber: string;
    address: string;
    directorName: string;
    phone: string;
    email: string;
    childCount: number;
    note: string | null;
  }) {
    return this.prisma.kindergartenApplication.create({
      data,
      select: { id: true, status: true },
    });
  }

  /**
   * Whether a live application already exists for this registration number.
   *
   * ★ Used to decide what to *store*, never what to *answer* — the public
   * endpoint returns the same shape either way. See `OnboardingService.submit`.
   */
  async findLiveByRegistration(registrationNumber: string) {
    return this.prisma.kindergartenApplication.findFirst({
      where: { ...this.live, registrationNumber },
      select: { id: true, status: true },
    });
  }

  async findApplication(id: string) {
    return this.prisma.kindergartenApplication.findFirst({
      where: { ...this.live, id },
      select: this.applicationSelect,
    });
  }

  async listApplications(params: { status?: string; page: number; pageSize: number }) {
    const where: Prisma.KindergartenApplicationWhereInput = {
      ...this.live,
      ...(params.status
        ? { status: params.status as Prisma.EnumKindergartenApplicationStatusFilter["equals"] }
        : {}),
    };

    // §3.4 — paginated, always. An onboarding queue is small today and is the
    // kind of table that is small until the day it is not.
    const [items, total] = await Promise.all([
      this.prisma.kindergartenApplication.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        select: this.applicationSelect,
      }),
      this.prisma.kindergartenApplication.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * The approval, as one transaction: a tenant, the application's new state and
   * the contract.
   *
   * ★★★ All three or none. A `Kindergarten` without its `Contract` is a tenant
   * nobody agreed to; a `Contract` without its `Kindergarten` points at nothing.
   * The intermediate state is not one any screen should ever be able to read.
   *
   * ★ The PDF job is **not** enqueued here — CLAUDE.md §3.5. The caller does it
   * after this resolves, or the worker would start before the rows are visible.
   */
  async approve(params: {
    applicationId: string;
    reviewedById: string;
    reviewNote: string | null;
    kindergartenName: string;
    number: string;
    childCount: number;
    annualFee: string;
    perChildMonthlyFee: string;
    startsOn: Date;
    endsOn: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const kindergarten = await tx.kindergarten.create({
        data: { name: params.kindergartenName, isActive: true },
        select: { id: true },
      });

      await tx.kindergartenApplication.update({
        where: { id: params.applicationId },
        data: {
          status: "APPROVED",
          reviewedById: params.reviewedById,
          reviewedAt: new Date(),
          reviewNote: params.reviewNote,
          kindergartenId: kindergarten.id,
        },
      });

      const contract = await tx.contract.create({
        data: {
          applicationId: params.applicationId,
          kindergartenId: kindergarten.id,
          number: params.number,
          childCount: params.childCount,
          annualFee: params.annualFee,
          perChildMonthlyFee: params.perChildMonthlyFee,
          startsOn: params.startsOn,
          endsOn: params.endsOn,
        },
        select: { id: true, number: true },
      });

      return { kindergartenId: kindergarten.id, contract };
    });
  }

  async reject(params: { applicationId: string; reviewedById: string; reviewNote: string }) {
    return this.prisma.kindergartenApplication.update({
      where: { id: params.applicationId },
      data: {
        status: "REJECTED",
        reviewedById: params.reviewedById,
        reviewedAt: new Date(),
        reviewNote: params.reviewNote,
      },
      select: { id: true, status: true },
    });
  }

  /**
   * The highest contract number issued in a year.
   *
   * ★ `deletedAt` is deliberately **not** filtered. A number that was issued is
   * spent, even if the contract was later withdrawn — reusing it would put two
   * different agreements under one reference. `invoice-math.ts`'s
   * `lastInvoiceNumber` omits the filter for exactly this reason.
   */
  async lastContractNumber(prefix: string) {
    const row = await this.prisma.contract.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    return row?.number ?? null;
  }

  async setContractPdf(contractId: string, mediaFileId: string) {
    await this.prisma.contract.update({
      where: { id: contractId },
      data: { pdfMediaFileId: mediaFileId },
    });
  }

  async findContract(id: string) {
    return this.prisma.contract.findFirst({
      where: { ...this.live, id },
      include: { application: { select: this.applicationSelect } },
    });
  }
}

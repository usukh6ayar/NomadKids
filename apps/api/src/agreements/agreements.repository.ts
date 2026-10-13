import { Injectable } from "@nestjs/common";
import type { AgreementKindValue } from "@kinder/contracts";
import { PrismaService } from "../prisma/prisma.service";

/**
 * `AgreementAcceptance` — append-only (schema). `append()` and reads; there is
 * deliberately no update and no delete here.
 */
@Injectable()
export class AgreementsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records an acceptance, or returns the one already recorded: a second POST
   * for the same version keeps the first `acceptedAt`, which is the moment
   * that matters.
   */
  async append(row: {
    userId: string;
    kind: AgreementKindValue;
    version: string;
    ipAddress: string | null;
    userAgent: string | null;
  }) {
    const existing = await this.prisma.agreementAcceptance.findUnique({
      where: { userId_kind_version: { userId: row.userId, kind: row.kind, version: row.version } },
    });
    if (existing) return { row: existing, created: false };
    try {
      return { row: await this.prisma.agreementAcceptance.create({ data: row }), created: true };
    } catch (error) {
      // Two tabs accepting at once: the loser reads the winner's row.
      const raced = await this.prisma.agreementAcceptance.findUnique({
        where: {
          userId_kind_version: { userId: row.userId, kind: row.kind, version: row.version },
        },
      });
      if (raced) return { row: raced, created: false };
      throw error;
    }
  }

  forUser(userId: string) {
    return this.prisma.agreementAcceptance.findMany({
      where: { userId },
      select: { kind: true, version: true, acceptedAt: true },
      orderBy: { acceptedAt: "asc" },
    });
  }

  list(
    filter: { kind?: AgreementKindValue; version?: string },
    page: { skip: number; take: number },
  ) {
    const where = {
      ...(filter.kind ? { kind: filter.kind } : {}),
      ...(filter.version ? { version: filter.version } : {}),
    };
    return this.prisma.$transaction([
      this.prisma.agreementAcceptance.findMany({
        where,
        select: {
          id: true,
          kind: true,
          version: true,
          acceptedAt: true,
          user: { select: { id: true, username: true, lastName: true, firstName: true } },
        },
        orderBy: { acceptedAt: "desc" },
        ...page,
      }),
      this.prisma.agreementAcceptance.count({ where }),
    ]);
  }
}

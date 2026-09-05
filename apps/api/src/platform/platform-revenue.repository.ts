import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * The platform operator's view of money — CLAUDE.md §2.2's only Prisma layer
 * for it.
 *
 * ★ Every read here is an **aggregate**. There is no method that returns a
 * funding row, and that is the boundary rather than a coincidence:
 * `platform-access.service.ts` records that a superadmin registers
 * kindergartens and does not read children, and a `FundingCalculation` carries
 * a child's id, how many days they attended and what they were billed. A
 * `groupBy` over kindergartens answers "what came in" without ever selecting
 * `childId`, so the boundary is enforced by the query rather than by a caller
 * remembering to strip a field.
 */
@Injectable()
export class PlatformRevenueRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One month's totals, per kindergarten.
   *
   * Two queries rather than one join: `groupBy` cannot select a related row's
   * name, and fetching every kindergarten's name once is cheaper than the
   * alternative of a raw query nobody can typecheck. The names come from a
   * separate `findMany` and are matched in the service.
   */
  async monthByKindergarten(month: Date) {
    const rows = await this.prisma.fundingCalculation.groupBy({
      by: ["kindergartenId"],
      where: { month, deletedAt: null },
      _sum: { calculatedAmount: true, approvedAmount: true, receivedAmount: true },
      _count: { _all: true },
    });

    /*
      ★ Decimals become strings here, not in the service.

      `funding.repository.ts` has always done this, and §2.2's import rule is
      why it is the right place: a `Prisma.Decimal` crossing into a service
      would need the Prisma import that the rule refuses. `common/money.ts` is
      what a service does with the strings.
    */
    return rows.map((row) => ({
      kindergartenId: row.kindergartenId,
      entries: row._count._all,
      calculated: row._sum.calculatedAmount?.toString() ?? "0",
      approved: row._sum.approvedAmount?.toString() ?? "0",
      received: row._sum.receivedAmount?.toString() ?? "0",
    }));
  }

  /**
   * The platform's **own** income for a month — paid portal access fees, per
   * kindergarten.
   *
   * ★★★ This is the money a revenue share is actually a share of, and until
   * 2026-09-02 nothing on the platform side read it. `monthByKindergarten`
   * above returns state funding paid *to* the kindergartens, and
   * `distribution` was dividing that. See `platformRevenueSchema` in the
   * contracts for the full correction.
   *
   * ★ Filtered on **`paidAt`, not `status`.** A subscription is `ACTIVE` while
   * its school year runs and `EXPIRED` afterwards, so a status filter would
   * make last year's income disappear from last year's report the moment the
   * year turned over. The fact being counted is "money arrived on this date",
   * and `paidAt` is the only column that records it.
   *
   * ★★ `AccessSubscription`, not `QpayInvoice`. CLAUDE.md §7 §8: a pending
   * `QpayInvoice` is an attempt, not a settled fact — a QR nobody scanned is
   * not money that moved. The subscription is what becomes paid, so it is the
   * ledger. `QpayInvoice` stays the audit trail of how it was paid.
   */
  async accessFeesByKindergarten(from: Date, to: Date) {
    const rows = await this.prisma.accessSubscription.groupBy({
      by: ["kindergartenId"],
      where: { deletedAt: null, paidAt: { gte: from, lte: to } },
      _sum: { amount: true },
      _count: { _all: true },
    });

    // Decimals become strings here, for the same §2.2 reason as above.
    return rows.map((row) => ({
      kindergartenId: row.kindergartenId,
      accessPayments: row._count._all,
      accessFees: row._sum.amount?.toString() ?? "0",
    }));
  }

  /** Names for the ids the aggregate returned. Never the whole table. */
  async kindergartenNames(ids: string[]) {
    if (ids.length === 0) return [];

    return this.prisma.kindergarten.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
  }

  /**
   * The shares in force on a date.
   *
   * ★ `effectiveFrom <= date` and either no end or an end on or after it —
   * the same window `FundingRule` uses. A share closed mid-month still applies
   * to the month it was closed in, which is the honest reading of an agreement
   * that ran for part of it; splitting a month pro rata is a decision for
   * whoever signs the agreements, not for this query.
   */
  async partnersInForce(on: Date) {
    const rows = await this.prisma.revenuePartner.findMany({
      where: {
        deletedAt: null,
        effectiveFrom: { lte: on },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
      },
      orderBy: [{ sharePercent: "desc" }, { name: "asc" }],
    });
    return rows.map(toPartnerRow);
  }

  /** Every partner, current and closed — the management list. */
  async listPartners() {
    const rows = await this.prisma.revenuePartner.findMany({
      where: { deletedAt: null },
      orderBy: [{ effectiveTo: "asc" }, { sharePercent: "desc" }, { name: "asc" }],
    });
    return rows.map(toPartnerRow);
  }

  async findPartner(id: string) {
    const row = await this.prisma.revenuePartner.findFirst({ where: { id, deletedAt: null } });
    return row ? toPartnerRow(row) : null;
  }

  async createPartner(data: {
    name: string;
    sharePercent: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    note: string | null;
  }) {
    // The decimal string is handed to Prisma verbatim — it accepts one for a
    // `Decimal` column, which is the whole reason money never becomes a float.
    return toPartnerRow(await this.prisma.revenuePartner.create({ data }));
  }

  async updatePartner(
    id: string,
    data: { name?: string; effectiveTo?: Date | null; note?: string | null },
  ) {
    return toPartnerRow(await this.prisma.revenuePartner.update({ where: { id }, data }));
  }

  /** Soft delete — §3.2. An agreement that existed is part of the record. */
  async removePartner(id: string) {
    await this.prisma.revenuePartner.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}

/** One partner, with its decimal and dates already strings. */
function toPartnerRow(row: {
  id: string;
  name: string;
  sharePercent: { toString(): string };
  effectiveFrom: Date;
  effectiveTo: Date | null;
  note: string | null;
}) {
  return {
    id: row.id,
    name: row.name,
    sharePercent: row.sharePercent.toString(),
    effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString().slice(0, 10) : null,
    note: row.note,
  };
}

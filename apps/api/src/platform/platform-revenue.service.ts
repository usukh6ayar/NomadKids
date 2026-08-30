import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  PlatformRevenue,
  RevenueDistribution,
  RevenuePartner as RevenuePartnerDto,
} from "@kinder/contracts";
import { formatMoney, parseMoney, percentOf, sumMoney } from "../common/money";
import type { Actor } from "../authz/actor";
import { PlatformAccessService } from "../authz/platform-access.service";
import { AuditRepository } from "../audit/audit.repository";
import { PlatformRevenueRepository } from "./platform-revenue.repository";
import type { CreatePartnerDto, UpdatePartnerDto } from "./platform-revenue.dto";

/** `2026-08` → the first of that month, and the last day, both as dates. */
function monthBounds(month: string): { first: Date; last: Date } {
  const [year, mon] = month.split("-").map(Number);
  return {
    first: new Date(Date.UTC(year!, mon! - 1, 1)),
    // Day 0 of the next month is the last day of this one.
    last: new Date(Date.UTC(year!, mon!, 0)),
  };
}

/**
 * The platform operator's income, and how it is divided.
 *
 * ★ Superadmin only, and that is the whole reason this lives beside
 * `PlatformController` rather than in `FundingModule`.
 *
 * `/kindergartens/:id/funding` is `@Roles("ADMIN")` and answers one
 * kindergarten's question: what are we owed, per child. A superadmin holds no
 * kindergarten membership (§1.1), so those endpoints correctly refuse them.
 * This answers a different question — what came in across every kindergarten —
 * and it is the platform's own, in the same register as `/platform/stats`.
 *
 * ★★ **Aggregates only.** No method here returns a funding row. See the
 * repository, where the boundary is enforced by the shape of the query.
 */
@Injectable()
export class PlatformRevenueService {
  constructor(
    private readonly platform: PlatformAccessService,
    private readonly repo: PlatformRevenueRepository,
    private readonly audit: AuditRepository,
  ) {}

  /** What each kindergarten produced in a month, and the sum. */
  async monthRevenue(actor: Actor, month: string): Promise<PlatformRevenue> {
    this.platform.assertSuperAdmin(actor);

    const { first } = monthBounds(month);
    const rows = await this.repo.monthByKindergarten(first);
    const names = new Map(
      (await this.repo.kindergartenNames(rows.map((r) => r.kindergartenId))).map((k) => [
        k.id,
        k.name,
      ]),
    );

    const kindergartens = rows
      .map((row) => ({ ...row, name: names.get(row.kindergartenId) ?? "—" }))
      /*
        Most received first: the operator's question is "who paid", and a list
        ordered by id answers nothing. Compared as scaled integers rather than
        with `Number(a.received)` — the sort is the one place a float would be
        harmless, and using two different notions of "how much" in one file is
        how the harmless one ends up somewhere it is not.
      */
      .sort(
        (a, b) => parseMoney(b.received) - parseMoney(a.received) || a.name.localeCompare(b.name),
      );

    return {
      month,
      kindergartens,
      totals: {
        calculated: formatMoney(sumMoney(rows.map((r) => r.calculated))),
        approved: formatMoney(sumMoney(rows.map((r) => r.approved))),
        received: formatMoney(sumMoney(rows.map((r) => r.received))),
      },
    };
  }

  /**
   * The month's received income, divided by the shares in force.
   *
   * ★ From **received**, never calculated or approved. A share of money that
   * has not arrived is a promise, and paying it out is the platform lending
   * its own cash against a state transfer that can still be revised.
   *
   * ★★ Rounded to two decimals per partner, and the remainder is reported
   * rather than absorbed. 33.33% of 1,000,000 three ways leaves ₮1 that belongs
   * to nobody; hiding it inside the largest share would make the figures stop
   * adding up for whoever checks them against a bank statement.
   */
  async distribution(actor: Actor, month: string): Promise<RevenueDistribution> {
    this.platform.assertSuperAdmin(actor);

    const { first, last } = monthBounds(month);
    const [rows, partners] = await Promise.all([
      this.repo.monthByKindergarten(first),
      this.repo.partnersInForce(last),
    ]);

    const received = sumMoney(rows.map((row) => row.received));
    const allocated = sumMoney(partners.map((p) => p.sharePercent));

    const shares = partners.map((partner) => ({
      partnerId: partner.id,
      name: partner.name,
      sharePercent: partner.sharePercent,
      amount: formatMoney(percentOf(received, partner.sharePercent)),
    }));

    /*
      Summed back from what each partner is actually paid, not from the
      percentages. Three shares of 33.33% each round down, and the ₮1 that
      leaves over belongs to nobody — deriving the remainder from the rounded
      amounts is what makes it appear rather than vanish into the arithmetic.
    */
    const paidOut = sumMoney(shares.map((share) => share.amount));

    return {
      month,
      received: formatMoney(received),
      allocatedPercent: formatPercent(allocated),
      unallocated: formatMoney(received - paidOut),
      shares,
    };
  }

  async listPartners(actor: Actor): Promise<RevenuePartnerDto[]> {
    this.platform.assertSuperAdmin(actor);
    return await this.repo.listPartners();
  }

  /**
   * Adds a share.
   *
   * ★ Refuses to take the active total past 100%.
   *
   * The alternative — accept it and show a warning — is how a distribution
   * screen ends up paying out 115% of a month. The check reads the shares in
   * force on the new one's start date, so closing one share and opening a
   * larger one on the same day works.
   */
  async createPartner(actor: Actor, dto: CreatePartnerDto): Promise<RevenuePartnerDto> {
    this.platform.assertSuperAdmin(actor);

    const from = new Date(`${dto.effectiveFrom}T00:00:00.000Z`);
    const existing = await this.repo.partnersInForce(from);
    const allocated = sumMoney(existing.map((p) => p.sharePercent));
    const total = allocated + parseMoney(dto.sharePercent);

    // 100% scaled by 100 — see `common/money.ts` for why percentages ride the
    // same integer representation money does.
    if (total > 10_000) {
      throw new BadRequestException(
        `Хувь нийлбэр 100%-иас хэтэрч байна (${formatPercent(total)}%). ` +
          `Одоогийн хуваарилалт ${formatPercent(allocated)}%.`,
      );
    }

    const created = await this.repo.createPartner({
      name: dto.name,
      sharePercent: dto.sharePercent,
      effectiveFrom: from,
      effectiveTo: dto.effectiveTo ? new Date(`${dto.effectiveTo}T00:00:00.000Z`) : null,
      note: dto.note ?? null,
    });

    await this.audit.append({
      action: "CREATE",
      objectType: "RevenuePartner",
      objectId: created.id,
      actorUserId: actor.userId,
      metadata: { name: created.name, sharePercent: created.sharePercent },
    });

    return created;
  }

  /**
   * Closes or renames a share. **The percentage is not editable** — see the
   * model's own note: a month's distribution is evidence of the split it was
   * paid under, and editing the percentage rewrites what already went out. A
   * new agreement is a new row starting where the old one ends.
   */
  async updatePartner(actor: Actor, id: string, dto: UpdatePartnerDto): Promise<RevenuePartnerDto> {
    this.platform.assertSuperAdmin(actor);

    const existing = await this.repo.findPartner(id);
    if (!existing) throw new NotFoundException();

    const updated = await this.repo.updatePartner(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.note !== undefined ? { note: dto.note } : {}),
      ...(dto.effectiveTo !== undefined
        ? { effectiveTo: dto.effectiveTo ? new Date(`${dto.effectiveTo}T00:00:00.000Z`) : null }
        : {}),
    });

    await this.audit.append({
      action: "UPDATE",
      objectType: "RevenuePartner",
      objectId: id,
      actorUserId: actor.userId,
      metadata: { effectiveTo: dto.effectiveTo ?? null },
    });

    return updated;
  }

  async removePartner(actor: Actor, id: string): Promise<void> {
    this.platform.assertSuperAdmin(actor);

    const existing = await this.repo.findPartner(id);
    if (!existing) throw new NotFoundException();

    await this.repo.removePartner(id);
    await this.audit.append({
      action: "DELETE",
      objectType: "RevenuePartner",
      objectId: id,
      actorUserId: actor.userId,
      metadata: { name: existing.name },
    });
  }
}

/**
 * A percentage for display: `6000` → `"60"`, `1250` → `"12.5"`.
 *
 * Trailing zeros are trimmed because a share is written "60%", not "60.00%" —
 * money keeps its two decimals for the opposite reason, and `formatMoney` says
 * so.
 */
function formatPercent(scaled: number): string {
  return formatMoney(scaled).replace(/\.?0+$/, "");
}

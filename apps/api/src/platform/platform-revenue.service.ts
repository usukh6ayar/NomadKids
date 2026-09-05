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

  /**
   * A month, in two pots: what the state paid the kindergartens, and what the
   * platform itself earned.
   *
   * ★★★ The second pot was missing entirely until 2026-09-02. See
   * `platformRevenueSchema` in the contracts — a partner checking their agreed
   * percentage was reading a share of money the platform never receives.
   *
   * ★ A kindergarten that paid an access fee but ran no funding calculation
   * (or the reverse) must still appear. The two aggregates are therefore
   * unioned by id rather than joined onto the funding rows, which would have
   * silently dropped exactly the kindergartens whose only relationship with
   * the platform is that they pay it.
   */
  async monthRevenue(actor: Actor, month: string): Promise<PlatformRevenue> {
    this.platform.assertSuperAdmin(actor);

    const { first, last } = monthBounds(month);
    const [rows, fees] = await Promise.all([
      this.repo.monthByKindergarten(first),
      this.repo.accessFeesByKindergarten(first, last),
    ]);

    const feeById = new Map(fees.map((row) => [row.kindergartenId, row]));
    const ids = [...new Set([...rows.map((r) => r.kindergartenId), ...feeById.keys()])];

    const names = new Map((await this.repo.kindergartenNames(ids)).map((k) => [k.id, k.name]));

    const fundingById = new Map(rows.map((row) => [row.kindergartenId, row]));

    const kindergartens = ids
      .map((kindergartenId) => {
        const funding = fundingById.get(kindergartenId);
        const fee = feeById.get(kindergartenId);
        return {
          kindergartenId,
          name: names.get(kindergartenId) ?? "—",
          entries: funding?.entries ?? 0,
          calculated: funding?.calculated ?? "0",
          approved: funding?.approved ?? "0",
          received: funding?.received ?? "0",
          accessFees: fee?.accessFees ?? "0",
          accessPayments: fee?.accessPayments ?? 0,
        };
      })
      /*
        ★ Sorted by **access fees** now, not by state funding.

        The operator's question on their own screen is "who is paying us", and
        the previous ordering answered "who received the largest state
        transfer" — which is the kindergarten's business, not the platform's.
        Compared as scaled integers rather than with `Number(...)`: the sort is
        the one place a float would be harmless, and using two different
        notions of "how much" in one file is how the harmless one ends up
        somewhere it is not.
      */
      .sort(
        (a, b) =>
          parseMoney(b.accessFees) - parseMoney(a.accessFees) ||
          parseMoney(b.received) - parseMoney(a.received) ||
          a.name.localeCompare(b.name),
      );

    return {
      month,
      kindergartens,
      state: {
        calculated: formatMoney(sumMoney(rows.map((r) => r.calculated))),
        approved: formatMoney(sumMoney(rows.map((r) => r.approved))),
        received: formatMoney(sumMoney(rows.map((r) => r.received))),
      },
      platform: {
        accessFees: formatMoney(sumMoney(fees.map((r) => r.accessFees))),
        accessPayments: fees.reduce((sum, row) => sum + row.accessPayments, 0),
      },
    };
  }

  /**
   * The month's income, divided by the shares in force.
   *
   * ★ From **paid access fees** — the platform's own income, and the only
   * money on this screen a share can honestly be taken from. Until 2026-09-02
   * it divided `FundingCalculation.receivedAmount`, which is the state's
   * transfer to a kindergarten.
   *
   * ★★★ Only money that has **arrived**: the aggregate filters on `paidAt`, so
   * an access fee that was raised and never paid divides to nothing. A share of
   * an unpaid QPay invoice is a share of a QR code nobody scanned.
   *
   * ★★ Rounded to two decimals per partner, and the remainder is reported
   * rather than absorbed. 33.33% of 1,000,000 three ways leaves ₮1 that belongs
   * to nobody; hiding it inside the largest share would make the figures stop
   * adding up for whoever checks them against a bank statement.
   */
  async distribution(actor: Actor, month: string): Promise<RevenueDistribution> {
    this.platform.assertSuperAdmin(actor);

    const { first, last } = monthBounds(month);
    const [fees, partners] = await Promise.all([
      /*
       * ★★★ Access fees, **not** `monthByKindergarten`.
       *
       * That call returns `FundingCalculation` — state money paid to the
       * kindergartens — and this method divided it among the platform's
       * partners until 2026-09-02. It was a share of income the platform never
       * received, while its actual income was on no screen at all.
       */
      this.repo.accessFeesByKindergarten(first, last),
      this.repo.partnersInForce(last),
    ]);

    const accessFees = sumMoney(fees.map((row) => row.accessFees));
    const accessPayments = fees.reduce((sum, row) => sum + row.accessPayments, 0);
    const allocated = sumMoney(partners.map((p) => p.sharePercent));

    const shares = partners.map((partner) => ({
      partnerId: partner.id,
      name: partner.name,
      sharePercent: partner.sharePercent,
      amount: formatMoney(percentOf(accessFees, partner.sharePercent)),
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
      accessFees: formatMoney(accessFees),
      accessPayments,
      allocatedPercent: formatPercent(allocated),
      unallocated: formatMoney(accessFees - paidOut),
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

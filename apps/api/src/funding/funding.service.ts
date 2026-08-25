import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import type { FundingSource } from "../domain/enums";
import { FundingRepository } from "./funding.repository";
import { calculateFunding, ruleAppliesOn, type RuleInput } from "./funding-rules";
import type {
  CalculateMonthDto,
  CreateFundingRuleDto,
  ListFundingQuery,
  SettleFundingDto,
  UpdateFundingRuleDto,
} from "./funding.dto";

@Injectable()
export class FundingService {
  constructor(
    private readonly repo: FundingRepository,
    private readonly tenants: TenantAccessService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * ★ Administrator only, throughout this service.
   *
   * `нэмэлт.md` §13 asks for a dedicated accountant role and says plainly
   * "Багш санхүүгийн бүрэн мэдээллийг харах эрхгүй байна". That role does not
   * exist yet — adding a fourth `Role` touches every authorization primitive in
   * the system and deserves its own change. Until it does, `assertAdmin` is the
   * closest correct answer: it keeps teachers out, which is the requirement's
   * actual instruction, and widening to an accountant later is a smaller change
   * than narrowing from staff would be.
   */
  async listRules(actor: Actor, kindergartenId: string) {
    this.tenants.assertAdmin(actor, kindergartenId);
    return this.repo.listRules(kindergartenId);
  }

  async createRule(actor: Actor, kindergartenId: string, dto: CreateFundingRuleDto) {
    this.tenants.assertAdmin(actor, kindergartenId);

    const created = await this.repo.createRule({
      kindergartenId,
      name: dto.name,
      source: dto.source,
      effectiveFrom: toDate(dto.effectiveFrom),
      effectiveTo: dto.effectiveTo ? toDate(dto.effectiveTo) : null,
      ageBand: dto.ageBand ?? null,
      dailyRate: dto.dailyRate ?? null,
      monthlyRate: dto.monthlyRate ?? null,
      dependsOnAttendance: dto.dependsOnAttendance,
      dependsOnMeals: dto.dependsOnMeals,
      note: dto.note ?? null,
    });

    // §14 — a tariff change is the first thing on its list of financial events
    // that must be logged.
    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "FundingRule",
      objectId: created.id,
      metadata: {
        name: dto.name,
        source: dto.source,
        dailyRate: dto.dailyRate ?? null,
        monthlyRate: dto.monthlyRate ?? null,
      },
    });

    return created;
  }

  /** Closing or renaming a rule. The rate cannot change — see the DTO. */
  async updateRule(actor: Actor, id: string, dto: UpdateFundingRuleDto) {
    const rule = await this.repo.findRule(id);
    if (!rule) throw new NotFoundException();
    this.tenants.assertAdmin(actor, rule.kindergartenId);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.note !== undefined) data.note = dto.note;
    if (dto.effectiveTo !== undefined) {
      data.effectiveTo = dto.effectiveTo ? toDate(dto.effectiveTo) : null;
    }

    const saved = await this.repo.updateRule(id, data);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: rule.kindergartenId,
      actorUserId: actor.userId,
      objectType: "FundingRule",
      objectId: id,
      metadata: { fields: Object.keys(data) },
    });

    return saved;
  }

  async removeRule(actor: Actor, id: string) {
    const rule = await this.repo.findRule(id);
    if (!rule) throw new NotFoundException();
    this.tenants.assertAdmin(actor, rule.kindergartenId);

    await this.repo.softDeleteRule(id);
    await this.audit.append({
      action: "DELETE",
      kindergartenId: rule.kindergartenId,
      actorUserId: actor.userId,
      objectType: "FundingRule",
      objectId: id,
    });

    return { id };
  }

  // ── The monthly calculation — нэмэлт.md §6 ─────────────────────────────────

  async listMonth(actor: Actor, kindergartenId: string, query: ListFundingQuery) {
    this.tenants.assertAdmin(actor, kindergartenId);

    const { first } = monthBounds(query.month);
    const [items, totals] = await Promise.all([
      this.repo.listCalculations(kindergartenId, first, query.source),
      this.repo.monthTotals(kindergartenId, first),
    ]);

    return { month: query.month, items, totals };
  }

  /**
   * Runs the month — нэмэлт.md §6's "автоматаар үүсдэг" figure.
   *
   * ★ It recalculates from the attendance and meal registers every time, and
   * stores the inputs it used.
   *
   * §17's principle is that attendance is entered once and reused, and this is
   * the reuse. Storing `daysAttended`, `daysFed` and `dailyRate` on each row is
   * what stops a later attendance correction silently changing a figure that
   * was already submitted — the previous run is superseded, not overwritten,
   * so both answers survive.
   */
  async calculateMonth(actor: Actor, kindergartenId: string, dto: CalculateMonthDto) {
    this.tenants.assertAdmin(actor, kindergartenId);

    const { first, last, lastIso } = monthBounds(dto.month);
    const rules = await this.repo.rulesInForce(kindergartenId, dto.source, last);

    if (rules.length === 0) {
      throw new BadRequestException("Энэ сард хүчинтэй санхүүжилтийн дүрэм алга");
    }

    const { enrollments, attendance, meals } = await this.repo.monthInputs(
      kindergartenId,
      first,
      last,
    );

    const attendedBy = new Map(attendance.map((row) => [row.childId, row._count._all]));
    const fedBy = new Map(meals.map((row) => [row.childId, row._count._all]));

    const rows = enrollments.flatMap((enrollment) => {
      const rule = pickRule(rules, enrollment.group?.ageBand ?? null, lastIso);
      // A child whose age band no rule covers is left out rather than funded at
      // zero: a zero row asserts "this child earns nothing", and the truth is
      // that nobody has written a rule for them yet.
      if (!rule) return [];

      const counts = {
        daysAttended: attendedBy.get(enrollment.childId) ?? 0,
        daysFed: fedBy.get(enrollment.childId) ?? 0,
      };

      const input: RuleInput = {
        dailyRate: rule.dailyRate === null ? null : Number(rule.dailyRate),
        monthlyRate: rule.monthlyRate === null ? null : Number(rule.monthlyRate),
        dependsOnAttendance: rule.dependsOnAttendance,
        dependsOnMeals: rule.dependsOnMeals,
      };

      return [
        {
          kindergartenId,
          childId: enrollment.childId,
          source: dto.source,
          month: first,
          daysAttended: counts.daysAttended,
          daysFed: counts.daysFed,
          dailyRate: rule.dailyRate,
          fundingRuleId: rule.id,
          calculatedAmount: String(calculateFunding(input, counts)),
        },
      ];
    });

    const saved = await this.repo.replaceMonth(kindergartenId, first, dto.source, rows);

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "FundingCalculation",
      objectId: kindergartenId,
      metadata: { month: dto.month, source: dto.source, children: saved.length },
    });

    return saved;
  }

  /**
   * Recording what was approved and what arrived — §6's later states.
   *
   * The difference between the three figures is §6's "Зөрүү", and it is
   * deliberately not stored: it is `calculated − received` and a stored copy is
   * one more thing that can disagree with its own inputs.
   */
  async settle(actor: Actor, id: string, dto: SettleFundingDto) {
    const calculation = await this.repo.findCalculation(id);
    if (!calculation) throw new NotFoundException();
    this.tenants.assertAdmin(actor, calculation.kindergartenId);

    const data: Record<string, unknown> = {};
    if (dto.approvedAmount !== undefined) data.approvedAmount = dto.approvedAmount;
    if (dto.receivedAmount !== undefined) data.receivedAmount = dto.receivedAmount;
    if (dto.note !== undefined) data.note = dto.note;

    const saved = await this.repo.updateCalculation(id, data);

    // §14: confirming an amount is one of the events it names explicitly.
    await this.audit.append({
      action: "UPDATE",
      kindergartenId: calculation.kindergartenId,
      actorUserId: actor.userId,
      objectType: "FundingCalculation",
      objectId: id,
      childId: calculation.childId,
      metadata: { fields: Object.keys(data), ...data },
    });

    return saved;
  }
}

/**
 * The most specific rule that applies.
 *
 * ★ An age-banded rule beats a general one.
 *
 * §5 lets a rule name an age band, which is only useful if it takes precedence
 * over the kindergarten-wide rule it sits inside — otherwise the two would be
 * ordered by date alone and a general rule written later would silently
 * override the specific one somebody configured on purpose.
 */
function pickRule<
  T extends { ageBand: string | null; effectiveFrom: Date; effectiveTo: Date | null },
>(rules: T[], ageBand: string | null, onIso: string): T | null {
  const applicable = rules.filter((rule) =>
    ruleAppliesOn(
      {
        effectiveFrom: rule.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: rule.effectiveTo ? rule.effectiveTo.toISOString().slice(0, 10) : null,
      },
      onIso,
    ),
  );

  return (
    applicable.find((rule) => rule.ageBand !== null && rule.ageBand === ageBand) ??
    applicable.find((rule) => rule.ageBand === null) ??
    null
  );
}

/** `YYYY-MM` to its first and last day, in UTC. */
function monthBounds(month: string) {
  const [year, monthNum] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(year, monthNum - 1, 1));
  // Day 0 of the next month is the last day of this one.
  const last = new Date(Date.UTC(year, monthNum, 0));

  return { first, last, lastIso: last.toISOString().slice(0, 10) };
}

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import type { AttendanceCounts } from "@kinder/contracts";
import { paginate, toSkipTake } from "../common/pagination";
import { FundingRepository } from "./funding.repository";
import { calculateFunding, ruleAppliesOn, splitBilling, type RuleInput } from "./funding-rules";
import { buildRegisterWorkbook } from "./register-workbook";
import type {
  CalculateMonthDto,
  CreateFundingRuleDto,
  ListFundingQuery,
  RegisterQuery,
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
    const fedBy = new Map(meals.map((row) => [row.childId, row.daysFed]));

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

  // ── The monthly register — нэмэлт.md §6 ────────────────────────────────────

  /**
   * One month, one table: the attendance register and the money beside it.
   *
   * ★ Two tabs on the screen, one row set here.
   *
   * The client's design shows "Ирцийн дэлгэрэнгүй" and "Санхүүгийн тооцоо" as
   * tabs over the same children, and they are the same rows read twice — the
   * second tab prices the first. Serving them as two endpoints would fetch the
   * roster twice and let the two answers disagree about who was enrolled, which
   * is the one thing a figure and its justification must never do.
   *
   * ★★ Everything derived, nothing new stored.
   *
   * `state`, `undocumentedDays`, `grossAmount` and `deductionAmount` are all
   * computed on read from rows that already exist. Storing any of them would
   * add a copy that survives the correction that invalidated it — the register
   * would keep asserting "акт дутуу" after the акт arrived.
   */
  async monthlyRegister(actor: Actor, kindergartenId: string, query: RegisterQuery) {
    const built = await this.buildRegister(actor, kindergartenId, query);
    const { skip, take } = toSkipTake(query);

    return {
      ...paginate(built.rows.slice(skip, skip + take), built.rows.length, query),
      month: query.month,
      source: query.source ?? null,
      workingDays: built.workingDays,
      totals: built.totals,
      rules: built.rules,
      calculatedAt: built.calculatedAt,
    };
  }

  /**
   * The same register, as a spreadsheet — нэмэлт.md §16.
   *
   * ★ Every row, not the page on screen.
   *
   * A file is what somebody attaches to a claim or opens beside a bank
   * statement, and one that stopped at row twenty-five because that is where
   * the screen stopped would be worse than no file. It takes the same filters
   * as the table for the same reason `exportRoster` does: "export what I am
   * looking at" has to mean it.
   */
  async exportRegister(actor: Actor, kindergartenId: string, query: RegisterQuery) {
    const built = await this.buildRegister(actor, kindergartenId, query);
    const kindergarten = await this.repo.findKindergartenName(kindergartenId);

    const buffer = await buildRegisterWorkbook({
      month: query.month,
      kindergartenName: kindergarten?.name ?? "",
      workingDays: built.workingDays,
      rows: built.rows,
      totals: built.totals,
      rules: built.rules,
    });

    return { buffer, filename: `irts-tootsoolol-${query.month}.xlsx` };
  }

  /**
   * Everything both of the above need, computed once.
   *
   * ★ Neither the page nor the file is the source of truth for the totals.
   *
   * The footer sums the whole filter and the spreadsheet writes the whole
   * filter, so both start from the same array. Computing the totals twice —
   * once for the screen, once for the export — is how a printed figure comes to
   * differ from the one on the monitor it was read off.
   */
  private async buildRegister(actor: Actor, kindergartenId: string, query: RegisterQuery) {
    this.tenants.assertAdmin(actor, kindergartenId);

    const { first, last } = monthBounds(query.month);
    const [{ enrollments, attendance, meals, approvedRequests, calculations }, rules] =
      await Promise.all([
        this.repo.registerInputs(kindergartenId, first, last, { groupId: query.groupId }),
        this.repo.listRules(kindergartenId),
      ]);

    /*
     * Ажлын өдөр — days the kindergarten actually opened.
     *
     * ★ Counted from the register, not from a calendar.
     *
     * Weekday arithmetic would call every public holiday a working day, and a
     * table of Mongolian holidays hard-coded here would be one more thing to
     * maintain and to be wrong about in a leap of policy. A day on which
     * somebody marked attendance is a day the kindergarten ran; a day nobody
     * marked is not, and it should not inflate the "full month" a deduction is
     * measured against.
     */
    const workingDays = new Set(attendance.map((row) => isoOf(row.date))).size;

    // ── Fold the month's rows onto their children ────────────────────────────

    const countsBy = new Map<string, AttendanceCounts>();
    const absenceDatesBy = new Map<string, Set<string>>();

    for (const row of attendance) {
      const counts = countsBy.get(row.childId) ?? emptyCounts();
      counts[row.status as keyof AttendanceCounts] += 1;
      countsBy.set(row.childId, counts);

      if (ABSENCE_STATUSES.has(row.status)) {
        const dates = absenceDatesBy.get(row.childId) ?? new Set<string>();
        dates.add(isoOf(row.date));
        absenceDatesBy.set(row.childId, dates);
      }
    }

    const mealDaysBy = new Map<string, number>();
    for (const group of meals) {
      mealDaysBy.set(group.childId, (mealDaysBy.get(group.childId) ?? 0) + 1);
    }

    /*
     * Which absence dates carry an approved request.
     *
     * The ranges are expanded to dates rather than compared as intervals: a
     * child may have three separate leaves in a month, and "is this date inside
     * any of them" is a set membership question once they are. A month's
     * requests for one kindergarten is a small set; the expansion is bounded by
     * the month at both ends, so a request running from September to June
     * contributes only its days in this month.
     */
    const documentedBy = new Map<string, Set<string>>();
    for (const request of approvedRequests) {
      const dates = documentedBy.get(request.childId) ?? new Set<string>();
      for (const iso of datesBetween(max(request.dateFrom, first), min(request.dateTo, last))) {
        dates.add(iso);
      }
      documentedBy.set(request.childId, dates);
    }

    /*
     * ★ The newest calculation per child wins, and the rest are ignored.
     *
     * `replaceMonth` soft-deletes a superseded run, so live rows are already
     * one per (child, month, source) — but the source filter is applied here
     * rather than in SQL so that the unfiltered totals and the filtered table
     * come from one read. `registerInputs` orders by `createdAt desc`, so the
     * first row seen for a child is the one to keep.
     */
    const fundingBy = new Map<string, (typeof calculations)[number]>();
    for (const calculation of calculations) {
      if (query.source && calculation.source !== query.source) continue;
      if (!fundingBy.has(calculation.childId)) fundingBy.set(calculation.childId, calculation);
    }

    // ── Build one row per enrolled child ─────────────────────────────────────

    const statuses = query.status ? new Set(query.status) : null;
    const search = query.q?.trim().toLowerCase();

    const rows = enrollments
      .map((enrollment) => {
        const counts = countsBy.get(enrollment.childId) ?? emptyCounts();
        const mealDays = mealDaysBy.get(enrollment.childId) ?? 0;
        const documented = documentedBy.get(enrollment.childId);
        const absences = absenceDatesBy.get(enrollment.childId);

        let undocumentedDays = 0;
        for (const date of absences ?? []) {
          if (!documented?.has(date)) undocumentedDays += 1;
        }

        const calculation = fundingBy.get(enrollment.childId);
        const daysAttended = counts.PRESENT + counts.HALF_DAY;

        const funding = calculation
          ? (() => {
              const rate = calculation.dailyRate === null ? null : Number(calculation.dailyRate);
              const split = splitBilling(rate, Number(calculation.calculatedAmount), workingDays);

              return {
                id: calculation.id,
                source: calculation.source,
                daysAttended: calculation.daysAttended,
                daysFed: calculation.daysFed,
                dailyRate: calculation.dailyRate?.toString() ?? null,
                grossAmount: String(split.gross),
                deductionAmount: String(split.deduction),
                netAmount: String(split.net),
                approvedAmount: calculation.approvedAmount?.toString() ?? null,
                receivedAmount: calculation.receivedAmount?.toString() ?? null,
                note: calculation.note,
              };
            })()
          : null;

        /*
         * ★ `CHECK` outranks everything, including a settled amount.
         *
         * A child fed on more days than they attended means one of the two
         * registers is wrong, and the calculation sitting on top of it is
         * therefore also wrong — approving it does not make it right, so a
         * settled row with this fault still asks to be looked at. The order
         * below is severity, not recency.
         */
        const state =
          mealDays > daysAttended
            ? "CHECK"
            : undocumentedDays > 0
              ? "MISSING_DOCUMENT"
              : !funding
                ? "PENDING"
                : funding.approvedAmount !== null || funding.receivedAmount !== null
                  ? "SETTLED"
                  : "CALCULATED";

        return {
          child: enrollment.child,
          group: enrollment.group,
          counts,
          mealDays,
          undocumentedDays,
          funding,
          state,
        };
      })
      .filter((row) => {
        if (search) {
          const name = `${row.child.lastName} ${row.child.firstName}`.toLowerCase();
          if (!name.includes(search)) return false;
        }
        // A status filter asks "show me children this happened to", not
        // "hide the other columns" — the row keeps every count it had.
        if (statuses) {
          const matched = [...statuses].some(
            (status) => row.counts[status as keyof AttendanceCounts] > 0,
          );
          if (!matched) return false;
        }
        return true;
      });

    // ── Totals over the whole filtered set, then the page ────────────────────

    const totals = {
      children: rows.length,
      counts: rows.reduce((acc, row) => {
        for (const key of Object.keys(acc) as (keyof AttendanceCounts)[]) {
          acc[key] += row.counts[key];
        }
        return acc;
      }, emptyCounts()),
      mealDays: sum(rows, (row) => row.mealDays),
      grossAmount: String(sum(rows, (row) => Number(row.funding?.grossAmount ?? 0))),
      deductionAmount: String(sum(rows, (row) => Number(row.funding?.deductionAmount ?? 0))),
      netAmount: String(sum(rows, (row) => Number(row.funding?.netAmount ?? 0))),
      approvedAmount: String(sum(rows, (row) => Number(row.funding?.approvedAmount ?? 0))),
      receivedAmount: String(sum(rows, (row) => Number(row.funding?.receivedAmount ?? 0))),
      needingCheck: rows.filter((row) => row.state === "CHECK").length,
      missingDocuments: rows.filter((row) => row.state === "MISSING_DOCUMENT").length,
    };

    return {
      rows,
      workingDays,
      totals,
      /*
       * ★ Projected field by field, not spread.
       *
       * A spread would ship `kindergartenId`, `createdAt` and `deletedAt` to the
       * browser because they happen to be columns. Nothing reads them, the
       * contract strips them, and they would still be in the response body — so
       * the rule card names exactly what it renders. §2.1: a controller shapes
       * its response.
       */
      rules: rules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        source: rule.source,
        effectiveFrom: isoOf(rule.effectiveFrom),
        effectiveTo: rule.effectiveTo ? isoOf(rule.effectiveTo) : null,
        ageBand: rule.ageBand,
        dailyRate: rule.dailyRate?.toString() ?? null,
        monthlyRate: rule.monthlyRate?.toString() ?? null,
        dependsOnAttendance: rule.dependsOnAttendance,
        dependsOnMeals: rule.dependsOnMeals,
        note: rule.note,
      })),
      calculatedAt: calculations[0]?.createdAt.toISOString() ?? null,
    };
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

// ── Register helpers ─────────────────────────────────────────────────────────

/**
 * The statuses that are an absence — §6's "суутгал" side of the register.
 *
 * ★ `HALF_DAY` is not here, and neither is `OTHER`.
 *
 * A half day is attendance; the child came. `OTHER` is the escape hatch
 * schema.prisma keeps for a day that is none of the five, and calling it an
 * absence would demand an акт for a day nobody has classified yet — the
 * register would report paperwork missing for a status whose meaning is
 * "we do not know". It shows in the counts and asks for nothing.
 */
const ABSENCE_STATUSES = new Set(["EXCUSED", "SICK", "ABSENT"]);

function emptyCounts(): AttendanceCounts {
  return { PRESENT: 0, HALF_DAY: 0, EXCUSED: 0, SICK: 0, ABSENT: 0, OTHER: 0 };
}

/** A `@db.Date` back to `YYYY-MM-DD`. Prisma reads these as UTC midnight. */
function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Every date from `from` to `to`, inclusive, as `YYYY-MM-DD`. */
function datesBetween(from: Date, to: Date): string[] {
  const dates: string[] = [];
  for (const day = new Date(from); day <= to; day.setUTCDate(day.getUTCDate() + 1)) {
    dates.push(isoOf(day));
  }
  return dates;
}

function min(a: Date, b: Date): Date {
  return a < b ? a : b;
}

function max(a: Date, b: Date): Date {
  return a > b ? a : b;
}

function sum<T>(items: T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}

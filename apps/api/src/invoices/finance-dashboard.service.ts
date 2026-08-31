import { Injectable, NotFoundException } from "@nestjs/common";
import Decimal from "decimal.js";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { FinanceDashboardRepository } from "./finance-dashboard.repository";
import { monthBounds } from "./invoice-math";

/**
 * The financial dashboard — `нэмэлт.md` §9.
 *
 * ★ Nine figures, and **not one of them is stored**. Every number here is
 * aggregated from rows that already exist: the funding calculations, the
 * invoices, the payments. A dashboard that cached its own totals would be a
 * tenth place for the month's money to be stated, and the first to disagree
 * with the register beneath it after a correction.
 *
 * ★★ Behind `assertCanReadFinance` — the accountant and the administrator, and
 * a 404 for everybody else including a teacher (§13).
 */
@Injectable()
export class FinanceDashboardService {
  constructor(
    private readonly repo: FinanceDashboardRepository,
    private readonly tenants: TenantAccessService,
  ) {}

  async month(actor: Actor, kindergartenId: string, month: string) {
    this.tenants.assertCanReadFinance(actor, kindergartenId);

    const { first } = monthBounds(month);
    const now = new Date();

    const [state, invoiced, collected, overdue, meals] = await Promise.all([
      this.repo.stateFunding(kindergartenId, first),
      this.repo.invoiced(kindergartenId, first),
      this.repo.collected(kindergartenId, first),
      this.repo.overdue(kindergartenId, now),
      this.repo.mealCost(kindergartenId, first),
    ]);

    const billed = new Decimal(invoiced.billed.toString());
    const paid = new Decimal(collected.toString());
    const approved = new Decimal(state.approved.toString());
    const received = new Decimal(state.received.toString());
    const mealTotal = new Decimal(meals.total.toString());

    /*
     * ★ "Хүлээгдэж буй санхүүжилт" is `approved − received`, derived rather
     * than stored — the same argument `FundingService.settle` makes about
     * §6's "Зөрүү": a stored copy is one more thing that can disagree with its
     * own inputs.
     *
     * Clamped at zero: an overpayment from the state is a reconciliation
     * question, not a negative amount pending, and showing "−50 000₮ pending"
     * on a dashboard reads as a bug.
     */
    const pendingRaw = approved.sub(received);
    const pending = pendingRaw.isNegative() ? new Decimal(0) : pendingRaw;

    const unpaidRaw = billed.sub(paid);
    const unpaid = unpaidRaw.isNegative() ? new Decimal(0) : unpaidRaw;

    /*
     * ★★ "Нэг хүүхдэд ногдох дундаж хоолны зардал" — divided by the number of
     * children who actually ate, not by everyone enrolled.
     *
     * A kindergarten of 200 where 40 take meals has a per-child meal cost of
     * the 40, not of the 200; dividing by enrolment would report a figure five
     * times too low and make the meal budget look comfortable. Zero children
     * yields zero rather than a division by zero.
     */
    const perChildMeal = meals.children > 0 ? mealTotal.div(meals.children) : new Decimal(0);

    return {
      month,
      state: {
        children: state.children,
        calculated: state.calculated.toString(),
        approved: approved.toFixed(2),
        received: received.toFixed(2),
        pending: pending.toFixed(2),
      },
      parents: {
        invoices: invoiced.invoices,
        billed: billed.toFixed(2),
        paid: paid.toFixed(2),
        unpaid: unpaid.toFixed(2),
        overdueCount: overdue.count,
        overdueAmount: overdue.amount.toString(),
      },
      meals: {
        total: mealTotal.toFixed(2),
        fedDays: meals.fedDays,
        children: meals.children,
        // Rounded to the tögrög: an average carried to four decimal places
        // implies a precision the inputs do not have.
        perChild: perChildMeal.toFixed(2),
        bySource: meals.bySource.map((row) => ({
          source: row.source,
          amount: row.amount.toString(),
        })),
      },
    };
  }

  /**
   * One child's finance tab — `нэмэлт.md` §10.
   *
   * ★ **Two audiences, and they do not see the same thing.**
   *
   * §10 lists seven items under "Санхүү", and they are not all the same kind
   * of fact. The invoices, payments, discounts and balance are the family's
   * own money — a guardian must see those, they are being asked to pay them.
   * The state funding history is what the *government pays the kindergarten*
   * for this child; it is the kindergarten's revenue, and a parent has no more
   * business reading it than they have reading the staff payroll.
   *
   * So `funding` is present for finance staff and **absent** for a guardian —
   * omitted from the payload rather than sent and hidden by the screen, which
   * would put it one devtools tab away from anybody who asked.
   *
   * ★★ **Neither audience goes through `canAccessChild`**, and that is the
   * correction the integration suite forced.
   *
   * That predicate's three chains are guardian, assigned teacher and admin. An
   * accountant is none of them — §13 is explicit that they must not be — so
   * routing them through it refused the role this module exists for. Widening
   * it would have handed accountants every observation in the kindergarten.
   * `childTenancy` asks the narrower question instead: is this child one of
   * ours, and is this person a guardian of theirs. A teacher satisfies neither
   * and gets a 404, which is what §13 asks for.
   */
  async child(actor: Actor, childId: string) {
    const tenancy = await this.repo.childTenancy(childId);
    if (!tenancy) throw new NotFoundException();

    const isFinanceStaff = tenancy.kindergartenIds.some((id) =>
      this.tenants.canReadFinance(actor, id),
    );
    const isGuardian = tenancy.guardianships.some(
      (g) => g.guardianUserId === actor.userId && g.canView,
    );

    if (!isFinanceStaff && !isGuardian) throw new NotFoundException();

    const balance = await this.repo.childBalance(childId);

    const billed = new Decimal(balance.billed.toString());
    const paid = new Decimal(balance.paid.toString());
    const outstanding = billed.sub(paid);

    const base = {
      childId,
      invoices: balance.invoices,
      billed: billed.toFixed(2),
      paid: paid.toFixed(2),
      /** Хөнгөлөлт — §10 names it separately from the total it already reduced. */
      discounts: new Decimal(balance.discounts.toString()).toFixed(2),
      /**
       * Үлдэгдэл. Negative means the family is in credit — kept signed rather
       * than clamped, because on a single child's own statement an overpayment
       * is information they need, not a reconciliation artefact to hide.
       */
      balance: outstanding.toFixed(2),
    };

    if (!isFinanceStaff) return base;

    // Two years back: enough for "last year and this", bounded per §3.4.
    const since = new Date(Date.UTC(new Date().getUTCFullYear() - 2, 0, 1));
    const history = await this.repo.childFundingHistory(childId, since);

    return {
      ...base,
      funding: history.map((row) => ({
        id: row.id,
        month: row.month.toISOString().slice(0, 7),
        source: row.source,
        rule: row.fundingRule?.name ?? null,
        /** Which counter the rate multiplied — §10's "Ирцэд үндэслэсэн тооцоо". */
        basis: row.fundingRule?.dependsOnMeals ? "MEALS" : "ATTENDANCE",
        daysAttended: row.daysAttended,
        daysFed: row.daysFed,
        dailyRate: row.dailyRate?.toString() ?? null,
        calculated: row.calculatedAmount.toString(),
        approved: row.approvedAmount?.toString() ?? null,
        received: row.receivedAmount?.toString() ?? null,
      })),
    };
  }
}

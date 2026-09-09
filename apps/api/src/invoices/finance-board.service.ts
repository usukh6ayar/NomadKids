import { Injectable } from "@nestjs/common";
import Decimal from "decimal.js";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { FinanceDashboardRepository } from "./finance-dashboard.repository";
import { monthBounds } from "./invoice-math";

/** What the board reports as "Анхаарах зүйлс". */
export interface Alert {
  key: string;
  tone: "warn" | "info";
  title: string;
  detail: string;
  href: string;
}

/**
 * Нягтлангийн самбар — the screen an accountant lands on. Client request,
 * 2026-09-09.
 *
 * ★ **Not a second `FinanceDashboardService`.** That one answers §9's
 * question — how do this month's funding and billing stand, broken out by who
 * owes it — and it still renders inside `/finance`. This answers the question
 * above it: what came in, who still owes, and what needs a decision today. The
 * two share a repository rather than a payload, so a figure quoted on both is
 * the same query and cannot drift.
 *
 * ★★ **Every figure here is derived, none is stored** — the same rule §9 sets
 * for its own dashboard, and the reason a correction in the register cannot
 * leave a stale total on this screen.
 *
 * A recorded-expenditure ledger (`Expense`) was built here on 2026-09-09 and
 * removed the same day at the client's request — payroll is not something they
 * want in this product. The board reports what the kindergarten *receives* and
 * is *owed*; what it spends is not in this system, so there are no "нийт
 * зарлага" or "ашиг" figures and there deliberately is no half-answer standing
 * in for them.
 */
@Injectable()
export class FinanceBoardService {
  constructor(
    private readonly repo: FinanceDashboardRepository,
    private readonly tenants: TenantAccessService,
  ) {}

  async month(actor: Actor, kindergartenId: string, month: string) {
    this.tenants.assertCanReadFinance(actor, kindergartenId);

    const { first, to } = monthBounds(month);
    const now = new Date();

    const [state, invoiced, collected, overdue, meals, owing, readiness] = await Promise.all([
      this.repo.stateFunding(kindergartenId, first),
      this.repo.invoiced(kindergartenId, first),
      this.repo.collected(kindergartenId, first),
      this.repo.overdue(kindergartenId, now),
      this.repo.mealCost(kindergartenId, first),
      this.repo.childrenOwing(kindergartenId),
      this.repo.fundingReadiness(kindergartenId, first, to),
    ]);

    /*
     * ★ Орлого is what **arrived**, not what was billed.
     *
     * `received` and `collected`, never `approved` and `billed`. A month that
     * counted its invoices as income would report money it is still chasing,
     * which is the one mistake this tile exists to prevent — and it is the
     * mistake a spreadsheet makes, which is what this screen replaces.
     */
    const parentIncome = new Decimal(collected.toString());
    const stateIncome = new Decimal(state.received.toString());
    const income = parentIncome.add(stateIncome);

    const approved = new Decimal(state.approved.toString());
    const statePending = approved.sub(stateIncome);

    const billed = new Decimal(invoiced.billed.toString());
    const unpaidRaw = billed.sub(parentIncome);
    // Clamped, as §9's own figure is: an overpayment is a reconciliation
    // question, not a negative amount owed.
    const unpaid = unpaidRaw.isNegative() ? new Decimal(0) : unpaidRaw;

    const mealTotal = new Decimal(meals.total.toString());
    const perChildMeal = meals.children > 0 ? mealTotal.div(meals.children) : new Decimal(0);

    return {
      month,
      income: {
        total: income.toFixed(2),
        parents: parentIncome.toFixed(2),
        state: stateIncome.toFixed(2),
        /**
         * `approved − received`, clamped — money the state has confirmed and
         * not yet transferred. It is not income until it lands, so it sits
         * beside the total rather than in it.
         */
        statePending: statePending.isNegative() ? "0.00" : statePending.toFixed(2),
      },
      unpaid: {
        amount: unpaid.toFixed(2),
        invoices: invoiced.invoices,
        children: owing,
        overdueCount: overdue.count,
        overdueAmount: new Decimal(overdue.amount.toString()).toFixed(2),
      },
      meals: {
        total: mealTotal.toFixed(2),
        perChild: perChildMeal.toFixed(2),
        children: meals.children,
        fedDays: meals.fedDays,
      },
      alerts: buildAlerts({
        overdueCount: overdue.count,
        statePending,
        readiness,
      }),
    };
  }
}

/**
 * Анхаарах зүйлс — what the accountant should look at, in the order it costs
 * them money.
 *
 * ★ **Server-side, and that is the point of the tile.** "What needs attention"
 * is a business rule — an unrun month, an arrear, funding still outstanding —
 * and a screen that derived it from four other fields on the payload would be a
 * second, quieter definition of the same rule the day a report disagrees.
 *
 * ★★ Ordered, not scored. Arrears first because they are somebody else's money
 * already overdue; an unrun month next because every figure above it is blank
 * until it is done; the informational one last. A severity number would imply a
 * comparison between "you are owed 400 000₮" and "the state has not paid yet",
 * which are not on one scale.
 *
 * ★★★ Every `href` is a route in this app. Nothing here composes a URL from
 * user input, so there is no open-redirect surface to guard.
 */
function buildAlerts(input: {
  overdueCount: number;
  statePending: Decimal;
  readiness: { rules: number; calculations: number };
}): Alert[] {
  const alerts: Alert[] = [];

  if (input.overdueCount > 0) {
    alerts.push({
      key: "overdue",
      tone: "warn",
      title: "Хугацаа хэтэрсэн төлбөр",
      detail: `${input.overdueCount} нэхэмжлэл, бүх сарын дүнгээр`,
      href: "/invoices",
    });
  }

  if (input.readiness.rules === 0) {
    alerts.push({
      key: "no-rules",
      tone: "warn",
      title: "Санхүүжилтийн тариф тохируулаагүй",
      detail: "Тариф оруулах хүртэл сарын тооцоо ажиллахгүй",
      href: "/finance",
    });
  } else if (input.readiness.calculations === 0) {
    alerts.push({
      key: "month-not-run",
      tone: "warn",
      title: "Энэ сарын санхүүжилтийн тооцоо хийгдээгүй",
      detail: "Ирц, хоолны бүртгэл бүрдсэн бол тооцоог ажиллуулна уу",
      href: "/finance",
    });
  }

  if (input.statePending.isPositive() && !input.statePending.isZero()) {
    alerts.push({
      key: "state-pending",
      tone: "info",
      title: "Улсаас хүлээгдэж буй санхүүжилт",
      detail: "Баталгаажсан дүнгээс хүлээн авсан дүн дутуу байна",
      href: "/finance",
    });
  }

  return alerts;
}

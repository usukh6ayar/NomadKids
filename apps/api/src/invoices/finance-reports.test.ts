import { describe, expect, it } from "vitest";
import {
  annualReport,
  childFundingReport,
  mealCostReport,
  mealDaysReport,
  parentPaymentsReport,
  stateFundingReport,
  unpaidReport,
  varianceReport,
  type CalculationRow,
  type InvoiceRow,
} from "./finance-reports";

/**
 * What each of §16's reports *is* — the definitions, without a database.
 *
 * ★ These are the tests that catch a report answering the wrong question. The
 * integration suite proves the endpoint is reachable and authorized; nothing
 * there would notice if the meal report quietly counted attended days, because
 * the number would still be a plausible number.
 */

function calc(overrides: Partial<CalculationRow> = {}): CalculationRow {
  return {
    source: "STATE",
    daysAttended: 20,
    daysFed: 18,
    dailyRate: "1000.00",
    calculatedAmount: "20000.00",
    approvedAmount: "20000.00",
    receivedAmount: "20000.00",
    note: null,
    child: { id: "c1", lastName: "Болд", firstName: "Номин" },
    fundingRule: { name: "Улсын", dependsOnMeals: false },
    ...overrides,
  };
}

function inv(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    number: "2026-000001",
    month: new Date("2026-02-01T00:00:00.000Z"),
    status: "UNPAID",
    discountAmount: "0.00",
    totalAmount: "50000.00",
    dueDate: null,
    paidAmount: "0.00",
    outstanding: "50000.00",
    child: { id: "c1", lastName: "Болд", firstName: "Номин" },
    ...overrides,
  };
}

describe("Сарын улсын санхүүжилтийн тайлан", () => {
  it("counts only STATE rows", async () => {
    const table = stateFundingReport([
      calc(),
      calc({ source: "PARENT", calculatedAmount: "99999.00" }),
    ]);

    expect(table.rows).toHaveLength(1);
    expect(table.totals!.calculated).toBe("20000.00");
  });

  it("totals the days and the three amounts", () => {
    const table = stateFundingReport([
      calc({ daysAttended: 20, calculatedAmount: "20000.00", receivedAmount: "15000.00" }),
      calc({
        child: { id: "c2", lastName: "Дорж", firstName: "Сараа" },
        daysAttended: 18,
        calculatedAmount: "18000.00",
        receivedAmount: null,
      }),
    ]);

    expect(table.totals!.daysAttended).toBe(38);
    expect(table.totals!.calculated).toBe("38000.00");
    // A null received amount contributes nothing rather than breaking the sum.
    expect(table.totals!.received).toBe("15000.00");
  });
});

describe("Хүүхэд тус бүрийн санхүүжилтийн тайлан", () => {
  it("folds a child's sources into one row", () => {
    const table = childFundingReport([
      calc({ source: "STATE", calculatedAmount: "20000.00" }),
      calc({ source: "PARENT", calculatedAmount: "30000.00" }),
    ]);

    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]!.total).toBe("50000.00");
    expect(table.rows[0]!.sources).toBe("STATE, PARENT");
  });

  it("does not double-count days across sources", () => {
    // Two sources fund the same 20 days. Summing would report a 40-day month.
    const table = childFundingReport([
      calc({ source: "STATE", daysAttended: 20 }),
      calc({ source: "PARENT", daysAttended: 20 }),
    ]);

    expect(table.rows[0]!.days).toBe(20);
  });

  it("keeps children apart", () => {
    const table = childFundingReport([
      calc(),
      calc({ child: { id: "c2", lastName: "Дорж", firstName: "Сараа" } }),
    ]);

    expect(table.rows).toHaveLength(2);
    expect(table.totals!.child).toBe("2 хүүхэд");
  });
});

describe("Хооллосон өдөр–хоолны зардлын тайлан", () => {
  it("includes only rules that bill on meals", () => {
    // The discriminating case: a tuition rule multiplied by attended days is
    // not a meal cost, and including it would make the per-day figure — the
    // one a kitchen budget is set from — meaningless.
    const table = mealDaysReport([
      calc({ fundingRule: { name: "Хоол", dependsOnMeals: true }, calculatedAmount: "45000.00" }),
      calc({
        fundingRule: { name: "Сургалт", dependsOnMeals: false },
        calculatedAmount: "180000.00",
      }),
    ]);

    expect(table.rows).toHaveLength(1);
    expect(table.totals!.cost).toBe("45000.00");
  });

  it("counts fed days, not attended days", () => {
    const table = mealDaysReport([
      calc({ daysAttended: 20, daysFed: 18, fundingRule: { name: "Хоол", dependsOnMeals: true } }),
    ]);

    expect(table.rows[0]!.daysFed).toBe(18);
    expect(table.totals!.daysFed).toBe(18);
  });

  it("is empty rather than wrong when no meal rule exists", () => {
    const table = mealDaysReport([calc()]);

    expect(table.rows).toHaveLength(0);
    expect(table.totals!.cost).toBe("0.00");
  });
});

describe("Сарын хоолны зардлын тайлан", () => {
  const meal = (over: Partial<CalculationRow> = {}) =>
    calc({ fundingRule: { name: "Хоол", dependsOnMeals: true }, ...over });

  it("splits by source and averages per child within each", () => {
    const table = mealCostReport([
      meal({ source: "STATE", calculatedAmount: "20000.00" }),
      meal({
        source: "PARENT",
        calculatedAmount: "30000.00",
        child: { id: "c2", lastName: "Дорж", firstName: "Сараа" },
      }),
    ]);

    expect(table.rows).toHaveLength(2);
    expect(table.totals!.total).toBe("50000.00");
    // Two children, one each.
    expect(table.totals!.perChild).toBe("25000.00");
  });

  it("divides by children who ate, not by rows", () => {
    // One child with two meal rules is one child, not two.
    const table = mealCostReport([
      meal({ source: "STATE", calculatedAmount: "20000.00" }),
      meal({ source: "PARENT", calculatedAmount: "30000.00" }),
    ]);

    expect(table.totals!.children).toBe(1);
    expect(table.totals!.perChild).toBe("50000.00");
  });

  it("reports zero rather than dividing by zero", () => {
    const table = mealCostReport([]);

    expect(table.totals!.perChild).toBe("0.00");
    expect(table.totals!.total).toBe("0.00");
  });
});

describe("Эцэг эхийн төлбөрийн тайлан", () => {
  it("totals what was billed, discounted, paid and left", () => {
    const table = parentPaymentsReport([
      inv({
        totalAmount: "50000.00",
        discountAmount: "5000.00",
        paidAmount: "20000.00",
        outstanding: "30000.00",
      }),
      inv({
        number: "2026-000002",
        totalAmount: "40000.00",
        paidAmount: "40000.00",
        outstanding: "0.00",
      }),
    ]);

    expect(table.totals!.billed).toBe("90000.00");
    expect(table.totals!.discount).toBe("5000.00");
    expect(table.totals!.paid).toBe("60000.00");
    expect(table.totals!.outstanding).toBe("30000.00");
  });
});

describe("Төлөгдөөгүй төлбөрийн тайлан", () => {
  const asOf = new Date("2026-03-15T00:00:00.000Z");

  it("drops settled invoices", () => {
    const table = unpaidReport(
      [inv({ outstanding: "0.00" }), inv({ number: "2026-000002", outstanding: "30000.00" })],
      asOf,
    );

    expect(table.rows).toHaveLength(1);
    expect(table.totals!.outstanding).toBe("30000.00");
  });

  it("sorts the latest bills first", () => {
    const table = unpaidReport(
      [
        inv({ number: "recent", dueDate: new Date("2026-03-10T00:00:00.000Z") }),
        inv({ number: "ancient", dueDate: new Date("2026-01-10T00:00:00.000Z") }),
      ],
      asOf,
    );

    // The accountant's first question is who is furthest behind.
    expect(table.rows[0]!.number).toBe("ancient");
    expect(table.rows[0]!.daysLate).toBe(64);
    expect(table.rows[1]!.daysLate).toBe(5);
  });

  it("shows a dash rather than a negative age for a bill not yet due", () => {
    const table = unpaidReport([inv({ dueDate: new Date("2026-04-01T00:00:00.000Z") })], asOf);

    expect(table.rows[0]!.daysLate).toBe("—");
  });

  it("handles an invoice with no due date at all", () => {
    const table = unpaidReport([inv({ dueDate: null })], asOf);

    expect(table.rows[0]!.dueDate).toBe("—");
    expect(table.rows[0]!.daysLate).toBe("—");
  });
});

describe("Санхүүжилтийн зөрүүний тайлан", () => {
  it("omits rows where all three figures agree", () => {
    // A variance report listing every child buries the ten that need chasing.
    const table = varianceReport([
      calc({
        calculatedAmount: "20000.00",
        approvedAmount: "20000.00",
        receivedAmount: "20000.00",
      }),
    ]);

    expect(table.rows).toHaveLength(0);
  });

  it("reports what was claimed but not approved", () => {
    const table = varianceReport([
      calc({
        calculatedAmount: "20000.00",
        approvedAmount: "18000.00",
        receivedAmount: "18000.00",
      }),
    ]);

    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]!.approvalGap).toBe("2000.00");
    expect(table.rows[0]!.paymentGap).toBe("0.00");
  });

  it("reports what was approved but has not arrived", () => {
    const table = varianceReport([
      calc({
        calculatedAmount: "20000.00",
        approvedAmount: "20000.00",
        receivedAmount: "12000.00",
      }),
    ]);

    expect(table.rows[0]!.approvalGap).toBe("0.00");
    expect(table.rows[0]!.paymentGap).toBe("8000.00");
  });

  it("treats an unapproved calculation as fully outstanding", () => {
    // Nothing approved yet means the whole claim is unconfirmed, not zero.
    const table = varianceReport([
      calc({ calculatedAmount: "20000.00", approvedAmount: null, receivedAmount: null }),
    ]);

    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]!.approvalGap).toBe("20000.00");
  });

  it("carries the note through, which is why the gap is explainable", () => {
    const table = varianceReport([calc({ approvedAmount: "18000.00", note: "Актгүй 2 хоног" })]);

    expect(table.rows[0]!.note).toBe("Актгүй 2 хоног");
  });
});

describe("Хичээлийн жилийн санхүүгийн нэгтгэл", () => {
  const month = (iso: string, over: Record<string, unknown> = {}) => ({
    month: new Date(`${iso}-01T00:00:00.000Z`),
    source: "STATE",
    children: 12,
    calculated: "240000.00",
    approved: "240000.00",
    received: "240000.00",
    ...over,
  });

  it("rolls months up in order", () => {
    const table = annualReport([month("2026-02"), month("2025-09"), month("2025-12")]);

    expect(table.rows.map((row) => row.month)).toEqual(["2025-09", "2025-12", "2026-02"]);
  });

  it("sums sources within a month but not their headcounts", () => {
    // A child funded from two sources is one child.
    const table = annualReport([
      month("2025-09", { source: "STATE", calculated: "100000.00", children: 12 }),
      month("2025-09", { source: "PARENT", calculated: "50000.00", children: 12 }),
    ]);

    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]!.calculated).toBe("150000.00");
    expect(table.rows[0]!.children).toBe(12);
  });

  it("derives what is still pending", () => {
    const table = annualReport([
      month("2025-09", { approved: "240000.00", received: "180000.00" }),
    ]);

    expect(table.rows[0]!.pending).toBe("60000.00");
    expect(table.totals!.pending).toBe("60000.00");
  });

  it("treats a month with no approved figure as nothing pending", () => {
    const table = annualReport([month("2025-09", { approved: null, received: null })]);

    expect(table.rows[0]!.pending).toBe("0.00");
  });
});

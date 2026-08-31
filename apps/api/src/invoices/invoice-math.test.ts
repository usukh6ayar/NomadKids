import { describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";
import {
  invoiceNumberPrefix,
  invoiceTotals,
  lineFor,
  monthBounds,
  nextInvoiceNumber,
  statusFor,
  type Tariff,
} from "./invoice-math";

const d = (value: string | number) => new Prisma.Decimal(value);

function tariff(overrides: Partial<Tariff> = {}): Tariff {
  return {
    id: "rule-1",
    name: "Хоолны мөнгө",
    invoiceItemKind: "MEAL",
    ageBand: null,
    dailyRate: d("2500.00"),
    monthlyRate: null,
    dependsOnAttendance: false,
    dependsOnMeals: true,
    ...overrides,
  };
}

describe("lineFor — what one tariff charges", () => {
  it("multiplies the daily rate by fed days for a meal tariff", () => {
    const line = lineFor(tariff(), { daysAttended: 20, daysFed: 18 });

    expect(line).not.toBeNull();
    expect(line!.quantity.toFixed(2)).toBe("18.00");
    expect(line!.amount.toFixed(2)).toBe("45000.00");
    expect(line!.kind).toBe("MEAL");
  });

  it("multiplies by attended days when the tariff depends on attendance", () => {
    const line = lineFor(
      tariff({ dependsOnAttendance: true, dependsOnMeals: false, invoiceItemKind: "TUITION" }),
      { daysAttended: 20, daysFed: 18 },
    );

    expect(line!.quantity.toFixed(2)).toBe("20.00");
    expect(line!.amount.toFixed(2)).toBe("50000.00");
  });

  it("bills attendance, not the sum, when a tariff sets both flags", () => {
    // Charging a family twice for one day under one rule is never what
    // "depends on both" could mean — see the note in `lineFor`.
    const line = lineFor(tariff({ dependsOnAttendance: true, dependsOnMeals: true }), {
      daysAttended: 20,
      daysFed: 18,
    });

    expect(line!.quantity.toFixed(2)).toBe("20.00");
    expect(line!.amount.toFixed(2)).toBe("50000.00");
  });

  it("charges the flat monthly rate when it depends on neither", () => {
    const line = lineFor(
      tariff({
        dependsOnAttendance: false,
        dependsOnMeals: false,
        dailyRate: null,
        monthlyRate: d("180000.00"),
        invoiceItemKind: "TUITION",
      }),
      { daysAttended: 0, daysFed: 0 },
    );

    expect(line!.quantity.toFixed(2)).toBe("1.00");
    expect(line!.amount.toFixed(2)).toBe("180000.00");
  });

  it("produces nothing for a child who was never there", () => {
    // A zero-amount line is noise on a bill the parent has to read past.
    expect(lineFor(tariff(), { daysAttended: 0, daysFed: 0 })).toBeNull();
  });

  it("produces nothing when the rate the tariff needs is not configured", () => {
    expect(lineFor(tariff({ dailyRate: null }), { daysAttended: 20, daysFed: 18 })).toBeNull();
    expect(
      lineFor(tariff({ dependsOnAttendance: false, dependsOnMeals: false, monthlyRate: null }), {
        daysAttended: 20,
        daysFed: 18,
      }),
    ).toBeNull();
  });
});

describe("invoiceTotals", () => {
  it("sums the lines, subtracts the discount, adds what was already owed", () => {
    const totals = invoiceTotals({
      lines: [{ amount: d("45000.00") }, { amount: d("180000.00") }],
      discountAmount: d("25000.00"),
      previousBalance: d("12000.00"),
    });

    expect(totals.subtotalAmount.toFixed(2)).toBe("225000.00");
    expect(totals.totalAmount.toFixed(2)).toBe("212000.00");
  });

  it("never goes negative when the discount exceeds the charges", () => {
    // A negative invoice is a refund wearing an invoice's clothes; §8 has a
    // reversing payment for that. Every report summing totalAmount depends on
    // this staying true.
    const totals = invoiceTotals({
      lines: [{ amount: d("10000.00") }],
      discountAmount: d("25000.00"),
      previousBalance: d("0"),
    });

    expect(totals.totalAmount.toFixed(2)).toBe("0.00");
  });

  it("totals an empty invoice at zero rather than throwing", () => {
    const totals = invoiceTotals({
      lines: [],
      discountAmount: d("0"),
      previousBalance: d("0"),
    });

    expect(totals.subtotalAmount.toFixed(2)).toBe("0.00");
    expect(totals.totalAmount.toFixed(2)).toBe("0.00");
  });

  it("adds amounts that a float would get wrong", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. This is the whole reason the
    // module works in Decimal.
    const totals = invoiceTotals({
      lines: [{ amount: d("0.10") }, { amount: d("0.20") }],
      discountAmount: d("0"),
      previousBalance: d("0"),
    });

    expect(totals.subtotalAmount.toFixed(2)).toBe("0.30");
  });
});

describe("statusFor — derived from the payments, never typed in", () => {
  const now = new Date("2026-03-20T00:00:00Z");
  const future = new Date("2026-03-25T00:00:00Z");
  const past = new Date("2026-03-10T00:00:00Z");

  it("is UNPAID with nothing received", () => {
    expect(
      statusFor({
        totalAmount: d("100000"),
        paidAmount: d("0"),
        dueDate: future,
        now,
        current: "UNPAID",
      }),
    ).toBe("UNPAID");
  });

  it("is PARTIALLY_PAID when some has arrived and the date has not passed", () => {
    expect(
      statusFor({
        totalAmount: d("100000"),
        paidAmount: d("40000"),
        dueDate: future,
        now,
        current: "UNPAID",
      }),
    ).toBe("PARTIALLY_PAID");
  });

  it("is PAID on the exact amount", () => {
    expect(
      statusFor({
        totalAmount: d("100000"),
        paidAmount: d("100000"),
        dueDate: past,
        now,
        current: "OVERDUE",
      }),
    ).toBe("PAID");
  });

  it("is PAID on an overpayment, and not OVERDUE despite the date", () => {
    expect(
      statusFor({
        totalAmount: d("100000"),
        paidAmount: d("120000"),
        dueDate: past,
        now,
        current: "UNPAID",
      }),
    ).toBe("PAID");
  });

  it("is OVERDUE past the due date, whether partly paid or not", () => {
    expect(
      statusFor({
        totalAmount: d("100000"),
        paidAmount: d("0"),
        dueDate: past,
        now,
        current: "UNPAID",
      }),
    ).toBe("OVERDUE");

    expect(
      statusFor({
        totalAmount: d("100000"),
        paidAmount: d("40000"),
        dueDate: past,
        now,
        current: "PARTIALLY_PAID",
      }),
    ).toBe("OVERDUE");
  });

  it("is never OVERDUE without a due date", () => {
    expect(
      statusFor({
        totalAmount: d("100000"),
        paidAmount: d("0"),
        dueDate: null,
        now,
        current: "UNPAID",
      }),
    ).toBe("UNPAID");
  });

  it("keeps REFUNDED, which the arithmetic cannot tell from never paid", () => {
    expect(
      statusFor({
        totalAmount: d("100000"),
        paidAmount: d("0"),
        dueDate: past,
        now,
        current: "REFUNDED",
      }),
    ).toBe("REFUNDED");
  });

  it("does not call a zero-total invoice PAID", () => {
    // Otherwise an empty draft would report itself settled.
    expect(
      statusFor({
        totalAmount: d("0"),
        paidAmount: d("0"),
        dueDate: future,
        now,
        current: "UNPAID",
      }),
    ).toBe("UNPAID");
  });
});

describe("nextInvoiceNumber", () => {
  it("starts a year at one", () => {
    expect(nextInvoiceNumber(2026, null)).toBe("2026-000001");
  });

  it("increments within the year", () => {
    expect(nextInvoiceNumber(2026, "2026-000041")).toBe("2026-000042");
  });

  it("restarts when the previous number belongs to another year", () => {
    expect(nextInvoiceNumber(2026, "2025-000900")).toBe("2026-000001");
  });

  it("matches the prefix the lookup searches on", () => {
    expect(nextInvoiceNumber(2026, null).startsWith(invoiceNumberPrefix(2026))).toBe(true);
  });
});

describe("monthBounds", () => {
  it("spans the whole month in UTC", () => {
    const { from, to } = monthBounds("2026-03");

    expect(from.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-03-31T00:00:00.000Z");
  });

  it("handles February in a leap year", () => {
    expect(monthBounds("2028-02").to.toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("handles December without rolling into the next year", () => {
    const { from, to } = monthBounds("2026-12");

    expect(from.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });
});

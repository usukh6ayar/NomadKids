import Decimal from "decimal.js";

/**
 * The nine financial reports — `нэмэлт.md` §16.
 *
 * ★ Pure shaping, no database and no Excel. The repository fetches, this
 * decides what each report *is*, and `finance-report-workbook.ts` decides how
 * it looks in a spreadsheet. That split is what lets the definitions be tested
 * exhaustively without fixtures or file parsing — the same argument
 * `invoice-math.ts` makes.
 *
 * ★★ Every amount stays a decimal **string** end to end. A report is the
 * document somebody reconciles a bank statement against; a float here would
 * surface as a total that disagrees with the invoices beneath it by a tögrög.
 */

/** The report keys, as the API names them. */
export const FINANCE_REPORTS = [
  /** Сарын улсын санхүүжилтийн тайлан */
  "state-funding",
  /** Хүүхэд тус бүрийн санхүүжилтийн тайлан */
  "child-funding",
  /** Хооллосон өдөр–хоолны зардлын тайлан */
  "meal-days",
  /** Сарын хоолны зардлын тайлан */
  "meal-cost",
  /** Эцэг эхийн төлбөрийн тайлан */
  "parent-payments",
  /** Төлөгдөөгүй төлбөрийн тайлан */
  "unpaid",
  /** Санхүүжилтийн зөрүүний тайлан */
  "variance",
  /** Хичээлийн жилийн санхүүгийн нэгтгэл */
  "annual",
] as const;

export type FinanceReportKey = (typeof FINANCE_REPORTS)[number];

/**
 * ★ "Ирц–санхүүжилтийн тулгалт" — §16's third bullet — is deliberately absent.
 *
 * It is the monthly register, which shipped with §6 and already exports to
 * Excel (`FundingService.exportRegister`). Adding a ninth key here would give
 * the product two answers to one question, and the second would drift from the
 * screen the accountant actually reconciles against.
 */
export const REPORT_TITLE: Record<FinanceReportKey, string> = {
  "state-funding": "Сарын улсын санхүүжилтийн тайлан",
  "child-funding": "Хүүхэд тус бүрийн санхүүжилтийн тайлан",
  "meal-days": "Хооллосон өдөр–хоолны зардлын тайлан",
  "meal-cost": "Сарын хоолны зардлын тайлан",
  "parent-payments": "Эцэг эхийн төлбөрийн тайлан",
  unpaid: "Төлөгдөөгүй төлбөрийн тайлан",
  variance: "Санхүүжилтийн зөрүүний тайлан",
  annual: "Хичээлийн жилийн санхүүгийн нэгтгэл",
};

const ZERO = new Decimal(0);

/** A calculation row, as the repository returns it. */
export interface CalculationRow {
  source: string;
  daysAttended: number;
  daysFed: number;
  dailyRate: { toString(): string } | null;
  calculatedAmount: { toString(): string };
  approvedAmount: { toString(): string } | null;
  receivedAmount: { toString(): string } | null;
  note: string | null;
  child: { id: string; lastName: string | null; firstName: string };
  fundingRule: { name: string; dependsOnMeals: boolean } | null;
}

/** An invoice with what has been paid against it. */
export interface InvoiceRow {
  number: string;
  month: Date;
  status: string;
  discountAmount: { toString(): string };
  totalAmount: { toString(): string };
  dueDate: Date | null;
  paidAmount: { toString(): string };
  outstanding: { toString(): string };
  child: { id: string; lastName: string | null; firstName: string };
}

export interface ReportColumn {
  key: string;
  header: string;
  /** Rendered as tögrög in Excel and right-aligned everywhere. */
  money?: boolean;
  width?: number;
}

export interface ReportTable {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  /** The bold row at the foot. Absent when a total would be meaningless. */
  totals?: Record<string, string | number | null>;
  /** Shown under the title — what the reader needs to interpret the figures. */
  note?: string;
}

const name = (child: { lastName: string | null; firstName: string }) =>
  `${child.lastName ?? ""} ${child.firstName}`.trim();

/**
 * ★ `reduce<Decimal>` explicitly. Without the type argument TypeScript infers
 * the accumulator from the *element* type — `{ toString(): string }` — and the
 * whole file stops compiling on `.add`. The annotation is what says "this fold
 * produces a Decimal", not "it produces another row".
 */
const sum = (values: { toString(): string }[]): Decimal =>
  values.reduce<Decimal>((total, value) => total.add(new Decimal(value.toString())), ZERO);

/** Сарын улсын санхүүжилтийн тайлан — §16's first. */
export function stateFundingReport(rows: CalculationRow[]): ReportTable {
  const state = rows.filter((row) => row.source === "STATE");

  return {
    title: REPORT_TITLE["state-funding"],
    columns: [
      { key: "child", header: "Хүүхэд", width: 26 },
      { key: "daysAttended", header: "Ирсэн өдөр", width: 12 },
      { key: "dailyRate", header: "Өдрийн тариф", money: true, width: 14 },
      { key: "calculated", header: "Тооцсон", money: true, width: 15 },
      { key: "approved", header: "Баталгаажсан", money: true, width: 15 },
      { key: "received", header: "Хүлээн авсан", money: true, width: 15 },
    ],
    rows: state.map((row) => ({
      child: name(row.child),
      daysAttended: row.daysAttended,
      dailyRate: row.dailyRate?.toString() ?? null,
      calculated: row.calculatedAmount.toString(),
      approved: row.approvedAmount?.toString() ?? null,
      received: row.receivedAmount?.toString() ?? null,
    })),
    totals: {
      child: `${state.length} хүүхэд`,
      daysAttended: state.reduce((total, row) => total + row.daysAttended, 0),
      calculated: sum(state.map((row) => row.calculatedAmount)).toFixed(2),
      approved: sum(
        state.flatMap((row) => (row.approvedAmount ? [row.approvedAmount] : [])),
      ).toFixed(2),
      received: sum(
        state.flatMap((row) => (row.receivedAmount ? [row.receivedAmount] : [])),
      ).toFixed(2),
    },
  };
}

/**
 * Хүүхэд тус бүрийн санхүүжилтийн тайлан — §16's second.
 *
 * ★ One row per child, with every source folded in. The state report above is
 * per *calculation*; a child funded from two sources appears twice there and
 * once here, which is the difference between "what did we claim" and "what is
 * this child worth to us".
 */
export function childFundingReport(rows: CalculationRow[]): ReportTable {
  const byChild = new Map<
    string,
    { child: CalculationRow["child"]; sources: Set<string>; days: number; total: Decimal }
  >();

  for (const row of rows) {
    const existing = byChild.get(row.child.id) ?? {
      child: row.child,
      sources: new Set<string>(),
      days: 0,
      total: ZERO,
    };

    existing.sources.add(row.source);
    // The maximum, not the sum: two sources funding the same child cover the
    // same days, and adding them would report a month with 40 attended days.
    existing.days = Math.max(existing.days, row.daysAttended);
    existing.total = existing.total.add(new Decimal(row.calculatedAmount.toString()));
    byChild.set(row.child.id, existing);
  }

  const entries = [...byChild.values()].sort((a, b) =>
    name(a.child).localeCompare(name(b.child), "mn"),
  );

  return {
    title: REPORT_TITLE["child-funding"],
    columns: [
      { key: "child", header: "Хүүхэд", width: 26 },
      { key: "sources", header: "Эх үүсвэр", width: 22 },
      { key: "days", header: "Ирсэн өдөр", width: 12 },
      { key: "total", header: "Нийт санхүүжилт", money: true, width: 17 },
    ],
    rows: entries.map((entry) => ({
      child: name(entry.child),
      sources: [...entry.sources].join(", "),
      days: entry.days,
      total: entry.total.toFixed(2),
    })),
    totals: {
      child: `${entries.length} хүүхэд`,
      total: entries.reduce((total, entry) => total.add(entry.total), ZERO).toFixed(2),
    },
  };
}

/**
 * Хооллосон өдөр–хоолны зардлын тайлан — §16's fourth.
 *
 * ★ Only rows whose rule billed on meals. A tuition rule multiplied by attended
 * days is not a meal cost; including it would make the per-day figure — the one
 * a kitchen budget is set from — meaningless.
 */
export function mealDaysReport(rows: CalculationRow[]): ReportTable {
  const meals = rows.filter((row) => row.fundingRule?.dependsOnMeals);

  return {
    title: REPORT_TITLE["meal-days"],
    columns: [
      { key: "child", header: "Хүүхэд", width: 26 },
      { key: "daysFed", header: "Хооллосон өдөр", width: 15 },
      { key: "dailyRate", header: "Өдрийн тариф", money: true, width: 14 },
      { key: "cost", header: "Хоолны зардал", money: true, width: 16 },
    ],
    rows: meals.map((row) => ({
      child: name(row.child),
      daysFed: row.daysFed,
      dailyRate: row.dailyRate?.toString() ?? null,
      cost: row.calculatedAmount.toString(),
    })),
    totals: {
      child: `${new Set(meals.map((row) => row.child.id)).size} хүүхэд`,
      daysFed: meals.reduce((total, row) => total + row.daysFed, 0),
      cost: sum(meals.map((row) => row.calculatedAmount)).toFixed(2),
    },
    note: "Зөвхөн хоолны хэрэглээнээс хамаарах дүрмээр бодогдсон мөрүүд.",
  };
}

/** Сарын хоолны зардлын тайлан — §16's fifth: the same rows, by source. */
export function mealCostReport(rows: CalculationRow[]): ReportTable {
  const meals = rows.filter((row) => row.fundingRule?.dependsOnMeals);

  const bySource = new Map<string, { days: number; children: Set<string>; total: Decimal }>();
  for (const row of meals) {
    const entry = bySource.get(row.source) ?? {
      days: 0,
      children: new Set<string>(),
      total: ZERO,
    };
    entry.days += row.daysFed;
    entry.children.add(row.child.id);
    entry.total = entry.total.add(new Decimal(row.calculatedAmount.toString()));
    bySource.set(row.source, entry);
  }

  const total = sum(meals.map((row) => row.calculatedAmount));
  const children = new Set(meals.map((row) => row.child.id)).size;

  return {
    title: REPORT_TITLE["meal-cost"],
    columns: [
      { key: "source", header: "Эх үүсвэр", width: 22 },
      { key: "children", header: "Хүүхэд", width: 10 },
      { key: "days", header: "Хооллосон өдөр", width: 15 },
      { key: "total", header: "Зардал", money: true, width: 16 },
      { key: "perChild", header: "Нэг хүүхдэд", money: true, width: 15 },
    ],
    rows: [...bySource].map(([source, entry]) => ({
      source,
      children: entry.children.size,
      days: entry.days,
      total: entry.total.toFixed(2),
      // Divided by the children who ate under *this* source, the same rule the
      // dashboard applies: enrolment is a larger, different number.
      perChild: entry.children.size > 0 ? entry.total.div(entry.children.size).toFixed(2) : "0.00",
    })),
    totals: {
      source: "Нийт",
      children,
      days: meals.reduce((sumDays, row) => sumDays + row.daysFed, 0),
      total: total.toFixed(2),
      perChild: children > 0 ? total.div(children).toFixed(2) : "0.00",
    },
  };
}

/** Эцэг эхийн төлбөрийн тайлан — §16's sixth. */
export function parentPaymentsReport(invoices: InvoiceRow[]): ReportTable {
  return {
    title: REPORT_TITLE["parent-payments"],
    columns: [
      { key: "child", header: "Хүүхэд", width: 26 },
      { key: "number", header: "Нэхэмжлэл", width: 15 },
      { key: "billed", header: "Нэхэмжилсэн", money: true, width: 15 },
      { key: "discount", header: "Хөнгөлөлт", money: true, width: 14 },
      { key: "paid", header: "Төлсөн", money: true, width: 15 },
      { key: "outstanding", header: "Үлдэгдэл", money: true, width: 15 },
    ],
    rows: invoices.map((invoice) => ({
      child: name(invoice.child),
      number: invoice.number,
      billed: invoice.totalAmount.toString(),
      discount: invoice.discountAmount.toString(),
      paid: invoice.paidAmount.toString(),
      outstanding: invoice.outstanding.toString(),
    })),
    totals: {
      child: `${invoices.length} нэхэмжлэл`,
      billed: sum(invoices.map((invoice) => invoice.totalAmount)).toFixed(2),
      discount: sum(invoices.map((invoice) => invoice.discountAmount)).toFixed(2),
      paid: sum(invoices.map((invoice) => invoice.paidAmount)).toFixed(2),
      outstanding: sum(invoices.map((invoice) => invoice.outstanding)).toFixed(2),
    },
  };
}

/**
 * Төлөгдөөгүй төлбөрийн тайлан — §16's seventh.
 *
 * ★ Every month, not the selected one, and sorted by how late each bill is.
 * Arrears are not a property of the month being viewed, and the accountant's
 * first question is which family is furthest behind.
 */
export function unpaidReport(invoices: InvoiceRow[], asOf: Date): ReportTable {
  const owing = invoices
    .filter((invoice) => new Decimal(invoice.outstanding.toString()).greaterThan(0))
    .map((invoice) => ({
      invoice,
      daysLate: invoice.dueDate
        ? Math.max(0, Math.floor((asOf.getTime() - invoice.dueDate.getTime()) / 86_400_000))
        : 0,
    }))
    .sort((a, b) => b.daysLate - a.daysLate);

  return {
    title: REPORT_TITLE.unpaid,
    columns: [
      { key: "child", header: "Хүүхэд", width: 26 },
      { key: "number", header: "Нэхэмжлэл", width: 15 },
      { key: "month", header: "Сар", width: 10 },
      { key: "dueDate", header: "Төлөх хугацаа", width: 14 },
      { key: "daysLate", header: "Хоцорсон хоног", width: 15 },
      { key: "outstanding", header: "Үлдэгдэл", money: true, width: 15 },
    ],
    rows: owing.map(({ invoice, daysLate }) => ({
      child: name(invoice.child),
      number: invoice.number,
      month: invoice.month.toISOString().slice(0, 7),
      dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? "—",
      daysLate: daysLate > 0 ? daysLate : "—",
      outstanding: invoice.outstanding.toString(),
    })),
    totals: {
      child: `${owing.length} нэхэмжлэл`,
      outstanding: sum(owing.map(({ invoice }) => invoice.outstanding)).toFixed(2),
    },
    note: "Бүх сарын дүнгээр. Хугацаа хэтэрсэн нь эхэнд.",
  };
}

/**
 * Санхүүжилтийн зөрүүний тайлан — §16's eighth.
 *
 * ★ Only rows where the three figures disagree. A variance report listing every
 * child would bury the ten that need chasing among three hundred that do not;
 * §6 stores all three amounts precisely so the gaps can be found.
 */
export function varianceReport(rows: CalculationRow[]): ReportTable {
  const varied = rows
    .map((row) => {
      const calculated = new Decimal(row.calculatedAmount.toString());
      const approved = row.approvedAmount ? new Decimal(row.approvedAmount.toString()) : null;
      const received = row.receivedAmount ? new Decimal(row.receivedAmount.toString()) : null;

      return {
        row,
        calculated,
        approved,
        received,
        /** What was claimed but not confirmed. */
        approvalGap: approved ? calculated.sub(approved) : calculated,
        /** What was confirmed but has not arrived. */
        paymentGap: approved && received ? approved.sub(received) : (approved ?? ZERO),
      };
    })
    .filter((entry) => !entry.approvalGap.isZero() || !entry.paymentGap.isZero());

  return {
    title: REPORT_TITLE.variance,
    columns: [
      { key: "child", header: "Хүүхэд", width: 26 },
      { key: "source", header: "Эх үүсвэр", width: 20 },
      { key: "calculated", header: "Тооцсон", money: true, width: 15 },
      { key: "approved", header: "Баталгаажсан", money: true, width: 15 },
      { key: "received", header: "Хүлээн авсан", money: true, width: 15 },
      { key: "approvalGap", header: "Батлагдаагүй", money: true, width: 15 },
      { key: "paymentGap", header: "Ирээгүй", money: true, width: 15 },
      { key: "note", header: "Тайлбар", width: 30 },
    ],
    rows: varied.map((entry) => ({
      child: name(entry.row.child),
      source: entry.row.source,
      calculated: entry.calculated.toFixed(2),
      approved: entry.approved?.toFixed(2) ?? null,
      received: entry.received?.toFixed(2) ?? null,
      approvalGap: entry.approvalGap.toFixed(2),
      paymentGap: entry.paymentGap.toFixed(2),
      note: entry.row.note ?? "",
    })),
    totals: {
      child: `${varied.length} зөрүү`,
      approvalGap: varied.reduce((total, entry) => total.add(entry.approvalGap), ZERO).toFixed(2),
      paymentGap: varied.reduce((total, entry) => total.add(entry.paymentGap), ZERO).toFixed(2),
    },
    note: "Зөвхөн зөрүүтэй мөрүүд. Бүрэн хүлээн авсан тооцоо энд харагдахгүй.",
  };
}

/** A month's aggregate, as the annual rollup receives it. */
export interface MonthAggregate {
  month: Date;
  source: string;
  children: number;
  calculated: { toString(): string } | null;
  approved: { toString(): string } | null;
  received: { toString(): string } | null;
}

/** Хичээлийн жилийн санхүүгийн нэгтгэл — §16's ninth. */
export function annualReport(months: MonthAggregate[]): ReportTable {
  const byMonth = new Map<
    string,
    { children: number; calculated: Decimal; approved: Decimal; received: Decimal }
  >();

  for (const row of months) {
    const key = row.month.toISOString().slice(0, 7);
    const entry = byMonth.get(key) ?? {
      children: 0,
      calculated: ZERO,
      approved: ZERO,
      received: ZERO,
    };

    // The largest source's headcount, not the sum: a child funded from two
    // sources is one child.
    entry.children = Math.max(entry.children, row.children);
    entry.calculated = entry.calculated.add(new Decimal(row.calculated?.toString() ?? "0"));
    entry.approved = entry.approved.add(new Decimal(row.approved?.toString() ?? "0"));
    entry.received = entry.received.add(new Decimal(row.received?.toString() ?? "0"));
    byMonth.set(key, entry);
  }

  const entries = [...byMonth].sort(([a], [b]) => a.localeCompare(b));

  return {
    title: REPORT_TITLE.annual,
    columns: [
      { key: "month", header: "Сар", width: 12 },
      { key: "children", header: "Хүүхэд", width: 10 },
      { key: "calculated", header: "Тооцсон", money: true, width: 16 },
      { key: "approved", header: "Баталгаажсан", money: true, width: 16 },
      { key: "received", header: "Хүлээн авсан", money: true, width: 16 },
      { key: "pending", header: "Хүлээгдэж буй", money: true, width: 16 },
    ],
    rows: entries.map(([month, entry]) => ({
      month,
      children: entry.children,
      calculated: entry.calculated.toFixed(2),
      approved: entry.approved.toFixed(2),
      received: entry.received.toFixed(2),
      pending: entry.approved.sub(entry.received).toFixed(2),
    })),
    totals: {
      month: `${entries.length} сар`,
      calculated: entries.reduce((total, [, e]) => total.add(e.calculated), ZERO).toFixed(2),
      approved: entries.reduce((total, [, e]) => total.add(e.approved), ZERO).toFixed(2),
      received: entries.reduce((total, [, e]) => total.add(e.received), ZERO).toFixed(2),
      pending: entries
        .reduce((total, [, e]) => total.add(e.approved.sub(e.received)), ZERO)
        .toFixed(2),
    },
  };
}

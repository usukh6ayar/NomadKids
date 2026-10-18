import { describe, expect, it } from "vitest";
import type { ServiceInvoiceParams } from "./report-params";
import { renderServiceInvoiceHtml } from "./service-invoice-template";

/** Asserted on the text, not on a file existing (CLAUDE.md §4.3). */
function text(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

const base: ServiceInvoiceParams = {
  period: "YEAR",
  months: 9,
  groupCount: 13,
  perGroupMonthlyFee: "0",
  perGroupAmount: null,
  periodLabel: "Гэрээ №NK-2026-000001 (2026.09.01 – 2027.05.31)",
  amount: "270000.00",
  kindergartenName: "4-р цэцэрлэг",
  contractNumber: "NK-2026-000001",
  contractPaymentId: "11111111-1111-4111-8111-111111111111",
  issuedOn: "2026-10-18",
  bank: { name: "Хаан банк", account: "5000000000", holder: "NomadKids ХХК" },
};

describe("the service invoice", () => {
  // ★ 2026-10-18: a negotiated sum that does not divide by the groups.
  it("prints «—» for one group's price rather than a figure that does not add up", () => {
    const out = text(renderServiceInvoiceHtml(base));

    expect(out).toContain("Гэрээ №NK-2026-000001 (2026.09.01 – 2027.05.31)");
    expect(out).toContain("13 — 270 000₮");
    expect(out).toContain("Нийт төлөх дүн 270 000₮");
    expect(out).toContain("5000000000");
    expect(out).not.toContain("20 769");
  });

  it("prints one group's price when it divides", () => {
    const out = text(
      renderServiceInvoiceHtml({
        ...base,
        groupCount: 2,
        perGroupAmount: "30000.00",
        amount: "60000.00",
      }),
    );
    expect(out).toContain("2 30 000₮ 60 000₮");
  });
});

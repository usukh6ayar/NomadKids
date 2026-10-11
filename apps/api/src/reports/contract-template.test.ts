import { describe, expect, it } from "vitest";
import { renderContractHtml, type ContractData } from "./contract-template";

/**
 * The contract's terms table, read as text (CLAUDE.md §4.3) — in both
 * generations of pricing. A per-group contract (since #195, 2026-10-11) must
 * not print the per-child rows, and an old per-child contract re-rendered must
 * still say what was signed.
 */

const BASE: Omit<ContractData, "terms"> = {
  number: "NK-2026-000001",
  version: 1,
  kindergartenName: "Аз жаргал цэцэрлэг",
  registrationNumber: "9012345",
  address: null,
  directorName: "Дорж Сараа",
  phone: "99112233",
  email: "azjargal@example.mn",
  startsOn: new Date("2026-09-01T00:00:00Z"),
  endsOn: new Date("2027-05-31T00:00:00Z"),
  generatedAt: new Date("2026-10-11T00:00:00Z"),
};

/** The visible text, tags dropped and whitespace collapsed. */
function text(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

describe("renderContractHtml", () => {
  it("prints a per-group contract's groups, period, rate and total", () => {
    const out = text(
      renderContractHtml({
        ...BASE,
        terms: {
          kind: "perGroup",
          groupCount: 6,
          billingPeriod: "YEAR",
          perGroupMonthlyFee: "4000.00",
          periodFee: "204000.00",
        },
      }),
    );

    expect(out).toContain("Бүлгийн тоо 6");
    expect(out).toContain("Төлбөрийн хугацаа Хичээлийн жил");
    expect(out).toContain("Бүлэг/сар 4 000₮");
    expect(out).toContain("Нийт төлбөр 204 000₮");
    expect(out).not.toContain("Хүүхдийн тоо");
    expect(out).not.toContain("Хүүхэд/сар");
    // No address was asked for, so no empty «Хаяг» row is printed.
    expect(out).not.toContain("Хаяг");
  });

  it("prints an older per-child contract exactly as it was signed", () => {
    const out = text(
      renderContractHtml({
        ...BASE,
        address: "Дархан",
        terms: {
          kind: "perChild",
          childCount: 120,
          annualFee: "300000.00",
          perChildMonthlyFee: "1500.00",
        },
      }),
    );

    expect(out).toContain("Хаяг Дархан");
    expect(out).toContain("Хүүхдийн тоо 120");
    expect(out).toContain("Суурь хураамж (жилд) 300 000₮");
    expect(out).toContain("Хүүхэд/сар 1 500₮");
    expect(out).not.toContain("Бүлгийн тоо");
  });
});

import { describe, expect, it } from "vitest";
import { workingDaysInMonth } from "./working-days";

/**
 * The client's own worked example, 2026-09-12: "9 сард бямба ням гарагт
 * ажиллахгүй, бас нийтээр амрах баяр тохиолдоогүй учир ажлын 22 хоногтой."
 */
describe("workingDaysInMonth", () => {
  it("counts the client's September", () => {
    expect(workingDaysInMonth("2026-09")).toBe(22);
  });

  it("leaves out Saturdays and Sundays", () => {
    // February 2026 begins on a Sunday and has 28 days: exactly 20 weekdays.
    expect(workingDaysInMonth("2026-02")).toBe(20);
  });

  /*
    ★ Наадам takes five days off July, but only the ones that were weekdays.

    11–15 July 2026 is Saturday to Wednesday, so three of the five fall on a
    working day and July drops from 23 to 20.
  */
  it("takes the national holidays off", () => {
    expect(workingDaysInMonth("2026-07")).toBe(20);
  });

  it("takes nothing off for a holiday that lands on a weekend", () => {
    // 1 January 2028 is a Saturday — never worked, so there is nothing to
    // subtract and the month is its plain weekday count.
    expect(workingDaysInMonth("2028-01")).toBe(21);
  });

  it("reads a month it cannot parse as nothing, rather than as zero", () => {
    expect(workingDaysInMonth("2026-13")).toBeNull();
    expect(workingDaysInMonth("нэгдүгээр сар")).toBeNull();
    expect(workingDaysInMonth("")).toBeNull();
  });
});

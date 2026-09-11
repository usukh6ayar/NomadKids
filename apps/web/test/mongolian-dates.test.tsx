import { describe, expect, it } from "vitest";
import { formatLongDate, formatWeekday } from "@/lib/format";

/**
 * Dates in Mongolian, written out rather than asked of `Intl`.
 *
 * ★ The regression this exists for is invisible on a developer's machine.
 *
 * `toLocaleDateString("mn-MN", { weekday: "long" })` needs full ICU. A Node
 * build without it answers in *English* and throws nothing — so the teacher's
 * dashboard greeted them with "2026.09.10 · Thursday" while every local check
 * said Пүрэв. Seven strings cannot regress on a different server, and these
 * cases pin them.
 */

describe("Mongolian dates", () => {
  it("names every weekday, Sunday first — `getDay()` calls it 0", () => {
    // 2026-09-06 is a Sunday; the week runs from there.
    const expected = ["Ням", "Даваа", "Мягмар", "Лхагва", "Пүрэв", "Баасан", "Бямба"];

    expected.forEach((name, index) => {
      const day = new Date(2026, 8, 6 + index);
      expect(formatWeekday(day), `day ${index}`).toBe(name);
    });
  });

  it("never answers in English, whatever the runtime's ICU", () => {
    expect(formatWeekday(new Date(2026, 8, 10))).toBe("Пүрэв");
    expect(formatWeekday(new Date(2026, 8, 10))).not.toMatch(/[A-Za-z]/);
  });

  it("writes the date the way it is read aloud", () => {
    expect(formatLongDate(new Date(2026, 8, 10))).toBe("2026 оны 9-р сарын 10");
  });

  it("says so rather than inventing a day for nothing", () => {
    expect(formatWeekday(null)).toBe("—");
    expect(formatLongDate(undefined)).toBe("—");
  });
});

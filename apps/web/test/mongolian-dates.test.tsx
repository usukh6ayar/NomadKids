import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { formatDayMonthLong, formatLongDate, formatWeekday } from "@/lib/format";
import { MonthSelect } from "@/components/ui/month-select";

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

  /**
   * ★ The short form is Mongolian too, and `9/15` is not.
   *
   * A note card carries the day inside a list already scoped to a school year,
   * so the year is dropped and the month is still written out — the numeric
   * `formatDayMonth` stays for axis ticks, where the label has to be two
   * glyphs wide.
   */
  it("writes a day without its year in Mongolian", () => {
    expect(formatDayMonthLong(new Date(2026, 8, 15))).toBe("9-р сарын 15");
    expect(formatDayMonthLong(new Date(2026, 11, 1))).toBe("12-р сарын 1");
    expect(formatDayMonthLong(null)).toBe("—");
  });

  it("says so rather than inventing a day for nothing", () => {
    expect(formatWeekday(null)).toBe("—");
    expect(formatLongDate(undefined)).toBe("—");
  });

  it("renders browser-independent Mongolian month names", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <MonthSelect
        aria-label="Сар"
        min="2026-01"
        max="2026-12"
        value="2026-09"
        onValueChange={onValueChange}
      />,
    );

    const picker = screen.getByRole("combobox", { name: "Сар" });
    expect(picker).toHaveTextContent("2026 оны 9-р сар");
    expect(picker).not.toHaveTextContent("September");

    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: "2026 оны 8-р сар" }));
    expect(onValueChange).toHaveBeenCalledWith("2026-08");
  });
});

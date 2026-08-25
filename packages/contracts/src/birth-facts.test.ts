import { describe, expect, test } from "vitest";
import { ageInYears, birthFacts, mongolianYearAnimal, westernZodiac } from "./birth-facts";

describe("ageInYears", () => {
  test("counts completed years", () => {
    expect(ageInYears("2021-06-01", "2026-06-01")).toBe(5);
    expect(ageInYears("2021-06-01", "2026-05-31")).toBe(4);
    expect(ageInYears("2021-06-01", "2026-06-02")).toBe(5);
  });

  /**
   * The case a millisecond division gets wrong. 365.25 days per year is 0.75
   * days short over five years, so a child turning five today reads as four.
   */
  test("a child is their new age on the birthday itself", () => {
    expect(ageInYears("2020-02-29", "2025-02-28")).toBe(4);
    expect(ageInYears("2020-02-29", "2025-03-01")).toBe(5);
  });

  test("never returns a negative age for a mistyped future date", () => {
    expect(ageInYears("2030-01-01", "2026-08-25")).toBe(0);
  });
});

describe("westernZodiac", () => {
  test("names the sign in Mongolian", () => {
    expect(westernZodiac("2021-07-04").name).toBe("Хавч");
    expect(westernZodiac("2021-11-30").name).toBe("Нумч");
  });

  /**
   * The boundary days are the whole difficulty — an off-by-one puts a child in
   * the neighbouring sign, and a table read in the wrong direction shifts every
   * one of them.
   */
  test.each([
    ["2022-03-20", "Загас"],
    ["2022-03-21", "Хонь"],
    ["2022-04-19", "Хонь"],
    ["2022-04-20", "Үхэр"],
    ["2022-12-21", "Нумч"],
    ["2022-12-22", "Матар"],
  ])("%s is %s", (date, name) => {
    expect(westernZodiac(date).name).toBe(name);
  });

  /** Матар spans the new year, which is the one sign a linear scan can drop. */
  test("wraps across the new year", () => {
    expect(westernZodiac("2022-12-31").code).toBe("capricorn");
    expect(westernZodiac("2023-01-01").code).toBe("capricorn");
    expect(westernZodiac("2023-01-19").code).toBe("capricorn");
    expect(westernZodiac("2023-01-20").code).toBe("aquarius");
  });
});

describe("mongolianYearAnimal", () => {
  test.each([
    [2020, "Хулгана"],
    [2021, "Үхэр"],
    [2022, "Бар"],
    [2023, "Туулай"],
    [2024, "Луу"],
    [2025, "Могой"],
    [2026, "Морь"],
    [2031, "Гахай"],
    [2032, "Хулгана"],
  ])("%i is the year of the %s", (year, name) => {
    expect(mongolianYearAnimal(`${year}-06-15`).name).toBe(name);
  });

  /** Years before the anchor exercise JavaScript's negative remainder. */
  test("handles years before 2020", () => {
    expect(mongolianYearAnimal("2019-06-15").name).toBe("Гахай");
    expect(mongolianYearAnimal("2008-06-15").name).toBe("Хулгана");
  });

  test("flags the window Цагаан сар can fall in, and only that window", () => {
    expect(mongolianYearAnimal("2024-01-04").beforeLunarNewYear).toBe(true);
    expect(mongolianYearAnimal("2024-02-28").beforeLunarNewYear).toBe(true);
    expect(mongolianYearAnimal("2024-03-15").beforeLunarNewYear).toBe(true);
    expect(mongolianYearAnimal("2024-03-16").beforeLunarNewYear).toBe(false);
    expect(mongolianYearAnimal("2024-09-01").beforeLunarNewYear).toBe(false);
  });
});

describe("input shapes", () => {
  /**
   * ★ A `YYYY-MM-DD` string and the `Date` Prisma hands back must agree.
   *
   * `new Date("2024-03-21")` is midnight **UTC**; read with the local getters in
   * Ulaanbaatar that is still 21 March, but in any timezone west of UTC it is
   * the 20th — one day earlier, and one sign earlier across a boundary. This is
   * the case that makes the hand-rolled parser worth having.
   */
  test("a date string and an equivalent Date give the same answer", () => {
    expect(westernZodiac("2024-03-21")).toEqual(westernZodiac(new Date("2024-03-21T00:00:00Z")));
    expect(westernZodiac("2024-12-22")).toEqual(westernZodiac(new Date("2024-12-22T00:00:00Z")));
  });

  test("an ISO timestamp is accepted, and its date part is what counts", () => {
    expect(westernZodiac("2024-03-21T18:30:00.000Z").name).toBe("Хонь");
  });

  test("rejects a non-date rather than inventing a sign", () => {
    expect(() => westernZodiac("not a date")).toThrow(RangeError);
    expect(() => westernZodiac(new Date("nonsense"))).toThrow(RangeError);
  });
});

test("birthFacts returns both", () => {
  expect(birthFacts("2024-05-02")).toEqual({
    zodiac: { code: "taurus", name: "Үхэр" },
    yearAnimal: { code: "dragon", name: "Луу", beforeLunarNewYear: false },
  });
});

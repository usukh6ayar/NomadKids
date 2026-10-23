import { describe, expect, it } from "vitest";
import { localDate } from "./local-date";
import {
  CHILD_PRICES,
  childTermPrice,
  groupTermPrice,
  schoolTermOn,
  FIRST_TERM_PROMO,
  GROUP_PRICES,
  TEACHER_PRICE,
  firstTermPromoOpen,
} from "./pricing";

/** The confirmed sheet — the client's «I-р улирал 2026» brief, 2026-10-18. */
describe("the price sheet", () => {
  it("prices a child at 3,000₮ a month, «I-р улирал» free (of 9,000₮), 18,000₮ (of 27,000₮) a year", () => {
    expect(CHILD_PRICES).toEqual({
      monthly: 3_000,
      termStandard: 9_000,
      termPromo: 0,
      yearStandard: 27_000,
      year: 18_000,
    });
  });

  it("prices a group at 4,000₮ a month, 4,000₮ (of 12,000₮) for «I-р улирал» and 28,000₮ (of 36,000₮) a year", () => {
    expect(GROUP_PRICES).toEqual({
      monthly: 4_000,
      termStandard: 12_000,
      termPromo: 4_000,
      yearStandard: 36_000,
      year: 28_000,
    });
  });

  it("charges a teacher nothing", () => {
    expect(TEACHER_PRICE).toBe(0);
  });
});

describe("«I-р улирал» ends on a fixed day", () => {
  it("ends on 2026-11-30 whatever day it is bought", () => {
    expect(FIRST_TERM_PROMO.endsOn).toBe("2026-11-30");
  });

  it("is sold through 30 November inclusive, and not from 1 December", () => {
    expect(firstTermPromoOpen("2026-10-18")).toBe(true);
    expect(firstTermPromoOpen("2026-11-29")).toBe(true);
    expect(firstTermPromoOpen("2026-11-30")).toBe(true);
    expect(firstTermPromoOpen("2026-12-01")).toBe(false);
  });

  it("reads the day in Ulaanbaatar — 1 December begins at 16:00 UTC on the 30th", () => {
    expect(firstTermPromoOpen(localDate(new Date("2026-11-30T15:59:00.000Z")))).toBe(true);
    expect(firstTermPromoOpen(localDate(new Date("2026-11-30T16:00:00.000Z")))).toBe(false);
  });
});

/* ★ After «I-р улирал», II and III at the standard price (the user, 2026-10-18). */
describe("the terms after «I-р улирал»", () => {
  it("finds the calendar term of a day, and none in summer", () => {
    expect(schoolTermOn("2026-10-18")).toMatchObject({ number: 1, endsOn: "2026-11-30" });
    expect(schoolTermOn("2026-12-01")).toMatchObject({ number: 2, endsOn: "2027-02-28" });
    expect(schoolTermOn("2028-02-29")).toMatchObject({ number: 2, endsOn: "2028-02-29" });
    expect(schoolTermOn("2027-03-01")).toMatchObject({ number: 3, endsOn: "2027-05-31" });
    expect(schoolTermOn("2027-07-01")).toBeNull();
  });

  it("prices II and III at 9,000₮ a child and 12,000₮ a group", () => {
    expect(childTermPrice(schoolTermOn("2026-10-18")!)).toBe(0);
    expect(childTermPrice(schoolTermOn("2026-12-01")!)).toBe(9_000);
    expect(childTermPrice(schoolTermOn("2027-04-01")!)).toBe(9_000);
    expect(groupTermPrice(schoolTermOn("2026-11-30")!)).toBe(4_000);
    expect(groupTermPrice(schoolTermOn("2026-12-01")!)).toBe(12_000);
    // Next year's first term is not the 2026 promotion.
    expect(childTermPrice(schoolTermOn("2027-10-01")!)).toBe(9_000);
  });
});

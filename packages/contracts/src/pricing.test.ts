import { describe, expect, it } from "vitest";
import { localDate } from "./local-date";
import {
  CHILD_PRICES,
  FIRST_TERM_PROMO,
  GROUP_PRICES,
  TEACHER_PRICE,
  firstTermPromoOpen,
} from "./pricing";

/** The confirmed sheet — the client's «I-р улирал 2026» brief, 2026-10-18. */
describe("the price sheet", () => {
  it("prices a child at 3,000₮ a month, 5,000₮ (of 9,000₮) a term, 22,000₮ (of 27,000₮) a year", () => {
    expect(CHILD_PRICES).toEqual({
      monthly: 3_000,
      termStandard: 9_000,
      termPromo: 5_000,
      yearStandard: 27_000,
      year: 22_000,
    });
  });

  it("prices a group at 4,000₮ a month, 6,000₮ (of 12,000₮) a term — not 2,000₮ — and 30,000₮ (of 36,000₮) a year", () => {
    expect(GROUP_PRICES).toEqual({
      monthly: 4_000,
      termStandard: 12_000,
      termPromo: 6_000,
      yearStandard: 36_000,
      year: 30_000,
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

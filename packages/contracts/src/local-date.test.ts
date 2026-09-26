import { describe, expect, it } from "vitest";
import { localDate, localMonth } from "./local-date";

/**
 * "Today" is Ulaanbaatar's today, not UTC's — 2026-09-26.
 *
 * Mongolia is UTC+8, so from midnight to 08:00 local the UTC date is still
 * yesterday. A teacher opening the register at 07:45 was shown yesterday, and
 * the API refused today's marks as "in the future".
 */
describe("localDate", () => {
  it("is already tomorrow's date at 07:30 in Ulaanbaatar", () => {
    // 23:30 UTC on the 5th is 07:30 on the 6th in Ulaanbaatar.
    expect(localDate(new Date("2026-03-05T23:30:00.000Z"))).toBe("2026-03-06");
  });

  it("agrees with UTC once both are past midnight", () => {
    expect(localDate(new Date("2026-03-06T04:00:00.000Z"))).toBe("2026-03-06");
  });

  it("turns the month over at local midnight", () => {
    expect(localMonth(new Date("2026-08-31T16:30:00.000Z"))).toBe("2026-09");
  });
});

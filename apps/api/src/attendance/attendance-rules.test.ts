import { describe, expect, it } from "vitest";
import { isFutureDate } from "./attendance-rules";

/**
 * ★ "Future" is measured against Ulaanbaatar's today — 2026-09-26.
 *
 * It compared UTC dates, so from local midnight to 08:00 today's register was
 * refused as a future date: the hour teachers take it.
 */
describe("isFutureDate", () => {
  // 23:30 UTC on the 5th is 07:30 on the 6th in Ulaanbaatar.
  const earlyMorning = new Date("2026-03-05T23:30:00.000Z");

  it("accepts today's date before 08:00 local", () => {
    expect(isFutureDate(new Date("2026-03-06T00:00:00.000Z"), earlyMorning)).toBe(false);
  });

  it("still refuses tomorrow", () => {
    expect(isFutureDate(new Date("2026-03-07T00:00:00.000Z"), earlyMorning)).toBe(true);
  });
});

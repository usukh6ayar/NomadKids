import { describe, expect, it } from "vitest";
import { quote } from "./service-access.service";

const contract = (endsOn: string) => ({
  perGroupMonthlyFee: "4000.00",
  endsOn: new Date(`${endsOn}T00:00:00.000Z`),
});

describe("quote — a year bought after the contract lapsed", () => {
  // `findPayment` keys the pending row on `coversFrom`; were it today, every
  // day would draw a new row and QR beside yesterday's (review of #270).
  it("starts on the same day all month, and charges from today", () => {
    const lapsed = contract("2026-09-30");
    const on22 = quote(lapsed, 1, "YEAR", "2026-10-22");
    const on23 = quote(lapsed, 1, "YEAR", "2026-10-23");

    expect(on22.coversFrom).toBe("2026-10-01");
    expect(on23.coversFrom).toBe("2026-10-01");
    expect(on22).toMatchObject({ months: 7, amount: "28000.00", coversTo: "2027-06-30" });
  });

  it("never starts before the old end", () => {
    expect(quote(contract("2026-10-15"), 1, "YEAR", "2026-10-22").coversFrom).toBe("2026-10-16");
  });
});

describe("quote — a year bought in May", () => {
  // «From the next month to May» leaves nothing after 1 May: months 0, which
  // `renewalRow` refuses to sell (review of #270, the user 2026-10-23).
  it("has nothing to charge from 2 May", () => {
    expect(quote(contract("2027-04-30"), 2, "YEAR", "2027-05-10")).toMatchObject({
      months: 0,
      amount: "0.00",
    });
  });

  it("still charges May itself when bought on the 1st", () => {
    expect(quote(contract("2027-04-30"), 1, "YEAR", "2027-05-01")).toMatchObject({
      coversFrom: "2027-05-01",
      coversTo: "2027-06-30",
      months: 1,
      amount: "4000.00",
    });
  });
});

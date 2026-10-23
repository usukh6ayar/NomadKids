import { describe, expect, it } from "vitest";
import { paymentStatus } from "./platform.service";

const d = (day: string) => new Date(`${day}T00:00:00.000Z`);

describe("paymentStatus", () => {
  it("is «Төлсөн» for a contract with no payment rows at all", () => {
    expect(paymentStatus("2027-05-31", [], "2026-10-23")).toBe("paid");
  });

  it("is due while a period covering today is unpaid", () => {
    const unpaid = [{ coversFrom: d("2026-10-20"), coversTo: d("2027-05-31") }];
    expect(paymentStatus("2027-05-31", unpaid, "2026-10-23")).toBe("due");
  });

  it("does not count a renewal owed after today", () => {
    const renewal = [{ coversFrom: d("2027-06-01"), coversTo: d("2027-11-30") }];
    expect(paymentStatus("2027-05-31", renewal, "2026-10-23")).toBe("paid");
  });

  it("is due within 14 days of the end, and overdue after it", () => {
    expect(paymentStatus("2026-11-01", [], "2026-10-23")).toBe("due");
    expect(paymentStatus("2026-10-22", [], "2026-10-23")).toBe("overdue");
  });
});

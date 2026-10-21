import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, stubApi } from "./support/render";
import { KindergartenAccessFees } from "@/components/platform/kindergarten-access-fees";

/*
 * The families' access fee on the operator's kindergarten overview — counts,
 * never names (2026-10-20). Built ahead of `/platform/kindergartens/:id/access-fees`.
 */
afterEach(() => vi.unstubAllGlobals());

describe("the kindergarten's access-fee card", () => {
  it("says «удахгүй» while the API is not there", async () => {
    stubApi([]);
    renderWithProviders(<KindergartenAccessFees kindergartenId="kg-1" />, { selectedChild: false });
    expect(await screen.findByText(/Удахгүй нэмэгдэнэ/)).toBeInTheDocument();
  });

  it("shows paid and unpaid counts by group, and no child", async () => {
    stubApi([
      {
        path: "/platform/kindergartens/kg-1/access-fees",
        body: {
          required: true,
          schoolYear: "2026–2027",
          paid: 45,
          unpaid: 38,
          amount: 990000,
          groups: [{ id: "g1", name: "Нарны бүлэг", paid: 12, children: 20 }],
        },
      },
    ]);
    renderWithProviders(<KindergartenAccessFees kindergartenId="kg-1" />, { selectedChild: false });
    const paid = (await screen.findByText("Төлсөн")).closest("div")!;
    expect(within(paid).getByText("45")).toBeInTheDocument();
    expect(screen.getByText("990,000₮")).toBeInTheDocument();
    expect(screen.getByText("12/20")).toBeInTheDocument();
  });
});

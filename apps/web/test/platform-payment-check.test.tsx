import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import PaymentCheckPage from "@/app/(app)/platform/payment-check/page";

/*
 * «Төлбөр шалгах» — the operator answering "I paid, check it" (2026-10-20).
 * Built ahead of `GET /platform/qpay/invoices`; contract in `lib/platform-qpay.ts`.
 */
afterEach(() => vi.unstubAllGlobals());

function operator() {
  const base = sessionFor([]);
  return { ...base, memberships: [], user: { ...base.user, isSuperAdmin: true } };
}

const pending = {
  id: "inv-1",
  number: "3F2A9C1B",
  kind: "ACCESS_FEE",
  status: "PENDING",
  amount: 22000,
  createdAt: "2026-10-12T06:32:00.000Z",
  paidAt: null,
  kindergarten: { id: "kg-1", name: "Нарны цэцэрлэг" },
  payerPhone: "99••••12",
  periodLabel: "2026–2027",
};
const page = (items: unknown[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 50,
  totalPages: 1,
});

describe("the operator's payment check", () => {
  it("says «удахгүй» while the API is not there", async () => {
    stubApi([{ path: "/auth/me", body: operator() }]);
    renderWithProviders(<PaymentCheckPage />, { selectedChild: false });
    expect(await screen.findByText("Удахгүй нэмэгдэнэ")).toBeInTheDocument();
  });

  it("shows a payment with a masked phone and what to tell the payer", async () => {
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/qpay/invoices", body: page([pending]) },
    ]);
    renderWithProviders(<PaymentCheckPage />, { selectedChild: false });
    const row = (await screen.findByText("3F2A9C1B")).closest("li")!;
    expect(within(row).getByText("Хүлээгдэж буй")).toBeInTheDocument();
    expect(within(row).getByText(/99••••12/)).toBeInTheDocument();
    expect(within(row).getByText(/«QPay-ээс дахин шалгах»-ыг дарна уу/)).toBeInTheDocument();
  });

  it("searches by the number the payer reads out", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/qpay/invoices", body: page([pending]) },
    ]);
    renderWithProviders(<PaymentCheckPage />, { selectedChild: false });
    await user.type(
      await screen.findByRole("searchbox", { name: "Төлбөрийн дугаар эсвэл утас" }),
      "3F2A9C1B",
    );
    await waitFor(() => expect(api.calls.some((c) => c.url.includes("q=3F2A9C1B"))).toBe(true));
  });

  it("asks QPay again and says when the payment has settled", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: operator() },
      {
        path: "/platform/qpay/invoices/inv-1/recheck",
        method: "POST",
        body: { ...pending, status: "PAID", paidAt: "2026-10-12T06:33:00.000Z" },
      },
      { path: "/platform/qpay/invoices", body: page([pending]) },
    ]);
    renderWithProviders(<PaymentCheckPage />, { selectedChild: false });
    await user.click(await screen.findByRole("button", { name: /QPay-ээс дахин шалгах/ }));
    await waitFor(() =>
      expect(
        api.calls.some(
          (c) => c.method === "POST" && c.url === "/platform/qpay/invoices/inv-1/recheck",
        ),
      ).toBe(true),
    );
    expect(await screen.findByText(/хандалт нээгдлээ/)).toBeInTheDocument();
  });
});

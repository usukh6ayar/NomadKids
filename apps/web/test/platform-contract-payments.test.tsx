import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import PlatformContractPaymentsPage from "@/app/(app)/platform/contract-payments/page";

/*
 * ★ «Гэрээний төлбөр» — the client, 2026-10-18: state kindergartens pay
 * against an invoice by bank transfer; the operator records it, and keeps the
 * number of the e-receipt issued on ebarimt by hand.
 */

function operator() {
  const base = sessionFor([]);
  return { ...base, memberships: [], user: { ...base.user, isSuperAdmin: true } };
}

const owed = {
  id: "55555555-5555-4555-8555-555555555555",
  kindergarten: { id: "k-1", name: "4-р цэцэрлэг" },
  contractNumber: "NK-2026-000001",
  initial: true,
  period: "year",
  coversFrom: "2026-09-01",
  coversTo: "2027-05-31",
  groupCount: 13,
  amount: "270000.00",
  status: "PENDING",
  method: null,
  paidAt: null,
  reference: null,
  ebarimtNumber: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("the operator's contract payments", () => {
  it("records a transfer seen on the statement", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/contract-payments", method: "GET", body: { items: [owed], total: 1 } },
    ]);
    renderWithProviders(<PlatformContractPaymentsPage />);

    expect(await screen.findByText("4-р цэцэрлэг")).toBeInTheDocument();
    expect(screen.getByText("270,000₮")).toBeInTheDocument();
    expect(screen.getByText("Хүлээгдэж буй", { selector: "span" })).toBeInTheDocument();

    const api = stubApi([
      { path: "/auth/me", body: operator() },
      {
        path: `/platform/contract-payments/${owed.id}/record`,
        method: "POST",
        status: 201,
        body: { id: owed.id, status: "PAID", amount: "270000.00", overlaps: false },
      },
      { path: "/platform/contract-payments", method: "GET", body: { items: [], total: 0 } },
    ]);
    await user.click(screen.getByRole("button", { name: "Дансаар хүлээн авсан" }));
    const dialog = screen.getByRole("dialog", { name: "Дансаар хүлээн авсан" });
    expect(within(dialog).getByLabelText(/Хүлээн авсан дүн/)).toHaveValue("270000");
    await user.type(within(dialog).getByLabelText(/Гүйлгээний утга/), "NK-2026-000001");
    await user.type(within(dialog).getByLabelText(/ebarimt-ын дугаар/), "EB-1");
    await user.click(within(dialog).getByRole("button", { name: "Бүртгэх" }));

    expect(await screen.findByText("Төлбөр бүртгэгдлээ.")).toBeInTheDocument();
    expect(
      api.calls.find((c) => c.method === "POST" && c.url.endsWith("/record"))?.body,
    ).toMatchObject({ amount: "270000", reference: "NK-2026-000001", ebarimtNumber: "EB-1" });
  });

  it("shows which paid periods still have no ebarimt, and keeps the number", async () => {
    const user = userEvent.setup();
    const paid = {
      ...owed,
      status: "PAID",
      method: "BANK_TRANSFER",
      paidAt: "2026-10-18T12:00:00.000Z",
    };
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/contract-payments", method: "GET", body: { items: [paid], total: 1 } },
    ]);
    renderWithProviders(<PlatformContractPaymentsPage />);

    expect(await screen.findByText("ebarimt гаргаагүй", { selector: "span" })).toBeInTheDocument();

    const api = stubApi([
      { path: "/auth/me", body: operator() },
      {
        path: `/platform/contract-payments/${owed.id}/ebarimt`,
        method: "PATCH",
        body: { id: owed.id, ebarimtNumber: "EB-77" },
      },
      { path: "/platform/contract-payments", method: "GET", body: { items: [], total: 0 } },
    ]);
    await user.click(screen.getByRole("button", { name: "ebarimt оруулах" }));
    const dialog = screen.getByRole("dialog", { name: "ebarimt-ын дугаар" });
    await user.type(within(dialog).getByLabelText(/ebarimt-ын дугаар/), "EB-77");
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    expect(await screen.findByText("ebarimt-ын дугаар хадгалагдлаа.")).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ ebarimtNumber: "EB-77" });
  });
});

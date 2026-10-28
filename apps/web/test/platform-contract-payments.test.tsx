import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, selectOption, sessionFor, stubApi } from "./support/render";
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

  /*
   * ★ «Эрх сунгах» — the user, 2026-10-28: a kindergarten that paid by
   * transfer without opening «Үйлчилгээний эрх» is recorded from the
   * kindergarten itself; the end comes suggested and may be moved, with a note.
   */
  it("extends a kindergarten's service from the kindergarten, with its end and a note", async () => {
    const user = userEvent.setup();
    const KG = "66666666-6666-4666-8666-666666666666";
    const api = stubApi([
      { path: "/auth/me", body: operator() },
      {
        path: "/platform/kindergartens",
        body: {
          items: [
            {
              id: KG,
              name: "4-р цэцэрлэг",
              isActive: true,
              createdAt: "2026-09-01T00:00:00.000Z",
            },
          ],
          page: 1,
          pageSize: 100,
          total: 1,
          totalPages: 1,
        },
      },
      {
        path: "/platform/contract-payments/extension",
        method: "GET",
        body: {
          kindergarten: { id: KG, name: "4-р цэцэрлэг" },
          contract: { id: "c-1", number: "NK-2026-000001", endsOn: "2026-09-30" },
          awaitingSignature: false,
          registeredGroups: 13,
          initialDue: null,
          groupCount: 13,
          options: {
            TERM: {
              coversFrom: "2026-09-01",
              coversTo: "2026-12-31",
              perGroup: "4000.00",
              amount: "52000.00",
              label: "I улирал",
            },
            YEAR: null,
          },
        },
      },
      {
        path: "/platform/contract-payments/extension",
        method: "POST",
        status: 201,
        body: { id: "p-1", status: "PAID", amount: "52000.00", overlaps: false },
      },
      { path: "/platform/contract-payments", method: "GET", body: { items: [], total: 0 } },
    ]);
    renderWithProviders(<PlatformContractPaymentsPage />);

    await user.click(await screen.findByRole("button", { name: "Эрх сунгах" }));
    await selectOption(user, /Цэцэрлэг/, "4-р цэцэрлэг");

    const dialog = screen.getByRole("dialog", { name: "Эрх сунгах" });
    const end = await within(dialog).findByLabelText(/Эрх дуусах огноо/);
    expect(end).toHaveValue("2026-12-31");
    expect(within(dialog).getByLabelText(/Хүлээн авсан дүн/)).toHaveValue("52000");
    await user.clear(end);
    await user.type(end, "2027-01-31");
    await user.type(within(dialog).getByLabelText(/Тэмдэглэл/), "Хаан банкны хуулга");
    await user.click(within(dialog).getByRole("button", { name: "Бүртгэж сунгах" }));

    expect(
      await screen.findByText("Эрх сунгагдаж, төлбөр орлогод бүртгэгдлээ."),
    ).toBeInTheDocument();
    expect(
      api.calls.find((c) => c.method === "POST" && c.url.endsWith("/extension"))?.body,
    ).toMatchObject({
      kindergartenId: KG,
      period: "TERM",
      groupCount: 13,
      amount: "52000",
      coversTo: "2027-01-31",
      note: "Хаан банкны хуулга",
    });
  });
});

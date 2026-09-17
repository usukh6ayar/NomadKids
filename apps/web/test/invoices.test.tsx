import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  selectOption,
  sessionFor,
  setParams,
  stubApi,
} from "./support/render";
import InvoiceDetailPage from "@/app/(app)/invoices/[invoiceId]/page";
import NewInvoicePage from "@/app/(app)/invoices/new/page";

const KG_ID = "33333333-3333-4333-8333-333333333333";
const CHILD_ID = "55555555-5555-4555-8555-555555555555";
const INVOICE_ID = "66666666-6666-4666-8666-666666666666";

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Эцэг эхийн нэхэмжлэл — нэмэлт.md §7, §8.
 *
 * ★ The generate form sends one row per line-type actually filled in, not the
 * whole fixed grid — `Invoices.mutate`'s `LINE_TYPES.filter(...)` is the thing
 * under test in the first case.
 */
/**
 * The creation screen — a page since 2026-09-17, where it was a dialog.
 *
 * ★ What is asserted is the request it builds, not its layout: only the rows
 * with money in them are sent, and the quantity × unit price the accountant
 * typed arrives as the single `amount` the schema stores.
 */
describe("creating an invoice", () => {
  it("sends only the lines that were priced, with quantity folded into the amount", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["ACCOUNTANT"]) },
      {
        path: `/kindergartens/${KG_ID}/children/finance-roster`,
        method: "GET",
        body: {
          items: [
            {
              id: CHILD_ID,
              lastName: "Ганболд",
              firstName: "Төгөлдөр",
              dateOfBirth: "2021-04-12",
            },
          ],
          page: 1,
          pageSize: 100,
          total: 1,
          totalPages: 1,
        },
      },
      {
        path: "/groups",
        method: "GET",
        body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 },
      },
      {
        path: `/kindergartens/${KG_ID}/invoices`,
        method: "POST",
        body: { id: INVOICE_ID, status: "UNPAID" },
      },
    ]);

    renderWithProviders(<NewInvoicePage />);

    await selectOption(user, /Суралцагч/, "Ганболд Төгөлдөр");

    const dueDate = await screen.findByLabelText(/Төлбөрийн хугацаа/);
    await user.type(dueDate, "2026-09-05");

    // One line: two months of tuition at 150 000 — the form multiplies.
    const quantity = screen.getByLabelText("Тоо хэмжээ");
    await user.clear(quantity);
    await user.type(quantity, "2");
    await user.type(screen.getByLabelText("Нэгж үнэ"), "150000");

    const submit = screen.getByRole("button", { name: "Нэхэмжлэх үүсгэх" });
    await waitFor(() => expect(submit).toBeEnabled());
    /*
      `fireEvent.submit` rather than a click on the submit button: jsdom does
      not raise the implicit submit a real browser does, and clicking here
      would assert nothing about the request being built.
    */
    fireEvent.submit(submit.closest("form")!);

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));

    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({
      childId: CHILD_ID,
      dueDate: "2026-09-05",
      lineItems: [{ type: "TUITION", amount: "300000.00" }],
    });
  });

  /**
   * ★ It renders on the accountant's own rail, where there is no selected
   * child — 2026-09-17, after it did not.
   *
   * `(app)/layout.tsx` returns the accountant's shell before
   * `SelectedChildProvider`, so `useSelectedChild()` threw and the screen
   * never appeared for the one role it exists for. Rendered here without the
   * provider, exactly as that layout mounts it.
   */
  it("renders on a rail with no SelectedChildProvider", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ACCOUNTANT"]) },
      {
        path: `/kindergartens/${KG_ID}/children/finance-roster`,
        method: "GET",
        body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 },
      },
    ]);

    renderWithProviders(<NewInvoicePage />, { selectedChild: false });

    expect(await screen.findByText("1. Ерөнхий мэдээлэл")).toBeInTheDocument();
  });

  /** A form with nothing priced cannot be submitted — there is no invoice in it. */
  it("will not create an invoice with no priced line", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ACCOUNTANT"]) },
      {
        path: `/kindergartens/${KG_ID}/children/finance-roster`,
        method: "GET",
        body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 },
      },
    ]);

    renderWithProviders(<NewInvoicePage />);

    expect(await screen.findByRole("button", { name: "Нэхэмжлэх үүсгэх" })).toBeDisabled();
  });
});

function invoiceFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    month: "2026-08",
    baseAmount: "150000",
    mealAmount: "40000",
    extraAmount: "0",
    discountAmount: "0",
    previousBalance: "0",
    totalDue: "190000",
    paidAmount: "0",
    balance: "190000",
    dueDate: "2026-09-05",
    status: "UNPAID",
    note: null,
    child: { id: CHILD_ID, lastName: "Ганболд", firstName: "Төгөлдөр" },
    lineItems: [
      {
        id: "77777777-7777-4777-8777-777777777771",
        type: "TUITION",
        description: null,
        amount: "150000",
      },
      {
        id: "77777777-7777-4777-8777-777777777772",
        type: "MEAL",
        description: null,
        amount: "40000",
      },
    ],
    payments: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("an invoice's own page", () => {
  beforeEach(() => setParams({ invoiceId: INVOICE_ID }));

  it("records a manual payment and shows the invoice the server sends back", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["ACCOUNTANT"]) },
      { path: `/invoices/${INVOICE_ID}`, method: "GET", body: invoiceFixture() },
      {
        path: `/invoices/${INVOICE_ID}/payments`,
        method: "POST",
        body: invoiceFixture({
          paidAmount: "190000",
          balance: "0",
          status: "PAID",
          payments: [
            {
              id: "88888888-8888-4888-8888-888888888888",
              amount: "190000",
              method: "CASH",
              gatewayReference: null,
              note: null,
              voidedAt: null,
              reversalOfId: null,
              recordedBy: null,
              createdAt: "2026-08-15T00:00:00.000Z",
            },
          ],
        }),
      },
    ]);

    renderWithProviders(<InvoiceDetailPage />);

    const amountInput = await screen.findByLabelText("Дүн");
    await user.type(amountInput, "190000");
    await user.click(screen.getByRole("button", { name: "Төлбөр бүртгэх" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual({ amount: "190000", method: "CASH" });

    // The page renders whatever the server sent back — a fully paid invoice,
    // not a client-computed guess at the new balance.
    expect(await screen.findByText("Төлсөн")).toBeInTheDocument();
  });

  it("voids a payment through the confirm dialog, never a direct delete", async () => {
    const user = userEvent.setup();
    const paid = invoiceFixture({
      paidAmount: "190000",
      balance: "0",
      status: "PAID",
      payments: [
        {
          id: "88888888-8888-4888-8888-888888888888",
          amount: "190000",
          method: "CASH",
          gatewayReference: null,
          note: null,
          voidedAt: null,
          reversalOfId: null,
          recordedBy: null,
          createdAt: "2026-08-15T00:00:00.000Z",
        },
      ],
    });

    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["ACCOUNTANT"]) },
      { path: `/invoices/${INVOICE_ID}`, method: "GET", body: paid },
      {
        path: "/payments/88888888-8888-4888-8888-888888888888/void",
        method: "PATCH",
        body: invoiceFixture({ status: "UNPAID" }),
      },
    ]);

    renderWithProviders(<InvoiceDetailPage />);

    await user.click(await screen.findByRole("button", { name: "Цуцлах" }));
    await user.click(await screen.findByRole("button", { name: "Тийм, цуцлах" }));

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.url).toBe(
      "/payments/88888888-8888-4888-8888-888888888888/void",
    );
  });
});

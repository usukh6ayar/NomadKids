import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  selectOption,
  sessionFor,
  setParams,
  stubApi,
} from "./support/render";
import InvoicesPage from "@/app/(app)/invoices/page";
import InvoiceDetailPage from "@/app/(app)/invoices/[invoiceId]/page";

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
describe("generating an invoice", () => {
  it("sends only the line types that were actually filled in", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["ACCOUNTANT"]) },
      {
        path: `/kindergartens/${KG_ID}/invoices`,
        method: "GET",
        body: { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 },
      },
      {
        // ★ `finance-roster`, not `/children` — 2026-09-07. `GET /children`'s
        // authorization filter has no accountant chain by design (it is
        // `canAccessChild`'s, not `canViewChildFinance`'s — see
        // `ChildrenService.financeRoster`'s own comment), so an accountant's
        // child picker calls this dedicated route instead.
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
        path: `/kindergartens/${KG_ID}/invoices`,
        method: "POST",
        body: { id: INVOICE_ID, status: "UNPAID" },
      },
    ]);

    renderWithProviders(<InvoicesPage />);

    await user.click(await screen.findByRole("button", { name: "Нэхэмжлэл үүсгэх" }));

    await selectOption(user, "Хүүхэд", "Ганболд Төгөлдөр");

    const dueDate = await screen.findByLabelText("Төлөх хугацаа");
    await user.type(dueDate, "2026-09-05");

    const tuition = await screen.findByLabelText("Сургалтын төлбөр");
    await user.type(tuition, "150000");
    const meal = await screen.findByLabelText("Хоолны мөнгө");
    await user.type(meal, "40000");
    // Every other line type (CLUB/BUS/EXTRA/OTHER) stays blank on purpose.

    await user.click(screen.getByRole("button", { name: "Үүсгэх" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));

    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({
      childId: CHILD_ID,
      dueDate: "2026-09-05",
      lineItems: [
        { type: "TUITION", amount: "150000" },
        { type: "MEAL", amount: "40000" },
      ],
    });
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

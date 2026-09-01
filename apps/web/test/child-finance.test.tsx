import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setParams, stubApi } from "./support/render";
import ChildFinancePage from "@/app/(app)/children/[childId]/finance/page";

const CHILD_ID = "55555555-5555-4555-8555-555555555555";
const INVOICE_ID = "66666666-6666-4666-8666-666666666666";
const QPAY_ID = "77777777-7777-4777-8777-777777777777";

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ childId: CHILD_ID });
});

function childFixture() {
  return {
    id: CHILD_ID,
    lastName: "Ганболд",
    firstName: "Төгөлдөр",
    dateOfBirth: "2021-04-12",
    enrollments: [],
  };
}

function invoiceFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    // ISO date — `Invoice.month` is `DateTime @db.Date` on the API.
    month: "2026-08-01T00:00:00.000Z",
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
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", type: "TUITION", description: null, amount: "150000" },
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", type: "MEAL", description: null, amount: "40000" },
    ],
    payments: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function invoicesPage(items: unknown[]) {
  return { items, page: 1, pageSize: 10, total: items.length, totalPages: 1 };
}

/**
 * A guardian's own read of a child's invoices — нэмэлт.md §7/§10, the gap
 * `ChildInvoicesController` had a working route for but no screen.
 *
 * ★ `month` round-trips through `formatMonthLabel(invoice.month.slice(0, 7))`
 * — the case this guards against is `child-invoices.tsx` regressing to the
 * raw ISO string `Invoice.month` actually is on the wire.
 */
describe("a guardian's own view of a child's finances", () => {
  it("shows the month, status, balance and a QPay button on an unpaid bill", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      // Longer/more specific paths first — `stubApi` matches by `startsWith`
      // and takes the first hit, and `/children/:id/invoices` starts with
      // `/children/:id`.
      {
        path: `/children/${CHILD_ID}/invoices`,
        method: "GET",
        body: invoicesPage([invoiceFixture()]),
      },
      { path: `/children/${CHILD_ID}`, method: "GET", body: childFixture() },
    ]);

    renderWithProviders(<ChildFinancePage />);

    expect(await screen.findByText("2026 оны 8-р сар")).toBeInTheDocument();
    expect(screen.getByText("Төлөгдөөгүй")).toBeInTheDocument();
    // Appears twice — "Нийт төлөх дүн" and "Үлдэгдэл" agree while nothing is
    // paid yet.
    expect(screen.getAllByText("190 000₮").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "QPay-ээр төлөх" })).toBeInTheDocument();
  });

  it("offers no QPay button, and no write controls, once an invoice is paid", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}/invoices`,
        method: "GET",
        body: invoicesPage([
          invoiceFixture({ status: "PAID", paidAmount: "190000", balance: "0" }),
        ]),
      },
      { path: `/children/${CHILD_ID}`, method: "GET", body: childFixture() },
    ]);

    renderWithProviders(<ChildFinancePage />);

    await screen.findByText("Төлсөн");
    expect(screen.queryByRole("button", { name: "QPay-ээр төлөх" })).not.toBeInTheDocument();
    // Read-only for a guardian: the accountant's manual-payment form never renders here.
    expect(screen.queryByLabelText("Дүн")).not.toBeInTheDocument();
  });

  it("lists a payment already on the bill, including a voided one struck through", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}/invoices`,
        method: "GET",
        body: invoicesPage([
          invoiceFixture({
            status: "PARTIALLY_PAID",
            paidAmount: "50000",
            balance: "140000",
            payments: [
              {
                id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                amount: "50000",
                method: "CASH",
                gatewayReference: null,
                note: null,
                voidedAt: null,
                reversalOfId: null,
                recordedBy: null,
                createdAt: "2026-08-10T00:00:00.000Z",
              },
            ],
          }),
        ]),
      },
      { path: `/children/${CHILD_ID}`, method: "GET", body: childFixture() },
    ]);

    renderWithProviders(<ChildFinancePage />);

    expect(await screen.findByText(/50 000₮ · Бэлнээр/)).toBeInTheDocument();
  });
});

describe("paying an invoice through QPay", () => {
  it("creates an attempt on click and renders the QR code it returns", async () => {
    const user = userEvent.setup();
    const attempt = {
      id: QPAY_ID,
      status: "PENDING",
      amount: "190000.00",
      qrText: "qpay-qr-text",
      qrImage: "iVBORw0KGgo=",
      expiresAt: "2026-09-01T13:00:00.000Z",
      paidAt: null,
    };

    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      // Most-specific paths first — see the note in the describe block above.
      {
        path: `/children/${CHILD_ID}/invoices/${INVOICE_ID}/qpay`,
        method: "POST",
        body: attempt,
      },
      {
        path: `/children/${CHILD_ID}/invoices/${INVOICE_ID}/qpay`,
        method: "GET",
        body: attempt,
      },
      {
        path: `/children/${CHILD_ID}/invoices`,
        method: "GET",
        body: invoicesPage([invoiceFixture()]),
      },
      { path: `/children/${CHILD_ID}`, method: "GET", body: childFixture() },
    ]);

    renderWithProviders(<ChildFinancePage />);

    await user.click(await screen.findByRole("button", { name: "QPay-ээр төлөх" }));

    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.url.includes(`${INVOICE_ID}/qpay`)),
      ).toBe(true),
    );

    const img = await screen.findByAltText("QPay QR код");
    expect(img.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("shows a not-configured error inline rather than crashing", async () => {
    const user = userEvent.setup();

    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}/invoices/${INVOICE_ID}/qpay`,
        method: "POST",
        status: 400,
        body: {
          type: "about:blank",
          title: "Мэдээлэл буруу байна",
          detail: "QPay холболт тохируулагдаагүй байна.",
          status: 400,
          requestId: "test",
        },
      },
      {
        path: `/children/${CHILD_ID}/invoices`,
        method: "GET",
        body: invoicesPage([invoiceFixture()]),
      },
      { path: `/children/${CHILD_ID}`, method: "GET", body: childFixture() },
    ]);

    renderWithProviders(<ChildFinancePage />);

    await user.click(await screen.findByRole("button", { name: "QPay-ээр төлөх" }));

    expect(await screen.findByText("QPay холболт тохируулагдаагүй байна.")).toBeInTheDocument();
  });

  it("declares success once a poll reports the payment landed, and refetches the invoice list", async () => {
    const user = userEvent.setup();
    let listCalls = 0;

    // Stubbed by hand, not through `stubApi`'s static routes: the invoice
    // list must answer differently on its second call, once the payment has
    // landed, to prove `onPaid` actually triggered a refetch rather than the
    // dialog just rendering its own local "success" text.
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      const path = url.replace(/^.*\/v1/, "");

      if (path.startsWith("/auth/me")) return jsonOk(sessionFor(["PARENT"]));
      if (path.startsWith(`/children/${CHILD_ID}/invoices/${INVOICE_ID}/qpay`) && method === "POST") {
        return jsonOk({
          id: QPAY_ID,
          status: "PENDING",
          amount: "190000.00",
          qrText: null,
          qrImage: null,
          expiresAt: null,
          paidAt: null,
        });
      }
      if (path.startsWith(`/children/${CHILD_ID}/invoices/${INVOICE_ID}/qpay`) && method === "GET") {
        return jsonOk({
          id: QPAY_ID,
          status: "PAID",
          amount: "190000.00",
          qrText: null,
          qrImage: null,
          expiresAt: null,
          paidAt: "2026-09-01T12:35:00.000Z",
        });
      }
      if (path.startsWith(`/children/${CHILD_ID}/invoices`)) {
        listCalls += 1;
        const paid = listCalls > 1;
        return jsonOk(
          invoicesPage([
            invoiceFixture(
              paid ? { status: "PAID", paidAmount: "190000", balance: "0" } : {},
            ),
          ]),
        );
      }
      if (path.startsWith(`/children/${CHILD_ID}`)) return jsonOk(childFixture());
      return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<ChildFinancePage />);

    await user.click(await screen.findByRole("button", { name: "QPay-ээр төлөх" }));

    expect(await screen.findByText("Төлбөр амжилттай хийгдлээ")).toBeInTheDocument();
    // `onPaid` invalidated the list query behind the dialog, which is still
    // mounted and refetches immediately rather than waiting for a remount.
    await waitFor(() => expect(listCalls).toBeGreaterThan(1));
  });
});

function jsonOk(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

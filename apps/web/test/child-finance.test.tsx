import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setParams, stubApi } from "./support/render";
import ChildFinancePage from "@/app/(app)/children/[childId]/finance/page";

const CHILD_ID = "55555555-5555-4555-8555-555555555555";
const INVOICE_ID = "66666666-6666-4666-8666-666666666666";
const QPAY_ID = "77777777-7777-4777-8777-777777777777";
const SUB_ID = "88888888-8888-4888-8888-888888888888";

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
  it("shows the month, status and balance on an unpaid bill", async () => {
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
    // ★ No pay button. QPay charges the portal access fee and nothing else
    // (client, 2026-09-01); a tuition bill is settled in cash or by transfer
    // and recorded by the accountant, so this card is read-only to a parent.
    expect(screen.queryByRole("button", { name: "QPay-ээр төлөх" })).not.toBeInTheDocument();
  });

  it("offers no write controls once an invoice is paid", async () => {
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

/**
 * The portal access fee — client instruction, 2026-09-01: QPay takes money
 * from parents for the right to use the site, and for nothing else.
 *
 * ★ These tests render the same page as the block above, but the API answers
 * **402** rather than serving the child. That status is the product's one
 * deliberate departure from `docs/SECURITY.md` §5.4, and the reason is what
 * these assertions pin: a 404 would be unactionable, while the person reading
 * this is the child's own guardian and one payment away from the record.
 */
describe("the portal access fee", () => {
  const accessStatus = {
    required: true,
    active: false,
    amount: "15000.00",
    subscription: {
      id: SUB_ID,
      status: "UNPAID",
      amount: "15000.00",
      expiresAt: "2027-05-31",
      paidAt: null,
      schoolYear: { id: "year-1", name: "2026-2027", endsOn: "2027-05-31" },
    },
  };

  function paywalled(extra: Parameters<typeof stubApi>[0] = []) {
    return stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      ...extra,
      { path: `/children/${CHILD_ID}/access`, method: "GET", body: accessStatus },
      {
        path: `/children/${CHILD_ID}`,
        method: "GET",
        status: 402,
        body: {
          type: "about:blank",
          title: "Төлбөр төлөгдөөгүй",
          detail: "Энэ хүүхдийн мэдээллийг үзэхийн тулд энэ хичээлийн жилийн хандалтын төлбөрийг төлнө үү.",
          status: 402,
          requestId: "test",
        },
      },
    ]);
  }

  it("offers the way out instead of a dead end when the fee is unpaid", async () => {
    paywalled();

    renderWithProviders(<ChildFinancePage />);

    expect(await screen.findByText("Хандалтын төлбөр")).toBeInTheDocument();
    expect(screen.getByText("15 000₮")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "QPay-ээр төлөх" })).toBeInTheDocument();
  });

  it("creates an attempt on click and renders the QR code it returns", async () => {
    const user = userEvent.setup();
    const attempt = {
      id: QPAY_ID,
      status: "PENDING",
      amount: "15000.00",
      qrText: "qpay-qr-text",
      qrImage: "iVBORw0KGgo=",
      expiresAt: "2026-09-01T13:00:00.000Z",
      paidAt: null,
    };

    const { calls } = paywalled([
      // Most-specific paths first — `stubApi` matches by `startsWith`.
      { path: `/children/${CHILD_ID}/access/qpay`, method: "POST", body: attempt },
      { path: `/children/${CHILD_ID}/access/qpay`, method: "GET", body: attempt },
    ]);

    renderWithProviders(<ChildFinancePage />);

    await user.click(await screen.findByRole("button", { name: "QPay-ээр төлөх" }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url.includes("/access/qpay"))).toBe(true),
    );

    const img = await screen.findByAltText("QPay QR код");
    expect(img.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("shows a not-configured error inline rather than crashing", async () => {
    const user = userEvent.setup();

    paywalled([
      {
        path: `/children/${CHILD_ID}/access/qpay`,
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
    ]);

    renderWithProviders(<ChildFinancePage />);

    await user.click(await screen.findByRole("button", { name: "QPay-ээр төлөх" }));

    expect(await screen.findByText(/тохируулагдаагүй/)).toBeInTheDocument();
  });

  it("says nothing about a fee when the deployment does not charge", async () => {
    // ★ `ACCESS_FEE_AMOUNT=0` is the default, and it must serve the portal
    // exactly as it did before this feature existed. Nobody is locked out of
    // their own child's records by an unset variable.
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}/invoices`,
        method: "GET",
        body: invoicesPage([invoiceFixture()]),
      },
      { path: `/children/${CHILD_ID}`, method: "GET", body: childFixture() },
    ]);

    renderWithProviders(<ChildFinancePage />);

    expect(await screen.findByText("2026 оны 8-р сар")).toBeInTheDocument();
    expect(screen.queryByText("Хандалтын төлбөр")).not.toBeInTheDocument();
  });
});


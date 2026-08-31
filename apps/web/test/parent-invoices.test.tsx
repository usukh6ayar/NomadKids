import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setParams, stubApi } from "./support/render";
import InvoiceDetailPage from "@/app/(app)/invoices/[invoiceId]/page";
import ChildInvoicesPage from "@/app/(app)/children/[childId]/invoices/page";

const CHILD_ID = "55555555-5555-4555-8555-555555555555";
const INVOICE_ID = "66666666-6666-4666-8666-666666666666";

beforeEach(() => {
  vi.clearAllMocks();
});

function child() {
  return {
    id: CHILD_ID,
    lastName: "Болд",
    firstName: "Номин",
    dateOfBirth: "2021-04-12",
    sex: "FEMALE",
    status: "ACTIVE",
    kindergarten: { id: "33333333-3333-4333-8333-333333333333", name: "Бяцхан нүүдэлчид" },
    group: { id: "77777777-7777-4777-8777-777777777777", name: "Дэлбээ" },
    healthNotes: null,
    photo: null,
  };
}

/**
 * `нэмэлт.md` §10's summary. `funding` is absent, which is what a **guardian**
 * receives — the state's payments to the kindergarten are not the family's
 * business, and the API omits the key rather than sending it to be hidden.
 */
function finance(overrides: Record<string, unknown> = {}) {
  return {
    childId: CHILD_ID,
    invoices: 1,
    billed: "50000.00",
    paid: "0.00",
    discounts: "0.00",
    balance: "50000.00",
    ...overrides,
  };
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    childId: CHILD_ID,
    child: { id: CHILD_ID, lastName: "Болд", firstName: "Номин" },
    month: "2026-02",
    number: "2026-000042",
    status: "UNPAID",
    subtotalAmount: "50000.00",
    discountAmount: "0.00",
    previousBalance: "0.00",
    totalAmount: "50000.00",
    dueDate: null,
    issuedAt: "2026-02-01T00:00:00.000Z",
    note: null,
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    ...invoice(),
    paidAmount: "0.00",
    balanceAmount: "50000.00",
    lines: [
      {
        id: "88888888-8888-4888-8888-888888888888",
        kind: "MEAL",
        label: "Хоолны мөнгө",
        quantity: "20.00",
        unitAmount: "2500.00",
        amount: "50000.00",
        note: null,
      },
    ],
    payments: [],
    ...overrides,
  };
}

/**
 * The family's own finance screens — `нэмэлт.md` §7, §8, §10.
 *
 * ★ The assertions are on **rendered Mongolian text and formatted amounts**,
 * because those are what a parent actually reads. A test that asserted on the
 * raw `"50000.00"` would pass while the screen showed a parent an unformatted
 * number, or worse, one mangled by a float round-trip.
 *
 * ★★ **Stub order matters here more than in most files.** `stubApi` matches
 * with `startsWith` and takes the first hit, and these routes nest three deep:
 * `/invoices/:id` is a prefix of `/invoices/:id/qpay`, which is a prefix of
 * `/invoices/:id/qpay/sync`. Listing them shortest-first makes the parent route
 * answer every child route, and the symptom is not an obvious mis-stub — it is
 * a dialog that never opens or a query that renders "Алдаа гарлаа", which reads
 * like a bug in the component. Longest path first, every time.
 */
describe("a child's invoice list", () => {
  it("shows the outstanding total and each invoice", async () => {
    setParams({ childId: CHILD_ID });
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}/invoices`,
        body: { items: [invoice()], page: 1, pageSize: 25, total: 1, totalPages: 1 },
      },
      { path: `/children/${CHILD_ID}/finance`, body: finance() },
      { path: `/children/${CHILD_ID}`, body: child() },
    ]);

    renderWithProviders(<ChildInvoicesPage />);

    // Formatted with a thousands separator and the tögrög sign — not "50000.00".
    expect(await screen.findByText("Нийт үлдэгдэл")).toBeInTheDocument();
    expect(screen.getAllByText("50 000₮").length).toBeGreaterThan(0);
    expect(screen.getByText("2026 оны 2 сар")).toBeInTheDocument();
    expect(screen.getByText("Төлөгдөөгүй")).toBeInTheDocument();
  });

  it("says what to expect when there are no invoices yet", async () => {
    setParams({ childId: CHILD_ID });
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}/invoices`,
        body: { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 },
      },
      { path: `/children/${CHILD_ID}/finance`, body: finance() },
      { path: `/children/${CHILD_ID}`, body: child() },
    ]);

    renderWithProviders(<ChildInvoicesPage />);

    // An empty state that says what happens next — CLAUDE.md §5.
    expect(await screen.findByText("Нэхэмжлэл алга")).toBeInTheDocument();
    // No summary either: there is nothing to summarise.
    expect(screen.queryByText("Нийт үлдэгдэл")).not.toBeInTheDocument();
  });

  it("shows an overpayment as a credit rather than a negative debt", async () => {
    setParams({ childId: CHILD_ID });
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}/invoices`,
        body: {
          items: [invoice({ status: "PAID" })],
          page: 1,
          pageSize: 25,
          total: 1,
          totalPages: 1,
        },
      },
      {
        path: `/children/${CHILD_ID}/finance`,
        body: finance({ paid: "60000.00", balance: "-10000.00" }),
      },
      { path: `/children/${CHILD_ID}`, body: child() },
    ]);

    renderWithProviders(<ChildInvoicesPage />);

    // "−10 000₮ үлдэгдэл" reads as an error; "10 000₮ илүү төлсөн" reads as
    // the fact it is.
    expect(await screen.findByText("Илүү төлсөн")).toBeInTheDocument();
    expect(screen.getByText("10 000₮")).toBeInTheDocument();
    expect(screen.queryByText("Нийт үлдэгдэл")).not.toBeInTheDocument();
  });

  it("keeps the state funding history out of a guardian's screen — §10", async () => {
    // The API omits `funding` for a guardian entirely; the component must not
    // invent a section, an empty state, or a hint that one exists.
    setParams({ childId: CHILD_ID });
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}/invoices`,
        body: { items: [invoice()], page: 1, pageSize: 25, total: 1, totalPages: 1 },
      },
      { path: `/children/${CHILD_ID}/finance`, body: finance() },
      { path: `/children/${CHILD_ID}`, body: child() },
    ]);

    renderWithProviders(<ChildInvoicesPage />);

    expect(await screen.findByText("Нийт үлдэгдэл")).toBeInTheDocument();
    expect(screen.queryByText("Улсын санхүүжилтийн түүх")).not.toBeInTheDocument();
  });

  it("shows the funding history when the API sends it — finance staff", async () => {
    setParams({ childId: CHILD_ID });
    stubApi([
      { path: "/auth/me", body: sessionFor(["ACCOUNTANT"]) },
      {
        path: `/children/${CHILD_ID}/invoices`,
        body: { items: [invoice()], page: 1, pageSize: 25, total: 1, totalPages: 1 },
      },
      {
        path: `/children/${CHILD_ID}/finance`,
        body: finance({
          funding: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
              month: "2026-02",
              source: "STATE",
              rule: "Улсын хоол",
              basis: "MEALS",
              daysAttended: 18,
              daysFed: 20,
              dailyRate: "1000.00",
              calculated: "20000.00",
              approved: "20000.00",
              received: "20000.00",
            },
          ],
        }),
      },
      { path: `/children/${CHILD_ID}`, body: child() },
    ]);

    renderWithProviders(<ChildInvoicesPage />);

    expect(await screen.findByText("Улсын санхүүжилтийн түүх")).toBeInTheDocument();
    // §10 asks for the working, not just the answer — and the label follows
    // `basis`, so a meal rule counts fed days rather than attended ones.
    expect(screen.getByText("Улсын · 20 хооллосон өдөр × 1 000₮")).toBeInTheDocument();
  });
});

describe("one invoice", () => {
  it("breaks down the charge and offers to pay", async () => {
    setParams({ invoiceId: INVOICE_ID });
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: `/invoices/${INVOICE_ID}`, body: detail() },
    ]);

    renderWithProviders(<InvoiceDetailPage />);

    expect(await screen.findByText("Задаргаа")).toBeInTheDocument();
    expect(screen.getByText("Хоолны мөнгө")).toBeInTheDocument();
    // The quantity reads as a count of days, not as money: "20 × 2 500₮".
    expect(screen.getByText("Хоолны мөнгө · 20 × 2 500₮")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /QPay-ээр төлөх/ })).toBeInTheDocument();
  });

  it("hides the pay button on a settled invoice", async () => {
    // Offering "Төлөх" on a paid bill is how a family pays twice.
    setParams({ invoiceId: INVOICE_ID });
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/invoices/${INVOICE_ID}`,
        body: detail({ status: "PAID", paidAmount: "50000.00", balanceAmount: "0.00" }),
      },
    ]);

    renderWithProviders(<InvoiceDetailPage />);

    expect(await screen.findByText("Задаргаа")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /QPay-ээр төлөх/ })).not.toBeInTheDocument();
  });

  it("shows a reversal rather than hiding it — нэмэлт.md §14", async () => {
    setParams({ invoiceId: INVOICE_ID });
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/invoices/${INVOICE_ID}`,
        body: detail({
          payments: [
            {
              id: "99999999-9999-4999-8999-999999999991",
              amount: "50000.00",
              method: "QPAY",
              status: "PAID",
              paidAt: "2026-02-20T10:00:00.000Z",
              providerPaymentId: "pay-1",
              isReversal: false,
              note: null,
              createdAt: "2026-02-20T10:00:00.000Z",
            },
            {
              id: "99999999-9999-4999-8999-999999999992",
              amount: "-50000.00",
              method: "QPAY",
              status: "PAID",
              paidAt: "2026-02-21T10:00:00.000Z",
              providerPaymentId: null,
              isReversal: true,
              note: "Алдаатай бүртгэсэн",
              createdAt: "2026-02-21T10:00:00.000Z",
            },
          ],
        }),
      },
    ]);

    renderWithProviders(<InvoiceDetailPage />);

    expect(await screen.findByText("Төлбөрийн түүх")).toBeInTheDocument();
    // Both rows: the payment and the correction that undoes it.
    expect(screen.getByText("QPay")).toBeInTheDocument();
    expect(screen.getByText("Буцаалт")).toBeInTheDocument();
    // A negative amount renders with a real minus sign, not a hyphen.
    expect(screen.getByText("−50 000₮")).toBeInTheDocument();
  });

  it("does not list a PENDING payment as money received", async () => {
    // A QR generated but not yet paid must not read as a payment on the
    // family's own history.
    setParams({ invoiceId: INVOICE_ID });
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/invoices/${INVOICE_ID}`,
        body: detail({
          payments: [
            {
              id: "99999999-9999-4999-8999-999999999993",
              amount: "50000.00",
              method: "QPAY",
              status: "PENDING",
              paidAt: null,
              providerPaymentId: null,
              isReversal: false,
              note: null,
              createdAt: "2026-02-20T10:00:00.000Z",
            },
          ],
        }),
      },
    ]);

    renderWithProviders(<InvoiceDetailPage />);

    expect(await screen.findByText("Задаргаа")).toBeInTheDocument();
    expect(screen.queryByText("Төлбөрийн түүх")).not.toBeInTheDocument();
  });
});

describe("paying with QPay", () => {
  it("opens the sheet with bank links and a QR", async () => {
    const user = userEvent.setup();
    setParams({ invoiceId: INVOICE_ID });
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/invoices/${INVOICE_ID}/qpay`,
        method: "POST",
        body: {
          paymentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          amount: "50000.00",
          qrText: "0002010102",
          qrImage: "iVBORw0KGgo=",
          links: [{ name: "khanbank", description: "Хаан банк", link: "khanbank://q" }],
        },
      },
      { path: `/invoices/${INVOICE_ID}`, body: detail() },
    ]);

    renderWithProviders(<InvoiceDetailPage />);

    await user.click(await screen.findByRole("button", { name: /QPay-ээр төлөх/ }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // A bank deeplink is a real anchor — the parent is on the phone showing
    // the QR, so tapping through to the bank app is the primary path.
    const link = screen.getByRole("link", { name: /Хаан банк/ });
    expect(link).toHaveAttribute("href", "khanbank://q");
    // The QR is still there for a second device.
    expect(screen.getByAltText("QPay төлбөрийн QR код")).toHaveAttribute(
      "src",
      "data:image/png;base64,iVBORw0KGgo=",
    );
  });

  it("tells the parent to wait rather than reporting a failure when nothing has arrived", async () => {
    const user = userEvent.setup();
    setParams({ invoiceId: INVOICE_ID });
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/invoices/${INVOICE_ID}/qpay/sync`,
        method: "POST",
        body: { applied: 0, status: "UNPAID", paidAmount: "0.00" },
      },
      {
        path: `/invoices/${INVOICE_ID}/qpay`,
        method: "POST",
        body: {
          paymentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          amount: "50000.00",
          qrText: "0002010102",
          qrImage: "iVBORw0KGgo=",
          links: [],
        },
      },
      { path: `/invoices/${INVOICE_ID}`, body: detail() },
    ]);

    renderWithProviders(<InvoiceDetailPage />);

    await user.click(await screen.findByRole("button", { name: /QPay-ээр төлөх/ }));
    await user.click(await screen.findByRole("button", { name: "Төлснөө шалгах" }));

    // Not an error toast: the parent may simply not have paid yet, and
    // "failed" would read as "your payment was rejected".
    await waitFor(() =>
      expect(screen.getByText(/Төлбөр хараахан ирээгүй байна/)).toBeInTheDocument(),
    );
  });

  it("closes the sheet and confirms once QPay reports the invoice paid", async () => {
    const user = userEvent.setup();
    setParams({ invoiceId: INVOICE_ID });
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/invoices/${INVOICE_ID}/qpay/sync`,
        method: "POST",
        body: { applied: 1, status: "PAID", paidAmount: "50000.00" },
      },
      {
        path: `/invoices/${INVOICE_ID}/qpay`,
        method: "POST",
        body: {
          paymentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          amount: "50000.00",
          qrText: "0002010102",
          qrImage: "iVBORw0KGgo=",
          links: [],
        },
      },
      { path: `/invoices/${INVOICE_ID}`, body: detail() },
    ]);

    renderWithProviders(<InvoiceDetailPage />);

    await user.click(await screen.findByRole("button", { name: /QPay-ээр төлөх/ }));
    await user.click(await screen.findByRole("button", { name: "Төлснөө шалгах" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Төлбөр амжилттай хийгдлээ")).toBeInTheDocument();
  });
});

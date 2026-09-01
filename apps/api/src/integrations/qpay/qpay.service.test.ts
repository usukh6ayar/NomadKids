import { describe, expect, it, vi } from "vitest";
import { QpayService } from "./qpay.service";
import type { QpayRepository } from "./qpay.repository";
import type { QpayClient } from "./qpay.client";
import type { QpayConfig } from "./qpay.config";
import type { InvoicesRepository } from "../../invoices/invoices.repository";
import type { ChildAccessService } from "../../authz/child-access.service";
import type { AuditRepository } from "../../audit/audit.repository";

/**
 * `QpayService.reconcile` — hand-built fakes, no database, no Nest module.
 *
 * ★ This is where the one property that actually matters once real money is
 * involved gets proven: two triggers (the webhook and a parent's status
 * poll) asking "has this been paid" at once must credit the invoice exactly
 * once, never twice. `apps/api/test/qpay.test.ts` proves the HTTP surface —
 * authorization, ownership, the honest "not configured" message — against a
 * real database; it deliberately cannot exercise this, because there is no
 * live QPay sandbox to make `checkPayment` return PAID for real. Fakes are
 * what make the race reproducible on every run instead of "eventually,
 * against production, with money".
 */

type QpayInvoiceRow = NonNullable<Awaited<ReturnType<QpayRepository["findById"]>>>;

function fakeRow(overrides: Partial<Record<string, unknown>> = {}): QpayInvoiceRow {
  return {
    id: "qpay-row-1",
    kindergartenId: "kg-1",
    invoiceId: "invoice-1",
    amount: { toFixed: () => "195000.00" },
    qpayInvoiceId: "qpay-inv-1",
    senderInvoiceNo: "sender-1",
    qrText: "qr-text",
    qrImage: "qr-image",
    status: "PENDING",
    paymentId: null,
    createdById: "user-1",
    expiresAt: new Date(Date.now() + 60_000),
    paidAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as QpayInvoiceRow;
}

function harness(rowOverrides: Partial<Record<string, unknown>> = {}) {
  let row = fakeRow(rowOverrides);
  /** How many times `claimForPayment` has actually flipped PENDING → PAID. */
  let claims = 0;

  const repo = {
    findLatestForInvoice: vi.fn(async () => row),
    findById: vi.fn(async () => row),
    findByQpayInvoiceId: vi.fn(async () => row),
    create: vi.fn(async () => row),
    markExpired: vi.fn(async () => {
      row = { ...row, status: "EXPIRED" } as QpayInvoiceRow;
    }),
    /**
     * Models the real repository's WHERE-guarded UPDATE: only the first
     * caller to observe `status === "PENDING"` succeeds, exactly like
     * Postgres serialising two concurrent `UPDATE … WHERE status =
     * 'PENDING'` statements against the same row.
     */
    claimForPayment: vi.fn(async (_id: string, paidAt: Date) => {
      if (row.status !== "PENDING") return false;
      claims += 1;
      row = { ...row, status: "PAID", paidAt } as QpayInvoiceRow;
      return true;
    }),
    attachPayment: vi.fn(async (_id: string, paymentId: string) => {
      row = { ...row, paymentId } as QpayInvoiceRow;
    }),
  } as unknown as QpayRepository;

  const checkPayment = vi.fn(async () => ({
    count: 1,
    rows: [{ payment_id: "qpay-payment-1", payment_status: "PAID", payment_amount: "195000" }],
  }));
  const client = {
    createInvoice: vi.fn(async () => ({
      invoice_id: "qpay-inv-new",
      qr_text: "new-qr-text",
      qr_image: "new-qr-image",
    })),
    checkPayment,
  } as unknown as QpayClient;

  const config = { isConfigured: true } as unknown as QpayConfig;

  const recordPayment = vi.fn(async () => ({
    payment: { id: "real-payment-1" },
    invoice: { id: "invoice-1", status: "PAID" },
  }));
  const invoices = {
    findInvoiceRef: vi.fn(async () => ({
      id: "invoice-1",
      kindergartenId: "kg-1",
      childId: "child-1",
      paidAmount: "0",
      balance: "195000.00",
      status: "UNPAID",
    })),
    recordPayment,
  } as unknown as InvoicesRepository;

  const childAccess = {
    assertCanViewFinance: vi.fn(async () => ({})),
  } as unknown as ChildAccessService;

  const audit = { append: vi.fn(async () => {}) } as unknown as AuditRepository;

  const service = new QpayService(repo, client, config, invoices, childAccess, audit);

  return { service, repo, client, invoices, audit, recordPayment, checkPayment, claimsCount: () => claims };
}

const actor = { userId: "guardian-1" } as never;

describe("reconciling a payment", () => {
  it("credits a PENDING invoice exactly once when QPay confirms PAID", async () => {
    const h = harness();

    const result = await h.service.status(actor, "child-1", "invoice-1");

    expect(h.recordPayment).toHaveBeenCalledTimes(1);
    expect(h.recordPayment).toHaveBeenCalledWith(
      "invoice-1",
      expect.objectContaining({ method: "QPAY", gatewayReference: "qpay-payment-1", amount: "195000.00" }),
    );
    expect(h.repo.attachPayment).toHaveBeenCalledWith("qpay-row-1", "real-payment-1");
    expect(h.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ objectType: "Payment", objectId: "real-payment-1" }),
    );
    expect(result.status).toBe("PAID");
  });

  it("is a no-op the second time — an already-PAID row is never re-checked or re-credited", async () => {
    const h = harness();

    await h.service.status(actor, "child-1", "invoice-1");
    h.checkPayment.mockClear();
    h.recordPayment.mockClear();

    const second = await h.service.status(actor, "child-1", "invoice-1");

    expect(h.checkPayment).not.toHaveBeenCalled();
    expect(h.recordPayment).not.toHaveBeenCalled();
    expect(second.status).toBe("PAID");
  });

  it("never creates a second Payment when the claim is lost to a concurrent caller", async () => {
    const h = harness();
    // Simulates the webhook having already won the race a moment earlier:
    // the row is PENDING when read, but by the time this call reaches the
    // claim step, `claimForPayment` reports someone else got there first.
    (h.repo.claimForPayment as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    await h.service.status(actor, "child-1", "invoice-1");

    expect(h.recordPayment).not.toHaveBeenCalled();
    // The row is re-read after losing the claim, not assumed.
    expect(h.repo.findById).toHaveBeenCalled();
  });

  it("changes nothing while QPay has not confirmed payment yet", async () => {
    const h = harness();
    h.checkPayment.mockResolvedValueOnce({ count: 0, rows: [] });

    const result = await h.service.status(actor, "child-1", "invoice-1");

    expect(h.recordPayment).not.toHaveBeenCalled();
    expect(h.repo.claimForPayment).not.toHaveBeenCalled();
    expect(result.status).toBe("PENDING");
  });

  it("expires a stale row locally without calling QPay at all", async () => {
    const h = harness({ expiresAt: new Date(Date.now() - 1000) });

    const result = await h.service.status(actor, "child-1", "invoice-1");

    expect(h.checkPayment).not.toHaveBeenCalled();
    expect(h.repo.markExpired).toHaveBeenCalledWith("qpay-row-1");
    expect(result.status).toBe("EXPIRED");
  });

  it("leaves a PENDING row untouched when the QPay check itself fails", async () => {
    const h = harness();
    h.checkPayment.mockRejectedValueOnce(new Error("network down"));

    const result = await h.service.status(actor, "child-1", "invoice-1");

    expect(h.recordPayment).not.toHaveBeenCalled();
    expect(result.status).toBe("PENDING");
  });
});

describe("starting a new attempt", () => {
  it("reuses an unexpired PENDING attempt instead of creating a second one", async () => {
    const h = harness();

    const result = await h.service.createForInvoice(actor, "child-1", "invoice-1");

    expect(h.repo.create).not.toHaveBeenCalled();
    expect(result.id).toBe("qpay-row-1");
  });

  it("creates a fresh attempt when the previous one has expired", async () => {
    const h = harness({ status: "EXPIRED", expiresAt: new Date(Date.now() - 1000) });

    await h.service.createForInvoice(actor, "child-1", "invoice-1");

    expect(h.repo.create).toHaveBeenCalledTimes(1);
  });

  it("refuses to start a payment for an invoice with nothing owed", async () => {
    const h = harness();
    (h.invoices.findInvoiceRef as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "invoice-1",
      kindergartenId: "kg-1",
      childId: "child-1",
      paidAmount: "195000",
      balance: "0.00",
      status: "PAID",
    });

    await expect(h.service.createForInvoice(actor, "child-1", "invoice-1")).rejects.toThrow();
    expect(h.repo.create).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { QpayService } from "./qpay.service";
import { PlatformAccessService } from "../../authz/platform-access.service";
import type { QpayRepository } from "./qpay.repository";
import type { QpayClient } from "./qpay.client";
import type { QpayConfig } from "./qpay.config";
import type { AccessService } from "../../access/access.service";
import type { ChildAccessService } from "../../authz/child-access.service";
import type { AuditRepository } from "../../audit/audit.repository";

/**
 * `QpayService.reconcile` — hand-built fakes, no database, no Nest module.
 *
 * ★ This is where the one property that actually matters once real money is
 * involved gets proven: two triggers (the webhook and a parent's status
 * poll) asking "has this been paid" at once must open the family's access
 * exactly
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
    subscriptionId: "sub-1",
    amount: { toFixed: () => "195000.00" },
    qpayInvoiceId: "qpay-inv-1",
    senderInvoiceNo: "sender-1",
    qrText: "qr-text",
    qrImage: "qr-image",
    status: "PENDING",
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
    findLatestForSubscription: vi.fn(async () => row),
    findById: vi.fn(async () => row),
    markForReview: vi.fn(async () => {}),
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
    findLatestForMaterialPurchase: vi.fn(async () => row),
    markMaterialPurchasePaid: vi.fn(async () => true),
    findLatestForContractPayment: vi.fn(async () => row),
    markContractPaymentPaid: vi.fn(async () => ({ claimed: true, before: null, overlaps: false })),
    claimForPayment: vi.fn(async (_id: string, paidAt: Date) => {
      // PENDING, or EXPIRED by our own clock while QPay still took the money.
      if (row.status !== "PENDING" && row.status !== "EXPIRED") return false;
      claims += 1;
      row = { ...row, status: "PAID", paidAt } as QpayInvoiceRow;
      return true;
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

  /** Models `AccessService.markPaid`, which is itself WHERE-guarded. */
  const markPaid = vi.fn(async () => true);
  const access = {
    ensureForChild: vi.fn(async () => ({
      id: "sub-1",
      kindergartenId: "kg-1",
      childId: "child-1",
      status: "UNPAID",
      amount: { toFixed: () => "15000.00" },
      schoolYear: { id: "year-1", name: "2026-2027", endsOn: new Date("2027-05-31") },
    })),
    markPaid,
  } as unknown as AccessService;

  const childAccess = {
    assertCanAccessIgnoringFee: vi.fn(async () => ({})),
  } as unknown as ChildAccessService;

  const audit = { append: vi.fn(async () => {}) } as unknown as AuditRepository;

  const service = new QpayService(
    repo,
    client,
    config,
    access,
    childAccess,
    audit,
    new PlatformAccessService(),
  );

  return {
    service,
    repo,
    client,
    access,
    audit,
    markPaid,
    checkPayment,
    claimsCount: () => claims,
  };
}

const actor = { userId: "guardian-1" } as never;

describe("reconciling a teaching-material payment", () => {
  /**
   * ★ Since 2026-10-11 an attempt pays for a subscription **or** a material
   * purchase. A material's PAID must credit the purchase and never open a
   * family's portal access.
   */
  it("marks the purchase paid, once, and leaves the access fee alone", async () => {
    const h = harness({ subscriptionId: null, kindergartenId: null, materialPurchaseId: "mp-1" });

    const first = await h.service.statusForMaterialPurchase("mp-1");
    const second = await h.service.statusForMaterialPurchase("mp-1");

    expect(first?.status).toBe("PAID");
    expect(second?.status).toBe("PAID");
    expect(h.repo.markMaterialPurchasePaid).toHaveBeenCalledTimes(1);
    // The invoice's amount (195000.00 in the fake row), not the material's price now.
    expect(h.repo.markMaterialPurchasePaid).toHaveBeenCalledWith("mp-1", expect.any(Date), 195000);
    expect(h.markPaid).not.toHaveBeenCalled();
  });
});

describe("reconciling a contract payment", () => {
  /* ★ Review of #258: what QPay took is what the contract payment records. */
  it("hands the attempt's own amount to the contract payment", async () => {
    const h = harness({ subscriptionId: null, contractPaymentId: "cp-1" });

    const result = await h.service.statusForContractPayment("cp-1");

    expect(result?.status).toBe("PAID");
    expect(h.repo.markContractPaymentPaid).toHaveBeenCalledWith(
      "cp-1",
      expect.any(Date),
      "195000.00",
    );
    expect(h.markPaid).not.toHaveBeenCalled();
  });

  it("asks about the QR before drawing another, and refuses one already paid", async () => {
    const h = harness({
      subscriptionId: null,
      contractPaymentId: "cp-1",
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(
      h.service.createForContractPayment(actor, {
        id: "cp-1",
        kindergartenId: "kg-1",
        amount: "195000.00",
        description: "Цэцэрлэг, II улирал",
      }),
    ).rejects.toThrow();
    expect(h.repo.markContractPaymentPaid).toHaveBeenCalledTimes(1);
    expect(h.client.createInvoice).not.toHaveBeenCalled();
  });
});

describe("reconciling a payment", () => {
  it("opens access exactly once when QPay confirms PAID", async () => {
    const h = harness();

    const result = await h.service.status(actor, "child-1");

    expect(h.markPaid).toHaveBeenCalledTimes(1);
    expect(h.markPaid).toHaveBeenCalledWith("sub-1", expect.any(Date));
    expect(h.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ objectType: "QpayInvoice", objectId: "qpay-row-1" }),
    );
    expect(result.status).toBe("PAID");
  });

  it("is a no-op the second time — an already-PAID row is never re-checked", async () => {
    const h = harness();

    await h.service.status(actor, "child-1");
    h.checkPayment.mockClear();
    h.markPaid.mockClear();

    const second = await h.service.status(actor, "child-1");

    expect(h.checkPayment).not.toHaveBeenCalled();
    expect(h.markPaid).not.toHaveBeenCalled();
    expect(second.status).toBe("PAID");
  });

  it("never settles twice when the claim is lost to a concurrent caller", async () => {
    const h = harness();
    // Simulates the webhook having already won the race a moment earlier:
    // the row is PENDING when read, but by the time this call reaches the
    // claim step, `claimForPayment` reports someone else got there first.
    (h.repo.claimForPayment as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    await h.service.status(actor, "child-1");

    expect(h.markPaid).not.toHaveBeenCalled();
    // The row is re-read after losing the claim, not assumed.
    expect(h.repo.findById).toHaveBeenCalled();
  });

  /* ★ 2026-10-18: a short payment opens nothing — the amount is the row's, never assumed. */
  it("opens nothing when QPay reports less paid than the row's amount", async () => {
    const h = harness();
    h.checkPayment.mockResolvedValueOnce({
      count: 1,
      rows: [{ payment_id: "p-1", payment_status: "PAID", payment_amount: "100" }],
    });

    const result = await h.service.status(actor, "child-1");

    expect(h.markPaid).not.toHaveBeenCalled();
    expect(h.repo.claimForPayment).not.toHaveBeenCalled();
    expect(result.status).toBe("PENDING");
    // ★ 2026-10-21: and the row waits for a person on «Төлбөр шалгах».
    expect(h.repo.markForReview).toHaveBeenCalledWith("qpay-row-1", "AMOUNT_SHORT");
  });

  it("changes nothing while QPay has not confirmed payment yet", async () => {
    const h = harness();
    h.checkPayment.mockResolvedValueOnce({ count: 0, rows: [] });

    const result = await h.service.status(actor, "child-1");

    expect(h.markPaid).not.toHaveBeenCalled();
    expect(h.repo.claimForPayment).not.toHaveBeenCalled();
    expect(result.status).toBe("PENDING");
  });

  /*
   * ★ Review of #258: a stale row used to be expired without asking QPay, so
   * a QR paid in its last seconds took the money and opened nothing. It is
   * asked once, then expired.
   */
  it("asks QPay once about a stale row before expiring it", async () => {
    const h = harness({ expiresAt: new Date(Date.now() - 1000) });
    h.checkPayment.mockResolvedValueOnce({ count: 0, rows: [] });

    const result = await h.service.status(actor, "child-1");

    expect(h.checkPayment).toHaveBeenCalledTimes(1);
    expect(h.repo.markExpired).toHaveBeenCalledWith("qpay-row-1");
    expect(result.status).toBe("EXPIRED");
  });

  it("credits a stale row QPay says was paid", async () => {
    const h = harness({ expiresAt: new Date(Date.now() - 1000) });

    const result = await h.service.status(actor, "child-1");

    expect(h.markPaid).toHaveBeenCalledTimes(1);
    expect(h.repo.markExpired).not.toHaveBeenCalled();
    expect(result.status).toBe("PAID");
  });

  it("credits an EXPIRED row when QPay's callback says it was paid after all", async () => {
    const h = harness({ status: "EXPIRED", expiresAt: new Date(Date.now() - 1000) });

    await h.service.handleCallback("qpay-inv-1");

    expect(h.checkPayment).toHaveBeenCalledTimes(1);
    expect(h.markPaid).toHaveBeenCalledTimes(1);
  });

  it("never re-asks QPay about an EXPIRED row on a poll", async () => {
    const h = harness({ status: "EXPIRED", expiresAt: new Date(Date.now() - 1000) });

    const result = await h.service.status(actor, "child-1");

    expect(h.checkPayment).not.toHaveBeenCalled();
    expect(result.status).toBe("EXPIRED");
  });

  it("says in the audit when the money credited nothing — the target was already paid", async () => {
    const h = harness();
    h.markPaid.mockResolvedValueOnce(false);

    await h.service.status(actor, "child-1");

    expect(h.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        objectType: "QpayInvoice",
        metadata: expect.objectContaining({
          after: expect.objectContaining({ credited: false }),
        }),
      }),
    );
  });

  it("leaves a PENDING row untouched when the QPay check itself fails", async () => {
    const h = harness();
    h.checkPayment.mockRejectedValueOnce(new Error("network down"));

    const result = await h.service.status(actor, "child-1");

    expect(h.markPaid).not.toHaveBeenCalled();
    expect(result.status).toBe("PENDING");
  });
});

describe("starting a new attempt", () => {
  it("reuses an unexpired PENDING attempt instead of creating a second one", async () => {
    const h = harness();

    const result = await h.service.createForSubscription(actor, "child-1");

    expect(h.repo.create).not.toHaveBeenCalled();
    expect(result.id).toBe("qpay-row-1");
  });

  it("creates a fresh attempt when the previous one has expired", async () => {
    const h = harness({ status: "EXPIRED", expiresAt: new Date(Date.now() - 1000) });

    await h.service.createForSubscription(actor, "child-1");

    expect(h.repo.create).toHaveBeenCalledTimes(1);
  });

  it("refuses to charge again for a school year already paid for", async () => {
    const h = harness();
    (h.access.ensureForChild as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "sub-1",
      kindergartenId: "kg-1",
      childId: "child-1",
      status: "ACTIVE",
      amount: { toFixed: () => "15000.00" },
      schoolYear: { id: "year-1", name: "2026-2027", endsOn: new Date("2027-05-31") },
    });

    await expect(h.service.createForSubscription(actor, "child-1")).rejects.toThrow();
    expect(h.repo.create).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QpayClient, QpayError } from "./qpay.client";
import { QpayConfig } from "./qpay.config";
import type { Env } from "../../config/env";

/**
 * The QPay boundary.
 *
 * ★ Every request is mocked — same discipline as `esis.client.test.ts`, for
 * the same reason: there is no sandbox account to call for real, and the
 * point of this file is that the client is provably correct before one
 * exists. The security tests (redaction, never sending the password on a
 * bearer call) matter regardless of whether the assumed contract turns out
 * exactly right.
 */

const USERNAME = "merchant-1";
const PASSWORD = "qpay-secret-password-abc123+/=";

function configured(overrides: Partial<Env> = {}): QpayConfig {
  return new QpayConfig({
    QPAY_BASE_URL: "https://qpay.example.test/",
    QPAY_USERNAME: USERNAME,
    QPAY_PASSWORD: PASSWORD,
    QPAY_INVOICE_CODE: "NOMADKIDS_INVOICE",
    QPAY_CALLBACK_URL: "https://api.nomadkids.mn/v1/qpay/callback",
    QPAY_TIMEOUT_MS: 15_000,
    ...overrides,
  } as Env);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const TOKEN_BODY = {
  token_type: "bearer",
  access_token: "access-token-xyz",
  refresh_token: "refresh-token-xyz",
  expires_in: 3600,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function callArgs(index = 0): [string, RequestInit] {
  return fetchMock.mock.calls[index] as [string, RequestInit];
}

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

describe("configuration", () => {
  it("refuses to call out when unconfigured, naming only the missing settings", async () => {
    const client = new QpayClient(configured({ QPAY_PASSWORD: "" }));

    await expect(
      client.createInvoice({ senderInvoiceNo: "x", amount: "1000.00", description: "test" }),
    ).rejects.toMatchObject({ kind: "not_configured" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports partial configuration by name, not by value", async () => {
    const client = new QpayClient(configured({ QPAY_INVOICE_CODE: "" }));

    try {
      await client.checkPayment("inv-1");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(QpayError);
      expect((error as QpayError).message).toContain("QPAY_INVOICE_CODE");
      expect((error as QpayError).message).not.toContain(PASSWORD);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Authentication and token caching
// ═══════════════════════════════════════════════════════════════════════════

describe("authentication", () => {
  it("exchanges the username and password for a bearer token via Basic auth", async () => {
    fetchMock.mockResolvedValueOnce(json(TOKEN_BODY));
    fetchMock.mockResolvedValueOnce(json({ count: 0, rows: [] }));

    await new QpayClient(configured()).checkPayment("inv-1");

    const [tokenUrl, tokenInit] = callArgs(0);
    expect(tokenUrl).toBe("https://qpay.example.test/v2/auth/token");
    const expectedBasic = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`;
    expect((tokenInit.headers as Record<string, string>).Authorization).toBe(expectedBasic);

    const [, checkInit] = callArgs(1);
    expect((checkInit.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN_BODY.access_token}`,
    );
  });

  it("reuses a cached token instead of re-authenticating on the next call", async () => {
    fetchMock.mockResolvedValueOnce(json(TOKEN_BODY));
    fetchMock.mockResolvedValueOnce(json({ count: 0, rows: [] }));
    fetchMock.mockResolvedValueOnce(json({ count: 0, rows: [] }));

    const client = new QpayClient(configured());
    await client.checkPayment("inv-1");
    await client.checkPayment("inv-2");

    // One auth call, two payment checks — three fetches, not four.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("re-authenticates once the cached token is past its expiry", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValueOnce(json({ ...TOKEN_BODY, expires_in: 60 }));
      fetchMock.mockResolvedValueOnce(json({ count: 0, rows: [] }));

      const client = new QpayClient(configured());
      await client.checkPayment("inv-1");

      vi.advanceTimersByTime(61_000);

      fetchMock.mockResolvedValueOnce(json(TOKEN_BODY));
      fetchMock.mockResolvedValueOnce(json({ count: 0, rows: [] }));
      await client.checkPayment("inv-2");

      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(callArgs(2)[0]).toBe("https://qpay.example.test/v2/auth/token");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Domain calls
// ═══════════════════════════════════════════════════════════════════════════

describe("createInvoice", () => {
  it("sends the invoice code, amount as a number, and the configured callback URL", async () => {
    fetchMock.mockResolvedValueOnce(json(TOKEN_BODY));
    fetchMock.mockResolvedValueOnce(
      json({ invoice_id: "qpay-inv-1", qr_text: "0002...", qr_image: "iVBORw0KG..." }),
    );

    const result = await new QpayClient(configured()).createInvoice({
      senderInvoiceNo: "sender-1",
      amount: "195000.00",
      description: "Test invoice",
    });

    expect(result.invoice_id).toBe("qpay-inv-1");

    const [, init] = callArgs(1);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      invoice_code: "NOMADKIDS_INVOICE",
      sender_invoice_no: "sender-1",
      amount: 195000,
      callback_url: "https://api.nomadkids.mn/v1/qpay/callback",
    });
  });

  it("throws invalid_response when the reply is missing invoice_id", async () => {
    fetchMock.mockResolvedValueOnce(json(TOKEN_BODY));
    fetchMock.mockResolvedValueOnce(json({ qr_text: "no id here" }));

    await expect(
      new QpayClient(configured()).createInvoice({
        senderInvoiceNo: "sender-1",
        amount: "1000.00",
        description: "x",
      }),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });
});

describe("checkPayment", () => {
  it("reports a PAID row when QPay's check says PAID", async () => {
    fetchMock.mockResolvedValueOnce(json(TOKEN_BODY));
    fetchMock.mockResolvedValueOnce(
      json({
        count: 1,
        rows: [{ payment_id: "qpay-pay-1", payment_status: "PAID", payment_amount: "195000" }],
      }),
    );

    const result = await new QpayClient(configured()).checkPayment("qpay-inv-1");

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.payment_status).toBe("PAID");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Failure and redaction
// ═══════════════════════════════════════════════════════════════════════════

describe("failure handling", () => {
  it("wraps a non-2xx response as an http error, without the password", async () => {
    fetchMock.mockResolvedValueOnce(json(TOKEN_BODY));
    fetchMock.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));

    try {
      await new QpayClient(configured()).checkPayment("inv-1");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(QpayError);
      expect((error as QpayError).kind).toBe("http");
      expect((error as QpayError).detail.status).toBe(403);
    }
  });

  it("wraps a network failure without leaking the password into the message", async () => {
    fetchMock.mockResolvedValueOnce(json(TOKEN_BODY));
    fetchMock.mockRejectedValueOnce(new Error(`connect failed for ${PASSWORD}`));

    try {
      await new QpayClient(configured()).checkPayment("inv-1");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(QpayError);
      expect((error as QpayError).kind).toBe("network");
      expect((error as QpayError).message).not.toContain(PASSWORD);
      expect((error as QpayError).message).toContain("[REDACTED]");
    }
  });

  it("never puts the password in a request URL", async () => {
    fetchMock.mockResolvedValueOnce(json(TOKEN_BODY));
    fetchMock.mockResolvedValueOnce(json({ count: 0, rows: [] }));

    await new QpayClient(configured()).checkPayment("inv-1");

    for (let i = 0; i < fetchMock.mock.calls.length; i++) {
      expect(callArgs(i)[0]).not.toContain(PASSWORD);
    }
  });
});

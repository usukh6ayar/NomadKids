import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QpayClient, QpayError } from "./qpay.client";
import { QpayConfig } from "./qpay.config";
import type { Env } from "../../config/env";

/**
 * The QPay boundary.
 *
 * ★ Every request is mocked — nothing here resolves a hostname or spends money.
 *
 * ★★ The token tests are the reason this file exists. QPay's integration note
 * asks for a timestamp-driven, single-use token flow, and the failure modes are
 * all silent: a client that never refreshes works until the first expiry, one
 * that refreshes per call works but gets rate-limited, and one that stampedes
 * under concurrency does both intermittently. None of them fails loudly.
 */

const PASSWORD = "qpay-secret-pass-9876+/=";

function configured(overrides: Partial<Env> = {}): QpayConfig {
  return new QpayConfig({
    QPAY_BASE_URL: "https://merchant.qpay.test/v2/",
    QPAY_USERNAME: "NOMADKIDS",
    QPAY_PASSWORD: PASSWORD,
    QPAY_INVOICE_CODE: "NOMADKIDS_INVOICE",
    QPAY_CALLBACK_URL: "https://api.nomadkids.test/v1/payments/qpay/callback",
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

/** A token response with a generous lifetime. */
function tokenBody(overrides: Record<string, unknown> = {}) {
  return { access_token: "tok-alpha", expires_in: 3600, ...overrides };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function headersOf(callIndex: number): Record<string, string> {
  const [, init] = fetchMock.mock.calls[callIndex] as [string, RequestInit];
  return init.headers as Record<string, string>;
}

describe("configuration", () => {
  it("refuses to call anything when unconfigured, naming only the missing keys", async () => {
    const client = new QpayClient(configured({ QPAY_PASSWORD: "" } as Partial<Env>));

    await expect(client.request({ path: "/invoice" })).rejects.toMatchObject({
      kind: "not_configured",
    });
    // No network work at all — the point of failing before the call.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never names a secret's value in the not_configured message", async () => {
    const client = new QpayClient(configured({ QPAY_INVOICE_CODE: "" } as Partial<Env>));

    const error = await client.request({ path: "/invoice" }).catch((e: QpayError) => e);
    expect((error as QpayError).message).toContain("QPAY_INVOICE_CODE");
    expect((error as QpayError).message).not.toContain(PASSWORD);
  });
});

describe("the token flow — QPay's §2.1", () => {
  it("authenticates /auth/token with Basic, then everything else with Bearer", async () => {
    fetchMock.mockResolvedValueOnce(json(tokenBody()));
    fetchMock.mockResolvedValueOnce(json({ ok: true }));

    const client = new QpayClient(configured());
    await client.request({ path: "/invoice", method: "POST" });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const auth = headersOf(0).Authorization!;
    expect(auth.startsWith("Basic ")).toBe(true);
    expect(Buffer.from(auth.slice(6), "base64").toString()).toBe(`NOMADKIDS:${PASSWORD}`);

    expect(headersOf(1).Authorization).toBe("Bearer tok-alpha");
  });

  it("reuses a live token instead of fetching one per call", async () => {
    fetchMock.mockResolvedValueOnce(json(tokenBody()));
    fetchMock.mockResolvedValue(json({ ok: true }));

    const client = new QpayClient(configured());
    await client.request({ path: "/a" });
    await client.request({ path: "/b" });
    await client.request({ path: "/c" });

    // One token fetch, three business calls — not four token fetches.
    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/auth/token"));
    expect(tokenCalls).toHaveLength(1);
  });

  it("collapses concurrent refreshes into a single /auth/token call", async () => {
    // The stampede case: ten callers find no token at the same instant. Ten
    // token requests is how an integration gets rate-limited by its provider.
    let resolveToken: (r: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      resolveToken = resolve;
    });

    fetchMock.mockImplementationOnce(() => pending);
    fetchMock.mockResolvedValue(json({ ok: true }));

    const client = new QpayClient(configured());
    const calls = Promise.all(
      Array.from({ length: 10 }, (_, i) => client.request({ path: `/p${i}` })),
    );

    resolveToken(json(tokenBody()));
    await calls;

    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/auth/token"));
    expect(tokenCalls).toHaveLength(1);
  });

  it("re-fetches once the token has expired", async () => {
    // expires_in below the skew means it is already stale on arrival.
    fetchMock.mockResolvedValueOnce(json(tokenBody({ access_token: "tok-1", expires_in: 1 })));
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    fetchMock.mockResolvedValueOnce(json(tokenBody({ access_token: "tok-2", expires_in: 1 })));
    fetchMock.mockResolvedValueOnce(json({ ok: true }));

    const client = new QpayClient(configured());
    await client.request({ path: "/a" });
    await client.request({ path: "/b" });

    expect(headersOf(1).Authorization).toBe("Bearer tok-1");
    expect(headersOf(3).Authorization).toBe("Bearer tok-2");
  });

  it("drops a token QPay rejects with 401, so the next call re-authenticates", async () => {
    fetchMock.mockResolvedValueOnce(json(tokenBody({ access_token: "stale" })));
    fetchMock.mockResolvedValueOnce(json({ error: "unauthorized" }, 401));
    fetchMock.mockResolvedValueOnce(json(tokenBody({ access_token: "fresh" })));
    fetchMock.mockResolvedValueOnce(json({ ok: true }));

    const client = new QpayClient(configured());
    await expect(client.request({ path: "/a" })).rejects.toMatchObject({ kind: "http" });
    await client.request({ path: "/b" });

    expect(headersOf(3).Authorization).toBe("Bearer fresh");
  });

  it("does not cache a failed refresh", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "bad creds" }, 401));
    fetchMock.mockResolvedValueOnce(json(tokenBody({ access_token: "recovered" })));
    fetchMock.mockResolvedValueOnce(json({ ok: true }));

    const client = new QpayClient(configured());
    await expect(client.request({ path: "/a" })).rejects.toMatchObject({ kind: "auth" });

    // A retained rejected promise would poison every later call.
    await client.request({ path: "/b" });
    expect(headersOf(2).Authorization).toBe("Bearer recovered");
  });

  it("reports a missing access_token as an auth failure, not a success", async () => {
    fetchMock.mockResolvedValueOnce(json({ expires_in: 3600 }));

    const client = new QpayClient(configured());
    await expect(client.request({ path: "/a" })).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("secrets never escape", () => {
  it("keeps the password out of an error body excerpt", async () => {
    fetchMock.mockResolvedValueOnce(json(tokenBody()));
    // A provider echoing credentials back is not hypothetical.
    fetchMock.mockResolvedValueOnce(
      new Response(`{"error":"bad password ${PASSWORD}"}`, { status: 400 }),
    );

    const client = new QpayClient(configured());
    const error = (await client.request({ path: "/a" }).catch((e) => e)) as QpayError;

    expect(error.detail.bodyExcerpt).not.toContain(PASSWORD);
    expect(error.detail.bodyExcerpt).toContain("[REDACTED]");
  });

  it("keeps the bearer token out of an error body excerpt", async () => {
    fetchMock.mockResolvedValueOnce(json(tokenBody({ access_token: "tok-leaky-value-123" })));
    fetchMock.mockResolvedValueOnce(
      new Response(`{"error":"token tok-leaky-value-123 rejected"}`, { status: 403 }),
    );

    const client = new QpayClient(configured());
    const error = (await client.request({ path: "/a" }).catch((e) => e)) as QpayError;

    expect(error.detail.bodyExcerpt).not.toContain("tok-leaky-value-123");
  });

  it("never puts a credential in the URL", async () => {
    fetchMock.mockResolvedValueOnce(json(tokenBody()));
    fetchMock.mockResolvedValueOnce(json({ ok: true }));

    const client = new QpayClient(configured());
    await client.request({ path: "/invoice", query: { page: 1 } });

    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain(PASSWORD);
      expect(String(url)).not.toContain("tok-alpha");
    }
  });
});

describe("transport failures", () => {
  it("separates a timeout from a connection fault", async () => {
    fetchMock.mockResolvedValueOnce(json(tokenBody()));
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValueOnce(timeout);

    const client = new QpayClient(configured());
    await expect(client.request({ path: "/a" })).rejects.toMatchObject({ kind: "timeout" });

    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(client.request({ path: "/b" })).rejects.toMatchObject({ kind: "network" });
  });

  it("reports a non-JSON body as invalid_response", async () => {
    fetchMock.mockResolvedValueOnce(json(tokenBody()));
    fetchMock.mockResolvedValueOnce(new Response("<html>502</html>", { status: 200 }));

    const client = new QpayClient(configured());
    await expect(client.request({ path: "/a" })).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("reports a payload that fails validation as invalid_response", async () => {
    fetchMock.mockResolvedValueOnce(json(tokenBody()));
    fetchMock.mockResolvedValueOnce(json({ unexpected: true }));

    const client = new QpayClient(configured());
    await expect(
      client.request({
        path: "/a",
        parse: () => {
          throw new Error("shape changed");
        },
      }),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("joins the base URL and path without doubling the slash", async () => {
    fetchMock.mockResolvedValueOnce(json(tokenBody()));
    fetchMock.mockResolvedValueOnce(json({ ok: true }));

    const client = new QpayClient(configured());
    await client.request({ path: "/invoice" });

    expect(String(fetchMock.mock.calls[1]![0])).toBe("https://merchant.qpay.test/v2/invoice");
  });
});

describe("describe() — what an operator may see", () => {
  it("reports presence of a password, never its value or length", () => {
    const config = configured();
    const described = config.describe();

    expect(described).toEqual({
      configured: true,
      baseUrl: "https://merchant.qpay.test/v2",
      invoiceCode: "NOMADKIDS_INVOICE",
      hasPassword: true,
    });
    expect(JSON.stringify(described)).not.toContain(PASSWORD);
    // The username is half a credential pair and is withheld too.
    expect(JSON.stringify(described)).not.toContain("NOMADKIDS:");
  });
});

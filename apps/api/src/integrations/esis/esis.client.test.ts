import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EsisClient, EsisError } from "./esis.client";
import { EsisConfig } from "./esis.config";
import type { Env } from "../../config/env";

/**
 * The ESIS boundary.
 *
 * ★ Every request is mocked. Nothing here resolves a hostname, and no test
 * needs a real token — the point of the boundary is that it can be proven
 * correct before the ministry's API is available to us.
 *
 * ★★ The security properties are the reason this file exists. A client that
 * forgets the `Authorization` header fails loudly on the first real call; one
 * that leaks the token into a log fails silently, for as long as the logs are
 * retained. The leak tests are therefore the ones worth reading.
 */

const TOKEN = "esis-secret-token-abc123+/=";

/** A config with everything set, without touching `process.env`. */
function configured(overrides: Partial<Env> = {}): EsisConfig {
  return new EsisConfig({
    ESIS_BASE_URL: "https://esis.example.test/api/",
    ESIS_TOKEN: TOKEN,
    ESIS_INSTITUTION_ID: "INST-42",
    ESIS_TIMEOUT_MS: 15_000,
    ...overrides,
  } as Env);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

/** The options `fetch` was called with. */
function callArgs(): [string, RequestInit] {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return fetchMock.mock.calls[0] as [string, RequestInit];
}

// ═══════════════════════════════════════════════════════════════════════════
// Authentication and configuration
// ═══════════════════════════════════════════════════════════════════════════

describe("authentication", () => {
  it("sends the token as a Bearer credential", async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));

    await new EsisClient(configured()).request({ path: "/v1/thing" });

    const [, init] = callArgs();
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("never puts the token in the URL", async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));

    await new EsisClient(configured()).request({
      path: "/v1/thing",
      query: { page: 2, institution: "INST-42" },
    });

    const [url] = callArgs();
    // A query secret ends up in access logs, proxies and browser history.
    expect(url).not.toContain(TOKEN);
    expect(url).toBe("https://esis.example.test/api/v1/thing?page=2&institution=INST-42");
  });
});

describe("configuration", () => {
  it("respects the base URL and joins paths without a double slash", async () => {
    fetchMock.mockResolvedValue(json({}));

    // Base URL has a trailing slash; the path has a leading one.
    await new EsisClient(configured()).request({ path: "/v1/a/b" });

    expect(callArgs()[0]).toBe("https://esis.example.test/api/v1/a/b");
  });

  it("honours a per-call timeout override", async () => {
    fetchMock.mockResolvedValue(json({}));

    await new EsisClient(configured()).request({ path: "/v1/thing", timeoutMs: 2000 });

    expect(callArgs()[1].signal).toBeInstanceOf(AbortSignal);
  });

  it.each([["ESIS_TOKEN", { ESIS_TOKEN: "" }]])(
    "fails safely when %s is missing, without calling out",
    async (name, override) => {
      const client = new EsisClient(configured(override as Partial<Env>));

      const error = await client
        .request({ path: "/v1/thing" })
        .catch((e: unknown) => e as EsisError);

      expect(error).toBeInstanceOf(EsisError);
      expect((error as EsisError).kind).toBe("not_configured");
      expect((error as EsisError).message).toContain(name);
      // ★ No network attempt at all — an unconfigured instance must not resolve
      // a hostname, let alone send a header.
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("reports readiness without revealing the token", () => {
    const described = configured().describe();

    // ★ `demoMode` and `mode` joined the payload on 2026-09-09, so the admin
    // screen can say which of the two ESIS modes is live. They are booleans
    // and a literal, not credentials — the assertion below is what this test
    // is actually for, and it walks the whole serialised object, so a field
    // added here can never smuggle the token past it.
    expect(described).toEqual({
      configured: true,
      demoMode: false,
      mode: "LIVE",
      baseUrl: "https://esis.example.test/api",
      hasToken: true,
    });
    // Not the value, not a prefix, not the length: a length narrows a search
    // and a JWT's prefix names its algorithm.
    expect(JSON.stringify(described)).not.toContain(TOKEN);
    expect(JSON.stringify(described)).not.toContain(String(TOKEN.length));
  });

  it("needs only the token because URL and tenant scope have other sources", () => {
    expect(configured({ ESIS_TOKEN: "" }).isConfigured).toBe(false);
    expect(configured({ ESIS_BASE_URL: "", ESIS_INSTITUTION_ID: "" }).isConfigured).toBe(true);
    expect(configured().isConfigured).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The token must not leak — the tests that catch a silent failure
// ═══════════════════════════════════════════════════════════════════════════

describe("the token never leaks", () => {
  it("is absent from logs on a successful call", async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));

    const client = new EsisClient(configured());
    const written: string[] = [];
    vi.spyOn(client["logger"], "log").mockImplementation((m: unknown) => {
      written.push(String(m));
    });
    vi.spyOn(client["logger"], "warn").mockImplementation((m: unknown) => {
      written.push(String(m));
    });

    await client.request({ path: "/v1/thing" });

    expect(written.join("\n")).not.toContain(TOKEN);
    expect(written.join("\n")).toContain("/v1/thing");
  });

  it("is absent from logs when the call fails", async () => {
    fetchMock.mockResolvedValue(json({ error: "nope" }, 500));

    const client = new EsisClient(configured());
    const written: string[] = [];
    vi.spyOn(client["logger"], "warn").mockImplementation((m: unknown) => {
      written.push(String(m));
    });

    await client.request({ path: "/v1/thing" }).catch(() => undefined);

    expect(written.join("\n")).not.toContain(TOKEN);
  });

  it("is scrubbed from an error body even when ESIS echoes it back", async () => {
    /*
     * ★ The case that justifies `redact()`.
     *
     * An upstream that reflects the Authorization header into an error body is
     * not hypothetical — misconfigured gateways do it. Habits 1 and 2 (no token
     * in the URL, no header logging) cannot help here, because the token is
     * arriving from outside.
     */
    fetchMock.mockResolvedValue(json({ message: `invalid credentials: Bearer ${TOKEN}` }, 401));

    const error = (await new EsisClient(configured())
      .request({ path: "/v1/thing" })
      .catch((e: unknown) => e)) as EsisError;

    expect(error.detail.bodyExcerpt).toBeDefined();
    expect(error.detail.bodyExcerpt).not.toContain(TOKEN);
    expect(error.detail.bodyExcerpt).toContain("[REDACTED]");
    // The whole error, however it is serialised, is clean.
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain(TOKEN);
  });

  it("is scrubbed from a network error message", async () => {
    fetchMock.mockRejectedValue(new Error(`connect failed using Bearer ${TOKEN}`));

    const error = (await new EsisClient(configured())
      .request({ path: "/v1/thing" })
      .catch((e: unknown) => e)) as EsisError;

    expect(error.message).not.toContain(TOKEN);
    expect(error.message).toContain("[REDACTED]");
  });

  it("does not corrupt messages when no token is configured", async () => {
    // A naive global replace of "" inserts the placeholder between every
    // character. This asserts the guard against that.
    const client = new EsisClient(configured({ ESIS_TOKEN: "" }));

    const error = (await client
      .request({ path: "/v1/thing" })
      .catch((e: unknown) => e)) as EsisError;

    expect(error.message).not.toContain("[REDACTED]");
    expect(error.message).toContain("ESIS_TOKEN");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Failures become one consistent internal error
// ═══════════════════════════════════════════════════════════════════════════

describe("error handling", () => {
  it.each([400, 401, 403, 404, 429, 500, 503])(
    "turns HTTP %i into an EsisError rather than a thrown Response",
    async (status) => {
      fetchMock.mockResolvedValue(json({ detail: "upstream said no" }, status));

      const error = (await new EsisClient(configured())
        .request({ path: "/v1/thing" })
        .catch((e: unknown) => e)) as EsisError;

      expect(error).toBeInstanceOf(EsisError);
      expect(error.kind).toBe("http");
      expect(error.detail.status).toBe(status);
      expect(error.detail.path).toBe("/v1/thing");
      // ★ Deliberately NOT an HttpException: forwarding the ministry's 401
      // would tell our administrator that *their* session was rejected.
      expect(error).not.toHaveProperty("getStatus");
    },
  );

  it("distinguishes a timeout from a connection failure", async () => {
    const timeout = new Error("aborted");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValue(timeout);

    const error = (await new EsisClient(configured())
      .request({ path: "/v1/thing" })
      .catch((e: unknown) => e)) as EsisError;

    // Only one of these two is worth retrying, which is why they differ.
    expect(error.kind).toBe("timeout");
  });

  it("reports a non-JSON body as invalid_response, not as success", async () => {
    fetchMock.mockResolvedValue(new Response("<html>gateway</html>", { status: 200 }));

    const error = (await new EsisClient(configured())
      .request({ path: "/v1/thing" })
      .catch((e: unknown) => e)) as EsisError;

    expect(error.kind).toBe("invalid_response");
    expect(error.detail.bodyExcerpt).toContain("<html>");
  });

  it("reports a schema mismatch as invalid_response", async () => {
    fetchMock.mockResolvedValue(json({ unexpected: true }));

    const error = (await new EsisClient(configured())
      .request({
        path: "/v1/thing",
        parse: () => {
          throw new Error("expected `id`");
        },
      })
      .catch((e: unknown) => e)) as EsisError;

    // A developer's problem, not an operator's: retrying cannot fix a payload
    // that no longer matches.
    expect(error.kind).toBe("invalid_response");
    expect(error.message).toContain("expected `id`");
  });

  it("truncates a very long error body", async () => {
    fetchMock.mockResolvedValue(new Response("x".repeat(5000), { status: 500 }));

    const error = (await new EsisClient(configured())
      .request({ path: "/v1/thing" })
      .catch((e: unknown) => e)) as EsisError;

    expect(error.detail.bodyExcerpt!.length).toBeLessThanOrEqual(501);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Ordinary success
// ═══════════════════════════════════════════════════════════════════════════

describe("successful requests", () => {
  it("returns the parsed body, status and duration", async () => {
    fetchMock.mockResolvedValue(json({ id: "abc" }));

    const result = await new EsisClient(configured()).request<{ id: string }>({
      path: "/v1/thing",
    });

    expect(result.data).toEqual({ id: "abc" });
    expect(result.status).toBe(200);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("sends a JSON body and content type on a write", async () => {
    fetchMock.mockResolvedValue(json({ ok: true }, 201));

    await new EsisClient(configured()).request({
      path: "/v1/thing",
      method: "POST",
      body: { name: "test" },
    });

    const [, init] = callArgs();
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"name":"test"}');
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("treats an empty 204 as success with a null body", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const result = await new EsisClient(configured()).request({
      path: "/v1/thing",
      method: "DELETE",
    });

    expect(result.status).toBe(204);
    expect(result.data).toBeNull();
  });

  it("drops undefined query values rather than sending the string 'undefined'", async () => {
    fetchMock.mockResolvedValue(json({}));

    await new EsisClient(configured()).request({
      path: "/v1/thing",
      query: { a: "1", b: undefined },
    });

    expect(callArgs()[0]).toBe("https://esis.example.test/api/v1/thing?a=1");
  });
});

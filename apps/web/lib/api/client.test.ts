import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, apiFetch } from "./client";

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const spy = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("apiFetch", () => {
  it("always sends credentials and never caches", async () => {
    // These two defaults are the whole reason this wrapper exists. A cached
    // authenticated response would serve one child's data to another parent.
    const spy = mockFetch(200, { status: "ok" });
    await apiFetch("/health", z.object({ status: z.string() }));

    const init = spy.mock.calls[0]![1];
    expect(init.credentials).toBe("include");
    expect(init.cache).toBe("no-store");
  });

  it("prefixes the API version", async () => {
    const spy = mockFetch(200, { status: "ok" });
    await apiFetch("/health", z.object({ status: z.string() }));
    expect(spy.mock.calls[0]![0]).toMatch(/\/v1\/health$/);
  });

  it("validates the response against the schema", async () => {
    mockFetch(200, { status: 42 });
    await expect(apiFetch("/health", z.object({ status: z.string() }))).rejects.toThrow();
  });

  it("throws ApiError carrying the problem document", async () => {
    mockFetch(404, {
      type: "about:blank",
      title: "Олдсонгүй",
      status: 404,
      requestId: "abc",
    });

    const error = await apiFetch("/children/x", z.unknown()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isNotFound).toBe(true);
    expect((error as ApiError).problem.requestId).toBe("abc");
  });

  it("survives an error response that is not problem+json", async () => {
    mockFetch(500, "<html>gateway error</html>");
    const error = await apiFetch("/health", z.unknown()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
  });

  it("sends the CSRF token on unsafe methods", async () => {
    const spy = mockFetch(200, {});
    await apiFetch("/children", z.unknown(), {
      method: "POST",
      body: { a: 1 },
      csrfToken: "token-value",
    });

    const init = spy.mock.calls[0]![1];
    expect(init.headers["X-CSRF-Token"]).toBe("token-value");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });
});

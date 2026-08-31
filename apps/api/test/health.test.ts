import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { authed, createScenario, login } from "./support/fixtures";

/**
 * ★ One application for the whole file, deliberately.
 *
 * Both suites below only read. Booting a second `createTestApp()` for the
 * second one would double this file's share of a Redis and a socket pool that
 * every other test file is using at the same time — the pressure
 * `IMPLEMENTATION_STATUS.md` (Phase 5) records as intermittent, cross-file
 * login failures. Nothing here needs an isolated app to be honest.
 */
let app: INestApplication;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

/**
 * Health endpoint, tested against the FULL application.
 *
 * It previously imported HealthModule alone, which meant the globally
 * registered AuthGuard never ran — so the test passed while the real deployed
 * app returned 401 for every liveness probe. A container that fails its health
 * check gets restart-looped by the platform, so this was a production outage
 * that a green test suite would have signed off on.
 *
 * The lesson generalises: anything asserting an endpoint is reachable must boot
 * the real guard stack, or it is asserting something else.
 */
describe("health endpoint", () => {
  it("is reachable WITHOUT authentication", async () => {
    const res = await request(app.getHttpServer()).get("/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("discloses nothing beyond the status", async () => {
    // No version, no database name, no dependency detail on an
    // unauthenticated endpoint.
    const res = await request(app.getHttpServer()).get("/v1/health");
    expect(Object.keys(res.body)).toEqual(["status"]);
  });

  it("returns problem+json for an unknown route", async () => {
    const res = await request(app.getHttpServer()).get("/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.body.title).toBe("Олдсонгүй");
    expect(res.body.requestId).toEqual(expect.any(String));
  });

  it("keeps every other endpoint behind authentication", async () => {
    // The counterpart to the first test: @Public() must be the exception, not
    // the pattern. If this ever returns 200, the global guard is not applied.
    const res = await request(app.getHttpServer()).get("/v1/auth/me");
    expect(res.status).toBe(401);
  });
});

/**
 * The ESIS block on `/health/readiness`.
 *
 * ★ This is what an inspector from БМТТ is shown when they ask whether the
 * system is ready to be connected — see `docs/ESIS_COMPLIANCE.md` §4. It
 * matters that it is *this* endpoint: readiness is already administrator-only
 * and already discloses dependencies, so the answer costs no new surface.
 *
 * ★★ The second test is the load-bearing one. The whole reason the integration
 * boundary reports through `describe()` rather than the config is that the
 * token must not reach a response, and an assertion on the key list is what
 * keeps a future field from quietly adding it.
 */
describe("readiness: the ESIS boundary", () => {
  it("is not readable without an administrator session", async () => {
    const res = await request(app.getHttpServer()).get("/v1/health/readiness");
    expect(res.status).toBe(401);
  });

  it("reports whether ESIS is configured, without disclosing the token", async () => {
    const scenario = await createScenario("esis");
    const admin = await login(app, scenario.adminUser.username);

    const res = await authed(request(app.getHttpServer()).get("/v1/health/readiness"), admin);

    expect(res.status).toBe(200);
    // Presence of a token, never any part of its value — not a prefix, not a
    // length. The exact key list is asserted so that adding one is a decision.
    expect(Object.keys(res.body.esis).sort()).toEqual([
      "baseUrl",
      "configured",
      "hasToken",
      "institutionId",
    ]);
    expect(JSON.stringify(res.body)).not.toContain("ESIS_TOKEN");
    // The test environment sets no ESIS credentials, and that is a legitimate
    // state rather than a fault.
    expect(res.body.esis.configured).toBe(false);
    expect(res.body.esis.hasToken).toBe(false);

    // ★ And it must not drag the overall status down. Every month between the
    // contract request and БМТТ issuing a token is a month with no credentials
    // (журам A/465 §3.5–3.7); a deployment that called itself degraded for all
    // of it would train its operators to ignore the field.
    const gating = res.body.storage && res.body.chromium && res.body.redis && res.body.cyrillicFont;
    expect(res.body.status).toBe(gating ? "ok" : "degraded");
  });
});

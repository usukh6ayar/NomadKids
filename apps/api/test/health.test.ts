import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";

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
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

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

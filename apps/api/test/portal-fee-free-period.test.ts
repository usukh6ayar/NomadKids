import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { isPortalFeeCharging } from "../src/authz/portal-access";

/**
 * The portal fee's free period — the user, 2026-10-21: "эцэг эхийн төлбөрийг
 * 11 сарын 30 хүртэл үнэгүй". `ACCESS_FEE_FREE_UNTIL` opens the gate through
 * its last day with the price still set, and the price returns by itself the
 * day after — nobody has to remember to switch it back on.
 */

describe("isPortalFeeCharging", () => {
  const fee = { amount: "22000.00", freeUntil: "2026-11-30" };

  it("is free through the last day, inclusive, and charges the day after", () => {
    expect(isPortalFeeCharging(fee, "2026-10-21")).toBe(false);
    expect(isPortalFeeCharging(fee, "2026-11-30")).toBe(false);
    expect(isPortalFeeCharging(fee, "2026-12-01")).toBe(true);
  });

  it("charges with no free period, and never with no price", () => {
    expect(isPortalFeeCharging({ amount: "22000.00", freeUntil: "" }, "2026-10-21")).toBe(true);
    expect(isPortalFeeCharging({ amount: "0", freeUntil: "" }, "2027-01-01")).toBe(false);
  });
});

let app: INestApplication;
let a: Scenario;
let parent: AuthSession;

const server = () => app.getHttpServer();
const readChild = () => authed(request(server()).get(`/v1/children/${a.child.id}`), parent);
const accessStatus = () =>
  authed(request(server()).get(`/v1/children/${a.child.id}/access`), parent);

/** One app per setting: the services read the deployment's fee at construction. */
function withFee(freeUntil: string) {
  beforeAll(async () => {
    process.env.ACCESS_FEE_AMOUNT = "22000.00";
    process.env.ACCESS_FEE_FREE_UNTIL = freeUntil;
    app = await createTestApp();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env.ACCESS_FEE_AMOUNT = "0";
    process.env.ACCESS_FEE_FREE_UNTIL = "";
  });

  beforeEach(async () => {
    await resetData();
    await app.get(RateLimitService).resetAll();
    a = await createScenario("a");
    parent = await login(app, a.parentUser.username);
  });
}

describe("while the free period runs", () => {
  withFee("2099-11-30");

  it("lets an unpaid guardian read their child — no 402", async () => {
    expect((await readChild()).status).toBe(200);
  });

  it("tells the unlock screen nothing is owed, and until when", async () => {
    const res = await accessStatus();

    expect(res.status).toBe(200);
    expect(res.body.required).toBe(false);
    expect(res.body.freeUntil).toBe("2099-11-30");
  });

  it("sells nothing — a year bought now would charge for the free weeks", async () => {
    const res = await authed(request(server()).post(`/v1/children/${a.child.id}/access`), parent);

    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("2099-11-30");
  });
});

describe("once the free period has ended", () => {
  withFee("2020-11-30");

  it("gates the unpaid guardian again with 402, nobody having touched the setting", async () => {
    expect((await readChild()).status).toBe(402);

    const status = await accessStatus();
    expect(status.body.required).toBe(true);
    expect(status.body.freeUntil).toBeNull();
  });
});

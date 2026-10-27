import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { localDate } from "@kinder/contracts";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * ★ A contracted kindergarten whose paid service has lapsed — the user,
 * 2026-10-27: «эрх дуусвал зөвхөн төлбөрийн хуудас нээгдэж, бусад ажил
 * хаагдана». Seven days after the contract's paid end, its staff reach only
 * «Үйлчилгээний эрх»; families keep their own, separately paid access.
 */
let app: INestApplication;
const db = testDb();
const server = () => app.getHttpServer();

let a: Scenario;
let b: Scenario;

const DAY = 86_400_000;
const TODAY = new Date(`${localDate()}T00:00:00.000Z`);

beforeAll(async () => {
  app = await createTestApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();
  a = await createScenario("a");
  b = await createScenario("b");
});

/** Kindergarten A's contract in force, its paid period ending `days` from today. */
async function contractEnding(days: number) {
  const application = await db.kindergartenApplication.create({
    data: {
      kindergartenName: a.kindergarten.name,
      registrationNumber: "1234567",
      directorName: "Бат Сүх",
      phone: "99001122",
      email: `${uniq("kg")}@example.mn`,
      groupCount: 1,
      status: "APPROVED",
      kindergartenId: a.kindergarten.id,
    },
  });
  await db.contract.create({
    data: {
      applicationId: application.id,
      kindergartenId: a.kindergarten.id,
      number: `NK-2026-${uniq("n").slice(-6)}`,
      status: "ACTIVE",
      groupCount: 1,
      billingPeriod: "TERM",
      perGroupMonthlyFee: "4000.00",
      periodFee: "12000.00",
      startsOn: new Date(TODAY.getTime() - 120 * DAY),
      endsOn: new Date(TODAY.getTime() + days * DAY),
    },
  });
}

const get = (path: string, who: AuthSession) => authed(request(server()).get(path), who);

describe("a lapsed service", () => {
  let adminA: AuthSession;
  let teacherA: AuthSession;
  let parentA: AuthSession;

  beforeEach(async () => {
    adminA = await login(app, a.adminUser.username);
    teacherA = await login(app, a.teacherUser.username);
    parentA = await login(app, a.parentUser.username);
  });

  it("keeps staff working through the seven days after the paid end", async () => {
    await contractEnding(-7);
    expect((await get(`/v1/children/${a.child.id}`, teacherA)).status).toBe(200);
    expect((await get(`/v1/children/${a.child.id}`, adminA)).status).toBe(200);
  });

  it("closes the child register to the kindergarten's staff on the eighth day", async () => {
    await contractEnding(-8);
    expect((await get(`/v1/children/${a.child.id}`, teacherA)).status).toBe(404);
    expect((await get(`/v1/children/${a.child.id}`, adminA)).status).toBe(404);
    const groups = await get(`/v1/groups/${a.group.id}`, teacherA);
    expect(groups.status).toBe(404);
  });

  it("leaves the director «Үйлчилгээний эрх» to pay", async () => {
    await contractEnding(-30);
    const res = await get(`/v1/service-access?kindergartenId=${a.kindergarten.id}`, adminA);
    expect(res.status).toBe(200);
    expect(res.body.expiresAt).toBe(localDate(new Date(TODAY.getTime() - 30 * DAY)));
    // …and nobody else: a teacher was never a director there.
    expect((await get("/v1/service-access", teacherA)).status).toBe(404);
  });

  it("says so on /auth/me, and leaves the membership out", async () => {
    await contractEnding(-30);
    const me = await get("/v1/auth/me", adminA);
    expect(me.status).toBe(200);
    expect(me.body.lapsed).toEqual([
      { kindergartenId: a.kindergarten.id, role: "ADMIN", name: a.kindergarten.name },
    ]);
    expect(
      me.body.memberships.some(
        (m: { kindergartenId: string }) => m.kindergartenId === a.kindergarten.id,
      ),
    ).toBe(false);
  });

  it("never closes a family — their access is the fee they pay", async () => {
    await contractEnding(-30);
    expect((await get(`/v1/children/${a.child.id}`, parentA)).status).toBe(200);
  });

  it("does not touch a kindergarten whose contract is paid, or one with none", async () => {
    await contractEnding(30);
    expect((await get(`/v1/children/${a.child.id}`, teacherA)).status).toBe(200);
    const teacherB = await login(app, b.teacherUser.username);
    expect((await get(`/v1/children/${b.child.id}`, teacherB)).status).toBe(200);
  });

  it("opens again the moment a period is paid", async () => {
    await contractEnding(-30);
    expect((await get(`/v1/children/${a.child.id}`, teacherA)).status).toBe(404);
    await db.contract.updateMany({
      where: { kindergartenId: a.kindergarten.id },
      data: { endsOn: new Date(TODAY.getTime() + 90 * DAY) },
    });
    expect((await get(`/v1/children/${a.child.id}`, teacherA)).status).toBe(200);
  });

  it("closes nothing in another kindergarten the same person works at", async () => {
    await contractEnding(-30);
    await db.membership.create({
      data: { userId: a.teacherUser.id, kindergartenId: b.kindergarten.id, role: "ADMIN" },
    });
    const both = await login(app, a.teacherUser.username);
    expect((await get(`/v1/children/${b.child.id}`, both)).status).toBe(200);
    expect((await get(`/v1/children/${a.child.id}`, both)).status).toBe(404);
  });
});

import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { localDate } from "@kinder/contracts";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  authed,
  createScenario,
  createUser,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";

/**
 * «Эрх сунгах» — the user, 2026-10-28: some kindergartens pay their contract
 * by bank transfer without opening «Үйлчилгээний эрх»; the operator records
 * it from the kindergarten, with a note and the date the service runs to, and
 * the platform's revenue counts it.
 */
let app: INestApplication;
const db = testDb();
const server = () => app.getHttpServer();

let a: Scenario;
let b: Scenario;

const DAY = 86_400_000;
const TODAY = localDate();
const iso = (date: Date) => date.toISOString().slice(0, 10);
const shift = (day: string, days: number) =>
  iso(new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY));

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

async function application(scenario: Scenario) {
  return db.kindergartenApplication.create({
    data: {
      kindergartenName: scenario.kindergarten.name,
      registrationNumber: String(1_000_000 + Math.floor(Math.random() * 9_000_000)),
      directorName: "Бат Сүх",
      phone: "99001122",
      email: `${uniq("kg")}@example.mn`,
      groupCount: 1,
      status: "APPROVED",
      kindergartenId: scenario.kindergarten.id,
    },
  });
}

/** A's contract in force, its paid period ending `days` from today. */
async function contractEnding(days: number, status: "ACTIVE" | "PENDING_SIGNATURE" = "ACTIVE") {
  return db.contract.create({
    data: {
      applicationId: (await application(a)).id,
      kindergartenId: a.kindergarten.id,
      number: `NK-2026-${uniq("n").slice(-6)}`,
      status,
      groupCount: 1,
      billingPeriod: "TERM",
      perGroupMonthlyFee: "4000.00",
      periodFee: "12000.00",
      startsOn: new Date(`${shift(TODAY, -120)}T00:00:00.000Z`),
      endsOn: new Date(`${shift(TODAY, days)}T00:00:00.000Z`),
    },
  });
}

const operator = async () =>
  login(app, (await createUser({ username: uniq("operator"), isSuperAdmin: true })).username);

const preview = (who: AuthSession, kindergartenId = a.kindergarten.id) =>
  authed(
    request(server()).get(
      `/v1/platform/contract-payments/extension?kindergartenId=${kindergartenId}`,
    ),
    who,
  );

const record = (who: AuthSession, body: Record<string, unknown>) =>
  authed(request(server()).post("/v1/platform/contract-payments/extension"), who).send({
    kindergartenId: a.kindergarten.id,
    period: "TERM",
    groupCount: 1,
    paidOn: TODAY,
    ...body,
  });

describe("«Эрх сунгах» — a transfer recorded from the kindergarten", () => {
  it("opens a lapsed kindergarten again, keeps the note, and counts as income", async () => {
    await contractEnding(-30);
    const teacherA = await login(app, a.teacherUser.username);
    expect(
      (await authed(request(server()).get(`/v1/children/${a.child.id}`), teacherA)).status,
    ).toBe(404);

    const op = await operator();
    const seen = await preview(op);
    expect(seen.status).toBe(200);
    expect(seen.body).toMatchObject({
      kindergarten: { id: a.kindergarten.id },
      contract: { endsOn: shift(TODAY, -30) },
      initialDue: null,
      groupCount: 1,
    });
    const term = seen.body.options.TERM;
    expect(term.coversTo > TODAY).toBe(true);

    const res = await record(op, {
      amount: term.amount,
      coversTo: term.coversTo,
      note: "Хаан банк, 10-р сарын хуулга",
      reference: "4-р цэцэрлэг гэрээ",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "PAID", coversTo: term.coversTo });

    // ★ The outcome, not the row: the teacher is back in.
    expect(
      (await authed(request(server()).get(`/v1/children/${a.child.id}`), teacherA)).status,
    ).toBe(200);

    const revenue = await authed(
      request(server()).get(`/v1/platform/revenue?month=${TODAY.slice(0, 7)}`),
      op,
    );
    expect(revenue.body.platform).toMatchObject({
      contractFees: term.amount,
      contractPayments: 1,
    });

    const list = await authed(request(server()).get("/v1/platform/contract-payments"), op);
    expect(list.body.items).toEqual([
      expect.objectContaining({
        id: res.body.id,
        status: "PAID",
        method: "BANK_TRANSFER",
        note: "Хаан банк, 10-р сарын хуулга",
        coversTo: term.coversTo,
      }),
    ]);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { objectType: "ContractPayment", objectId: res.body.id, action: "UPDATE" },
    });
    expect(audit.metadata).toMatchObject({
      after: { note: "Хаан банк, 10-р сарын хуулга", coversTo: term.coversTo },
    });
  });

  it("runs the service to the end the operator chose — forward, and within a year", async () => {
    const contract = await contractEnding(-30);
    const op = await operator();
    const term = (await preview(op)).body.options.TERM;
    const currentEnd = shift(TODAY, -30);

    const notForward = await record(op, { amount: term.amount, coversTo: currentEnd });
    const typo = await record(op, { amount: term.amount, coversTo: "2062-06-30" });
    expect(notForward.status).toBe(400);
    expect(typo.status).toBe(400);
    // Refused before anything was written — no PENDING row left behind.
    expect(await db.contractPayment.count({ where: { contractId: contract.id } })).toBe(0);

    const chosen = shift(term.coversTo, 45);
    const res = await record(op, { amount: "15000.00", coversTo: chosen });
    expect(res.status).toBe(201);
    const after = await db.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(iso(after.endsOn)).toBe(chosen);
    const paid = await db.contractPayment.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(paid.amount.toFixed(2)).toBe("15000.00");

    // Recorded twice, the second finds the service already running there.
    const twice = await record(op, { amount: term.amount, coversTo: chosen });
    expect(twice.status).toBe(400);
    expect(await db.contractPayment.count({ where: { contractId: contract.id } })).toBe(1);
  });

  it("is the operator's only — a director, a teacher and another kindergarten get 404", async () => {
    await contractEnding(30);
    const adminA = await login(app, a.adminUser.username);
    const teacherA = await login(app, a.teacherUser.username);
    const adminB = await login(app, b.adminUser.username);

    for (const who of [adminA, teacherA, adminB]) {
      expect((await preview(who)).status).toBe(404);
      expect((await record(who, { amount: "12000.00", coversTo: shift(TODAY, 90) })).status).toBe(
        404,
      );
    }
  });

  it("refuses a contract the director has not accepted, and activates nothing", async () => {
    const contract = await contractEnding(90, "PENDING_SIGNATURE");
    const op = await operator();

    expect((await preview(op)).body).toMatchObject({ contract: null, awaitingSignature: true });
    const res = await record(op, { amount: "12000.00", coversTo: shift(TODAY, 120) });
    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("хүлээн аваагүй");
    const still = await db.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(still.status).toBe("PENDING_SIGNATURE");
  });

  it("settles the first period still owed rather than stacking a renewal on it", async () => {
    const contract = await contractEnding(200);
    const owed = await db.contractPayment.create({
      data: {
        kindergartenId: a.kindergarten.id,
        contractId: contract.id,
        initial: true,
        period: "TERM",
        coversFrom: new Date(`${shift(TODAY, -10)}T00:00:00.000Z`),
        coversTo: new Date(`${shift(TODAY, 200)}T00:00:00.000Z`),
        groupCount: 1,
        perGroupAmount: "12000.00",
        amount: "12000.00",
      },
    });
    const op = await operator();

    const seen = await preview(op);
    expect(seen.body).toMatchObject({
      initialDue: { id: owed.id, amount: "12000.00" },
      options: null,
    });

    const res = await record(op, { amount: "12000.00", coversTo: shift(TODAY, 200) });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(owed.id);
    expect(await db.contractPayment.count({ where: { contractId: contract.id } })).toBe(1);
  });
});

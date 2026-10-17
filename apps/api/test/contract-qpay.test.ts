import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { QpayRepository } from "../src/integrations/qpay/qpay.repository";
import { ServiceAccessRepository } from "../src/service-access/service-access.repository";
import { quote } from "../src/service-access/service-access.service";
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
 * №6 — a kindergarten pays its platform contract through QPay (the user,
 * 2026-10-16, confirmed 2026-10-18: «QPay байх»). A bank transfer never
 * reached the system, so the revenue page and the partners' shares missed it.
 */

let app: INestApplication;
const db = testDb();
const server = () => app.getHttpServer();

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let adminB: AuthSession;

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
  adminA = await login(app, a.adminUser.username);
  adminB = await login(app, b.adminUser.username);
});

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function contract(scenario: Scenario, endsOn: string, fee = "4000.00") {
  const application = await db.kindergartenApplication.create({
    data: {
      kindergartenName: scenario.kindergarten.name,
      // Seven random digits — `uniq()` is base36, and its digits alone padded
      // to seven collided between two scenarios in one test.
      registrationNumber: String(1_000_000 + Math.floor(Math.random() * 9_000_000)),
      directorName: "Бат Сүх",
      phone: "99001122",
      email: `${uniq("kg")}@example.mn`,
      groupCount: 1,
      status: "APPROVED",
      kindergartenId: scenario.kindergarten.id,
    },
  });
  return db.contract.create({
    data: {
      applicationId: application.id,
      kindergartenId: scenario.kindergarten.id,
      number: `NK-2026-${uniq("n").slice(-6)}`,
      status: "ACTIVE",
      groupCount: 1,
      billingPeriod: "YEAR",
      perGroupMonthlyFee: fee,
      periodFee: "30000.00",
      startsOn: day("2026-09-01"),
      endsOn: day(endsOn),
    },
  });
}

describe("what renewing buys and costs", () => {
  const standard = (endsOn: string) => ({ perGroupMonthlyFee: "4000.00", endsOn: day(endsOn) });

  it("prices «I-р улирал» at 6,000₮ a group and the year at 30,000₮ — from the sheet", () => {
    // A contract that ended in August, renewed on 18 October.
    const term = quote(standard("2026-08-31"), 3, "TERM", "2026-10-18");
    const year = quote(standard("2026-08-31"), 3, "YEAR", "2026-10-18");

    expect(term).toMatchObject({
      coversFrom: "2026-09-01",
      coversTo: "2026-11-30",
      perGroup: "6000.00",
      amount: "18000.00",
    });
    expect(year).toMatchObject({
      coversFrom: "2026-09-01",
      coversTo: "2027-05-31",
      perGroup: "30000.00",
      amount: "90000.00",
    });
  });

  it("buys the period after the contract's end, at 12,000₮ a term once the promotion is past", () => {
    expect(quote(standard("2026-11-30"), 2, "TERM", "2026-11-20")).toMatchObject({
      coversFrom: "2026-12-01",
      coversTo: "2027-02-28",
      amount: "24000.00",
    });
    // From the end of May the next is September's term and school year.
    expect(quote(standard("2027-05-31"), 1, "TERM", "2027-05-20")).toMatchObject({
      coversFrom: "2027-09-01",
      coversTo: "2027-11-30",
      perGroup: "12000.00",
    });
    expect(quote(standard("2027-05-31"), 1, "YEAR", "2027-05-20")).toMatchObject({
      coversFrom: "2027-09-01",
      coversTo: "2028-05-31",
    });
  });

  it("keeps a negotiated monthly fee as agreed — fee × 3, fee × 9", () => {
    const negotiated = { perGroupMonthlyFee: "3500.00", endsOn: day("2026-08-31") };
    expect(quote(negotiated, 2, "TERM", "2026-10-18").amount).toBe("21000.00");
    expect(quote(negotiated, 2, "YEAR", "2026-10-18").amount).toBe("63000.00");
  });

  /*
   * ★ Review of #258: a contract paid through «I-р улирал» bought the whole
   * 2026–2027 year again, term 1 included, at 30,000₮ a group. A year from
   * inside a school year is what is left of it, priced as those terms.
   */
  it("never sells a paid term again — a year from inside one is the terms left", () => {
    expect(quote(standard("2026-11-30"), 2, "YEAR", "2026-11-20")).toMatchObject({
      coversFrom: "2026-12-01",
      coversTo: "2027-05-31",
      months: 6,
      perGroup: "24000.00",
      amount: "48000.00",
    });
    // After II улирал, only III is left — the term's price, not the year's.
    expect(quote(standard("2027-02-28"), 1, "YEAR", "2027-02-20")).toMatchObject({
      coversFrom: "2027-03-01",
      coversTo: "2027-05-31",
      perGroup: "12000.00",
    });
    // Lapsed and renewed in January: from the term that day falls in.
    expect(quote(standard("2026-08-31"), 1, "YEAR", "2027-01-10")).toMatchObject({
      coversFrom: "2026-12-01",
      perGroup: "24000.00",
    });
    const negotiated = { perGroupMonthlyFee: "3500.00", endsOn: day("2026-11-30") };
    expect(quote(negotiated, 1, "YEAR", "2026-11-20").perGroup).toBe("21000.00");
  });
});

describe("POST /service-access/qpay", () => {
  it("prices the next period on the server and keeps one row for it", async () => {
    await contract(a, "2026-08-31");

    const first = await authed(request(server()).post("/v1/service-access/qpay"), adminA).send({
      period: "year",
      // Anything the client says about money is not read.
      amount: "1.00",
    });
    // No merchant in tests: refused honestly, after the period was priced.
    expect(first.status).toBe(400);
    const again = await authed(request(server()).post("/v1/service-access/qpay"), adminA).send({
      period: "year",
    });
    expect(again.status).toBe(400);

    const rows = await db.contractPayment.findMany({
      where: { kindergartenId: a.kindergarten.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("PENDING");
    // Today's quote — a year bought after November is what is left of it.
    expect(rows[0]!.amount.toFixed(2)).toBe(
      quote({ perGroupMonthlyFee: "4000.00", endsOn: day("2026-08-31") }, rows[0]!.groupCount, "YEAR")
        .amount,
    );
  });

  it("answers two requests at once with one row, never a 500", async () => {
    await contract(a, "2026-08-31");
    const post = () =>
      authed(request(server()).post("/v1/service-access/qpay"), adminA).send({ period: "term" });

    const [one, two] = await Promise.all([post(), post()]);

    // No merchant in tests — both refused the same honest way.
    expect([one.status, two.status]).toEqual([400, 400]);
    expect(await db.contractPayment.count({ where: { kindergartenId: a.kindergarten.id } })).toBe(1);
  });

  // The HTTP pair above may run one after the other; this loses the race every time.
  it("hands the row back to the request that lost the race to create it", async () => {
    const signed = await contract(a, "2026-08-31");
    const repo = app.get(ServiceAccessRepository);
    const data = {
      kindergartenId: a.kindergarten.id,
      contractId: signed.id,
      period: "TERM" as const,
      termNumber: 1,
      coversFrom: day("2026-09-01"),
      coversTo: day("2026-11-30"),
      groupCount: 1,
      perGroupAmount: "6000.00",
      amount: "6000.00",
    };

    const first = await repo.createPayment(data);
    const second = await repo.createPayment(data);

    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, row: { id: first.row.id } });
  });

  it("re-prices an unpaid period with what it was before in the audit log", async () => {
    await contract(a, "2026-08-31");
    const post = () =>
      authed(request(server()).post("/v1/service-access/qpay"), adminA).send({ period: "term" });
    await post();
    const row = await db.contractPayment.findFirstOrThrow({
      where: { kindergartenId: a.kindergarten.id },
    });
    // As if the QR before had been drawn for another number of groups.
    await db.contractPayment.update({ where: { id: row.id }, data: { amount: "1.00" } });

    await post();

    const repriced = await db.contractPayment.findUniqueOrThrow({ where: { id: row.id } });
    expect(repriced.amount.toFixed(2)).toBe(row.amount.toFixed(2));
    const audit = await db.auditLog.findFirstOrThrow({
      where: { objectType: "ContractPayment", objectId: row.id, action: "UPDATE" },
    });
    expect(audit.metadata).toMatchObject({
      before: { amount: "1.00" },
      after: { amount: row.amount.toFixed(2) },
    });
  });

  it("is a director's only — another kindergarten's director gets 404 on the payment", async () => {
    await contract(a, "2026-08-31");
    await authed(request(server()).post("/v1/service-access/qpay"), adminA).send({
      period: "term",
    });
    const payment = await db.contractPayment.findFirstOrThrow({
      where: { kindergartenId: a.kindergarten.id },
    });

    const own = await authed(
      request(server()).get(`/v1/service-access/qpay/${payment.id}`),
      adminA,
    );
    const other = await authed(
      request(server()).get(`/v1/service-access/qpay/${payment.id}`),
      adminB,
    );
    const teacher = await authed(
      request(server()).post("/v1/service-access/qpay"),
      await login(app, a.teacherUser.username),
    ).send({ period: "term" });

    expect(own.status).toBe(200);
    expect(own.body.payment).toMatchObject({ status: "PENDING", period: "term" });
    expect(own.body.attempt).toBeNull();
    expect(other.status).toBe(404);
    expect([403, 404]).toContain(teacher.status);
  });
});

describe("a paid period", () => {
  async function pending(scenario: Scenario, coversTo: string) {
    const signed = await contract(scenario, "2026-08-31");
    return db.contractPayment.create({
      data: {
        kindergartenId: scenario.kindergarten.id,
        contractId: signed.id,
        period: "YEAR",
        coversFrom: day("2026-09-01"),
        coversTo: day(coversTo),
        groupCount: 2,
        perGroupAmount: "30000.00",
        amount: "60000.00",
      },
    });
  }

  it("runs the contract to what it covers, once, and never shortens it", async () => {
    const payment = await pending(a, "2027-05-31");
    const qpay = app.get(QpayRepository);

    expect(await qpay.markContractPaymentPaid(payment.id, new Date(), "60000.00")).toEqual({
      claimed: true,
      before: null,
      overlaps: false,
    });
    expect(await qpay.markContractPaymentPaid(payment.id, new Date(), "60000.00")).toEqual({
      claimed: false,
    });

    const signed = await db.contract.findUniqueOrThrow({ where: { id: payment.contractId } });
    expect(signed.endsOn.toISOString().slice(0, 10)).toBe("2027-05-31");
    const paid = await db.contractPayment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(paid.status).toBe("PAID");

    // A shorter period paid later leaves the end where it is.
    const shorter = await db.contractPayment.create({
      data: {
        kindergartenId: a.kindergarten.id,
        contractId: payment.contractId,
        period: "TERM",
        termNumber: 1,
        coversFrom: day("2026-09-02"),
        coversTo: day("2026-11-30"),
        groupCount: 2,
        perGroupAmount: "6000.00",
        amount: "12000.00",
      },
    });
    // ★ And it is flagged: the year already covers it, so money moved twice.
    expect(await qpay.markContractPaymentPaid(shorter.id, new Date(), "12000.00")).toMatchObject({
      claimed: true,
      overlaps: true,
    });
    const still = await db.contract.findUniqueOrThrow({ where: { id: payment.contractId } });
    expect(still.endsOn.toISOString().slice(0, 10)).toBe("2027-05-31");
  });

  /*
   * ★ Review of #258: a QR drawn for one group and paid after the period was
   * re-priced for two records what QPay took — the revenue and the partners'
   * shares count money that arrived, not the re-priced figure.
   */
  it("records what QPay charged, not the re-priced figure", async () => {
    const payment = await pending(a, "2027-05-31");
    const qpay = app.get(QpayRepository);

    expect(await qpay.markContractPaymentPaid(payment.id, new Date(), "30000.00")).toEqual({
      claimed: true,
      before: { amount: "60000.00", groupCount: 2 },
      overlaps: false,
    });

    const paid = await db.contractPayment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(paid.amount.toFixed(2)).toBe("30000.00");
    expect(paid.groupCount).toBe(1);
  });

  it("counts in the platform's income and in what the partners share", async () => {
    const payment = await pending(a, "2027-05-31");
    await db.contractPayment.update({
      where: { id: payment.id },
      data: { status: "PAID", paidAt: new Date(Date.UTC(2026, 9, 18)) },
    });
    // A QR nobody scanned is not income.
    await pending(b, "2027-05-31");

    const operator = await login(
      app,
      (await createUser({ username: uniq("operator"), isSuperAdmin: true })).username,
    );
    const revenue = await authed(
      request(server()).get("/v1/platform/revenue?month=2026-10"),
      operator,
    );
    const split = await authed(
      request(server()).get("/v1/platform/revenue/distribution?month=2026-10"),
      operator,
    );

    expect(revenue.status).toBe(200);
    expect(revenue.body.platform).toMatchObject({
      contractFees: "60000.00",
      contractPayments: 1,
      total: "60000.00",
    });
    expect(split.body).toMatchObject({ contractFees: "60000.00", total: "60000.00" });
  });
});

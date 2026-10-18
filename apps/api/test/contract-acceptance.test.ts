import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { ServiceAccessRepository } from "../src/service-access/service-access.repository";
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
 * A director accepts the contract online — the user, 2026-10-18
 * («онлайнаар гэрээ байгуулдаг») — and its first period, at the contract's
 * own `periodFee`, is paid by QPay or by a bank transfer the operator records
 * (state kindergartens pay against an invoice — the client, 2026-10-18).
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

const BANK = {
  SERVICE_INVOICE_BANK_NAME: "Хаан банк",
  SERVICE_INVOICE_BANK_ACCOUNT: "5000000000",
  SERVICE_INVOICE_ACCOUNT_HOLDER: "NomadKids ХХК",
} as const;

afterEach(() => {
  for (const key of Object.keys(BANK)) delete process.env[key];
});

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** 4-р цэцэрлэг's shape: 13 groups, a year, at the negotiated 270,000₮. */
async function issued(scenario: Scenario, { pdf = true, periodFee = "270000.00" } = {}) {
  const application = await db.kindergartenApplication.create({
    data: {
      kindergartenName: scenario.kindergarten.name,
      registrationNumber: String(1_000_000 + Math.floor(Math.random() * 9_000_000)),
      directorName: "Бат Сүх",
      phone: "99001122",
      email: `${uniq("kg")}@example.mn`,
      groupCount: 13,
      status: "APPROVED",
      kindergartenId: scenario.kindergarten.id,
    },
  });
  const file = pdf
    ? await db.mediaFile.create({
        data: {
          kindergartenId: scenario.kindergarten.id,
          purpose: "REPORT_OUTPUT",
          storageKey: `reports/${uniq("contract")}.pdf`,
          originalName: "geree.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
        },
      })
    : null;
  return db.contract.create({
    data: {
      applicationId: application.id,
      kindergartenId: scenario.kindergarten.id,
      number: `NK-2026-${uniq("n").slice(-6)}`,
      status: "PENDING_SIGNATURE",
      groupCount: 13,
      billingPeriod: "YEAR",
      perGroupMonthlyFee: "4000.00",
      periodFee,
      startsOn: day("2026-09-01"),
      endsOn: day("2027-05-31"),
      pdfMediaFileId: file?.id ?? null,
    },
  });
}

const accept = (session: AuthSession, contractId: string, version = 1) =>
  authed(request(server()).post(`/v1/service-access/contracts/${contractId}/accept`), session)
    .set("User-Agent", "vitest-browser")
    .send({ accepted: true, version });

const operator = async () =>
  login(app, (await createUser({ username: uniq("operator"), isSuperAdmin: true })).username);

describe("the contract waiting for the director", () => {
  it("is on «Үйлчилгээний эрх», with its figures, and lights the red «1»", async () => {
    const contract = await issued(a);

    const res = await authed(request(server()).get("/v1/service-access"), adminA);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      remind: true,
      expiresAt: null,
      due: null,
      contractToSign: {
        id: contract.id,
        number: contract.number,
        version: 1,
        groupCount: 13,
        period: "year",
        periodFee: "270000.00",
        startsOn: "2026-09-01",
        endsOn: "2027-05-31",
        pdfReady: true,
      },
    });
  });

  it("serves its PDF to its own director only — another kindergarten's gets 404", async () => {
    const contract = await issued(a);
    const path = `/v1/service-access/contracts/${contract.id}/download`;

    const own = await authed(request(server()).get(path), adminA);
    const other = await authed(request(server()).get(path), adminB);
    const teacher = await authed(
      request(server()).get(path),
      await login(app, a.teacherUser.username),
    );
    const parent = await authed(
      request(server()).get(path),
      await login(app, a.parentUser.username),
    );

    expect(own.status).toBe(200);
    expect(own.body.url).toEqual(expect.any(String));
    expect(other.status).toBe(404);
    expect([403, 404]).toContain(teacher.status);
    expect([403, 404]).toContain(parent.status);
  });
});

describe("POST /service-access/contracts/:id/accept", () => {
  it("makes the contract ACTIVE, records who accepted which document, and owes its own fee", async () => {
    const contract = await issued(a);

    const res = await accept(adminA, contract.id);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      contract: { id: contract.id, status: "ACTIVE" },
      due: { amount: "270000.00", coversFrom: "2026-09-01", coversTo: "2027-05-31" },
    });

    const active = await db.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(active.status).toBe("ACTIVE");
    expect(active.activatedAt).not.toBeNull();
    // ★ Unpaid, the contract's end is where the document put it — never moved.
    expect(active.endsOn.toISOString().slice(0, 10)).toBe("2027-05-31");

    const acceptance = await db.contractAcceptance.findFirstOrThrow({
      where: { contractId: contract.id },
    });
    expect(acceptance).toMatchObject({
      kindergartenId: a.kindergarten.id,
      userId: a.adminUser.id,
      contractVersion: 1,
      contractNumber: contract.number,
      pdfMediaFileId: contract.pdfMediaFileId,
      userAgent: "vitest-browser",
    });
    expect(acceptance.terms).toMatchObject({ periodFee: "270000.00", groupCount: 13 });

    const payment = await db.contractPayment.findFirstOrThrow({
      where: { contractId: contract.id },
    });
    expect(payment).toMatchObject({ initial: true, status: "PENDING", groupCount: 13 });
    expect(payment.amount.toFixed(2)).toBe("270000.00");
  });

  it("is refused twice, at a stale version, and before the PDF exists", async () => {
    const contract = await issued(a);
    const stale = await accept(adminA, contract.id, 2);
    expect(stale.status).toBe(409);

    expect((await accept(adminA, contract.id)).status).toBe(201);
    expect((await accept(adminA, contract.id)).status).toBe(409);
    expect(await db.contractAcceptance.count({ where: { contractId: contract.id } })).toBe(1);

    const noPdf = await issued(b, { pdf: false });
    const early = await accept(adminB, noPdf.id);
    expect(early.status).toBe(400);
    expect((await db.contract.findUniqueOrThrow({ where: { id: noPdf.id } })).status).toBe(
      "PENDING_SIGNATURE",
    );
  });

  it("is the director's only — another kindergarten's director gets 404, staff and families are refused", async () => {
    const contract = await issued(a);

    const other = await accept(adminB, contract.id);
    const teacher = await accept(await login(app, a.teacherUser.username), contract.id);
    const parent = await accept(await login(app, a.parentUser.username), contract.id);

    expect(other.status).toBe(404);
    expect([403, 404]).toContain(teacher.status);
    expect([403, 404]).toContain(parent.status);
    expect((await db.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe(
      "PENDING_SIGNATURE",
    );
  });

  it("asks for `accepted: true` said out loud", async () => {
    const contract = await issued(a);
    const res = await authed(
      request(server()).post(`/v1/service-access/contracts/${contract.id}/accept`),
      adminA,
    ).send({ version: 1 });
    expect(res.status).toBe(400);
  });
});

describe("the first period, owed", () => {
  async function accepted(scenario: Scenario, session: AuthSession) {
    const contract = await issued(scenario);
    await accept(session, contract.id);
    const payment = await db.contractPayment.findFirstOrThrow({
      where: { contractId: contract.id, initial: true },
    });
    return { contract, payment };
  }

  it("is what the status says — never «… хүртэл» while unpaid", async () => {
    const { contract, payment } = await accepted(a, adminA);

    const res = await authed(request(server()).get("/v1/service-access"), adminA);

    expect(res.body).toMatchObject({
      expiresAt: null,
      remind: true,
      contractToSign: null,
      due: {
        id: payment.id,
        contractNumber: contract.number,
        amount: "270000.00",
        label: `Гэрээ №${contract.number} (2026.09.01 – 2027.05.31)`,
      },
    });
  });

  it("is paid before any renewal — QPay and the invoice both refuse to renew", async () => {
    await accepted(a, adminA);
    Object.assign(process.env, BANK);

    const qpay = await authed(request(server()).post("/v1/service-access/qpay"), adminA).send({
      period: "term",
    });
    const invoice = await authed(
      request(server()).post("/v1/service-access/invoices"),
      adminA,
    ).send({ period: "term" });

    for (const res of [qpay, invoice]) {
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain("Эхлээд гэрээний төлбөрөө төлнө үү");
    }
  });

  it("is paid by QPay at the accepted figure — after the director check", async () => {
    const { payment } = await accepted(a, adminA);
    const path = `/v1/service-access/qpay/${payment.id}`;

    const own = await authed(request(server()).post(path), adminA).send({});
    const other = await authed(request(server()).post(path), adminB).send({});

    // No merchant in tests: refused honestly, after authorization.
    expect(own.status).toBe(400);
    expect(JSON.stringify(own.body)).toContain("QPay");
    expect(other.status).toBe(404);
  });

  it("has an invoice for a transfer, naming the contract and the period", async () => {
    const { contract, payment } = await accepted(a, adminA);
    Object.assign(process.env, BANK);
    const path = `/v1/service-access/payments/${payment.id}/invoice`;

    const own = await authed(request(server()).post(path), adminA).send({});
    const other = await authed(request(server()).post(path), adminB).send({});

    expect(own.status).toBe(201);
    expect(own.body).toMatchObject({ amount: "270000.00" });
    expect(other.status).toBe(404);
    const job = await db.reportJob.findUniqueOrThrow({ where: { id: own.body.id } });
    expect(job.params).toMatchObject({
      serviceInvoice: {
        amount: "270000.00",
        contractNumber: contract.number,
        contractPaymentId: payment.id,
        // 270,000₮ over 13 groups does not divide: the column says «—».
        perGroupAmount: null,
        periodLabel: `Гэрээ №${contract.number} (2026.09.01 – 2027.05.31)`,
      },
    });
  });

  it("keeps a renewal row apart from the first period, even on the same day", async () => {
    const { contract, payment } = await accepted(a, adminA);
    const repo = app.get(ServiceAccessRepository);

    const renewal = await repo.createPayment({
      kindergartenId: a.kindergarten.id,
      contractId: contract.id,
      period: "YEAR",
      coversFrom: payment.coversFrom,
      coversTo: payment.coversTo,
      groupCount: 13,
      perGroupAmount: "30000.00",
      amount: "390000.00",
    });

    expect(renewal.created).toBe(true);
    expect(renewal.row.id).not.toBe(payment.id);
    // And the first period is never re-priced through the renewal path.
    expect(
      (await repo.repricePending(payment.id, { groupCount: 1, perGroupAmount: "1", amount: "1" }))
        .count,
    ).toBe(0);
  });
});

describe("the operator records a bank transfer", () => {
  async function owed() {
    const contract = await issued(a);
    await accept(adminA, contract.id);
    return db.contractPayment.findFirstOrThrow({
      where: { contractId: contract.id, initial: true },
    });
  }

  it("lists what is owed to the operator only", async () => {
    const payment = await owed();
    const op = await operator();

    const list = await authed(
      request(server()).get("/v1/platform/contract-payments?status=PENDING"),
      op,
    );
    const director = await authed(request(server()).get("/v1/platform/contract-payments"), adminA);

    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([
      expect.objectContaining({
        id: payment.id,
        initial: true,
        amount: "270000.00",
        status: "PENDING",
        kindergarten: { id: a.kindergarten.id, name: a.kindergarten.name },
      }),
    ]);
    expect(director.status).toBe(404);
  });

  it("settles the period once, counts it as income, and keeps the ebarimt number", async () => {
    const payment = await owed();
    const op = await operator();
    const path = `/v1/platform/contract-payments/${payment.id}/record`;

    const director = await authed(request(server()).post(path), adminA).send({
      amount: "270000.00",
      paidOn: "2026-10-18",
    });
    expect(director.status).toBe(404);

    const recorded = await authed(request(server()).post(path), op).send({
      amount: "270000.00",
      paidOn: "2026-10-18",
      reference: "NK-2026 4-р цэцэрлэг",
    });
    expect(recorded.status).toBe(201);
    const twice = await authed(request(server()).post(path), op).send({
      amount: "270000.00",
      paidOn: "2026-10-18",
    });
    expect(twice.status).toBe(409);

    const paid = await db.contractPayment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(paid).toMatchObject({
      status: "PAID",
      method: "BANK_TRANSFER",
      reference: "NK-2026 4-р цэцэрлэг",
    });
    expect(paid.paidAt?.toISOString().slice(0, 10)).toBe("2026-10-18");

    const status = await authed(request(server()).get("/v1/service-access"), adminA);
    expect(status.body).toMatchObject({ due: null, expiresAt: "2027-05-31" });

    const revenue = await authed(request(server()).get("/v1/platform/revenue?month=2026-10"), op);
    expect(revenue.body.platform).toMatchObject({
      contractFees: "270000.00",
      contractPayments: 1,
    });

    const missing = await authed(
      request(server()).get("/v1/platform/contract-payments?ebarimt=missing"),
      op,
    );
    expect(missing.body.items.map((row: { id: string }) => row.id)).toEqual([payment.id]);

    const ebarimt = await authed(
      request(server()).patch(`/v1/platform/contract-payments/${payment.id}/ebarimt`),
      op,
    ).send({ ebarimtNumber: "EB-000123" });
    expect(ebarimt.status).toBe(200);
    expect(
      (await db.contractPayment.findUniqueOrThrow({ where: { id: payment.id } })).ebarimtNumber,
    ).toBe("EB-000123");
    const audit = await db.auditLog.findFirstOrThrow({
      where: { objectType: "ContractPayment", objectId: payment.id, action: "UPDATE" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.metadata).toMatchObject({
      before: { ebarimtNumber: null },
      after: { ebarimtNumber: "EB-000123" },
    });
  });

  it("refuses a day in the future, and an ebarimt number on an unpaid period", async () => {
    const payment = await owed();
    const op = await operator();

    const future = await authed(
      request(server()).post(`/v1/platform/contract-payments/${payment.id}/record`),
      op,
    ).send({ amount: "270000.00", paidOn: "2099-01-01" });
    const early = await authed(
      request(server()).patch(`/v1/platform/contract-payments/${payment.id}/ebarimt`),
      op,
    ).send({ ebarimtNumber: "EB-1" });

    expect(future.status).toBe(400);
    expect(early.status).toBe(400);
  });
});

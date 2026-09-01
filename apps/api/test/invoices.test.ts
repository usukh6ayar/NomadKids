import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  authed,
  createMembership,
  createScenario,
  createUser,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * Invoices and payments — нэмэлт.md §7, §8 — and the financial-audit-log
 * gap found while auditing the Нягтлан role (§13).
 *
 * ★ Same authorization shape as `staff-roles.test.ts`'s funding tests:
 * `assertCanReadFinance` reads the membership against the kindergarten in the
 * URL, so `@Roles("ADMIN","ACCOUNTANT")` alone is not what these tests prove.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let accountant: AuthSession;
let accountantB: AuthSession;
let teacher: AuthSession;
let parent: AuthSession;

const server = () => app.getHttpServer();

beforeAll(async () => {
  app = await createTestApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  const accUser = await createUser({ username: uniq("acct") });
  await createMembership(accUser.id, a.kindergarten.id, "ACCOUNTANT");
  accountant = await login(app, accUser.username);

  const accBUser = await createUser({ username: uniq("acct-b") });
  await createMembership(accBUser.id, b.kindergarten.id, "ACCOUNTANT");
  accountantB = await login(app, accBUser.username);

  teacher = await login(app, a.teacherUser.username);
  parent = await login(app, a.parentUser.username);
});

function generateBody(childId: string, month = "2026-08") {
  return {
    childId,
    month,
    dueDate: "2026-09-05",
    lineItems: [
      { type: "TUITION", amount: "150000" },
      { type: "MEAL", amount: "40000" },
      { type: "CLUB", amount: "10000", description: "Хөгжим" },
    ],
    discountAmount: "5000",
  };
}

async function generate(session: AuthSession, kindergartenId: string, body: ReturnType<typeof generateBody>) {
  return authed(request(server()).post(`/v1/kindergartens/${kindergartenId}/invoices`), session).send(
    body,
  );
}

describe("who may reach an invoice", () => {
  it("refuses a teacher — §13's exclusion, not just a role gate", async () => {
    const res = await generate(teacher, a.kindergarten.id, generateBody(a.child.id));
    expect(res.status).toBe(404);
  });

  it("refuses a guardian", async () => {
    const res = await generate(parent, a.kindergarten.id, generateBody(a.child.id));
    expect(res.status).toBe(404);
  });

  it("refuses an accountant employed by a different kindergarten", async () => {
    const res = await generate(accountantB, a.kindergarten.id, generateBody(a.child.id));
    expect(res.status).toBe(404);
  });

  it("refuses a teacher reading the list", async () => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/invoices`),
      teacher,
    );
    expect(res.status).toBe(404);
  });
});

describe("a child's own invoices — the guardian-facing read (нэмэлт.md §10)", () => {
  it("shows a guardian their own child's invoices", async () => {
    await generate(accountant, a.kindergarten.id, generateBody(a.child.id));

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/invoices`),
      parent,
    );

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].child.id).toBe(a.child.id);
    // Full shape, not the summary the kindergarten-wide list returns — a
    // guardian's own bill comes with its payment history inline.
    expect(res.body.items[0].lineItems).toHaveLength(3);
  });

  /**
   * ★ The test the whole child-scoped route exists to pass.
   *
   * `teacher` is assigned to `a.group`, which `a.child` is enrolled in, so
   * `canAccessChild` admits them for every other route this child has. This
   * one must refuse anyway — `canViewChildFinance` deliberately omits
   * `isAssignedTeacherOf`, and this is the test that would fail first if a
   * future edit "fixed" that back in.
   */
  it("refuses a teacher — §13's exclusion holds even for a child they can otherwise reach", async () => {
    await generate(accountant, a.kindergarten.id, generateBody(a.child.id));

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/invoices`),
      teacher,
    );
    expect(res.status).toBe(404);
  });

  it("refuses another family's guardian", async () => {
    await generate(accountant, a.kindergarten.id, generateBody(a.child.id));

    const otherParent = await login(app, b.parentUser.username);
    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/invoices`),
      otherParent,
    );
    expect(res.status).toBe(404);
  });

  it("still lets the accountant and the admin read it through this route too", async () => {
    await generate(accountant, a.kindergarten.id, generateBody(a.child.id));

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/invoices`),
      accountant,
    );
    expect(res.status).toBe(200);
  });
});

describe("generating a month's invoice", () => {
  it("freezes the four summary columns from the line items supplied", async () => {
    const res = await generate(accountant, a.kindergarten.id, generateBody(a.child.id));

    expect(res.status).toBe(201);
    // ★ Numeric equality, not exact string matching — this codebase's own
    // `fed-days.test.ts` already asserts `calculatedAmount` unpadded
    // ("2000", not "2000.00"), a Prisma 7 Decimal-from-a-row-read quirk with
    // no bearing on correctness. The value is the invariant; the padding
    // isn't.
    expect(Number(res.body.baseAmount)).toBe(150000);
    expect(Number(res.body.mealAmount)).toBe(40000);
    expect(Number(res.body.extraAmount)).toBe(10000);
    expect(Number(res.body.discountAmount)).toBe(5000);
    // 150000 + 40000 + 10000 + 0 (no previous balance) − 5000
    expect(Number(res.body.totalDue)).toBe(195000);
    expect(Number(res.body.balance)).toBe(195000);
    expect(res.body.status).toBe("UNPAID");
    expect(res.body.lineItems).toHaveLength(3);
  });

  it("carries the previous month's balance forward, not re-entered", async () => {
    await generate(accountant, a.kindergarten.id, generateBody(a.child.id, "2026-07"));
    const second = await generate(accountant, a.kindergarten.id, generateBody(a.child.id, "2026-08"));

    // July's invoice was never paid, so its whole balance (195000) is
    // August's previousBalance — the single-entry principle, нэмэлт.md §17.
    expect(Number(second.body.previousBalance)).toBe(195000);
    expect(Number(second.body.totalDue)).toBe(390000);
  });

  it("regenerates a never-paid invoice in place rather than duplicating it", async () => {
    const first = await generate(accountant, a.kindergarten.id, generateBody(a.child.id));
    const second = await generate(accountant, a.kindergarten.id, {
      ...generateBody(a.child.id),
      lineItems: [{ type: "TUITION", amount: "160000" }],
      discountAmount: "0",
    });

    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(Number(second.body.baseAmount)).toBe(160000);
    expect(second.body.lineItems).toHaveLength(1);
  });
});

describe("recording and voiding a manual payment", () => {
  async function invoiceId() {
    const res = await generate(accountant, a.kindergarten.id, generateBody(a.child.id));
    return res.body.id as string;
  }

  it("updates balance and status when fully paid", async () => {
    const id = await invoiceId();

    const paid = await authed(request(server()).post(`/v1/invoices/${id}/payments`), accountant).send({
      amount: "195000",
      method: "CASH",
    });

    expect(paid.status).toBe(201);
    expect(Number(paid.body.paidAmount)).toBe(195000);
    expect(Number(paid.body.balance)).toBe(0);
    expect(paid.body.status).toBe("PAID");
  });

  it("marks partial payment correctly", async () => {
    const id = await invoiceId();

    const paid = await authed(request(server()).post(`/v1/invoices/${id}/payments`), accountant).send({
      amount: "100000",
      method: "BANK_TRANSFER",
    });

    expect(paid.body.status).toBe("PARTIALLY_PAID");
    expect(Number(paid.body.balance)).toBe(95000);
  });

  it("refuses QPAY/SOCIALPAY through the manual-recording route", async () => {
    const id = await invoiceId();
    const res = await authed(request(server()).post(`/v1/invoices/${id}/payments`), accountant).send({
      amount: "1000",
      method: "QPAY",
    });
    expect(res.status).toBe(400);
  });

  it("refuses regenerating an invoice once it has been paid", async () => {
    const id = await invoiceId();
    await authed(request(server()).post(`/v1/invoices/${id}/payments`), accountant).send({
      amount: "50000",
      method: "CASH",
    });

    const res = await generate(accountant, a.kindergarten.id, generateBody(a.child.id));
    expect(res.status).toBe(400);
  });

  it("voids a payment via a reversal row — the original stays, it does not disappear", async () => {
    const id = await invoiceId();
    const paid = await authed(request(server()).post(`/v1/invoices/${id}/payments`), accountant).send({
      amount: "195000",
      method: "CASH",
    });
    expect(paid.body.status).toBe("PAID");

    const paymentId = (await db.payment.findFirstOrThrow({ where: { invoiceId: id } })).id;

    const voided = await authed(request(server()).patch(`/v1/payments/${paymentId}/void`), accountant).send(
      { note: "Буруу бүртгэсэн" },
    );

    expect(voided.status).toBe(200);
    expect(Number(voided.body.paidAmount)).toBe(0);
    expect(Number(voided.body.balance)).toBe(195000);
    expect(voided.body.status).toBe("UNPAID");

    const rows = await db.payment.findMany({ where: { invoiceId: id } });
    expect(rows).toHaveLength(2);
    const original = rows.find((r) => r.id === paymentId)!;
    const reversal = rows.find((r) => r.id !== paymentId)!;
    expect(original.voidedAt).not.toBeNull();
    expect(Number(original.amount)).toBe(195000);
    expect(reversal.reversalOfId).toBe(paymentId);
    expect(Number(reversal.amount)).toBe(-195000);
  });

  it("refuses voiding the same payment twice", async () => {
    const id = await invoiceId();
    await authed(request(server()).post(`/v1/invoices/${id}/payments`), accountant).send({
      amount: "50000",
      method: "CASH",
    });
    const paymentId = (await db.payment.findFirstOrThrow({ where: { invoiceId: id } })).id;

    await authed(request(server()).patch(`/v1/payments/${paymentId}/void`), accountant).send({});
    const second = await authed(request(server()).patch(`/v1/payments/${paymentId}/void`), accountant).send(
      {},
    );

    expect(second.status).toBe(404);
  });

  it("refuses a guardian recording a payment", async () => {
    const id = await invoiceId();
    const res = await authed(request(server()).post(`/v1/invoices/${id}/payments`), parent).send({
      amount: "1000",
      method: "CASH",
    });
    expect(res.status).toBe(404);
  });
});

describe("the financial audit log — нэмэлт.md §13", () => {
  it("records before/after values for a funding rule change, and the accountant can read it", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/funding/rules`),
      accountant,
    ).send({
      name: "Энгийн тариф",
      source: "STATE",
      effectiveFrom: "2026-01-01",
      dailyRate: "5000",
      dependsOnAttendance: true,
      dependsOnMeals: false,
    });
    expect(created.status).toBe(201);

    await authed(
      request(server()).patch(`/v1/funding-rules/${created.body.id}`),
      accountant,
    ).send({ name: "Шинэчилсэн тариф" });

    const log = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/financial-audit-log`),
      accountant,
    );

    expect(log.status).toBe(200);
    const updateEntry = log.body.items.find(
      (e: { action: string; objectType: string }) => e.action === "UPDATE" && e.objectType === "FundingRule",
    );
    expect(updateEntry).toBeTruthy();
    expect(updateEntry.metadata.before.name).toBe("Энгийн тариф");
    expect(updateEntry.metadata.after.name).toBe("Шинэчилсэн тариф");
  });

  it("also carries invoice and payment entries, not just funding ones", async () => {
    const invoice = await generate(accountant, a.kindergarten.id, generateBody(a.child.id));
    await authed(request(server()).post(`/v1/invoices/${invoice.body.id}/payments`), accountant).send({
      amount: "1000",
      method: "CASH",
    });

    const log = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/financial-audit-log`),
      accountant,
    );

    const types = log.body.items.map((e: { objectType: string }) => e.objectType);
    expect(types).toContain("Invoice");
    expect(types).toContain("Payment");
  });

  it("refuses a teacher — the bug this module started from", async () => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/financial-audit-log`),
      teacher,
    );
    expect(res.status).toBe(404);
  });

  it("refuses an accountant employed by a different kindergarten", async () => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/financial-audit-log`),
      accountantB,
    );
    expect(res.status).toBe(404);
  });
});

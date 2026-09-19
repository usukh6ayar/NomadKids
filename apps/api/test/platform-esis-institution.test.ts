import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import type { EsisService } from "../src/integrations/esis/esis.service";
import { createTestApp } from "./support/app";
import { resetData, uniq } from "./support/db";
import {
  authed,
  createMembership,
  createScenario,
  createUser,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";

/**
 * `GET /platform/esis/institutions/:institutionId` — the ministry's answer
 * about one institution, asked before any kindergarten exists to scope it to.
 *
 * ★ Every authorization case goes through HTTP against the real route
 * (CLAUDE.md §4.1). `@SuperAdmin()` is the decision, but only a request proves
 * the controller carries the decorator — and this route has no `:id`, so the
 * usual tenant checks cannot stand in for it.
 */

const institutionId = "42778";

/** Institution 42778, the one the ministry granted — measured 2026-09-14. */
const organizationRow = {
  institutionId,
  institutionName: "Дэгдээхий үрс цэцэрлэг",
  longName: "Баянзүрх дүүргийн Дэгдээхий үрс цэцэрлэг",
  institutionAddress: "Улаанбаатар, Баянзүрх дүүрэг",
  institutionClassificationName: "Цэцэрлэг",
  propertyTypeName: "Төрийн өмчит",
};

/*
 * ★ The register number is **lower case on purpose** — `school/staff` sends it
 * that way (measured 2026-09-16) and `normalizeRegisterNumber` upper-cases it.
 * It also has to be present at all: `projectStaff` drops a row without one, so
 * a fixture missing it would make the credential assertion below pass
 * vacuously, against a payload with no staff row in it.
 */
const staffRow = {
  personId: "90000000000001",
  personRegNumber: "ул24270406",
  lastName: "Овог",
  firstName: "Нэр",
  jobCode: "2342-13",
  positionName: "Багш, цэцэрлэгийн /мэргэжлийн/ /СӨБ/",
  microsoftEmailPass: "hunter2",
  googleEmailPass: "hunter2",
};

const read = vi.fn(async (key: string) => ({
  data: key === "staff" ? [staffRow] : [organizationRow],
  status: 200,
  durationMs: 9,
}));
const esis = { isConfigured: true, read } as unknown as Partial<EsisService>;

let app: INestApplication;
let a: Scenario;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;
let accountantA: AuthSession;
let superAdmin: AuthSession;

const server = () => app.getHttpServer();
const url = (id: string) => `/v1/platform/esis/institutions/${id}`;

beforeAll(async () => {
  app = await createTestApp({ esis });
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();
  read.mockClear();
  read.mockImplementation(async (key: string) => ({
    data: key === "staff" ? [staffRow] : [organizationRow],
    status: 200,
    durationMs: 9,
  }));

  a = await createScenario("esis-inst");
  const operator = await createUser({ username: uniq("esis-operator"), isSuperAdmin: true });
  // `createScenario` makes an admin, a teacher and a parent; the accountant is
  // this file's own, because the role reaches finance screens and none of them.
  const accountant = await createUser({ username: uniq("esis-accountant") });
  await createMembership(accountant.id, a.kindergarten.id, "ACCOUNTANT");

  [adminA, teacherA, parentA, accountantA, superAdmin] = await Promise.all([
    login(app, a.adminUser.username),
    login(app, a.teacherUser.username),
    login(app, a.parentUser.username),
    login(app, accountant.username),
    login(app, operator.username),
  ]);
});

describe("GET /platform/esis/institutions/:institutionId", () => {
  it("answers the platform operator with the ministry's institution", async () => {
    const res = await authed(request(server()).get(url(institutionId)), superAdmin);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      institutionId,
      name: "Дэгдээхий үрс цэцэрлэг",
      classification: "Цэцэрлэг",
      isKindergarten: true,
      alreadyUsed: false,
    });
  });

  /*
   * ★ 404 for everyone else, not 403 — CLAUDE.md §1.7. A director who typed an
   * id must not learn whether the deployment's token reaches it; the status is
   * the same whether the institution exists, is granted, or is neither.
   */
  it.each([
    ["kindergarten admin", () => adminA],
    ["teacher", () => teacherA],
    ["guardian", () => parentA],
    ["accountant", () => accountantA],
  ])("refuses a %s with 404, and never calls ESIS", async (_label, session) => {
    const res = await authed(request(server()).get(url(institutionId)), session());

    expect(res.status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const res = await request(server()).get(url(institutionId));

    expect(res.status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });

  /*
   * ★ `school/staff` carries `microsoftEmailPass` and `googleEmailPass` — real
   * provider passwords. The service projects a whitelist of seven fields; this
   * is the assertion that the whitelist is what ships, and it is written
   * against the whole serialised body rather than one key, because a password
   * arriving under a name nobody predicted is the case a key-by-key check
   * misses.
   */
  it("never returns a staff credential", async () => {
    const res = await authed(request(server()).get(url(institutionId)), superAdmin);

    expect(res.status).toBe(200);
    // Positively: there *is* a staff row, so the assertions below are not vacuous.
    expect(res.body.staff).toHaveLength(1);
    expect(res.body.staff[0]).toMatchObject({
      personId: "90000000000001",
      registerNumber: "УЛ24270406",
      firstName: "Нэр",
    });

    const body = JSON.stringify(res.body);
    expect(body).not.toContain("hunter2");
    expect(body).not.toContain("EmailPass");
  });
});

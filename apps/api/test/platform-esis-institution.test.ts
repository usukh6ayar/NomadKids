import { NotFoundException, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../src/authz/actor";
import { AuthzRepository } from "../src/authz/authz.repository";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { EsisError } from "../src/integrations/esis/esis.client";
import { EsisInstitutionLookupService } from "../src/integrations/esis/esis-institution-lookup.service";
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

  /*
   * ★ **The service refuses on its own, with the guard out of the picture.**
   *
   * Every case above goes through HTTP, which is §4.1's rule and is what proves
   * the controller carries `@SuperAdmin()`. This one deliberately does the
   * opposite: it takes the wired service out of the running application and
   * calls it directly, the way a caller with no controller of its own does —
   * `PlatformService.create` already is one. A decorator is a filter in front
   * of the decision, never the decision (CLAUDE.md §1.1), and until the service
   * asserted for itself this route's second caller would have walked straight
   * past it.
   *
   * `read` un-called is the ordering half: it distinguishes an assert that runs
   * first from one that runs after the ministry has already been asked.
   */
  it("refuses a non-operator when called as a service, past the guard", async () => {
    const service = app.get(EsisInstitutionLookupService);
    // The kindergarten admin's real memberships, as `resolveActor` would build
    // them — only `isSuperAdmin` is what this route turns on.
    const actor: Actor = {
      userId: a.adminUser.id,
      sessionId: "test-session",
      isSuperAdmin: false,
      memberships: await app.get(AuthzRepository).loadMemberships(a.adminUser.id),
    };

    expect(actor.memberships.length).toBeGreaterThan(0);
    await expect(service.lookup(actor, institutionId)).rejects.toBeInstanceOf(NotFoundException);
    expect(read).not.toHaveBeenCalled();
  });
});

/**
 * What the operator sees when the ministry does not answer with an institution.
 *
 * ★ Three outcomes, three statuses, and the split is the point: "the ministry
 * has not granted us this institution", "no such institution" and "ESIS did not
 * answer" are three different next actions for the person at the screen, and a
 * single 500 would make all three read as a bug in this product.
 *
 * ★★ Every one of these is thrown from the **live** failure the service sees,
 * so the mock rejects from `read` rather than from a seam invented for the
 * test — the translate method is only worth anything if it sits on the path a
 * real call takes.
 */
describe("the three ways an institution lookup does not answer", () => {
  /*
   * ★ `mockImplementation` keyed on the resource, not `mockRejectedValueOnce`.
   * The service fires `organization` and `staff` inside one `Promise.all`, so
   * `Once` binds to whichever happens to be called first — array order today,
   * and silently the wrong call the day somebody reorders them.
   */
  const failWith = (error: Error) =>
    read.mockImplementation(async (key: string) => {
      if (key === "organization") throw error;
      return { data: [staffRow], status: 200, durationMs: 9 };
    });

  /*
   * ★ **409, not the ministry's own 403.** Measured on 2026-09-14 against ids
   * 40284 and 42779: an institution this company account has not been granted
   * answers 403 «Таны компанид энэ institutionId дээр эрх байхгүй байна.»
   *
   * That refusal is a fact about the *ministry's grant*, not about this
   * caller — they are a superadmin and already passed the guard. Passing the
   * 403 through would give the one status this product reserves (§1.7: 404,
   * never 403) a second meaning.
   */
  it("turns a ministry refusal into 409 SCOPE_DENIED", async () => {
    failWith(
      new EsisError("http", "ESIS responded 403", { status: 403, path: "/organization/list" }),
    );

    const res = await authed(request(server()).get(url("40284")), superAdmin);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SCOPE_DENIED");
    expect(res.body.detail).toBe(
      "Яам энэ институцид эрх олгоогүй байна. Гэрээний дараа яамнаас нэмүүлнэ үү.",
    );
  });

  /*
   * ★ An institution that does not exist answers **200 with an empty
   * `RESULT`** — not a 404, which is why the service has to read the row count
   * rather than the status. This is the case already built; it is tested here
   * because nothing had ever asked for it over HTTP.
   */
  it("answers 404 for an institution ESIS returns no row for", async () => {
    read.mockImplementation(async () => ({ data: [], status: 200, durationMs: 9 }));

    const res = await authed(request(server()).get(url("99999")), superAdmin);

    expect(res.status).toBe(404);
  });

  /*
   * ★ 502, because the failure is upstream and the operator's own request was
   * fine. `kind` reaches the body as the code so that "it timed out" and "we
   * could not reach it at all" stay distinguishable in a log, while the
   * message the operator reads is one sentence either way.
   */
  it.each([
    ["timeout", "TIMEOUT"],
    ["network", "NETWORK"],
  ])("turns an ESIS %s into 502 %s", async (kind, code) => {
    failWith(new EsisError(kind as "timeout" | "network", `ESIS ${kind}`, { path: "/o/list" }));

    const res = await authed(request(server()).get(url(institutionId)), superAdmin);

    expect(res.status).toBe(502);
    expect(res.body.code).toBe(code);
    expect(res.body.detail).toBe("ESIS хариу өгсөнгүй.");
    /*
     * ★ And not "Алдаа гарлаа", which is the 500's title. A 502 says the
     * request was fine and the other system did not answer; reading
     * identically to "something broke here" would send the operator looking
     * for a bug in this product.
     */
    expect(res.body.title).toBe("Гадаад системээс хариу ирсэнгүй");
  });

  /*
   * ★★ A kind nobody designed for stays a 500. `invalid_response`, a 401 on
   * the deployment's own token — these are not the operator's problem and
   * there is no sentence that would help them; inventing a status for them
   * would say this product understands a case it does not.
   */
  it("leaves an undesigned ESIS failure as a 500", async () => {
    failWith(new EsisError("invalid_response", "unreadable body", { status: 200 }));

    const res = await authed(request(server()).get(url(institutionId)), superAdmin);

    expect(res.status).toBe(500);
  });
});

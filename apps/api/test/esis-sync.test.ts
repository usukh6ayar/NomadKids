import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { EsisError } from "../src/integrations/esis/esis.client";
import {
  EsisSyncService,
  ROSTER_MOVEMENTS_FALLBACK_DAYS,
} from "../src/integrations/esis/esis-sync.service";
import type { EsisService } from "../src/integrations/esis/esis.service";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";

/*
 * ★ The two describe blocks above `describe("POST …/esis/sync"...)` are
 * driven through `app.get(EsisSyncService)`, not through HTTP — they predate
 * Task 5's route (`POST /v1/kindergartens/:id/esis/sync`,
 * `GET …/esis/sync-runs`), which this file now also covers. Calling the
 * service directly still exercises the real repository, the real Prisma
 * transaction and the real `EsisReference` table; they are left as-is because
 * rewriting them through HTTP would add nothing but a router hop — the
 * controller layer (authorization, param parsing) is exactly what the new
 * HTTP-driven blocks below test, with their own authorization cases.
 */

const institutionId = "40305";

/*
 * One row per resource with a correct `idField`, so a sweep with no
 * per-test override stores exactly one row for every one of the thirteen
 * resources. Field names and which field is the id come straight off
 * `esis.reference.ts`'s table — copied, not derived, so a change to that
 * file's `idField` choices is a reason for this fixture to go stale and
 * fail loudly rather than silently agree with whatever the source says.
 */
const DEFAULT_ROWS: Record<string, Record<string, unknown>> = {
  foodProductTypes: { productType: "1", productTypeName: "Ногоо" },
  foodMaterialGroups: { groupId: "10", groupName: "Үр тариа" },
  foodMaterials: { materialId: "20", materialName: "Будаа" },
  foodProducts: { productId: "30", productName: "Цагаан будаа" },
  foodProductMaterials: { productMaterialId: "40", productId: "30" },
  screeningQuestions: { surveyNameId: "50", questionText: "…" },
  buildings: { buildingId: "60", buildingName: "Байр А" },
  rooms: { facilityId: "70", facilityName: "Өрөө 1" },
  programs: { institutionId, programOfStudyId: "80", programName: "СӨБ" },
  subjectAreas: { subjectAreaId: "90", subjectAreaName: "Хөгжим" },
  academicOrg: { institutionId, subjectDepartmentId: "100", departmentName: "Нэгдсэн баг" },
  vaccineCatalog: { VACCINE_NAME: "БЦЖ", VACCINE_DOSE: "1" },
  academicYearStatuses: { academicYear: "2024-2025", status: "ACTIVE" },
};

const read = vi.fn(async (key: string) => ({
  data: [DEFAULT_ROWS[key]].filter(Boolean),
  status: 200,
  durationMs: 3,
}));

const esis = {
  isConfigured: true,
  status: () => ({
    configured: true,
    baseUrl: "https://hubv2.esis.edu.mn",
    institutionId,
    hasToken: true,
  }),
  read,
} as unknown as Partial<EsisService>;

let app: INestApplication;
let sync: EsisSyncService;
let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let adminB: AuthSession;
let teacherA: AuthSession;

const db = testDb();
const server = () => app.getHttpServer();

beforeAll(async () => {
  app = await createTestApp({ esis });
  sync = app.get(EsisSyncService);
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();
  read.mockClear();
  read.mockImplementation(async (key: string) => ({
    data: [DEFAULT_ROWS[key]].filter(Boolean),
    status: 200,
    durationMs: 3,
  }));

  a = await createScenario("sync");
  b = await createScenario("sync-b");
  await mapInstitution(a.kindergarten.id);

  [adminA, adminB, teacherA] = await Promise.all([
    login(app, a.adminUser.username),
    login(app, b.adminUser.username),
    login(app, a.teacherUser.username),
  ]);
});

/** Sets the tenant's ESIS mapping directly — the mapping endpoint is not under test here. */
function mapInstitution(kindergartenId: string) {
  return db.kindergarten.update({
    where: { id: kindergartenId },
    data: { esisInstitutionId: institutionId, esisEnvironment: "TEST", esisMappedAt: new Date() },
  });
}

describe("EsisSyncService.runReferenceSync", () => {
  it("stores a national resource once, with kindergartenId NULL", async () => {
    await sync.runReferenceSync({ kindergartenId: a.kindergarten.id, actorUserId: a.adminUser.id });

    const rows = await db.esisReference.findMany({ where: { resource: "foodProducts" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kindergartenId: null, externalId: "30" });
  });

  it("stores an institution resource against the kindergarten", async () => {
    await sync.runReferenceSync({ kindergartenId: a.kindergarten.id, actorUserId: a.adminUser.id });

    const rows = await db.esisReference.findMany({ where: { resource: "buildings" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kindergartenId: a.kindergarten.id, externalId: "60" });
  });

  it("replaces rather than accumulates on a second sweep", async () => {
    await sync.runReferenceSync({ kindergartenId: a.kindergarten.id, actorUserId: a.adminUser.id });

    read.mockImplementation(async (key: string) => ({
      data:
        key === "buildings"
          ? [{ buildingId: "61", buildingName: "Байр Б" }]
          : [DEFAULT_ROWS[key]].filter(Boolean),
      status: 200,
      durationMs: 3,
    }));
    await sync.runReferenceSync({ kindergartenId: a.kindergarten.id, actorUserId: a.adminUser.id });

    const rows = await db.esisReference.findMany({ where: { resource: "buildings" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: "61" });
  });

  /* A row nobody can identify is counted and dropped, never stored as "undefined". */
  it("skips and counts a row whose external id cannot be read", async () => {
    read.mockImplementation(async (key: string) => ({
      data:
        key === "rooms"
          ? [{ facilityId: "70", facilityName: "Өрөө 1" }, { facilityName: "no id here" }]
          : [DEFAULT_ROWS[key]].filter(Boolean),
      status: 200,
      durationMs: 3,
    }));

    const outcome = await sync.runReferenceSync({
      kindergartenId: a.kindergarten.id,
      actorUserId: a.adminUser.id,
    });

    const roomsResult = outcome.results.find((r) => r.resource === "rooms");
    expect(roomsResult).toMatchObject({ status: "SUCCEEDED", stored: 1, skipped: 1 });

    const rows = await db.esisReference.findMany({ where: { resource: "rooms" } });
    expect(rows).toHaveLength(1);
    expect(rows.map((r) => r.externalId)).not.toContain("undefined");
  });

  /* A refused credential must never reach the stored JSON. */
  it("never stores a refused credential in the payload", async () => {
    read.mockImplementation(async (key: string) => ({
      data:
        key === "foodProducts"
          ? [{ ...DEFAULT_ROWS.foodProducts, googleEmailPass: "leaked" }]
          : [DEFAULT_ROWS[key]].filter(Boolean),
      status: 200,
      durationMs: 3,
    }));

    await sync.runReferenceSync({ kindergartenId: a.kindergarten.id, actorUserId: a.adminUser.id });

    const rows = await db.esisReference.findMany({ where: { resource: "foodProducts" } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]!.payload)).not.toContain("leaked");
    expect(JSON.stringify(rows[0]!.payload)).not.toContain("googleEmailPass");
  });

  /* One resource failing must not abandon the other twelve. */
  it("finishes PARTIAL when one resource fails, and stores the rest", async () => {
    read.mockImplementation(async (key: string) => {
      if (key === "vaccineCatalog") {
        throw new EsisError("http", "ESIS responded 500", {
          status: 500,
          path: "/vaccine/catalog",
        });
      }
      return { data: [DEFAULT_ROWS[key]].filter(Boolean), status: 200, durationMs: 3 };
    });

    const outcome = await sync.runReferenceSync({
      kindergartenId: a.kindergarten.id,
      actorUserId: a.adminUser.id,
    });

    expect(outcome.status).toBe("PARTIAL");
    const failed = outcome.results.find((r) => r.resource === "vaccineCatalog");
    expect(failed).toMatchObject({ status: "FAILED", stored: 0 });

    // The rest still stored.
    expect(await db.esisReference.count({ where: { resource: "buildings" } })).toBe(1);
    expect(await db.esisReference.count({ where: { resource: "foodProducts" } })).toBe(1);

    const run = await db.esisSyncRun.findUniqueOrThrow({ where: { id: outcome.runId } });
    expect(run.status).toBe("PARTIAL");
  });

  it("writes the run with the actor's id when a person asked", async () => {
    const outcome = await sync.runReferenceSync({
      kindergartenId: a.kindergarten.id,
      actorUserId: a.adminUser.id,
    });

    const run = await db.esisSyncRun.findUniqueOrThrow({ where: { id: outcome.runId } });
    expect(run.initiatedById).toBe(a.adminUser.id);
  });

  /* NULL means the schedule ran it — the nullability Task 1 added. */
  it("writes the run with a NULL initiator when nobody asked", async () => {
    const outcome = await sync.runReferenceSync({
      kindergartenId: a.kindergarten.id,
      actorUserId: null,
    });

    const run = await db.esisSyncRun.findUniqueOrThrow({ where: { id: outcome.runId } });
    expect(run.initiatedById).toBeNull();
  });

  it("refuses a second sweep while one is already running", async () => {
    await db.esisSyncRun.create({
      data: { kindergartenId: a.kindergarten.id, initiatedById: a.adminUser.id, resources: [] },
    });

    await expect(
      sync.runReferenceSync({ kindergartenId: a.kindergarten.id, actorUserId: a.adminUser.id }),
    ).rejects.toThrow();
  });

  it("recovers a stale run before starting a new one", async () => {
    await db.esisSyncRun.create({
      data: {
        kindergartenId: a.kindergarten.id,
        initiatedById: a.adminUser.id,
        resources: [],
        startedAt: new Date(Date.now() - 16 * 60_000),
      },
    });

    const outcome = await sync.runReferenceSync({
      kindergartenId: a.kindergarten.id,
      actorUserId: a.adminUser.id,
    });

    expect(outcome.status).toBe("SUCCEEDED");
    expect(await db.esisSyncRun.count({ where: { kindergartenId: a.kindergarten.id } })).toBe(2);
  });

  it("refuses an unmapped kindergarten", async () => {
    const b = await createScenario("sync-unmapped");
    await expect(
      sync.runReferenceSync({ kindergartenId: b.kindergarten.id, actorUserId: b.adminUser.id }),
    ).rejects.toThrow();
  });
});

describe("EsisSyncService.runRosterSync", () => {
  const staffRow = {
    personId: "90000000000001",
    personRegNumber: "ул24270406",
    lastName: "Овог",
    firstName: "Нэр",
    jobCode: "2342-13",
    positionName: "Багш",
  };

  /**
   * `staff` and `teachers` answer with one matching row each, so
   * `refreshStaffRosterCore` stores exactly one person; `studentMovements`
   * answers with whatever `movements` says, defaulting to none. Every other
   * key falls through to the reference-sweep default so a stray call during
   * these tests still resolves instead of returning `undefined`.
   */
  function mockRosterReads(movements: Record<string, unknown>[] = []) {
    read.mockImplementation(async (key: string) => {
      if (key === "staff" || key === "teachers") {
        return { data: [staffRow], status: 200, durationMs: 3 };
      }
      if (key === "studentMovements") {
        return { data: movements, status: 200, durationMs: 3 };
      }
      return { data: [DEFAULT_ROWS[key]].filter(Boolean), status: 200, durationMs: 3 };
    });
  }

  function movementsCall() {
    return read.mock.calls.find((call) => call[0] === "studentMovements");
  }

  it("stores the staff roster and records a run whose summary names the roster kind", async () => {
    mockRosterReads([{ actionName: "ELMENTED", actionDate: "2026-09-10" }]);

    const outcome = await sync.runRosterSync({
      kindergartenId: a.kindergarten.id,
      actorUserId: a.adminUser.id,
    });

    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.roster).toMatchObject({ stored: 1, skipped: 0 });
    expect(outcome.movements.count).toBe(1);

    const stored = await db.esisStaffRoster.findMany({
      where: { kindergartenId: a.kindergarten.id },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ registerNumber: "УЛ24270406" });

    const run = await db.esisSyncRun.findUniqueOrThrow({ where: { id: outcome.runId } });
    expect(run.status).toBe("SUCCEEDED");
    expect(run.summary).toMatchObject({ kind: "ROSTER" });
  });

  it("reads studentMovements with a beginDate derived from the last successful roster run", async () => {
    mockRosterReads();
    const finishedAt = new Date("2026-08-20T10:00:00.000Z");
    await db.esisSyncRun.create({
      data: {
        kindergartenId: a.kindergarten.id,
        initiatedById: a.adminUser.id,
        resources: [],
        status: "SUCCEEDED",
        summary: {
          kind: "ROSTER",
          roster: { stored: 1, skipped: 0 },
          movements: { beginDate: "2026-08-13", count: 0, errorCode: null },
        },
        finishedAt,
      },
    });

    await sync.runRosterSync({ kindergartenId: a.kindergarten.id, actorUserId: a.adminUser.id });

    expect(movementsCall()?.[1]).toEqual({ beginDate: "2026-08-20" });
  });

  it("falls back to a sensible span when there has never been a successful roster run", async () => {
    mockRosterReads();

    // Computed before the call, not after — recomputing `Date.now() - 7d`
    // afterwards would flake if the two calls straddled UTC midnight.
    const expected = new Date(Date.now() - ROSTER_MOVEMENTS_FALLBACK_DAYS * 24 * 60 * 60_000)
      .toISOString()
      .slice(0, 10);

    await sync.runRosterSync({ kindergartenId: a.kindergarten.id, actorUserId: a.adminUser.id });

    expect(movementsCall()?.[1]).toEqual({ beginDate: expected });
  });

  /*
   * ★ The case that would otherwise be found in production: a REFERENCE run
   * finishes SUCCEEDED far more reliably than a roster pull does, and if
   * `lastSuccessfulRun` were not filtered by kind, its timestamp would win
   * the "most recent success" race even though it has nothing to do with the
   * roster.
   */
  it("does not mistake a REFERENCE run for a ROSTER run when picking the date", async () => {
    mockRosterReads();
    await db.esisSyncRun.create({
      data: {
        kindergartenId: a.kindergarten.id,
        initiatedById: a.adminUser.id,
        resources: [],
        status: "SUCCEEDED",
        summary: { kind: "REFERENCE", resources: [] },
        finishedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    // The REFERENCE run's ancient date must not have been picked up — the
    // fallback span applies exactly as if no run existed at all. Computed
    // before the call for the same reason as the case above.
    const expected = new Date(Date.now() - ROSTER_MOVEMENTS_FALLBACK_DAYS * 24 * 60 * 60_000)
      .toISOString()
      .slice(0, 10);

    await sync.runRosterSync({ kindergartenId: a.kindergarten.id, actorUserId: a.adminUser.id });

    expect(movementsCall()?.[1]).toEqual({ beginDate: expected });
  });

  /*
   * ★ The pairing this test exists to catch: a run that finished SUCCEEDED
   * despite never actually reading `studentMovements` would let
   * `lastSuccessfulRun` anchor the *next* sync on a window nothing ever
   * covered — the gap `EsisRepository.lastSuccessfulRun`'s doc comment
   * names. PARTIAL keeps that run out of the running entirely, so the
   * following sync re-reads the same span rather than skipping past it.
   */
  it("does not advance the anchor past a run whose movements read failed", async () => {
    mockRosterReads();
    read.mockImplementation(async (key: string) => {
      if (key === "staff" || key === "teachers") {
        return { data: [staffRow], status: 200, durationMs: 3 };
      }
      if (key === "studentMovements") {
        throw new EsisError("http", "ESIS responded 500", {
          status: 500,
          path: "/student/movement/v2",
        });
      }
      return { data: [DEFAULT_ROWS[key]].filter(Boolean), status: 200, durationMs: 3 };
    });

    const first = await sync.runRosterSync({
      kindergartenId: a.kindergarten.id,
      actorUserId: a.adminUser.id,
    });
    expect(first.status).toBe("PARTIAL");

    const firstRun = await db.esisSyncRun.findUniqueOrThrow({ where: { id: first.runId } });
    expect(firstRun.status).toBe("PARTIAL");

    // The window the next sync should ask for is still the pre-first-run
    // fallback — the PARTIAL run's `finishedAt` must not have become the
    // anchor.
    const expected = new Date(Date.now() - ROSTER_MOVEMENTS_FALLBACK_DAYS * 24 * 60 * 60_000)
      .toISOString()
      .slice(0, 10);

    mockRosterReads();
    await sync.runRosterSync({ kindergartenId: a.kindergarten.id, actorUserId: a.adminUser.id });

    expect(movementsCall()?.[1]).toEqual({ beginDate: expected });
  });

  /*
   * ★ The sharper version of the case two tests above: a PARTIAL run sitting
   * **more recently** than a genuinely SUCCEEDED one must not win just for
   * being newer. `lastSuccessfulRun` orders by `finishedAt DESC` but filters
   * `status: "SUCCEEDED"` first, so the PARTIAL row is never a candidate at
   * all — the anchor reaches back past it to the last run that actually read
   * a window, rather than falling all the way to the fallback span the way
   * the case above does when there is no SUCCEEDED run to reach back to.
   */
  it("reaches past a more recent PARTIAL run to the last genuinely successful one", async () => {
    mockRosterReads();
    const succeededAt = new Date("2026-08-10T09:00:00.000Z");
    await db.esisSyncRun.create({
      data: {
        kindergartenId: a.kindergarten.id,
        initiatedById: a.adminUser.id,
        resources: [],
        status: "SUCCEEDED",
        summary: {
          kind: "ROSTER",
          roster: { stored: 1, skipped: 0 },
          movements: { beginDate: "2026-08-03", count: 2, errorCode: null },
        },
        finishedAt: succeededAt,
      },
    });
    await db.esisSyncRun.create({
      data: {
        kindergartenId: a.kindergarten.id,
        initiatedById: a.adminUser.id,
        resources: [],
        status: "PARTIAL",
        summary: {
          kind: "ROSTER",
          roster: { stored: 1, skipped: 0 },
          movements: { beginDate: "2026-08-10", count: null, errorCode: "HTTP" },
        },
        // Later than the SUCCEEDED run above — the newer timestamp must lose.
        finishedAt: new Date("2026-08-15T09:00:00.000Z"),
      },
    });

    await sync.runRosterSync({ kindergartenId: a.kindergarten.id, actorUserId: a.adminUser.id });

    expect(movementsCall()?.[1]).toEqual({ beginDate: "2026-08-10" });
  });

  it("refuses a second roster sync while one is already running", async () => {
    mockRosterReads();
    await db.esisSyncRun.create({
      data: { kindergartenId: a.kindergarten.id, initiatedById: a.adminUser.id, resources: [] },
    });

    await expect(
      sync.runRosterSync({ kindergartenId: a.kindergarten.id, actorUserId: a.adminUser.id }),
    ).rejects.toThrow();
  });
});

/**
 * Task 5: the manual pull, driven through the real route.
 *
 * ★ This calls the **same** `EsisSyncService` methods the two describe blocks
 * above already cover in depth — the point of the route is that there is no
 * second implementation to test separately. What is new here, and what only
 * an HTTP-level test can prove (CLAUDE.md §4.1), is the controller's own
 * layer: the role gate, the tenant scope and the request shape.
 */
describe("POST /v1/kindergartens/:id/esis/sync", () => {
  const url = (id: string) => `/v1/kindergartens/${id}/esis/sync`;

  it("lets an admin pull the reference tier", async () => {
    const res = await authed(request(server()).post(url(a.kindergarten.id)), adminA).send({
      tier: "REFERENCE",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("SUCCEEDED");

    expect(await db.esisReference.count({ where: { resource: "foodProducts" } })).toBe(1);

    const run = await db.esisSyncRun.findUniqueOrThrow({ where: { id: res.body.runId } });
    expect(run.initiatedById).toBe(a.adminUser.id);
  });

  it("lets an admin pull the roster tier", async () => {
    read.mockImplementation(async (key: string) => {
      if (key === "staff" || key === "teachers") {
        return {
          data: [
            {
              personId: "90000000000001",
              personRegNumber: "ул24270406",
              lastName: "Овог",
              firstName: "Нэр",
              jobCode: "2342-13",
              positionName: "Багш",
            },
          ],
          status: 200,
          durationMs: 3,
        };
      }
      if (key === "studentMovements") return { data: [], status: 200, durationMs: 3 };
      return { data: [DEFAULT_ROWS[key]].filter(Boolean), status: 200, durationMs: 3 };
    });

    const res = await authed(request(server()).post(url(a.kindergarten.id)), adminA).send({
      tier: "ROSTER",
    });

    expect(res.status).toBe(200);
    expect(await db.esisStaffRoster.count({ where: { kindergartenId: a.kindergarten.id } })).toBe(
      1,
    );
  });

  /* CLAUDE.md §1.7 — 404, and no run left behind for a caller who was refused. */
  it("returns 404 to a teacher, and writes no run", async () => {
    const res = await authed(request(server()).post(url(a.kindergarten.id)), teacherA).send({
      tier: "REFERENCE",
    });

    expect(res.status).toBe(404);
    expect(await db.esisSyncRun.count({ where: { kindergartenId: a.kindergarten.id } })).toBe(0);
  });

  it("returns 404 to an admin of another kindergarten", async () => {
    const res = await authed(request(server()).post(url(a.kindergarten.id)), adminB).send({
      tier: "REFERENCE",
    });

    expect(res.status).toBe(404);
    expect(await db.esisSyncRun.count({ where: { kindergartenId: a.kindergarten.id } })).toBe(0);
  });

  /* The schema refuses it before the controller method body — and so before ESIS or the run table. */
  it("rejects an unknown tier before anything runs", async () => {
    const res = await authed(request(server()).post(url(a.kindergarten.id)), adminA).send({
      tier: "NOT_A_TIER",
    });

    expect(res.status).toBe(400);
    expect(read).not.toHaveBeenCalled();
    expect(await db.esisSyncRun.count({ where: { kindergartenId: a.kindergarten.id } })).toBe(0);
  });
});

describe("GET /v1/kindergartens/:id/esis/sync-runs", () => {
  const url = (id: string, query = "") => `/v1/kindergartens/${id}/esis/sync-runs${query}`;

  it("lists runs newest first, paginated", async () => {
    await sync.runReferenceSync({
      kindergartenId: a.kindergarten.id,
      actorUserId: a.adminUser.id,
    });
    await sync.runReferenceSync({
      kindergartenId: a.kindergarten.id,
      actorUserId: a.adminUser.id,
    });

    const paged = await authed(
      request(server()).get(url(a.kindergarten.id, "?page=1&pageSize=1")),
      adminA,
    );
    expect(paged.status).toBe(200);
    expect(paged.body.items).toHaveLength(1);
    expect(paged.body.total).toBe(2);
    expect(paged.body.page).toBe(1);
    expect(paged.body.pageSize).toBe(1);

    const full = await authed(
      request(server()).get(url(a.kindergarten.id, "?page=1&pageSize=10")),
      adminA,
    );
    expect(new Date(full.body.items[0].startedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(full.body.items[1].startedAt).getTime(),
    );
  });

  /*
   * ★ The case this task's plan calls out by name: nothing produces a NULL
   * `initiatedById` yet (every caller so far passes an actor), but Task 8's
   * scheduler will, and this is the route where that first becomes visible.
   * Seeded directly through the test db client for exactly that reason.
   */
  it("names who started a manual run, and shows a scheduled run as having no initiator", async () => {
    await sync.runReferenceSync({
      kindergartenId: a.kindergarten.id,
      actorUserId: a.adminUser.id,
    });
    await db.esisSyncRun.create({
      data: { kindergartenId: a.kindergarten.id, initiatedById: null, resources: [] },
    });

    const res = await authed(request(server()).get(url(a.kindergarten.id)), adminA);

    expect(res.status).toBe(200);
    const named = res.body.items.find((run: { initiatedBy: string | null }) => run.initiatedBy);
    const scheduled = res.body.items.find(
      (run: { initiatedBy: string | null }) => run.initiatedBy === null,
    );
    expect(named?.initiatedBy).toContain(a.adminUser.lastName);
    expect(scheduled).toBeTruthy();
  });

  it("returns 404 to a teacher", async () => {
    const res = await authed(request(server()).get(url(a.kindergarten.id)), teacherA);
    expect(res.status).toBe(404);
  });

  it("returns 404 to an admin of another kindergarten", async () => {
    const res = await authed(request(server()).get(url(a.kindergarten.id)), adminB);
    expect(res.status).toBe(404);
  });
});

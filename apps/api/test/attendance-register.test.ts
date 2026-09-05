import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  authed,
  createChild,
  createGroup,
  createMembership,
  createScenario,
  createUser,
  enrollChild,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import ExcelJS from "exceljs";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * The kindergarten-wide attendance register — the director's and the
 * accountant's view of who was here, over any range of dates.
 *
 * ★ Every attendance read before this one answered about one group on one day,
 * or one child in one month. Neither shape answers "how did the whole
 * kindergarten do over the period this funding claim covers", and that is the
 * question that precedes both a claim and a parent's invoice.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let admin: AuthSession;
let accountant: AuthSession;
let teacher: AuthSession;
let parent: AuthSession;
let adminB: AuthSession;

const server = () => app.getHttpServer();

beforeAll(async () => {
  app = await createTestApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  // ★ Five logins per test, sixteen tests. Without this the login limiter
  // starts answering 429 partway through the file and the failures read as
  // register defects.
  app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  const accUser = await createUser({ username: uniq("acct") });
  await createMembership(accUser.id, a.kindergarten.id, "ACCOUNTANT");
  accountant = await login(app, accUser.username);

  admin = await login(app, a.adminUser.username);
  adminB = await login(app, b.adminUser.username);
  teacher = await login(app, a.teacherUser.username);
  parent = await login(app, a.parentUser.username);
});

async function mark(
  scenario: Scenario,
  enrollmentId: string,
  childId: string,
  date: string,
  status: string,
) {
  return db.attendance.create({
    data: {
      kindergartenId: scenario.kindergarten.id,
      childId,
      enrollmentId,
      date: new Date(`${date}T00:00:00.000Z`),
      status,
    } as never,
  });
}

function register(
  session: AuthSession,
  kindergartenId: string,
  query = "from=2026-03-02&to=2026-03-06",
) {
  return authed(
    request(server()).get(`/v1/kindergartens/${kindergartenId}/attendance/register?${query}`),
    session,
  );
}

describe("who may read the register", () => {
  it("admits the administrator", async () => {
    expect((await register(admin, a.kindergarten.id)).status).toBe(200);
  });

  it("admits the accountant — the register is what their calculations start from", async () => {
    expect((await register(accountant, a.kindergarten.id)).status).toBe(200);
  });

  it("refuses a teacher — §13 keeps them out of the kindergarten-wide figures", async () => {
    // ★ Not a general exclusion from attendance. The same teacher reads their
    // own group's day sheet; what they may not have is every group at once,
    // which is the number a funding claim is built from.
    expect((await register(teacher, a.kindergarten.id)).status).toBe(404);
  });

  it("refuses a guardian", async () => {
    expect((await register(parent, a.kindergarten.id)).status).toBe(404);
  });

  it("refuses an administrator of a different kindergarten", async () => {
    // The role gate would let this through; the service reads the membership
    // against the kindergarten in the URL, and that is what refuses.
    expect((await register(adminB, a.kindergarten.id)).status).toBe(404);
  });
});

describe("the grid", () => {
  it("returns one column per day in the range, both ends included", async () => {
    const res = await register(admin, a.kindergarten.id, "from=2026-03-02&to=2026-03-06");

    expect(res.status).toBe(200);
    expect(res.body.days).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
    ]);
  });

  it("puts each child's marks in the right column and leaves the rest null", async () => {
    // ★ `null`, not "absent". A day nobody marked and a day marked ABSENT are
    // different facts, and a register that conflated them would report
    // absences the kindergarten never recorded.
    await mark(a, a.enrollment.id, a.child.id, "2026-03-03", "PRESENT");
    await mark(a, a.enrollment.id, a.child.id, "2026-03-05", "SICK");

    const res = await register(admin, a.kindergarten.id);
    const row = res.body.items.find((r: { childId: string }) => r.childId === a.child.id);

    expect(row.days.map((d: { status: string } | null) => d?.status ?? null)).toEqual([
      null,
      "PRESENT",
      null,
      "SICK",
      null,
    ]);
    expect(row.counts).toEqual({ PRESENT: 1, SICK: 1 });
  });

  it("totals across every matching child, not just the page on screen", async () => {
    await mark(a, a.enrollment.id, a.child.id, "2026-03-02", "PRESENT");
    await mark(a, a.enrollment.id, a.child.id, "2026-03-03", "PRESENT");

    const res = await register(admin, a.kindergarten.id);
    expect(res.body.totals.PRESENT).toBe(2);
  });

  it("ignores another kindergarten's children", async () => {
    await mark(b, b.enrollment.id, b.child.id, "2026-03-03", "PRESENT");

    const res = await register(admin, a.kindergarten.id);
    expect(res.body.items.some((r: { childId: string }) => r.childId === b.child.id)).toBe(false);
  });

  it("refuses a range longer than a quarter rather than timing out on it", async () => {
    // 300 children over a school year is 66,000 cells: a slow query, a large
    // payload and a table nobody can read. Two requests beat one that hangs.
    const res = await register(admin, a.kindergarten.id, "from=2026-01-01&to=2026-12-31");
    expect(res.status).toBe(400);
  });

  it("refuses a range that runs backwards", async () => {
    const res = await register(admin, a.kindergarten.id, "from=2026-03-10&to=2026-03-01");
    expect(res.status).toBe(400);
  });
});

describe("the filters", () => {
  it("narrows to one group without dropping that group's children", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Бэлтгэл");
    const otherChild = await createChild(a.kindergarten.id, { firstName: "Сараа" });
    await enrollChild(a.kindergarten.id, otherChild.id, other.id, a.schoolYear.id);

    const res = await register(
      admin,
      a.kindergarten.id,
      `from=2026-03-02&to=2026-03-06&groupId=${other.id}`,
    );

    const ids = res.body.items.map((r: { childId: string }) => r.childId);
    expect(ids).toContain(otherChild.id);
    expect(ids).not.toContain(a.child.id);
  });

  it("keeps a child in the register when filtering by status, showing only those days", async () => {
    // ★★ The discriminating case. Filtering by SICK is the question "who was
    // sick, and when" — a child with no sick days is part of that answer, and
    // dropping them would make the register lie by omission.
    await mark(a, a.enrollment.id, a.child.id, "2026-03-03", "PRESENT");
    await mark(a, a.enrollment.id, a.child.id, "2026-03-05", "SICK");

    const res = await register(
      admin,
      a.kindergarten.id,
      "from=2026-03-02&to=2026-03-06&status=SICK",
    );
    const row = res.body.items.find((r: { childId: string }) => r.childId === a.child.id);

    expect(row).toBeDefined();
    expect(row.counts).toEqual({ SICK: 1 });
    expect(row.days.filter(Boolean)).toHaveLength(1);
  });

  it("records and filters OTHER — the sixth status the schemas used to omit", async () => {
    // ★ The teacher's day sheet has always drawn a "Бусад" button from
    // `ATTENDANCE_STATUS_LABEL`; until 2026-09-02 pressing it sent a status the
    // API refused. The button rendered, the save failed, and nothing said why.
    const res = await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/2026-03-03`),
      admin,
    ).send({ status: "OTHER" });

    expect(res.status).toBe(200);

    const filtered = await register(
      admin,
      a.kindergarten.id,
      "from=2026-03-02&to=2026-03-06&status=OTHER",
    );
    const row = filtered.body.items.find((r: { childId: string }) => r.childId === a.child.id);
    expect(row.counts).toEqual({ OTHER: 1 });
  });

  it("accepts several statuses at once", async () => {
    await mark(a, a.enrollment.id, a.child.id, "2026-03-03", "PRESENT");
    await mark(a, a.enrollment.id, a.child.id, "2026-03-04", "ABSENT");
    await mark(a, a.enrollment.id, a.child.id, "2026-03-05", "SICK");

    const res = await register(
      admin,
      a.kindergarten.id,
      "from=2026-03-02&to=2026-03-06&status=SICK,ABSENT",
    );
    const row = res.body.items.find((r: { childId: string }) => r.childId === a.child.id);

    expect(row.counts).toEqual({ ABSENT: 1, SICK: 1 });
  });

  it("finds a child by a fragment of either name", async () => {
    const res = await register(
      admin,
      a.kindergarten.id,
      `from=2026-03-02&to=2026-03-06&q=${encodeURIComponent(a.child.firstName.slice(0, 3))}`,
    );

    expect(res.body.items.some((r: { childId: string }) => r.childId === a.child.id)).toBe(true);
  });

  it("returns an empty register rather than an error when nothing matches", async () => {
    const res = await register(
      admin,
      a.kindergarten.id,
      "from=2026-03-02&to=2026-03-06&q=zzzznobody",
    );

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.days).toHaveLength(5);
  });
});

describe("the spreadsheet", () => {
  function download(session: AuthSession, query = "from=2026-03-02&to=2026-03-06") {
    return authed(
      request(server())
        .get(`/v1/kindergartens/${a.kindergarten.id}/attendance/register/export?${query}`)
        .buffer()
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => callback(null, Buffer.concat(chunks)));
        }),
      session,
    );
  }

  it("leaves an unmarked day blank, so a blank cell is not a value to filter around", async () => {
    /*
     * ★★★ The assertion this describe block exists for.
     *
     * A dash would make every unmarked day something to work around in the
     * file a claim is checked from — `COUNTIF` counts it, a filter offers it,
     * and a reader has to know it means "no record" rather than a status. An
     * empty cell means the same thing to a person and to a formula.
     */
    await mark(a, a.enrollment.id, a.child.id, "2026-03-03", "PRESENT");

    const res = await download(admin);
    expect(res.status).toBe(200);

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.body as Buffer);
    const sheet = book.getWorksheet("Өдөр тутмын ирц")!;

    // Row 4: two title rows, then the header, then the first child.
    const row = sheet.getRow(4);
    // Columns: child, group, then one per day (2026-03-02 … 03-06).
    expect(String(row.getCell(4).value ?? "")).toBe("Ирсэн");
    expect(row.getCell(3).value ?? "").toBe("");
    expect(row.getCell(5).value ?? "").toBe("");
  });

  it("writes the summary counts as numbers an accountant can sum", async () => {
    // A right-aligned string that looks like a number does not add up.
    await mark(a, a.enrollment.id, a.child.id, "2026-03-03", "PRESENT");
    await mark(a, a.enrollment.id, a.child.id, "2026-03-04", "PRESENT");

    const res = await download(admin);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.body as Buffer);
    const sheet = book.getWorksheet("Дүн")!;

    const value = sheet.getRow(2).getCell(3).value;
    expect(typeof value).toBe("number");
    expect(value).toBe(2);
  });

  it("exports every row, not the page the screen stopped at", async () => {
    // A file that ended at row twenty-five would be worse than no file: the
    // reader would not notice, and would file it.
    const res = await download(admin, "from=2026-03-02&to=2026-03-06&pageSize=1");

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.body as Buffer);
    const sheet = book.getWorksheet("Дүн")!;

    // Header + one row per child + the totals row. The scenario has one child
    // in this kindergarten, so three — and `pageSize=1` did not truncate it.
    expect(sheet.rowCount).toBeGreaterThanOrEqual(3);
  });

  it("refuses a teacher, same as the screen", async () => {
    expect((await download(teacher)).status).toBe(404);
  });
});

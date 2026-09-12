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
  await app.get(RateLimitService).resetAll();

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

  /*
   * ★ 2026-09-12, at the client's request: "доор ангийн нийт ирсэн, нийт гэсэн
   * тоон үзүүлэлтүүдийг хойно нь бодож гарга."
   *
   * Counted here rather than on the screen for the same reason `totals` is: the
   * response pages over children, and a class total assembled from one page
   * would change when the reader turned to the next.
   */
  it("★ totals each class over every matching child, not the page", async () => {
    await mark(a, a.enrollment.id, a.child.id, "2026-03-02", "PRESENT");
    await mark(a, a.enrollment.id, a.child.id, "2026-03-03", "SICK");

    const res = await register(
      admin,
      a.kindergarten.id,
      "from=2026-03-02&to=2026-03-06&pageSize=1",
    );

    const group = res.body.groups.find((row: { group: string }) => row.group === a.group.name);
    expect(group).toBeDefined();
    expect(group.children).toBe(1);
    expect(group.counts).toEqual({ PRESENT: 1, SICK: 1 });
    expect(group.recorded).toBe(2);
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

  /*
   * ★ 2026-09-12: "татаж авахаар нийт бодолтууд ерөөсөө орохгүй байна."
   *
   * The grid sheet was the grid and only the grid — every figure the screen
   * computes under and beside it was missing from the one sheet that looks
   * like what the reader was just looking at.
   */
  it("★ carries the screen's own totals onto the grid sheet", async () => {
    await mark(a, a.enrollment.id, a.child.id, "2026-03-03", "PRESENT");
    await mark(a, a.enrollment.id, a.child.id, "2026-03-04", "SICK");

    const res = await download(admin);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.body as Buffer);
    const sheet = book.getWorksheet("Өдөр тутмын ирц")!;

    // Two title rows, the header, then the children. Columns: child, group,
    // five days, then Ирсэн · Өвчтэй · Чөлөөтэй · Тасалсан · Нийт.
    const header = sheet.getRow(3);
    expect(String(header.getCell(8).value)).toBe("Ирсэн");
    expect(String(header.getCell(12).value)).toBe("Нийт");

    // The child's own row carries their counts across the range.
    const child = sheet.getRow(4);
    expect(child.getCell(8).value).toBe(1);
    expect(child.getCell(9).value).toBe(1);
    expect(child.getCell(12).value).toBe(2);

    // Then a blank line and the per-day tally, ending in the range total.
    const tally = sheet.getRow(6);
    expect(String(tally.getCell(1).value)).toBe("Ирсэн");
    // 2026-03-03 is the second day column, which is column 4.
    expect(tally.getCell(4).value).toBe(1);
    expect(tally.getCell(8).value).toBe(1);

    const total = sheet.getRow(10);
    expect(String(total.getCell(1).value)).toBe("Нийт");
    expect(total.getCell(12).value).toBe(2);
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

  /*
   * ★ "Татахад энэ мэдээлэл бүхлээрээ татагддаг байна, бодолтууд бүгд орно" —
   * the class totals on screen come down with the file, on a sheet of their
   * own, counted by the same function rather than summed again here.
   */
  it("★ carries the class totals into the file, on their own sheet", async () => {
    await mark(a, a.enrollment.id, a.child.id, "2026-03-03", "PRESENT");
    await mark(a, a.enrollment.id, a.child.id, "2026-03-04", "SICK");

    const res = await download(admin);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.body as Buffer);
    const sheet = book.getWorksheet("Ангийн дүн")!;

    expect(sheet).toBeDefined();
    expect(String(sheet.getRow(1).getCell(1).value)).toBe("Анги");
    expect(String(sheet.getRow(2).getCell(1).value)).toBe(a.group.name);
    // Анги, Хүүхэд, then the six statuses in order — PRESENT is the third.
    expect(sheet.getRow(2).getCell(2).value).toBe(1);
    expect(sheet.getRow(2).getCell(3).value).toBe(1);
    // The last column is every recorded day: one present, one sick.
    expect(sheet.getRow(2).getCell(9).value).toBe(2);
    expect(String(sheet.getRow(3).getCell(1).value)).toBe("Нийт");
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

/**
 * `?childId=` — the journal's checkboxes, added 2026-09-04.
 *
 * ★ The property worth a test is that it **narrows and cannot widen**.
 *
 * It is a filter ANDed into the same enrolment `where` that
 * `assertCanReadFinance` already gates by kindergarten, not a lookup by id. An
 * endpoint that fetched the named children and then checked each one would be
 * one forgotten check away from a cross-tenant read; this shape has no such
 * check to forget, and the assertion below is what pins that.
 */
describe("the ?childId= selection filter", () => {
  it("narrows the register to the named children", async () => {
    const other = await createChild(a.kindergarten.id, { firstName: "Сараа" });
    await enrollChild(a.kindergarten.id, other.id, a.group.id, a.schoolYear.id);

    const res = await register(
      admin,
      a.kindergarten.id,
      `from=2026-03-02&to=2026-03-06&childId=${a.child.id}`,
    );

    const ids = res.body.items.map((r: { childId: string }) => r.childId);
    expect(ids).toEqual([a.child.id]);
    expect(ids).not.toContain(other.id);
  });

  /**
   * ★★ The discriminating case: naming another kindergarten's child returns
   * nothing rather than that child. The id is intersected with what the caller
   * may already read, so it is not a way in.
   */
  it("cannot reach another kindergarten's child by naming its id", async () => {
    const res = await register(
      admin,
      a.kindergarten.id,
      `from=2026-03-02&to=2026-03-06&childId=${b.child.id}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it("still refuses the whole register to someone who may not read it", async () => {
    const res = await register(
      teacher,
      a.kindergarten.id,
      `from=2026-03-02&to=2026-03-06&childId=${a.child.id}`,
    );

    expect(res.status).toBe(404);
  });

  /** A cap, for the same reason `MAX_REGISTER_DAYS` exists: children × days. */
  it("refuses more ids than a person picks by hand", async () => {
    const many = Array.from({ length: 201 }, () => a.child.id).join(",");

    const res = await register(
      admin,
      a.kindergarten.id,
      `from=2026-03-02&to=2026-03-06&childId=${many}`,
    );

    expect(res.status).toBe(400);
  });
});

/**
 * "Өдөр тутмын ирц" — `GET /kindergartens/:id/attendance/daily`, 2026-09-04.
 *
 * ★ The director's register: one row per group per day, counts only.
 *
 * It exists because the client said a director does not press the day sheet's
 * status buttons — "цаанаасаа бүртгэлтэй тэр нь тоонууд зэрэг нь л харагдна".
 * What these assertions protect is the arithmetic behind that sentence, and one
 * distinction in particular: `Ирц бүртгээгүй` counts the roster against what was
 * written, so it can tell "nobody filled this in" from "nobody came in". A
 * single ratio cannot, and those are the two states that matter at nine in the
 * morning.
 */
describe("GET /kindergartens/:id/attendance/daily", () => {
  function daily(
    session: AuthSession,
    kindergartenId: string,
    query = "from=2026-03-02&to=2026-03-06",
  ) {
    return authed(
      request(server()).get(`/v1/kindergartens/${kindergartenId}/attendance/daily?${query}`),
      session,
    );
  }

  it("counts the roster against what was recorded", async () => {
    const second = await createChild(a.kindergarten.id, { firstName: "Хоёрдугаар" });
    await enrollChild(a.kindergarten.id, second.id, a.group.id, a.schoolYear.id);

    await mark(a, a.enrollment.id, a.child.id, "2026-03-03", "PRESENT");

    const res = await daily(admin, a.kindergarten.id);
    expect(res.status).toBe(200);

    const row = res.body.items.find(
      (r: { groupId: string; date: string }) => r.groupId === a.group.id && r.date === "2026-03-03",
    );

    expect(row.expected).toBe(2);
    expect(row.recorded).toBe(1);
    // ★ The discriminating figure. One of two children marked is not "half
    // present" — it is a register somebody has to finish.
    expect(row.unrecorded).toBe(1);
    expect(row.complete).toBe(false);
    expect(row.present).toBe(1);
  });

  it("reports a fully recorded day as complete", async () => {
    await mark(a, a.enrollment.id, a.child.id, "2026-03-03", "SICK");

    const res = await daily(admin, a.kindergarten.id);
    const row = res.body.items.find(
      (r: { groupId: string; date: string }) => r.groupId === a.group.id && r.date === "2026-03-03",
    );

    expect(row.unrecorded).toBe(0);
    expect(row.complete).toBe(true);
    expect(row.sick).toBe(1);
  });

  /**
   * ★ A half day is a child who came — the same reading the admin dashboard
   * uses for its present figure, so the two screens cannot disagree.
   */
  it("counts a half day as present", async () => {
    await mark(a, a.enrollment.id, a.child.id, "2026-03-04", "HALF_DAY");

    const res = await daily(admin, a.kindergarten.id);
    const row = res.body.items.find(
      (r: { groupId: string; date: string }) => r.groupId === a.group.id && r.date === "2026-03-04",
    );

    expect(row.present).toBe(1);
    expect(row.absent).toBe(0);
  });

  /**
   * Who filled it in, and when it was started — the file's provenance columns.
   *
   * ★ Recorded through the real endpoint rather than the `mark` fixture above.
   *
   * That fixture writes the row straight to the database and leaves
   * `recordedById` null, which is fine for the count assertions but would make
   * this one pass for the wrong reason — or, as it did first, fail for one. The
   * name only exists because `record()` puts the actor on the row, so the test
   * has to go through `record()`.
   */
  it("names the recorder and the moment the register was started", async () => {
    const written = await authed(
      request(server()).put(`/v1/children/${a.child.id}/attendance/2026-03-05`),
      teacher,
    ).send({ status: "PRESENT" });
    expect(written.status).toBe(200);

    const res = await daily(admin, a.kindergarten.id);
    const row = res.body.items.find(
      (r: { groupId: string; date: string }) => r.groupId === a.group.id && r.date === "2026-03-05",
    );

    expect(row.createdAt).toBeTruthy();
    expect(row.createdBy).toContain(
      `${a.teacherUser.lastName ?? ""} ${a.teacherUser.firstName}`.trim(),
    );
  });

  /**
   * ★ `sentAt` is null on every row, and this test says so on purpose.
   *
   * It means "submitted to ESIS", and `docs/ESIS_API_READINESS.md` §1
   * records that access is a contract with the ministry rather than a signup.
   * Null rather than `false`: "not yet sent" and "there is no way to send" are
   * different facts. When the integration lands, this assertion is the one that
   * has to be rewritten — deliberately.
   */
  it("reports nothing as sent to ESIS, because nothing can be", async () => {
    await mark(a, a.enrollment.id, a.child.id, "2026-03-03", "PRESENT");

    const res = await daily(admin, a.kindergarten.id);
    expect(res.body.items.every((r: { sentAt: string | null }) => r.sentAt === null)).toBe(true);
  });

  it("narrows to one group", async () => {
    const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Бэлтгэл");
    const child = await createChild(a.kindergarten.id, { firstName: "Сараа" });
    await enrollChild(a.kindergarten.id, child.id, other.id, a.schoolYear.id);

    const res = await daily(
      admin,
      a.kindergarten.id,
      `from=2026-03-02&to=2026-03-06&groupId=${other.id}`,
    );

    const groupIds = new Set(res.body.items.map((r: { groupId: string }) => r.groupId));
    expect([...groupIds]).toEqual([other.id]);
  });

  it("totals the period across every row on screen", async () => {
    await mark(a, a.enrollment.id, a.child.id, "2026-03-03", "PRESENT");
    await mark(a, a.enrollment.id, a.child.id, "2026-03-04", "ABSENT");

    const res = await daily(admin, a.kindergarten.id);

    expect(res.body.totals.present).toBe(1);
    expect(res.body.totals.absent).toBe(1);
    expect(res.body.totals.days).toBe(res.body.items.length);
  });

  // ── Authorization — the same gate as the detailed register ────────────────

  it("an accountant may read it", async () => {
    const res = await daily(accountant, a.kindergarten.id);
    expect(res.status).toBe(200);
  });

  /**
   * ★ A teacher is refused, and that is not an oversight: this is a summary of
   * the kindergarten-wide figures that feed funding, and `нэмэлт.md` §13 keeps
   * teachers out of those. A summary of restricted figures is still restricted.
   */
  it("a teacher gets 404", async () => {
    const res = await daily(teacher, a.kindergarten.id);
    expect(res.status).toBe(404);
  });

  it("a parent gets 404", async () => {
    const res = await daily(parent, a.kindergarten.id);
    expect(res.status).toBe(404);
  });

  it("an admin of another kindergarten gets 404", async () => {
    const res = await daily(adminB, a.kindergarten.id);
    expect(res.status).toBe(404);
  });
});

/**
 * "Ирц илгээх" — `POST /kindergartens/:id/attendance/daily/submit`, 2026-09-04.
 *
 * ★ What a submission is, given ESIS does not exist yet.
 *
 * `docs/ESIS_API_READINESS.md` §1 records that access to ESIS is a
 * contract with the ministry rather than a signup. What this system can witness
 * today is the act — a director declaring a register final — and that is worth
 * recording on its own: it is who signed off a figure and when, the first thing
 * asked when one is disputed. The ESIS call attaches to the same row later.
 */
describe("POST /kindergartens/:id/attendance/daily/submit", () => {
  function submit(
    session: AuthSession,
    kindergartenId: string,
    entries: { groupId: string; date: string }[],
  ) {
    return authed(
      request(server()).post(`/v1/kindergartens/${kindergartenId}/attendance/daily/submit`),
      session,
    ).send({ entries });
  }

  it("records a submission for a fully recorded day", async () => {
    await mark(a, a.enrollment.id, a.child.id, "2026-03-03", "PRESENT");

    const res = await submit(admin, a.kindergarten.id, [
      { groupId: a.group.id, date: "2026-03-03" },
    ]);

    expect(res.status).toBe(201);

    const row = await db.attendanceSubmission.findFirstOrThrow({
      where: { groupId: a.group.id, deletedAt: null },
    });
    expect(row.submittedById).toBe(a.adminUser.id);
    // ★ The roster as it stood, stored rather than recomputed — a transfer next
    // week must not change what was submitted this week.
    expect(row.childCount).toBe(1);
  });

  it("shows up as Илгээсэн on the register afterwards", async () => {
    await mark(a, a.enrollment.id, a.child.id, "2026-03-03", "PRESENT");
    await submit(admin, a.kindergarten.id, [{ groupId: a.group.id, date: "2026-03-03" }]);

    const res = await authed(
      request(server()).get(
        `/v1/kindergartens/${a.kindergarten.id}/attendance/daily?from=2026-03-02&to=2026-03-06`,
      ),
      admin,
    );

    const row = res.body.items.find(
      (r: { groupId: string; date: string }) => r.groupId === a.group.id && r.date === "2026-03-03",
    );
    expect(row.sentAt).toBeTruthy();
    expect(row.sentBy).toBeTruthy();
    expect(res.body.totals.sent).toBe(1);
  });

  /**
   * ★ The discriminating case, and the one this endpoint most needs to refuse.
   *
   * A day with children still unmarked is an unfinished register, and the
   * figure it produces feeds a funding claim. The error names which group and
   * which date so a director knows who to chase — a generic 400 would not.
   */
  it("refuses an incomplete register and names it", async () => {
    const second = await createChild(a.kindergarten.id, { firstName: "Хоёрдугаар" });
    await enrollChild(a.kindergarten.id, second.id, a.group.id, a.schoolYear.id);
    await mark(a, a.enrollment.id, a.child.id, "2026-03-03", "PRESENT");

    const res = await submit(admin, a.kindergarten.id, [
      { groupId: a.group.id, date: "2026-03-03" },
    ]);

    expect(res.status).toBe(400);
    expect(res.body.detail ?? res.body.title).toContain(a.group.name);
    expect(await db.attendanceSubmission.count()).toBe(0);
  });

  /** Pressing the button twice is not a mistake — the register was corrected. */
  it("re-submitting updates the existing row rather than duplicating", async () => {
    await mark(a, a.enrollment.id, a.child.id, "2026-03-03", "PRESENT");

    await submit(admin, a.kindergarten.id, [{ groupId: a.group.id, date: "2026-03-03" }]);
    const again = await submit(admin, a.kindergarten.id, [
      { groupId: a.group.id, date: "2026-03-03" },
    ]);

    expect(again.status).toBe(201);
    expect(await db.attendanceSubmission.count({ where: { deletedAt: null } })).toBe(1);
  });

  /** A group-day outside this kindergarten is skipped, never submitted. */
  it("cannot submit another kindergarten's group", async () => {
    const res = await submit(admin, a.kindergarten.id, [
      { groupId: b.group.id, date: "2026-03-03" },
    ]);

    expect(res.status).toBe(400);
    expect(await db.attendanceSubmission.count()).toBe(0);
  });

  it("a teacher gets 404", async () => {
    await mark(a, a.enrollment.id, a.child.id, "2026-03-03", "PRESENT");
    const res = await submit(teacher, a.kindergarten.id, [
      { groupId: a.group.id, date: "2026-03-03" },
    ]);
    expect(res.status).toBe(404);
  });

  it("an admin of another kindergarten gets 404", async () => {
    await mark(a, a.enrollment.id, a.child.id, "2026-03-03", "PRESENT");
    const res = await submit(adminB, a.kindergarten.id, [
      { groupId: a.group.id, date: "2026-03-03" },
    ]);
    expect(res.status).toBe(404);
  });

  it("records one audit row for the batch, not one per day", async () => {
    await mark(a, a.enrollment.id, a.child.id, "2026-03-03", "PRESENT");
    await mark(a, a.enrollment.id, a.child.id, "2026-03-04", "PRESENT");

    await submit(admin, a.kindergarten.id, [
      { groupId: a.group.id, date: "2026-03-03" },
      { groupId: a.group.id, date: "2026-03-04" },
    ]);

    const rows = await db.auditLog.findMany({ where: { objectType: "AttendanceSubmission" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toMatchObject({ count: 2 });
  });
});

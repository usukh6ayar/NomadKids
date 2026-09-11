import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
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
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { StorageService } from "../src/storage/storage.service";

/**
 * The weekly menu — RFP §989, kindergarten-wide — and the meal register,
 * `нэмэлт.md` §2, which is per child: whether they ate. The two are separate
 * models on purpose (`MealRecord` is not derived from `Attendance`) — see the
 * schema's own note on why "present" does not imply "fed".
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let teacherA: AuthSession;
let parentA: AuthSession;
let parentB: AuthSession;
let cookA: AuthSession;
let adminA: AuthSession;
let storageAvailable = true;

beforeAll(async () => {
  app = await createTestApp();
  storageAvailable = await app.get(StorageService).isReachable();
  if (!storageAvailable) {
    console.error(
      "\n⚠ MinIO unreachable — dish-photo tests will FAIL.\n  docker compose up -d storage\n",
    );
  }
  // The default hook timeout (10s) is tight for booting the whole Nest app on
  // a cold run — every other suite that does the same extends it the same way.
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
  parentB = await login(app, b.parentUser.username);

  const cookUser = await createUser({
    username: `cook-${Math.random().toString(36).slice(2, 8)}`,
  });
  await createMembership(cookUser.id, a.kindergarten.id, "COOK");
  cookA = await login(app, cookUser.username);
  adminA = await login(app, a.adminUser.username);
});

const server = () => app.getHttpServer();

/** Uploads a dish photo for kindergarten A and returns its media id. */
async function uploadDishPhoto(session: AuthSession, kindergartenId = a.kindergarten.id) {
  const bytes = await sharp({ create: { width: 48, height: 36, channels: 3, background: "green" } })
    .jpeg()
    .toBuffer();
  const res = await authed(
    request(server()).post(`/v1/kindergartens/${kindergartenId}/menu/dish-photo`),
    session,
  ).attach("file", bytes, "хоол.jpg");
  if (res.status !== 201) throw new Error(`dish-photo upload failed: ${res.status} ${res.text}`);
  return res.body.id as string;
}

describe("saving a day", () => {
  it("a teacher saves the menu for a day", async () => {
    const res = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [{ name: "Будаатай шөл", allergenTags: ["сүү"] }] });

    expect(res.status).toBe(200);

    const row = await db.menuDay.findFirstOrThrow({
      where: { kindergartenId: a.kindergarten.id },
    });
    expect(row.dishes).toEqual([{ name: "Будаатай шөл", allergenTags: ["сүү"] }]);
    expect(row.createdById).toBe(a.teacherUser.id);
  });

  it("a second PUT for the same day updates rather than duplicates", async () => {
    await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [{ name: "Шөл", allergenTags: [] }] });

    await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [{ name: "Хуурга", allergenTags: ["самар"] }] });

    const rows = await db.menuDay.findMany({ where: { kindergartenId: a.kindergarten.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dishes).toEqual([{ name: "Хуурга", allergenTags: ["самар"] }]);
  });

  it("a parent cannot save the menu", async () => {
    const res = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      parentA,
    ).send({ dishes: [{ name: "x", allergenTags: [] }] });

    // The coarse @Roles("TEACHER", "ADMIN") gate — 404, never 403.
    expect(res.status).toBe(404);
  });

  it("a teacher saves the day's total calories alongside the dishes", async () => {
    const res = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [{ name: "Будаатай шөл", allergenTags: [] }], totalCalories: 620 });

    expect(res.status).toBe(200);
    const row = await db.menuDay.findFirstOrThrow({
      where: { kindergartenId: a.kindergarten.id },
    });
    expect(row.totalCalories).toBe(620);
  });

  it("totalCalories is optional and stays null when omitted", async () => {
    const res = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [{ name: "Будаатай шөл", allergenTags: [] }] });

    expect(res.status).toBe(200);
    const row = await db.menuDay.findFirstOrThrow({
      where: { kindergartenId: a.kindergarten.id },
    });
    expect(row.totalCalories).toBeNull();
  });

  it("saves a dish's meal-time, calories and portions alongside its name", async () => {
    const res = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({
      dishes: [
        {
          name: "Сүүтэй будаа",
          allergenTags: ["сүү"],
          kind: "BREAKFAST",
          calories: 230,
          portions: 1,
        },
      ],
    });

    expect(res.status).toBe(200);
    const row = await db.menuDay.findFirstOrThrow({
      where: { kindergartenId: a.kindergarten.id },
    });
    expect(row.dishes).toEqual([
      {
        name: "Сүүтэй будаа",
        allergenTags: ["сүү"],
        kind: "BREAKFAST",
        calories: 230,
        portions: 1,
      },
    ]);
  });

  it("saves a dish's photo, and the id round-trips on read", async () => {
    if (!storageAvailable) return;

    const mediaId = await uploadDishPhoto(teacherA);
    const res = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [{ name: "Хуушуур", allergenTags: [], photoMediaFileId: mediaId }] });

    expect(res.status).toBe(200);
    const row = await db.menuDay.findFirstOrThrow({
      where: { kindergartenId: a.kindergarten.id },
    });
    expect((row.dishes as { photoMediaFileId?: string }[])[0]?.photoMediaFileId).toBe(mediaId);

    // And it is readable by anyone in the kindergarten — a dish photo is on
    // the plain menu, not staff-only.
    const download = await authed(request(server()).get(`/v1/media/${mediaId}`), parentA);
    expect(download.status).toBe(302);
  });

  it("refuses a photoMediaFileId that is not this kindergarten's own MENU_DISH upload", async () => {
    if (!storageAvailable) return;

    // A real upload, but for kindergarten B.
    const teacherB = await login(app, b.teacherUser.username);
    const foreignMediaId = await uploadDishPhoto(teacherB, b.kindergarten.id);

    const res = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [{ name: "Хуушуур", allergenTags: [], photoMediaFileId: foreignMediaId }] });

    expect(res.status).toBe(400);
    expect(await db.menuDay.count({ where: { kindergartenId: a.kindergarten.id } })).toBe(0);
  });

  it("a parent cannot upload a dish photo", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/menu/dish-photo`),
      parentA,
    ).attach("file", Buffer.from("not an image"), "x.jpg");
    expect(res.status).toBe(404);
  });

  it("rejects a negative or implausibly large per-dish calories", async () => {
    const res = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [{ name: "x", allergenTags: [], calories: -5 }] });
    expect(res.status).toBe(400);
  });

  it("rejects a negative or implausibly large totalCalories", async () => {
    const negative = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [], totalCalories: -10 });
    expect(negative.status).toBe(400);

    const tooLarge = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [], totalCalories: 50_000 });
    expect(tooLarge.status).toBe(400);
  });
});

describe("reading", () => {
  it("a parent reads their own kindergarten's menu", async () => {
    await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [{ name: "Будаатай шөл", allergenTags: ["сүү"] }] });

    const res = await authed(
      request(server()).get(
        `/v1/kindergartens/${a.kindergarten.id}/menu?from=2026-03-01&to=2026-03-07`,
      ),
      parentA,
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].dishes[0].name).toBe("Будаатай шөл");
  });

  it("a parent reads the day's total calories too", async () => {
    await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({ dishes: [{ name: "Будаатай шөл", allergenTags: [] }], totalCalories: 450 });

    const res = await authed(
      request(server()).get(
        `/v1/kindergartens/${a.kindergarten.id}/menu?from=2026-03-01&to=2026-03-07`,
      ),
      parentA,
    );

    expect(res.status).toBe(200);
    expect(res.body[0].totalCalories).toBe(450);
  });
});

describe("isolation", () => {
  it("a parent from another kindergarten gets 404 reading the menu", async () => {
    const res = await authed(
      request(server()).get(
        `/v1/kindergartens/${a.kindergarten.id}/menu?from=2026-03-01&to=2026-03-07`,
      ),
      parentB,
    );
    expect(res.status).toBe(404);
  });

  it("a teacher from another kindergarten gets 404 saving the menu", async () => {
    const res = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      await login(app, b.teacherUser.username),
    ).send({ dishes: [{ name: "x", allergenTags: [] }] });

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Excel export — client request, 2026-09-05
// ═══════════════════════════════════════════════════════════════════════════

describe("exporting to Excel", () => {
  async function fetchWorkbook(session: AuthSession, from: string, to: string) {
    const res = await authed(
      request(server()).get(
        `/v1/kindergartens/${a.kindergarten.id}/menu/export?from=${from}&to=${to}`,
      ),
      session,
    )
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    return res;
  }

  it("a saved day's dish appears in the downloaded file, not just 'a file'", async () => {
    const saved = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
      teacherA,
    ).send({
      // `portions` caps at 10 (`menuDishInputSchema`) — it is not a headcount.
      dishes: [
        {
          name: "Будаатай шөл",
          allergenTags: ["сүү"],
          kind: "LUNCH",
          calories: 320,
          portions: 4,
        },
      ],
    });
    expect(saved.status).toBe(200);

    // Narrowed to exactly the saved day: exportMenu now fills every date in
    // the range with a row (see the next test), so a wider range would push
    // this dish past row 2 with an unplanned-day placeholder ahead of it.
    const res = await fetchWorkbook(teacherA, "2026-03-02", "2026-03-02");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");

    const ExcelJS = (await import("exceljs")).default;
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.body);
    const sheet = book.getWorksheet("Хоолны цэс")!;

    // `sheet.columns`'s `key` is an in-memory ExcelJS convenience that does not
    // round-trip through the xlsx format — `Row.getCell` on a *reloaded*
    // workbook needs the spreadsheet letter (or 1-based index), not the key
    // the columns were defined with. A=date, C=kind, D=name, E=portions,
    // F=calories, G=allergenTags, per `menu-workbook.ts`'s column order.
    const row = sheet.getRow(2);
    expect(row.getCell("A").text).toBe("2026-03-02");
    expect(row.getCell("C").text).toBe("Өдрийн хоол");
    expect(row.getCell("D").text).toBe("Будаатай шөл");
    expect(row.getCell("E").text).toBe("4");
    expect(row.getCell("F").text).toBe("320");
    expect(row.getCell("G").text).toBe("сүү");
  });

  it("a day nobody planned still gets a row saying so, rather than a silent gap", async () => {
    const res = await fetchWorkbook(teacherA, "2026-05-04", "2026-05-04");
    expect(res.status).toBe(200);

    const ExcelJS = (await import("exceljs")).default;
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.body);
    const row = book.getWorksheet("Хоолны цэс")!.getRow(2);
    expect(row.getCell("D").text).toBe("Цэс төлөвлөгдөөгүй");
  });

  it("a guardian gets 404 — same restriction as the on-screen warnings view", async () => {
    const res = await fetchWorkbook(parentA, "2026-03-01", "2026-03-07");
    expect(res.status).toBe(404);
  });

  it("a teacher from another kindergarten gets 404", async () => {
    const res = await fetchWorkbook(
      await login(app, b.teacherUser.username),
      "2026-03-01",
      "2026-03-07",
    );
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The meal register — нэмэлт.md §2
// ═══════════════════════════════════════════════════════════════════════════

describe("the meal register", () => {
  it("a teacher marks a whole sitting in one request", async () => {
    const res = await authed(
      request(server()).put(`/v1/groups/${a.group.id}/meals`),
      teacherA,
    ).send({
      date: "2026-03-02",
      kind: "LUNCH",
      entries: [{ childId: a.child.id, status: "TAKEN" }],
    });

    expect(res.status).toBe(200);
    const row = await db.mealRecord.findFirstOrThrow({ where: { childId: a.child.id } });
    expect(row).toMatchObject({
      enrollmentId: a.enrollment.id,
      kind: "LUNCH",
      status: "TAKEN",
      recordedById: a.teacherUser.id,
    });
  });

  it("a second PUT for the same sitting updates rather than duplicates", async () => {
    const record = () =>
      authed(request(server()).put(`/v1/groups/${a.group.id}/meals`), teacherA).send({
        date: "2026-03-02",
        kind: "LUNCH",
        entries: [{ childId: a.child.id, status: "TAKEN" }],
      });

    await record();
    await authed(request(server()).put(`/v1/groups/${a.group.id}/meals`), teacherA).send({
      date: "2026-03-02",
      kind: "LUNCH",
      entries: [{ childId: a.child.id, status: "NOT_TAKEN" }],
    });

    const rows = await db.mealRecord.findMany({ where: { childId: a.child.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("NOT_TAKEN");
  });

  it("the group sheet lists every enrolled child, marked or not", async () => {
    const second = await createChild(a.kindergarten.id, { firstName: "Хоёр" });
    await enrollChild(a.kindergarten.id, second.id, a.group.id, a.schoolYear.id);

    await authed(request(server()).put(`/v1/groups/${a.group.id}/meals`), teacherA).send({
      date: "2026-03-02",
      kind: "BREAKFAST",
      entries: [{ childId: a.child.id, status: "PARTIAL" }],
    });

    const res = await authed(
      request(server()).get(`/v1/groups/${a.group.id}/meals?date=2026-03-02&kind=BREAKFAST`),
      teacherA,
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const marked = res.body.find((e: { child: { id: string } }) => e.child.id === a.child.id);
    const unmarked = res.body.find((e: { child: { id: string } }) => e.child.id === second.id);
    expect(marked.record.status).toBe("PARTIAL");
    expect(unmarked.record).toBeNull();
  });

  it("a child not enrolled in the group is dropped, not an error", async () => {
    const elsewhere = await createChild(a.kindergarten.id, { firstName: "Өөр" });

    const res = await authed(
      request(server()).put(`/v1/groups/${a.group.id}/meals`),
      teacherA,
    ).send({
      date: "2026-03-02",
      kind: "LUNCH",
      entries: [
        { childId: a.child.id, status: "TAKEN" },
        { childId: elsewhere.id, status: "TAKEN" },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const count = await db.mealRecord.count();
    expect(count).toBe(1);
  });

  it("a child's month counts by sitting and status", async () => {
    await authed(request(server()).put(`/v1/groups/${a.group.id}/meals`), teacherA).send({
      date: "2026-03-02",
      kind: "LUNCH",
      entries: [{ childId: a.child.id, status: "TAKEN" }],
    });
    await authed(request(server()).put(`/v1/groups/${a.group.id}/meals`), teacherA).send({
      date: "2026-03-03",
      kind: "LUNCH",
      entries: [{ childId: a.child.id, status: "NOT_TAKEN" }],
    });

    const res = await authed(
      request(server()).get(`/v1/children/${a.child.id}/meals/summary?month=2026-03`),
      parentA,
    );

    expect(res.status).toBe(200);
    expect(res.body.daysFed).toBe(1);
    expect(res.body.counts).toEqual(
      expect.arrayContaining([
        { kind: "LUNCH", status: "TAKEN", count: 1 },
        { kind: "LUNCH", status: "NOT_TAKEN", count: 1 },
      ]),
    );
  });

  describe("isolation", () => {
    it("a parent cannot record the register", async () => {
      const res = await authed(
        request(server()).put(`/v1/groups/${a.group.id}/meals`),
        parentA,
      ).send({
        date: "2026-03-02",
        kind: "LUNCH",
        entries: [{ childId: a.child.id, status: "TAKEN" }],
      });

      expect(res.status).toBe(404);
    });

    /**
     * `GroupMealsController` is `@Roles("TEACHER","ADMIN")` — COOK is excluded
     * on purpose (`assertStaff`, not `assertCanManageMeals`): this register
     * names individual children and what each one ate, which is child data a
     * cook has no route to anywhere else in the system either. Asserted
     * explicitly rather than left as an absence, per the audit that found this
     * controller had no COOK case in either direction.
     */
    it("a cook gets 404 on both the group register and its sheet — this is child data, not the kitchen's", async () => {
      const write = await authed(
        request(server()).put(`/v1/groups/${a.group.id}/meals`),
        cookA,
      ).send({
        date: "2026-03-02",
        kind: "LUNCH",
        entries: [{ childId: a.child.id, status: "TAKEN" }],
      });
      expect(write.status).toBe(404);

      const read = await authed(
        request(server()).get(`/v1/groups/${a.group.id}/meals?date=2026-03-02&kind=LUNCH`),
        cookA,
      );
      expect(read.status).toBe(404);
    });

    it("a teacher assigned to a different group in the same kindergarten gets 404", async () => {
      const other = await createGroup(a.kindergarten.id, a.schoolYear.id, "Өөр бүлэг");
      const child = await createChild(a.kindergarten.id, { firstName: "Хол" });
      await enrollChild(a.kindergarten.id, child.id, other.id, a.schoolYear.id);

      const res = await authed(
        request(server()).get(`/v1/groups/${other.id}/meals?date=2026-03-02&kind=LUNCH`),
        teacherA,
      );

      expect(res.status).toBe(404);
    });

    it("a teacher from another kindergarten gets 404", async () => {
      const res = await authed(
        request(server()).put(`/v1/groups/${a.group.id}/meals`),
        await login(app, b.teacherUser.username),
      ).send({
        date: "2026-03-02",
        kind: "LUNCH",
        entries: [{ childId: a.child.id, status: "TAKEN" }],
      });

      expect(res.status).toBe(404);
    });

    it("a guardian of another child gets 404 on the meal summary", async () => {
      const res = await authed(
        request(server()).get(`/v1/children/${a.child.id}/meals/summary?month=2026-03`),
        parentB,
      );
      expect(res.status).toBe(404);
    });
  });

  /*
    A family's note about their child's meals — the client's 2026-09-11 design.

    ★ The one write in the product a guardian is the *intended* author of, so
    these cases are about the opposite risk from usual: not "can a parent do a
    teacher's job" but "does the parent-authored write still stop at their own
    child".
  */
  describe("a family's meal notes", () => {
    const NOTE = { date: "2026-03-04", body: "Сүүн бүтээгдэхүүн өгч болохгүй." };

    it("a guardian writes one and reads it back", async () => {
      const created = await authed(
        request(server()).post(`/v1/children/${a.child.id}/meals/notes`),
        parentA,
      ).send(NOTE);

      expect(created.status).toBe(201);
      expect(created.body.body).toBe(NOTE.body);
      expect(created.body.date).toBe("2026-03-04");

      const read = await authed(
        request(server()).get(
          `/v1/children/${a.child.id}/meals/notes?from=2026-03-01&to=2026-03-31`,
        ),
        parentA,
      );
      expect(read.status).toBe(200);
      expect(read.body).toHaveLength(1);
    });

    /** The point of the note: the kitchen and the teacher have to see it. */
    it("the child's teacher reads it", async () => {
      await authed(request(server()).post(`/v1/children/${a.child.id}/meals/notes`), parentA).send(
        NOTE,
      );

      const res = await authed(
        request(server()).get(
          `/v1/children/${a.child.id}/meals/notes?from=2026-03-01&to=2026-03-31`,
        ),
        teacherA,
      );
      expect(res.status).toBe(200);
      expect(res.body[0].body).toBe(NOTE.body);
    });

    it("★ a guardian of another child gets 404 writing one", async () => {
      const res = await authed(
        request(server()).post(`/v1/children/${a.child.id}/meals/notes`),
        parentB,
      ).send(NOTE);

      expect(res.status).toBe(404);
    });

    it("★ a guardian of another child gets 404 reading them", async () => {
      await authed(request(server()).post(`/v1/children/${a.child.id}/meals/notes`), parentA).send(
        NOTE,
      );

      const res = await authed(
        request(server()).get(
          `/v1/children/${a.child.id}/meals/notes?from=2026-03-01&to=2026-03-31`,
        ),
        parentB,
      );

      // 404, not an empty list — an empty list would say the child exists.
      expect(res.status).toBe(404);
    });

    it("★ a teacher from another kindergarten gets 404", async () => {
      const teacherB = await login(app, b.teacherUser.username);

      const res = await authed(
        request(server()).get(
          `/v1/children/${a.child.id}/meals/notes?from=2026-03-01&to=2026-03-31`,
        ),
        teacherB,
      );
      expect(res.status).toBe(404);
    });

    it("refuses an empty note", async () => {
      const res = await authed(
        request(server()).post(`/v1/children/${a.child.id}/meals/notes`),
        parentA,
      ).send({ date: "2026-03-04", body: "   " });

      expect(res.status).toBe(400);
    });

    /** The counter on screen is a courtesy; this is the limit. */
    it("refuses a note over 500 characters", async () => {
      const res = await authed(
        request(server()).post(`/v1/children/${a.child.id}/meals/notes`),
        parentA,
      ).send({ date: "2026-03-04", body: "х".repeat(501) });

      expect(res.status).toBe(400);
    });

    it("keeps a second note rather than replacing the first", async () => {
      await authed(request(server()).post(`/v1/children/${a.child.id}/meals/notes`), parentA).send(
        NOTE,
      );
      await authed(request(server()).post(`/v1/children/${a.child.id}/meals/notes`), parentA).send({
        ...NOTE,
        body: "Өнөөдөр хоолны дуршил муутай байна.",
      });

      const res = await authed(
        request(server()).get(
          `/v1/children/${a.child.id}/meals/notes?from=2026-03-01&to=2026-03-31`,
        ),
        parentA,
      );
      expect(res.body).toHaveLength(2);
    });

    it("returns only the days asked for", async () => {
      await authed(request(server()).post(`/v1/children/${a.child.id}/meals/notes`), parentA).send(
        NOTE,
      );

      const res = await authed(
        request(server()).get(
          `/v1/children/${a.child.id}/meals/notes?from=2026-04-01&to=2026-04-30`,
        ),
        parentA,
      );
      expect(res.body).toEqual([]);
    });
  });

  /*
    The weekly menu from a spreadsheet — the client's 2026-09-11 request, and
    the role narrowing that came with it.

    ★ `assertCanEditMenu` (COOK/TEACHER) is new and *narrower* than
    `assertCanManageMeals` (COOK/TEACHER/ADMIN), which still guards reading. The
    client's line: "Багш болон тогооч засаж болдог … нягтлан, удирдлага, эцэг эх
    оруулсан цэсүүдийг зүгээр харна."
  */
  describe("the menu as a spreadsheet", () => {
    /** A workbook in the shape `/menu/export` writes. */
    async function workbook(rows: (string | number)[][]) {
      const ExcelJS = (await import("exceljs")).default;
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet("Хоолны цэс");
      sheet.addRow([
        "Огноо",
        "Гараг",
        "Хоолны цаг",
        "Хоолны нэр",
        "Порц",
        "Ккал",
        "Харшлын шошго",
        "Тэмдэглэл",
      ]);
      for (const row of rows) sheet.addRow(row);
      return Buffer.from(await book.xlsx.writeBuffer());
    }

    const ONE_DAY = [
      ["2026-03-02", "Даваа", "Өглөөний цай", "Тараг", 1, 120, "сүү", ""],
      ["2026-03-02", "Даваа", "Өдрийн хоол", "Гурилтай шөл", 1, 320, "", "Халуун"],
    ];

    function post(session: AuthSession, file: Buffer, query = "") {
      return authed(
        request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/menu/import${query}`),
        session,
      ).attach("file", file, "menu.xlsx");
    }

    it("a cook uploads a week and it is a dry run by default", async () => {
      const res = await post(cookA, await workbook(ONE_DAY));

      expect(res.status).toBe(201);
      expect(res.body.dryRun).toBe(true);
      expect(res.body.dishCount).toBe(2);
      expect(res.body.days).toEqual([{ date: "2026-03-02", dishes: 2 }]);

      // ★ Nothing written. An import that writes on the first click is one
      // misplaced press away from erasing a week.
      expect(await db.menuDay.count({ where: { kindergartenId: a.kindergarten.id } })).toBe(0);
    });

    it("writes when the dry run is turned off", async () => {
      const res = await post(cookA, await workbook(ONE_DAY), "?dryRun=false");

      expect(res.status).toBe(201);
      expect(res.body.dryRun).toBe(false);

      const day = await db.menuDay.findFirstOrThrow({
        where: { kindergartenId: a.kindergarten.id },
      });
      const dishes = day.dishes as { name: string; kind: string | null; calories: number }[];
      expect(dishes.map((dish) => dish.name)).toEqual(["Тараг", "Гурилтай шөл"]);
      expect(dishes[0]!.kind).toBe("BREAKFAST");
      expect(dishes[1]!.calories).toBe(320);
    });

    it("a teacher may import too", async () => {
      const res = await post(teacherA, await workbook(ONE_DAY), "?dryRun=false");
      expect(res.status).toBe(201);
    });

    /*
      ★ The narrowing, asserted from both sides: an admin may still read the
      menu and may no longer write it.
    */
    it("★ an admin can no longer import or save the menu", async () => {
      const imported = await post(adminA, await workbook(ONE_DAY));
      // 404, not 403 — §1.7's rule reaches the role guard too.
      expect(imported.status).toBe(404);

      const saved = await authed(
        request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-03-02`),
        adminA,
      ).send({ dishes: [{ name: "Шөл", allergenTags: [] }] });
      expect(saved.status).toBe(404);
    });

    it("★ an admin still reads the menu", async () => {
      await post(cookA, await workbook(ONE_DAY), "?dryRun=false");

      const res = await authed(
        request(server()).get(
          `/v1/kindergartens/${a.kindergarten.id}/menu?from=2026-03-01&to=2026-03-07`,
        ),
        adminA,
      );
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it("★ a parent cannot import", async () => {
      const res = await post(parentA, await workbook(ONE_DAY));
      expect(res.status).toBe(404);
    });

    it("★ a cook from another kindergarten gets 404", async () => {
      const outsider = await createUser({
        username: `cook-b-${Math.random().toString(36).slice(2, 8)}`,
      });
      await createMembership(outsider.id, b.kindergarten.id, "COOK");
      const cookB = await login(app, outsider.username);

      const res = await post(cookB, await workbook(ONE_DAY));
      expect(res.status).toBe(404);
    });

    /** Replaces the day, so deleting a name in Excel deletes the dish. */
    it("replaces a day rather than appending to it", async () => {
      await post(cookA, await workbook(ONE_DAY), "?dryRun=false");
      await post(
        cookA,
        await workbook([["2026-03-02", "Даваа", "Өглөөний цай", "Будаа", 1, 200, "", ""]]),
        "?dryRun=false",
      );

      const day = await db.menuDay.findFirstOrThrow({
        where: { kindergartenId: a.kindergarten.id },
      });
      expect((day.dishes as { name: string }[]).map((dish) => dish.name)).toEqual(["Будаа"]);
    });

    /*
      ★ A day named with no dish empties it. That is how a week is cleared, and
      without it the import could only ever add.
    */
    it("empties a day whose dishes were deleted in the spreadsheet", async () => {
      await post(cookA, await workbook(ONE_DAY), "?dryRun=false");
      await post(
        cookA,
        await workbook([["2026-03-02", "Даваа", "", "", "", "", "", ""]]),
        "?dryRun=false",
      );

      const day = await db.menuDay.findFirstOrThrow({
        where: { kindergartenId: a.kindergarten.id },
      });
      expect(day.dishes).toEqual([]);
    });

    /** One bad row must not discard the good ones. */
    it("reports a bad row and keeps the rest", async () => {
      const res = await post(
        cookA,
        await workbook([
          ["2026-03-02", "Даваа", "Өглөөний цай", "Тараг", 1, 120, "", ""],
          ["огноо биш", "", "Өглөөний цай", "Талх", 1, 90, "", ""],
          ["2026-03-03", "Мягмар", "Ийм цаг байхгүй", "Будаа", 1, 200, "", ""],
        ]),
      );

      expect(res.status).toBe(201);
      expect(res.body.dishCount).toBe(1);
      expect(res.body.problems).toHaveLength(2);
    });

    it("refuses a file that is not a workbook", async () => {
      const res = await post(cookA, Buffer.from("Энэ бол excel биш"));
      expect(res.status).toBe(400);
    });

    it("says which column is missing rather than importing nothing quietly", async () => {
      const ExcelJS = (await import("exceljs")).default;
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet("Хоолны цэс");
      sheet.addRow(["Гараг", "Хоолны цаг"]);
      const file = Buffer.from(await book.xlsx.writeBuffer());

      const res = await post(cookA, file);
      expect(res.status).toBe(201);
      expect(res.body.problems[0].message).toContain("Огноо");
    });

    /*
      ★ A consumed day is refused, not skipped silently — the stock ledger was
      written against that plan.
    */
    it("refuses to overwrite a day already consumed", async () => {
      await post(cookA, await workbook(ONE_DAY), "?dryRun=false");
      await db.menuDay.updateMany({
        where: { kindergartenId: a.kindergarten.id },
        data: { consumedAt: new Date() },
      });

      const res = await post(
        cookA,
        await workbook([["2026-03-02", "Даваа", "Өглөөний цай", "Өөр хоол", 1, 100, "", ""]]),
        "?dryRun=false",
      );

      expect(res.status).toBe(201);
      expect(res.body.dishCount).toBe(0);
      expect(res.body.problems[0].message).toContain("хэрэглээнд бүртгэсэн");

      const day = await db.menuDay.findFirstOrThrow({
        where: { kindergartenId: a.kindergarten.id },
      });
      expect((day.dishes as { name: string }[])[0]!.name).toBe("Тараг");
    });
  });
});

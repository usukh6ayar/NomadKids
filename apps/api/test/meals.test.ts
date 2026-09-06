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
  createScenario,
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
    const res = await fetchWorkbook(await login(app, b.teacherUser.username), "2026-03-01", "2026-03-07");
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
});

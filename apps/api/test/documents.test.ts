import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
import { authed, createScenario, login, type AuthSession, type Scenario } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";
import { StorageService } from "../src/storage/storage.service";

/**
 * The document library — RFP §9.
 *
 * The behaviour worth pinning: it is **staff-only on reading**, not just on
 * writing. §9 opens with "Багшид зориулсан PDF баримт бичгийн сан" — curricula
 * and methodology are professional material, and the obvious implementation
 * (reuse the tenant-image branch of `/media/:id`, which uses `assertMember`)
 * would have opened every document to every parent.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let teacherA: AuthSession;
let adminA: AuthSession;
let parentA: AuthSession;

const server = () => app.getHttpServer();

const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "latin1");

beforeAll(async () => {
  app = await createTestApp();
  if (!(await app.get(StorageService).isReachable())) {
    console.error("\n⚠ MinIO unreachable — document tests will FAIL.\n");
  }
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  teacherA = await login(app, a.teacherUser.username);
  adminA = await login(app, a.adminUser.username);
  parentA = await login(app, a.parentUser.username);
});

async function publish(session = teacherA, fields: Record<string, string> = {}) {
  const req = authed(
    request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/documents`),
    session,
  ).field("title", fields.title ?? "Хөтөлбөр 2026");

  for (const [key, value] of Object.entries(fields)) {
    if (key !== "title") void req.field(key, value);
  }

  return req.attach("file", PDF, "хөтөлбөр.pdf");
}

// ═══════════════════════════════════════════════════════════════════════════
// Authorization — CLAUDE.md §4.1
// ═══════════════════════════════════════════════════════════════════════════

describe("authorization", () => {
  /**
   * ★ The rule this whole feature turns on. A parent must not reach the
   * library at all — not the list, and not the file behind it.
   */
  it("a guardian cannot list the library", async () => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/documents`),
      parentA,
    );
    expect(res.status).toBe(404);
  });

  it("a guardian cannot fetch a document's file through /media/:id", async () => {
    const created = await publish();
    expect(created.status).toBe(201);

    const document = await db.document.findUniqueOrThrow({ where: { id: created.body.id } });

    // The teacher who published it can.
    expect(
      (await authed(request(server()).get(`/v1/media/${document.fileMediaFileId}`), teacherA))
        .status,
    ).toBe(302);

    // The family cannot — this is the case that would have leaked had documents
    // reused the tenant-image branch, which authorises by membership.
    expect(
      (await authed(request(server()).get(`/v1/media/${document.fileMediaFileId}`), parentA))
        .status,
    ).toBe(404);
  });

  it("a teacher from another kindergarten gets 404", async () => {
    const teacherB = await login(app, b.teacherUser.username);
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/documents`),
      teacherB,
    );
    expect(res.status).toBe(404);
  });

  it("a teacher from another kindergarten cannot edit one", async () => {
    const created = await publish();
    const teacherB = await login(app, b.teacherUser.username);

    const res = await authed(
      request(server()).patch(`/v1/documents/${created.body.id}`),
      teacherB,
    ).send({ title: "Хулгайлсан" });
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Publishing — RFP §9
// ═══════════════════════════════════════════════════════════════════════════

describe("publishing", () => {
  it("stores the PDF and its metadata", async () => {
    const res = await publish(teacherA, {
      title: "Сургалтын хөтөлбөр",
      category: "Хөтөлбөр",
      version: "2026.1",
      description: "Жилийн сургалтын төлөвлөгөө.",
    });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Сургалтын хөтөлбөр");
    expect(res.body.version).toBe("2026.1");
    expect(res.body.publishedBy.id).toBe(a.teacherUser.id);
  });

  /** CLAUDE.md §1.6 — content, never the extension. */
  it("rejects an executable renamed to .pdf", async () => {
    const machO = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, ...Array(64).fill(0)]);
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/documents`),
      teacherA,
    )
      .field("title", "Хортой")
      .attach("file", machO, "хөтөлбөр.pdf");

    expect(res.status).toBe(400);
    expect(await db.document.count()).toBe(0);
  });

  it("rejects an image renamed to .pdf", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } })
      .png()
      .toBuffer();

    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/documents`),
      teacherA,
    )
      .field("title", "Зураг")
      .attach("file", png, "хөтөлбөр.pdf");

    expect(res.status).toBe(400);
  });

  it("refuses a document with no file", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/documents`),
      teacherA,
    ).field("title", "Файлгүй");

    expect(res.status).toBe(400);
  });

  it("accepts a cover image alongside the PDF", async () => {
    const cover = await sharp({
      create: { width: 20, height: 28, channels: 3, background: "teal" },
    })
      .jpeg()
      .toBuffer();

    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/documents`),
      teacherA,
    )
      .field("title", "Нүүртэй")
      .attach("file", PDF, "хөтөлбөр.pdf")
      .attach("cover", cover, "нүүр.jpg");

    expect(res.status).toBe(201);
    expect(res.body.coverMediaFileId).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Finding — RFP §9's "Ангиллаар шүүх", "Нэрээр хайх"
// ═══════════════════════════════════════════════════════════════════════════

describe("finding", () => {
  it("filters by category and searches by name", async () => {
    await publish(teacherA, { title: "Хөгжлийн хөтөлбөр", category: "Хөтөлбөр" });
    await publish(teacherA, { title: "Дотоод журам", category: "Журам" });

    const byCategory = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/documents?category=Журам`),
      teacherA,
    );
    expect(byCategory.body.items).toHaveLength(1);
    expect(byCategory.body.items[0].title).toBe("Дотоод журам");

    const bySearch = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/documents?q=хөгжл`),
      teacherA,
    );
    expect(bySearch.body.items).toHaveLength(1);
  });

  it("lists the categories in use", async () => {
    await publish(teacherA, { title: "A", category: "Хөтөлбөр" });
    await publish(teacherA, { title: "B", category: "Журам" });
    await publish(teacherA, { title: "C", category: "Хөтөлбөр" });

    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/documents/categories`),
      teacherA,
    );
    expect(res.body).toEqual(["Журам", "Хөтөлбөр"]);
  });

  it("is paginated", async () => {
    for (let i = 0; i < 3; i += 1) await publish(teacherA, { title: `Баримт ${i}` });

    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/documents?page=1&pageSize=2`),
      teacherA,
    );
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bookmarks — RFP §9's "Bookmark хийх"
// ═══════════════════════════════════════════════════════════════════════════

describe("bookmarks", () => {
  /**
   * ★ Per reader, which is why it is a join table rather than a column.
   *
   * A boolean on `Document` would make one teacher's bookmark appear on every
   * colleague's list — the opposite of what a bookmark is.
   */
  it("belongs to the person who made it, not to the document", async () => {
    const created = await publish();

    await authed(request(server()).post(`/v1/documents/${created.body.id}/bookmark`), teacherA);

    const mine = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/documents`),
      teacherA,
    );
    expect(mine.body.items[0].isBookmarked).toBe(true);

    // The admin, a different reader in the same kindergarten, sees their own
    // answer rather than the teacher's.
    const theirs = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/documents`),
      adminA,
    );
    expect(theirs.body.items[0].isBookmarked).toBe(false);
  });

  it("filters to bookmarked only", async () => {
    const first = await publish(teacherA, { title: "Тэмдэглэсэн" });
    await publish(teacherA, { title: "Тэмдэглээгүй" });

    await authed(request(server()).post(`/v1/documents/${first.body.id}/bookmark`), teacherA);

    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/documents?bookmarkedOnly=true`),
      teacherA,
    );
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].title).toBe("Тэмдэглэсэн");
  });

  it("bookmarking twice is one bookmark, not an error", async () => {
    const created = await publish();

    await authed(request(server()).post(`/v1/documents/${created.body.id}/bookmark`), teacherA);
    const second = await authed(
      request(server()).post(`/v1/documents/${created.body.id}/bookmark`),
      teacherA,
    );

    expect(second.status).toBe(201);
    expect(await db.documentBookmark.count({ where: { documentId: created.body.id } })).toBe(1);
  });

  it("removing one leaves the document alone", async () => {
    const created = await publish();
    await authed(request(server()).post(`/v1/documents/${created.body.id}/bookmark`), teacherA);
    await authed(request(server()).delete(`/v1/documents/${created.body.id}/bookmark`), teacherA);

    expect(await db.documentBookmark.count()).toBe(0);
    expect(await db.document.count({ where: { deletedAt: null } })).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Versions — RFP §9's "Баримт шинэ хувилбараар солих"
// ═══════════════════════════════════════════════════════════════════════════

describe("replacing the file", () => {
  /**
   * ★ `fileMediaFileId` is `@unique`, so the old row must be retired in the
   * same transaction — otherwise its bytes are orphaned and the new row cannot
   * claim the column. Both halves are asserted.
   */
  it("retires the previous file and points at the new one", async () => {
    const created = await publish(teacherA, { title: "Хөтөлбөр", version: "2025.1" });
    const before = await db.document.findUniqueOrThrow({ where: { id: created.body.id } });

    const res = await authed(
      request(server()).post(`/v1/documents/${created.body.id}/file`),
      teacherA,
    )
      .field("version", "2026.1")
      .attach("file", PDF, "шинэ.pdf");

    expect(res.status).toBe(201);
    expect(res.body.version).toBe("2026.1");

    const after = await db.document.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(after.fileMediaFileId).not.toBe(before.fileMediaFileId);

    const retired = await db.mediaFile.findUniqueOrThrow({
      where: { id: before.fileMediaFileId },
    });
    expect(retired.deletedAt).not.toBeNull();
  });

  it("rejects a replacement that is not a PDF", async () => {
    const created = await publish();
    const machO = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, ...Array(64).fill(0)]);

    const res = await authed(
      request(server()).post(`/v1/documents/${created.body.id}/file`),
      teacherA,
    ).attach("file", machO, "шинэ.pdf");

    expect(res.status).toBe(400);
  });
});

describe("removing", () => {
  it("soft-deletes rather than removing the row", async () => {
    const created = await publish();
    await authed(request(server()).delete(`/v1/documents/${created.body.id}`), teacherA);

    const row = await db.document.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.deletedAt).not.toBeNull();
  });
});

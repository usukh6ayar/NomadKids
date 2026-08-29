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

// ═══════════════════════════════════════════════════════════════════════════
// Editing the metadata — PATCH /documents/:id
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ★ Written when the screen gained an edit control. The route existed and was
 * covered only by "a teacher from another kindergarten cannot edit one" — the
 * authorization case, and none of the behaviour.
 */
describe("editing the metadata", () => {
  const patch = (id: string, session = teacherA) =>
    authed(request(server()).patch(`/v1/documents/${id}`), session);

  it("updates every field the DTO accepts", async () => {
    const created = await publish(teacherA, { title: "Хуучин", category: "Журам" });

    const res = await patch(created.body.id).send({
      title: "Шинэ нэр",
      category: "Хөтөлбөр",
      description: "Тайлбар",
      version: "2026.2",
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      title: "Шинэ нэр",
      category: "Хөтөлбөр",
      description: "Тайлбар",
      version: "2026.2",
    });
  });

  it("leaves the fields it was not given alone", async () => {
    const created = await publish(teacherA, { title: "Хөтөлбөр", category: "Журам" });

    const res = await patch(created.body.id).send({ title: "Зөвхөн нэр" });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Зөвхөн нэр");
    expect(res.body.category).toBe("Журам");
  });

  /**
   * ★★ `null` is how a field is cleared, and the distinction matters on the
   * screen that renders it. `category` has no `min`, so `""` validates and is
   * stored — and `listCategories` filters on `category: { not: null }`, so an
   * empty string survives it and becomes a blank option in the filter dropdown.
   */
  it("clears an optional field with null, and stores an empty string as one", async () => {
    const created = await publish(teacherA, { title: "Хөтөлбөр", category: "Журам" });

    const cleared = await patch(created.body.id).send({ category: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.category).toBeNull();

    const blanked = await patch(created.body.id).send({ category: "" });
    expect(blanked.status).toBe(200);
    expect(blanked.body.category).toBe("");

    // The blank one is what reaches the filter chips — the reason a client
    // sends `null` rather than the empty input's value.
    const categories = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/documents/categories`),
      teacherA,
    );
    expect(categories.body).toContain("");
  });

  it("refuses an empty body", async () => {
    const created = await publish();

    const res = await patch(created.body.id).send({});

    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/Өөрчлөх талбар алга/);
  });

  it("refuses an empty title, as a field error", async () => {
    const created = await publish();

    const res = await patch(created.body.id).send({ title: "" });

    expect(res.status).toBe(400);
    expect(res.body.errors?.title?.[0]).toMatch(/Нэрийг оруулна уу/);
  });

  it("refuses a title over the limit", async () => {
    const created = await publish();
    const res = await patch(created.body.id).send({ title: "a".repeat(201) });
    expect(res.status).toBe(400);
  });

  /**
   * `updateDocumentSchema` is `createDocumentSchema.partial()`, and the base is
   * `.strict()`. Whether strictness survives `.partial()` is the kind of thing
   * that changes between zod majors, so it is pinned rather than assumed — a
   * client that posted `fileMediaFileId` must not be able to repoint the file
   * through the metadata route.
   */
  it("rejects a field that is not in the DTO", async () => {
    const created = await publish();

    const res = await patch(created.body.id).send({
      title: "Нэр",
      fileMediaFileId: "00000000-0000-4000-8000-000000000000",
    });

    expect(res.status).toBe(400);
  });

  it("an admin of the same kindergarten may edit", async () => {
    const created = await publish(teacherA);
    const res = await patch(created.body.id, adminA).send({ title: "Захирлын засвар" });
    expect(res.status).toBe(200);
  });

  /**
   * ★ There is no per-author rule. `publishedById` is display only, and any
   * staff member of the document's kindergarten may edit any document in it —
   * which is what the screen's controls must mirror.
   */
  it("a colleague who did not publish it may still edit it", async () => {
    const created = await publish(adminA);
    const res = await patch(created.body.id, teacherA).send({ title: "Хамтрагчийн засвар" });

    expect(res.status).toBe(200);
    expect(res.body.publishedBy.id).toBe(a.adminUser.id);
  });

  it("a parent cannot edit", async () => {
    const created = await publish();
    const res = await patch(created.body.id, parentA).send({ title: "Эцэг эхийн оролдлого" });
    expect(res.status).toBe(404);
  });

  it("writes an audit entry naming the fields", async () => {
    const created = await publish();
    await patch(created.body.id).send({ title: "Аудиттай", version: "2026.3" });

    const entry = await db.auditLog.findFirst({
      where: { objectType: "Document", action: "UPDATE", objectId: created.body.id },
    });
    expect(entry?.actorUserId).toBe(a.teacherUser.id);
    expect(entry?.metadata).toMatchObject({ fields: ["title", "version"] });
  });

  it("returns 404 for a document that does not exist", async () => {
    const res = await patch("00000000-0000-4000-8000-000000000000").send({ title: "Хоосон" });
    expect(res.status).toBe(404);
  });
});

describe("replacing the file — authorization and versioning", () => {
  it("an admin may replace a document a teacher published", async () => {
    const created = await publish(teacherA);

    const res = await authed(
      request(server()).post(`/v1/documents/${created.body.id}/file`),
      adminA,
    ).attach("file", PDF, "шинэ.pdf");

    expect(res.status).toBe(201);
  });

  it("a teacher from another kindergarten cannot replace the file", async () => {
    const created = await publish();
    const teacherB = await login(app, b.teacherUser.username);

    const res = await authed(
      request(server()).post(`/v1/documents/${created.body.id}/file`),
      teacherB,
    ).attach("file", PDF, "хулгай.pdf");

    expect(res.status).toBe(404);
  });

  it("a parent cannot replace the file", async () => {
    const created = await publish();

    const res = await authed(
      request(server()).post(`/v1/documents/${created.body.id}/file`),
      parentA,
    ).attach("file", PDF, "шинэ.pdf");

    expect(res.status).toBe(404);
  });

  /**
   * ★ Omitting `version` keeps the old label rather than clearing it — the
   * repository skips the column entirely when it is null. So a replacement with
   * no new version number stays labelled as the previous one, which is why the
   * screen offers the field beside the file picker.
   */
  it("keeps the previous version label when no new one is given", async () => {
    const created = await publish(teacherA, { title: "Хөтөлбөр", version: "2025.1" });

    const res = await authed(
      request(server()).post(`/v1/documents/${created.body.id}/file`),
      teacherA,
    ).attach("file", PDF, "шинэ.pdf");

    expect(res.status).toBe(201);
    expect(res.body.version).toBe("2025.1");
  });

  /**
   * ★★ A replacement re-dates the document: `publishedAt` is set to now, and
   * the list is ordered by it. So replacing a file moves the row to the top —
   * backend semantics the screen has to state rather than hide.
   */
  it("re-dates the document to the moment of the replacement", async () => {
    const created = await publish(teacherA, { title: "Хөтөлбөр" });
    const before = await db.document.findUniqueOrThrow({ where: { id: created.body.id } });

    await new Promise((resolve) => setTimeout(resolve, 10));
    await authed(request(server()).post(`/v1/documents/${created.body.id}/file`), teacherA).attach(
      "file",
      PDF,
      "шинэ.pdf",
    );

    const after = await db.document.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(after.publishedAt.getTime()).toBeGreaterThan(before.publishedAt.getTime());
  });

  /** The retired file stops being reachable — `/media/:id` filters `deletedAt`. */
  it("the previous file can no longer be opened", async () => {
    const created = await publish();
    const before = await db.document.findUniqueOrThrow({ where: { id: created.body.id } });

    await authed(request(server()).post(`/v1/documents/${created.body.id}/file`), teacherA).attach(
      "file",
      PDF,
      "шинэ.pdf",
    );

    const res = await authed(
      request(server()).get(`/v1/media/${before.fileMediaFileId}`),
      teacherA,
    );
    expect(res.status).toBe(404);
  });

  it("refuses a replacement with no file attached", async () => {
    const created = await publish();
    const res = await authed(
      request(server()).post(`/v1/documents/${created.body.id}/file`),
      teacherA,
    );
    expect(res.status).toBe(400);
  });

  it("writes an audit entry", async () => {
    const created = await publish();
    await authed(request(server()).post(`/v1/documents/${created.body.id}/file`), teacherA)
      .field("version", "2026.9")
      .attach("file", PDF, "шинэ.pdf");

    const entry = await db.auditLog.findFirst({
      where: { objectType: "Document", action: "UPDATE", objectId: created.body.id },
    });
    expect(entry?.metadata).toMatchObject({ replacedFile: true, version: "2026.9" });
  });
});

describe("removing", () => {
  it("soft-deletes rather than removing the row", async () => {
    const created = await publish();
    await authed(request(server()).delete(`/v1/documents/${created.body.id}`), teacherA);

    const row = await db.document.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.deletedAt).not.toBeNull();
  });

  /**
   * ★ Soft, but one-way as far as the product is concerned.
   *
   * Every read filters `deletedAt: null` and no endpoint restores one, so from
   * an administrator's point of view this is permanent — which is why the
   * screen confirms it with a danger tone rather than treating it as the
   * reversible toggle `/admin/groups` uses for archiving.
   */
  it("disappears from the library and can no longer be reached", async () => {
    const created = await publish(teacherA, { title: "Устгах баримт" });
    const remove = await authed(
      request(server()).delete(`/v1/documents/${created.body.id}`),
      teacherA,
    );
    expect(remove.status).toBe(200);

    const list = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/documents`),
      teacherA,
    );
    expect(list.body.items.map((d: { id: string }) => d.id)).not.toContain(created.body.id);

    // And nothing else will touch it either — there is no restore route.
    const edit = await authed(
      request(server()).patch(`/v1/documents/${created.body.id}`),
      teacherA,
    ).send({ title: "Сэргээх оролдлого" });
    expect(edit.status).toBe(404);
  });

  it("an admin may remove a document a teacher published", async () => {
    const created = await publish(teacherA);
    const res = await authed(request(server()).delete(`/v1/documents/${created.body.id}`), adminA);
    expect(res.status).toBe(200);
  });

  it("a teacher from another kindergarten cannot remove one", async () => {
    const created = await publish();
    const teacherB = await login(app, b.teacherUser.username);

    const res = await authed(
      request(server()).delete(`/v1/documents/${created.body.id}`),
      teacherB,
    );

    expect(res.status).toBe(404);
    const row = await db.document.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.deletedAt).toBeNull();
  });

  it("a parent cannot remove one", async () => {
    const created = await publish();
    const res = await authed(request(server()).delete(`/v1/documents/${created.body.id}`), parentA);
    expect(res.status).toBe(404);
  });

  /** The row survives for the audit trail even though nothing will show it. */
  it("writes an audit entry that outlives the document", async () => {
    const created = await publish();
    await authed(request(server()).delete(`/v1/documents/${created.body.id}`), teacherA);

    const entry = await db.auditLog.findFirst({
      where: { objectType: "Document", action: "DELETE", objectId: created.body.id },
    });
    expect(entry?.actorUserId).toBe(a.teacherUser.id);
  });

  it("returns 404 for a document that does not exist", async () => {
    const res = await authed(
      request(server()).delete("/v1/documents/00000000-0000-4000-8000-000000000000"),
      teacherA,
    );
    expect(res.status).toBe(404);
  });
});

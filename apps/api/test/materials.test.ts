import type { INestApplication } from "@nestjs/common";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  authed,
  createScenario,
  createUser,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * Сургалтын хэрэглэгдэхүүн — the platform's lessons, sold to teachers through
 * QPay (client, 2026-10-09; CLAUDE.md §7).
 *
 * What is pinned: the shop is a teacher's and the catalog the operator's,
 * 404 for everyone else; a file is judged by its bytes; a free material is
 * owned without QPay; a material taken off the shop stays with its buyer; a
 * non-owner's download is the same 404 as a material that does not exist; an
 * edit keeps the file and pages it did not replace; no sale touches a
 * kindergarten's books.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let operator: AuthSession;
let teacher: AuthSession;
let otherTeacher: AuthSession;
let director: AuthSession;
let parent: AuthSession;

const server = () => app.getHttpServer();
const PDF = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
const MISSING = "00000000-0000-4000-8000-000000000000";
let PAGE: Buffer;

beforeAll(async () => {
  app = await createTestApp();
  PAGE = await sharp({ create: { width: 300, height: 400, channels: 3, background: "#fff" } })
    .png()
    .toBuffer();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  const b = await createScenario("b");
  const superUser = await createUser({ username: uniq("super"), isSuperAdmin: true });

  operator = await login(app, superUser.username);
  teacher = await login(app, a.teacherUser.username);
  otherTeacher = await login(app, b.teacherUser.username);
  director = await login(app, a.adminUser.username);
  parent = await login(app, a.parentUser.username);
});

interface Fields {
  title?: string;
  area?: string;
  price?: string;
  published?: string;
  contents?: string[];
}

function upload(
  method: "post" | "put",
  path: string,
  session: AuthSession,
  fields: Fields = {},
  files: { file?: [Buffer, string]; previews?: number } = { file: [PDF, "тоолох.pdf"] },
) {
  let req = authed(request(server())[method](`/v1${path}`), session)
    .field("title", fields.title ?? "Тоолж сурцгаая")
    .field("area", fields.area ?? "Математик")
    .field("price", fields.price ?? "12000")
    .field("published", fields.published ?? "true")
    .field("autoPreview", "true");
  for (const line of fields.contents ?? ["1–5 хүртэл тоолох", "Их, бага харьцуулах"]) {
    req = req.field("contents", line);
  }
  if (files.file) req = req.attach("file", files.file[0], files.file[1]);
  for (let i = 0; i < (files.previews ?? 0); i++) req = req.attach("previews", PAGE, `p${i}.png`);
  return req;
}

async function createMaterial(fields: Fields = {}, previews = 2) {
  const res = await upload("post", "/platform/materials", operator, fields, {
    file: [PDF, "тоолох.pdf"],
    previews,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; previewUrls: string[] };
}

const shop = (session: AuthSession) => authed(request(server()).get("/v1/materials"), session);
const buy = (session: AuthSession, id: string) =>
  authed(request(server()).post(`/v1/materials/${id}/qpay`), session).send({});
const download = (session: AuthSession, id: string) =>
  authed(request(server()).get(`/v1/materials/${id}/download`), session).redirects(0);

describe("the operator's catalog", () => {
  it("creates a material from a PDF and sample pages, previews as API paths", async () => {
    const res = await upload(
      "post",
      "/platform/materials",
      operator,
      {},
      {
        file: [PDF, "тоолох.pdf"],
        previews: 2,
      },
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: "Тоолж сурцгаая",
      area: "Математик",
      fileType: "PDF",
      price: 12000,
      published: true,
      sales: 0,
      fileName: "тоолох.pdf",
      contents: ["1–5 хүртэл тоолох", "Их, бага харьцуулах"],
      // Asked for, but the server cannot draw pages yet (Phase 2).
      previewStatus: "MANUAL",
    });
    expect(res.body.previewUrls).toEqual([
      `/materials/${res.body.id}/previews/0`,
      `/materials/${res.body.id}/previews/1`,
    ]);
    // The key is random and the bucket private — no name, no URL in the row.
    const row = await db.teachingMaterial.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.storageKey).toMatch(/^platform\/materials\/[0-9a-f-]{36}$/);
  });

  it("is 404 for anyone but the platform operator", async () => {
    for (const session of [teacher, director, parent]) {
      expect((await authed(request(server()).get("/v1/platform/materials"), session)).status).toBe(
        404,
      );
      expect((await upload("post", "/platform/materials", session)).status).toBe(404);
    }
    expect(await db.teachingMaterial.count()).toBe(0);
  });

  it("judges the file by its bytes: a picture named .pdf and a .docx named .pptx are refused", async () => {
    const docx = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(26),
      Buffer.from("word/document.xml"),
    ]);
    for (const file of [
      [PAGE, "хуурамч.pdf"],
      [docx, "хуурамч.pptx"],
    ] as [Buffer, string][]) {
      const res = await upload("post", "/platform/materials", operator, {}, { file });
      expect(res.status, file[1]).toBe(400);
    }
    expect(await db.teachingMaterial.count()).toBe(0);
  });

  it("refuses a learning area the system does not have", async () => {
    const res = await upload("post", "/platform/materials", operator, { area: "Шатар" });
    expect(res.status).toBe(400);
  });

  it("an edit without a file or pages keeps both; new pages replace the old", async () => {
    const material = await createMaterial({}, 2);
    const before = await db.teachingMaterial.findUniqueOrThrow({ where: { id: material.id } });

    const edit = await upload(
      "put",
      `/platform/materials/${material.id}`,
      operator,
      {
        title: "Шинэ нэр",
        price: "15000",
      },
      {},
    );
    expect(edit.status).toBe(200);
    expect(edit.body).toMatchObject({ title: "Шинэ нэр", price: 15000, fileName: "тоолох.pdf" });
    expect(edit.body.previewUrls).toHaveLength(2);
    const after = await db.teachingMaterial.findUniqueOrThrow({ where: { id: material.id } });
    expect(after.storageKey).toBe(before.storageKey);

    const replaced = await upload(
      "put",
      `/platform/materials/${material.id}`,
      operator,
      {},
      {
        previews: 1,
      },
    );
    expect(replaced.status).toBe(200);
    expect(replaced.body.previewUrls).toHaveLength(1);
    // The old pages are soft-deleted, not erased (CLAUDE.md §3.2).
    expect(
      await db.teachingMaterialPreview.count({
        where: { materialId: material.id, deletedAt: { not: null } },
      }),
    ).toBe(2);
  });

  it("cannot draw sample pages yet, and says so", async () => {
    const material = await createMaterial();
    const res = await authed(
      request(server()).post(`/v1/platform/materials/${material.id}/previews/regenerate`),
      operator,
    );
    expect(res.status).toBe(400);
  });
});

describe("the shop", () => {
  it("lists what is on sale to a teacher, not owned yet", async () => {
    await createMaterial();
    await createMaterial({ title: "Нуугдсан", published: "false" });

    const res = await shop(teacher);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ title: "Тоолж сурцгаая", owned: false });
    expect(res.body.totalPages).toBe(1);
  });

  it("is 404 for a director and a family", async () => {
    await createMaterial();
    expect((await shop(director)).status).toBe(404);
    expect((await shop(parent)).status).toBe(404);
    expect((await authed(request(server()).get("/v1/me/materials"), parent)).status).toBe(404);
  });

  it("shows a sample page to a teacher, and not a page of a material off sale", async () => {
    const onSale = await createMaterial();
    const hidden = await createMaterial({ published: "false" });

    const page = await authed(
      request(server()).get(`/v1${onSale.previewUrls[0]}`),
      teacher,
    ).redirects(0);
    expect(page.status).toBe(302);

    const off = await authed(
      request(server()).get(`/v1${hidden.previewUrls[0]}`),
      teacher,
    ).redirects(0);
    expect(off.status).toBe(404);
    const family = await authed(
      request(server()).get(`/v1${onSale.previewUrls[0]}`),
      parent,
    ).redirects(0);
    expect(family.status).toBe(404);
  });
});

describe("buying and owning", () => {
  it("a free material is owned at once, without QPay", async () => {
    const material = await createMaterial({ price: "0" });

    const res = await buy(teacher, material.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "PAID", amount: "0.00", qrImage: null });

    const status = await authed(
      request(server()).get(`/v1/materials/${material.id}/qpay`),
      teacher,
    );
    expect(status.body.status).toBe("PAID");
    expect((await shop(teacher)).body.items[0].owned).toBe(true);
    const mine = await authed(request(server()).get("/v1/me/materials"), teacher);
    expect(mine.body.map((m: { id: string }) => m.id)).toEqual([material.id]);

    const file = await download(teacher, material.id);
    expect(file.status).toBe(302);
    expect(file.headers.location).toContain("X-Amz-Signature");
    expect(file.headers.location).toContain("attachment");
  });

  it("a priced material goes to QPay — honestly unconfigured here — and touches no kindergarten's books", async () => {
    const material = await createMaterial({ price: "12000" });

    const res = await buy(teacher, material.id);
    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("тохируулагдаагүй");

    const purchase = await db.materialPurchase.findFirstOrThrow({
      where: { materialId: material.id },
    });
    expect(purchase).toMatchObject({ status: "UNPAID", amount: 12000 });
    expect(await db.payment.count()).toBe(0);
    expect(await db.accessSubscription.count()).toBe(0);
  });

  it("a non-owner's download is the same 404 as a material that does not exist", async () => {
    const material = await createMaterial({ price: "0" });
    await buy(teacher, material.id);

    expect((await download(otherTeacher, material.id)).status).toBe(404);
    expect((await download(teacher, MISSING)).status).toBe(404);
    expect((await download(director, material.id)).status).toBe(404);
  });

  it("a material taken off the shop stays with its buyer, and can no longer be bought", async () => {
    const material = await createMaterial({ price: "0" });
    await buy(teacher, material.id);

    const removed = await authed(
      request(server()).delete(`/v1/platform/materials/${material.id}`),
      operator,
    );
    expect(removed.status).toBe(204);

    expect((await shop(teacher)).body.items).toEqual([]);
    expect((await buy(otherTeacher, material.id)).status).toBe(404);

    const mine = await authed(request(server()).get("/v1/me/materials"), teacher);
    expect(mine.body).toHaveLength(1);
    expect((await download(teacher, material.id)).status).toBe(302);
    const page = await authed(
      request(server()).get(`/v1${material.previewUrls[0]}`),
      teacher,
    ).redirects(0);
    expect(page.status).toBe(302);
  });

  it("the operator sees how it sold", async () => {
    const material = await createMaterial({ price: "0" });
    await buy(teacher, material.id);
    await buy(otherTeacher, material.id);

    const res = await authed(request(server()).get("/v1/platform/materials"), operator);
    expect(res.body[0]).toMatchObject({ id: material.id, sales: 2 });
  });
});

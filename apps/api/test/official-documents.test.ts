import type { INestApplication } from "@nestjs/common";
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
 * «Үндсэн баримт бичиг» — the platform-wide ministry register (backend list
 * №7, 2026-10-23). Read by any kindergarten's staff and the operator; written
 * by the operator alone, soft delete, audited.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let operator: AuthSession;
let operatorId: string;
let teacher: AuthSession;
let admin: AuthSession;
let parent: AuthSession;

const server = () => app.getHttpServer();
const list = (who: AuthSession) =>
  authed(request(server()).get("/v1/official-documents?page=1&pageSize=100"), who);

const input = {
  category: "Дүрэм, журам",
  title: "Хүүхдийн цэцэрлэгийн үлгэрчилсэн дүрэм",
  year: 2023,
  number: "А/569",
  url: "https://legalinfo.mn/mn/detail?lawId=17048151375571",
  sourceLevel: "official_full_text",
  reviewRequired: false,
  audience: ["Эрхлэгч", "Арга зүйч", "Багш"],
  notes: null,
  featured: false,
};

beforeAll(async () => {
  app = await createTestApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();
  a = await createScenario("a");
  const op = await createUser({ username: uniq("operator"), isSuperAdmin: true });
  operatorId = op.id;
  operator = await login(app, op.username);
  teacher = await login(app, a.teacherUser.username);
  admin = await login(app, a.adminUser.username);
  parent = await login(app, a.parentUser.username);
});

async function seed(overrides: Partial<typeof input> & { code?: string } = {}) {
  return db.officialDocument.create({
    data: { ...input, ...overrides, sourceLevel: "official_full_text" } as never,
  });
}

describe("who may read", () => {
  it("the operator and any kindergarten's staff; a parent gets 404", async () => {
    await seed({ code: "SOB-002" });

    for (const who of [operator, teacher, admin]) {
      const res = await list(who);
      expect(res.status).toBe(200);
      expect(res.body.items.map((d: { code: string }) => d.code)).toEqual(["SOB-002"]);
    }
    expect((await list(parent)).status).toBe(404);
  });

  it("puts «Онцлох» first, then the register's order", async () => {
    await seed({ code: "SOB-002" });
    await seed({ code: "SOB-001" });
    await seed({ code: "SOB-007", featured: true });

    const codes = (await list(teacher)).body.items.map((d: { code: string }) => d.code);
    expect(codes).toEqual(["SOB-007", "SOB-001", "SOB-002"]);
  });
});

describe("who may write", () => {
  it("a kindergarten's admin and teacher get 404 on create, edit and delete", async () => {
    const doc = await seed();

    for (const who of [admin, teacher]) {
      const created = await authed(request(server()).post("/v1/official-documents"), who).send(
        input,
      );
      const edited = await authed(
        request(server()).patch(`/v1/official-documents/${doc.id}`),
        who,
      ).send({ title: "Өөр" });
      const removed = await authed(
        request(server()).delete(`/v1/official-documents/${doc.id}`),
        who,
      );
      expect([created.status, edited.status, removed.status]).toEqual([404, 404, 404]);
    }
    expect((await db.officialDocument.findUniqueOrThrow({ where: { id: doc.id } })).title).toBe(
      input.title,
    );
  });
});

describe("the operator's edits", () => {
  it("adds, edits and removes an entry — soft, and audited with what it replaced", async () => {
    const created = await authed(request(server()).post("/v1/official-documents"), operator).send(
      input,
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    expect(created.body).toMatchObject({ code: null, title: input.title, featured: false });
    expect(created.body.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const edited = await authed(
      request(server()).patch(`/v1/official-documents/${id}`),
      operator,
    ).send({ title: "Шинэ нэр", featured: true });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ title: "Шинэ нэр", featured: true, year: 2023 });

    const removed = await authed(
      request(server()).delete(`/v1/official-documents/${id}`),
      operator,
    );
    expect(removed.status).toBe(204);
    expect((await list(teacher)).body.items).toEqual([]);
    expect(
      (await db.officialDocument.findUniqueOrThrow({ where: { id } })).deletedAt,
    ).not.toBeNull();

    const audit = await db.auditLog.findMany({
      where: { objectType: "OfficialDocument", objectId: id, actorUserId: operatorId },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((row) => row.action)).toEqual(["CREATE", "UPDATE", "DELETE"]);
    expect(audit[1]!.metadata).toMatchObject({
      before: { title: input.title },
      after: { title: "Шинэ нэр" },
    });
    expect(audit[2]!.metadata).toMatchObject({ before: { title: "Шинэ нэр" } });

    // Gone is gone: editing or removing it again is the same 404.
    const again = await authed(request(server()).delete(`/v1/official-documents/${id}`), operator);
    expect(again.status).toBe(404);
  });

  it("refuses a link that is not https and an entry for no one", async () => {
    const http = await authed(request(server()).post("/v1/official-documents"), operator).send({
      ...input,
      url: "http://legalinfo.mn/x",
    });
    const nobody = await authed(request(server()).post("/v1/official-documents"), operator).send({
      ...input,
      audience: [],
    });

    expect([http.status, nobody.status]).toEqual([400, 400]);
    expect(await db.officialDocument.count()).toBe(0);
  });
});

import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import { createKindergarten } from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * `GET /public/kindergartens?location=…` — the staff sign-up's district list
 * (#211). Public, so what it must never list matters more than what it does.
 */

let app: INestApplication;
const db = testDb();
const server = () => app.getHttpServer();

beforeAll(async () => {
  app = await createTestApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();
});

async function kindergarten(name: string, data: Record<string, unknown>) {
  const row = await createKindergarten(`${name} ${uniq()}`);
  return db.kindergarten.update({ where: { id: row.id }, data });
}

const list = (location: string) =>
  request(server()).get("/v1/public/kindergartens").query({ location });

describe("GET /public/kindergartens", () => {
  it("lists the district's contracted kindergartens by district or by address", async () => {
    const byDistrict = await kindergarten("Нарлаг", { district: "Баянзүрх" });
    const byAddress = await kindergarten("Хангай", { location: "Улаанбаатар, Баянзүрх дүүрэг" });
    await kindergarten("Өөр дүүрэг", { district: "Сүхбаатар" });

    const res = await list("Баянзүрх дүүрэг");

    expect(res.status).toBe(200);
    expect(res.body.map((k: { id: string }) => k.id).sort()).toEqual(
      [byDistrict.id, byAddress.id].sort(),
    );
    expect(Object.keys(res.body[0]).sort()).toEqual(["id", "name"]);
  });

  it("never lists a solo workspace, an inactive, a deleted or a merged kindergarten", async () => {
    const target = await kindergarten("Гэрээтэй", { district: "Баянзүрх" });
    await kindergarten("Б.Сараа — бие даасан багш", {
      kind: "SOLO_TEACHER",
      location: "Баянзүрх дүүрэг",
    });
    await kindergarten("Идэвхгүй", { district: "Баянзүрх", isActive: false });
    await kindergarten("Устгасан", { district: "Баянзүрх", deletedAt: new Date() });
    await kindergarten("Нэгдсэн", { district: "Баянзүрх", mergedIntoId: target.id });

    const res = await list("Баянзүрх дүүрэг");

    expect(res.body.map((k: { id: string }) => k.id)).toEqual([target.id]);
  });

  it("is reachable without signing in, and refuses a pattern character", async () => {
    const ok = await list("Сүхбаатар дүүрэг");
    const pattern = await list("%");

    expect(ok.status).toBe(200);
    expect(ok.body).toEqual([]);
    expect(pattern.status).toBe(400);
  });
});

import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { MaintenanceService, RETENTION } from "../src/maintenance/maintenance.service";
import { resetData, testDb, uniq } from "./support/db";
import { createKindergarten, createUser } from "./support/fixtures";

/**
 * Cleanup of operational tables.
 *
 * `LoginAttempt` is the one that matters: it is scanned on every login attempt,
 * so an unbounded table degrades the exact endpoint an attacker is hammering.
 */

let app: INestApplication;
let service: MaintenanceService;
const db = testDb();

const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  service = app.get(MaintenanceService);
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
});

describe("login attempt pruning", () => {
  it("removes attempts older than the retention window", async () => {
    await db.loginAttempt.create({
      data: {
        identifier: "old",
        succeeded: false,
        createdAt: new Date(Date.now() - RETENTION.loginAttempts - DAY),
      },
    });

    const result = await service.runCleanup();
    expect(result.loginAttempts).toBe(1);
    expect(await db.loginAttempt.count()).toBe(0);
  });

  it("KEEPS recent attempts — the lockout depends on them", async () => {
    // Pruning inside the 15-minute window would reset the counter and disable
    // the lockout entirely.
    await db.loginAttempt.create({ data: { identifier: "recent", succeeded: false } });

    await service.runCleanup();
    expect(await db.loginAttempt.count()).toBe(1);
  });
});

describe("auth token pruning", () => {
  it("removes expired tokens", async () => {
    const user = await createUser({ username: uniq("u") });
    await db.authToken.create({
      data: {
        userId: user.id,
        purpose: "PASSWORD_RESET",
        tokenHash: uniq("hash"),
        expiresAt: new Date(Date.now() - DAY),
      },
    });

    const result = await service.runCleanup();
    expect(result.authTokens).toBe(1);
  });

  it("removes used tokens even when unexpired", async () => {
    const user = await createUser({ username: uniq("u") });
    await db.authToken.create({
      data: {
        userId: user.id,
        purpose: "INVITATION",
        tokenHash: uniq("hash"),
        expiresAt: new Date(Date.now() + DAY),
        usedAt: new Date(),
      },
    });

    expect((await service.runCleanup()).authTokens).toBe(1);
  });

  it("keeps a live unused token", async () => {
    const user = await createUser({ username: uniq("u") });
    await db.authToken.create({
      data: {
        userId: user.id,
        purpose: "PASSWORD_RESET",
        tokenHash: uniq("hash"),
        expiresAt: new Date(Date.now() + DAY),
      },
    });

    await service.runCleanup();
    expect(await db.authToken.count()).toBe(1);
  });
});

describe("session pruning", () => {
  it("removes long-expired sessions", async () => {
    const user = await createUser({ username: uniq("u") });
    await db.session.create({
      data: {
        userId: user.id,
        familyId: crypto.randomUUID(),
        tokenHash: uniq("hash"),
        expiresAt: new Date(Date.now() - RETENTION.sessions - DAY),
      },
    });

    expect((await service.runCleanup()).sessions).toBe(1);
  });

  it("KEEPS a recently revoked session", async () => {
    // ★ Refresh-token reuse detection needs the revoked row to still exist.
    // Deleting it on revocation would make a replayed token look merely
    // unknown, and the family-revocation defence would never fire.
    const user = await createUser({ username: uniq("u") });
    await db.session.create({
      data: {
        userId: user.id,
        familyId: crypto.randomUUID(),
        tokenHash: uniq("hash"),
        expiresAt: new Date(Date.now() + DAY),
        revokedAt: new Date(),
      },
    });

    await service.runCleanup();
    expect(await db.session.count()).toBe(1);
  });
});

/**
 * Notices leave the board after a week — the client, 2026-09-11.
 *
 * ★ The only **soft** delete in this sweep, and the cases below are mostly
 * about what it must not touch. A retention rule that takes one row too many
 * is indistinguishable from a bug that deletes notices at random, and the
 * kindergarten discovers it by a parent asking about a notice nobody can find.
 */
describe("notice retirement", () => {
  const publishNotice = async (
    kindergartenId: string,
    overrides: { publishedAt?: Date; isImportant?: boolean; status?: "DRAFT" | "PUBLISHED" } = {},
  ) =>
    db.notification.create({
      data: {
        kindergartenId,
        title: uniq("Мэдээ"),
        body: "Тэмдэглэл",
        status: overrides.status ?? "PUBLISHED",
        publishedAt: overrides.publishedAt ?? new Date(Date.now() - RETENTION.notifications - DAY),
        isImportant: overrides.isImportant ?? false,
      },
    });

  it("retires a notice a week after it was published", async () => {
    const kg = await createKindergarten();
    const notice = await publishNotice(kg.id);

    expect((await service.runCleanup()).notifications).toBe(1);

    /*
      ★ The row survives. CLAUDE.md §3.2 — and the reason it matters here is
      that "what did you tell the parents in March" is a question a
      kindergarten gets asked, and a hard delete makes it unanswerable to save
      one row.
    */
    const after = await db.notification.findUnique({ where: { id: notice.id } });
    expect(after?.deletedAt).toBeInstanceOf(Date);
  });

  it("KEEPS a notice the author marked important", async () => {
    const kg = await createKindergarten();
    await publishNotice(kg.id, { isImportant: true });

    expect((await service.runCleanup()).notifications).toBe(0);
    expect(await db.notification.count({ where: { deletedAt: null } })).toBe(1);
  });

  it("KEEPS a notice published inside the week", async () => {
    const kg = await createKindergarten();
    await publishNotice(kg.id, { publishedAt: new Date(Date.now() - DAY) });

    expect((await service.runCleanup()).notifications).toBe(0);
  });

  /*
    ★ A draft has not started its week.

    The clock runs from `publishedAt`, so a notice written on Monday and
    published on Friday gets its seven days from Friday — and one saved and
    never published is not on any board to leave.
  */
  it("KEEPS a draft that was never published", async () => {
    const kg = await createKindergarten();
    await publishNotice(kg.id, { status: "DRAFT", publishedAt: null as unknown as Date });

    expect((await service.runCleanup()).notifications).toBe(0);
  });

  it("does not retire the same notice twice", async () => {
    const kg = await createKindergarten();
    await publishNotice(kg.id);

    expect((await service.runCleanup()).notifications).toBe(1);
    expect((await service.runCleanup()).notifications).toBe(0);
  });
});

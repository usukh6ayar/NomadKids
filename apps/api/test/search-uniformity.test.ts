import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData } from "./support/db";
import {
  authed,
  createMembership,
  createScenario,
  createUser,
  login,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * Search behaves the same way everywhere — Order А/261, шалгуур 21.
 *
 * ★ This file exists because the criterion is about *uniformity*, and
 * uniformity is the one property no single module's test can check.
 *
 * `children.test.ts` proves the children list searches. `kitchen.test.ts`
 * proves the ingredient list does. Neither notices when one of them trims the
 * term and the other does not — which is exactly what was true before
 * 2026-09-05: four modules trimmed, three did not, and four lists had no search
 * at all. A person who learns that typing a name works on one screen and does
 * nothing on the next has learned the system is unreliable.
 *
 * ★★ So the shape of every test here is: **the same term, against every list**,
 * asserting they agree. A module added later that writes its own `q` by hand
 * will fail the untrimmed case here even if its own tests pass.
 */

let app: INestApplication;

let a: Scenario;
let b: Scenario;
let adminA: AuthSession;
let cookA: AuthSession;
let teacherA: AuthSession;
let adminB: AuthSession;
let cookB: AuthSession;

const server = () => app.getHttpServer();

/** A one-page PDF, for the document list's multipart upload. */
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");

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
  b = await createScenario("b");

  adminA = await login(app, a.adminUser.username);
  teacherA = await login(app, a.teacherUser.username);

  adminB = await login(app, b.adminUser.username);

  for (const [kindergartenId, assign] of [
    [a.kindergarten.id, (s: AuthSession) => (cookA = s)],
    [b.kindergarten.id, (s: AuthSession) => (cookB = s)],
  ] as const) {
    const cook = await createUser({ username: `cook-${Math.random().toString(36).slice(2, 8)}` });
    await createMembership(cook.id, kindergartenId, "COOK");
    assign(await login(app, cook.username));
  }
});

/**
 * Every searchable list, as `(name, url, session, seed)`.
 *
 * ★ The seed creates one row whose text contains "Тэмдэглэгээ" and nothing
 * else does, so an assertion can be "this term finds exactly one row" on every
 * list without each case knowing anything about the others' shapes.
 */
const TERM = "Тэмдэглэгээ";

interface Searchable {
  name: string;
  path: () => string;
  session: () => AuthSession;
  seed: () => Promise<void>;
  /**
   * The identical row, in kindergarten B.
   *
   * ★ Without this the cross-tenant case below asserts nothing: "A's search
   * found one row" is true whether or not B has any, because B's rows are
   * different text. Seeding the *same* term on both sides is what makes a
   * leak show up as two results instead of one — and a leak that produced a
   * plausible-looking row is exactly the kind nobody notices.
   */
  seedOther: () => Promise<void>;
}

async function post(session: AuthSession, path: string, body: unknown) {
  const res = await authed(request(server()).post(`/v1${path}`), session).send(body);
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`seed failed ${path}: ${res.status} ${res.text}`);
  }
  return res.body as { id: string };
}

const LISTS: Searchable[] = [
  {
    name: "хүүхэд",
    // ★ `/children`, not `/kindergartens/:id/children`. The list resolves the
    // kindergartens from the actor's memberships (§1.3); only the *create*
    // route is scoped by a path parameter.
    path: () => `/children`,
    session: () => adminA,
    seed: async () => {
      await post(adminA, `/kindergartens/${a.kindergarten.id}/children`, {
        lastName: TERM,
        firstName: "Болд",
        sex: "MALE",
        dateOfBirth: "2022-05-05",
      });
    },
    seedOther: async () => {
      await post(adminB, `/kindergartens/${b.kindergarten.id}/children`, {
        lastName: TERM,
        firstName: "Болд",
        sex: "MALE",
        dateOfBirth: "2022-05-05",
      });
    },
  },
  {
    name: "хэрэглэгч",
    path: () => `/users`,
    session: () => adminA,
    seed: async () => {
      const user = await createUser({ username: `u-${Math.random().toString(36).slice(2, 8)}` });
      await createMembership(user.id, a.kindergarten.id, "TEACHER");
      await authed(request(server()).patch(`/v1/users/${user.id}`), adminA).send({
        lastName: TERM,
      });
    },
    seedOther: async () => {
      const user = await createUser({ username: `ub-${Math.random().toString(36).slice(2, 8)}` });
      await createMembership(user.id, b.kindergarten.id, "TEACHER");
      await authed(request(server()).patch(`/v1/users/${user.id}`), adminB).send({
        lastName: TERM,
      });
    },
  },
  {
    name: "баримт бичиг",
    path: () => `/kindergartens/${a.kindergarten.id}/documents`,
    session: () => adminA,
    seed: async () => {
      // Multipart, because publishing a document *is* uploading its file.
      const res = await authed(
        request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/documents`),
        adminA,
      )
        .field("title", `${TERM} — дүрэм`)
        .attach("file", PDF, "дүрэм.pdf");
      if (res.status !== 201) throw new Error(`seed documents: ${res.status} ${res.text}`);
    },
    seedOther: async () => {
      const res = await authed(
        request(server()).post(`/v1/kindergartens/${b.kindergarten.id}/documents`),
        adminB,
      )
        .field("title", `${TERM} — дүрэм`)
        .attach("file", PDF, "дүрэм.pdf");
      if (res.status !== 201) throw new Error(`seed documents (b): ${res.status} ${res.text}`);
    },
  },
  {
    name: "орц",
    path: () => `/kindergartens/${a.kindergarten.id}/ingredients`,
    session: () => cookA,
    seed: async () => {
      await post(cookA, `/kindergartens/${a.kindergarten.id}/ingredients`, {
        name: TERM,
        unit: "GRAM",
      });
    },
    seedOther: async () => {
      await post(cookB, `/kindergartens/${b.kindergarten.id}/ingredients`, {
        name: TERM,
        unit: "GRAM",
      });
    },
  },
  {
    name: "технологийн карт",
    path: () => `/kindergartens/${a.kindergarten.id}/recipes`,
    session: () => cookA,
    seed: async () => {
      const ingredient = await post(cookA, `/kindergartens/${a.kindergarten.id}/ingredients`, {
        name: `Гурил-${Math.random().toString(36).slice(2, 6)}`,
        unit: "GRAM",
      });
      await post(cookA, `/kindergartens/${a.kindergarten.id}/recipes`, {
        name: TERM,
        yieldPortions: 10,
        ingredients: [{ ingredientId: ingredient.id, quantity: "100" }],
      });
    },
    seedOther: async () => {
      const ingredient = await post(cookB, `/kindergartens/${b.kindergarten.id}/ingredients`, {
        name: `Гурил-${Math.random().toString(36).slice(2, 6)}`,
        unit: "GRAM",
      });
      await post(cookB, `/kindergartens/${b.kindergarten.id}/recipes`, {
        name: TERM,
        yieldPortions: 10,
        ingredients: [{ ingredientId: ingredient.id, quantity: "100" }],
      });
    },
  },
  {
    name: "нийлүүлэгч",
    path: () => `/kindergartens/${a.kindergarten.id}/suppliers`,
    session: () => cookA,
    seed: async () => {
      await post(cookA, `/kindergartens/${a.kindergarten.id}/suppliers`, { name: TERM });
    },
    seedOther: async () => {
      await post(cookB, `/kindergartens/${b.kindergarten.id}/suppliers`, { name: TERM });
    },
  },
];

async function search(list: Searchable, q: string) {
  return authed(
    request(server()).get(`/v1${list.path()}?q=${encodeURIComponent(q)}`),
    list.session(),
  );
}

describe("хайлтын жигд байдал", () => {
  for (const list of LISTS) {
    describe(list.name, () => {
      beforeEach(async () => {
        await list.seed();
      });

      it("finds the row by a fragment of its text", async () => {
        const res = await search(list, "Тэмдэг");

        expect(res.status).toBe(200);
        expect(res.body.items).toHaveLength(1);
      });

      /**
       * ★ Case-insensitively, in Cyrillic.
       *
       * `mode: "insensitive"` compiles to `ILIKE`, which folds case under the
       * database's own collation. A module that reached for `contains` without
       * the mode would pass the test above and fail this one — and its users
       * would find that search works only if they match the original's
       * capitals.
       */
      it("ignores case", async () => {
        const res = await search(list, "тэмдэг");

        expect(res.status).toBe(200);
        expect(res.body.items).toHaveLength(1);
      });

      /**
       * ★★ The one that caught the real inconsistency.
       *
       * A term pasted from elsewhere arrives with a trailing space more often
       * than anyone expects, and an untrimmed `contains` then matches nothing.
       * The screen reports "олдсонгүй" about a row that is right there, and
       * the failure is invisible because the space is. Four modules trimmed
       * and three did not.
       */
      it("trims the term rather than searching for the space", async () => {
        const res = await search(list, "  Тэмдэг  ");

        expect(res.status).toBe(200);
        expect(res.body.items).toHaveLength(1);
      });

      it("returns nothing for a term that matches nothing", async () => {
        const res = await search(list, "ХэзээчХайхгүй");

        expect(res.status).toBe(200);
        expect(res.body.items).toHaveLength(0);
      });

      /**
       * ★ An all-whitespace term is *no filter*, not a filter for spaces.
       *
       * `searchTermSchema` maps it to `undefined`, so the list answers as if
       * `q` had not been sent. Clearing a search box leaves a space behind
       * often enough that the alternative — an empty list — reads as data loss.
       */
      it("treats a blank term as no search at all", async () => {
        const blank = await search(list, "   ");
        const unfiltered = await authed(request(server()).get(`/v1${list.path()}`), list.session());

        expect(blank.status).toBe(200);
        expect(blank.body.total).toBe(unfiltered.body.total);
      });

      /**
       * ★★★ Search narrows the tenant filter; it can never widen it.
       *
       * `searchWhere` returns a fragment a repository places *beside* its base
       * filter, never instead of it. So this seeds the **identical text** in
       * kindergarten B and asserts A still sees exactly one row.
       *
       * ★ The identical text is the whole point, and an earlier version of
       * this test did not do it: it asserted "A found one row" while B's rows
       * said something else entirely, which is true whether the tenant filter
       * works or not. A leak that surfaced a plausible-looking row is exactly
       * the kind nobody notices (CLAUDE.md §2.2).
       */
      it("never reaches another kindergarten's rows", async () => {
        await list.seedOther();

        const res = await search(list, "Тэмдэг");
        const items = res.body.items as { id: string }[];

        expect(res.status).toBe(200);
        expect(items).toHaveLength(1);
        expect(res.body.total).toBe(1);
      });

      it("refuses a term longer than the schema allows", async () => {
        const res = await search(list, "а".repeat(101));
        expect(res.status).toBe(400);
      });
    });
  }

  /**
   * ★ The cross-tenant case with the *same text on both sides*.
   *
   * Written once rather than per-list because it needs two kindergartens'
   * ingredients seeded together, and because what it proves is a property of
   * the shared helper rather than of any one list.
   */
  it("does not leak a row that another kindergarten gave the same name", async () => {
    const cookB = await createUser({ username: `cookb-${Math.random().toString(36).slice(2, 8)}` });
    await createMembership(cookB.id, b.kindergarten.id, "COOK");
    const sessionB = await login(app, cookB.username);

    await post(cookA, `/kindergartens/${a.kindergarten.id}/ingredients`, {
      name: TERM,
      unit: "GRAM",
    });
    await post(sessionB, `/kindergartens/${b.kindergarten.id}/ingredients`, {
      name: TERM,
      unit: "GRAM",
    });

    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/ingredients?q=Тэмдэг`),
      cookA,
    );

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  /**
   * ★ A teacher searching the kitchen still gets 404.
   *
   * Adding `q` to four kitchen lists added four query parameters behind an
   * authorization gate, and a search parameter must never become a way to ask
   * a question the caller could not otherwise ask.
   */
  it("does not let a search parameter bypass a list's authorization", async () => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/ingredients?q=Тэмдэг`),
      teacherA,
    );
    expect(res.status).toBe(404);
  });
});

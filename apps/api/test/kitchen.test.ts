import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb } from "./support/db";
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
 * Kitchen production — Хоол үйлдвэрлэл: ingredients, technology cards,
 * suppliers, food orders, stock and reports. See the plan doc
 * (`velvet-munching-squirrel.md`) for the design this implements.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let cookA: AuthSession;
let cookB: AuthSession;
let adminA: AuthSession;
let teacherA: AuthSession;

const server = () => app.getHttpServer();

beforeAll(async () => {
  app = await createTestApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

async function createCook(kindergartenId: string, label: string): Promise<AuthSession> {
  const user = await createUser({
    username: `cook-${label}-${Math.random().toString(36).slice(2, 8)}`,
  });
  await createMembership(user.id, kindergartenId, "COOK");
  return login(app, user.username);
}

beforeEach(async () => {
  await resetData();
  await app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  cookA = await createCook(a.kindergarten.id, "a");
  cookB = await createCook(b.kindergarten.id, "b");
  adminA = await login(app, a.adminUser.username);
  teacherA = await login(app, a.teacherUser.username);
});

// ── Small helpers building the fixture data most tests share ──────────────

async function createIngredient(
  session: AuthSession,
  kindergartenId: string,
  overrides: Partial<{
    name: string;
    unit: string;
    caloriesPer100: string | null;
    proteinPer100: string | null;
    fatPer100: string | null;
    carbsPer100: string | null;
    allergenTags: string[];
  }> = {},
) {
  const res = await authed(
    request(server()).post(`/v1/kindergartens/${kindergartenId}/ingredients`),
    session,
  ).send({
    name: overrides.name ?? "Гурил",
    unit: overrides.unit ?? "GRAM",
    caloriesPer100: overrides.caloriesPer100 ?? "350",
    proteinPer100: overrides.proteinPer100 ?? "10",
    fatPer100: overrides.fatPer100 ?? "1",
    carbsPer100: overrides.carbsPer100 ?? "70",
    allergenTags: overrides.allergenTags ?? [],
  });
  if (res.status !== 201) throw new Error(`createIngredient failed: ${res.status} ${res.text}`);
  return res.body as { id: string; name: string };
}

async function createRecipe(
  session: AuthSession,
  kindergartenId: string,
  name: string,
  yieldPortions: number,
  ingredients: { ingredientId: string; quantity: string }[],
) {
  const res = await authed(
    request(server()).post(`/v1/kindergartens/${kindergartenId}/recipes`),
    session,
  ).send({ name, yieldPortions, ingredients });
  if (res.status !== 201) throw new Error(`createRecipe failed: ${res.status} ${res.text}`);
  return res.body as { id: string; status: string };
}

async function approveRecipe(session: AuthSession, recipeId: string) {
  const res = await authed(request(server()).post(`/v1/recipes/${recipeId}/approve`), session);
  if (res.status !== 201 && res.status !== 200)
    throw new Error(`approveRecipe failed: ${res.status} ${res.text}`);
  return res.body;
}

// ═══════════════════════════════════════════════════════════════════════════
// Authorization — CLAUDE.md §4.1
// ═══════════════════════════════════════════════════════════════════════════

describe("authorization", () => {
  it("a teacher gets 404 on ingredients — kitchen data is narrower than assertCanManageMeals", async () => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/ingredients`),
      teacherA,
    );
    expect(res.status).toBe(404);
  });

  it("a teacher gets 404 creating a recipe", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/recipes`),
      teacherA,
    ).send({ name: "x", yieldPortions: 1, ingredients: [] });
    expect(res.status).toBe(404);
  });

  it("a teacher gets 404 on suppliers, orders and stock", async () => {
    const suppliers = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/suppliers`),
      teacherA,
    );
    const orders = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/food-orders`),
      teacherA,
    );
    const stock = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/stock`),
      teacherA,
    );
    expect(suppliers.status).toBe(404);
    expect(orders.status).toBe(404);
    expect(stock.status).toBe(404);
  });

  it("a cook from another kindergarten gets 404 reading kindergarten A's ingredients", async () => {
    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/ingredients`),
      cookB,
    );
    expect(res.status).toBe(404);
  });

  it("a cook from another kindergarten cannot patch kindergarten A's ingredient by id", async () => {
    const ingredient = await createIngredient(cookA, a.kindergarten.id);
    const res = await authed(
      request(server()).patch(`/v1/ingredients/${ingredient.id}`),
      cookB,
    ).send({
      name: "Хулгайлсан нэр",
    });
    expect(res.status).toBe(404);
    expect((await db.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } })).name).toBe(
      "Гурил",
    );
  });

  it("only COOK/ADMIN may approve or consume a menu day — a teacher gets 404", async () => {
    await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01`),
      teacherA,
    ).send({ dishes: [{ name: "x", allergenTags: [] }] });
    const approve = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01/approve`),
      teacherA,
    );
    const consume = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01/consume`),
      teacherA,
    );
    expect(approve.status).toBe(404);
    expect(consume.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Ingredients
// ═══════════════════════════════════════════════════════════════════════════

describe("ingredients", () => {
  it("a cook creates one and it appears in the list", async () => {
    const created = await createIngredient(cookA, a.kindergarten.id, { name: "Гурил" });
    const list = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/ingredients`),
      cookA,
    );
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toContain(created.id);
  });

  it("rejects a duplicate name within the same kindergarten", async () => {
    await createIngredient(cookA, a.kindergarten.id, { name: "Гурил" });
    const dupe = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/ingredients`),
      cookA,
    ).send({ name: "Гурил", unit: "GRAM" });
    expect(dupe.status).toBe(409);
  });

  it("an admin may also manage ingredients", async () => {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/ingredients`),
      adminA,
    ).send({ name: "Сахар", unit: "GRAM" });
    expect(res.status).toBe(201);
  });

  it("archiving is blocked while a live recipe still calls for the ingredient", async () => {
    const flour = await createIngredient(cookA, a.kindergarten.id, { name: "Гурил" });
    const recipe = await createRecipe(cookA, a.kindergarten.id, "Цагаан будаа", 10, [
      { ingredientId: flour.id, quantity: "1000" },
    ]);

    const blocked = await authed(request(server()).delete(`/v1/ingredients/${flour.id}`), cookA);
    expect(blocked.status).toBe(409);

    await authed(request(server()).delete(`/v1/recipes/${recipe.id}`), cookA);

    const allowed = await authed(request(server()).delete(`/v1/ingredients/${flour.id}`), cookA);
    expect(allowed.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Recipes (технологийн карт) — creation, approval, nutrition, allergens
// ═══════════════════════════════════════════════════════════════════════════

describe("recipes", () => {
  it("computes nutrition totals and per-portion figures from its ingredient lines", async () => {
    const flour = await createIngredient(cookA, a.kindergarten.id, {
      name: "Гурил",
      caloriesPer100: "350",
      proteinPer100: "10",
      fatPer100: "1",
      carbsPer100: "70",
    });
    const milk = await createIngredient(cookA, a.kindergarten.id, {
      name: "Сүү",
      unit: "MILLILITER",
      caloriesPer100: "60",
      proteinPer100: "3",
      fatPer100: "3",
      carbsPer100: "5",
      allergenTags: ["сүү"],
    });

    const recipe = await createRecipe(cookA, a.kindergarten.id, "Холимог будаа", 10, [
      { ingredientId: flour.id, quantity: "500" },
      { ingredientId: milk.id, quantity: "500" },
    ]);

    const detail = await authed(request(server()).get(`/v1/recipes/${recipe.id}`), cookA);
    expect(detail.status).toBe(200);
    // 500g flour + 500ml milk against yieldPortions 10 — see kitchen.test.ts's
    // own comment block in the plan doc for the arithmetic.
    expect(detail.body.nutritionTotal).toEqual({
      calories: 2050,
      protein: 65,
      fat: 20,
      carbs: 375,
    });
    expect(detail.body.nutritionPerPortion).toEqual({
      calories: 205,
      protein: 6.5,
      fat: 2,
      carbs: 37.5,
    });
    expect(detail.body.allergenTags).toEqual(["сүү"]);
  });

  it("starts DRAFT and only APPROVED after an explicit approval", async () => {
    const flour = await createIngredient(cookA, a.kindergarten.id);
    const recipe = await createRecipe(cookA, a.kindergarten.id, "Будаа", 10, [
      { ingredientId: flour.id, quantity: "1000" },
    ]);
    expect(recipe.status).toBe("DRAFT");

    const approved = await approveRecipe(cookA, recipe.id);
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedAt).toBeTruthy();

    // Idempotent — approving twice is not an error. Still a POST, so Nest's
    // default success status (201) applies even though nothing new was created.
    const again = await authed(request(server()).post(`/v1/recipes/${recipe.id}/approve`), cookA);
    expect(again.status).toBe(201);
    expect(again.body.status).toBe("APPROVED");
  });

  it("reverts to DRAFT when an APPROVED card's ingredients are edited", async () => {
    const flour = await createIngredient(cookA, a.kindergarten.id);
    const recipe = await createRecipe(cookA, a.kindergarten.id, "Будаа", 10, [
      { ingredientId: flour.id, quantity: "1000" },
    ]);
    await approveRecipe(cookA, recipe.id);

    const edited = await authed(request(server()).patch(`/v1/recipes/${recipe.id}`), cookA).send({
      yieldPortions: 12,
    });
    expect(edited.status).toBe(200);
    expect(edited.body.status).toBe("DRAFT");
    expect(edited.body.approvedAt).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Suppliers
// ═══════════════════════════════════════════════════════════════════════════

describe("suppliers", () => {
  it("a cook creates one and it appears in the list", async () => {
    const created = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/suppliers`),
      cookA,
    ).send({ name: "Ногоон эрдэнэ ХХК", originNote: "Дархан-Уул аймгаас" });
    expect(created.status).toBe(201);

    const list = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/suppliers`),
      cookA,
    );
    expect(list.body.items.map((s: { id: string }) => s.id)).toContain(created.body.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Food orders — Хүнсний захиалга, and receiving into stock
// ═══════════════════════════════════════════════════════════════════════════

describe("food orders", () => {
  async function createSupplier(name = "Ногоон эрдэнэ ХХК") {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/suppliers`),
      cookA,
    ).send({ name });
    return res.body as { id: string };
  }

  it("computes line and order totals, then moves stock on receive", async () => {
    const supplier = await createSupplier();
    const flour = await createIngredient(cookA, a.kindergarten.id, { name: "Гурил" });

    const order = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/food-orders`),
      cookA,
    ).send({
      supplierId: supplier.id,
      orderDate: "2026-04-01",
      lines: [{ ingredientId: flour.id, quantity: "5000", unitPrice: "2.5" }],
    });
    expect(order.status).toBe(201);
    // Decimal strings round-trip without a fixed trailing scale — "12500", not
    // "12500.00" — so every decimal assertion in this file compares as a number.
    expect(Number(order.body.lines[0].totalPrice)).toBe(12500);
    expect(Number(order.body.totalAmount)).toBe(12500);
    expect(order.body.status).toBe("ORDERED");

    const receive = await authed(
      request(server()).post(`/v1/food-orders/${order.body.id}/receive`),
      cookA,
    ).send({ lines: [] });
    expect(receive.status).toBe(201);
    expect(receive.body.status).toBe("RECEIVED");
    expect(Number(receive.body.lines[0].receivedQuantity)).toBe(5000);

    const movements = await db.stockMovement.findMany({
      where: { kindergartenId: a.kindergarten.id, ingredientId: flour.id },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.direction).toBe("IN");
    expect(Number(movements[0]!.quantity)).toBe(5000);

    const levels = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/stock`),
      cookA,
    );
    const flourLevel = levels.body.find(
      (l: { ingredient: { id: string } }) => l.ingredient.id === flour.id,
    );
    expect(Number(flourLevel.onHand)).toBe(5000);
  });

  it("a short delivery is recorded with the override, not the ordered quantity", async () => {
    const supplier = await createSupplier();
    const milk = await createIngredient(cookA, a.kindergarten.id, {
      name: "Сүү",
      unit: "MILLILITER",
    });

    const order = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/food-orders`),
      cookA,
    ).send({
      supplierId: supplier.id,
      orderDate: "2026-04-01",
      lines: [{ ingredientId: milk.id, quantity: "2000", unitPrice: "1.2" }],
    });

    const lineId = order.body.lines[0].id as string;
    const receive = await authed(
      request(server()).post(`/v1/food-orders/${order.body.id}/receive`),
      cookA,
    ).send({ lines: [{ lineId, receivedQuantity: "1900" }] });

    expect(Number(receive.body.lines[0].receivedQuantity)).toBe(1900);
    const level = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/stock`),
      cookA,
    );
    const milkLevel = level.body.find(
      (l: { ingredient: { id: string } }) => l.ingredient.id === milk.id,
    );
    expect(Number(milkLevel.onHand)).toBe(1900);
  });

  it("refuses to receive an order twice", async () => {
    const supplier = await createSupplier();
    const flour = await createIngredient(cookA, a.kindergarten.id);
    const order = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/food-orders`),
      cookA,
    ).send({
      supplierId: supplier.id,
      orderDate: "2026-04-01",
      lines: [{ ingredientId: flour.id, quantity: "100", unitPrice: "1" }],
    });

    await authed(request(server()).post(`/v1/food-orders/${order.body.id}/receive`), cookA).send({
      lines: [],
    });
    const second = await authed(
      request(server()).post(`/v1/food-orders/${order.body.id}/receive`),
      cookA,
    ).send({ lines: [] });
    expect(second.status).toBe(400);

    const movements = await db.stockMovement.count({ where: { ingredientId: flour.id } });
    expect(movements).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Stock — levels, movements, manual adjustments
// ═══════════════════════════════════════════════════════════════════════════

describe("stock", () => {
  it("a positive adjustment is IN, a negative one is OUT, and the level reflects both", async () => {
    const flour = await createIngredient(cookA, a.kindergarten.id);

    const up = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/stock/adjustments`),
      cookA,
    ).send({ ingredientId: flour.id, date: "2026-04-01", quantity: "1000", note: "Тооллого" });
    expect(up.status).toBe(201);
    expect(up.body.direction).toBe("IN");

    const down = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/stock/adjustments`),
      cookA,
    ).send({ ingredientId: flour.id, date: "2026-04-02", quantity: "-200" });
    expect(down.status).toBe(201);
    expect(down.body.direction).toBe("OUT");

    const levels = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/stock`),
      cookA,
    );
    const level = levels.body.find(
      (l: { ingredient: { id: string } }) => l.ingredient.id === flour.id,
    );
    expect(Number(level.onHand)).toBe(800);
  });

  it("rejects a zero adjustment", async () => {
    const flour = await createIngredient(cookA, a.kindergarten.id);
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/stock/adjustments`),
      cookA,
    ).send({ ingredientId: flour.id, date: "2026-04-01", quantity: "0" });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Menu integration — recipe-linked dishes, approval, consumption
// ═══════════════════════════════════════════════════════════════════════════

describe("menu integration", () => {
  it("refuses a dish pointing at a DRAFT recipe", async () => {
    const flour = await createIngredient(cookA, a.kindergarten.id);
    const recipe = await createRecipe(cookA, a.kindergarten.id, "Будаа", 10, [
      { ingredientId: flour.id, quantity: "1000" },
    ]);

    const res = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01`),
      cookA,
    ).send({ dishes: [{ name: "Будаа", allergenTags: [], recipeId: recipe.id, portions: 1 }] });

    expect(res.status).toBe(400);
  });

  it("freezes name/allergens/calories from the APPROVED recipe, ignoring what the client sent", async () => {
    const milk = await createIngredient(cookA, a.kindergarten.id, {
      name: "Сүү",
      unit: "MILLILITER",
      caloriesPer100: "60",
      proteinPer100: "3",
      fatPer100: "3",
      carbsPer100: "5",
      allergenTags: ["сүү"],
    });
    const recipe = await createRecipe(cookA, a.kindergarten.id, "Сүүтэй будаа", 10, [
      { ingredientId: milk.id, quantity: "1000" },
    ]);
    await approveRecipe(cookA, recipe.id);

    const res = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01`),
      cookA,
    ).send({
      dishes: [
        {
          name: "Худал нэр",
          allergenTags: ["худал шошго"],
          recipeId: recipe.id,
          portions: 1,
          // Within menuDishInputSchema's own max(3000), but still clearly not
          // the frozen figure — proves the server overwrites it.
          calories: 500,
        },
      ],
    });
    expect(res.status).toBe(200);

    const row = await db.menuDay.findFirstOrThrow({ where: { kindergartenId: a.kindergarten.id } });
    const dish = (row.dishes as { name: string; allergenTags: string[]; calories: number }[])[0]!;
    expect(dish.name).toBe("Сүүтэй будаа");
    expect(dish.allergenTags).toEqual(["сүү"]);
    expect(dish.calories).toBe(60);
  });

  it("cross-checks a recipe-linked dish's frozen allergens against a child's allergy", async () => {
    const milk = await createIngredient(cookA, a.kindergarten.id, {
      name: "Сүү",
      unit: "MILLILITER",
      allergenTags: ["сүү"],
    });
    const recipe = await createRecipe(cookA, a.kindergarten.id, "Сүүтэй будаа", 10, [
      { ingredientId: milk.id, quantity: "1000" },
    ]);
    await approveRecipe(cookA, recipe.id);

    await authed(
      request(server()).post(`/v1/children/${a.child.id}/health/allergies`),
      teacherA,
    ).send({
      kind: "FOOD",
      severity: "SEVERE",
      allergen: "сүү",
      reaction: "Гэдэс өвдөх",
      treatment: "Эмчид үзүүлэх",
      notedOn: "2026-01-01",
    });

    await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01`),
      cookA,
    ).send({ dishes: [{ name: "x", allergenTags: [], recipeId: recipe.id, portions: 1 }] });

    const warnings = await authed(
      request(server()).get(
        `/v1/kindergartens/${a.kindergarten.id}/menu/with-warnings?from=2026-04-01&to=2026-04-01`,
      ),
      cookA,
    );
    expect(warnings.status).toBe(200);
    expect(warnings.body[0].warnings).toEqual([
      expect.objectContaining({ childId: a.child.id, allergen: "сүү" }),
    ]);
  });

  /**
   * ★ `AllergyRecord.kind` is FOOD/MEDICATION/ENVIRONMENTAL, and only FOOD
   * belongs in a menu cross-check — a repository filter added while auditing
   * the cook role, since `allergenMatches` itself never reads `kind` and would
   * otherwise treat a medication or environmental allergy exactly like a food
   * one.
   */
  it("does not warn on a MEDICATION or ENVIRONMENTAL allergy sharing the same word", async () => {
    const milk = await createIngredient(cookA, a.kindergarten.id, {
      name: "Сүү",
      unit: "MILLILITER",
      allergenTags: ["сүү"],
    });
    const recipe = await createRecipe(cookA, a.kindergarten.id, "Сүүтэй будаа", 10, [
      { ingredientId: milk.id, quantity: "1000" },
    ]);
    await approveRecipe(cookA, recipe.id);

    for (const kind of ["MEDICATION", "ENVIRONMENTAL"]) {
      await authed(
        request(server()).post(`/v1/children/${a.child.id}/health/allergies`),
        teacherA,
      ).send({
        kind,
        severity: "SEVERE",
        allergen: "сүү",
        notedOn: "2026-01-01",
      });
    }

    await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01`),
      cookA,
    ).send({ dishes: [{ name: "x", allergenTags: [], recipeId: recipe.id, portions: 1 }] });

    const warnings = await authed(
      request(server()).get(
        `/v1/kindergartens/${a.kindergarten.id}/menu/with-warnings?from=2026-04-01&to=2026-04-01`,
      ),
      cookA,
    );
    expect(warnings.status).toBe(200);
    expect(warnings.body[0].warnings).toEqual([]);
  });

  it("approve → consume deducts stock by quantity × batch count, and refuses a second consume", async () => {
    const flour = await createIngredient(cookA, a.kindergarten.id, { name: "Гурил" });
    const milk = await createIngredient(cookA, a.kindergarten.id, {
      name: "Сүү",
      unit: "MILLILITER",
    });
    const riceRecipe = await createRecipe(cookA, a.kindergarten.id, "Цагаан будаа", 10, [
      { ingredientId: flour.id, quantity: "1000" },
    ]);
    const milkRecipe = await createRecipe(cookA, a.kindergarten.id, "Сүүтэй цай", 10, [
      { ingredientId: milk.id, quantity: "1000" },
    ]);
    await approveRecipe(cookA, riceRecipe.id);
    await approveRecipe(cookA, milkRecipe.id);

    // Stock the pantry first.
    const supplier = (
      await authed(
        request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/suppliers`),
        cookA,
      ).send({
        name: "Нийлүүлэгч",
      })
    ).body;
    for (const [ingredientId, quantity] of [
      [flour.id, "5000"],
      [milk.id, "5000"],
    ]) {
      const order = await authed(
        request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/food-orders`),
        cookA,
      ).send({
        supplierId: supplier.id,
        orderDate: "2026-04-01",
        lines: [{ ingredientId, quantity, unitPrice: "1" }],
      });
      await authed(request(server()).post(`/v1/food-orders/${order.body.id}/receive`), cookA).send({
        lines: [],
      });
    }

    await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01`),
      cookA,
    ).send({
      dishes: [
        { name: "x", allergenTags: [], recipeId: riceRecipe.id, portions: 2 },
        { name: "y", allergenTags: [], recipeId: milkRecipe.id, portions: 1 },
      ],
    });

    const consumeTooEarly = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01/consume`),
      cookA,
    );
    expect(consumeTooEarly.status).toBe(400);

    const approve = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01/approve`),
      cookA,
    );
    expect(approve.status).toBe(201);

    const consume = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01/consume`),
      cookA,
    );
    expect(consume.status).toBe(201);

    const levels = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/stock`),
      cookA,
    );
    const flourLevel = levels.body.find(
      (l: { ingredient: { id: string } }) => l.ingredient.id === flour.id,
    );
    const milkLevel = levels.body.find(
      (l: { ingredient: { id: string } }) => l.ingredient.id === milk.id,
    );
    // 5000 received − (1000 × 2 batches) consumed.
    expect(Number(flourLevel.onHand)).toBe(3000);
    // 5000 received − (1000 × 1 batch) consumed.
    expect(Number(milkLevel.onHand)).toBe(4000);

    const second = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01/consume`),
      cookA,
    );
    expect(second.status).toBe(400);

    // Editing the day again is refused once it has been consumed.
    const edit = await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01`),
      cookA,
    ).send({ dishes: [{ name: "z", allergenTags: [] }] });
    expect(edit.status).toBe(400);
  });

  it("a save resets an APPROVED day back to DRAFT", async () => {
    await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01`),
      cookA,
    ).send({ dishes: [{ name: "x", allergenTags: [] }] });
    await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01/approve`),
      cookA,
    );

    await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01`),
      cookA,
    ).send({ dishes: [{ name: "y", allergenTags: [] }] });

    const row = await db.menuDay.findFirstOrThrow({ where: { kindergartenId: a.kindergarten.id } });
    expect(row.status).toBe("DRAFT");
    expect(row.approvedAt).toBeNull();
  });

  /**
   * Same rule `approveRecipe` already applies to an ingredient-less
   * technology card — see that describe block above. Before this, a day
   * saved with `dishes: []` (the recipe-picker bug that shipped alongside
   * this test — see `menu-dish-editor.tsx`) could still be marked
   * "Батлагдсан", which is indistinguishable in the UI from a day whose
   * dishes had been entered and then lost.
   */
  it("refuses to approve a day with no dishes", async () => {
    await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01`),
      cookA,
    ).send({ dishes: [] });

    const res = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01/approve`),
      cookA,
    );

    expect(res.status).toBe(400);

    const row = await db.menuDay.findFirstOrThrow({ where: { kindergartenId: a.kindergarten.id } });
    expect(row.status).toBe("DRAFT");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Reports
// ═══════════════════════════════════════════════════════════════════════════

describe("reports", () => {
  async function stockedKitchen() {
    const flour = await createIngredient(cookA, a.kindergarten.id, {
      name: "Гурил",
      caloriesPer100: "350",
      proteinPer100: "10",
      fatPer100: "1",
      carbsPer100: "70",
    });
    const milk = await createIngredient(cookA, a.kindergarten.id, {
      name: "Сүү",
      unit: "MILLILITER",
      caloriesPer100: "60",
      proteinPer100: "3",
      fatPer100: "3",
      carbsPer100: "5",
    });
    const riceRecipe = await createRecipe(cookA, a.kindergarten.id, "Цагаан будаа", 10, [
      { ingredientId: flour.id, quantity: "1000" },
    ]);
    const milkRecipe = await createRecipe(cookA, a.kindergarten.id, "Сүүтэй цай", 10, [
      { ingredientId: milk.id, quantity: "1000" },
    ]);
    await approveRecipe(cookA, riceRecipe.id);
    await approveRecipe(cookA, milkRecipe.id);

    const supplier = (
      await authed(
        request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/suppliers`),
        cookA,
      ).send({
        name: "Нийлүүлэгч",
      })
    ).body;

    for (const [ingredientId, quantity, unitPrice] of [
      [flour.id, "5000", "2.5"],
      [milk.id, "5000", "1.2"],
    ]) {
      const order = await authed(
        request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/food-orders`),
        cookA,
      ).send({
        supplierId: supplier.id,
        orderDate: "2026-04-01",
        lines: [{ ingredientId, quantity, unitPrice }],
      });
      await authed(request(server()).post(`/v1/food-orders/${order.body.id}/receive`), cookA).send({
        lines: [],
      });
    }

    await authed(
      request(server()).put(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01`),
      cookA,
    ).send({
      dishes: [
        { name: "x", allergenTags: [], recipeId: riceRecipe.id, portions: 1 },
        { name: "y", allergenTags: [], recipeId: milkRecipe.id, portions: 1 },
      ],
    });
    await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01/approve`),
      cookA,
    );
    await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/menu/2026-04-01/consume`),
      cookA,
    );

    return { flour, milk, supplier };
  }

  it("consumption report totals OUT movements per ingredient over the range", async () => {
    const { flour, milk } = await stockedKitchen();

    const res = await authed(
      request(server()).get(
        `/v1/kindergartens/${a.kindergarten.id}/kitchen/reports/consumption?from=2026-04-01&to=2026-04-01`,
      ),
      cookA,
    );
    expect(res.status).toBe(200);

    const flourRow = res.body.find(
      (r: { ingredient: { id: string } }) => r.ingredient.id === flour.id,
    );
    const milkRow = res.body.find(
      (r: { ingredient: { id: string } }) => r.ingredient.id === milk.id,
    );
    expect(Number(flourRow.quantity)).toBe(1000);
    expect(Number(milkRow.quantity)).toBe(1000);
  });

  /**
   * ★ A negative stock adjustment — spoilage, a stocktake correction — is
   * also `direction: "OUT"`, same as a `consume` call. The repository used to
   * filter on `direction` alone, which folded a manual write-off into "how
   * much food got cooked" even though the comment beside it already claimed
   * adjustments were excluded. This is what proves they actually are.
   */
  it("excludes a manual stock adjustment from the consumption report", async () => {
    const { flour, milk } = await stockedKitchen();

    await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/stock/adjustments`),
      cookA,
    ).send({ ingredientId: flour.id, date: "2026-04-01", quantity: "-300", note: "Муудсан" });

    const res = await authed(
      request(server()).get(
        `/v1/kindergartens/${a.kindergarten.id}/kitchen/reports/consumption?from=2026-04-01&to=2026-04-01`,
      ),
      cookA,
    );
    expect(res.status).toBe(200);

    const flourRow = res.body.find(
      (r: { ingredient: { id: string } }) => r.ingredient.id === flour.id,
    );
    const milkRow = res.body.find(
      (r: { ingredient: { id: string } }) => r.ingredient.id === milk.id,
    );
    // Still 1000 from the `consume` call — the -300 adjustment must not add in.
    expect(Number(flourRow.quantity)).toBe(1000);
    expect(Number(milkRow.quantity)).toBe(1000);
  });

  it("nutrition report averages by children actually fed, weighted by each recipe's yield", async () => {
    await stockedKitchen();

    const res = await authed(
      request(server()).get(
        `/v1/kindergartens/${a.kindergarten.id}/kitchen/reports/nutrition?from=2026-04-01&to=2026-04-01`,
      ),
      cookA,
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    // 1 batch of each recipe (yieldPortions 10 each) = 10 + 10 = 20 children fed.
    expect(res.body[0].totalPortions).toBe(20);
    // (350×10 + 60×10)/20 = 205, (10×10+3×10)/20=6.5, (1×10+3×10)/20=2, (70×10+5×10)/20=37.5
    expect(res.body[0].perPortion).toEqual({ calories: 205, protein: 6.5, fat: 2, carbs: 37.5 });
  });

  it("purchase report totals received orders per supplier", async () => {
    const { supplier } = await stockedKitchen();

    const res = await authed(
      request(server()).get(
        `/v1/kindergartens/${a.kindergarten.id}/kitchen/reports/purchases?from=2026-04-01&to=2026-04-01`,
      ),
      cookA,
    );
    expect(res.status).toBe(200);
    const row = res.body.find((r: { supplier: { id: string } }) => r.supplier.id === supplier.id);
    expect(row.orderCount).toBe(2);
    // 5000×2.5 + 5000×1.2 = 12500 + 6000
    expect(row.totalAmount).toBe("18500.00");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Recipe cost — Order А/261, kindergarten criterion 38
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Нэг хүүхдэд ногдох өртөг.
 *
 * ★ Exercised through HTTP against real orders rather than against
 * `costOfRecipe` directly, because the arithmetic is the easy half. The part
 * that can actually leak is *which* prices the query picks: the newest one as
 * of a date, from this kindergarten only, ignoring drafts and cancellations.
 * A unit test over a hand-built price map would pass with every one of those
 * wrong.
 */
describe("recipe cost", () => {
  async function supplierFor(session: AuthSession, kindergartenId: string) {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${kindergartenId}/suppliers`),
      session,
    ).send({ name: `Нийлүүлэгч-${Math.random().toString(36).slice(2, 8)}` });
    if (res.status !== 201) throw new Error(`createSupplier failed: ${res.status} ${res.text}`);
    return res.body as { id: string };
  }

  /** Places an order, which is what gives an ingredient a price. */
  async function order(
    session: AuthSession,
    kindergartenId: string,
    supplierId: string,
    orderDate: string,
    lines: { ingredientId: string; quantity: string; unitPrice: string }[],
  ) {
    const res = await authed(
      request(server()).post(`/v1/kindergartens/${kindergartenId}/food-orders`),
      session,
    ).send({ supplierId, orderDate, lines });
    if (res.status !== 201) throw new Error(`order failed: ${res.status} ${res.text}`);
    return res.body as { id: string };
  }

  async function costOf(session: AuthSession, recipeId: string) {
    const res = await authed(request(server()).get(`/v1/recipes/${recipeId}`), session);
    if (res.status !== 200) throw new Error(`getRecipe failed: ${res.status} ${res.text}`);
    return res.body.cost as {
      total: string | null;
      perPortion: string | null;
      unpricedIngredients: string[];
      pricedOn: string;
    };
  }

  it("prices a card from its ingredients and divides by the yield", async () => {
    const supplier = await supplierFor(cookA, a.kindergarten.id);
    const flour = await createIngredient(cookA, a.kindergarten.id, { name: "Гурил" });
    const sugar = await createIngredient(cookA, a.kindergarten.id, { name: "Элсэн чихэр" });

    // 2.5₮/g and 4₮/g, in the ingredients' own unit — the same unit
    // `FoodOrderLine.quantity` is denominated in.
    await order(cookA, a.kindergarten.id, supplier.id, "2026-04-01", [
      { ingredientId: flour.id, quantity: "5000", unitPrice: "2.5" },
      { ingredientId: sugar.id, quantity: "1000", unitPrice: "4" },
    ]);

    const recipe = await createRecipe(cookA, a.kindergarten.id, "Бялуу", 20, [
      { ingredientId: flour.id, quantity: "400" }, // 400 × 2.5 = 1000
      { ingredientId: sugar.id, quantity: "100" }, // 100 × 4   =  400
    ]);

    const cost = await costOf(cookA, recipe.id);
    expect(Number(cost.total)).toBe(1400);
    expect(Number(cost.perPortion)).toBe(70); // 1400 / 20
    expect(cost.unpricedIngredients).toEqual([]);
  });

  /**
   * ★ The one that matters most.
   *
   * An unpriced ingredient nulls the whole figure instead of contributing
   * zero. A card that says 1000₮ when one of its two ingredients was silently
   * skipped is worse than one that says nothing, because nobody can see it is
   * wrong — and this is a number an inspector reads.
   */
  it("refuses to price a card with an ingredient nobody has bought", async () => {
    const supplier = await supplierFor(cookA, a.kindergarten.id);
    const flour = await createIngredient(cookA, a.kindergarten.id, { name: "Гурил" });
    const saffron = await createIngredient(cookA, a.kindergarten.id, { name: "Гүргэм" });

    await order(cookA, a.kindergarten.id, supplier.id, "2026-04-01", [
      { ingredientId: flour.id, quantity: "5000", unitPrice: "2.5" },
    ]);

    const recipe = await createRecipe(cookA, a.kindergarten.id, "Гүргэмтэй будаа", 10, [
      { ingredientId: flour.id, quantity: "400" },
      { ingredientId: saffron.id, quantity: "2" },
    ]);

    const cost = await costOf(cookA, recipe.id);
    expect(cost.total).toBeNull();
    expect(cost.perPortion).toBeNull();
    // Named, so the screen can say which one to go and buy.
    expect(cost.unpricedIngredients).toEqual(["Гүргэм"]);
  });

  it("uses the most recent order's price, not the first or the cheapest", async () => {
    const supplier = await supplierFor(cookA, a.kindergarten.id);
    const flour = await createIngredient(cookA, a.kindergarten.id, { name: "Гурил" });

    await order(cookA, a.kindergarten.id, supplier.id, "2026-04-01", [
      { ingredientId: flour.id, quantity: "1000", unitPrice: "2" },
    ]);
    await order(cookA, a.kindergarten.id, supplier.id, "2026-06-01", [
      { ingredientId: flour.id, quantity: "1000", unitPrice: "3" },
    ]);
    // Out of date order on purpose: the query must sort by `orderDate`, not by
    // the order rows happen to have been inserted in.
    await order(cookA, a.kindergarten.id, supplier.id, "2026-05-01", [
      { ingredientId: flour.id, quantity: "1000", unitPrice: "9" },
    ]);

    const recipe = await createRecipe(cookA, a.kindergarten.id, "Талх", 10, [
      { ingredientId: flour.id, quantity: "1000" },
    ]);

    const cost = await costOf(cookA, recipe.id);
    expect(Number(cost.total)).toBe(3000); // 1000 × 3, June's price
  });

  /**
   * ★ A draft is a number somebody typed and has not committed to.
   *
   * `POST /food-orders` creates an `ORDERED` row, so the draft here is written
   * directly — there is no endpoint that leaves one in `DRAFT`, which is
   * exactly why the filter needs a test rather than being assumed unreachable.
   */
  it("ignores draft and cancelled orders", async () => {
    const supplier = await supplierFor(cookA, a.kindergarten.id);
    const flour = await createIngredient(cookA, a.kindergarten.id, { name: "Гурил" });

    await order(cookA, a.kindergarten.id, supplier.id, "2026-04-01", [
      { ingredientId: flour.id, quantity: "1000", unitPrice: "2" },
    ]);

    for (const status of ["DRAFT", "CANCELLED"] as const) {
      const ignored = await db.foodOrder.create({
        data: {
          kindergartenId: a.kindergarten.id,
          supplierId: supplier.id,
          orderDate: new Date("2026-08-01T00:00:00.000Z"),
          status,
        },
      });
      await db.foodOrderLine.create({
        data: {
          foodOrderId: ignored.id,
          ingredientId: flour.id,
          quantity: "1000",
          unitPrice: "50",
          totalPrice: "50000",
        },
      });
    }

    const recipe = await createRecipe(cookA, a.kindergarten.id, "Талх", 10, [
      { ingredientId: flour.id, quantity: "1000" },
    ]);

    const cost = await costOf(cookA, recipe.id);
    // April's committed 2₮, not August's uncommitted 50₮.
    expect(Number(cost.total)).toBe(2000);
  });

  /**
   * ★ `FoodOrderLine` carries no `kindergartenId` — it reaches its tenant
   * through `FoodOrder`. So the join condition in `latestIngredientPrices` is
   * the only thing standing between one kitchen's costs and another's, which
   * makes it worth a test of its own rather than trusting the base filter that
   * does not exist on this table.
   *
   * Both kindergartens are given an ingredient of the same name, because a
   * cross-tenant leak here would look like a plausible number rather than an
   * error.
   */
  it("never prices a card from another kindergarten's orders", async () => {
    const supplierB = await supplierFor(cookB, b.kindergarten.id);
    const flourB = await createIngredient(cookB, b.kindergarten.id, { name: "Гурил" });
    await order(cookB, b.kindergarten.id, supplierB.id, "2026-04-01", [
      { ingredientId: flourB.id, quantity: "1000", unitPrice: "7" },
    ]);

    const flourA = await createIngredient(cookA, a.kindergarten.id, { name: "Гурил" });
    const recipe = await createRecipe(cookA, a.kindergarten.id, "Талх", 10, [
      { ingredientId: flourA.id, quantity: "1000" },
    ]);

    const cost = await costOf(cookA, recipe.id);
    expect(cost.total).toBeNull();
    expect(cost.unpricedIngredients).toEqual(["Гурил"]);
  });

  /**
   * ★ Cost is money, and a teacher has none of it.
   *
   * `getRecipe` is already behind `assertCanManageKitchen`, so this passes
   * today — it is here so that widening that gate later, for some unrelated
   * reason, cannot quietly put a price in front of a teacher. "Багш санхүүгийн
   * бүрэн мэдээллийг харах эрхгүй" is the client's own instruction.
   */
  it("a teacher gets 404 on the card, so never sees its cost", async () => {
    const flour = await createIngredient(cookA, a.kindergarten.id, { name: "Гурил" });
    const recipe = await createRecipe(cookA, a.kindergarten.id, "Талх", 10, [
      { ingredientId: flour.id, quantity: "1000" },
    ]);

    const res = await authed(request(server()).get(`/v1/recipes/${recipe.id}`), teacherA);
    expect(res.status).toBe(404);
  });

  /**
   * ★ A card with no lines costs nothing *knowable*, not nothing.
   *
   * `POST /recipes` refuses an empty `ingredients` array — "Дор хаяж нэг орц
   * оруулна уу" — so this state is not reachable through the API and the test
   * that tried was wrong about the product. It is still reachable in the
   * database, which is what makes the guard worth keeping: `0₮` on a card
   * whose lines have gone reads as "this meal is free" rather than "there is
   * nothing here to price", and the two need different actions.
   */
  it("does not price a card with no ingredient lines as free", async () => {
    const flour = await createIngredient(cookA, a.kindergarten.id, { name: "Гурил" });
    const recipe = await createRecipe(cookA, a.kindergarten.id, "Шинэ карт", 10, [
      { ingredientId: flour.id, quantity: "1000" },
    ]);

    const empty = await authed(
      request(server()).post(`/v1/kindergartens/${a.kindergarten.id}/recipes`),
      cookA,
    ).send({
      name: "Хоосон",
      yieldPortions: 10,
      ingredients: [],
    });
    expect(empty.status).toBe(400);

    await db.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });

    const cost = await costOf(cookA, recipe.id);
    expect(cost.total).toBeNull();
    expect(cost.perPortion).toBeNull();
    expect(cost.unpricedIngredients).toEqual([]);
  });

  /** The list stays one query — costing forty cards would be forty lookups. */
  it("omits the cost from the list view", async () => {
    const flour = await createIngredient(cookA, a.kindergarten.id, { name: "Гурил" });
    await createRecipe(cookA, a.kindergarten.id, "Талх", 10, [
      { ingredientId: flour.id, quantity: "1000" },
    ]);

    const res = await authed(
      request(server()).get(`/v1/kindergartens/${a.kindergarten.id}/recipes`),
      cookA,
    );
    expect(res.status).toBe(200);
    expect(res.body.items[0].cost).toBeUndefined();
  });
});

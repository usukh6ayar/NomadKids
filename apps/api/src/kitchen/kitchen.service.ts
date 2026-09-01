import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { paginate, toSkipTake } from "../common/pagination";
import { parseDishes } from "../meals/dish-json";
import { KitchenRepository } from "./kitchen.repository";
import type {
  CreateFoodOrderDto,
  CreateIngredientDto,
  CreateRecipeDto,
  CreateSupplierDto,
  KitchenReportsQuery,
  ListFoodOrdersQuery,
  ListIngredientsQuery,
  ListRecipesQuery,
  ListStockMovementsQuery,
  ListSuppliersQuery,
  ReceiveFoodOrderDto,
  StockAdjustmentDto,
  UpdateFoodOrderDto,
  UpdateIngredientDto,
  UpdateRecipeDto,
  UpdateSupplierDto,
} from "./kitchen.dto";

/**
 * Ingredients, technology cards, suppliers, food orders, stock and the
 * kitchen's own reports — Хоол үйлдвэрлэл, нэмэлт.md's gap list. §2.3's
 * config-table rule and §3.1/§3.2's tenant-scoping and soft-delete apply
 * throughout; `StockMovement` is the one append-only exception, same as
 * `AuditLog`.
 */
@Injectable()
export class KitchenService {
  constructor(
    private readonly repo: KitchenRepository,
    private readonly tenants: TenantAccessService,
    private readonly audit: AuditRepository,
  ) {}

  // ── Ingredients ────────────────────────────────────────────────────────

  async listIngredients(actor: Actor, kindergartenId: string, query: ListIngredientsQuery) {
    this.tenants.assertCanManageKitchen(actor, kindergartenId);
    const { skip, take } = toSkipTake(query);
    const { items, total } = await this.repo.listIngredients(kindergartenId, skip, take);
    return paginate(items, total, query);
  }

  async createIngredient(actor: Actor, kindergartenId: string, dto: CreateIngredientDto) {
    this.tenants.assertCanManageKitchen(actor, kindergartenId);

    const created = await this.guardUniqueName(() =>
      this.repo.createIngredient({ ...dto, kindergartenId, createdById: actor.userId }),
    );

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "Ingredient",
      objectId: created.id,
      metadata: { name: dto.name, unit: dto.unit },
    });

    return created;
  }

  async updateIngredient(actor: Actor, id: string, dto: UpdateIngredientDto) {
    const ingredient = await this.repo.findIngredient(id);
    if (!ingredient) throw new NotFoundException();
    this.tenants.assertCanManageKitchen(actor, ingredient.kindergartenId);

    const saved = await this.guardUniqueName(() => this.repo.updateIngredient(id, dto));

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: ingredient.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Ingredient",
      objectId: id,
      metadata: { after: dto },
    });

    return saved;
  }

  /** Refuses when a live technology card still calls for this ingredient —
   * soft-deleting it out from under a recipe would leave the card's
   * nutrition and allergen figures silently wrong. */
  async removeIngredient(actor: Actor, id: string) {
    const ingredient = await this.repo.findIngredient(id);
    if (!ingredient) throw new NotFoundException();
    this.tenants.assertCanManageKitchen(actor, ingredient.kindergartenId);

    const usage = await this.repo.countRecipeUsage(id);
    if (usage > 0) {
      throw new ConflictException(
        `Энэ орцыг ${usage} технологийн картад ашиглаж байгаа тул устгах боломжгүй`,
      );
    }

    await this.repo.softDeleteIngredient(id);
    await this.audit.append({
      action: "DELETE",
      kindergartenId: ingredient.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Ingredient",
      objectId: id,
    });

    return { id };
  }

  // ── Recipes (технологийн карт) ────────────────────────────────────────

  async listRecipes(actor: Actor, kindergartenId: string, query: ListRecipesQuery) {
    this.tenants.assertCanManageKitchen(actor, kindergartenId);
    const { skip, take } = toSkipTake(query);
    const { items, total } = await this.repo.listRecipes(kindergartenId, query.status, skip, take);
    return paginate(items.map(toRecipeResponse), total, query);
  }

  /** Every APPROVED card, unpaginated — the menu screen's "select a
   * technology card" list. Read-gated the same as the menu itself
   * (`assertCanManageMeals`, COOK/TEACHER/ADMIN), narrower than the rest of
   * this service: it is reference data the shared menu screen needs, not the
   * kitchen's own production record. */
  async listApprovedRecipesForMenu(actor: Actor, kindergartenId: string) {
    this.tenants.assertCanManageMeals(actor, kindergartenId);
    return this.repo.listApprovedRecipes(kindergartenId);
  }

  async getRecipe(actor: Actor, id: string) {
    const recipe = await this.repo.findRecipe(id);
    if (!recipe) throw new NotFoundException();
    this.tenants.assertCanManageKitchen(actor, recipe.kindergartenId);
    return toRecipeResponse(recipe);
  }

  async createRecipe(actor: Actor, kindergartenId: string, dto: CreateRecipeDto) {
    this.tenants.assertCanManageKitchen(actor, kindergartenId);
    await this.assertIngredientsBelong(
      kindergartenId,
      dto.ingredients.map((line) => line.ingredientId),
    );

    const created = await this.repo.createRecipe(
      kindergartenId,
      actor.userId,
      {
        name: dto.name,
        mealKind: dto.mealKind ?? null,
        yieldPortions: dto.yieldPortions,
        instructions: dto.instructions ?? null,
      },
      dto.ingredients.map((line, index) => ({
        ingredientId: line.ingredientId,
        quantity: line.quantity,
        position: index,
      })),
    );

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "Recipe",
      objectId: created.id,
      metadata: { name: dto.name, yieldPortions: dto.yieldPortions },
    });

    return toRecipeResponse(created);
  }

  /**
   * ★ Any change to an APPROVED card reverts it to DRAFT.
   *
   * A батлагдсан technology card is a signed-off document — the whole point
   * of `RecipeStatus`. Letting a cook edit ingredients or the yield without
   * losing the approval would leave a menu showing "Батлагдсан" against a
   * card nobody actually reviewed in its current form.
   */
  async updateRecipe(actor: Actor, id: string, dto: UpdateRecipeDto) {
    const recipe = await this.repo.findRecipe(id);
    if (!recipe) throw new NotFoundException();
    this.tenants.assertCanManageKitchen(actor, recipe.kindergartenId);

    if (dto.ingredients) {
      await this.assertIngredientsBelong(
        recipe.kindergartenId,
        dto.ingredients.map((line) => line.ingredientId),
      );
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.mealKind !== undefined) data.mealKind = dto.mealKind;
    if (dto.yieldPortions !== undefined) data.yieldPortions = dto.yieldPortions;
    if (dto.instructions !== undefined) data.instructions = dto.instructions;

    if (recipe.status === "APPROVED") {
      data.status = "DRAFT";
      data.approvedById = null;
      data.approvedAt = null;
    }

    const lines = dto.ingredients
      ? dto.ingredients.map((line, index) => ({
          ingredientId: line.ingredientId,
          quantity: line.quantity,
          position: index,
        }))
      : null;

    const saved = await this.repo.updateRecipe(id, data, lines);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: recipe.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Recipe",
      objectId: id,
      metadata: {
        after: data,
        ingredientsChanged: Boolean(lines),
        revertedApproval: recipe.status === "APPROVED",
      },
    });

    return toRecipeResponse(saved);
  }

  async approveRecipe(actor: Actor, id: string) {
    const recipe = await this.repo.findRecipe(id);
    if (!recipe) throw new NotFoundException();
    this.tenants.assertCanManageKitchen(actor, recipe.kindergartenId);

    if (recipe.status === "APPROVED") return toRecipeResponse(recipe);
    if (recipe.ingredients.length === 0) {
      throw new BadRequestException("Орцгүй технологийн картыг батлах боломжгүй");
    }

    const saved = await this.repo.updateRecipe(
      id,
      { status: "APPROVED", approvedById: actor.userId, approvedAt: new Date() },
      null,
    );

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: recipe.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Recipe",
      objectId: id,
      metadata: { approved: true },
    });

    return toRecipeResponse(saved);
  }

  async removeRecipe(actor: Actor, id: string) {
    const recipe = await this.repo.findRecipe(id);
    if (!recipe) throw new NotFoundException();
    this.tenants.assertCanManageKitchen(actor, recipe.kindergartenId);

    await this.repo.softDeleteRecipe(id);
    await this.audit.append({
      action: "DELETE",
      kindergartenId: recipe.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Recipe",
      objectId: id,
    });

    return { id };
  }

  /**
   * For freezing a menu dish's derived fields at save time — see
   * `MealsService.saveDay`. Throws rather than returning null: a dish
   * pointing at a missing or unapproved card is a request error, not a state
   * `MealsService` should silently paper over.
   */
  async resolveApprovedRecipeForDish(
    kindergartenId: string,
    recipeId: string,
  ): Promise<{ name: string; allergenTags: string[]; calories: number | null }> {
    const recipe = await this.repo.findRecipe(recipeId);
    if (!recipe || recipe.kindergartenId !== kindergartenId) {
      throw new BadRequestException("Технологийн карт олдсонгүй");
    }
    if (recipe.status !== "APPROVED") {
      throw new BadRequestException("Зөвхөн батлагдсан технологийн картыг цэсэнд ашиглана");
    }

    const perPortion = dividePortions(sumNutrition(recipe.ingredients), recipe.yieldPortions);
    return {
      name: recipe.name,
      allergenTags: deriveAllergenTags(recipe.ingredients),
      calories: perPortion.calories,
    };
  }

  /**
   * The recipe's ingredient lines, for `POST .../consume` to scale by
   * portions served. `null` rather than a throw when the recipe has since
   * been deleted — consumption skips that dish instead of failing the whole
   * day (the dish's frozen name/allergens/calories still stand either way).
   */
  async getRecipeIngredientLines(
    kindergartenId: string,
    recipeId: string,
  ): Promise<{
    yieldPortions: number;
    lines: { ingredientId: string; quantity: number }[];
  } | null> {
    const recipe = await this.repo.findRecipe(recipeId);
    if (!recipe || recipe.kindergartenId !== kindergartenId) return null;

    return {
      yieldPortions: recipe.yieldPortions,
      lines: recipe.ingredients.map((line) => ({
        ingredientId: line.ingredientId,
        quantity: Number(line.quantity),
      })),
    };
  }

  /** Writes one `StockMovement` OUT per ingredient a day's cooking consumed
   * — called by `MealsService.consumeDay`, which already resolved which
   * recipes/portions to deduct. Kitchen-ledger logic, kept here rather than
   * duplicated in the meals module. */
  async consumeForMenuDay(
    kindergartenId: string,
    menuDayId: string,
    createdById: string,
    date: Date,
    deductions: Map<string, number>,
    note: string,
  ): Promise<void> {
    const rows = [...deductions.entries()].map(([ingredientId, quantity]) => ({
      ingredientId,
      quantity: quantity.toFixed(2),
      note,
    }));
    await this.repo.recordConsumption(menuDayId, kindergartenId, createdById, date, rows);
  }

  private async assertIngredientsBelong(
    kindergartenId: string,
    ingredientIds: string[],
  ): Promise<void> {
    const unique = [...new Set(ingredientIds)];
    const found = await this.repo.findIngredientsByIds(kindergartenId, unique);
    if (found.length !== unique.length) {
      throw new BadRequestException("Орцны жагсаалтад буруу орц байна");
    }
  }

  // ── Suppliers ────────────────────────────────────────────────────────────

  async listSuppliers(actor: Actor, kindergartenId: string, query: ListSuppliersQuery) {
    this.tenants.assertCanManageKitchen(actor, kindergartenId);
    const { skip, take } = toSkipTake(query);
    const { items, total } = await this.repo.listSuppliers(kindergartenId, skip, take);
    return paginate(items, total, query);
  }

  async createSupplier(actor: Actor, kindergartenId: string, dto: CreateSupplierDto) {
    this.tenants.assertCanManageKitchen(actor, kindergartenId);

    const created = await this.repo.createSupplier({ ...dto, kindergartenId });

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "Supplier",
      objectId: created.id,
      metadata: { name: dto.name },
    });

    return created;
  }

  async updateSupplier(actor: Actor, id: string, dto: UpdateSupplierDto) {
    const supplier = await this.repo.findSupplier(id);
    if (!supplier) throw new NotFoundException();
    this.tenants.assertCanManageKitchen(actor, supplier.kindergartenId);

    const saved = await this.repo.updateSupplier(id, dto);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: supplier.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Supplier",
      objectId: id,
      metadata: { after: dto },
    });

    return saved;
  }

  async removeSupplier(actor: Actor, id: string) {
    const supplier = await this.repo.findSupplier(id);
    if (!supplier) throw new NotFoundException();
    this.tenants.assertCanManageKitchen(actor, supplier.kindergartenId);

    await this.repo.softDeleteSupplier(id);
    await this.audit.append({
      action: "DELETE",
      kindergartenId: supplier.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Supplier",
      objectId: id,
    });

    return { id };
  }

  // ── Food orders (Хүнсний захиалга) ────────────────────────────────────

  async listFoodOrders(actor: Actor, kindergartenId: string, query: ListFoodOrdersQuery) {
    this.tenants.assertCanManageKitchen(actor, kindergartenId);
    const { skip, take } = toSkipTake(query);
    const { items, total } = await this.repo.listFoodOrders(
      kindergartenId,
      query.status,
      skip,
      take,
    );
    return paginate(items.map(toFoodOrderResponse), total, query);
  }

  async getFoodOrder(actor: Actor, id: string) {
    const order = await this.repo.findFoodOrder(id);
    if (!order) throw new NotFoundException();
    this.tenants.assertCanManageKitchen(actor, order.kindergartenId);
    return toFoodOrderResponse(order);
  }

  async createFoodOrder(actor: Actor, kindergartenId: string, dto: CreateFoodOrderDto) {
    this.tenants.assertCanManageKitchen(actor, kindergartenId);
    await this.assertIngredientsBelong(
      kindergartenId,
      dto.lines.map((line) => line.ingredientId),
    );

    const supplier = await this.repo.findSupplier(dto.supplierId);
    if (!supplier || supplier.kindergartenId !== kindergartenId) {
      throw new BadRequestException("Нийлүүлэгч олдсонгүй");
    }

    const lines = dto.lines.map((line) => ({
      ingredientId: line.ingredientId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      totalPrice: lineTotal(line.quantity, line.unitPrice),
    }));

    const created = await this.repo.createFoodOrder(
      kindergartenId,
      actor.userId,
      { supplierId: dto.supplierId, orderDate: toDate(dto.orderDate), note: dto.note ?? null },
      lines,
    );

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "FoodOrder",
      objectId: created.id,
      metadata: { supplierId: dto.supplierId, lineCount: lines.length },
    });

    return toFoodOrderResponse(created);
  }

  async updateFoodOrder(actor: Actor, id: string, dto: UpdateFoodOrderDto) {
    const order = await this.repo.findFoodOrder(id);
    if (!order) throw new NotFoundException();
    this.tenants.assertCanManageKitchen(actor, order.kindergartenId);

    if (order.status === "RECEIVED" || order.status === "CANCELLED") {
      throw new BadRequestException("Хүлээн авсан эсвэл цуцалсан захиалгыг өөрчлөх боломжгүй");
    }

    let lines:
      { ingredientId: string; quantity: string; unitPrice: string; totalPrice: string }[] | null =
      null;
    if (dto.lines) {
      await this.assertIngredientsBelong(
        order.kindergartenId,
        dto.lines.map((line) => line.ingredientId),
      );
      lines = dto.lines.map((line) => ({
        ingredientId: line.ingredientId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        totalPrice: lineTotal(line.quantity, line.unitPrice),
      }));
    }

    const data: Record<string, unknown> = {};
    if (dto.orderDate !== undefined) data.orderDate = toDate(dto.orderDate);
    if (dto.note !== undefined) data.note = dto.note;
    if (dto.status !== undefined) data.status = dto.status;

    const saved = await this.repo.updateFoodOrder(id, data, lines);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: order.kindergartenId,
      actorUserId: actor.userId,
      objectType: "FoodOrder",
      objectId: id,
      metadata: { after: data, linesChanged: Boolean(lines) },
    });

    return toFoodOrderResponse(saved);
  }

  /**
   * Marks the order received and moves stock — the food-cost trail's
   * "нийлүүлэгчийн гарал үүсэл" arriving in the kitchen. One `StockMovement`
   * IN per line, in the transaction `KitchenRepository.receiveFoodOrder`
   * runs, so a received order and its stock effect can never disagree.
   */
  async receiveFoodOrder(actor: Actor, id: string, dto: ReceiveFoodOrderDto) {
    const order = await this.repo.findFoodOrder(id);
    if (!order) throw new NotFoundException();
    this.tenants.assertCanManageKitchen(actor, order.kindergartenId);

    if (order.status === "RECEIVED")
      throw new BadRequestException("Захиалга аль хэдийн хүлээн авсан байна");
    if (order.status === "CANCELLED")
      throw new BadRequestException("Цуцалсан захиалгыг хүлээн авах боломжгүй");

    const overrides = new Map(dto.lines.map((line) => [line.lineId, line.receivedQuantity]));
    const receipts = order.lines.map((line) => ({
      lineId: line.id,
      ingredientId: line.ingredientId,
      quantity: overrides.get(line.id) ?? line.quantity.toString(),
    }));

    const saved = await this.repo.receiveFoodOrder(
      id,
      order.kindergartenId,
      actor.userId,
      receipts,
      new Date(),
    );

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: order.kindergartenId,
      actorUserId: actor.userId,
      objectType: "FoodOrder",
      objectId: id,
      metadata: { received: true, lineCount: receipts.length },
    });

    return toFoodOrderResponse(saved);
  }

  // ── Stock ──────────────────────────────────────────────────────────────

  async stockLevels(actor: Actor, kindergartenId: string) {
    this.tenants.assertCanManageKitchen(actor, kindergartenId);
    return this.repo.stockLevels(kindergartenId);
  }

  async listStockMovements(actor: Actor, kindergartenId: string, query: ListStockMovementsQuery) {
    this.tenants.assertCanManageKitchen(actor, kindergartenId);
    const { skip, take } = toSkipTake(query);
    const { items, total } = await this.repo.listStockMovements(
      kindergartenId,
      query.ingredientId,
      skip,
      take,
    );
    return paginate(items, total, query);
  }

  async createAdjustment(actor: Actor, kindergartenId: string, dto: StockAdjustmentDto) {
    this.tenants.assertCanManageKitchen(actor, kindergartenId);

    const ingredient = await this.repo.findIngredient(dto.ingredientId);
    if (!ingredient || ingredient.kindergartenId !== kindergartenId) {
      throw new BadRequestException("Орц олдсонгүй");
    }

    const signed = Number(dto.quantity);
    const created = await this.repo.createStockMovement({
      kindergartenId,
      ingredientId: dto.ingredientId,
      date: toDate(dto.date),
      direction: signed >= 0 ? "IN" : "OUT",
      quantity: Math.abs(signed).toFixed(2),
      sourceType: "ADJUSTMENT",
      note: dto.note ?? null,
      createdById: actor.userId,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "StockMovement",
      objectId: created.id,
      metadata: { ingredientId: dto.ingredientId, quantity: dto.quantity, note: dto.note ?? null },
    });

    return created;
  }

  // ── Reports ────────────────────────────────────────────────────────────

  async consumptionReport(actor: Actor, kindergartenId: string, query: KitchenReportsQuery) {
    this.tenants.assertCanManageKitchen(actor, kindergartenId);
    return this.repo.consumptionReport(kindergartenId, toDate(query.from), toDate(query.to));
  }

  /**
   * One row per day — the average nutrition of one child's portion that day,
   * over every recipe-linked dish. No `MealRecord`/attendance is read here;
   * the plan's own explicit scope cut (see the plan doc's "explicit scope
   * cuts").
   *
   * ★ `dish.portions` is a batch multiplier, not a headcount — the same
   * reading `MealsService.consumeDay` uses. The children actually fed by one
   * dish is `portions × recipe.yieldPortions`, which is what this weights by;
   * treating `portions` itself as a headcount would understate a day's
   * average by however large each card's batch is.
   *
   * ★★ Batched: every distinct recipe the range's menu days reference is
   * fetched once, not once per day — a term's worth of days would otherwise
   * be the N+1 CLAUDE.md §3.4 forbids.
   */
  async nutritionReport(actor: Actor, kindergartenId: string, query: KitchenReportsQuery) {
    this.tenants.assertCanManageKitchen(actor, kindergartenId);

    const days = await this.repo.menuDaysInRange(
      kindergartenId,
      toDate(query.from),
      toDate(query.to),
    );
    const withDishes = days.map((day) => ({
      date: day.date,
      dishes: parseDishes(day.dishes).filter(
        (dish) => dish.recipeId && dish.portions && dish.portions > 0,
      ),
    }));

    const recipeIds = [
      ...new Set(withDishes.flatMap((day) => day.dishes.map((dish) => dish.recipeId!))),
    ];
    const recipes =
      recipeIds.length > 0 ? await this.repo.findRecipesByIds(kindergartenId, recipeIds) : [];
    const perPortionByRecipe = new Map(
      recipes.map((recipe) => [
        recipe.id,
        dividePortions(sumNutrition(recipe.ingredients), recipe.yieldPortions),
      ]),
    );
    const yieldByRecipe = new Map(recipes.map((recipe) => [recipe.id, recipe.yieldPortions]));

    return withDishes
      .filter((day) => day.dishes.length > 0)
      .map((day) => {
        let totalPortions = 0;
        const totals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
        const missing = { calories: false, protein: false, fat: false, carbs: false };

        for (const dish of day.dishes) {
          const perPortion = perPortionByRecipe.get(dish.recipeId!);
          const yieldPortions = yieldByRecipe.get(dish.recipeId!);
          if (!perPortion || !yieldPortions) continue;

          const fedByThisDish = dish.portions! * yieldPortions;
          totalPortions += fedByThisDish;

          for (const key of ["calories", "protein", "fat", "carbs"] as const) {
            if (perPortion[key] === null) missing[key] = true;
            else totals[key] += perPortion[key]! * fedByThisDish;
          }
        }

        const finish = (key: "calories" | "protein" | "fat" | "carbs", decimals: number) =>
          totalPortions > 0 && !missing[key] ? round(totals[key] / totalPortions, decimals) : null;

        return {
          date: day.date,
          totalPortions,
          perPortion: {
            calories: finish("calories", 0),
            protein: finish("protein", 1),
            fat: finish("fat", 1),
            carbs: finish("carbs", 1),
          },
        };
      });
  }

  async purchaseReport(actor: Actor, kindergartenId: string, query: KitchenReportsQuery) {
    this.tenants.assertCanManageKitchen(actor, kindergartenId);
    return this.repo.purchaseReport(kindergartenId, toDate(query.from), toDate(query.to));
  }

  private async guardUniqueName<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException("Ийм нэртэй орц бүртгэлтэй байна");
      throw error;
    }
  }
}

// ── Nutrition/allergen calculation — derived, never stored. See the
// schema.prisma "Kitchen production" section header for why. ────────────────

export interface NutritionTotals {
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
}

interface RecipeIngredientForCalc {
  quantity: unknown;
  ingredient: {
    caloriesPer100: unknown | null;
    proteinPer100: unknown | null;
    fatPer100: unknown | null;
    carbsPer100: unknown | null;
    allergenTags: string[];
  };
}

function sumNutrition(lines: RecipeIngredientForCalc[]): NutritionTotals {
  const totals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
  const present = { calories: true, protein: true, fat: true, carbs: true };

  const accumulate = (key: keyof typeof totals, per100: unknown | null, qty: number) => {
    if (per100 === null) {
      present[key] = false;
      return;
    }
    totals[key] += (Number(per100) * qty) / 100;
  };

  for (const line of lines) {
    const qty = Number(line.quantity);
    accumulate("calories", line.ingredient.caloriesPer100, qty);
    accumulate("protein", line.ingredient.proteinPer100, qty);
    accumulate("fat", line.ingredient.fatPer100, qty);
    accumulate("carbs", line.ingredient.carbsPer100, qty);
  }

  return {
    calories: present.calories ? round(totals.calories, 0) : null,
    protein: present.protein ? round(totals.protein, 1) : null,
    fat: present.fat ? round(totals.fat, 1) : null,
    carbs: present.carbs ? round(totals.carbs, 1) : null,
  };
}

function dividePortions(total: NutritionTotals, portions: number): NutritionTotals {
  return {
    calories: total.calories === null ? null : round(total.calories / portions, 0),
    protein: total.protein === null ? null : round(total.protein / portions, 1),
    fat: total.fat === null ? null : round(total.fat / portions, 1),
    carbs: total.carbs === null ? null : round(total.carbs / portions, 1),
  };
}

function deriveAllergenTags(lines: RecipeIngredientForCalc[]): string[] {
  const set = new Set<string>();
  for (const line of lines) for (const tag of line.ingredient.allergenTags) set.add(tag);
  return [...set];
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// ── Response shaping ─────────────────────────────────────────────────────

interface RecipeRow {
  id: string;
  name: string;
  mealKind: string | null;
  yieldPortions: number;
  instructions: string | null;
  status: string;
  approvedAt: Date | null;
  createdAt: Date;
  ingredients: (RecipeIngredientForCalc & {
    id: string;
    ingredient: { id: string; name: string; unit: string };
  })[];
}

function toRecipeResponse(recipe: RecipeRow) {
  const nutritionTotal = sumNutrition(recipe.ingredients);
  const nutritionPerPortion = dividePortions(nutritionTotal, recipe.yieldPortions);

  return {
    id: recipe.id,
    name: recipe.name,
    mealKind: recipe.mealKind,
    yieldPortions: recipe.yieldPortions,
    instructions: recipe.instructions,
    status: recipe.status,
    approvedAt: recipe.approvedAt,
    ingredients: recipe.ingredients.map((line) => ({
      id: line.id,
      ingredient: {
        id: line.ingredient.id,
        name: line.ingredient.name,
        unit: line.ingredient.unit,
      },
      quantity: (line.quantity as { toString(): string }).toString(),
    })),
    nutritionTotal,
    nutritionPerPortion,
    allergenTags: deriveAllergenTags(recipe.ingredients),
    createdAt: recipe.createdAt,
  };
}

interface FoodOrderRow {
  id: string;
  supplier: { id: string; name: string };
  orderDate: Date;
  status: string;
  note: string | null;
  createdAt: Date;
  lines: {
    id: string;
    ingredient: { id: string; name: string; unit: string };
    quantity: { toString(): string };
    unitPrice: { toString(): string };
    totalPrice: { toString(): string };
    receivedQuantity: { toString(): string } | null;
  }[];
}

function toFoodOrderResponse(order: FoodOrderRow) {
  const totalAmount = order.lines.reduce(
    (sum, line) => sum + Number(line.totalPrice.toString()),
    0,
  );

  return {
    id: order.id,
    supplier: order.supplier,
    orderDate: order.orderDate,
    status: order.status,
    note: order.note,
    lines: order.lines.map((line) => ({
      id: line.id,
      ingredient: line.ingredient,
      quantity: line.quantity.toString(),
      unitPrice: line.unitPrice.toString(),
      totalPrice: line.totalPrice.toString(),
      receivedQuantity: line.receivedQuantity?.toString() ?? null,
    })),
    totalAmount: totalAmount.toFixed(2),
    createdAt: order.createdAt,
  };
}

function lineTotal(quantity: string, unitPrice: string): string {
  return (Number(quantity) * Number(unitPrice)).toFixed(2);
}

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

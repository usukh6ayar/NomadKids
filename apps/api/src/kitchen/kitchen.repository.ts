import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type {
  FoodOrderStatus,
  IngredientUnit,
  RecipeStatus,
  StockDirection,
} from "../domain/enums";

const unitRefSelect = {
  select: { id: true, name: true, unit: true },
} as const;

/** A recipe line's ingredient, with the nutrition/allergen fields
 * `KitchenService`'s calculation needs — not just the display-only ref. */
const nutritionIngredientSelect = {
  select: {
    id: true,
    name: true,
    unit: true,
    caloriesPer100: true,
    proteinPer100: true,
    fatPer100: true,
    carbsPer100: true,
    allergenTags: true,
  },
} as const;

/**
 * Ingredients, technology cards, suppliers, food orders and the stock ledger
 * — Хоол үйлдвэрлэл. The only Prisma import site for this domain (§2.2).
 */
@Injectable()
export class KitchenRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Ingredients ──────────────────────────────────────────────────────────

  async listIngredients(kindergartenId: string, skip: number, take: number) {
    const where = { kindergartenId, deletedAt: null };
    const [items, total] = await Promise.all([
      this.prisma.ingredient.findMany({ where, orderBy: { name: "asc" }, skip, take }),
      this.prisma.ingredient.count({ where }),
    ]);
    return { items, total };
  }

  async findIngredient(id: string) {
    return this.prisma.ingredient.findFirst({ where: { id, deletedAt: null } });
  }

  async createIngredient(data: Record<string, unknown>) {
    return this.prisma.ingredient.create({ data: data as never });
  }

  async updateIngredient(id: string, data: Record<string, unknown>) {
    return this.prisma.ingredient.update({ where: { id }, data });
  }

  async softDeleteIngredient(id: string) {
    return this.prisma.ingredient.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** For validating a recipe/order line's ingredient ids belong to this
   * kindergarten before writing anything — one query, not one per line. */
  async findIngredientsByIds(kindergartenId: string, ids: string[]) {
    return this.prisma.ingredient.findMany({
      where: { id: { in: ids }, kindergartenId, deletedAt: null },
      select: { id: true },
    });
  }

  /** How many live technology cards still call for this ingredient — the
   * count `KitchenService` reports rather than let a delete silently orphan a
   * recipe line. */
  async countRecipeUsage(ingredientId: string): Promise<number> {
    return this.prisma.recipeIngredient.count({
      where: { ingredientId, recipe: { deletedAt: null } },
    });
  }

  // ── Recipes (технологийн карт) ──────────────────────────────────────────

  async listRecipes(
    kindergartenId: string,
    status: RecipeStatus | undefined,
    skip: number,
    take: number,
  ) {
    const where = { kindergartenId, deletedAt: null, ...(status ? { status } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.recipe.findMany({
        where,
        orderBy: { name: "asc" },
        skip,
        take,
        include: { ingredients: { include: { ingredient: nutritionIngredientSelect } } },
      }),
      this.prisma.recipe.count({ where }),
    ]);
    return { items, total };
  }

  /** Every APPROVED recipe, unpaginated — the menu day's "select a technology
   * card" list, which a cook needs in full to plan a week. */
  async listApprovedRecipes(kindergartenId: string) {
    return this.prisma.recipe.findMany({
      where: { kindergartenId, deletedAt: null, status: "APPROVED" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, yieldPortions: true, mealKind: true },
    });
  }

  async findRecipe(id: string) {
    return this.prisma.recipe.findFirst({
      where: { id, deletedAt: null },
      include: {
        ingredients: {
          include: { ingredient: nutritionIngredientSelect },
          orderBy: { position: "asc" },
        },
      },
    });
  }

  async createRecipe(
    kindergartenId: string,
    createdById: string,
    data: {
      name: string;
      mealKind: string | null;
      yieldPortions: number;
      instructions: string | null;
    },
    lines: { ingredientId: string; quantity: string; position: number }[],
  ) {
    const created = await this.prisma.recipe.create({
      data: {
        kindergartenId,
        createdById,
        name: data.name,
        mealKind: data.mealKind as never,
        yieldPortions: data.yieldPortions,
        instructions: data.instructions,
        ingredients: { create: lines },
      },
      include: {
        ingredients: {
          include: { ingredient: nutritionIngredientSelect },
          orderBy: { position: "asc" },
        },
      },
    });
    return created;
  }

  /**
   * Replaces name/yield/instructions and, when `lines` is given, the whole
   * ingredient list in one transaction — a partial line update has no
   * sensible meaning for a document a nutrition figure is computed from.
   */
  async updateRecipe(
    id: string,
    data: Record<string, unknown>,
    lines: { ingredientId: string; quantity: string; position: number }[] | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (lines) {
        await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });
        await tx.recipeIngredient.createMany({
          data: lines.map((line) => ({ ...line, recipeId: id })),
        });
      }

      return tx.recipe.update({
        where: { id },
        data,
        include: {
          ingredients: {
            include: { ingredient: nutritionIngredientSelect },
            orderBy: { position: "asc" },
          },
        },
      });
    });
  }

  async softDeleteRecipe(id: string) {
    return this.prisma.recipe.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** Batched recipe + nutrition lookup for the nutrition report — one query
   * for every recipe a date range's menu days reference, not one per day. */
  async findRecipesByIds(kindergartenId: string, ids: string[]) {
    return this.prisma.recipe.findMany({
      where: { id: { in: ids }, kindergartenId, deletedAt: null },
      include: { ingredients: { include: { ingredient: nutritionIngredientSelect } } },
    });
  }

  // ── Suppliers ────────────────────────────────────────────────────────────

  async listSuppliers(kindergartenId: string, skip: number, take: number) {
    const where = { kindergartenId, deletedAt: null };
    const [items, total] = await Promise.all([
      this.prisma.supplier.findMany({ where, orderBy: { name: "asc" }, skip, take }),
      this.prisma.supplier.count({ where }),
    ]);
    return { items, total };
  }

  async findSupplier(id: string) {
    return this.prisma.supplier.findFirst({ where: { id, deletedAt: null } });
  }

  async createSupplier(data: Record<string, unknown>) {
    return this.prisma.supplier.create({ data: data as never });
  }

  async updateSupplier(id: string, data: Record<string, unknown>) {
    return this.prisma.supplier.update({ where: { id }, data });
  }

  async softDeleteSupplier(id: string) {
    return this.prisma.supplier.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ── Food orders (Хүнсний захиалга) ──────────────────────────────────────

  private readonly foodOrderInclude = {
    supplier: { select: { id: true, name: true } },
    lines: { include: { ingredient: unitRefSelect } },
  } as const;

  async listFoodOrders(
    kindergartenId: string,
    status: FoodOrderStatus | undefined,
    skip: number,
    take: number,
  ) {
    const where = { kindergartenId, deletedAt: null, ...(status ? { status } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.foodOrder.findMany({
        where,
        orderBy: { orderDate: "desc" },
        skip,
        take,
        include: this.foodOrderInclude,
      }),
      this.prisma.foodOrder.count({ where }),
    ]);
    return { items, total };
  }

  async findFoodOrder(id: string) {
    return this.prisma.foodOrder.findFirst({
      where: { id, deletedAt: null },
      include: this.foodOrderInclude,
    });
  }

  async createFoodOrder(
    kindergartenId: string,
    createdById: string,
    data: { supplierId: string; orderDate: Date; note: string | null },
    lines: { ingredientId: string; quantity: string; unitPrice: string; totalPrice: string }[],
  ) {
    return this.prisma.foodOrder.create({
      data: {
        kindergartenId,
        createdById,
        supplierId: data.supplierId,
        orderDate: data.orderDate,
        note: data.note,
        status: "ORDERED",
        lines: { create: lines },
      },
      include: this.foodOrderInclude,
    });
  }

  async updateFoodOrder(
    id: string,
    data: Record<string, unknown>,
    lines:
      { ingredientId: string; quantity: string; unitPrice: string; totalPrice: string }[] | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (lines) {
        await tx.foodOrderLine.deleteMany({ where: { foodOrderId: id } });
        await tx.foodOrderLine.createMany({
          data: lines.map((line) => ({ ...line, foodOrderId: id })),
        });
      }

      return tx.foodOrder.update({ where: { id }, data, include: this.foodOrderInclude });
    });
  }

  async softDeleteFoodOrder(id: string) {
    return this.prisma.foodOrder.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /**
   * Marks an order RECEIVED, records what actually arrived per line, and
   * writes one `StockMovement` IN per line — in one transaction, so a
   * received order and its stock effect can never disagree.
   */
  async receiveFoodOrder(
    orderId: string,
    kindergartenId: string,
    createdById: string,
    receipts: { lineId: string; ingredientId: string; quantity: string }[],
    date: Date,
  ) {
    return this.prisma.$transaction(async (tx) => {
      for (const receipt of receipts) {
        await tx.foodOrderLine.update({
          where: { id: receipt.lineId },
          data: { receivedQuantity: receipt.quantity },
        });
      }

      await tx.stockMovement.createMany({
        data: receipts.map((receipt) => ({
          kindergartenId,
          ingredientId: receipt.ingredientId,
          date,
          direction: "IN" as StockDirection,
          quantity: receipt.quantity,
          sourceType: "PURCHASE",
          sourceId: orderId,
          createdById,
        })),
      });

      return tx.foodOrder.update({
        where: { id: orderId },
        data: { status: "RECEIVED" },
        include: this.foodOrderInclude,
      });
    });
  }

  // ── Stock ────────────────────────────────────────────────────────────────

  /** On-hand per ingredient — `SUM(IN)+SUM(ADJUSTMENT,signed)-SUM(OUT)`,
   * computed per read rather than a running balance column. */
  async stockLevels(kindergartenId: string) {
    const [ingredients, movements] = await Promise.all([
      this.prisma.ingredient.findMany({
        where: { kindergartenId, deletedAt: null },
        select: { id: true, name: true, unit: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.stockMovement.groupBy({
        by: ["ingredientId", "direction"],
        where: { kindergartenId },
        _sum: { quantity: true },
      }),
    ]);

    const byIngredient = new Map<string, number>();
    for (const row of movements) {
      const amount = Number(row._sum.quantity ?? 0);
      const signed = row.direction === "OUT" ? -amount : amount;
      byIngredient.set(row.ingredientId, (byIngredient.get(row.ingredientId) ?? 0) + signed);
    }

    return ingredients.map((ingredient) => ({
      ingredient,
      onHand: (byIngredient.get(ingredient.id) ?? 0).toFixed(2),
    }));
  }

  async listStockMovements(
    kindergartenId: string,
    ingredientId: string | undefined,
    skip: number,
    take: number,
  ) {
    const where = { kindergartenId, ...(ingredientId ? { ingredientId } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: { date: "desc" as const },
        skip,
        take,
        include: { ingredient: unitRefSelect },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return { items, total };
  }

  async createStockMovement(entry: {
    kindergartenId: string;
    ingredientId: string;
    date: Date;
    direction: StockDirection;
    quantity: string;
    sourceType: "PURCHASE" | "CONSUMPTION" | "ADJUSTMENT";
    sourceId?: string | null;
    note?: string | null;
    createdById: string;
  }) {
    return this.prisma.stockMovement.create({ data: entry });
  }

  /**
   * Consumption's OUT rows plus `MenuDay.consumedAt`, in one transaction — a
   * dropped connection must not deduct stock without marking the day
   * consumed, or leave the day marked with nothing deducted.
   */
  async recordConsumption(
    menuDayId: string,
    kindergartenId: string,
    createdById: string,
    date: Date,
    rows: { ingredientId: string; quantity: string; note: string }[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (rows.length > 0) {
        await tx.stockMovement.createMany({
          data: rows.map((row) => ({
            kindergartenId,
            ingredientId: row.ingredientId,
            date,
            direction: "OUT" as StockDirection,
            quantity: row.quantity,
            sourceType: "CONSUMPTION" as const,
            sourceId: menuDayId,
            note: row.note,
            createdById,
          })),
        });
      }

      return tx.menuDay.update({ where: { id: menuDayId }, data: { consumedAt: new Date() } });
    });
  }

  // ── Reports ──────────────────────────────────────────────────────────────

  /** Ingredient usage over a range — OUT movements only, summed per
   * ingredient. Purchases and adjustments are their own report/screen. */
  async consumptionReport(kindergartenId: string, from: Date, to: Date) {
    const rows = await this.prisma.stockMovement.groupBy({
      by: ["ingredientId"],
      where: { kindergartenId, direction: "OUT", date: { gte: from, lte: to } },
      _sum: { quantity: true },
    });

    const ingredients = await this.prisma.ingredient.findMany({
      where: { id: { in: rows.map((r) => r.ingredientId) } },
      select: { id: true, name: true, unit: true },
    });
    const byId = new Map(ingredients.map((i) => [i.id, i]));

    return rows
      .map((row) => ({
        ingredient: byId.get(row.ingredientId),
        quantity: (row._sum.quantity ?? 0).toString(),
      }))
      .filter((row): row is { ingredient: NonNullable<typeof row.ingredient>; quantity: string } =>
        Boolean(row.ingredient),
      );
  }

  /** Every APPROVED-recipe dish planned in the range, for the nutrition
   * report — `KitchenService` does the per-day averaging. */
  async menuDaysInRange(kindergartenId: string, from: Date, to: Date) {
    return this.prisma.menuDay.findMany({
      where: { kindergartenId, deletedAt: null, date: { gte: from, lte: to } },
      select: { date: true, dishes: true },
      orderBy: { date: "asc" },
    });
  }

  async purchaseReport(kindergartenId: string, from: Date, to: Date) {
    const orders = await this.prisma.foodOrder.findMany({
      where: {
        kindergartenId,
        deletedAt: null,
        status: "RECEIVED",
        orderDate: { gte: from, lte: to },
      },
      select: {
        supplierId: true,
        supplier: { select: { id: true, name: true } },
        lines: { select: { totalPrice: true } },
      },
    });

    const bySupplier = new Map<
      string,
      { supplier: { id: string; name: string }; orderCount: number; total: number }
    >();
    for (const order of orders) {
      const total = order.lines.reduce((sum, line) => sum + Number(line.totalPrice), 0);
      const existing = bySupplier.get(order.supplierId);
      if (existing) {
        existing.orderCount += 1;
        existing.total += total;
      } else {
        bySupplier.set(order.supplierId, { supplier: order.supplier, orderCount: 1, total });
      }
    }

    return [...bySupplier.values()].map((row) => ({
      supplier: row.supplier,
      orderCount: row.orderCount,
      totalAmount: row.total.toFixed(2),
    }));
  }
}

export type { IngredientUnit };

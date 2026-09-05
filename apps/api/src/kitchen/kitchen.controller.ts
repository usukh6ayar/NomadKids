import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { KitchenService } from "./kitchen.service";
import {
  createFoodOrderSchema,
  createIngredientSchema,
  createRecipeSchema,
  createSupplierSchema,
  kitchenReportsQuerySchema,
  listFoodOrdersQuerySchema,
  listIngredientsQuerySchema,
  listMealServingsQuerySchema,
  listRecipesQuerySchema,
  listStockMovementsQuerySchema,
  listSuppliersQuerySchema,
  markMealServedSchema,
  receiveFoodOrderSchema,
  stockAdjustmentSchema,
  updateFoodOrderSchema,
  updateIngredientSchema,
  updateRecipeSchema,
  updateSupplierSchema,
  type CreateFoodOrderDto,
  type CreateIngredientDto,
  type CreateRecipeDto,
  type CreateSupplierDto,
  type KitchenReportsQuery,
  type ListFoodOrdersQuery,
  type ListIngredientsQuery,
  type ListMealServingsQuery,
  type ListRecipesQuery,
  type ListStockMovementsQuery,
  type ListSuppliersQuery,
  type MarkMealServedDto,
  type ReceiveFoodOrderDto,
  type StockAdjustmentDto,
  type UpdateFoodOrderDto,
  type UpdateIngredientDto,
  type UpdateRecipeDto,
  type UpdateSupplierDto,
} from "./kitchen.dto";

type IdParam = { id: string };

// ── Ingredients ──────────────────────────────────────────────────────────

@Controller("kindergartens/:id/ingredients")
@Roles("COOK", "ADMIN")
export class KindergartenIngredientsController {
  constructor(private readonly service: KitchenService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Query(new ZodValidationPipe(listIngredientsQuerySchema)) query: ListIngredientsQuery,
  ) {
    return this.service.listIngredients(actor, params.id, query);
  }

  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Body(new ZodValidationPipe(createIngredientSchema)) body: CreateIngredientDto,
  ) {
    return this.service.createIngredient(actor, params.id, body);
  }
}

@Controller("ingredients")
@Roles("COOK", "ADMIN")
export class IngredientsController {
  constructor(private readonly service: KitchenService) {}

  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Body(new ZodValidationPipe(updateIngredientSchema)) body: UpdateIngredientDto,
  ) {
    return this.service.updateIngredient(actor, params.id, body);
  }

  @Delete(":id")
  async remove(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
  ) {
    return this.service.removeIngredient(actor, params.id);
  }
}

// ── Recipes (технологийн карт) ──────────────────────────────────────────

@Controller("kindergartens/:id/recipes")
export class KindergartenRecipesController {
  constructor(private readonly service: KitchenService) {}

  @Get()
  @Roles("COOK", "ADMIN")
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Query(new ZodValidationPipe(listRecipesQuerySchema)) query: ListRecipesQuery,
  ) {
    return this.service.listRecipes(actor, params.id, query);
  }

  /** The menu screen's technology-card picker — a cook and a teacher both
   * plan the menu (`assertCanManageMeals`), so this is deliberately wider
   * than the rest of this controller. */
  @Get("approved")
  @Roles("COOK", "TEACHER", "ADMIN")
  async approved(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
  ) {
    return this.service.listApprovedRecipesForMenu(actor, params.id);
  }

  @Post()
  @Roles("COOK", "ADMIN")
  async create(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Body(new ZodValidationPipe(createRecipeSchema)) body: CreateRecipeDto,
  ) {
    return this.service.createRecipe(actor, params.id, body);
  }
}

@Controller("recipes")
@Roles("COOK", "ADMIN")
export class RecipesController {
  constructor(private readonly service: KitchenService) {}

  @Get(":id")
  async detail(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
  ) {
    return this.service.getRecipe(actor, params.id);
  }

  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Body(new ZodValidationPipe(updateRecipeSchema)) body: UpdateRecipeDto,
  ) {
    return this.service.updateRecipe(actor, params.id, body);
  }

  @Delete(":id")
  async remove(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
  ) {
    return this.service.removeRecipe(actor, params.id);
  }

  @Post(":id/approve")
  async approve(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
  ) {
    return this.service.approveRecipe(actor, params.id);
  }
}

// ── Suppliers ────────────────────────────────────────────────────────────

@Controller("kindergartens/:id/suppliers")
@Roles("COOK", "ADMIN")
export class KindergartenSuppliersController {
  constructor(private readonly service: KitchenService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Query(new ZodValidationPipe(listSuppliersQuerySchema)) query: ListSuppliersQuery,
  ) {
    return this.service.listSuppliers(actor, params.id, query);
  }

  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Body(new ZodValidationPipe(createSupplierSchema)) body: CreateSupplierDto,
  ) {
    return this.service.createSupplier(actor, params.id, body);
  }
}

@Controller("suppliers")
@Roles("COOK", "ADMIN")
export class SuppliersController {
  constructor(private readonly service: KitchenService) {}

  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Body(new ZodValidationPipe(updateSupplierSchema)) body: UpdateSupplierDto,
  ) {
    return this.service.updateSupplier(actor, params.id, body);
  }

  @Delete(":id")
  async remove(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
  ) {
    return this.service.removeSupplier(actor, params.id);
  }
}

// ── Food orders (Хүнсний захиалга) ──────────────────────────────────────

@Controller("kindergartens/:id/food-orders")
@Roles("COOK", "ADMIN")
export class KindergartenFoodOrdersController {
  constructor(private readonly service: KitchenService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Query(new ZodValidationPipe(listFoodOrdersQuerySchema)) query: ListFoodOrdersQuery,
  ) {
    return this.service.listFoodOrders(actor, params.id, query);
  }

  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Body(new ZodValidationPipe(createFoodOrderSchema)) body: CreateFoodOrderDto,
  ) {
    return this.service.createFoodOrder(actor, params.id, body);
  }
}

@Controller("food-orders")
@Roles("COOK", "ADMIN")
export class FoodOrdersController {
  constructor(private readonly service: KitchenService) {}

  @Get(":id")
  async detail(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
  ) {
    return this.service.getFoodOrder(actor, params.id);
  }

  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Body(new ZodValidationPipe(updateFoodOrderSchema)) body: UpdateFoodOrderDto,
  ) {
    return this.service.updateFoodOrder(actor, params.id, body);
  }

  @Post(":id/receive")
  async receive(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Body(new ZodValidationPipe(receiveFoodOrderSchema)) body: ReceiveFoodOrderDto,
  ) {
    return this.service.receiveFoodOrder(actor, params.id, body);
  }
}

// ── Stock ────────────────────────────────────────────────────────────────

@Controller("kindergartens/:id/stock")
@Roles("COOK", "ADMIN")
export class StockController {
  constructor(private readonly service: KitchenService) {}

  @Get()
  async levels(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
  ) {
    return this.service.stockLevels(actor, params.id);
  }

  @Get("movements")
  async movements(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Query(new ZodValidationPipe(listStockMovementsQuerySchema)) query: ListStockMovementsQuery,
  ) {
    return this.service.listStockMovements(actor, params.id, query);
  }

  @Post("adjustments")
  async adjust(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Body(new ZodValidationPipe(stockAdjustmentSchema)) body: StockAdjustmentDto,
  ) {
    return this.service.createAdjustment(actor, params.id, body);
  }
}

// ── Reports ──────────────────────────────────────────────────────────────

@Controller("kindergartens/:id/kitchen/reports")
@Roles("COOK", "ADMIN")
export class KitchenReportsController {
  constructor(private readonly service: KitchenService) {}

  @Get("consumption")
  async consumption(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Query(new ZodValidationPipe(kitchenReportsQuerySchema)) query: KitchenReportsQuery,
  ) {
    return this.service.consumptionReport(actor, params.id, query);
  }

  @Get("nutrition")
  async nutrition(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Query(new ZodValidationPipe(kitchenReportsQuerySchema)) query: KitchenReportsQuery,
  ) {
    return this.service.nutritionReport(actor, params.id, query);
  }

  @Get("purchases")
  async purchases(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Query(new ZodValidationPipe(kitchenReportsQuerySchema)) query: KitchenReportsQuery,
  ) {
    return this.service.purchaseReport(actor, params.id, query);
  }
}

// ── Meal servings (Тараалт) ─────────────────────────────────────────────

@Controller("kindergartens/:id/meal-servings")
@Roles("COOK", "ADMIN")
export class KindergartenMealServingsController {
  constructor(private readonly service: KitchenService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Query(new ZodValidationPipe(listMealServingsQuerySchema)) query: ListMealServingsQuery,
  ) {
    return this.service.listMealServings(actor, params.id, query);
  }

  @Post()
  async mark(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Body(new ZodValidationPipe(markMealServedSchema)) body: MarkMealServedDto,
  ) {
    return this.service.markMealServed(actor, params.id, body);
  }
}

@Controller("meal-servings")
@Roles("COOK", "ADMIN")
export class MealServingsController {
  constructor(private readonly service: KitchenService) {}

  @Delete(":id")
  async unmark(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
  ) {
    return this.service.unmarkMealServed(actor, params.id);
  }
}

import { Module } from "@nestjs/common";
import {
  FoodOrdersController,
  IngredientsController,
  KindergartenFoodOrdersController,
  KindergartenIngredientsController,
  KindergartenMealServingsController,
  KindergartenRecipesController,
  KindergartenSuppliersController,
  KitchenReportsController,
  MealServingsController,
  RecipesController,
  StockController,
  SuppliersController,
} from "./kitchen.controller";
import { KitchenRepository } from "./kitchen.repository";
import { KitchenService } from "./kitchen.service";

/**
 * Ingredients, technology cards, suppliers, food orders, stock and reports —
 * Хоол үйлдвэрлэл. Exports `KitchenService` for `MealsModule`, which resolves
 * a menu dish's recipe and consumes stock but does not own either table.
 */
@Module({
  controllers: [
    KindergartenIngredientsController,
    IngredientsController,
    KindergartenRecipesController,
    RecipesController,
    KindergartenSuppliersController,
    SuppliersController,
    KindergartenFoodOrdersController,
    FoodOrdersController,
    StockController,
    KitchenReportsController,
    KindergartenMealServingsController,
    MealServingsController,
  ],
  providers: [KitchenService, KitchenRepository],
  exports: [KitchenService],
})
export class KitchenModule {}

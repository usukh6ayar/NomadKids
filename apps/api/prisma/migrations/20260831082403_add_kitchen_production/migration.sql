-- Kitchen production — ingredients, technology cards, suppliers, food orders
-- and the stock ledger. The gap list's own words: "Хоол үйлдвэрлэл — хамгийн
-- том дутуу хэсэг".
--
-- Reviewed by hand per CLAUDE.md §3.3: six new enums, four new columns on
-- `menu_days` (all nullable or defaulted), six new tables, thirteen new
-- foreign keys. No DROP, no ALTER COLUMN, no data loss possible — the one
-- hand edit below *replaces* a generated index rather than dropping data.

-- CreateEnum
CREATE TYPE "MenuDayStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "IngredientUnit" AS ENUM ('GRAM', 'MILLILITER', 'PIECE');

-- CreateEnum
CREATE TYPE "RecipeStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "FoodOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockDirection" AS ENUM ('IN', 'OUT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "StockSourceType" AS ENUM ('PURCHASE', 'CONSUMPTION', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "menu_days" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" UUID,
ADD COLUMN     "consumedAt" TIMESTAMP(3),
ADD COLUMN     "status" "MenuDayStatus" NOT NULL DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "ingredients" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "IngredientUnit" NOT NULL,
    "caloriesPer100" DECIMAL(8,2),
    "proteinPer100" DECIMAL(8,2),
    "fatPer100" DECIMAL(8,2),
    "carbsPer100" DECIMAL(8,2),
    "allergenTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mealKind" "MealKind",
    "yieldPortions" INTEGER NOT NULL,
    "instructions" TEXT,
    "status" "RecipeStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_ingredients" (
    "id" UUID NOT NULL,
    "recipeId" UUID NOT NULL,
    "ingredientId" UUID NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "contactPerson" TEXT,
    "contactPhone" TEXT,
    "address" TEXT,
    "originNote" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_orders" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "orderDate" DATE NOT NULL,
    "status" "FoodOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "food_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_order_lines" (
    "id" UUID NOT NULL,
    "foodOrderId" UUID NOT NULL,
    "ingredientId" UUID NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "receivedQuantity" DECIMAL(10,2),

    CONSTRAINT "food_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "ingredientId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "direction" "StockDirection" NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "sourceType" "StockSourceType" NOT NULL,
    "sourceId" UUID,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingredients_kindergartenId_deletedAt_idx" ON "ingredients"("kindergartenId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_kindergartenId_name_key" ON "ingredients"("kindergartenId", "name");

-- CreateIndex
CREATE INDEX "recipes_kindergartenId_status_deletedAt_idx" ON "recipes"("kindergartenId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "recipe_ingredients_recipeId_position_idx" ON "recipe_ingredients"("recipeId", "position");

-- CreateIndex
CREATE INDEX "recipe_ingredients_ingredientId_idx" ON "recipe_ingredients"("ingredientId");

-- CreateIndex
CREATE INDEX "suppliers_kindergartenId_deletedAt_idx" ON "suppliers"("kindergartenId", "deletedAt");

-- CreateIndex
CREATE INDEX "food_orders_kindergartenId_orderDate_idx" ON "food_orders"("kindergartenId", "orderDate" DESC);

-- CreateIndex
CREATE INDEX "food_orders_kindergartenId_status_idx" ON "food_orders"("kindergartenId", "status");

-- CreateIndex
CREATE INDEX "food_order_lines_foodOrderId_idx" ON "food_order_lines"("foodOrderId");

-- CreateIndex
CREATE INDEX "stock_movements_kindergartenId_ingredientId_date_idx" ON "stock_movements"("kindergartenId", "ingredientId", "date");

-- CreateIndex
CREATE INDEX "stock_movements_kindergartenId_date_idx" ON "stock_movements"("kindergartenId", "date");

-- ★ Hand-written, replacing the generated plain unique index with a
-- **partial** one — the same correction `MealRecord`, `Attendance` and
-- `GrowthMeasurement` each needed.
--
-- Postgres treats NULLs as distinct, and `deletedAt` is the only nullable
-- column in the key, so the plain form would let a soft-deleted ingredient
-- occupy its name for ever: "Гурил" deleted once could never be re-added.
DROP INDEX "ingredients_kindergartenId_name_key";

CREATE UNIQUE INDEX "ingredients_kindergartenId_name_key"
  ON "ingredients"("kindergartenId", "name")
  WHERE "deletedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "menu_days" ADD CONSTRAINT "menu_days_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_orders" ADD CONSTRAINT "food_orders_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_orders" ADD CONSTRAINT "food_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_orders" ADD CONSTRAINT "food_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_order_lines" ADD CONSTRAINT "food_order_lines_foodOrderId_fkey" FOREIGN KEY ("foodOrderId") REFERENCES "food_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_order_lines" ADD CONSTRAINT "food_order_lines_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

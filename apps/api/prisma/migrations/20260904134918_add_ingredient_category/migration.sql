-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "category" TEXT;

-- CreateIndex
CREATE INDEX "ingredients_kindergartenId_category_idx" ON "ingredients"("kindergartenId", "category");

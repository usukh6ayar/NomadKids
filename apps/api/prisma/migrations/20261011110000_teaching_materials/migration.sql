-- CreateEnum
CREATE TYPE "MaterialFileType" AS ENUM ('PDF', 'PPT');

-- CreateEnum
CREATE TYPE "MaterialLevel" AS ENUM ('I', 'II', 'III', 'IV');

-- CreateEnum
CREATE TYPE "MaterialPreviewStatus" AS ENUM ('MANUAL', 'PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "MaterialPurchaseStatus" AS ENUM ('UNPAID', 'PAID');

-- AlterTable
ALTER TABLE "qpay_invoices" ADD COLUMN     "materialPurchaseId" UUID,
ALTER COLUMN "kindergartenId" DROP NOT NULL,
ALTER COLUMN "subscriptionId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "teaching_materials" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "area" TEXT NOT NULL,
    "level" "MaterialLevel",
    "fileType" "MaterialFileType" NOT NULL,
    "price" INTEGER NOT NULL,
    "contents" TEXT[],
    "pages" INTEGER,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "previewStatus" "MaterialPreviewStatus" NOT NULL DEFAULT 'MANUAL',
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "teaching_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teaching_material_previews" (
    "id" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "teaching_material_previews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_purchases" (
    "id" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "MaterialPurchaseStatus" NOT NULL DEFAULT 'UNPAID',
    "amount" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teaching_materials_storageKey_key" ON "teaching_materials"("storageKey");

-- CreateIndex
CREATE INDEX "teaching_materials_published_deletedAt_area_idx" ON "teaching_materials"("published", "deletedAt", "area");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_material_previews_storageKey_key" ON "teaching_material_previews"("storageKey");

-- CreateIndex
CREATE INDEX "teaching_material_previews_materialId_deletedAt_order_idx" ON "teaching_material_previews"("materialId", "deletedAt", "order");

-- CreateIndex
CREATE INDEX "material_purchases_userId_status_idx" ON "material_purchases"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "material_purchases_materialId_userId_key" ON "material_purchases"("materialId", "userId");

-- CreateIndex
CREATE INDEX "qpay_invoices_materialPurchaseId_idx" ON "qpay_invoices"("materialPurchaseId");

-- AddForeignKey
ALTER TABLE "qpay_invoices" ADD CONSTRAINT "qpay_invoices_materialPurchaseId_fkey" FOREIGN KEY ("materialPurchaseId") REFERENCES "material_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_materials" ADD CONSTRAINT "teaching_materials_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_material_previews" ADD CONSTRAINT "teaching_material_previews_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "teaching_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_purchases" ADD CONSTRAINT "material_purchases_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "teaching_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_purchases" ADD CONSTRAINT "material_purchases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- An attempt pays for exactly one thing: an access subscription or a
-- material purchase. Hand-written (Prisma cannot express it); pinned by
-- `test/schema.test.ts`. Every existing row has a subscription, so it holds.
ALTER TABLE "qpay_invoices" ADD CONSTRAINT "qpay_invoices_one_target_check"
  CHECK (num_nonnulls("subscriptionId", "materialPurchaseId") = 1);

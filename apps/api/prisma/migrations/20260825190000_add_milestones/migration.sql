-- Milestones — RFP §4.5, "Онцгой үйл явдал".
--
-- Reviewed by hand per CLAUDE.md §3.3: one new table, one nullable column on
-- media_files, one enum value, four foreign keys. No DROP, no data-losing
-- operation.
--
-- ★ `ALTER TYPE … ADD VALUE` runs inside Prisma's transaction, which Postgres
-- allows from version 12 (this project targets 17) with one restriction: the new
-- value cannot be *used* until that transaction commits. Nothing here writes a
-- MILESTONE row, so the restriction does not bite — but a later migration that
-- adds an enum value and then inserts it in the same file would fail, which is
-- worth knowing before writing one.

-- AlterEnum
ALTER TYPE "MediaPurpose" ADD VALUE 'MILESTONE';

-- AlterTable
ALTER TABLE "media_files" ADD COLUMN     "milestoneId" UUID;

-- CreateTable
CREATE TABLE "milestones" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "occurredOn" DATE NOT NULL,
    "description" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "milestones_childId_occurredOn_idx" ON "milestones"("childId", "occurredOn" DESC);

-- CreateIndex
CREATE INDEX "milestones_kindergartenId_occurredOn_idx" ON "milestones"("kindergartenId", "occurredOn" DESC);

-- CreateIndex
CREATE INDEX "media_files_milestoneId_order_idx" ON "media_files"("milestoneId", "order");

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;


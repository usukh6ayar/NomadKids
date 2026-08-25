-- Meal register — нэмэлт.md §2, and the sixth attendance status from §1.
--
-- Reviewed by hand per CLAUDE.md §3.3: two new enums, one enum value, one new
-- table, four foreign keys. No DROP, no ALTER COLUMN.
--
-- ★ `AttendanceStatus` regains OTHER. It existed in the first attendance
-- migration, was dropped when that migration was rewritten, and нэмэлт.md §1
-- lists it — the escape hatch every other enum here keeps. A day that is none
-- of the five is otherwise recorded as the nearest wrong one, and attendance
-- feeds a funding calculation.

-- CreateEnum
CREATE TYPE "MealKind" AS ENUM ('BREAKFAST', 'LUNCH', 'AFTERNOON_SNACK', 'EXTRA');

-- CreateEnum
CREATE TYPE "MealStatus" AS ENUM ('TAKEN', 'NOT_TAKEN', 'PARTIAL', 'SPECIAL');

-- AlterEnum
ALTER TYPE "AttendanceStatus" ADD VALUE 'OTHER';

-- CreateTable
CREATE TABLE "meal_records" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "enrollmentId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" "MealKind" NOT NULL,
    "status" "MealStatus" NOT NULL,
    "note" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "meal_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meal_records_kindergartenId_date_idx" ON "meal_records"("kindergartenId", "date");

-- CreateIndex
CREATE INDEX "meal_records_childId_date_idx" ON "meal_records"("childId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "meal_records_enrollmentId_date_kind_key" ON "meal_records"("enrollmentId", "date", "kind");

-- AddForeignKey
ALTER TABLE "meal_records" ADD CONSTRAINT "meal_records_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_records" ADD CONSTRAINT "meal_records_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_records" ADD CONSTRAINT "meal_records_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_records" ADD CONSTRAINT "meal_records_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ★ Hand-written, replacing the generated plain unique index with a **partial**
-- one — the same correction `Attendance` and `GrowthMeasurement` both needed.
--
-- Postgres treats NULLs as distinct, and `deletedAt` is the only nullable
-- column in the key, so the plain form lets a soft-deleted row occupy its
-- sitting for ever: a lunch deleted once could never be recorded again.
DROP INDEX "meal_records_enrollmentId_date_kind_key";

CREATE UNIQUE INDEX "meal_records_enrollmentId_date_kind_key"
  ON "meal_records"("enrollmentId", "date", "kind")
  WHERE "deletedAt" IS NULL;

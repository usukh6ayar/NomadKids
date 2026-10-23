-- «Хямдрал» on a teaching material (backend list №6, 2026-10-23).
-- Additive: two nullable columns, no data touched.

-- AlterTable
ALTER TABLE "teaching_materials" ADD COLUMN     "discountEndsOn" DATE,
ADD COLUMN     "discountPrice" INTEGER;

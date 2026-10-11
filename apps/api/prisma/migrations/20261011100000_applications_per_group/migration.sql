-- Kindergarten applications and contracts priced per group (#195, 2026-10-11).
-- Additive only: the per-child columns become nullable and keep their values,
-- so every earlier application and signed contract reads and prints as before.

-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('TERM', 'YEAR');

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "billingPeriod" "BillingPeriod",
ADD COLUMN     "groupCount" INTEGER,
ADD COLUMN     "perGroupMonthlyFee" DECIMAL(12,2),
ADD COLUMN     "periodFee" DECIMAL(12,2),
ALTER COLUMN "childCount" DROP NOT NULL,
ALTER COLUMN "annualFee" DROP NOT NULL,
ALTER COLUMN "perChildMonthlyFee" DROP NOT NULL;

-- AlterTable
ALTER TABLE "kindergarten_applications" ADD COLUMN     "billingPeriod" "BillingPeriod",
ADD COLUMN     "groupCount" INTEGER,
ALTER COLUMN "address" DROP NOT NULL,
ALTER COLUMN "childCount" DROP NOT NULL;

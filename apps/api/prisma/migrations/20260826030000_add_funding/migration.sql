-- Funding rules and calculations — нэмэлт.md §3, §4, §5, §6.
--
-- Reviewed by hand per CLAUDE.md §3.3: one enum, two tables, four foreign keys.
-- No DROP, no ALTER COLUMN.
--
-- ★ Money is DECIMAL(12,2), never a float. A binary float cannot hold 0.1
-- exactly, and a month's funding is a sum of thousands of rows — the error is
-- invisible per row and shows up in a total that must reconcile against a bank
-- statement.

-- CreateEnum
CREATE TYPE "FundingSource" AS ENUM ('STATE', 'PARENT', 'KINDERGARTEN', 'OTHER');

-- CreateTable
CREATE TABLE "funding_rules" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source" "FundingSource" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "ageBand" "AgeBand",
    "dailyRate" DECIMAL(12,2),
    "monthlyRate" DECIMAL(12,2),
    "dependsOnAttendance" BOOLEAN NOT NULL DEFAULT true,
    "dependsOnMeals" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "funding_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funding_calculations" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "source" "FundingSource" NOT NULL,
    "month" DATE NOT NULL,
    "daysAttended" INTEGER NOT NULL,
    "daysFed" INTEGER NOT NULL,
    "dailyRate" DECIMAL(12,2),
    "fundingRuleId" UUID,
    "calculatedAmount" DECIMAL(12,2) NOT NULL,
    "approvedAmount" DECIMAL(12,2),
    "receivedAmount" DECIMAL(12,2),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "funding_calculations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "funding_rules_kindergartenId_source_effectiveFrom_idx" ON "funding_rules"("kindergartenId", "source", "effectiveFrom");

-- CreateIndex
CREATE INDEX "funding_calculations_kindergartenId_month_idx" ON "funding_calculations"("kindergartenId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "funding_calculations_childId_month_source_key" ON "funding_calculations"("childId", "month", "source");

-- AddForeignKey
ALTER TABLE "funding_rules" ADD CONSTRAINT "funding_rules_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_calculations" ADD CONSTRAINT "funding_calculations_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_calculations" ADD CONSTRAINT "funding_calculations_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_calculations" ADD CONSTRAINT "funding_calculations_fundingRuleId_fkey" FOREIGN KEY ("fundingRuleId") REFERENCES "funding_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ★ Hand-written: the generated unique index is replaced by a partial one, the
-- same correction Attendance, GrowthMeasurement and MealRecord all needed.
-- A superseded calculation is soft-deleted, and Postgres counts NULL deletedAt
-- rows as distinct — so the plain form would block ever recalculating a month.
DROP INDEX "funding_calculations_childId_month_source_key";

CREATE UNIQUE INDEX "funding_calculations_childId_month_source_key"
  ON "funding_calculations"("childId", "month", "source")
  WHERE "deletedAt" IS NULL;

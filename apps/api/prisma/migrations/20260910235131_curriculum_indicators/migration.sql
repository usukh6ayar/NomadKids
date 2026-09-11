-- AlterTable
ALTER TABLE "observations" ADD COLUMN     "indicatorId" UUID,
ADD COLUMN     "indicatorLevel" SMALLINT;

-- CreateTable
CREATE TABLE "curriculum_indicators" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID,
    "domainId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "curriculum_indicators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curriculum_indicator_levels" (
    "id" UUID NOT NULL,
    "indicatorId" UUID NOT NULL,
    "level" SMALLINT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "curriculum_indicator_levels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "curriculum_indicators_domainId_isActive_order_idx" ON "curriculum_indicators"("domainId", "isActive", "order");

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_indicators_kindergartenId_code_key" ON "curriculum_indicators"("kindergartenId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_indicator_levels_indicatorId_level_key" ON "curriculum_indicator_levels"("indicatorId", "level");

-- AddForeignKey
ALTER TABLE "curriculum_indicators" ADD CONSTRAINT "curriculum_indicators_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_indicators" ADD CONSTRAINT "curriculum_indicators_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "development_domains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_indicator_levels" ADD CONSTRAINT "curriculum_indicator_levels_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "curriculum_indicators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "curriculum_indicators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- The national standard's own uniqueness.
--
-- ★ A partial index, for the reason `development_domains_system_code_key`
-- gives: Postgres treats NULLs as distinct, so the composite unique above
-- would let "НСХ1а" be seeded twice as a system row and never complain. The
-- seed is idempotent precisely because a duplicate is a database error rather
-- than a second row nobody notices.

CREATE UNIQUE INDEX "curriculum_indicators_system_code_key"
  ON "curriculum_indicators" ("code")
  WHERE "kindergartenId" IS NULL;

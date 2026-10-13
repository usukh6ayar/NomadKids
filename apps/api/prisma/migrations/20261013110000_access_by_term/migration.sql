-- Child access by term as well as by school year (#211, the user 2026-10-12).
-- Every existing row is a year: the column defaults to YEAR and no row is
-- rewritten. Nothing is dropped but the old unique index, which the first
-- partial index below replaces with the same rule for YEAR rows.

-- AlterTable
ALTER TABLE "access_subscriptions" ADD COLUMN     "period" "BillingPeriod" NOT NULL DEFAULT 'YEAR',
ADD COLUMN     "termNumber" SMALLINT;

-- A TERM row carries its term's number, 1-3; a YEAR row none.
ALTER TABLE "access_subscriptions" ADD CONSTRAINT "access_subscriptions_period_term_check"
  CHECK (("period" = 'TERM') = ("termNumber" IS NOT NULL) AND ("termNumber" IS NULL OR "termNumber" BETWEEN 1 AND 3));

-- DropIndex — replaced by the partial index below, same rule for YEAR rows.
DROP INDEX "access_subscriptions_childId_schoolYearId_key";

-- ★ Partial unique indexes, which Prisma's schema cannot express (see the
-- model's comment). One YEAR row per child per school year; one TERM row per
-- child per term of a school year.
CREATE UNIQUE INDEX "access_subscriptions_child_year_key"
  ON "access_subscriptions"("childId", "schoolYearId") WHERE "period" = 'YEAR';
CREATE UNIQUE INDEX "access_subscriptions_child_term_key"
  ON "access_subscriptions"("childId", "schoolYearId", "termNumber") WHERE "period" = 'TERM';

-- CreateIndex
CREATE INDEX "access_subscriptions_childId_schoolYearId_idx" ON "access_subscriptions"("childId", "schoolYearId");

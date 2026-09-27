-- «Багш, ажилтан» directory fields — 2026-09-27. Additive only: one new enum,
-- two nullable columns on users, two on memberships, one index. Nothing is
-- dropped, rewritten or backfilled.
CREATE TYPE "StaffCategory" AS ENUM ('MANAGEMENT', 'TEACHING', 'ADMINISTRATION', 'SERVICE');

ALTER TABLE "users"
  ADD COLUMN "registerNumber" TEXT,
  ADD COLUMN "dateOfBirth" DATE;

CREATE INDEX "users_registerNumber_idx" ON "users"("registerNumber");

ALTER TABLE "memberships"
  ADD COLUMN "position" TEXT,
  ADD COLUMN "staffCategory" "StaffCategory";

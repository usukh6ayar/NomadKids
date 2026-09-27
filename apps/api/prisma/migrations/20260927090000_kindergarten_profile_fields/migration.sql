-- «Байгууллага» profile fields — 2026-09-27. Additive only: twelve nullable
-- text columns, no default, no backfill, nothing dropped or rewritten.
ALTER TABLE "kindergartens"
  ADD COLUMN "shortName" TEXT,
  ADD COLUMN "propertyType" TEXT,
  ADD COLUMN "institutionType" TEXT,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "responsibleUnit" TEXT,
  ADD COLUMN "country" TEXT,
  ADD COLUMN "province" TEXT,
  ADD COLUMN "district" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "facebook" TEXT,
  ADD COLUMN "headName" TEXT,
  ADD COLUMN "headPhone" TEXT;

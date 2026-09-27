-- ESIS's key for a school year, so `POST …/esis/sync-groups` can find the row
-- it made on the next press. Nullable and additive: every existing year stays
-- unlinked until the first sync adopts it.
ALTER TABLE "school_years" ADD COLUMN "esisAcademicYear" VARCHAR(16);

CREATE UNIQUE INDEX "school_years_kindergartenId_esisAcademicYear_key"
  ON "school_years"("kindergartenId", "esisAcademicYear");

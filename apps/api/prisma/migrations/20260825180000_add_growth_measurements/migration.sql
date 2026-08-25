-- CreateTable
CREATE TABLE "growth_measurements" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "measuredOn" DATE NOT NULL,
    "heightCm" DECIMAL(5,1),
    "weightKg" DECIMAL(5,2),
    "headCircumferenceCm" DECIMAL(4,1),
    "note" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "growth_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "growth_measurements_childId_measuredOn_idx" ON "growth_measurements"("childId", "measuredOn" DESC);

-- CreateIndex
CREATE INDEX "growth_measurements_kindergartenId_measuredOn_idx" ON "growth_measurements"("kindergartenId", "measuredOn" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "growth_measurements_childId_measuredOn_key" ON "growth_measurements"("childId", "measuredOn");

-- AddForeignKey
ALTER TABLE "growth_measurements" ADD CONSTRAINT "growth_measurements_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_measurements" ADD CONSTRAINT "growth_measurements_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_measurements" ADD CONSTRAINT "growth_measurements_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ★ Hand-written: the generated unique index above is replaced by a **partial**
-- one, restricted to live rows.
--
-- Prisma emits `@@unique([childId, measuredOn])` as a plain constraint, and
-- Postgres treats NULLs as distinct — "deletedAt" is the only nullable column in
-- play, so a soft-deleted measurement still occupies its date for ever. A
-- measurement deleted once could never be re-recorded for that day, failing with
-- a unique violation against a row nobody can see.
--
-- Prisma has no syntax for a partial unique index; `model GrowthMeasurement`
-- says so, and 20260825120000_partial_unique_attendance_day does the same for
-- Attendance, which hit this exact bug in production-shaped testing.
DROP INDEX "growth_measurements_childId_measuredOn_key";

CREATE UNIQUE INDEX "growth_measurements_childId_measuredOn_key"
  ON "growth_measurements"("childId", "measuredOn")
  WHERE "deletedAt" IS NULL;

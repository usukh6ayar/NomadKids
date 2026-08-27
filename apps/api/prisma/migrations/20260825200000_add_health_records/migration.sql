-- Health records — RFP Module 2: allergies, medication authorisations,
-- vaccinations.
--
-- Reviewed by hand per CLAUDE.md §3.3: three new tables, two new enums, nine
-- foreign keys, six indexes. No DROP, no ALTER COLUMN, no data-losing
-- operation — nothing existing is touched.
--
-- `Child.healthNotes` is deliberately left alone. It is RFP §3.4's free-text
-- "анхаарах шаардлагатай товч мэдээлэл" and stays the right home for anything
-- that is not one of these three; what it cannot do is be queried, which is
-- what the menu cross-check needs and why `allergy_records` exists.

-- CreateEnum
CREATE TYPE "AllergySeverity" AS ENUM ('MILD', 'MODERATE', 'SEVERE');

-- CreateEnum
CREATE TYPE "AllergyKind" AS ENUM ('FOOD', 'MEDICATION', 'ENVIRONMENTAL', 'OTHER');

-- CreateTable
CREATE TABLE "allergy_records" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "kind" "AllergyKind" NOT NULL,
    "severity" "AllergySeverity" NOT NULL,
    "allergen" TEXT NOT NULL,
    "reaction" TEXT,
    "treatment" TEXT,
    "notedOn" DATE NOT NULL,
    "endedOn" DATE,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "allergy_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_authorisations" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "medicineName" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "timesOfDay" JSONB NOT NULL,
    "instructions" TEXT,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "authorisedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "medication_authorisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccination_records" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "vaccineName" TEXT NOT NULL,
    "administeredOn" DATE NOT NULL,
    "doseLabel" TEXT,
    "provider" TEXT,
    "note" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vaccination_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "allergy_records_childId_endedOn_idx" ON "allergy_records"("childId", "endedOn");

-- CreateIndex
CREATE INDEX "allergy_records_kindergartenId_endedOn_idx" ON "allergy_records"("kindergartenId", "endedOn");

-- CreateIndex
CREATE INDEX "medication_authorisations_kindergartenId_startsOn_endsOn_idx" ON "medication_authorisations"("kindergartenId", "startsOn", "endsOn");

-- CreateIndex
CREATE INDEX "medication_authorisations_childId_endsOn_idx" ON "medication_authorisations"("childId", "endsOn" DESC);

-- CreateIndex
CREATE INDEX "vaccination_records_childId_administeredOn_idx" ON "vaccination_records"("childId", "administeredOn" DESC);

-- AddForeignKey
ALTER TABLE "allergy_records" ADD CONSTRAINT "allergy_records_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergy_records" ADD CONSTRAINT "allergy_records_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergy_records" ADD CONSTRAINT "allergy_records_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_authorisations" ADD CONSTRAINT "medication_authorisations_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_authorisations" ADD CONSTRAINT "medication_authorisations_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_authorisations" ADD CONSTRAINT "medication_authorisations_authorisedById_fkey" FOREIGN KEY ("authorisedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccination_records" ADD CONSTRAINT "vaccination_records_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccination_records" ADD CONSTRAINT "vaccination_records_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccination_records" ADD CONSTRAINT "vaccination_records_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Safety incidents — RFP Module 2.1, "Аюулгүй байдлын тэмдэглэл".
--
-- Reviewed by hand per CLAUDE.md §3.3: one new table, one new enum, one enum
-- value, one nullable column on media_files, four foreign keys, four indexes.
-- No DROP, no ALTER COLUMN, no data-losing operation.

-- CreateEnum
CREATE TYPE "IncidentKind" AS ENUM ('INJURY', 'FALL', 'BRUISE', 'SCRATCH', 'BITE', 'ALLERGIC_REACTION', 'FEVER', 'ILLNESS', 'OTHER');

-- AlterEnum
ALTER TYPE "MediaPurpose" ADD VALUE 'INCIDENT';

-- AlterTable
ALTER TABLE "media_files" ADD COLUMN     "incidentId" UUID;

-- CreateTable
CREATE TABLE "safety_incidents" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "kind" "IncidentKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "bodyPart" TEXT,
    "description" TEXT NOT NULL,
    "firstAid" TEXT,
    "followUp" TEXT,
    "isHighPriority" BOOLEAN NOT NULL DEFAULT false,
    "recordedById" UUID,
    "reportedAt" TIMESTAMP(3),
    "notificationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "safety_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "safety_incidents_childId_occurredAt_idx" ON "safety_incidents"("childId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "safety_incidents_kindergartenId_occurredAt_idx" ON "safety_incidents"("kindergartenId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "safety_incidents_kindergartenId_isHighPriority_reportedAt_idx" ON "safety_incidents"("kindergartenId", "isHighPriority", "reportedAt");

-- CreateIndex
CREATE INDEX "media_files_incidentId_order_idx" ON "media_files"("incidentId", "order");

-- AddForeignKey
ALTER TABLE "safety_incidents" ADD CONSTRAINT "safety_incidents_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_incidents" ADD CONSTRAINT "safety_incidents_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_incidents" ADD CONSTRAINT "safety_incidents_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_incidents" ADD CONSTRAINT "safety_incidents_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "safety_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;


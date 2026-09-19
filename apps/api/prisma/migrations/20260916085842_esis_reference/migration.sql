-- AlterTable
ALTER TABLE "esis_sync_runs" ALTER COLUMN "initiatedById" DROP NOT NULL;

-- CreateTable
CREATE TABLE "esis_reference" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID,
    "resource" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esis_reference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "esis_reference_resource_syncedAt_idx" ON "esis_reference"("resource", "syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "esis_reference_kindergartenId_resource_externalId_key" ON "esis_reference"("kindergartenId", "resource", "externalId");

-- AddForeignKey
ALTER TABLE "esis_reference" ADD CONSTRAINT "esis_reference_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "StaffRecordKind" AS ENUM ('EXPERIENCE', 'CERTIFICATE', 'QUALIFICATION');

-- CreateTable
CREATE TABLE "staff_records" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "StaffRecordKind" NOT NULL,
    "title" TEXT NOT NULL,
    "issuer" TEXT,
    "documentNo" TEXT,
    "note" TEXT,
    "startedOn" DATE NOT NULL,
    "endedOn" DATE,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "staff_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_records_userId_kindergartenId_startedOn_idx" ON "staff_records"("userId", "kindergartenId", "startedOn" DESC);

-- CreateIndex
CREATE INDEX "staff_records_kindergartenId_kind_endedOn_idx" ON "staff_records"("kindergartenId", "kind", "endedOn");

-- AddForeignKey
ALTER TABLE "staff_records" ADD CONSTRAINT "staff_records_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_records" ADD CONSTRAINT "staff_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_records" ADD CONSTRAINT "staff_records_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


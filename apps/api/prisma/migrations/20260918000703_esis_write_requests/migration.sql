-- CreateEnum
CREATE TYPE "EsisWriteState" AS ENUM ('PREPARED', 'APPROVED', 'SENT', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "esisGroupId" VARCHAR(64);

-- CreateTable
CREATE TABLE "esis_write_requests" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "service" TEXT NOT NULL,
    "apiId" INTEGER NOT NULL,
    "groupId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "state" "EsisWriteState" NOT NULL DEFAULT 'PREPARED',
    "idempotencyKey" TEXT NOT NULL,
    "preparedById" UUID NOT NULL,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "response" JSONB,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "esis_write_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "esis_write_requests_idempotencyKey_key" ON "esis_write_requests"("idempotencyKey");

-- CreateIndex
CREATE INDEX "esis_write_requests_kindergartenId_createdAt_idx" ON "esis_write_requests"("kindergartenId", "createdAt");

-- CreateIndex
CREATE INDEX "esis_write_requests_state_createdAt_idx" ON "esis_write_requests"("state", "createdAt");

-- CreateIndex
CREATE INDEX "esis_write_requests_kindergartenId_groupId_service_idx" ON "esis_write_requests"("kindergartenId", "groupId", "service");

-- AddForeignKey
ALTER TABLE "esis_write_requests" ADD CONSTRAINT "esis_write_requests_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esis_write_requests" ADD CONSTRAINT "esis_write_requests_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esis_write_requests" ADD CONSTRAINT "esis_write_requests_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esis_write_requests" ADD CONSTRAINT "esis_write_requests_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

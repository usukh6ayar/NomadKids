-- CreateEnum
CREATE TYPE "EsisSendOutcome" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "attendance_esis_attempts" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "outcome" "EsisSendOutcome" NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attemptedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "attendance_esis_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_esis_attempts_kindergartenId_date_idx" ON "attendance_esis_attempts"("kindergartenId", "date");

-- CreateIndex
CREATE INDEX "attendance_esis_attempts_groupId_date_idx" ON "attendance_esis_attempts"("groupId", "date");

-- AddForeignKey
ALTER TABLE "attendance_esis_attempts" ADD CONSTRAINT "attendance_esis_attempts_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_esis_attempts" ADD CONSTRAINT "attendance_esis_attempts_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_esis_attempts" ADD CONSTRAINT "attendance_esis_attempts_attemptedById_fkey" FOREIGN KEY ("attemptedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


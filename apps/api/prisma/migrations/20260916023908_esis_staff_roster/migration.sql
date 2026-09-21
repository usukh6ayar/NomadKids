/*
  Warnings:

  - A unique constraint covering the columns `[esisPersonId]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "kindergartens" ADD COLUMN     "staffRegistrationCodeHash" TEXT,
ADD COLUMN     "staffRegistrationCodeSetAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "esisPersonId" TEXT;

-- CreateTable
CREATE TABLE "esis_staff_roster" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "esisPersonId" TEXT NOT NULL,
    "registerNumber" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "jobCode" TEXT,
    "positionName" TEXT,
    "isInstructor" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esis_staff_roster_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "esis_staff_roster_kindergartenId_registerNumber_key" ON "esis_staff_roster"("kindergartenId", "registerNumber");

-- CreateIndex
CREATE UNIQUE INDEX "esis_staff_roster_kindergartenId_esisPersonId_key" ON "esis_staff_roster"("kindergartenId", "esisPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "users_esisPersonId_key" ON "users"("esisPersonId");

-- AddForeignKey
ALTER TABLE "esis_staff_roster" ADD CONSTRAINT "esis_staff_roster_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

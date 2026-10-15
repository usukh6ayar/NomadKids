-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'PE_TEACHER';
ALTER TYPE "Role" ADD VALUE 'MUSIC_TEACHER';
ALTER TYPE "Role" ADD VALUE 'DOCTOR';

-- CreateTable
CREATE TABLE "group_specialists" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "startedOn" DATE,
    "endedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "group_specialists_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_specialists_groupId_membershipId_idx" ON "group_specialists"("groupId", "membershipId");

-- CreateIndex
CREATE INDEX "group_specialists_membershipId_endedOn_idx" ON "group_specialists"("membershipId", "endedOn");

-- CreateIndex
CREATE INDEX "group_specialists_kindergartenId_idx" ON "group_specialists"("kindergartenId");

-- AddForeignKey
ALTER TABLE "group_specialists" ADD CONSTRAINT "group_specialists_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_specialists" ADD CONSTRAINT "group_specialists_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_specialists" ADD CONSTRAINT "group_specialists_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateEnum
CREATE TYPE "MediaAttribution" AS ENUM ('TEACHER', 'PARENT', 'JOINT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MediaPurpose" ADD VALUE 'KINDERGARTEN_LOGO';
ALTER TYPE "MediaPurpose" ADD VALUE 'USER_PHOTO';
ALTER TYPE "MediaPurpose" ADD VALUE 'GROUP_PHOTO';

-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "photoMediaFileId" UUID,
ADD COLUMN     "rules" TEXT,
ADD COLUMN     "schedule" TEXT;

-- AlterTable
ALTER TABLE "kindergartens" ADD COLUMN     "logoMediaFileId" UUID;

-- AlterTable
ALTER TABLE "media_files" ADD COLUMN     "age" SMALLINT,
ADD COLUMN     "attribution" "MediaAttribution",
ADD COLUMN     "category" TEXT,
ADD COLUMN     "takenAt" DATE,
ADD COLUMN     "uploadedById" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "photoMediaFileId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "groups_photoMediaFileId_key" ON "groups"("photoMediaFileId");

-- CreateIndex
CREATE UNIQUE INDEX "kindergartens_logoMediaFileId_key" ON "kindergartens"("logoMediaFileId");

-- CreateIndex
CREATE INDEX "media_files_childId_takenAt_idx" ON "media_files"("childId", "takenAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "users_photoMediaFileId_key" ON "users"("photoMediaFileId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_photoMediaFileId_fkey" FOREIGN KEY ("photoMediaFileId") REFERENCES "media_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kindergartens" ADD CONSTRAINT "kindergartens_logoMediaFileId_fkey" FOREIGN KEY ("logoMediaFileId") REFERENCES "media_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_photoMediaFileId_fkey" FOREIGN KEY ("photoMediaFileId") REFERENCES "media_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


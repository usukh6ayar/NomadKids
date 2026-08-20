-- AlterEnum
ALTER TYPE "MediaPurpose" ADD VALUE 'NOTIFICATION';

-- AlterTable
ALTER TABLE "media_files" ADD COLUMN     "notificationId" UUID;

-- CreateIndex
CREATE INDEX "media_files_notificationId_order_idx" ON "media_files"("notificationId", "order");

-- AddForeignKey
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

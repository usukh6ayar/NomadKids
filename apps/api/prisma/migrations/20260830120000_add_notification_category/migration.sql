-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('ANNOUNCEMENT', 'ACTIVITY', 'TRAINING', 'OTHER');

-- AlterTable
-- Defaulted to OTHER rather than ANNOUNCEMENT: every existing row predates the
-- field, and filing them all as announcements would put a classification on
-- notices nobody checked. NOT NULL with a default, so no row is left unfiled.
ALTER TABLE "notifications"
  ADD COLUMN "category" "NotificationCategory" NOT NULL DEFAULT 'OTHER';

-- The board filters by category within a kindergarten's published notices.
CREATE INDEX "notifications_kindergartenId_category_idx"
  ON "notifications"("kindergartenId", "category");

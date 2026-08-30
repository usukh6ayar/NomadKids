-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('ANNOUNCEMENT', 'INFORMATION', 'ADVICE', 'ACTIVITY', 'ROUTINE', 'OUTING', 'EVENT', 'BIRTHDAY', 'OTHER');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "category" "NotificationCategory" NOT NULL DEFAULT 'OTHER',
ALTER COLUMN "title" DROP NOT NULL;

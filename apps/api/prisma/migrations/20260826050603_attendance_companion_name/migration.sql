-- AlterTable
ALTER TABLE "attendance_records" ADD COLUMN     "arrivedWithName" TEXT,
ADD COLUMN     "pickedUpWithName" TEXT;

-- AlterTable
ALTER TABLE "attendance_requests" ADD COLUMN     "arrivedWithName" TEXT,
ADD COLUMN     "pickedUpWithName" TEXT;

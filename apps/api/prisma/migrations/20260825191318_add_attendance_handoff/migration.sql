-- CreateEnum
CREATE TYPE "AttendanceCompanion" AS ENUM ('GUARDIAN', 'OTHER', 'ALONE');

-- AlterTable
ALTER TABLE "attendance_records" ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "arrivedWith" "AttendanceCompanion",
ADD COLUMN     "pickedUpAt" TIMESTAMP(3),
ADD COLUMN     "pickedUpWith" "AttendanceCompanion";

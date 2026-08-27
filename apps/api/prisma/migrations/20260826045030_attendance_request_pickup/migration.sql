-- AlterTable
ALTER TABLE "attendance_requests" ADD COLUMN     "pickedUpAt" TIMESTAMP(3),
ADD COLUMN     "pickedUpWith" "AttendanceCompanion";

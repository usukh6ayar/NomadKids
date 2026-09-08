ALTER TYPE "MediaPurpose" ADD VALUE 'ATTENDANCE_ATTACHMENT';

ALTER TABLE "media_files"
ADD COLUMN "attendanceRequestId" UUID;

CREATE UNIQUE INDEX "media_files_attendanceRequestId_key"
ON "media_files"("attendanceRequestId");

ALTER TABLE "media_files"
ADD CONSTRAINT "media_files_attendanceRequestId_fkey"
FOREIGN KEY ("attendanceRequestId") REFERENCES "attendance_requests"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AttendanceCompanion: MOTHER/FATHER/OTHER replaces GUARDIAN/OTHER/ALONE.
-- Postgres has no `ALTER TYPE ... DROP VALUE`, so the enum is swapped rather
-- than altered in place. Safe here: `arrivedWith`/`pickedUpWith` were added
-- in the previous migration and no row has ever set them (verified against
-- the dev database before writing this), so the `USING` casts below have no
-- old values to fail on.
ALTER TYPE "AttendanceCompanion" RENAME TO "AttendanceCompanion_old";

CREATE TYPE "AttendanceCompanion" AS ENUM ('MOTHER', 'FATHER', 'OTHER');

ALTER TABLE "attendance_records"
  ALTER COLUMN "arrivedWith" TYPE "AttendanceCompanion" USING ("arrivedWith"::text::"AttendanceCompanion"),
  ALTER COLUMN "pickedUpWith" TYPE "AttendanceCompanion" USING ("pickedUpWith"::text::"AttendanceCompanion");

DROP TYPE "AttendanceCompanion_old";

-- AlterTable
ALTER TABLE "attendance_requests" ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "arrivedWith" "AttendanceCompanion";

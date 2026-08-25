-- Corrects 20260824132405_add_attendance: it emitted a plain unique index on
-- (enrollmentId, date), which counts a soft-deleted row as still occupying
-- the day (Postgres treats NULLs as distinct, and "deletedAt" is the only
-- NULL-able column in the pair). A day deleted once could then never be
-- recorded again — a unique violation on a row nobody can see.
--
-- The fix is a **partial** unique index, restricted to live rows. Prisma has
-- no syntax to express that in schema.prisma, so this is hand-written; see
-- the doc comment on `model Attendance`.
DROP INDEX "attendance_records_enrollmentId_date_key";

CREATE UNIQUE INDEX "attendance_records_enrollmentId_date_key"
  ON "attendance_records"("enrollmentId", "date")
  WHERE "deletedAt" IS NULL;

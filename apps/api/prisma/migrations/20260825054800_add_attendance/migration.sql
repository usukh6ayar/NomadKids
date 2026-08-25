-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'SICK', 'EXCUSED', 'OTHER');

-- CreateTable
CREATE TABLE "attendance" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "enrollmentId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "note" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_kindergartenId_date_idx" ON "attendance"("kindergartenId", "date");

-- CreateIndex
CREATE INDEX "attendance_childId_date_idx" ON "attendance"("childId", "date");

-- CreateIndex
--
-- ★ HAND-EDITED. Prisma generated this line without the WHERE clause:
--
--     CREATE UNIQUE INDEX "attendance_enrollmentId_date_key"
--       ON "attendance"("enrollmentId", "date");
--
-- One row per enrollment per day is the point of this table — it is what stops
-- a double-submitted register, or a form resent on a slow connection, from
-- producing two rows for one day. In this phase that is a wrong report; once
-- these rows feed a funding claim it is a duplicated claim against a government
-- body.
--
-- But rows here are soft-deleted (deletedAt), and Postgres treats NULLs as
-- distinct — so the *plain* form counts a soft-deleted row as occupying the
-- day. A day deleted once could then never be recorded again, and the failure
-- would surface as a unique-violation on a row the user cannot see.
--
-- Prisma has no syntax for a partial unique index, so `@@unique` in
-- schema.prisma cannot express this and the generated SQL is replaced by hand.
-- CLAUDE.md §3.3 asks for exactly this review. See docs/ATTENDANCE_PLAN.md §7.
--
-- The name is kept identical to Prisma's so the schema and the database still
-- agree about which index backs the constraint.
CREATE UNIQUE INDEX "attendance_enrollmentId_date_key"
  ON "attendance"("enrollmentId", "date")
  WHERE "deletedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

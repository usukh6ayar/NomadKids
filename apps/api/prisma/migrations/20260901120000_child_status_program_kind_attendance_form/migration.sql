-- Order А/261 (2024-12-19), Annex 2 §1 — the mandatory director-portal items
-- this schema could not answer: 7 (a child's standing), 5, 6, 13, 14 (main vs
-- alternative programme) and 16 (extended vs shortened hours).

-- ── ChildStatus: ARCHIVED is renamed, not dropped ────────────────────────────
--
-- A rename preserves every existing row. Dropping the value and recreating the
-- type would require rewriting `children.status` and would lose the distinction
-- for any row already set to it. `ARCHIVED` and the order's "идэвхгүй" mean the
-- same thing, so the value survives under the name the order uses.
--
-- The two new values are positioned so the type's order matches the order they
-- are declared in schema.prisma: ACTIVE, TEMPORARY, ON_LEAVE, INACTIVE.
ALTER TYPE "ChildStatus" RENAME VALUE 'ARCHIVED' TO 'INACTIVE';
ALTER TYPE "ChildStatus" ADD VALUE 'TEMPORARY' AFTER 'ACTIVE';
ALTER TYPE "ChildStatus" ADD VALUE 'ON_LEAVE' AFTER 'TEMPORARY';

-- ── The two group columns ────────────────────────────────────────────────────
--
-- Both NOT NULL with a default, so no backfill is needed and no existing row
-- changes meaning: every group that existed before this migration ran the main
-- programme on standard hours, which is what the defaults say.
CREATE TYPE "ProgramKind" AS ENUM ('MAIN', 'ALTERNATIVE');
CREATE TYPE "AttendanceForm" AS ENUM ('STANDARD', 'EXTENDED', 'SHORTENED');

ALTER TABLE "groups" ADD COLUMN     "programKind" "ProgramKind" NOT NULL DEFAULT 'MAIN',
ADD COLUMN     "attendanceForm" "AttendanceForm" NOT NULL DEFAULT 'STANDARD';

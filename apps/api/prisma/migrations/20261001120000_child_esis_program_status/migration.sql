-- ESIS enrolment status for the funding register (students/list → programStatusName, actionDate).
-- Additive and nullable: no existing row changes.
ALTER TABLE "children" ADD COLUMN "esisProgramStatus" TEXT,
ADD COLUMN "esisActionDate" DATE;

-- Order А/261 (2024-12-19), Annex 2 §1 item 9 — "Суралцагчийн анги дэвших
-- болон давтан суралцах үйл ажиллагааг бүртгэх", a mandatory requirement.
--
-- Two values, because the order names two activities and the register has to
-- distinguish them. Both are added at the end of the type: no existing row
-- changes, and nothing reads `EnrollmentStatus` by ordinal.
ALTER TYPE "EnrollmentStatus" ADD VALUE 'PROMOTED';
ALTER TYPE "EnrollmentStatus" ADD VALUE 'REPEATED';

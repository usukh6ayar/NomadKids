-- RFP §6.5 — the annual consolidated report.
--
-- Reviewed by hand per CLAUDE.md §3.3: one enum value. Additive, no data
-- touched. (Postgres allows ADD VALUE inside a transaction from 12 onwards; the
-- new value cannot be *used* until it commits, and nothing here writes one.)

-- AlterEnum
ALTER TYPE "ReportType" ADD VALUE 'ANNUAL_REPORT';


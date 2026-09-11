-- Two more survey categories, at the client's request (2026-09-10).
--
-- Additive only: `ALTER TYPE ... ADD VALUE` appends to the enum and touches no
-- existing row, so every survey already filed keeps the category it has. There
-- is no DROP here and nothing to back-fill — the reason `docs/DATABASE.md` §3.3
-- asks for a migration to be read by hand before it runs.
ALTER TYPE "SurveyCategory" ADD VALUE IF NOT EXISTS 'CLASS_GROUP';
ALTER TYPE "SurveyCategory" ADD VALUE IF NOT EXISTS 'OTHER';

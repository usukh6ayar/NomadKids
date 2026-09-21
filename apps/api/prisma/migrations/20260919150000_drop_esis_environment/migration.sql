-- Drops `Kindergarten.esisEnvironment` and the `EsisEnvironment` enum.
--
-- ★ The client confirmed on 2026-09-19 that the ministry runs **no ESIS test
-- environment** — the one credential we hold points at the production hub and
-- there is nothing else to point it at. So a per-kindergarten TEST/PRODUCTION
-- choice was never a choice: every row that carried a value carried
-- 'PRODUCTION', and the operator's picker on /platform/:id offered a second
-- option that could only ever be wrong.
--
-- ★★ This is a data-losing migration, unlike
-- `20260825170000_drop_vestigial_deleted_by`, whose columns were NULL in every
-- row. This one drops values. They are recoverable by construction: the column
-- is a constant in every row that has one, so the "lost" information is
-- `esisInstitutionId IS NOT NULL`, which the surviving column still answers.
--
-- ★★★ `esisMappedAt` and `esisInstitutionId` stay. Those record something the
-- deployment does not already know — when the mapping was made, and to which
-- institution.

ALTER TABLE "kindergartens" DROP COLUMN "esisEnvironment";

DROP TYPE "EsisEnvironment";

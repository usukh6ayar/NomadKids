-- Drops the `deletedById` columns that five tables shipped and nothing ever wrote.
--
-- CLAUDE.md §3.2 puts the deleting actor in `AuditLog`, which is append-only and
-- cannot be overwritten by the next writer. These columns arrived on a branch
-- that predated that rule; `grep deletedById apps/api/src` finds one comment and
-- no assignment, so every value in every row is NULL.
--
-- Reviewed by hand per CLAUDE.md §3.3. Five DROP COLUMNs is exactly the shape
-- that rule exists to catch, so the argument for each one is on the record:
--
--   * No writer. `grep -rn deletedById apps/api/src` returns a single comment
--     in tenants.repository.ts and no assignment anywhere.
--   * No reader. Nothing selects it, no DTO carries it, no test asserts it.
--   * Empty in fact, not just in theory: SELECT count(*) WHERE "deletedById"
--     IS NOT NULL is 0 on all five tables in the only database that has them
--     (kinder_test). Production has never had these tables — its deploy failed
--     before they were created.
--
-- An always-NULL column with no writer is the one DROP COLUMN that cannot lose
-- data. If a future requirement wants the deleting actor, `AuditLog` already
-- records it against a DELETE action and an objectId.

ALTER TABLE "attendance_records" DROP COLUMN "deletedById";
ALTER TABLE "attendance_requests" DROP COLUMN "deletedById";
ALTER TABLE "menu_days" DROP COLUMN "deletedById";
ALTER TABLE "surveys" DROP COLUMN "deletedById";
ALTER TABLE "survey_responses" DROP COLUMN "deletedById";

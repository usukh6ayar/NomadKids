-- Adds Observation.authorId and removes ReviewStatus.NOT_REQUIRED.
--
-- WHY: two rules verified against the reference system after the initial
-- migration was written.
--
--   1. `authorId` is domain authorship, not audit data. A guardian may edit
--      their own submission before a teacher approves it, and always sees their
--      own pending note — otherwise they cannot tell whether it saved. Both are
--      query-time questions the audit log cannot answer.
--
--   2. NOT_REQUIRED was wrong. The reference approves a teacher's own
--      observation on save ("there is nobody above them to approve it"), and
--      the parent read filter is `visibleToParents AND APPROVED`. A teacher
--      observation left in any other state would have been invisible to the
--      family it was written for.
--
-- ⚠ The enum rewrite below casts every existing row. It will FAIL, loudly and
-- without partial effect, if any observation still holds 'NOT_REQUIRED'. That
-- is the intended behaviour: no production data exists yet
-- (docs/MIGRATION_PLAN.md §1), so there is nothing to convert, and a silent
-- coercion would be worse than a stopped deploy. Should this ever run against
-- data, add an UPDATE to APPROVED before the enum change.

-- AlterEnum
BEGIN;
CREATE TYPE "ReviewStatus_new" AS ENUM ('PENDING', 'APPROVED', 'RETURNED');
ALTER TABLE "public"."observations" ALTER COLUMN "reviewStatus" DROP DEFAULT;
ALTER TABLE "observations" ALTER COLUMN "reviewStatus" TYPE "ReviewStatus_new" USING ("reviewStatus"::text::"ReviewStatus_new");
ALTER TYPE "ReviewStatus" RENAME TO "ReviewStatus_old";
ALTER TYPE "ReviewStatus_new" RENAME TO "ReviewStatus";
DROP TYPE "public"."ReviewStatus_old";
ALTER TABLE "observations" ALTER COLUMN "reviewStatus" SET DEFAULT 'APPROVED';
COMMIT;
-- AlterTable
ALTER TABLE "observations" ADD COLUMN     "authorId" UUID,
ALTER COLUMN "reviewStatus" SET DEFAULT 'APPROVED';
-- CreateIndex
CREATE INDEX "observations_authorId_createdAt_idx" ON "observations"("authorId", "createdAt" DESC);
-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

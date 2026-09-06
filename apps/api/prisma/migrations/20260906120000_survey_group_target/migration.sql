-- Which group a survey is for. NULL means every group in the kindergarten,
-- the same convention `NotificationTarget` uses by having no rows at all:
-- an audience named as "everyone" keeps reaching families who enrol later,
-- where naming groups freezes it at the moment of writing.
--
-- Nullable and with no default, so every existing survey stays a
-- whole-kindergarten survey — which is what all of them are today, since this
-- is the first release in which one could be anything else. No data is read,
-- rewritten or dropped by this migration.
ALTER TABLE "surveys" ADD COLUMN "groupId" UUID;

-- RESTRICT, not CASCADE: groups are soft-deleted (CLAUDE.md §3.2), so a hard
-- delete reaching a published survey is not a case that should be reachable.
ALTER TABLE "surveys"
  ADD CONSTRAINT "surveys_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "groups"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The parent's list: published surveys for their child's group, or for all.
CREATE INDEX "surveys_kindergartenId_groupId_idx" ON "surveys"("kindergartenId", "groupId");

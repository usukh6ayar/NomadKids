-- Which group's teachers a document is for. NULL means every member of staff,
-- the same convention `surveys.groupId` uses: an audience named as "everyone"
-- keeps reaching a teacher hired next month, where naming groups freezes it.
--
-- By group rather than by teacher, deliberately: assignments change, and a
-- document addressed to a person would follow them out of the group and would
-- not follow their replacement in.
--
-- Nullable with no default, so every existing document stays visible to all
-- staff — which is what all of them are today, this being the first release in
-- which one could be anything else. No data is read, rewritten or dropped.
ALTER TABLE "documents" ADD COLUMN "groupId" UUID;

-- RESTRICT, not CASCADE: groups are soft-deleted (CLAUDE.md §3.2), so a hard
-- delete reaching a published document is not a case that should be reachable.
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "groups"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- A teacher's library: their groups' documents, plus the kindergarten-wide ones.
CREATE INDEX "documents_kindergartenId_groupId_idx" ON "documents"("kindergartenId", "groupId");

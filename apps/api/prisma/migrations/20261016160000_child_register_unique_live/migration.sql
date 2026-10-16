-- A child's register is unique among the kindergarten's LIVE children only.
--
-- The full index counted soft-deleted children too, while every check in the
-- code (`ChildrenRepository.findByNationalId`, the roster import's
-- `existingChildKeys`) asks among live children. A kindergarten that deleted
-- children and imported them again passed the check and hit the index:
-- `POST /children/import` answered 500 four times on 2026-10-16.
--
-- Index only — no row changes. The partial index enforces the same rule on
-- every live row the full one did.
DROP INDEX "children_kindergartenId_nationalId_key";

CREATE UNIQUE INDEX "children_kindergartenId_nationalId_live_key"
  ON "children"("kindergartenId", "nationalId")
  WHERE "deletedAt" IS NULL;

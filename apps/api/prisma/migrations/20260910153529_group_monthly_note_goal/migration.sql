-- The monthly documentation goal moves from the kindergarten to the group.
--
-- ★ The DROP is safe, and §3.3 asks that this be said rather than assumed.
--
-- `kindergartens.monthlyNoteGoal` was added earlier the same day and never
-- written to: `SELECT count(*) ... WHERE "monthlyNoteGoal" IS NOT NULL`
-- returns 0. The same argument `20260825170000_drop_vestigial_deleted_by`
-- makes — a column is only safe to drop *because* nothing has filled it.
--
-- It moves because the client asked that a teacher set their own target
-- ("багш өөрөө сонгох"). On the kindergarten that would have meant one
-- teacher's decision silently changing every other group's number.

-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "monthlyNoteGoal" INTEGER;

-- AlterTable
ALTER TABLE "kindergartens" DROP COLUMN "monthlyNoteGoal";

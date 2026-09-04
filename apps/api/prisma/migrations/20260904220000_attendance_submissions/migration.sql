-- "Ирц илгээх" — a group's register for one day, submitted.
--
-- ★ The act is recorded now; the ESIS transport is added to it later.
--
-- `docs/reference/ESIS_INTEGRATION.md` §4: access to ESIS is a contract with the
-- ministry rather than a signup, and no credentials exist. What is ours today is
-- the declaration — a director saying "this group's Tuesday is final and has
-- been submitted" — which is worth storing on its own, because it is who signed
-- off a register and when, the first thing asked when a figure is disputed.
--
-- ★★ A row per group per day, not a flag on `attendances`. The unit submitted
-- is the day sheet: one act over twenty child rows, and a per-child flag would
-- let nineteen be sent and one not. No row means not sent, so nothing has to be
-- backfilled over every attendance record ever written.
CREATE TABLE "attendance_submissions" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "submittedById" UUID NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- How many children the register covered *when it was submitted*. Stored
    -- rather than recomputed: a roster changes, and "what was submitted" must
    -- not silently become a different number next week.
    "childCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "attendance_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attendance_submissions_kindergartenId_date_idx"
    ON "attendance_submissions"("kindergartenId", "date");

CREATE INDEX "attendance_submissions_groupId_date_idx"
    ON "attendance_submissions"("groupId", "date");

-- ★ Partial, matching `attendances` — a day whose submission was withdrawn and
-- made again must not collide with the soft-deleted row only the database still
-- remembers. `docs/DATABASE.md` records the same shape for attendance itself.
CREATE UNIQUE INDEX "attendance_submissions_group_date_live"
    ON "attendance_submissions"("groupId", "date")
    WHERE "deletedAt" IS NULL;

ALTER TABLE "attendance_submissions"
    ADD CONSTRAINT "attendance_submissions_kindergartenId_fkey"
    FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_submissions"
    ADD CONSTRAINT "attendance_submissions_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "groups"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT rather than SET NULL: who submitted a register is not a fact that
-- may become unknown because an account was later removed.
ALTER TABLE "attendance_submissions"
    ADD CONSTRAINT "attendance_submissions_submittedById_fkey"
    FOREIGN KEY ("submittedById") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

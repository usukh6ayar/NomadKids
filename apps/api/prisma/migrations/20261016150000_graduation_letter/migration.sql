-- The graduation letter closes the whole portfolio and must not reuse an
-- age-specific teacher note.
ALTER TABLE "child_profiles" ADD COLUMN "graduationLetter" TEXT;

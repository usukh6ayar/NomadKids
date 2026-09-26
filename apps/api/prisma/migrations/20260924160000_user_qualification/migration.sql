-- Мэргэшлийн зэрэг — client, 2026-09-24, for the teacher card the family reads.
-- Additive and nullable; ESIS does not return it, so it is typed by hand.
ALTER TABLE "users" ADD COLUMN "qualification" TEXT;

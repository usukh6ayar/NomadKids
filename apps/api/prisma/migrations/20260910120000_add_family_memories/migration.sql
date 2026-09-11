-- Гэр бүлийн дурсамж — RFP §4.3's family section, extended on the client's
-- instruction: a per-age list of {members, title, description, date, mediaId}.
--
-- Additive only. NOT NULL with a literal default, so every existing row gets an
-- empty list without a backfill and no existing column is read or rewritten.
-- The photographs themselves are ordinary `media_files` rows tagged
-- category=FAMILY for the same age; nothing here duplicates them.
ALTER TABLE "child_age_profiles"
ADD COLUMN "familyMemories" JSONB NOT NULL DEFAULT '[]'::JSONB;

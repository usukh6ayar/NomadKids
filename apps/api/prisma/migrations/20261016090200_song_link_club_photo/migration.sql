-- The frontend's backend list №21: a song's «Линк», a club's description and
-- cover photograph. Nullable columns, nothing backfilled.
ALTER TABLE "song_poems" ADD COLUMN "linkUrl" TEXT;

ALTER TABLE "clubs" ADD COLUMN "description" TEXT,
ADD COLUMN "photoMediaFileId" UUID;

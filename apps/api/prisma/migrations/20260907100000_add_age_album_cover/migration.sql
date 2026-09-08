ALTER TABLE "media_files" ADD COLUMN "albumCoverAge" SMALLINT;

CREATE UNIQUE INDEX "media_files_childId_albumCoverAge_key"
ON "media_files"("childId", "albumCoverAge");

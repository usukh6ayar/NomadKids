-- Artwork comparisons — RFP §5.3.
--
-- Reviewed by hand per CLAUDE.md §3.3: one new table, five foreign keys, one
-- index. No DROP, no ALTER COLUMN, nothing existing is touched.
--
-- The two media foreign keys cascade on delete: a comparison of a photograph
-- that no longer exists is half a record, and the pair is the whole point.

-- CreateTable
CREATE TABLE "artwork_comparisons" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "earlierMediaId" UUID NOT NULL,
    "laterMediaId" UUID NOT NULL,
    "conclusion" TEXT NOT NULL,
    "authorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "artwork_comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "artwork_comparisons_childId_createdAt_idx" ON "artwork_comparisons"("childId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "artwork_comparisons" ADD CONSTRAINT "artwork_comparisons_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artwork_comparisons" ADD CONSTRAINT "artwork_comparisons_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artwork_comparisons" ADD CONSTRAINT "artwork_comparisons_earlierMediaId_fkey" FOREIGN KEY ("earlierMediaId") REFERENCES "media_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artwork_comparisons" ADD CONSTRAINT "artwork_comparisons_laterMediaId_fkey" FOREIGN KEY ("laterMediaId") REFERENCES "media_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artwork_comparisons" ADD CONSTRAINT "artwork_comparisons_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


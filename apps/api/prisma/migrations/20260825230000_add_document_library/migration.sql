-- Document library — RFP §9.
--
-- Reviewed by hand per CLAUDE.md §3.3: two new tables, two enum values, six
-- foreign keys. No DROP, no ALTER COLUMN.
--
-- `documents.fileMediaFileId` is RESTRICT on delete rather than CASCADE: a
-- library entry whose PDF vanished is a title with nothing behind it, and the
-- media row should not be removable while a document points at it.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MediaPurpose" ADD VALUE 'DOCUMENT';
ALTER TYPE "MediaPurpose" ADD VALUE 'DOCUMENT_COVER';

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "version" TEXT,
    "fileMediaFileId" UUID NOT NULL,
    "coverMediaFileId" UUID,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_bookmarks" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_fileMediaFileId_key" ON "documents"("fileMediaFileId");

-- CreateIndex
CREATE UNIQUE INDEX "documents_coverMediaFileId_key" ON "documents"("coverMediaFileId");

-- CreateIndex
CREATE INDEX "documents_kindergartenId_category_idx" ON "documents"("kindergartenId", "category");

-- CreateIndex
CREATE INDEX "documents_kindergartenId_publishedAt_idx" ON "documents"("kindergartenId", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "document_bookmarks_userId_createdAt_idx" ON "document_bookmarks"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "document_bookmarks_documentId_userId_key" ON "document_bookmarks"("documentId", "userId");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_fileMediaFileId_fkey" FOREIGN KEY ("fileMediaFileId") REFERENCES "media_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_coverMediaFileId_fkey" FOREIGN KEY ("coverMediaFileId") REFERENCES "media_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_bookmarks" ADD CONSTRAINT "document_bookmarks_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_bookmarks" ADD CONSTRAINT "document_bookmarks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_bookmarks" ADD CONSTRAINT "document_bookmarks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


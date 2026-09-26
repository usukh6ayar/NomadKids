-- AlterTable
ALTER TABLE "media_files" ADD COLUMN     "albumCategoryId" UUID;

-- CreateTable
CREATE TABLE "album_categories" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "age" SMALLINT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "album_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "album_categories_childId_age_idx" ON "album_categories"("childId", "age");

-- CreateIndex
CREATE INDEX "media_files_albumCategoryId_idx" ON "media_files"("albumCategoryId");

-- AddForeignKey
ALTER TABLE "album_categories" ADD CONSTRAINT "album_categories_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album_categories" ADD CONSTRAINT "album_categories_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album_categories" ADD CONSTRAINT "album_categories_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_albumCategoryId_fkey" FOREIGN KEY ("albumCategoryId") REFERENCES "album_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

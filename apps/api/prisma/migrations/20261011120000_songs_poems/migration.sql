-- Дуу, шүлэг — a group's songs and poems by month (#195, 2026-10-11).

-- CreateEnum
CREATE TYPE "SongPoemType" AS ENUM ('SONG', 'POEM', 'FOLKLORE', 'FAIRY_TALE');


-- CreateTable
CREATE TABLE "song_poems" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "type" "SongPoemType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "coverKey" TEXT,
    "coverMimeType" TEXT,
    "coverName" TEXT,
    "fileKey" TEXT,
    "fileMimeType" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "song_poems_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "song_poem_months" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "song_poem_months_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE UNIQUE INDEX "song_poems_coverKey_key" ON "song_poems"("coverKey");


-- CreateIndex
CREATE UNIQUE INDEX "song_poems_fileKey_key" ON "song_poems"("fileKey");


-- CreateIndex
CREATE INDEX "song_poems_groupId_deletedAt_month_idx" ON "song_poems"("groupId", "deletedAt", "month");


-- CreateIndex
CREATE INDEX "song_poems_kindergartenId_idx" ON "song_poems"("kindergartenId");


-- CreateIndex
CREATE INDEX "song_poem_months_kindergartenId_idx" ON "song_poem_months"("kindergartenId");


-- CreateIndex
CREATE UNIQUE INDEX "song_poem_months_groupId_month_key" ON "song_poem_months"("groupId", "month");


-- AddForeignKey
ALTER TABLE "song_poems" ADD CONSTRAINT "song_poems_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "song_poems" ADD CONSTRAINT "song_poems_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "song_poem_months" ADD CONSTRAINT "song_poem_months_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "song_poem_months" ADD CONSTRAINT "song_poem_months_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

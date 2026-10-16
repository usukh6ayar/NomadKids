-- А/79 in the progress record (client, 2026-10-08): an observation linked to
-- one or more criteria, with how the skill showed. Additive only — two enums,
-- one table, its indexes and foreign keys.

-- CreateEnum
CREATE TYPE "A79Level" AS ENUM ('I', 'II', 'III', 'IV');

-- CreateEnum
CREATE TYPE "A79Status" AS ENUM ('INDEPENDENT', 'SUPPORTED', 'DEVELOPING', 'NOT_YET');

-- CreateTable
CREATE TABLE "observation_a79_links" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "observationId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "level" "A79Level" NOT NULL,
    "number" SMALLINT NOT NULL,
    "status" "A79Status" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "observation_a79_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "observation_a79_links_childId_level_idx" ON "observation_a79_links"("childId", "level");

-- CreateIndex
CREATE INDEX "observation_a79_links_observationId_idx" ON "observation_a79_links"("observationId");

-- CreateIndex
CREATE INDEX "observation_a79_links_kindergartenId_idx" ON "observation_a79_links"("kindergartenId");

-- AddForeignKey
ALTER TABLE "observation_a79_links" ADD CONSTRAINT "observation_a79_links_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_a79_links" ADD CONSTRAINT "observation_a79_links_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "observations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_a79_links" ADD CONSTRAINT "observation_a79_links_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One live link per criterion per note. A replaced set is soft-deleted, so
-- the uniqueness holds among live rows only — Prisma cannot express a
-- partial index, hence written here.
CREATE UNIQUE INDEX "observation_a79_links_live_key"
  ON "observation_a79_links"("observationId", "level", "number")
  WHERE "deletedAt" IS NULL;

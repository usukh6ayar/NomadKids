-- «Гарааны үнэлгээ» started from its own page (2026-10-27): an А/79 baseline
-- survey per level per group, and the children each level's survey is for.
-- Additive only: one nullable column, one new table.

-- AlterTable
ALTER TABLE "surveys" ADD COLUMN     "a79Level" "A79Level";

-- CreateTable
CREATE TABLE "survey_children" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "surveyId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "survey_children_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "survey_children_childId_idx" ON "survey_children"("childId");

-- CreateIndex
CREATE INDEX "survey_children_kindergartenId_idx" ON "survey_children"("kindergartenId");

-- CreateIndex
CREATE UNIQUE INDEX "survey_children_surveyId_childId_key" ON "survey_children"("surveyId", "childId");

-- CreateIndex
CREATE INDEX "surveys_groupId_a79Level_idx" ON "surveys"("groupId", "a79Level");

-- AddForeignKey
ALTER TABLE "survey_children" ADD CONSTRAINT "survey_children_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_children" ADD CONSTRAINT "survey_children_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_children" ADD CONSTRAINT "survey_children_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;


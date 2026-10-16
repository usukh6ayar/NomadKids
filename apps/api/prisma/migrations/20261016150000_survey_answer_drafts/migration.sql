-- A teacher survey's half-done row for one child (the user, 2026-10-16:
-- save and continue later). Additive only — one table, its indexes and FKs.

-- CreateTable
CREATE TABLE "survey_answer_drafts" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "surveyId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "answers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "survey_answer_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "survey_answer_drafts_surveyId_childId_idx" ON "survey_answer_drafts"("surveyId", "childId");

-- CreateIndex
CREATE INDEX "survey_answer_drafts_kindergartenId_idx" ON "survey_answer_drafts"("kindergartenId");

-- AddForeignKey
ALTER TABLE "survey_answer_drafts" ADD CONSTRAINT "survey_answer_drafts_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_answer_drafts" ADD CONSTRAINT "survey_answer_drafts_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_answer_drafts" ADD CONSTRAINT "survey_answer_drafts_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_answer_drafts" ADD CONSTRAINT "survey_answer_drafts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One live draft per child per survey. A replaced draft is soft-deleted, so
-- the uniqueness holds among live rows only — Prisma cannot express a partial
-- index, hence written here.
CREATE UNIQUE INDEX "survey_answer_drafts_live_key"
  ON "survey_answer_drafts"("surveyId", "childId")
  WHERE "deletedAt" IS NULL;

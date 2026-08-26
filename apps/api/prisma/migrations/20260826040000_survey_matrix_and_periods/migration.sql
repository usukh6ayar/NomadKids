-- Matrix questions and school-year periods — RFP Module 1.1, 1.2.
--
-- Reviewed by hand per CLAUDE.md §3.3: one enum, one enum value, three
-- nullable columns, two indexes, one self-referencing foreign key. No DROP, no
-- ALTER COLUMN, nothing that can lose a row. Every column is nullable, so
-- existing surveys keep working unchanged and simply do not participate in the
-- comparison until they are classified.
--
-- ★ `indicatorKey` is the column Module 1.2 pairs September against May on, and
-- it is deliberately NOT a foreign key to another question.
--
-- Editing a DRAFT survey's questions runs `replaceQuestions`, which deletes
-- every row and creates new ones with fresh ids. A cloned survey starts as a
-- DRAFT, so any pairing built on question ids is destroyed the first time a
-- teacher reorders two questions before publishing. A free-text key that
-- round-trips through the edit endpoint survives that; a foreign key cannot.


-- CreateEnum
CREATE TYPE "SurveyPeriod" AS ENUM ('BASELINE', 'MIDLINE', 'ENDLINE');

-- AlterEnum
ALTER TYPE "SurveyQuestionType" ADD VALUE 'MATRIX';

-- AlterTable
ALTER TABLE "survey_questions" ADD COLUMN     "indicatorKey" TEXT;

-- AlterTable
ALTER TABLE "surveys" ADD COLUMN     "clonedFromSurveyId" UUID,
ADD COLUMN     "period" "SurveyPeriod",
ADD COLUMN     "schoolYear" TEXT;

-- CreateIndex
CREATE INDEX "survey_questions_kindergartenId_indicatorKey_idx" ON "survey_questions"("kindergartenId", "indicatorKey");

-- CreateIndex
CREATE INDEX "surveys_kindergartenId_schoolYear_period_idx" ON "surveys"("kindergartenId", "schoolYear", "period");

-- AddForeignKey
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_clonedFromSurveyId_fkey" FOREIGN KEY ("clonedFromSurveyId") REFERENCES "surveys"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateEnum
CREATE TYPE "SurveyKind" AS ENUM ('POLL', 'FORM');

-- AlterEnum
ALTER TYPE "SurveyQuestionType" ADD VALUE 'SINGLE_CHOICE';

-- AlterTable
ALTER TABLE "surveys" ADD COLUMN     "closesAt" TIMESTAMP(3),
ADD COLUMN     "kind" "SurveyKind" NOT NULL DEFAULT 'FORM';

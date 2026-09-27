-- Who fills a survey in — client, 2026-09-21: "Багшийн судалгаа".
-- Additive only: every existing row becomes GUARDIAN, which is what it was.
CREATE TYPE "SurveyRespondent" AS ENUM ('GUARDIAN', 'TEACHER');

ALTER TABLE "surveys" ADD COLUMN "respondent" "SurveyRespondent" NOT NULL DEFAULT 'GUARDIAN';

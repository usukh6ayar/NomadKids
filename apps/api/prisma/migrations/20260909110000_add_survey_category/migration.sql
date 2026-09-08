CREATE TYPE "SurveyCategory" AS ENUM (
  'PARENT_ENGAGEMENT',
  'SATISFACTION',
  'SOCIAL_DEVELOPMENT',
  'PHYSICAL_DEVELOPMENT',
  'COGNITIVE_DEVELOPMENT',
  'HABITS_INDEPENDENCE'
);

ALTER TABLE "surveys"
ADD COLUMN "category" "SurveyCategory" NOT NULL DEFAULT 'PARENT_ENGAGEMENT';

-- Preserve the evident meaning of existing surveys instead of assigning every
-- historical row to the default category.
UPDATE "surveys"
SET "category" = CASE
  WHEN LOWER("title") LIKE '%сэтгэл ханамж%' THEN 'SATISFACTION'::"SurveyCategory"
  WHEN LOWER("title") LIKE '%нийгэмших%' THEN 'SOCIAL_DEVELOPMENT'::"SurveyCategory"
  WHEN LOWER("title") LIKE '%бие бялдар%' THEN 'PHYSICAL_DEVELOPMENT'::"SurveyCategory"
  WHEN LOWER("title") LIKE '%танин мэдэх%' THEN 'COGNITIVE_DEVELOPMENT'::"SurveyCategory"
  WHEN LOWER("title") LIKE '%дадал хэвшил%'
    OR LOWER("title") LIKE '%бие даах%' THEN 'HABITS_INDEPENDENCE'::"SurveyCategory"
  ELSE 'PARENT_ENGAGEMENT'::"SurveyCategory"
END;

CREATE INDEX "surveys_kindergartenId_category_idx"
ON "surveys"("kindergartenId", "category");

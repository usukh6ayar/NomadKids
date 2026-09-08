-- Additive only: existing age-profile rows and legacy text fields are preserved.
ALTER TABLE "child_age_profiles"
ADD COLUMN "favoriteClothes" TEXT,
ADD COLUMN "favoriteMovie" TEXT,
ADD COLUMN "favoriteTreat" TEXT,
ADD COLUMN "kindergartenSkills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "kindergartenSkillNotes" JSONB NOT NULL DEFAULT '{}'::JSONB,
ADD COLUMN "kindergartenOtherSkill" TEXT,
ADD COLUMN "familyLearningSkills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "familyLearningNotes" JSONB NOT NULL DEFAULT '{}'::JSONB,
ADD COLUMN "familyLearningOther" TEXT,
ADD COLUMN "characterTraits" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "characterObservation" TEXT,
ADD COLUMN "familyMemberTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "familyDescription" TEXT;

-- Surface legacy free-text answers in the new section-specific editors while
-- retaining the original columns for older clients and audit history.
UPDATE "child_age_profiles"
SET "kindergartenOtherSkill" = "newSkills"
WHERE "newSkills" IS NOT NULL AND BTRIM("newSkills") <> '';

UPDATE "child_age_profiles"
SET "familyLearningOther" = "familyMembers"
WHERE "familyMembers" IS NOT NULL AND BTRIM("familyMembers") <> '';

UPDATE "child_age_profiles"
SET "characterObservation" = CONCAT_WS(
  E'\n',
  NULLIF(BTRIM("personality"), ''),
  NULLIF(BTRIM("emotionalTraits"), '')
)
WHERE ("personality" IS NOT NULL AND BTRIM("personality") <> '')
   OR ("emotionalTraits" IS NOT NULL AND BTRIM("emotionalTraits") <> '');

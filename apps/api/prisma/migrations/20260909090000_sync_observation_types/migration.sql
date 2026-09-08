-- Keep deployed reference data aligned with SYSTEM_OBSERVATION_TYPES.
-- Production deploys run migrations, not the demo seed, so the three teacher
-- note types must be introduced here as well as in prisma/system-config.ts.

INSERT INTO "observation_types" (
  "id", "kindergartenId", "code", "name", "order", "isActive", "createdAt", "updatedAt"
)
VALUES
  (gen_random_uuid(), NULL, 'daily',        'Ажиглалт',          1, true, NOW(), NOW()),
  (gen_random_uuid(), NULL, 'conversation', 'Ярилцлага',         2, true, NOW(), NOW()),
  (gen_random_uuid(), NULL, 'artwork',      'Бүтээл',            3, true, NOW(), NOW()),
  (gen_random_uuid(), NULL, 'parent',       'Гэр бүлээс ирсэн',  4, true, NOW(), NOW())
ON CONFLICT DO NOTHING;

UPDATE "observation_types"
SET "name" = CASE "code"
    WHEN 'daily' THEN 'Ажиглалт'
    WHEN 'conversation' THEN 'Ярилцлага'
    WHEN 'artwork' THEN 'Бүтээл'
    WHEN 'parent' THEN 'Гэр бүлээс ирсэн'
  END,
  "order" = CASE "code"
    WHEN 'daily' THEN 1
    WHEN 'conversation' THEN 2
    WHEN 'artwork' THEN 3
    WHEN 'parent' THEN 4
  END,
  "isActive" = true,
  "deletedAt" = NULL,
  "updatedAt" = NOW()
WHERE "kindergartenId" IS NULL
  AND "code" IN ('daily', 'conversation', 'artwork', 'parent');

-- Historical observations retain these rows through their foreign keys, but
-- teachers cannot create new notes under superseded categories.
UPDATE "observation_types"
SET "deletedAt" = NOW(), "updatedAt" = NOW()
WHERE "kindergartenId" IS NULL
  AND "deletedAt" IS NULL
  AND "code" NOT IN ('daily', 'conversation', 'artwork', 'parent');

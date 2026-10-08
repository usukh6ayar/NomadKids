-- Keep deployed reference data aligned with SYSTEM_DOMAINS.
--
-- Production starts with `prisma migrate deploy`; it does not run the demo
-- seed. The seven curriculum strands were added to `prisma/system-config.ts`
-- in September, but without a migration a deployed database kept the former
-- five names and never received `environment` or `music`.
--
-- Insert first so a fresh deployment receives every row. The partial unique
-- index on system codes makes this safe when a database was already repaired
-- by running the seed manually.

INSERT INTO "development_domains" (
  "id", "kindergartenId", "code", "name", "color", "order", "isActive", "createdAt", "updatedAt"
)
VALUES
  (gen_random_uuid(), NULL, 'social',      'Нийгэм-сэтгэл хөдлөл',     '#ec4899', 1, true, NOW(), NOW()),
  (gen_random_uuid(), NULL, 'physical',    'Хөдөлгөөн, эрүүл мэнд',    '#f97316', 2, true, NOW(), NOW()),
  (gen_random_uuid(), NULL, 'language',    'Хэл яриа',                 '#3b82f6', 3, true, NOW(), NOW()),
  (gen_random_uuid(), NULL, 'environment', 'Байгаль, нийгмийн орчин',  '#14b8a6', 4, true, NOW(), NOW()),
  (gen_random_uuid(), NULL, 'cognitive',   'Математик',                '#8b5cf6', 5, true, NOW(), NOW()),
  (gen_random_uuid(), NULL, 'creative',    'Зураг, урлал',             '#10b981', 6, true, NOW(), NOW()),
  (gen_random_uuid(), NULL, 'music',       'Хөгжим',                   '#f43f5e', 7, true, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- Existing system rows keep their ids, preserving every assessment,
-- observation-domain link and curriculum indicator that already references
-- them. Only the teacher-facing labels and reference metadata are repaired.
UPDATE "development_domains"
SET
  "name" = CASE "code"
    WHEN 'social' THEN 'Нийгэм-сэтгэл хөдлөл'
    WHEN 'physical' THEN 'Хөдөлгөөн, эрүүл мэнд'
    WHEN 'language' THEN 'Хэл яриа'
    WHEN 'environment' THEN 'Байгаль, нийгмийн орчин'
    WHEN 'cognitive' THEN 'Математик'
    WHEN 'creative' THEN 'Зураг, урлал'
    WHEN 'music' THEN 'Хөгжим'
  END,
  "color" = CASE "code"
    WHEN 'social' THEN '#ec4899'
    WHEN 'physical' THEN '#f97316'
    WHEN 'language' THEN '#3b82f6'
    WHEN 'environment' THEN '#14b8a6'
    WHEN 'cognitive' THEN '#8b5cf6'
    WHEN 'creative' THEN '#10b981'
    WHEN 'music' THEN '#f43f5e'
  END,
  "order" = CASE "code"
    WHEN 'social' THEN 1
    WHEN 'physical' THEN 2
    WHEN 'language' THEN 3
    WHEN 'environment' THEN 4
    WHEN 'cognitive' THEN 5
    WHEN 'creative' THEN 6
    WHEN 'music' THEN 7
  END,
  "isActive" = true,
  "deletedAt" = NULL,
  "updatedAt" = NOW()
WHERE "kindergartenId" IS NULL
  AND "code" IN ('social', 'physical', 'language', 'environment', 'cognitive', 'creative', 'music');

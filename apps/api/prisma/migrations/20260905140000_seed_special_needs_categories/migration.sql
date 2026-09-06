-- The nine special-needs categories — Order А/261, kindergarten criterion 11.
--
-- ★ Seeded by a MIGRATION, not by `prisma/seed.ts`.
--
-- `apps/api/docker-entrypoint.sh` runs `prisma migrate deploy` and nothing
-- else. `prisma/seed.ts` is not part of a deploy and should not be — it creates
-- demo kindergartens. So a reference row that a screen needs has to arrive the
-- same way the table itself does.
--
-- ★ The other three config tables ARE populated in production — 5 domains, 4
-- levels, 5 observation types, checked 2026-09-05 — which means somebody ran
-- the seed by hand at some point. That worked and is not a thing to rely on: a
-- release whose correctness depends on remembering an SSH command is a release
-- that eventually ships without it.
--
-- Without this migration, `/children/:id/health/special-needs/categories`
-- answers with an empty array in production, the picker has nothing to choose,
-- and criterion 11 ships as a form that cannot be submitted. No test would have
-- caught it: `resetData()` calls `applySystemConfig()`, and the deployment does
-- not.
--
-- ★★ `ON CONFLICT DO NOTHING` against the partial unique index, so this is
-- idempotent and cannot collide with `applySystemConfig()` on a developer
-- machine that has already run the seed.
--
-- ★★★ The ids are generated, not fixed. A kindergarten's own category is a
-- separate row with its own `kindergartenId`; nothing outside this table
-- references these by a known id.

INSERT INTO "special_needs_categories" ("id", "kindergartenId", "code", "name", "order", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), NULL, 'vision',       'Хараа',                    1, true, NOW(), NOW()),
  (gen_random_uuid(), NULL, 'hearing',      'Сонсгол',                  2, true, NOW(), NOW()),
  (gen_random_uuid(), NULL, 'speech',       'Хэл яриа',                 3, true, NOW(), NOW()),
  (gen_random_uuid(), NULL, 'mobility',     'Хөдөлгөөн, тулгуур эрхтэн', 4, true, NOW(), NOW()),
  (gen_random_uuid(), NULL, 'intellectual', 'Оюун ухаан',               5, true, NOW(), NOW()),
  (gen_random_uuid(), NULL, 'psychosocial', 'Сэтгэц, зан үйл',          6, true, NOW(), NOW()),
  (gen_random_uuid(), NULL, 'autism',       'Аутизмын хүрээний эмгэг',  7, true, NOW(), NOW()),
  (gen_random_uuid(), NULL, 'multiple',     'Олон талт бэрхшээл',       8, true, NOW(), NOW()),
  (gen_random_uuid(), NULL, 'other',        'Бусад',                    9, true, NOW(), NOW())
ON CONFLICT DO NOTHING;

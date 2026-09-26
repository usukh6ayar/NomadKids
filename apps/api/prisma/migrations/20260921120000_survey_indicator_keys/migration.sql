-- Gives every question that has no indicator key one — client, 2026-09-21.
--
-- The key pairs a question with its repeat in a later wave. It was a field the
-- teacher had to fill in by hand, in Latin letters, and almost nobody did, so
-- most questions could not be compared. The server now names each question
-- itself (`src/surveys/indicator-key.ts`); this names the ones that already
-- exist, with the same rule, so a survey cloned before today pairs with its
-- source: 'q_' || the first 12 hex digits of md5(prompt without surrounding
-- whitespace). Two questions in one survey with the same words get _2, _3.
--
-- Data only: fills NULLs, never overwrites a key somebody wrote, drops nothing.
WITH keyed AS (
  SELECT
    id,
    'q_' || left(md5(btrim(prompt, E' \t\n\r')), 12) AS base,
    row_number() OVER (
      PARTITION BY "surveyId", left(md5(btrim(prompt, E' \t\n\r')), 12)
      ORDER BY "order", id
    ) AS n
  FROM "survey_questions"
  WHERE "indicatorKey" IS NULL
)
UPDATE "survey_questions" AS q
SET "indicatorKey" = CASE WHEN keyed.n = 1 THEN keyed.base ELSE keyed.base || '_' || keyed.n END
FROM keyed
WHERE q.id = keyed.id;

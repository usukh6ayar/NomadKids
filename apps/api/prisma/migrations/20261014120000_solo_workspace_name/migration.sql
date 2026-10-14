-- A solo teacher's workspace is named after the teacher alone (the user,
-- 2026-10-14): «Б.Зураач — бие даасан багш» was the title of their own
-- dashboard. Data only. Every renamed row gets an UPDATE audit entry carrying
-- the name it had (CLAUDE.md §3.2).

WITH renamed AS (
  UPDATE "kindergartens" AS k
     SET "name" = left(k."name", length(k."name") - length(' — бие даасан багш')),
         "updatedAt" = NOW()
   WHERE k."kind" = 'SOLO_TEACHER'
     AND k."name" LIKE '% — бие даасан багш'
  RETURNING k."id", k."name" AS "after"
)
INSERT INTO "audit_logs" ("id", "kindergartenId", "actorLabel", "action", "objectType", "objectId", "metadata")
SELECT gen_random_uuid(), r."id", 'Систем — бие даасан багшийн орчны нэр',
       'UPDATE', 'Kindergarten', r."id"::text,
       jsonb_build_object('before', jsonb_build_object('name', r."after" || ' — бие даасан багш'),
                          'after', jsonb_build_object('name', r."after"))
FROM renamed AS r;

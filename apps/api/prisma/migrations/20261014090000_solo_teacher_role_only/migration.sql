-- A solo teacher is the workspace's teacher, not its director (the user,
-- 2026-10-14). Sign-up made them ADMIN as well, and the web showed them the
-- director («Удирдлага»). Sign-up now creates the TEACHER membership only;
-- this moves everyone who already signed up onto it — and first makes sure
-- nothing they built as ADMIN drops out of a TEACHER's reach.
--
-- Data only, no schema change. Nothing is removed (CLAUDE.md §3.2): rows are
-- added, or revoked and soft-deleted. Every change has its audit row.
--
-- Only live solo workspaces (not one already merged into a kindergarten), and
-- only a teacher with a live TEACHER membership there — otherwise revoking
-- ADMIN would lock them out, and that row is left as it is.
--
-- What a TEACHER reaches that an ADMIN reached without asking, and so what
-- has to be true before ADMIN goes:
--   1. a group, only through an active assignment to it (`GroupTeacher`);
--   2. a child, only through an enrolment in such a group — the
--      no-enrolment fallback is the administrator's alone (§1.2).
-- Notices, surveys and the rest are the author's and stay so.

-- `solo_teacher`, repeated at the head of each statement below: the live
-- TEACHER membership of each live solo workspace.

-- 1. The teacher teaches every live group of their workspace.
WITH solo_teacher AS (
  SELECT t."id" AS "membershipId", t."userId", t."kindergartenId"
  FROM "memberships" AS t
  JOIN "kindergartens" AS k ON k."id" = t."kindergartenId"
  WHERE k."kind" = 'SOLO_TEACHER'
    AND k."deletedAt" IS NULL
    AND t."role" = 'TEACHER'
    AND t."isActive" = true
    AND t."deletedAt" IS NULL
),
assigned AS (
  INSERT INTO "group_teachers" ("id", "kindergartenId", "groupId", "membershipId", "role", "startedOn", "updatedAt")
  SELECT gen_random_uuid(), g."kindergartenId", g."id", s."membershipId", 'LEAD', CURRENT_DATE, NOW()
  FROM "groups" AS g
  JOIN solo_teacher AS s ON s."kindergartenId" = g."kindergartenId"
  WHERE g."deletedAt" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "group_teachers" AS a
      WHERE a."groupId" = g."id"
        AND a."membershipId" = s."membershipId"
        AND a."endedOn" IS NULL
        AND a."deletedAt" IS NULL
    )
  RETURNING "id", "kindergartenId", "groupId", "membershipId"
)
INSERT INTO "audit_logs" ("id", "kindergartenId", "actorLabel", "action", "objectType", "objectId", "metadata")
SELECT gen_random_uuid(), a."kindergartenId", 'Систем — бие даасан багш зөвхөн багшийн эрхтэй',
       'PERMISSION_CHANGE', 'GroupTeacher', a."id"::text,
       jsonb_build_object('groupId', a."groupId", 'membershipId', a."membershipId", 'change', 'assigned')
FROM assigned AS a;

-- 2. A child registered without a group goes into the workspace's group of
--    its current year — only where there is exactly one, so nobody guesses.
--    A child no longer attending gets an ended enrolment: still the
--    teacher's record, on no live roster.
WITH solo_teacher AS (
  SELECT t."id" AS "membershipId", t."userId", t."kindergartenId"
  FROM "memberships" AS t
  JOIN "kindergartens" AS k ON k."id" = t."kindergartenId"
  WHERE k."kind" = 'SOLO_TEACHER'
    AND k."deletedAt" IS NULL
    AND t."role" = 'TEACHER'
    AND t."isActive" = true
    AND t."deletedAt" IS NULL
),
target AS (
  SELECT g."kindergartenId", min(g."id"::text)::uuid AS "groupId", min(g."schoolYearId"::text)::uuid AS "schoolYearId"
  FROM "groups" AS g
  JOIN "school_years" AS y ON y."id" = g."schoolYearId" AND y."isCurrent" = true AND y."deletedAt" IS NULL
  WHERE g."deletedAt" IS NULL
    AND g."kindergartenId" IN (SELECT "kindergartenId" FROM solo_teacher)
  GROUP BY g."kindergartenId"
  HAVING count(*) = 1
),
enrolled AS (
  INSERT INTO "enrollments" ("id", "kindergartenId", "childId", "groupId", "schoolYearId", "startedOn", "endedOn", "status", "updatedAt")
  SELECT gen_random_uuid(), c."kindergartenId", c."id", t."groupId", t."schoolYearId",
         c."createdAt"::date,
         CASE WHEN c."status" = 'INACTIVE' THEN c."updatedAt"::date END,
         CASE WHEN c."status" = 'INACTIVE' THEN 'ENDED' ELSE 'ACTIVE' END::"EnrollmentStatus",
         NOW()
  FROM "children" AS c
  JOIN target AS t ON t."kindergartenId" = c."kindergartenId"
  WHERE c."deletedAt" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "enrollments" AS e WHERE e."childId" = c."id" AND e."deletedAt" IS NULL
    )
  RETURNING "id", "kindergartenId", "childId", "groupId"
)
INSERT INTO "audit_logs" ("id", "kindergartenId", "actorLabel", "action", "objectType", "objectId", "childId", "metadata")
SELECT gen_random_uuid(), e."kindergartenId", 'Систем — бие даасан багш зөвхөн багшийн эрхтэй',
       'CREATE', 'Enrollment', e."id"::text, e."childId",
       jsonb_build_object('groupId', e."groupId", 'change', 'enrolled')
FROM enrolled AS e;

-- 3. The director's role goes.
WITH solo_teacher AS (
  SELECT t."id" AS "membershipId", t."userId", t."kindergartenId"
  FROM "memberships" AS t
  JOIN "kindergartens" AS k ON k."id" = t."kindergartenId"
  WHERE k."kind" = 'SOLO_TEACHER'
    AND k."deletedAt" IS NULL
    AND t."role" = 'TEACHER'
    AND t."isActive" = true
    AND t."deletedAt" IS NULL
),
revoked AS (
  UPDATE "memberships" AS m
  SET "isActive" = false, "deletedAt" = NOW(), "updatedAt" = NOW()
  FROM solo_teacher AS s
  WHERE m."userId" = s."userId"
    AND m."kindergartenId" = s."kindergartenId"
    AND m."role" = 'ADMIN'
    AND m."deletedAt" IS NULL
  RETURNING m."id", m."userId", m."kindergartenId", m."isActive"
)
INSERT INTO "audit_logs" ("id", "kindergartenId", "actorLabel", "action", "objectType", "objectId", "metadata")
SELECT gen_random_uuid(), r."kindergartenId", 'Систем — бие даасан багш зөвхөн багшийн эрхтэй',
       'PERMISSION_CHANGE', 'Membership', r."id"::text,
       jsonb_build_object('userId', r."userId", 'before', jsonb_build_object('role', 'ADMIN', 'isActive', true))
FROM revoked AS r;

-- 4. A one-word «Овог нэр» at sign-up was written as both names
--    («Сараа Сараа»). The surname goes; the given name stays.
WITH solo_teacher AS (
  SELECT t."id" AS "membershipId", t."userId", t."kindergartenId"
  FROM "memberships" AS t
  JOIN "kindergartens" AS k ON k."id" = t."kindergartenId"
  WHERE k."kind" = 'SOLO_TEACHER'
    AND k."deletedAt" IS NULL
    AND t."role" = 'TEACHER'
    AND t."isActive" = true
    AND t."deletedAt" IS NULL
),
renamed AS (
  UPDATE "users" AS u
  SET "lastName" = '', "updatedAt" = NOW()
  WHERE u."selfRegisteredAt" IS NOT NULL
    AND u."lastName" <> ''
    AND u."lastName" = u."firstName"
    AND u."id" IN (SELECT "userId" FROM solo_teacher)
  RETURNING u."id", u."firstName"
)
INSERT INTO "audit_logs" ("id", "actorLabel", "action", "objectType", "objectId", "metadata")
SELECT gen_random_uuid(), 'Систем — бие даасан багшийн нэр давхардсан',
       'UPDATE', 'User', r."id"::text,
       jsonb_build_object('before', jsonb_build_object('lastName', r."firstName"))
FROM renamed AS r;

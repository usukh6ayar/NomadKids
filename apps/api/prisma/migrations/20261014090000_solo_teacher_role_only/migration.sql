-- A solo teacher is the workspace's teacher, not its director (the user,
-- 2026-10-14): sign-up made them ADMIN as well, and the web showed them the
-- director («Удирдлага»). Sign-up now creates the TEACHER membership only;
-- this revokes the ADMIN one from everyone who already signed up.
--
-- Data only, no schema change. Revoked the way `DELETE /memberships/:id`
-- revokes (isActive false) and soft-deleted, never removed — CLAUDE.md §3.2.
-- Only where a live TEACHER membership in the same workspace remains, so
-- nobody is locked out of their own group. The group, its children and the
-- teacher's assignment are untouched. Who removed it lives in `audit_logs`.

WITH revoked AS (
  UPDATE "memberships" AS m
  SET "isActive" = false, "deletedAt" = NOW(), "updatedAt" = NOW()
  FROM "kindergartens" AS k
  WHERE m."kindergartenId" = k."id"
    AND k."kind" = 'SOLO_TEACHER'
    AND m."role" = 'ADMIN'
    AND m."deletedAt" IS NULL
    AND EXISTS (
      SELECT 1 FROM "memberships" AS t
      WHERE t."userId" = m."userId"
        AND t."kindergartenId" = m."kindergartenId"
        AND t."role" = 'TEACHER'
        AND t."isActive" = true
        AND t."deletedAt" IS NULL
    )
  RETURNING m."id", m."userId", m."kindergartenId"
)
INSERT INTO "audit_logs" ("id", "kindergartenId", "actorLabel", "action", "objectType", "objectId", "metadata")
SELECT gen_random_uuid(), r."kindergartenId", 'Систем — бие даасан багш зөвхөн багшийн эрхтэй',
       'PERMISSION_CHANGE', 'Membership', r."id"::text,
       jsonb_build_object('userId', r."userId", 'before', jsonb_build_object('role', 'ADMIN', 'isActive', true))
FROM revoked AS r;

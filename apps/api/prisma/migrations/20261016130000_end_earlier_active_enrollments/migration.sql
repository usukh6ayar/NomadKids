-- A child moved into another school year's group before 2026-09-01 kept the
-- earlier year's enrolment ACTIVE: `enrollChild` then matched the row to end
-- by `schoolYearId`, so the move ended nothing (children.repository.ts still
-- says such rows exist). Since #235 a teacher reaches a child through an
-- ACTIVE enrolment only — so the old group's teacher kept the child's card,
-- health record and photographs through the stale row, and every roster and
-- the funding register counted the child twice.
--
-- Data only. An ACTIVE enrolment ends when the same child holds a later-year
-- ACTIVE one in the same kindergarten — TRANSFERRED, as `enrollChild` writes a
-- move, dated the day the next one starts (never before its own start).
UPDATE "enrollments" AS e
SET "status" = 'TRANSFERRED',
    "endedOn" = GREATEST(e."startedOn", nxt."startedOn"),
    "updatedAt" = now()
FROM (
  SELECT DISTINCT ON (old."id") old."id" AS "enrollmentId", newer."startedOn"
  FROM "enrollments" AS old
  JOIN "school_years" AS oy ON oy."id" = old."schoolYearId"
  JOIN "enrollments" AS newer
    ON newer."childId" = old."childId"
   AND newer."kindergartenId" = old."kindergartenId"
   AND newer."status" = 'ACTIVE'
   AND newer."deletedAt" IS NULL
  JOIN "school_years" AS ny
    ON ny."id" = newer."schoolYearId"
   AND ny."startsOn" > oy."startsOn"
  WHERE old."status" = 'ACTIVE'
    AND old."deletedAt" IS NULL
  ORDER BY old."id", ny."startsOn" ASC
) AS nxt
WHERE e."id" = nxt."enrollmentId";

-- Archiving a child left their enrolment ACTIVE, and every group roster reads
-- enrolments by status — the archived child stayed on the attendance sheet, in
-- the funding register and in the invoice run. `ChildrenRepository.archiveChild`
-- now ends the enrolment with the child; this closes the ones archived before.
--
-- Data only. `endedOn` is the day the child was archived, not today, so the
-- enrolment history says when they actually left.
UPDATE "enrollments" AS e
SET "status" = 'ENDED',
    "endedOn" = c."deletedAt"::date,
    "updatedAt" = now()
FROM "children" AS c
WHERE e."childId" = c."id"
  AND c."deletedAt" IS NOT NULL
  AND e."status" = 'ACTIVE'
  AND e."deletedAt" IS NULL;

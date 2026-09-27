-- The staff registration code is replaced by the kindergarten's ESIS
-- institution number (`kindergartens.esisInstitutionId`), at the client's
-- instruction on 2026-09-20.
--
-- Safe to drop rather than deprecate: nothing reads either column any more.
-- `StaffRegistrationService.issueCode` and its route are deleted in the same
-- change, and `register()` now resolves the kindergarten by institution
-- number. What the hash column held was a credential that no code path can
-- verify, so keeping it would preserve a secret nobody can use and everybody
-- would have to reason about.
ALTER TABLE "kindergartens" DROP COLUMN "staffRegistrationCodeHash";
ALTER TABLE "kindergartens" DROP COLUMN "staffRegistrationCodeSetAt";

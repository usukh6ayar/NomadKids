-- The contract's generated PDF, as a real foreign key.
--
-- ★ A separate migration rather than an edit to
-- `20260902200000_onboarding_applications_and_contracts`, which was already
-- pushed and applied. Editing an applied migration makes the checksum in
-- `_prisma_migrations` disagree with the file, and `migrate deploy` then
-- refuses to run at all — on the production container, at boot.
--
-- `ON DELETE SET NULL`: the retention sweep removes an expired report output,
-- and a contract whose PDF has aged out is still a contract. Losing the row
-- because the file was collected would be the wrong way round.
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_pdfMediaFileId_fkey"
  FOREIGN KEY ("pdfMediaFileId") REFERENCES "media_files"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- One invoice per child per month PER KINDERGARTEN (the frontend's backend
-- list №20). A child who moved mid-month could not be billed by the second
-- kindergarten: the key was (childId, month) across every kindergarten.
--
-- The new key is created first, so the table is never without one. Every
-- existing row satisfies it: it is strictly weaker than the old key.
CREATE UNIQUE INDEX "invoices_kindergartenId_childId_month_key" ON "invoices"("kindergartenId", "childId", "month");

DROP INDEX "invoices_childId_month_key";

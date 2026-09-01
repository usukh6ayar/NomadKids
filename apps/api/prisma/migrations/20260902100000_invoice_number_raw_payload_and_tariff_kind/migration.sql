-- Three columns carried over from the invoice implementation that was merged
-- away on 2026-09-01, onto the one that survived. All three are nullable
-- additions: no existing row changes, and `migrate deploy` against the
-- production database (where `invoices` and `payments` are empty) is a no-op
-- in everything but shape.

-- нэмэлт.md §7 — the number a parent quotes on a transfer. Generated as
-- `2026-000042` by `nextInvoiceNumber`. Unique within a kindergarten and never
-- reused: the lookup deliberately ignores `deletedAt`, so voiding an invoice
-- retires its number with it.
--
-- ★ The unique index is NOT partial on `deletedAt`. That is the point — a
-- partial index would let a voided number come back.
ALTER TABLE "invoices" ADD COLUMN "number" TEXT;
CREATE UNIQUE INDEX "invoices_kindergartenId_number_key" ON "invoices"("kindergartenId", "number");

-- нэмэлт.md §14 — the gateway's own confirmation body, kept as evidence for a
-- dispute. Never parsed for business logic: the amount credited comes from the
-- frozen `qpay_invoices.amount` and the decision to credit from a
-- `checkPayment` response this system fetched itself.
ALTER TABLE "payments" ADD COLUMN "rawPayload" JSONB;

-- нэмэлт.md §3/§7 — which kind of invoice line a PARENT tariff produces, so a
-- month's invoices can be generated from the rules rather than typed by hand.
-- Null on STATE, KINDERGARTEN and OTHER rules, which never bill a parent.
ALTER TABLE "funding_rules" ADD COLUMN "invoiceItemKind" "InvoiceLineType";

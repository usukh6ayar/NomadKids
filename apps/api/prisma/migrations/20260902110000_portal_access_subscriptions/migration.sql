-- Portal access, and QPay repointed at it.
--
-- Client instruction, 2026-09-01: "QPay-ийг зөвхөн эцэг эхчүүдээс энэхүү
-- website-ийг ашиглах эрхийг нээхийн тулд мөнгө авна. Өөр зүйлд QPay
-- ашиглахгүй." Tuition and meal invoices remain, and are still settled — by
-- cash or bank transfer, recorded by the accountant — but never through this
-- gateway.
--
-- ★★ THIS MIGRATION DROPS A NOT NULL COLUMN (`qpay_invoices.invoiceId`) AND
-- ADDS ANOTHER IN ITS PLACE. That is data-losing in general and safe here for
-- one specific, checked reason: `qpay_invoices` is empty in every environment.
-- Production was queried on 2026-09-01 —
--   invoices 0 · payments 0 · qpay_invoices 0 · settled 0
-- — and dev/test databases are rebuilt from these migrations. If this ever
-- needs re-running against a database where the table is NOT empty, the
-- ADD COLUMN ... NOT NULL will fail loudly rather than corrupt anything, which
-- is the behaviour to want. CLAUDE.md §3.3.

-- CreateEnum
CREATE TYPE "AccessSubscriptionStatus" AS ENUM ('UNPAID', 'ACTIVE', 'EXPIRED');

-- CreateTable
CREATE TABLE "access_subscriptions" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "schoolYearId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "AccessSubscriptionStatus" NOT NULL DEFAULT 'UNPAID',
    "paidAt" TIMESTAMP(3),
    "expiresAt" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "access_subscriptions_pkey" PRIMARY KEY ("id")
);

-- One subscription per child per school year.
CREATE UNIQUE INDEX "access_subscriptions_childId_schoolYearId_key" ON "access_subscriptions"("childId", "schoolYearId");
CREATE INDEX "access_subscriptions_kindergartenId_status_idx" ON "access_subscriptions"("kindergartenId", "status");

ALTER TABLE "access_subscriptions" ADD CONSTRAINT "access_subscriptions_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "access_subscriptions" ADD CONSTRAINT "access_subscriptions_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "access_subscriptions" ADD CONSTRAINT "access_subscriptions_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "school_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Repoint qpay_invoices: a payment attempt is now against portal access, not
-- against a kindergarten invoice.
ALTER TABLE "qpay_invoices" DROP CONSTRAINT "qpay_invoices_invoiceId_fkey";
DROP INDEX "qpay_invoices_invoiceId_idx";
ALTER TABLE "qpay_invoices" DROP COLUMN "invoiceId";
ALTER TABLE "qpay_invoices" ADD COLUMN "subscriptionId" UUID NOT NULL;

CREATE INDEX "qpay_invoices_subscriptionId_idx" ON "qpay_invoices"("subscriptionId");
ALTER TABLE "qpay_invoices" ADD CONSTRAINT "qpay_invoices_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "access_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- `qpay_invoices.paymentId` goes with the repointing. An access fee is the
-- platform operator's revenue, not a kindergarten's — it must never appear in
-- the ledger §14 audits, so no `Payment` row is created for one and there is
-- nothing left for this column to reference. `claimForPayment` remains the
-- single-winner guard it always was; the one-to-one pairing it backed up was
-- only ever about a Payment that no longer exists here.
ALTER TABLE "qpay_invoices" DROP CONSTRAINT IF EXISTS "qpay_invoices_paymentId_fkey";
DROP INDEX IF EXISTS "qpay_invoices_paymentId_key";
ALTER TABLE "qpay_invoices" DROP COLUMN "paymentId";

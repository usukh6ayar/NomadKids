-- №6 (the user, 2026-10-16/18): a kindergarten pays its platform contract
-- through QPay. Additive only — a new table, a nullable column, indexes.

-- CreateEnum
CREATE TYPE "ContractPaymentStatus" AS ENUM ('PENDING', 'PAID');

-- AlterTable
ALTER TABLE "qpay_invoices" ADD COLUMN     "contractPaymentId" UUID;

-- CreateTable
CREATE TABLE "contract_payments" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "period" "BillingPeriod" NOT NULL,
    "termNumber" INTEGER,
    "coversFrom" DATE NOT NULL,
    "coversTo" DATE NOT NULL,
    "groupCount" INTEGER NOT NULL,
    "perGroupAmount" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "ContractPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contract_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_payments_kindergartenId_status_idx" ON "contract_payments"("kindergartenId", "status");

-- CreateIndex
CREATE INDEX "contract_payments_status_paidAt_idx" ON "contract_payments"("status", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "contract_payments_contractId_period_coversFrom_key" ON "contract_payments"("contractId", "period", "coversFrom");

-- CreateIndex
CREATE INDEX "qpay_invoices_contractPaymentId_idx" ON "qpay_invoices"("contractPaymentId");

-- AddForeignKey
ALTER TABLE "qpay_invoices" ADD CONSTRAINT "qpay_invoices_contractPaymentId_fkey" FOREIGN KEY ("contractPaymentId") REFERENCES "contract_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_payments" ADD CONSTRAINT "contract_payments_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_payments" ADD CONSTRAINT "contract_payments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_payments" ADD CONSTRAINT "contract_payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- An attempt still pays for exactly one thing — now one of three. Hand-written
-- (Prisma cannot express it); pinned by `test/schema.test.ts`. Every existing
-- row has a subscription or a material purchase, so it holds.
ALTER TABLE "qpay_invoices" DROP CONSTRAINT "qpay_invoices_one_target_check";
ALTER TABLE "qpay_invoices" ADD CONSTRAINT "qpay_invoices_one_target_check"
  CHECK (num_nonnulls("subscriptionId", "materialPurchaseId", "contractPaymentId") = 1);

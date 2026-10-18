-- The user, 2026-10-18: a director accepts the contract online (out of RFP
-- Phase IV's e-signature for this one act), and its first period is paid by
-- QPay or by a bank transfer the operator records — state kindergartens pay
-- against an invoice (client, 2026-10-18). Additive: a new append-only table,
-- nullable columns, and the period key widened by `initial` (the DROP INDEX
-- replaces it with a wider one, no row is touched by it).
CREATE TYPE "ContractPaymentMethod" AS ENUM ('QPAY', 'BANK_TRANSFER');

-- DropIndex
DROP INDEX "contract_payments_contractId_period_coversFrom_key";

-- AlterTable
ALTER TABLE "contract_payments" ADD COLUMN     "ebarimtNumber" VARCHAR(64),
ADD COLUMN     "initial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "method" "ContractPaymentMethod",
ADD COLUMN     "recordedById" UUID,
ADD COLUMN     "reference" VARCHAR(200);

-- CreateTable
CREATE TABLE "contract_acceptances" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "contractVersion" INTEGER NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "pdfMediaFileId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "terms" JSONB NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "contract_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_acceptances_kindergartenId_idx" ON "contract_acceptances"("kindergartenId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_acceptances_contractId_contractVersion_key" ON "contract_acceptances"("contractId", "contractVersion");

-- CreateIndex
CREATE UNIQUE INDEX "contract_payments_contractId_initial_period_coversFrom_key" ON "contract_payments"("contractId", "initial", "period", "coversFrom");

-- AddForeignKey
ALTER TABLE "contract_payments" ADD CONSTRAINT "contract_payments_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_acceptances" ADD CONSTRAINT "contract_acceptances_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_acceptances" ADD CONSTRAINT "contract_acceptances_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_acceptances" ADD CONSTRAINT "contract_acceptances_pdfMediaFileId_fkey" FOREIGN KEY ("pdfMediaFileId") REFERENCES "media_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_acceptances" ADD CONSTRAINT "contract_acceptances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Every period paid before this migration was paid by QPay — №6 had no other way.
UPDATE "contract_payments" SET "method" = 'QPAY' WHERE "status" = 'PAID' AND "method" IS NULL;

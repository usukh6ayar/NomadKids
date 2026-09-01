-- CreateEnum
CREATE TYPE "QpayInvoiceStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "qpay_invoices" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "qpayInvoiceId" TEXT NOT NULL,
    "senderInvoiceNo" TEXT NOT NULL,
    "qrText" TEXT,
    "qrImage" TEXT,
    "status" "QpayInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "paymentId" UUID,
    "createdById" UUID,
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qpay_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qpay_invoices_qpayInvoiceId_key" ON "qpay_invoices"("qpayInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "qpay_invoices_senderInvoiceNo_key" ON "qpay_invoices"("senderInvoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "qpay_invoices_paymentId_key" ON "qpay_invoices"("paymentId");

-- CreateIndex
CREATE INDEX "qpay_invoices_invoiceId_idx" ON "qpay_invoices"("invoiceId");

-- CreateIndex
CREATE INDEX "qpay_invoices_kindergartenId_status_idx" ON "qpay_invoices"("kindergartenId", "status");

-- AddForeignKey
ALTER TABLE "qpay_invoices" ADD CONSTRAINT "qpay_invoices_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qpay_invoices" ADD CONSTRAINT "qpay_invoices_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qpay_invoices" ADD CONSTRAINT "qpay_invoices_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qpay_invoices" ADD CONSTRAINT "qpay_invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

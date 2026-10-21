-- «Төлбөр шалгах» (2026-10-21): a QPay attempt with money QPay reports and
-- nothing opened for it. Additive only — a nullable column and its enum.

-- CreateEnum
CREATE TYPE "QpayReviewReason" AS ENUM ('AMOUNT_SHORT', 'TARGET_ALREADY_PAID');

-- AlterTable
ALTER TABLE "qpay_invoices" ADD COLUMN     "reviewReason" "QpayReviewReason";

-- CreateEnum
CREATE TYPE "KindergartenApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('PENDING_SIGNATURE', 'SIGNED', 'ACTIVE', 'CANCELLED');

-- AlterEnum
ALTER TYPE "ReportType" ADD VALUE 'CONTRACT';

-- CreateTable
CREATE TABLE "kindergarten_applications" (
    "id" UUID NOT NULL,
    "kindergartenName" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "directorName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "childCount" INTEGER NOT NULL,
    "note" TEXT,
    "status" "KindergartenApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "kindergartenId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "kindergarten_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "kindergartenId" UUID,
    "number" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ContractStatus" NOT NULL DEFAULT 'PENDING_SIGNATURE',
    "childCount" INTEGER NOT NULL,
    "annualFee" DECIMAL(12,2) NOT NULL,
    "perChildMonthlyFee" DECIMAL(12,2) NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "pdfMediaFileId" UUID,
    "signedMediaFileId" UUID,
    "signedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kindergarten_applications_status_createdAt_idx" ON "kindergarten_applications"("status", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "contracts_applicationId_key" ON "contracts"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_number_key" ON "contracts"("number");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_pdfMediaFileId_key" ON "contracts"("pdfMediaFileId");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_signedMediaFileId_key" ON "contracts"("signedMediaFileId");

-- CreateIndex
CREATE INDEX "contracts_status_createdAt_idx" ON "contracts"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "contracts_kindergartenId_idx" ON "contracts"("kindergartenId");

-- AddForeignKey
ALTER TABLE "kindergarten_applications" ADD CONSTRAINT "kindergarten_applications_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kindergarten_applications" ADD CONSTRAINT "kindergarten_applications_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "kindergarten_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ★ Prisma cannot express a partial unique index, so it is written by hand.
--
-- One live application per registration number. Scoped to `deletedAt IS NULL`
-- on purpose: a kindergarten whose first application was rejected and soft
-- deleted must be able to apply again, and a plain UNIQUE would refuse them
-- forever on the strength of a row nobody can see.
CREATE UNIQUE INDEX "kindergarten_applications_registrationNumber_live_key"
  ON "kindergarten_applications" ("registrationNumber")
  WHERE "deletedAt" IS NULL;

-- User agreements accepted on first sign-in (#211, 2026-10-12). Append-only.
-- CreateEnum
CREATE TYPE "AgreementKind" AS ENUM ('TEACHER', 'PARENT');

-- CreateTable
CREATE TABLE "agreement_acceptances" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "AgreementKind" NOT NULL,
    "version" VARCHAR(64) NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "agreement_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agreement_acceptances_kind_version_acceptedAt_idx" ON "agreement_acceptances"("kind", "version", "acceptedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "agreement_acceptances_userId_kind_version_key" ON "agreement_acceptances"("userId", "kind", "version");

-- AddForeignKey
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


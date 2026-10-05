-- CreateEnum
CREATE TYPE "PhoneVerificationPurpose" AS ENUM ('PASSWORD_RESET', 'INVITATION', 'PROFILE_PHONE');

-- CreateTable
CREATE TABLE "phone_verifications" (
    "id" UUID NOT NULL,
    "purpose" "PhoneVerificationPurpose" NOT NULL,
    "phone" TEXT NOT NULL,
    "userId" UUID,
    "sessionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "handleHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "requestedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "phone_verifications_sessionId_key" ON "phone_verifications"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "phone_verifications_handleHash_key" ON "phone_verifications"("handleHash");

-- CreateIndex
CREATE INDEX "phone_verifications_userId_idx" ON "phone_verifications"("userId");

-- CreateIndex
CREATE INDEX "phone_verifications_createdAt_idx" ON "phone_verifications"("createdAt");

-- AddForeignKey
ALTER TABLE "phone_verifications" ADD CONSTRAINT "phone_verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


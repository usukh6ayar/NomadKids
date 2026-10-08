-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('FOOD', 'TEACHING', 'HYGIENE', 'SAFETY', 'FACILITY', 'PAYMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'ACKNOWLEDGED', 'ANSWERED');

-- CreateEnum
CREATE TYPE "FeedbackRelation" AS ENUM ('MOTHER', 'FATHER', 'GUARDIAN');

-- CreateTable
CREATE TABLE "feedback" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "groupId" UUID,
    "category" "FeedbackCategory" NOT NULL,
    "body" TEXT NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "relation" "FeedbackRelation",
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" UUID,
    "replyBody" TEXT,
    "repliedAt" TIMESTAMP(3),
    "repliedById" UUID,
    "authorDeletedAt" TIMESTAMP(3),
    "adminDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_kindergartenId_adminDeletedAt_createdAt_idx" ON "feedback"("kindergartenId", "adminDeletedAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "feedback_authorUserId_authorDeletedAt_createdAt_idx" ON "feedback"("authorUserId", "authorDeletedAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "feedback_childId_idx" ON "feedback"("childId");

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_repliedById_fkey" FOREIGN KEY ("repliedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


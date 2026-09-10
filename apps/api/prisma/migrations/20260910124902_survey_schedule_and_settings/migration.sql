-- AlterTable
ALTER TABLE "surveys" ADD COLUMN     "allowMultipleResponses" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "closingNote" TEXT,
ADD COLUMN     "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "opensAt" TIMESTAMP(3),
ADD COLUMN     "purpose" TEXT,
ADD COLUMN     "shuffleQuestions" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "termId" UUID;

-- CreateIndex
CREATE INDEX "surveys_kindergartenId_termId_idx" ON "surveys"("kindergartenId", "termId");

-- AddForeignKey
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

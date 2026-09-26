-- CreateTable
CREATE TABLE "survey_staff_reads" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "surveyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_staff_reads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "survey_staff_reads_userId_kindergartenId_idx" ON "survey_staff_reads"("userId", "kindergartenId");

-- CreateIndex
CREATE UNIQUE INDEX "survey_staff_reads_surveyId_userId_key" ON "survey_staff_reads"("surveyId", "userId");

-- AddForeignKey
ALTER TABLE "survey_staff_reads" ADD CONSTRAINT "survey_staff_reads_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_staff_reads" ADD CONSTRAINT "survey_staff_reads_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_staff_reads" ADD CONSTRAINT "survey_staff_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

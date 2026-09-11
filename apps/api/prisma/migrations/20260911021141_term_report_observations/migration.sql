-- CreateTable
CREATE TABLE "term_report_observations" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "termReportId" UUID NOT NULL,
    "observationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "term_report_observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "term_report_observations_observationId_idx" ON "term_report_observations"("observationId");

-- CreateIndex
CREATE UNIQUE INDEX "term_report_observations_termReportId_observationId_key" ON "term_report_observations"("termReportId", "observationId");

-- AddForeignKey
ALTER TABLE "term_report_observations" ADD CONSTRAINT "term_report_observations_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term_report_observations" ADD CONSTRAINT "term_report_observations_termReportId_fkey" FOREIGN KEY ("termReportId") REFERENCES "term_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term_report_observations" ADD CONSTRAINT "term_report_observations_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "observations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A child's report identical to a finished one is copied, not re-rendered (2026-10-28).
ALTER TABLE "report_jobs" ADD COLUMN "contentHash" VARCHAR(64);

CREATE INDEX "report_jobs_childId_type_contentHash_idx" ON "report_jobs"("childId", "type", "contentHash");

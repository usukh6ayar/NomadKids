-- Platform-approved tenant mapping and read-only ESIS preview history.
CREATE TYPE "EsisEnvironment" AS ENUM ('TEST', 'PRODUCTION');
CREATE TYPE "EsisSyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

ALTER TABLE "kindergartens"
  ADD COLUMN "esisInstitutionId" TEXT,
  ADD COLUMN "esisEnvironment" "EsisEnvironment",
  ADD COLUMN "esisMappedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "kindergartens_esisInstitutionId_key"
  ON "kindergartens"("esisInstitutionId");

CREATE TABLE "esis_sync_runs" (
  "id" UUID NOT NULL,
  "kindergartenId" UUID NOT NULL,
  "initiatedById" UUID NOT NULL,
  "status" "EsisSyncStatus" NOT NULL DEFAULT 'RUNNING',
  "resources" JSONB NOT NULL,
  "summary" JSONB,
  "errorCode" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "esis_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "esis_sync_runs_kindergartenId_startedAt_idx"
  ON "esis_sync_runs"("kindergartenId", "startedAt");
CREATE INDEX "esis_sync_runs_status_startedAt_idx"
  ON "esis_sync_runs"("status", "startedAt");

-- One in-flight preview per kindergarten. The service also checks this to
-- return a readable 409; the index closes the concurrent-request race.
CREATE UNIQUE INDEX "esis_sync_runs_one_running_per_kindergarten"
  ON "esis_sync_runs"("kindergartenId")
  WHERE "status" = 'RUNNING';

ALTER TABLE "esis_sync_runs"
  ADD CONSTRAINT "esis_sync_runs_kindergartenId_fkey"
  FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "esis_sync_runs"
  ADD CONSTRAINT "esis_sync_runs_initiatedById_fkey"
  FOREIGN KEY ("initiatedById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

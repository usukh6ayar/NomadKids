-- CreateTable
CREATE TABLE "calendar_days" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "isWorkingDay" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "calendar_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_days_kindergartenId_date_idx" ON "calendar_days"("kindergartenId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_days_kindergartenId_date_key" ON "calendar_days"("kindergartenId", "date");

-- AddForeignKey
ALTER TABLE "calendar_days" ADD CONSTRAINT "calendar_days_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_days" ADD CONSTRAINT "calendar_days_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

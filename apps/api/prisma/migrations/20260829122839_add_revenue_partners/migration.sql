-- CreateTable
CREATE TABLE "revenue_partners" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sharePercent" DECIMAL(5,2) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "revenue_partners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "revenue_partners_effectiveFrom_idx" ON "revenue_partners"("effectiveFrom");

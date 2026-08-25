-- CreateTable
CREATE TABLE "menu_days" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "dishes" JSONB NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" UUID,

    CONSTRAINT "menu_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "menu_days_kindergartenId_date_idx" ON "menu_days"("kindergartenId", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "menu_days_kindergartenId_date_key" ON "menu_days"("kindergartenId", "date");

-- AddForeignKey
ALTER TABLE "menu_days" ADD CONSTRAINT "menu_days_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_days" ADD CONSTRAINT "menu_days_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "child_meal_notes" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "child_meal_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "child_meal_notes_childId_date_idx" ON "child_meal_notes"("childId", "date" DESC);

-- CreateIndex
CREATE INDEX "child_meal_notes_kindergartenId_date_idx" ON "child_meal_notes"("kindergartenId", "date" DESC);

-- AddForeignKey
ALTER TABLE "child_meal_notes" ADD CONSTRAINT "child_meal_notes_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_meal_notes" ADD CONSTRAINT "child_meal_notes_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_meal_notes" ADD CONSTRAINT "child_meal_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

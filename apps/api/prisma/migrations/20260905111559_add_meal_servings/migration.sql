-- CreateTable
CREATE TABLE "meal_servings" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" "MealKind" NOT NULL,
    "servedById" UUID,
    "servedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "meal_servings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meal_servings_kindergartenId_date_idx" ON "meal_servings"("kindergartenId", "date");

-- ★ Hand-written as a **partial** unique index, replacing the generated plain
-- one — the same correction `meal_records`, `attendances` and
-- `growth_measurements` all needed (CLAUDE.md §3.3). Postgres treats NULLs as
-- distinct, and `deletedAt` is the only nullable column in the key, so the
-- plain form would let an undone mark block that group's sitting from ever
-- being marked again.
CREATE UNIQUE INDEX "meal_servings_groupId_date_kind_key"
  ON "meal_servings"("groupId", "date", "kind")
  WHERE "deletedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "meal_servings" ADD CONSTRAINT "meal_servings_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_servings" ADD CONSTRAINT "meal_servings_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_servings" ADD CONSTRAINT "meal_servings_servedById_fkey" FOREIGN KEY ("servedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

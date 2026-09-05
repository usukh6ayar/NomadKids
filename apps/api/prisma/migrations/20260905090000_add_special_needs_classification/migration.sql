-- CreateTable
CREATE TABLE "special_needs_categories" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "special_needs_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "special_need_records" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "note" TEXT,
    "documentNo" TEXT,
    "assessedOn" DATE NOT NULL,
    "endedOn" DATE,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "special_need_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "special_needs_categories_kindergartenId_isActive_order_idx" ON "special_needs_categories"("kindergartenId", "isActive", "order");

-- CreateIndex
CREATE UNIQUE INDEX "special_needs_categories_kindergartenId_code_key" ON "special_needs_categories"("kindergartenId", "code");

-- CreateIndex
CREATE INDEX "special_need_records_childId_endedOn_idx" ON "special_need_records"("childId", "endedOn");

-- CreateIndex
CREATE INDEX "special_need_records_kindergartenId_endedOn_idx" ON "special_need_records"("kindergartenId", "endedOn");

-- CreateIndex
CREATE INDEX "special_need_records_categoryId_idx" ON "special_need_records"("categoryId");

-- AddForeignKey
ALTER TABLE "special_needs_categories" ADD CONSTRAINT "special_needs_categories_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "special_need_records" ADD CONSTRAINT "special_need_records_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "special_need_records" ADD CONSTRAINT "special_need_records_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "special_need_records" ADD CONSTRAINT "special_need_records_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "special_needs_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "special_need_records" ADD CONSTRAINT "special_need_records_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Partial unique index for the system category rows.
--
-- Prisma emits UNIQUE("kindergartenId", "code") above, but Postgres treats
-- NULLs as distinct, so that constraint does NOT stop two system rows
-- (kindergartenId IS NULL) sharing a code. Without this, running the seed twice
-- would create a second "Хараа" and every count the state return produces would
-- split one category across two rows.
--
-- Prisma cannot express a partial index, so it is added by hand — the same
-- treatment `development_domains`, `assessment_levels` and `observation_types`
-- already get in the init migration. docs/DATABASE.md §7.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX "special_needs_categories_system_code_key"
  ON "special_needs_categories" ("code")
  WHERE "kindergartenId" IS NULL;

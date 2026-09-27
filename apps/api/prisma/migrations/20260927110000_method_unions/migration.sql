-- CreateTable
CREATE TABLE "method_unions" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "schoolYearId" UUID NOT NULL,
    "leadMembershipId" UUID,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "esisAcademicOrgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "method_unions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "method_union_members" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "unionId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "method_union_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "method_unions_kindergartenId_schoolYearId_idx" ON "method_unions"("kindergartenId", "schoolYearId");

-- CreateIndex
CREATE INDEX "method_union_members_membershipId_idx" ON "method_union_members"("membershipId");

-- ★ Hand-written as a **partial** unique index, replacing the generated plain
-- one (CLAUDE.md §3.3) — the same correction `meal_servings` needed. A removed
-- member is soft-deleted, and the plain form would stop them ever being added
-- back to the same union.
CREATE UNIQUE INDEX "method_union_members_unionId_membershipId_key"
  ON "method_union_members"("unionId", "membershipId")
  WHERE "deletedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "method_unions" ADD CONSTRAINT "method_unions_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "method_unions" ADD CONSTRAINT "method_unions_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "school_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "method_unions" ADD CONSTRAINT "method_unions_leadMembershipId_fkey" FOREIGN KEY ("leadMembershipId") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "method_union_members" ADD CONSTRAINT "method_union_members_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "method_union_members" ADD CONSTRAINT "method_union_members_unionId_fkey" FOREIGN KEY ("unionId") REFERENCES "method_unions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "method_union_members" ADD CONSTRAINT "method_union_members_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


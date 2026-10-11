-- CreateEnum
CREATE TYPE "ClubRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "group_routines" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "plan" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_routines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clubs" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "teacherName" TEXT NOT NULL,
    "room" TEXT,
    "days" INTEGER[],
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "areas" TEXT[],
    "goal" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "clubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_requests" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "clubId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "status" "ClubRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "club_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "group_routines_groupId_key" ON "group_routines"("groupId");

-- CreateIndex
CREATE INDEX "group_routines_kindergartenId_idx" ON "group_routines"("kindergartenId");

-- CreateIndex
CREATE INDEX "clubs_groupId_deletedAt_idx" ON "clubs"("groupId", "deletedAt");

-- CreateIndex
CREATE INDEX "clubs_kindergartenId_idx" ON "clubs"("kindergartenId");

-- CreateIndex
CREATE INDEX "club_requests_clubId_status_idx" ON "club_requests"("clubId", "status");

-- CreateIndex
CREATE INDEX "club_requests_childId_idx" ON "club_requests"("childId");

-- CreateIndex
CREATE INDEX "club_requests_kindergartenId_idx" ON "club_requests"("kindergartenId");

-- AddForeignKey
ALTER TABLE "group_routines" ADD CONSTRAINT "group_routines_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_routines" ADD CONSTRAINT "group_routines_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_requests" ADD CONSTRAINT "club_requests_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_requests" ADD CONSTRAINT "club_requests_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_requests" ADD CONSTRAINT "club_requests_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_requests" ADD CONSTRAINT "club_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One live request per child per club. Partial, so a REJECTED request does
-- not stop the family asking again; Prisma cannot express this, so it is
-- written by hand and pinned by `test/schema.test.ts`.
CREATE UNIQUE INDEX "club_requests_clubId_childId_live_key"
  ON "club_requests"("clubId", "childId")
  WHERE "status" IN ('PENDING', 'APPROVED');

-- A solo teacher's own workspace (#195, the user 2026-10-11). Additive: every
-- existing kindergarten becomes CONTRACTED by the default.

-- CreateEnum
CREATE TYPE "KindergartenKind" AS ENUM ('CONTRACTED', 'SOLO_TEACHER');

-- AlterTable
ALTER TABLE "kindergartens" ADD COLUMN     "kind" "KindergartenKind" NOT NULL DEFAULT 'CONTRACTED',
ADD COLUMN     "soloWorkplaceName" TEXT;

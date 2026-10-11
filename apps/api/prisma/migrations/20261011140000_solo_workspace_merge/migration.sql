-- Where a solo teacher's workspace was merged, and when (D3). Additive.

-- AlterTable
ALTER TABLE "kindergartens" ADD COLUMN     "mergedIntoId" UUID,
ADD COLUMN     "mergedAt" TIMESTAMP(3);

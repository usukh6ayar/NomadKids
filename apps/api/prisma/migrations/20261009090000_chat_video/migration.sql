-- Chat video and the seven-day retention of chat attachments.
-- Additive only: three enum values and one nullable column.
ALTER TYPE "MediaStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "MediaStatus" ADD VALUE 'FAILED';
ALTER TYPE "MediaStatus" ADD VALUE 'EXPIRED';

ALTER TABLE "media_files" ADD COLUMN "durationSec" INTEGER;

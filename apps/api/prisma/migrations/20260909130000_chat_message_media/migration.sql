-- AlterEnum
-- A photograph attached to a chat message. Deliberately NOT a tenant image:
-- it is authorised by room membership, not by membership of the kindergarten.
ALTER TYPE "MediaPurpose" ADD VALUE 'CHAT_MESSAGE';

-- AlterTable
-- Nullable, so every existing row is valid without a backfill.
ALTER TABLE "media_files" ADD COLUMN "chatMessageId" UUID;

-- CreateIndex
-- One message's photographs, in the order they were attached.
CREATE INDEX "media_files_chatMessageId_order_idx" ON "media_files"("chatMessageId", "order");

-- AddForeignKey
-- Cascade: a deleted message takes its photographs' rows with it. The objects
-- themselves are swept separately, as for every other purpose.
ALTER TABLE "media_files"
  ADD CONSTRAINT "media_files_chatMessageId_fkey"
  FOREIGN KEY ("chatMessageId") REFERENCES "chat_messages"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

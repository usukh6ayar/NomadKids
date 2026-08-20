-- CreateTable
CREATE TABLE "notification_reactions" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "notification_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_reactions_notificationId_deletedAt_idx" ON "notification_reactions"("notificationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_reactions_notificationId_userId_key" ON "notification_reactions"("notificationId", "userId");

-- AddForeignKey
ALTER TABLE "notification_reactions" ADD CONSTRAINT "notification_reactions_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_reactions" ADD CONSTRAINT "notification_reactions_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_reactions" ADD CONSTRAINT "notification_reactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- `User.esisPersonId` carried two meanings: the ESIS join key, and "this
-- person registered themselves" (which `listSelfRegistered` selected on).
-- The second was only accidentally correct — self-registration was the sole
-- writer. A director linking an invited account to its ESIS person breaks
-- that accident, so the marker moves to a column of its own.
ALTER TABLE "users" ADD COLUMN "selfRegisteredAt" TIMESTAMP(3);

-- Backfill: today every account carrying an `esisPersonId` got it from
-- self-registration, because that is the only code path that writes it. So
-- the existing rows are exactly the self-registered ones, and `createdAt` is
-- when they registered — the account is created by that same request.
--
-- This is safe to run before the link feature ships and wrong to run after,
-- which is why it lives in the same migration that adds the column.
UPDATE "users"
SET "selfRegisteredAt" = "createdAt"
WHERE "esisPersonId" IS NOT NULL;

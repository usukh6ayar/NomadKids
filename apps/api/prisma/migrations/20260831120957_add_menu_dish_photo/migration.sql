-- A dish photo on the weekly menu. Reviewed by hand per CLAUDE.md §3.3: one
-- new enum value, no DROP, no data loss possible.

-- AlterEnum
ALTER TYPE "MediaPurpose" ADD VALUE 'MENU_DISH';

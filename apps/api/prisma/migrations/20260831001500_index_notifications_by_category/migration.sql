-- CreateIndex
--
-- The board filters published notices by category within one kindergarten, so
-- the filter row's query is `(kindergartenId, category)` on every chip.
--
-- ★ This migration is what is left of `20260830120000_add_notification_category`
-- after the merge. That migration created the enum and the column too, on this
-- branch, at the same time as `20260830093654` created them on main — the same
-- feature written twice, fifteen minutes apart, by two people. Main's version
-- is the one that shipped, so the enum and the column come from there and only
-- the index it did not carry survives here. Two migrations creating one type is
-- a deployment that fails on the second.
--
-- Read by hand per CLAUDE.md §3.3: one CREATE INDEX, no data touched.
CREATE INDEX "notifications_kindergartenId_category_idx"
  ON "notifications"("kindergartenId", "category");

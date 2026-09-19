-- The child's ESIS personId, once something has proven the match.
--
-- ★ Additive only: one nullable column and one unique index. No DROP, no
-- data-losing operation, nothing rewritten (CLAUDE.md §3.3).
--
-- ★★ NULL means "the match is unproven", never "this child is not in ESIS".
-- The ESIS authorization gate refuses a teacher a per-child read it cannot
-- attribute, so the default state is closed rather than open.
--
-- ★★★ The unique index is partial by nature: Postgres does not consider two
-- NULLs equal, so every existing row keeps its NULL without colliding. It is
-- scoped to the kindergarten rather than global because the same child can be
-- enrolled by two kindergartens over time and each holds its own row.
ALTER TABLE "children" ADD COLUMN "esisPersonId" TEXT;

CREATE UNIQUE INDEX "children_kindergartenId_esisPersonId_key"
  ON "children" ("kindergartenId", "esisPersonId");

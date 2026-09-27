-- Ам бүлийн тоо — client, 2026-09-24: the family section of the portfolio is
-- now a household size and a box to write in. Additive: a new nullable column,
-- NULL meaning "not answered yet". Nothing is dropped, and the memory and
-- member-type columns beside it keep whatever families already wrote.
ALTER TABLE "child_age_profiles" ADD COLUMN "familySize" INTEGER;

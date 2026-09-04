-- Гадаад иргэн хүүхэд — Order А/261 counts them; the register could not name them.
--
-- ★ Two columns, both nullable-or-defaulted, so this is safe on a live table.
--
-- `isForeign` defaults to false: every existing row is a Mongolian citizen as
-- far as this system has ever recorded, and a NULL third state would make every
-- reader decide what "unknown citizenship" means.
--
-- `foreignId` is free text and deliberately unvalidated — a passport number or
-- a residence permit has no shape this system may impose. `nationalId` keeps
-- its Cyrillic-plus-eight-digits check, which is exactly what a foreign child
-- cannot satisfy and the reason this flag exists.
ALTER TABLE "children" ADD COLUMN "isForeign" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "children" ADD COLUMN "foreignId" TEXT;

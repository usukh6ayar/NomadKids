/**
 * A starting set of ingredients and technology cards for a kindergarten
 * kitchen — `нэмэлт.md` §12, A/261 Хавсралт 2 §1 #38.
 *
 * ★ **Reference values, not any particular kindergarten's menu.**
 *
 * Every kitchen in the country cooks much the same dozen dishes from much the
 * same dozen ingredients, and every one of them would otherwise type the
 * nutrition table in by hand, a number at a time, with no second reader. That
 * is the work this removes. What it does **not** do is claim to know what a
 * given kindergarten served on a given day.
 *
 * ★★ Recipes are created `DRAFT`, never `APPROVED`, and that is the whole
 * safety argument. `MealsService` resolves a dish's allergens and calories
 * from an **approved** recipe, so nothing here reaches a parent's screen or an
 * allergy cross-check until a cook has opened it, compared it against what
 * their kitchen actually does, and approved it. A cook who disagrees with a
 * quantity changes it; the alternative — an empty screen — is one they fill in
 * from memory anyway, unreviewed.
 *
 * ★★★ The nutrition figures are standard food-composition values per 100 g,
 * the kind printed in every reference table. They are close enough to plan and
 * claim against and they are **not** a laboratory analysis of what a
 * particular supplier delivered. Where a kitchen has its own figures, theirs
 * win — that is what the edit button is for.
 *
 * The daily split those calories get checked against is the ministry's, not
 * ours: өглөөний хоол 20–25%, бага үдийн цай 10–15%, үдийн хоол 35–40%, их
 * үдийн цай 10–15%, оройн хоол 20%. A kindergarten running an eight-hour day
 * covers 80% of the daily requirement, a 24-hour one 100% ±10%. Source:
 * legalinfo.mn lawId=211418 (ЦЭЦЭРЛЭГ, СУРГУУЛИЙН НАСНЫ ХҮҮХДИЙН ХОНОГИЙН
 * ХООЛНЫ ИЛЧЛЭГИЙН ХУВААРИЛАЛТ). The absolute kcal baseline it refers to comes
 * from the Health Minister's 2017 order A/74 and is deliberately **not**
 * hard-coded here — §4's rule that no tariff or norm is baked into code
 * applies to nutrition norms for the same reason it applies to money.
 */

export interface ReferenceIngredient {
  name: string;
  unit: "GRAM" | "MILLILITER" | "PIECE";
  caloriesPer100: string;
  proteinPer100: string;
  fatPer100: string;
  carbsPer100: string;
  allergenTags: string[];
}

/**
 * ★ `allergenTags` use the same vocabulary the menu and `AllergyRecord` use,
 * because `allergenMatches` stems both sides before comparing. A tag spelled
 * differently here from the way a parent writes it on a child's record is an
 * allergy warning that never fires — which is the one failure in this module
 * that reaches a child.
 */
export const REFERENCE_INGREDIENTS: ReferenceIngredient[] = [
  // ── Үр тариа ──
  {
    name: "Улаан буудайн гурил",
    unit: "GRAM",
    caloriesPer100: "364",
    proteinPer100: "10.3",
    fatPer100: "1.0",
    carbsPer100: "76.3",
    allergenTags: ["гурил", "цавуулаг"],
  },
  {
    name: "Цагаан будаа",
    unit: "GRAM",
    caloriesPer100: "344",
    proteinPer100: "6.7",
    fatPer100: "0.7",
    carbsPer100: "78.9",
    allergenTags: [],
  },
  {
    name: "Гоймон",
    unit: "GRAM",
    caloriesPer100: "371",
    proteinPer100: "13.0",
    fatPer100: "1.5",
    carbsPer100: "74.7",
    allergenTags: ["гурил", "цавуулаг"],
  },
  {
    name: "Талх",
    unit: "GRAM",
    caloriesPer100: "265",
    proteinPer100: "9.0",
    fatPer100: "3.2",
    carbsPer100: "49.0",
    allergenTags: ["гурил", "цавуулаг"],
  },

  // ── Мах ──
  {
    name: "Үхрийн мах",
    unit: "GRAM",
    caloriesPer100: "250",
    proteinPer100: "26.0",
    fatPer100: "15.0",
    carbsPer100: "0",
    allergenTags: [],
  },
  {
    name: "Хонины мах",
    unit: "GRAM",
    caloriesPer100: "294",
    proteinPer100: "25.0",
    fatPer100: "21.0",
    carbsPer100: "0",
    allergenTags: [],
  },

  // ── Сүү, өндөг ──
  {
    name: "Сүү (3.2%)",
    unit: "MILLILITER",
    caloriesPer100: "60",
    proteinPer100: "3.2",
    fatPer100: "3.2",
    carbsPer100: "4.7",
    allergenTags: ["сүү"],
  },
  {
    name: "Цөцгийн тос",
    unit: "GRAM",
    caloriesPer100: "717",
    proteinPer100: "0.9",
    fatPer100: "81.0",
    carbsPer100: "0.1",
    allergenTags: ["сүү"],
  },
  {
    name: "Өндөг",
    unit: "PIECE",
    caloriesPer100: "143",
    proteinPer100: "12.6",
    fatPer100: "9.5",
    carbsPer100: "0.7",
    allergenTags: ["өндөг"],
  },

  // ── Хүнсний ногоо ──
  {
    name: "Төмс",
    unit: "GRAM",
    caloriesPer100: "77",
    proteinPer100: "2.0",
    fatPer100: "0.1",
    carbsPer100: "17.5",
    allergenTags: [],
  },
  {
    name: "Лууван",
    unit: "GRAM",
    caloriesPer100: "41",
    proteinPer100: "0.9",
    fatPer100: "0.2",
    carbsPer100: "9.6",
    allergenTags: [],
  },
  {
    name: "Байцаа",
    unit: "GRAM",
    caloriesPer100: "25",
    proteinPer100: "1.3",
    fatPer100: "0.1",
    carbsPer100: "5.8",
    allergenTags: [],
  },
  {
    name: "Сонгино",
    unit: "GRAM",
    caloriesPer100: "40",
    proteinPer100: "1.1",
    fatPer100: "0.1",
    carbsPer100: "9.3",
    allergenTags: [],
  },

  // ── Бусад ──
  {
    name: "Ургамлын тос",
    unit: "MILLILITER",
    caloriesPer100: "884",
    proteinPer100: "0",
    fatPer100: "100",
    carbsPer100: "0",
    allergenTags: [],
  },
  {
    name: "Элсэн чихэр",
    unit: "GRAM",
    caloriesPer100: "387",
    proteinPer100: "0",
    fatPer100: "0",
    carbsPer100: "100",
    allergenTags: [],
  },
  {
    name: "Давс",
    unit: "GRAM",
    caloriesPer100: "0",
    proteinPer100: "0",
    fatPer100: "0",
    carbsPer100: "0",
    allergenTags: [],
  },
];

export interface ReferenceRecipe {
  name: string;
  mealKind: "BREAKFAST" | "MID_MORNING_SNACK" | "LUNCH" | "AFTERNOON_SNACK" | null;
  /** Portions the quantities below produce — the divisor for the per-child figures. */
  yieldPortions: number;
  instructions: string;
  /** Ingredient name → quantity in that ingredient's own unit, for the whole yield. */
  items: { name: string; quantity: string }[];
}

/**
 * ★ Quantities are for the stated `yieldPortions`, not per child.
 *
 * A technology card is what a cook carries to the store room, and one written
 * per child makes them multiply by twenty-eight before they can shop. The
 * per-child figure is the one the system derives (`dividePortions`), because
 * that is arithmetic nobody should do twice.
 */
export const REFERENCE_RECIPES: ReferenceRecipe[] = [
  {
    name: "Гурилтай шөл",
    mealKind: "LUNCH",
    yieldPortions: 20,
    instructions:
      "Махыг жижиглэн хэрчиж чанана. Төмс, лууван, сонгиног нэмж болгоно. Гурилаа зуурч, нимгэн зүсэж шөлөнд хийнэ. Давсаа амтлан 10 минут буцалгана.",
    items: [
      { name: "Үхрийн мах", quantity: "1000" },
      { name: "Улаан буудайн гурил", quantity: "800" },
      { name: "Төмс", quantity: "1200" },
      { name: "Лууван", quantity: "500" },
      { name: "Сонгино", quantity: "300" },
      { name: "Ургамлын тос", quantity: "100" },
      { name: "Давс", quantity: "40" },
    ],
  },
  {
    name: "Цуйван",
    mealKind: "LUNCH",
    yieldPortions: 20,
    instructions:
      "Гурилаа зуурч дэлгэн, нимгэн зүсээд уураар жигнэнэ. Мах, ногоог хуурч, жигнэсэн гоймонтойгоо хольж жигд болгоно.",
    items: [
      { name: "Улаан буудайн гурил", quantity: "1400" },
      { name: "Хонины мах", quantity: "1000" },
      { name: "Байцаа", quantity: "800" },
      { name: "Лууван", quantity: "400" },
      { name: "Сонгино", quantity: "300" },
      { name: "Ургамлын тос", quantity: "150" },
      { name: "Давс", quantity: "40" },
    ],
  },
  {
    name: "Будаатай хуурга",
    mealKind: "LUNCH",
    yieldPortions: 20,
    instructions:
      "Будаагаа угааж чанана. Мах, ногоог тосонд хуурч, чанасан будаатай хольж дэвтээнэ.",
    items: [
      { name: "Цагаан будаа", quantity: "1600" },
      { name: "Үхрийн мах", quantity: "900" },
      { name: "Лууван", quantity: "500" },
      { name: "Сонгино", quantity: "250" },
      { name: "Ургамлын тос", quantity: "150" },
      { name: "Давс", quantity: "35" },
    ],
  },
  {
    name: "Ногоотой шөл",
    mealKind: "LUNCH",
    yieldPortions: 20,
    instructions: "Ногоог жижиглэн хэрчиж, махны шөлөнд хийж болгоно.",
    items: [
      { name: "Үхрийн мах", quantity: "800" },
      { name: "Төмс", quantity: "1500" },
      { name: "Байцаа", quantity: "700" },
      { name: "Лууван", quantity: "500" },
      { name: "Сонгино", quantity: "250" },
      { name: "Давс", quantity: "40" },
    ],
  },
  {
    name: "Сүүтэй цай",
    mealKind: "BREAKFAST",
    yieldPortions: 20,
    instructions: "Ус буцалгаж цай хийнэ. Сүү нэмж дахин буцалгаад давсаа амтална.",
    items: [
      { name: "Сүү (3.2%)", quantity: "2000" },
      { name: "Давс", quantity: "10" },
    ],
  },
  {
    name: "Талх, цөцгийн тос",
    mealKind: "BREAKFAST",
    yieldPortions: 20,
    instructions: "Талхыг зүсэж, цөцгийн тос түрхэнэ.",
    items: [
      { name: "Талх", quantity: "1000" },
      { name: "Цөцгийн тос", quantity: "200" },
    ],
  },
  {
    name: "Сүүтэй будаа",
    mealKind: "BREAKFAST",
    yieldPortions: 20,
    instructions:
      "Будаагаа угааж зөөлөн болтол чанана. Сүү, чихэр нэмж бага галаар 10 минут буцалгана.",
    items: [
      { name: "Цагаан будаа", quantity: "1000" },
      { name: "Сүү (3.2%)", quantity: "3000" },
      { name: "Элсэн чихэр", quantity: "200" },
      { name: "Цөцгийн тос", quantity: "100" },
    ],
  },
  {
    name: "Өндөгтэй будаа",
    mealKind: "AFTERNOON_SNACK",
    yieldPortions: 20,
    instructions: "Чанасан будаан дээр шарсан өндөг нэмж хольно.",
    items: [
      { name: "Цагаан будаа", quantity: "1200" },
      { name: "Өндөг", quantity: "20" },
      { name: "Ургамлын тос", quantity: "100" },
      { name: "Давс", quantity: "20" },
    ],
  },
];

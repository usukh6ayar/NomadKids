import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import RecipesPage from "@/app/(app)/kitchen/recipes/page";
import { dishName, esisUnit } from "@/components/kitchen/esis-recipe-import";

/**
 * «ESIS-ээс татах» on «Технологийн карт нэмэх» — client, 2026-10-06: a ready
 * dish fills the card's name and lines, a material the kitchen lacks is added
 * to its store list, and a line whose unit is not understood is left out and
 * named.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const FLOUR_ID = "66666666-6666-4666-8666-666666666661";
const MEAT_ID = "66666666-6666-4666-8666-666666666662";
const EMPTY = { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 };

const ingredient = (id: string, name: string) => ({
  id,
  name,
  unit: "GRAM",
  category: null,
  caloriesPer100: null,
  proteinPer100: null,
  fatPer100: null,
  carbsPer100: null,
  allergenTags: [],
  note: null,
  minStock: null,
});

const endpoint = (key: string) => ({
  key,
  apiId: 1,
  slug: "API-1",
  method: "GET",
  path: `/svc/api/hub/v2/${key}`,
  name: key,
  domain: "FOOD",
  usage: key,
  previewable: true,
  readable: true,
  params: [],
  fields: [],
  fieldSource: "PORTAL",
  ingestedFieldCount: 0,
  direction: "ESIS_TO_NOMADKIDS",
  targetModel: "Recipe",
  mappings: [],
});

const read = (resource: string, rows: Record<string, string | null>[]) => ({
  resource,
  source: "STORE",
  status: "SUCCEEDED",
  errorCode: null,
  count: rows.length,
  durationMs: null,
  fields: [],
  rows,
  response: { SUCCESS_CODE: 200, RESPONSE_MESSAGE: "", RESULT: rows },
});

function stub(foodKeys = ["foodProducts", "foodProductMaterials", "foodMaterials"]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["COOK"]) },
    {
      path: `/kindergartens/${KG}/esis/catalog`,
      body: { mode: "LIVE", canRead: true, endpoints: foodKeys.map(endpoint) },
    },
    // Longest first: the stubs match by prefix.
    {
      path: `/kindergartens/${KG}/esis/resource?resource=foodProductMaterials`,
      body: read("foodProductMaterials", [
        {
          productId: "900",
          materialId: "1",
          measureCode: "гр",
          grossWeight: "40",
          netWeight: "40",
        },
        {
          productId: "900",
          materialId: "2",
          measureCode: "кг",
          grossWeight: "0.055",
          netWeight: "0.05",
        },
        { productId: "900", materialId: "3", measureCode: "уут", grossWeight: "1", netWeight: "1" },
        {
          productId: "901",
          materialId: "1",
          measureCode: "гр",
          grossWeight: "99",
          netWeight: "99",
        },
      ]),
    },
    {
      path: `/kindergartens/${KG}/esis/resource?resource=foodProducts`,
      body: read("foodProducts", [
        {
          productId: "900",
          productCode: "2001",
          productName: "ГУРИЛТАЙ ХУУРГА",
          productType: "MAIN",
          calories: "1469",
        },
        {
          productId: "901",
          productCode: "2002",
          productName: "Банштай шөл",
          productType: "SOUP",
          calories: "210",
        },
      ]),
    },
    {
      path: `/kindergartens/${KG}/esis/resource?resource=foodMaterials`,
      body: read("foodMaterials", [
        { materialId: "1", materialName: "Гурил", measureCode: "гр" },
        { materialId: "2", materialName: "Үхрийн мах", measureCode: "кг", calories: "218" },
        { materialId: "3", materialName: "Цай", measureCode: "уут" },
      ]),
    },
    {
      path: `/kindergartens/${KG}/ingredients`,
      method: "POST",
      body: ingredient(MEAT_ID, "Үхрийн мах"),
    },
    {
      path: `/kindergartens/${KG}/ingredients?page=1&pageSize=100`,
      body: { ...EMPTY, items: [ingredient(FLOUR_ID, "Гурил")], total: 1, totalPages: 1 },
    },
    { path: `/kindergartens/${KG}/ingredients`, body: EMPTY },
    { path: `/kindergartens/${KG}/recipes`, body: EMPTY },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ESIS-ээс татах on a new technology card", () => {
  it("fills the name and lines, adds a missing material, and names a skipped one", async () => {
    const user = userEvent.setup();
    const api = stub();
    renderWithProviders(<RecipesPage />);

    // Beside «Карт нэмэх», not inside it.
    await user.click(await screen.findByRole("button", { name: "ESIS-ээс татах" }));
    const picker = await screen.findByRole("dialog", { name: "ESIS-ээс хоол татах" });
    await user.type(within(picker).getByLabelText("Хоолны нэрээр хайх"), "хуурга");
    expect(within(picker).queryByText("Банштай шөл")).toBeNull();
    await user.click(within(picker).getByRole("button", { name: /Гурилтай хуурга/ }));

    // «Технологийн карт нэмэх» opens filled: the name as a sentence, MAIN as
    // «Үндсэн хоол», and not the dish's 1469 calories.
    const form = await screen.findByRole("dialog", { name: "Технологийн карт нэмэх" });
    expect(within(form).getByDisplayValue("Гурилтай хуурга")).toBeInTheDocument();
    expect(within(form).getByDisplayValue("Үндсэн хоол")).toBeInTheDocument();
    expect(within(form).queryByText(/1469/)).toBeNull();
    // Гурил is the kitchen's own; Үхрийн мах is new, in grams.
    expect(screen.getByDisplayValue("Гурил")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Үхрийн мах")).toBeInTheDocument();
    expect(screen.getByDisplayValue("40")).toBeInTheDocument();
    expect(screen.getByDisplayValue("55")).toBeInTheDocument();
    expect(screen.queryAllByDisplayValue("Орц сонгоно уу")).toHaveLength(0);
    expect(screen.queryByDisplayValue("Цай")).toBeNull();
    expect(screen.getByText(/«Цай» — хэмжих нэгж/)).toBeInTheDocument();

    const created = api.calls.filter(
      (call) => call.method === "POST" && call.url.endsWith(`/kindergartens/${KG}/ingredients`),
    );
    expect(created).toHaveLength(1);
    expect(created[0]!.body).toMatchObject({
      name: "Үхрийн мах",
      unit: "GRAM",
      caloriesPer100: "218",
    });
    // Nothing is saved as a card until the cook presses «Үүсгэх».
    expect(api.calls.some((call) => call.method === "POST" && call.url.includes("/recipes"))).toBe(
      false,
    );
  });

  it("is not offered to a role that cannot read the food references", async () => {
    stub(["foodProducts"]);
    renderWithProviders(<RecipesPage />);

    expect(await screen.findByRole("button", { name: "Карт нэмэх" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ESIS-ээс татах" })).toBeNull();
  });
});

describe("dishName", () => {
  it("writes a name in capitals as a sentence and keeps a mixed-case one", () => {
    expect(dishName("ГУРИЛТАЙ ШӨЛ")).toBe("Гурилтай шөл");
    expect(dishName("  Вандуй   зутан ")).toBe("Вандуй зутан");
    expect(dishName("1-р гурил (БГ075)")).toBe("1-р гурил (БГ075)");
  });
});

describe("esisUnit", () => {
  it("reads the spellings it knows and refuses the rest", () => {
    expect(esisUnit("гр")).toEqual({ unit: "GRAM", factor: 1 });
    expect(esisUnit(" КГ ")).toEqual({ unit: "GRAM", factor: 1000 });
    expect(esisUnit("л")).toEqual({ unit: "MILLILITER", factor: 1000 });
    expect(esisUnit("ш.")).toEqual({ unit: "PIECE", factor: 1 });
    expect(esisUnit("уут")).toBeNull();
    expect(esisUnit(null)).toBeNull();
  });
});

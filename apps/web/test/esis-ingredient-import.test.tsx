import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import IngredientsPage from "@/app/(app)/kitchen/ingredients/page";
import { esisCategory } from "@/components/kitchen/esis-food";

/**
 * «ESIS-ээс татах» beside «Орц нэмэх» — client, 2026-10-06. The rows are the
 * shape the live store returned that day: «Бүхэл үрийн гурил», gr, 334.
 */

const KG = "33333333-3333-4333-8333-333333333333";

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
  targetModel: "Ingredient",
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

function stub(foodKeys = ["foodMaterials", "foodMaterialGroups"]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["COOK"]) },
    {
      path: `/kindergartens/${KG}/esis/catalog`,
      body: { mode: "LIVE", canRead: true, endpoints: foodKeys.map(endpoint) },
    },
    {
      path: `/kindergartens/${KG}/esis/resource?resource=foodMaterialGroups`,
      body: read("foodMaterialGroups", [{ groupId: "10", groupName: "Үр тариа", groupCode: "ҮТ" }]),
    },
    {
      path: `/kindergartens/${KG}/esis/resource?resource=foodMaterials`,
      body: read("foodMaterials", [
        {
          materialId: "1",
          groupId: "10",
          materialName: "Бүхэл үрийн гурил",
          measureCode: "gr",
          calories: "334",
        },
        {
          materialId: "2",
          groupId: "10",
          materialName: "Будаа",
          measureCode: "gr",
          calories: "350",
        },
        { materialId: "3", groupId: "99", materialName: "Цай", measureCode: "уут", calories: null },
      ]),
    },
    {
      path: `/kindergartens/${KG}/ingredients`,
      method: "POST",
      body: ingredient("66666666-6666-4666-8666-666666666662", "Бүхэл үрийн гурил"),
    },
    {
      path: `/kindergartens/${KG}/ingredients`,
      body: {
        items: [ingredient("66666666-6666-4666-8666-666666666661", "будаа")],
        page: 1,
        pageSize: 100,
        total: 1,
        totalPages: 1,
      },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ESIS-ээс татах on the store list", () => {
  it("adds the ticked materials with unit, calories and category, and never a duplicate", async () => {
    const user = userEvent.setup();
    const api = stub();
    renderWithProviders(<IngredientsPage />);

    // The old «ESIS · NOT ENABLED» badge is gone.
    expect(screen.queryByText(/NOT ENABLED/)).toBeNull();
    await user.click(await screen.findByRole("button", { name: "ESIS-ээс татах" }));
    const dialog = await screen.findByRole("dialog");

    const flour = await within(dialog).findByLabelText(/Бүхэл үрийн гурил/);
    expect(within(dialog).getByText("г · 334 ккал")).toBeInTheDocument();
    // Already in the kitchen, whatever its case.
    expect(within(dialog).getByLabelText(/Будаа/)).toBeDisabled();
    expect(within(dialog).getByText("✓ Танайд байгаа")).toBeInTheDocument();
    // A unit nobody can read is not offered.
    expect(within(dialog).getByLabelText(/Цай/)).toBeDisabled();
    expect(within(dialog).getByText("Нэгж танигдсангүй")).toBeInTheDocument();

    await user.click(flour);
    await user.click(within(dialog).getByRole("button", { name: "Сонгосныг нэмэх (1)" }));

    const posts = api.calls.filter((call) => call.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({
      name: "Бүхэл үрийн гурил",
      unit: "GRAM",
      category: "Тариа, будаа",
      caloriesPer100: "334",
      proteinPer100: null,
      fatPer100: null,
      carbsPer100: null,
    });
    expect(await screen.findByText("1 түүхий эд нэмэгдлээ.")).toBeInTheDocument();
  });

  it("is not offered to a role that cannot read the materials", async () => {
    stub(["foodProducts"]);
    renderWithProviders(<IngredientsPage />);

    expect(await screen.findByRole("button", { name: "Орц нэмэх" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ESIS-ээс татах" })).toBeNull();
  });
});

describe("esisCategory", () => {
  it("files an ESIS group under the kitchen's own categories", () => {
    expect(esisCategory("Үр тариа")).toBe("Тариа, будаа");
    expect(esisCategory("Гурил, гурилан бүтээгдэхүүн")).toBe("Гурилан бүтээгдэхүүн");
    expect(esisCategory("Мах, махан бүтээгдэхүүн")).toBe("Мах, махан бүтээгдэхүүн");
    expect(esisCategory("Халуун ногоо, амтлагч")).toBe("Амтлагч, зуурмаг");
    expect(esisCategory("Хүнсний ногоо")).toBe("Хүнсний ногоо");
    expect(esisCategory("Тодорхойгүй")).toBe("Бусад");
    expect(esisCategory(null)).toBe("Бусад");
  });
});

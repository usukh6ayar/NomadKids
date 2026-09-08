import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setParams, stubApi } from "./support/render";
import AgeProfilePage from "@/app/(app)/children/[childId]/portfolio/growth/age/[age]/page";
import AgeFolderLandingPage from "@/app/(app)/children/[childId]/portfolio/growth/age/page";
import GrowthComparePage from "@/app/(app)/children/[childId]/portfolio/growth/compare/page";

const CHILD_ID = "44444444-4444-4444-8444-444444444444";

const CHILD = {
  id: CHILD_ID,
  lastName: "Ганболд",
  firstName: "Батбаяр",
  sex: "MALE",
  dateOfBirth: "2023-04-12",
  status: "ACTIVE",
  photoMediaFileId: null,
  enrollments: [],
  guardianships: [],
  kindergarten: { id: "33333333-3333-4333-8333-333333333333", name: "Цэцэрлэг" },
  healthNotes: null,
};

function stubAgeProfile({
  profile = { age: 3 },
  patchBody = { age: 3 },
  patchStatus = 200,
}: {
  profile?: Record<string, unknown>;
  patchBody?: Record<string, unknown>;
  patchStatus?: number;
} = {}) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["PARENT"]) },
    {
      path: `/children/${CHILD_ID}/age-profiles/3`,
      method: "PATCH",
      status: patchStatus,
      body: patchBody,
    },
    { path: `/children/${CHILD_ID}/age-profiles`, body: [profile] },
    { path: `/children/${CHILD_ID}`, body: CHILD },
  ]);
}

async function openEditor(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(await screen.findByRole("button", { name: `${title} үйлдэл` }));
  await user.click(screen.getByRole("menuitem", { name: "Засах" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ childId: CHILD_ID, age: "3" });
});

describe("growth age navigation and editing", () => {
  it("renders a compact comparison link above four colourful age links", () => {
    renderWithProviders(<AgeFolderLandingPage />);

    const navigation = screen.getByRole("navigation", { name: "Насны хуудсууд" });
    const links = within(navigation).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "2-5 насны мэдээлэл",
      "2 нас",
      "3 нас",
      "4 нас",
      "5 нас",
    ]);
    expect(within(navigation).getByRole("link", { name: "2-5 насны мэдээлэл" })).toHaveAttribute(
      "href",
      `/children/${CHILD_ID}/portfolio/growth/compare`,
    );
  });

  it("shows the five requested sections and a top-right edit menu for each", async () => {
    stubAgeProfile();
    renderWithProviders(<AgeProfilePage />);

    await screen.findByRole("heading", { name: "Миний 3 нас" });
    expect(screen.queryByRole("navigation", { name: "Насны хуудсууд" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "2-5 насны мэдээлэл" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "3 насны дурсамж 0% бөглөгдсөн" }),
    ).toHaveAttribute("aria-valuenow", "0");

    for (const title of [
      "Миний дуртай бүх зүйлс",
      "Миний цэцэрлэгтээ сурсан зүйлс",
      "Миний гэр бүлээсээ суралцсан зүйлс",
      "Миний зан араншин",
      "Гэр бүл",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `${title} тэмдэглэх` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `${title} үйлдэл` })).toBeInTheDocument();
    }
  });

  it("saves all ten optional favourite fields only to the selected age", async () => {
    const user = userEvent.setup();
    const api = stubAgeProfile({ patchBody: { age: 3, favoriteToy: "Машин" } });
    renderWithProviders(<AgeProfilePage />);

    await openEditor(user, "Миний дуртай бүх зүйлс");
    await user.type(screen.getByRole("textbox", { name: "Тоглоом" }), "Машин");
    await user.type(screen.getByRole("textbox", { name: "Амттан" }), "Ааруул");
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => {
      const call = api.calls.find((item) => item.method === "PATCH");
      expect(call?.url).toBe(`/children/${CHILD_ID}/age-profiles/3`);
      expect(call?.body).toMatchObject({
        favoriteToy: "Машин",
        favoriteTreat: "Ааруул",
        favoriteSong: null,
        favoriteClothes: null,
        favoriteMovie: null,
      });
    });
    expect(await screen.findByText("3 насны мэдээлэл хадгалагдлаа.")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "3 насны дурсамж 20% бөглөгдсөн" }),
    ).toHaveAttribute("aria-valuenow", "20");
  });

  it("saves multi-select traits and the selected-age observation together", async () => {
    const user = userEvent.setup();
    const api = stubAgeProfile({
      patchBody: {
        age: 3,
        characterTraits: ["Хөгжилтэй", "Зоригтой"],
        characterObservation: "Шинэ орчинд хурдан дасдаг.",
      },
    });
    renderWithProviders(<AgeProfilePage />);

    await openEditor(user, "Миний зан араншин");
    await user.click(screen.getByRole("checkbox", { name: "Хөгжилтэй" }));
    await user.click(screen.getByRole("checkbox", { name: "Зоригтой" }));
    await user.type(
      screen.getByRole("textbox", { name: "Миний 3 насны зан араншин" }),
      "Шинэ орчинд хурдан дасдаг.",
    );
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() =>
      expect(api.calls.find((item) => item.method === "PATCH")?.body).toEqual({
        characterTraits: ["Хөгжилтэй", "Зоригтой"],
        characterObservation: "Шинэ орчинд хурдан дасдаг.",
      }),
    );
  });

  it("keeps an unsaved draft visible when saving fails", async () => {
    const user = userEvent.setup();
    stubAgeProfile({
      patchStatus: 500,
      patchBody: {
        type: "about:blank",
        title: "Серверийн алдаа",
        status: 500,
        detail: "Түр хүлээгээд дахин оролдоно уу.",
        requestId: "test",
      },
    });
    renderWithProviders(<AgeProfilePage />);

    await openEditor(user, "Гэр бүл");
    const description = screen.getByRole("textbox", {
      name: "Гэр бүлийн тухай, хамтдаа хийх дуртай зүйлс",
    });
    await user.type(description, "Амралтын өдөр хамт ном уншдаг.");
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    expect(await screen.findAllByText("Түр хүлээгээд дахин оролдоно уу.")).toHaveLength(2);
    expect(description).toHaveValue("Амралтын өдөр хамт ном уншдаг.");
    expect(screen.getByRole("dialog", { name: "Гэр бүл" })).toBeInTheDocument();
  });

  it("compares each question across ages and marks empty cells with a dash", async () => {
    setParams({ childId: CHILD_ID });
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}/age-profiles`,
        body: [
          {
            age: 2,
            favoriteToy: "Шоо",
            characterTraits: ["Тайван"],
            familyMemberTypes: ["Аав, ээж"],
          },
        ],
      },
      { path: `/children/${CHILD_ID}`, body: CHILD },
    ]);

    renderWithProviders(<GrowthComparePage />);

    expect(await screen.findByRole("heading", { name: "2-5 насны мэдээлэл" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Насны хуудсууд" })).not.toBeInTheDocument();
    expect(screen.queryByText("ХӨГЖЛИЙН ХАРЬЦУУЛАЛТ")).not.toBeInTheDocument();
    const table = screen.getByRole("table", {
      name: "2-5 насны мэдээллийн хэвтээ харьцуулалт",
    });
    for (const age of [2, 3, 4, 5]) {
      expect(within(table).getByRole("columnheader", { name: `${age} нас` })).toBeInTheDocument();
    }
    for (const title of [
      "Миний дуртай бүх зүйлс",
      "Миний цэцэрлэгтээ сурсан зүйлс",
      "Миний гэр бүлээсээ суралцсан зүйлс",
      "Миний зан араншин",
      "Гэр бүл",
    ]) {
      expect(within(table).getByRole("rowheader", { name: title })).toBeInTheDocument();
    }

    const favourites = within(table).getByRole("rowheader", { name: "Тоглоом" }).closest("tr")!;
    expect(within(favourites).getByText("Шоо")).toBeInTheDocument();
    expect(within(favourites).getAllByLabelText("Мэдээлэлгүй")).toHaveLength(3);
    expect(within(favourites).getAllByText("—")).toHaveLength(3);
    expect(screen.queryByText(/Мэдээлэл оруулаагүй|Мэдээлэл ор/)).not.toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "Дуу" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "Хоол" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Өндөр - Жингийн ахиц" })).not.toBeInTheDocument();
    expect(screen.queryByText(/ДЭМБ/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Төрсөн өдрийн тэмдэглэл" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Оноо, зэрэглэл гаргахгүй/)).toBeInTheDocument();
  });
});

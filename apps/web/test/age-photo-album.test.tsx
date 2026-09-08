import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGE_ALBUM_CATEGORIES } from "@kinder/contracts";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import { AgePhotoAlbum } from "@/components/child/age-photo-album";

const CHILD_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const PHOTO_ID = "99999999-9999-4999-8999-999999999999";

function stubAlbum(category = "", withPhoto = false, coverMediaFileId: string | null = null) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["PARENT"], USER_ID) },
    {
      path: `/children/${CHILD_ID}/media/album-summary?age=5`,
      body: {
        age: 5,
        coverMediaFileId,
        categories: AGE_ALBUM_CATEGORIES.map((item, index) => ({
          category: item,
          count: index === 0 ? 24 : index,
          thumbnailMediaId: null,
        })),
      },
    },
    {
      path: `/children/${CHILD_ID}/media?category=FIRST_DAY&age=5&pageSize=1`,
      body: { items: [], page: 1, pageSize: 1, total: 0, totalPages: 0 },
    },
    {
      path: `/children/${CHILD_ID}/media?category=GRADUATION&age=5&pageSize=1`,
      body: { items: [], page: 1, pageSize: 1, total: 0, totalPages: 0 },
    },
    {
      path: `/children/${CHILD_ID}/media?attribution=TEACHER&age=5&pageSize=100`,
      body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 },
    },
    {
      path: `/children/${CHILD_ID}/media?pageSize=100&category=${category}&age=5`,
      body: {
        items: withPhoto
          ? [
              {
                id: PHOTO_ID,
                caption: "Манай гэр бүл",
                purpose: "CHILD_PHOTO",
                age: 5,
                category,
              },
            ]
          : [],
        page: 1,
        pageSize: 100,
        total: withPhoto ? 1 : 0,
        totalPages: withPhoto ? 1 : 0,
      },
    },
    {
      path: `/children/${CHILD_ID}/media/age-cover`,
      method: "POST",
      body: {
        age: 5,
        coverMediaFileId: PHOTO_ID,
      },
    },
    {
      path: `/children/${CHILD_ID}/media`,
      method: "POST",
      body: {
        items: [
          {
            id: PHOTO_ID,
            originalName: "гэр-бүл.jpg",
            purpose: "CHILD_PHOTO",
            age: 5,
            category: "FAMILY",
          },
        ],
        failed: [],
      },
    },
    {
      path: `/children/${CHILD_ID}`,
      body: {
        id: CHILD_ID,
        lastName: "Дорж",
        firstName: "Намуун",
        sex: "FEMALE",
        dateOfBirth: "2021-04-12",
        status: "ACTIVE",
        photoMediaFileId: null,
        enrollments: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            status: "ACTIVE",
            startedOn: "2026-09-01",
            group: { id: "66666666-6666-4666-8666-666666666666", name: "Дэлбээ бүлэг" },
            schoolYear: { id: "77777777-7777-4777-8777-777777777777", name: "2026–2027" },
          },
        ],
        guardianships: [
          {
            id: "88888888-8888-4888-8888-888888888888",
            relation: "MOTHER",
            canView: true,
            isPrimary: true,
            guardian: { id: USER_ID, lastName: "Дорж", firstName: "Ээж" },
          },
        ],
        kindergarten: { id: "33333333-3333-4333-8333-333333333333", name: "Цэцэрлэг" },
        healthNotes: null,
      },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("five-year photo library", () => {
  it("renders a compact header and exactly twelve real-count album cards", async () => {
    stubAlbum();
    renderWithProviders(<AgePhotoAlbum childId={CHILD_ID} age={5} />);

    expect(await screen.findByRole("heading", { name: "5 насны зургийн сан" })).toBeInTheDocument();
    expect(screen.queryByText("5 насандаа оруулсан дурсамжууд")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Цээж зургийг энэ насны ковер зураг болгон сонгож болно."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Дорж Намуун")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(
      "Цахим хувийн хавтас/Зургийн цомог/5 нас",
    );
    for (const age of [2, 3, 4, 5]) {
      expect(screen.queryByRole("link", { name: `${age} нас` })).not.toBeInTheDocument();
    }

    const albums = screen.getByRole("heading", { name: "Зургийн төрлүүд" }).parentElement!;
    expect(within(albums).getAllByRole("link")).toHaveLength(12);
    expect(within(albums).getByRole("link", { name: "Цээж зураг, 24 зураг" })).toBeInTheDocument();
    expect(
      within(albums).getByRole("link", { name: "Миний гэр бүл, 1 зураг" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ковер болгох/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Шинэ зураг оруулах/ })).not.toBeInTheDocument();
    expect(within(albums).getAllByRole("button", { name: /ангилалд зураг нэмэх/ })).toHaveLength(
      12,
    );
    const ageLibrary = screen
      .getByRole("heading", { name: "5 насны зургийн сан" })
      .closest("section")!;
    expect(screen.queryByRole("heading", { name: "Онцгой цомгууд" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Цэцэрлэгийн анхны өдөр/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Цэцэрлэгээ төгслөө/ })).not.toBeInTheDocument();
    expect(
      within(ageLibrary).getByRole("link", { name: /Багшийн илгээсэн зураг/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Зургийн цомог 2-5 нас" })).toHaveAttribute(
      "href",
      `/children/${CHILD_ID}/portfolio/gallery/history`,
    );
    expect(screen.queryByText("Хөгжлийн түүх")).not.toBeInTheDocument();
    expect(
      screen.queryByText("2–5 насны онцлох зургуудыг хэвтээгээр харьцуулж харах"),
    ).not.toBeInTheDocument();
  });

  it("opens the selected category as the real filtered gallery", async () => {
    setSearchParams("category=FAMILY");
    const api = stubAlbum("FAMILY");
    renderWithProviders(<AgePhotoAlbum childId={CHILD_ID} age={5} />);

    expect(await screen.findByRole("heading", { name: "Миний гэр бүл" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Миний гэр бүл цомог" })).toBeInTheDocument();
    expect(document.body).toHaveStyle({ overflow: "hidden" });
    expect(screen.queryByText("Зураг алга")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Хүүхдийн бүтээл, тоглож буй мөчийг нэмж эхлээрэй."),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Зургийн тайлбар")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        api.calls.some((call) => call.url.includes("pageSize=100&category=FAMILY&age=5")),
      ).toBe(true),
    );
  });

  it("keeps teacher photos scoped to the selected age", async () => {
    const api = stubAlbum();
    renderWithProviders(<AgePhotoAlbum childId={CHILD_ID} age={5} />);

    await screen.findByRole("heading", { name: "5 насны зургийн сан" });
    expect(
      api.calls.some((call) => call.url.includes("attribution=TEACHER&age=5&pageSize=100")),
    ).toBe(true);
  });

  it("lets any photo in the selected age become its cover from the star", async () => {
    const user = userEvent.setup();
    const api = stubAlbum("FAMILY", true);
    setSearchParams("category=FAMILY");
    renderWithProviders(<AgePhotoAlbum childId={CHILD_ID} age={5} />);

    const inactiveStar = await screen.findByRole("button", {
      name: "5 насны ковер зураг болгох",
    });
    expect(inactiveStar).toHaveAttribute("aria-pressed", "false");
    expect(inactiveStar).toHaveClass("text-muted");
    expect(inactiveStar.querySelector("svg")).toHaveAttribute("fill", "none");

    await user.click(inactiveStar);
    await waitFor(() =>
      expect(
        api.calls.some((call) => call.method === "POST" && call.url.includes("/media/age-cover")),
      ).toBe(true),
    );
    const activeStar = await screen.findByRole("button", { name: "5 насны ковер зураг" });
    expect(activeStar).toHaveAttribute("aria-pressed", "true");
    expect(activeStar).toHaveClass("bg-[#f5b82e]", "text-white");
    expect(activeStar.querySelector("svg")).toHaveAttribute("fill", "currentColor");
  });

  it("renders an already selected cover with an active gold star", async () => {
    stubAlbum("FAMILY", true, PHOTO_ID);
    setSearchParams("category=FAMILY");
    renderWithProviders(<AgePhotoAlbum childId={CHILD_ID} age={5} />);

    const star = await screen.findByRole("button", { name: "5 насны ковер зураг" });
    expect(star).toHaveAttribute("aria-pressed", "true");
    expect(star).toHaveClass("bg-[#f5b82e]", "text-white");
    expect(star.querySelector("svg")).toHaveAttribute("fill", "currentColor");
  });

  it("opens upload from the selected category card instead of a shared top button", async () => {
    const user = userEvent.setup();
    stubAlbum();
    renderWithProviders(<AgePhotoAlbum childId={CHILD_ID} age={5} />);

    await user.click(
      await screen.findByRole("button", { name: "Миний гэр бүл ангилалд зураг нэмэх" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Миний гэр бүл — зураг нэмэх" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Зураг сонгох")).toBeInTheDocument();
    expect(screen.getByLabelText("Зургийн тайлбар")).toBeInTheDocument();
    expect(screen.queryByLabelText("Зургийн төрөл")).not.toBeInTheDocument();
  });

  it("uploads directly with the selected card's age and category", async () => {
    const user = userEvent.setup();
    const api = stubAlbum();
    renderWithProviders(<AgePhotoAlbum childId={CHILD_ID} age={5} />);

    await user.click(
      await screen.findByRole("button", { name: "Миний гэр бүл ангилалд зураг нэмэх" }),
    );
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.type(screen.getByLabelText("Зургийн тайлбар"), "Манай гэр бүл");
    await user.upload(input, new File(["зураг"], "гэр-бүл.jpg", { type: "image/jpeg" }));

    await waitFor(() => expect(api.calls.some((call) => call.method === "POST")).toBe(true));
    const form = api.calls.find((call) => call.method === "POST")!.body as FormData;
    expect(form.get("age")).toBe("5");
    expect(form.get("category")).toBe("FAMILY");
    expect(form.get("caption")).toBe("Манай гэр бүл");
    expect(form.getAll("file")).toHaveLength(1);
  });
});

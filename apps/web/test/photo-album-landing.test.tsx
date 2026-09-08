import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import PhotoAlbumLandingPage from "@/app/(app)/children/[childId]/portfolio/gallery/page";
import PhotoHistoryPage from "@/app/(app)/children/[childId]/portfolio/gallery/history/page";

const CHILD_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "11111111-1111-4111-8111-111111111111";

function stubLanding() {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["PARENT"], USER_ID) },
    {
      path: `/children/${CHILD_ID}/media/album-summary`,
      body: { age: 5, coverMediaFileId: null, categories: [] },
    },
    {
      path: `/children/${CHILD_ID}/media?category=FIRST_DAY&pageSize=1`,
      body: { items: [], page: 1, pageSize: 1, total: 0, totalPages: 0 },
    },
    {
      path: `/children/${CHILD_ID}/media?category=GRADUATION&pageSize=1`,
      body: { items: [], page: 1, pageSize: 1, total: 0, totalPages: 0 },
    },
    {
      path: `/children/${CHILD_ID}/media?pageSize=100&category=FIRST_DAY`,
      body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 },
    },
    {
      path: `/children/${CHILD_ID}/media`,
      method: "POST",
      body: {
        items: [
          {
            id: "99999999-9999-4999-8999-999999999999",
            originalName: "анхны-өдөр.jpg",
            purpose: "CHILD_PHOTO",
            age: null,
            category: "FIRST_DAY",
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
        enrollments: [],
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

function stubHistory() {
  const photos = {
    2: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        caption: "Эхний зураг",
        purpose: "CHILD_PHOTO",
        age: 2,
      },
    ],
    3: [],
    4: [],
    5: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        caption: "Төгсөхийн өмнө",
        purpose: "CHILD_PHOTO",
        age: 5,
      },
    ],
  } as const;

  return stubApi(
    [2, 3, 4, 5].map((age) => ({
      path: `/children/${CHILD_ID}/media?age=${age}&pageSize=100&page=1`,
      body: {
        items: photos[age as keyof typeof photos],
        page: 1,
        pageSize: 100,
        total: photos[age as keyof typeof photos].length,
        totalPages: photos[age as keyof typeof photos].length ? 1 : 0,
      },
    })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ childId: CHILD_ID });
  setSearchParams("");
});

describe("photo album landing page", () => {
  it("keeps the four age choices and renders the two child-wide albums below them", async () => {
    const api = stubLanding();
    renderWithProviders(<PhotoAlbumLandingPage />);

    const heading = await screen.findByRole("heading", { name: "Зургийн цомог" });
    expect(screen.getByRole("link", { name: "Зургийн цомог 2-5 нас" })).toHaveAttribute(
      "href",
      `/children/${CHILD_ID}/portfolio/gallery/history`,
    );
    const ageGrid = heading.parentElement!.nextElementSibling!;
    for (const age of [2, 3, 4, 5]) {
      expect(
        within(ageGrid as HTMLElement).getByRole("link", { name: new RegExp(`${age} нас`) }),
      ).toHaveAttribute("href", `/children/${CHILD_ID}/portfolio/gallery/${age}`);
    }

    const specialAlbums = screen.getByRole("heading", { name: "Онцгой цомгууд" }).parentElement!;
    expect(within(specialAlbums).getAllByRole("link")).toHaveLength(2);
    expect(
      within(specialAlbums).getByRole("link", { name: /Цэцэрлэгийн анхны өдөр/ }),
    ).toBeInTheDocument();
    expect(
      within(specialAlbums).getByRole("link", { name: /Цэцэрлэгээ төгслөө/ }),
    ).toBeInTheDocument();
    expect(ageGrid.compareDocumentPosition(specialAlbums)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    await waitFor(() =>
      expect(
        api.calls.some(
          (call) =>
            call.url.includes("category=FIRST_DAY&pageSize=1") && !call.url.includes("age="),
        ),
      ).toBe(true),
    );
  });

  it("uploads to a special album without assigning an age", async () => {
    const user = userEvent.setup();
    const api = stubLanding();
    renderWithProviders(<PhotoAlbumLandingPage />);

    await user.click(
      await screen.findByRole("button", { name: "Цэцэрлэгийн анхны өдөр цомогт зураг нэмэх" }),
    );
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, new File(["зураг"], "анхны-өдөр.jpg", { type: "image/jpeg" }));

    await waitFor(() => expect(api.calls.some((call) => call.method === "POST")).toBe(true));
    const form = api.calls.find((call) => call.method === "POST")!.body as FormData;
    expect(form.get("category")).toBe("FIRST_DAY");
    expect(form.get("age")).toBeNull();
  });

  it("opens the child-wide album without an age filter", async () => {
    const api = stubLanding();
    setSearchParams("special=FIRST_DAY");
    renderWithProviders(<PhotoAlbumLandingPage />);

    expect(
      await screen.findByRole("dialog", { name: "Цэцэрлэгийн анхны өдөр цомог" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        api.calls.some(
          (call) =>
            call.url.includes("pageSize=100&category=FIRST_DAY") && !call.url.includes("age="),
        ),
      ).toBe(true),
    );
  });

  it("opens every 2–5 age photo in a two-column mobile grid", async () => {
    const user = userEvent.setup();
    stubHistory();
    renderWithProviders(<PhotoHistoryPage />);

    expect(
      await screen.findByRole("heading", { name: "Зургийн цомог 2-5 нас" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2-оос 5 насны бүх дурсамж · 2 зураг")).toBeInTheDocument();

    const photoButtons = screen.getAllByRole("button", { name: /томоор харах/ });
    expect(photoButtons).toHaveLength(2);
    expect(photoButtons[0]?.closest("ul")).toHaveClass("grid-cols-2", "gap-3");

    await user.click(screen.getByRole("button", { name: "2 нас — Эхний зураг томоор харах" }));
    expect(screen.getByRole("dialog", { name: "Эхний зураг" })).toBeInTheDocument();
  });
});

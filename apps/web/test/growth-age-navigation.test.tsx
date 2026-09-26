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
  sex = "MALE",
}: {
  profile?: Record<string, unknown>;
  patchBody?: Record<string, unknown>;
  patchStatus?: number;
  sex?: "MALE" | "FEMALE";
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
    { path: `/children/${CHILD_ID}`, body: { ...CHILD, sex } },
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
  /*
    ★ REDESIGN 2026-09-12, to the client's own drawing: four *tinted* cards,
    the drawn numeral, "N нас" under it, and a round arrow at the foot.

    They were four identical white cards each labelled "Нас", so the drawing
    was the only thing telling them apart and the word under it said nothing.
    What this case holds is the part a refactor can quietly lose: the label is
    the age, each card carries its own numeral, and the tint is a gradient of
    that age's accent rather than white.
  */
  it("★ renders a comparison link above four tinted, numbered age cards", () => {
    renderWithProviders(<AgeFolderLandingPage />);

    const navigation = screen.getByRole("navigation", { name: "Насны хуудсууд" });
    const links = within(navigation).getAllByRole("link");
    expect(links).toHaveLength(5);
    expect(within(navigation).getByRole("link", { name: "2-5 насны мэдээлэл" })).toHaveAttribute(
      "href",
      `/children/${CHILD_ID}/portfolio/growth/compare`,
    );

    /* The wash a card is painted in, by the accent each age was drawn in. */
    const WASH: Record<number, string> = { 2: "sky", 3: "mint", 4: "sun", 5: "pink" };

    for (const age of [2, 3, 4, 5] as const) {
      const link = within(navigation).getByRole("link", { name: `${age} нас` });
      expect(link).not.toHaveClass("bg-white");
      expect(link.getAttribute("href")).toBe(`/children/${CHILD_ID}/portfolio/growth/age/${age}`);
      expect(link.querySelector("img")?.getAttribute("src")).toContain(`icon-age-${age}-3d.png`);

      // The label is the age itself, not the word "Нас" on all four.
      expect(within(link).getByText(`${age} нас`)).toBeInTheDocument();

      // The tint follows the numeral's own colour — a card whose wash
      // disagreed with the number sitting on it would read as a mistake.
      expect(link.innerHTML).toContain(`from-${WASH[age]}/55`);
    }

    expect(navigation.querySelector("ul")).toHaveClass("grid-cols-2");
    expect(navigation.querySelector("ul")?.className).not.toContain("sm:grid-cols-4");
  });

  it("shows the five requested sections and a top-right edit menu for each", async () => {
    stubAgeProfile();
    renderWithProviders(<AgeProfilePage />);

    // One heading, not a title over a subtitle repeating it — the page's own
    // comment says why. `name` is an exact match, so this also asserts the
    // "3 насны дурсамж" line is gone rather than merely reworded.
    await screen.findByRole("heading", { name: "Миний 3 нас дурсамжууд" });
    expect(screen.queryByRole("navigation", { name: "Насны хуудсууд" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "2-5 насны мэдээлэл" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "3 насны дурсамж 0% бөглөгдсөн" }),
    ).toHaveAttribute("aria-valuenow", "0");

    expect(screen.getByTestId("age-profile-sections")).toHaveClass("grid-cols-2");
    const expectedArt = [
      ["ageFavorite", "icon-age-favorite-3d.png"],
      ["ageKindergartenLearning", "icon-age-kindergarten-learning-3d.png"],
      ["ageFamilyLearning", "icon-age-family-learning-3d.png"],
      ["ageCharacter", "icon-age-character-3d.png"],
      ["ageFamily", "icon-age-family-3d.png"],
    ] as const;
    for (const [name, asset] of expectedArt) {
      expect(
        screen.getByTestId(`age-profile-card-${name}`).querySelector("img")?.getAttribute("src"),
      ).toContain(asset);
    }
    expect(screen.getByTestId("age-profile-card-ageFamily").parentElement).toHaveClass(
      "col-span-2",
    );
    expect(
      screen.getByTestId("age-progress-character").querySelector("img")?.getAttribute("src"),
    ).toContain("icon-age-pointing-boy-3d.png");

    for (const title of [
      "Миний дуртай бүх зүйлс",
      "Миний цэцэрлэгтээ сурсан зүйлс",
      "Миний гэр бүлээсээ суралцсан зүйлс",
      "Миний зан араншин",
      "Миний гэр бүл",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `${title} тэмдэглэх` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `${title} үйлдэл` })).toBeInTheDocument();
    }
  });

  it("selects the pointing character from the child's stored sex", async () => {
    stubAgeProfile({ sex: "FEMALE" });
    renderWithProviders(<AgeProfilePage />);

    expect(
      (await screen.findByTestId("age-progress-character"))
        .querySelector("img")
        ?.getAttribute("src"),
    ).toContain("icon-age-pointing-girl-3d.png");
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

    /*
      ★ Asked of "Миний зан араншин", not "Миний гэр бүл".

      What is under test is `FormDialog` + `useAgeProfileSave` keeping a draft
      and staying open when the PATCH fails — shared behaviour, and every one of
      the five cards exercises it. It used to be asked of the family card's
      "Хамтдаа хийх дуртай зүйлс" box, which the client had removed on
      2026-09-10 — so the assertion moved to a card that still has a free-text
      field rather than being weakened to fit. The family dialog's own version
      of this, where the draft is a whole memory, is in
      `family-memories.test.tsx`.
    */
    await openEditor(user, "Миний зан араншин");
    const observation = screen.getByRole("textbox", {
      name: "Миний 3 насны зан араншин",
    });
    await user.type(observation, "Шинэ орчинд хурдан дасдаг.");
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    expect(await screen.findAllByText("Түр хүлээгээд дахин оролдоно уу.")).toHaveLength(2);
    expect(observation).toHaveValue("Шинэ орчинд хурдан дасдаг.");
    expect(screen.getByRole("dialog", { name: "Миний зан араншин" })).toBeInTheDocument();
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
      "Миний гэр бүл",
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

/** The two learning sections — client-supplied content and entry shape, 2026-09-24. */
describe("the skills editors", () => {
  it("adds any number of kindergarten skills under each of the three domains", async () => {
    const user = userEvent.setup();
    const api = stubAgeProfile();
    renderWithProviders(<AgeProfilePage />);

    await openEditor(user, "Миний цэцэрлэгтээ сурсан зүйлс");
    const dialog = await screen.findByRole("dialog", {
      name: "Миний цэцэрлэгтээ сурсан зүйлс",
    });
    const cognition = within(dialog).getByRole("group", { name: "Танин мэдэхүй" });
    const social = within(dialog).getByRole("group", { name: "Нийгэмшихүй" });
    expect(within(dialog).getByRole("group", { name: "Бие бялдар" })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Өөр сурсан зүйл нэмэх")).not.toBeInTheDocument();

    await user.click(within(cognition).getByRole("button", { name: "Нэмэх" }));
    await user.type(
      within(cognition).getByRole("textbox", { name: "Танин мэдэхүй 1" }),
      "Тоолж сурсан",
    );
    await user.click(within(cognition).getByRole("button", { name: "Нэмэх" }));
    await user.type(
      within(cognition).getByRole("textbox", { name: "Танин мэдэхүй 2" }),
      "Өнгө ялгасан",
    );
    await user.click(within(social).getByRole("button", { name: "Нэмэх" }));
    await user.type(
      within(social).getByRole("textbox", { name: "Нийгэмшихүй 1" }),
      "Ээлжээ хүлээсэн",
    );

    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    const patch = await waitFor(() => {
      const call = api.calls.find((c) => c.method === "PATCH");
      expect(call).toBeDefined();
      return call!;
    });
    expect(patch.body).toEqual({
      kindergartenSkills: [
        "Танин мэдэхүй: Тоолж сурсан",
        "Танин мэдэхүй: Өнгө ялгасан",
        "Нийгэмшихүй: Ээлжээ хүлээсэн",
      ],
    });
  });

  it("shows the supplied family questions under the three domains", async () => {
    const user = userEvent.setup();
    const api = stubAgeProfile();
    renderWithProviders(<AgeProfilePage />);

    await openEditor(user, "Миний гэр бүлээсээ суралцсан зүйлс");
    const dialog = await screen.findByRole("dialog", {
      name: "Миний гэр бүлээсээ суралцсан зүйлс",
    });
    for (const domain of ["Танин мэдэхүй", "Нийгэмшихүй", "Бие бялдар"]) {
      expect(within(dialog).getByRole("group", { name: domain })).toBeInTheDocument();
    }
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(9);
    expect(
      within(dialog).getByRole("checkbox", {
        name: "Энгийн 2–3 алхамтай зааврыг ойлгож, дарааллын дагуу биелүүлэхийг оролддог уу?",
      }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Өөр сурсан зүйл нэмэх")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));
    const patch = await waitFor(() => {
      const call = api.calls.find((call) => call.method === "PATCH");
      expect(call).toBeDefined();
      return call!;
    });
    expect(Object.keys(patch.body as Record<string, unknown>).sort()).toEqual(
      ["familyLearningOther", "familyLearningSkills"].sort(),
    );
  });
});

/** "Миний дуртай бүх зүйлс" — client, 2026-09-24: two answers to a row. */
describe("the favourites editor", () => {
  it("lays its fields out two to a row", async () => {
    const user = userEvent.setup();
    stubAgeProfile();
    renderWithProviders(<AgeProfilePage />);

    await openEditor(user, "Миний дуртай бүх зүйлс");
    const dialog = await screen.findByRole("dialog", { name: "Миний дуртай бүх зүйлс" });
    const toy = within(dialog).getByRole("textbox", { name: "Тоглоом" });

    expect(toy.closest("div.grid")).toHaveClass("grid-cols-2");
  });
});

/** "Миний зан араншин" — client, 2026-09-24: cute emoji, two columns. */
describe("the character observations picker", () => {
  it("gives each observation a face and lays them out two to a row", async () => {
    const user = userEvent.setup();
    stubAgeProfile({ profile: { age: 3, characterTraits: ["Тайван"] } });
    renderWithProviders(<AgeProfilePage />);

    await openEditor(user, "Миний зан араншин");
    const dialog = await screen.findByRole("dialog", { name: "Миний зан араншин" });

    // The emoji is decoration: the checkbox is still named by the word alone,
    // which is what gets stored.
    const happy = within(dialog).getByRole("checkbox", { name: "Хөгжилтэй" });
    expect(happy).not.toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Тайван" })).toBeChecked();
    expect(within(dialog).getByText("😄")).toHaveAttribute("aria-hidden", "true");
    // Client, 2026-09-24: the heading over them and the two notes are gone,
    // while the group keeps its name for a screen reader.
    expect(within(dialog).queryByText("Зан араншингийн ажиглалт")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/хэд хэдийг сонгож болно/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/тогтмол шошго болгон ашиглахгүй/)).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("group", { name: "Зан араншингийн ажиглалт" }),
    ).toBeInTheDocument();

    expect(happy.closest("label")!.parentElement).toHaveClass("grid-cols-2");
  });
});

/**
 * "Миний гэр бүл" — client, 2026-09-24: the memory builder went, and the
 * section is a household size and a box to write in.
 */
describe("the family section", () => {
  it("asks for the household size and a description, and nothing else", async () => {
    const user = userEvent.setup();
    const api = stubAgeProfile({
      profile: { age: 3, familySize: 4, familyDescription: "Аав, ээж, ах бид дөрвүүлээ." },
    });
    renderWithProviders(<AgeProfilePage />);

    // Nothing of the memory builder is left on the page.
    await screen.findByRole("heading", { name: "Миний 3 нас дурсамжууд" });
    expect(screen.queryByText("Гэр бүлийн дурсамж")).not.toBeInTheDocument();

    await openEditor(user, "Миний гэр бүл");

    const dialog = await screen.findByRole("dialog", { name: "Миний гэр бүл" });
    expect(within(dialog).getByLabelText(/Ам бүлийн тоо/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Миний гэр бүл/)).toHaveValue(
      "Аав, ээж, ах бид дөрвүүлээ.",
    );
    // Everything the memory builder used to put in this dialog is gone.
    for (const gone of [
      "Хэнтэй хамт байсан бэ?",
      "Дурсамжийн нэр",
      "Дурсамж нэмэх",
      "Урьдчилан харах",
      "Зураг нэмэх",
    ]) {
      expect(within(dialog).queryByText(gone)).not.toBeInTheDocument();
    }

    await user.clear(within(dialog).getByLabelText(/Миний гэр бүл/));
    await user.type(within(dialog).getByLabelText(/Миний гэр бүл/), "Бид таван хүнтэй.");
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    const patch = await waitFor(() => {
      const call = api.calls.find((c) => c.method === "PATCH");
      expect(call).toBeDefined();
      return call!;
    });
    // `familyMemories` and `familyMemberTypes` are absent, so what a family
    // stored before today survives the save.
    expect(patch.body).toEqual({ familySize: 4, familyDescription: "Бид таван хүнтэй." });
  });
});

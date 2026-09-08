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
import AboutMePage from "@/app/(app)/children/[childId]/portfolio/about-me/page";

const CHILD_ID = "44444444-4444-4444-8444-444444444444";

/** Two years old today, whatever "today" is when the suite runs. */
function bornYearsAgo(years: number): string {
  const dob = new Date();
  dob.setFullYear(dob.getFullYear() - years);
  dob.setDate(dob.getDate() - 1);
  return dob.toISOString().slice(0, 10);
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ childId: CHILD_ID });
  setSearchParams("");
});

describe("RFP §4.1 completeness", () => {
  it("does not render the legacy measurement chips on the about-me landing", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/children/${CHILD_ID}/about-me`,
        body: { exists: true, heightCm: "98.5", weightKg: "15.2", recordedOn: "2026-03-14" },
      },
      {
        path: `/children/${CHILD_ID}/birthday-notes`,
        body: {
          dateOfBirth: "2021-04-12",
          ageYears: 5,
          zodiac: { code: "aquarius", name: "Хумх" },
          yearAnimal: { code: "rat", name: "Хулгана", beforeLunarNewYear: false },
          notes: [],
        },
      },
      {
        path: `/children/${CHILD_ID}`,
        body: {
          id: CHILD_ID,
          lastName: "Ганболд",
          firstName: "Батбаяр",
          sex: "MALE",
          dateOfBirth: bornYearsAgo(3),
          status: "ACTIVE",
          photoMediaFileId: null,
          enrollments: [],
          guardianships: [],
          kindergarten: { id: "33333333-3333-4333-8333-333333333333", name: "Цэцэрлэг" },
          healthNotes: null,
        },
      },
    ]);

    renderWithProviders(<AboutMePage />);

    await screen.findByRole("heading", { name: "Миний тухай" });
    expect(screen.queryByText("98.5 см")).not.toBeInTheDocument();
    expect(screen.queryByText("15.2 кг")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.03.14")).not.toBeInTheDocument();
  });

  it("opens a preview-free editor with exactly the requested fields in order", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}/about-me`,
        method: "PATCH",
        body: { exists: true, nameMeaning: "Нандин утгатай" },
      },
      {
        path: `/children/${CHILD_ID}/about-me`,
        body: {
          exists: true,
          clanName: "Боржигон",
          nameMeaning: "Нандин утгатай",
          nickname: "Батаа",
          birthplace: "Улаанбаатар",
          bloodType: "O+",
          eyeColor: "Бор",
          yearAnimalCode: "ox",
          zodiacCode: "taurus",
          introduction: "Энэ талбар зөвхөн харах горимд үлдэнэ",
          dream: "Нисгэгч",
          heightCm: "110",
          weightKg: "18",
          recordedOn: "2026-03-14",
        },
      },
      {
        path: `/children/${CHILD_ID}/birthday-notes`,
        body: {
          dateOfBirth: "2021-04-12",
          ageYears: 5,
          zodiac: { code: "aquarius", name: "Хумх" },
          yearAnimal: { code: "rat", name: "Хулгана", beforeLunarNewYear: false },
          notes: [],
        },
      },
      {
        path: `/children/${CHILD_ID}`,
        body: {
          id: CHILD_ID,
          lastName: "Ганболд",
          firstName: "Батбаяр",
          sex: "MALE",
          dateOfBirth: "2021-04-12",
          status: "ACTIVE",
          photoMediaFileId: null,
          enrollments: [],
          guardianships: [],
          kindergarten: { id: "33333333-3333-4333-8333-333333333333", name: "Цэцэрлэг" },
          healthNotes: null,
        },
      },
    ]);

    renderWithProviders(<AboutMePage />);
    await user.click(await screen.findByRole("button", { name: "Мэдээлэл засах" }));

    const form = screen.getByRole("form", { name: "Миний тухай мэдээлэл засах" });
    expect(screen.queryByText("Батбаяр")).not.toBeInTheDocument();
    expect(screen.queryByText("2021.04.12")).not.toBeInTheDocument();

    const orderedFields = [
      within(form).getByRole("textbox", { name: "Ургийн овог" }),
      within(form).getByRole("textbox", { name: "Овог" }),
      within(form).getByRole("textbox", { name: "Нэр" }),
      within(form).getByLabelText("Төрсөн өдөр"),
      within(form).getByRole("combobox", { name: "Хүйс" }),
      within(form).getByRole("textbox", { name: "Нэрний утга" }),
      within(form).getByRole("textbox", { name: "Өхөөрддөг нэр" }),
      within(form).getByRole("textbox", { name: "Төрсөн газар" }),
      within(form).getByRole("textbox", { name: "Цусны бүлэг" }),
      within(form).getByRole("radiogroup", { name: "Нүдний өнгө" }),
      within(form).getByLabelText("Арван хоёр жил"),
      within(form).getByLabelText("Одны орд"),
    ];

    for (let index = 0; index < orderedFields.length - 1; index += 1) {
      expect(
        orderedFields[index]!.compareDocumentPosition(orderedFields[index + 1]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }

    for (const removedLabel of [
      "Танилцуулга",
      "Миний мөрөөдөл",
      "Миний онцлог",
      "Сонирхолтой үг",
      "Өндөр (см)",
      "Жин (кг)",
      "Хэмжсэн огноо",
    ]) {
      expect(within(form).queryByLabelText(removedLabel)).not.toBeInTheDocument();
    }

    const firstName = within(form).getByRole("textbox", { name: "Нэр" });
    await user.clear(firstName);
    await user.type(firstName, "Шинэ нэр");
    await user.click(within(form).getByRole("button", { name: "Хадгалах" }));
    await waitFor(() => {
      const patchCall = api.calls.find(
        (call) => call.method === "PATCH" && call.url.includes(`/children/${CHILD_ID}/about-me`),
      );
      expect(Object.keys(patchCall?.body as object).sort()).toEqual(
        [
          "birthplace",
          "bloodType",
          "clanName",
          "dateOfBirth",
          "eyeColor",
          "firstName",
          "lastName",
          "nameMeaning",
          "nickname",
          "sex",
          "yearAnimalCode",
          "zodiacCode",
        ].sort(),
      );
    });

    // The editor closes onto the mutation result and the locally recomputed
    // birth facts — no page reload and no refetch are required.
    expect(await screen.findByText("Шинэ нэр")).toBeInTheDocument();
    expect(screen.getByText("2021.04.12")).toBeInTheDocument();
    expect(screen.getByText("Хүү")).toBeInTheDocument();
    expect(screen.getByText("5 нас")).toBeInTheDocument();
    expect(screen.getByText("Үхэр")).toBeInTheDocument();
    expect(screen.getByText("Үхэр жил")).toBeInTheDocument();
    const details = screen.getByRole("list", { name: "Миний тухай мэдээллүүд" });
    expect(details).toHaveClass("grid-cols-2");
    expect(within(details).getByText("Боржигон")).toBeInTheDocument();
    expect(within(details).getByText("Нандин утгатай")).toBeInTheDocument();
    expect(within(details).getByText("Нисгэгч")).toBeInTheDocument();
    expect(screen.queryByText("110 см")).not.toBeInTheDocument();
    expect(screen.queryByText("18 кг")).not.toBeInTheDocument();
    expect(screen.queryByText("2026.03.14")).not.toBeInTheDocument();
    expect(screen.getByText("Энэ талбар зөвхөн харах горимд үлдэнэ")).toBeInTheDocument();
  });
});

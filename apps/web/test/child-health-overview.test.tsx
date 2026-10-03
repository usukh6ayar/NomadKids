import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChildHealth } from "@/components/child/child-health";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";

const CHILD = "11111111-1111-4111-8111-111111111111";

function stubHealth() {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    {
      path: `/children/${CHILD}/health`,
      body: {
        allergies: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            kind: "FOOD",
            severity: "MODERATE",
            allergen: "Сүү, самар",
            reaction: null,
            treatment: null,
            notedOn: "2026-03-10",
            endedOn: null,
          },
        ],
        medications: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            medicineName: "Парацетамол",
            dosage: "5 мл",
            timesOfDay: ["12:00"],
            instructions: null,
            startsOn: "2026-09-06",
            endsOn: "2026-09-10",
            authorisedBy: null,
            isActive: true,
          },
        ],
        vaccinations: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            vaccineName: "Улаанбурхан (MMR)",
            administeredOn: "2026-07-06",
            doseLabel: "2-р тун",
            provider: null,
            note: null,
            recordedBy: null,
          },
        ],
        specialNeeds: [],
        healthNotes: "Самартай хоол өгөхгүй.",
      },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("эрүүл мэндийн тойм", () => {
  /*
    ★ By kind, not by school year — 2026-10-01. What to watch for first,
    then Харшил, Тусгай хэрэгцээ, Вакцин and Анхаарах заавар, each with its
    own add. No medication consent, no "Архаг өвчин" row with nothing behind
    it, no folds per year.
  */
  it("leads with what to watch for and lists each kind once", async () => {
    stubHealth();
    renderWithProviders(
      <ChildHealth
        childId={CHILD}
        isStaff
        dateOfBirth="2021-03-12"
        currentSchoolYear="2026–2027"
      />,
    );

    const alert = await screen.findByRole("region", { name: "Анхаарах" });
    expect(within(alert).getByText(/Сүү, самар/)).toBeInTheDocument();

    const allergies = screen.getByRole("region", { name: /Харшил/ });
    // A table like the other tabs: the allergen in its own cell.
    expect(within(allergies).getByRole("cell", { name: "Сүү, самар" })).toBeInTheDocument();
    // ★ 2026-10-01: no severity, no Төлөв — the columns the add form asks for.
    expect(
      within(allergies)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent)
        .filter((text) => text !== "Үйлдэл"),
    ).toEqual(["Харшил", "Төрөл", "Шинж тэмдэг", "Авах арга хэмжээ"]);
    const shots = screen.getByRole("region", { name: /Вакцин/ });
    expect(within(shots).getByText("Улаанбурхан (MMR)")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Анхаарах заавар" })).toHaveTextContent(
      "Самартай хоол өгөхгүй.",
    );

    expect(screen.queryByText("Парацетамол")).toBeNull();
    expect(screen.queryByText("Архаг өвчин")).toBeNull();
    expect(screen.queryByRole("heading", { name: /хичээлийн жил/ })).toBeNull();
  });

  it("puts each add beside its own kind, in one press", async () => {
    stubHealth();
    renderWithProviders(<ChildHealth childId={CHILD} isStaff />);

    await screen.findByRole("region", { name: /Харшил/ });
    expect(screen.queryByRole("button", { name: "Мэдээлэл нэмэх" })).toBeNull();
    expect(screen.getByRole("button", { name: "Харшил нэмэх" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Тусгай хэрэгцээ нэмэх" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Вакцин нэмэх" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Эмийн зөвшөөрөл нэмэх" })).toBeNull();
  });

  /** The add dialogs ask in the table's own order and words (2026-10-01). */
  it("asks for the same fields, in the same order, as the table shows", async () => {
    const user = userEvent.setup();
    stubHealth();
    renderWithProviders(<ChildHealth childId={CHILD} isStaff />);

    await user.click(await screen.findByRole("button", { name: "Вакцин нэмэх" }));
    const dialog = await screen.findByRole("dialog", { name: "Вакцин нэмэх" });
    const labels = within(dialog)
      .getAllByText(/^(Вакцин|Тун|Хийлгэсэн огноо)/, { selector: "label" })
      .map((label) => label.textContent?.replace(/\s*\*$/, ""));
    expect(labels).toEqual(["Вакцин", "Тун", "Хийлгэсэн огноо"]);
  });

  it("offers a guardian nothing to add", async () => {
    stubHealth();
    renderWithProviders(<ChildHealth childId={CHILD} isStaff={false} />);

    await screen.findByRole("region", { name: /Харшил/ });
    expect(screen.queryByRole("button", { name: /нэмэх/ })).toBeNull();
  });
});

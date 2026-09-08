import { screen } from "@testing-library/react";
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
  it("shows current information and groups history by school year", async () => {
    stubHealth();
    renderWithProviders(
      <ChildHealth
        childId={CHILD}
        isStaff
        dateOfBirth="2021-03-12"
        currentSchoolYear="2026–2027"
      />,
    );

    expect(await screen.findByRole("heading", { name: "Одоогийн мэдээлэл" })).toBeInTheDocument();
    expect(screen.getByText("Сүү, самар")).toBeInTheDocument();
    expect(screen.getByText("1 идэвхтэй · 09.10 хүртэл")).toBeInTheDocument();
    expect(screen.getAllByText("5 нас").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "2026–2027 хичээлийн жил" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "2025–2026 хичээлийн жил" })).toBeInTheDocument();
    expect(screen.getByText("Улаанбурхан (MMR)")).toBeInTheDocument();
  });

  it("reveals the permitted add actions from the primary button", async () => {
    stubHealth();
    const user = userEvent.setup();
    renderWithProviders(<ChildHealth childId={CHILD} isStaff />);

    await user.click(await screen.findByRole("button", { name: "Мэдээлэл нэмэх" }));

    expect(screen.getByRole("button", { name: "Харшил нэмэх" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Эмийн зөвшөөрөл нэмэх" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Вакцин нэмэх" })).toBeInTheDocument();
  });
});

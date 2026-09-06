import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import IncidentsPage from "@/app/(app)/incidents/page";

const KG_ID = "33333333-3333-4333-8333-333333333333";
const CHILD_ID = "11111111-1111-4111-8111-111111111111";

function incidentList() {
  return {
    items: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        kind: "FEVER",
        occurredAt: "2026-08-26T07:30:00.000Z",
        location: "Бүлгийн өрөө",
        bodyPart: null,
        description: "Үдийн унтлагын дараа 38.2 хэм халуурсан.",
        firstAid: "Халууныг буулгах арга хэмжээ авсан.",
        followUp: null,
        isHighPriority: true,
        reportedAt: "2026-08-26T07:45:00.000Z",
        notificationId: null,
        recordedBy: null,
        child: { id: CHILD_ID, lastName: "Энхбат", firstName: "Тэмүүлэн" },
        media: [],
      },
    ],
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
  };
}

function stub() {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    { path: `/kindergartens/${KG_ID}/incidents`, body: incidentList() },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("kindergarten incident journal", () => {
  it("shows the child, severity, reporting state and incident detail", async () => {
    stub();
    renderWithProviders(<IncidentsPage />);

    expect(await screen.findByText("Энхбат Тэмүүлэн")).toBeInTheDocument();
    expect(screen.getByText("Халууралт")).toBeInTheDocument();
    expect(screen.getAllByText("Яаралтай")).toHaveLength(2);
    expect(screen.getByText("Эцэг эхэд мэдээлсэн")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Энхбат Тэмүүлэн/ })).toHaveAttribute(
      "href",
      `/children/${CHILD_ID}/general?tab=incidents`,
    );
  });

  it("sends the reporting-state filter to the API", async () => {
    const user = userEvent.setup();
    const { calls } = stub();
    renderWithProviders(<IncidentsPage />);

    await screen.findByText("Энхбат Тэмүүлэн");
    await user.click(screen.getByRole("button", { name: "Мэдэгдээгүй" }));

    expect(
      calls.some(
        (call) => call.url.includes("/incidents?") && call.url.includes("unreportedOnly=true"),
      ),
    ).toBe(true);
  });
});

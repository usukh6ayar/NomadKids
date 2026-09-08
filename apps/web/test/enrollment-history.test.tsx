import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChildEnrollmentArchive } from "@/components/child/enrollment-archive";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";

const CHILD = "11111111-1111-4111-8111-111111111111";

function stubArchive() {
  stubApi([
    { path: "/auth/me", body: sessionFor(["PARENT"]) },
    {
      path: `/children/${CHILD}/enrollment-archive`,
      body: {
        child: {
          id: CHILD,
          lastName: "Ганболд",
          firstName: "Батбаяр",
          dateOfBirth: "2021-04-12",
        },
        current: {
          id: "22222222-2222-4222-8222-222222222222",
          startedOn: "2026-09-01",
          schoolYear: {
            id: "33333333-3333-4333-8333-333333333333",
            name: "2026-2027",
          },
          kindergarten: {
            id: "44444444-4444-4444-8444-444444444444",
            name: "Бяцхан нүүдэлчид цэцэрлэг",
            address: null,
            phone: null,
            email: null,
            description: null,
          },
          group: {
            id: "55555555-5555-4555-8555-555555555555",
            name: "Дэлбээ бүлэг",
            schedule: null,
            rules: null,
          },
          teachers: [
            {
              id: "66666666-6666-4666-8666-666666666666",
              lastName: "Дэлгэрмаа",
              firstName: "Сувдаа",
              role: "LEAD",
            },
          ],
        },
        history: [
          {
            id: "77777777-7777-4777-8777-777777777777",
            status: "TRANSFERRED",
            startedOn: "2025-09-01",
            endedOn: "2026-08-31",
            kindergarten: {
              id: "88888888-8888-4888-8888-888888888888",
              name: "Нархан цэцэрлэг",
            },
            group: {
              id: "99999999-9999-4999-8999-999999999999",
              name: "Бүжин бүлэг",
            },
            schoolYear: {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              name: "2025-2026",
            },
          },
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            status: "TRANSFERRED",
            startedOn: "2024-09-02",
            endedOn: "2025-08-31",
            kindergarten: {
              id: "88888888-8888-4888-8888-888888888888",
              name: "Нархан цэцэрлэг",
            },
            group: {
              id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              name: "Алаг үрс бүлэг",
            },
            schoolYear: {
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              name: "2024-2025",
            },
          },
        ],
      },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("суралцсан түүх", () => {
  it("shows the active registration and derives a chronological transfer timeline", async () => {
    stubArchive();
    renderWithProviders(<ChildEnrollmentArchive childId={CHILD} showHero={false} />);

    const current = await screen.findByRole("region", { name: "Суралцсан түүх" });
    expect(within(current).getByText("Одоогийн бүртгэл")).toBeInTheDocument();
    expect(within(current).getByText("Суралцаж байгаа")).toBeInTheDocument();
    expect(within(current).getByText("Дэлгэрмаа Сувдаа")).toBeInTheDocument();
    expect(within(current).getByText("2026-2027")).toBeInTheDocument();

    const timeline = screen.getByRole("region", { name: "Бүртгэл, шилжилтийн түүх" });
    expect(within(timeline).getByText("3 өөрчлөлт")).toBeInTheDocument();
    expect(within(timeline).getByText("Цэцэрлэг шилжсэн")).toBeInTheDocument();
    expect(within(timeline).getByText("Бүлэг шилжсэн")).toBeInTheDocument();
    expect(within(timeline).getByText("Цэцэрлэгт анх элссэн")).toBeInTheDocument();
    expect(within(timeline).getAllByText("5 нас").length).toBeGreaterThan(0);
    expect(within(timeline).getByText("2024.09.02")).toBeInTheDocument();
  });
});

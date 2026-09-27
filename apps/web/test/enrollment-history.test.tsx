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
            address: "Баянгол дүүрэг, 3-р хороо",
            capacity: 120,
            groupCount: 6,
            phone: null,
            email: null,
            description: null,
          },
          group: {
            id: "55555555-5555-4555-8555-555555555555",
            name: "Дэлбээ бүлэг",
            ageBand: "MIDDLE",
            childCount: 18,
            schedule: null,
            rules: null,
          },
          teachers: [
            {
              id: "66666666-6666-4666-8666-666666666666",
              lastName: "Дэлгэрмаа",
              firstName: "Сувдаа",
              role: "LEAD",
              specialization: "СӨБ-ийн багш",
              education: "МУБИС",
              phone: "99001234",
              email: "suvdaa@nomadkids.mn",
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
              address: "Сүхбаатар дүүрэг, 8-р хороо",
              capacity: 100,
              groupCount: 5,
            },
            group: {
              id: "99999999-9999-4999-8999-999999999999",
              name: "Бүжин бүлэг",
              ageBand: "JUNIOR",
              childCount: 20,
            },
            teachers: [
              {
                id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                lastName: "Өюунцэцэг",
                firstName: "Болор",
                role: "LEAD",
              },
            ],
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
              address: null,
              capacity: null,
              groupCount: 5,
            },
            group: {
              id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              name: "Алаг үрс бүлэг",
              ageBand: "NURSERY",
              childCount: 16,
            },
            teachers: [],
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
  /**
   * The client's 2026-09-24 design: the current kindergarten with its facts
   * and its teachers, then the past ones down a timeline of school years.
   */
  it("opens on the current kindergarten, with its facts and its teachers", async () => {
    stubArchive();
    renderWithProviders(<ChildEnrollmentArchive childId={CHILD} />);

    const current = await screen.findByRole("region", { name: "Одоогийн сурч байгаа цэцэрлэг" });
    expect(within(current).getByText("Бяцхан нүүдэлчид цэцэрлэг")).toBeInTheDocument();
    expect(within(current).getByText("Дэлбээ бүлэг · Ахлах бүлэг · 18 хүүхэд")).toBeInTheDocument();

    // The four facts, and the teacher's own card beneath them.
    expect(within(current).getByText("120 хүүхэд")).toBeInTheDocument();
    expect(within(current).getByText("6 бүлэг")).toBeInTheDocument();
    expect(within(current).getByText("Цэцэрлэг")).toBeInTheDocument();
    expect(within(current).getByText("Баянгол дүүрэг, 3-р хороо")).toBeInTheDocument();
    expect(within(current).getAllByText("Дэлгэрмаа Сувдаа").length).toBeGreaterThan(0);
    expect(within(current).getByText("СӨБ-ийн багш")).toBeInTheDocument();
    expect(within(current).getByText("МУБИС")).toBeInTheDocument();
    expect(within(current).getByRole("link", { name: "99001234" })).toHaveAttribute(
      "href",
      "tel:99001234",
    );
    expect(within(current).getByRole("link", { name: "suvdaa@nomadkids.mn" })).toHaveAttribute(
      "href",
      "mailto:suvdaa@nomadkids.mn",
    );
  });

  it("lists the past placements by school year, with the age the child was", async () => {
    stubArchive();
    renderWithProviders(<ChildEnrollmentArchive childId={CHILD} />);

    const past = await screen.findByRole("region", { name: "Өмнөх суралцсан түүх" });
    const rows = within(past).getAllByRole("listitem");
    expect(rows).toHaveLength(2);

    expect(within(rows[0]!).getByText("2025-2026")).toBeInTheDocument();
    // Born 2021-04-12, enrolled 2025-09-01.
    expect(within(rows[0]!).getByText("4 нас")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Нархан цэцэрлэг")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Бүжин бүлэг · Дунд бүлэг · 20 хүүхэд")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Шилжсэн")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Өюунцэцэг Болор")).toBeInTheDocument();
    // A past teacher is a name and a role — never a phone number.
    expect(within(rows[0]!).queryByRole("link", { name: /@/ })).toBeNull();

    expect(within(rows[1]!).getByText("2024-2025")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("3 нас")).toBeInTheDocument();
  });
});

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { AttendanceRequestQueue } from "@/components/attendance/request-queue";
import { todayLocal } from "@/lib/format";

/**
 * A teacher's leave notices as a week's table — client, 2026-10-07: "7
 * хоногоор цэвэрхэн ойлгомжтой", decided "ирц бүртгэдэг шиг хялбар".
 */

function shift(date: string, by: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + by)).toISOString().slice(0, 10);
}

const TODAY = todayLocal();
const weekday = (new Date(`${TODAY}T00:00:00Z`).getUTCDay() + 6) % 7;
const MONDAY = shift(TODAY, -weekday);

function request(id: string, firstName: string, from: string, to: string, status = "SICK") {
  return {
    id,
    childId: `22222222-2222-4222-8222-22222222222${id.slice(-1)}`,
    child: {
      id: `22222222-2222-4222-8222-22222222222${id.slice(-1)}`,
      firstName,
      lastName: "Бат",
    },
    dateFrom: from,
    dateTo: to,
    requestedStatus: status,
    reason: "Ханиалгатай",
    reviewStatus: "PENDING",
    createdAt: new Date().toISOString(),
  };
}

const ANU = request("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "Ану", MONDAY, shift(MONDAY, 1));
const SARA = request(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  "Сараа",
  shift(MONDAY, 3),
  shift(MONDAY, 3),
  "EXCUSED",
);
const LATER = request(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  "Тэмүүлэн",
  shift(MONDAY, 8),
  shift(MONDAY, 8),
);

function stub(items = [ANU, SARA, LATER]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    {
      path: "/attendance-requests/review-queue",
      body: { items, page: 1, pageSize: 100, total: items.length, totalPages: 1 },
    },
    { path: "/attendance-requests/", method: "POST", body: { ...ANU, reviewStatus: "APPROVED" } },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("leave notices by the week", () => {
  it("lays this week's notices out across Monday to Sunday", async () => {
    stub();
    renderWithProviders(<AttendanceRequestQueue heading="Эцэг эхийн мэдэгдэл" />);

    const table = await screen.findByRole("table", { name: "Чөлөөний хүсэлт, 7 хоногоор" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Бат Ану");
    // Ану's two sick days, marked as the register marks them.
    expect(within(rows[0]!).getAllByText("Ө")).toHaveLength(2);
    expect(within(rows[1]!).getAllByText("Ч")).toHaveLength(1);
    expect(screen.getByText("Бусад 7 хоногт 1 хүсэлт хүлээгдэж байна.")).toBeInTheDocument();
  });

  it("decides a notice with one press", async () => {
    const user = userEvent.setup();
    const api = stub();
    renderWithProviders(<AttendanceRequestQueue heading="Эцэг эхийн мэдэгдэл" />);

    await user.click(await screen.findByRole("button", { name: "Бат Ану — зөвшөөрөх" }));
    await waitFor(() =>
      expect(
        api.calls.find((call) => call.url === `/attendance-requests/${ANU.id}/review`)?.body,
      ).toEqual({ decision: "APPROVED" }),
    );
  });

  it("approves the whole week at once", async () => {
    const user = userEvent.setup();
    const api = stub();
    renderWithProviders(<AttendanceRequestQueue heading="Эцэг эхийн мэдэгдэл" />);

    await user.click(await screen.findByRole("button", { name: /Бүгдийг зөвшөөрөх/ }));
    await waitFor(() =>
      expect(api.calls.filter((call) => call.method === "POST").map((call) => call.url)).toEqual([
        `/attendance-requests/${ANU.id}/review`,
        `/attendance-requests/${SARA.id}/review`,
      ]),
    );
  });

  it("steps to the next week", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<AttendanceRequestQueue heading="Эцэг эхийн мэдэгдэл" />);

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Дараах 7 хоног" }));
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Бат Тэмүүлэн");
  });
});

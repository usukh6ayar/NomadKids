import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import GroupAttendancePage from "@/app/(app)/groups/[groupId]/attendance/page";

/**
 * The teacher's ESIS step — client, 2026-09-27: Илгээх → Шалгах →
 * Баталгаажсан / Зөрүүтэй, and no technical code, API name or person number
 * on screen.
 *
 * Clock frozen to a Wednesday for the reason `attendance-week-grid.test.tsx`
 * records: on a weekend the register has no editable day.
 */
vi.useFakeTimers({ shouldAdvanceTime: true });
vi.setSystemTime(new Date("2026-09-09T09:00:00Z"));
afterAll(() => vi.useRealTimers());

const KG = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";
const CHILD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHILD_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ENROL_A = "11111111-1111-4111-8111-111111111111";
const ENROL_B = "22222222-2222-4222-8222-222222222222";
const TODAY = "2026-09-09";

const CHILDREN = [
  { id: CHILD_A, lastName: "Батжаргал", firstName: "Ануужин" },
  { id: CHILD_B, lastName: "Ганболд", firstName: "Батбаяр" },
];

function stub(readBack: { source: "MOCK" | "LIVE"; rows: Record<string, string>[] }) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    {
      path: `/groups/${GROUP}/attendance/range`,
      body: {
        days: [TODAY],
        rows: CHILDREN.map((child, index) => ({
          child,
          enrollmentId: index === 0 ? ENROL_A : ENROL_B,
          records: {},
        })),
      },
    },
    {
      path: `/groups/${GROUP}/attendance/summary`,
      body: { month: "2026-09", totals: {}, days: [], children: [], roster: 2 },
    },
    {
      path: `/groups/${GROUP}/attendance/esis-preview`,
      body: {
        demo: false,
        apiId: 171,
        endpoint: "/svc/api/hub/v2/group/school/attendance/save/v3",
        requests: [
          {
            groupId: GROUP,
            groupName: "Наран",
            payload: {
              institutionId: 1,
              studentGroupId: 10001,
              dayDate: TODAY,
              attendanceList: [
                {
                  personId: 90000000000001,
                  attendReasonCode: "PRESENT",
                  tardyMinutes: 0,
                  attendReasonList: [],
                },
                {
                  personId: 90000000000002,
                  attendReasonCode: "SICK",
                  tardyMinutes: 0,
                  attendReasonList: [],
                },
              ],
            },
          },
        ],
      },
    },
    {
      path: `/groups/${GROUP}/attendance/submit`,
      method: "POST",
      body: { groupId: GROUP, date: TODAY, submittedAt: `${TODAY}T10:15:00.000Z` },
    },
    {
      path: `/groups/${GROUP}/attendance`,
      method: "GET",
      body: CHILDREN.map((child, index) => ({
        child,
        enrollmentId: index === 0 ? ENROL_A : ENROL_B,
        record: {
          id: `cccccccc-cccc-4ccc-8ccc-00000000000${index}`,
          status: "PRESENT",
          note: null,
        },
      })),
    },
    {
      path: `/kindergartens/${KG}/esis/resource`,
      body: {
        resource: "groupAttendance",
        source: readBack.source,
        status: "SUCCEEDED",
        errorCode: null,
        count: readBack.rows.length,
        durationMs: 10,
        fields: [],
        rows: readBack.rows,
        response: { SUCCESS_CODE: 200, RESPONSE_MESSAGE: "OK", RESULT: readBack.rows },
      },
    },
    {
      path: "/attendance-requests/review-queue",
      body: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 },
    },
    { path: "/groups", body: { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 } },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ groupId: GROUP });
  setSearchParams("");
});

async function sendThenCheck(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "ESIS рүү илгээх" }));
  await screen.findByText(/Илгээсэн \d\d:\d\d/);
  await user.click(screen.getByRole("button", { name: "ESIS-ээс шалгах" }));
}

describe("ESIS: Илгээх → Шалгах → Баталгаажсан / Зөрүүтэй", () => {
  it("shows no technical code, API name or person number", async () => {
    stub({ source: "LIVE", rows: [] });
    renderWithProviders(<GroupAttendancePage />);

    expect(await screen.findByText("Ирц ESIS рүү илгээгдээгүй байна.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ESIS-ээс шалгах" })).toBeDisabled();
    for (const technical of [/API-000269/, /personId/, /90000000000001/, /studentGroupId/]) {
      expect(screen.queryByText(technical)).toBeNull();
    }
  });

  it("calls a matching read-back Баталгаажсан", async () => {
    const user = userEvent.setup();
    stub({
      source: "LIVE",
      rows: [
        { personId: "90000000000001", attendanceReasonCode: "PRESENT" },
        { personId: "90000000000002", attendanceReasonCode: "SICK" },
      ],
    });
    renderWithProviders(<GroupAttendancePage />);

    await sendThenCheck(user);
    expect(
      await screen.findByText(/Баталгаажсан — ESIS дээр зөв хадгалагдсан/),
    ).toBeInTheDocument();
  });

  it("calls a differing read-back Зөрүүтэй, with how many differ", async () => {
    const user = userEvent.setup();
    stub({
      source: "LIVE",
      rows: [
        { personId: "90000000000001", attendanceReasonCode: "PRESENT" },
        { personId: "90000000000002", attendanceReasonCode: "PRESENT" },
      ],
    });
    renderWithProviders(<GroupAttendancePage />);

    await sendThenCheck(user);
    expect(await screen.findByText(/Зөрүүтэй — 1 хүүхдийн ирц/)).toBeInTheDocument();
  });

  it("never calls a demo read-back either verdict", async () => {
    const user = userEvent.setup();
    stub({ source: "MOCK", rows: [{ personId: "1", attendanceReasonCode: "PRESENT" }] });
    renderWithProviders(<GroupAttendancePage />);

    await sendThenCheck(user);
    expect(await screen.findByText(/Туршилтын горим/)).toBeInTheDocument();
    expect(screen.queryByText(/Баталгаажсан —|Зөрүүтэй —/)).toBeNull();
  });
});

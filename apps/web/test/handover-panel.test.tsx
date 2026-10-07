import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { HandoverPanel } from "@/components/attendance/handover-panel";
import { todayLocal } from "@/lib/format";

/**
 * «Гараас гарт» — client, 2026-10-06: the class as a numbered table, arrival
 * and departure with time and companion, filled in by the teacher when a
 * parent did not, a week at a time, a month to Excel.
 */

const GROUP = "44444444-4444-4444-8444-444444444444";
const ANU = "22222222-2222-4222-8222-222222222221";
const BAT = "22222222-2222-4222-8222-222222222222";
const SARA = "22222222-2222-4222-8222-222222222223";
const TODAY = todayLocal();

function stub() {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    {
      path: `/groups/${GROUP}/attendance/range`,
      body: {
        days: [TODAY],
        rows: [
          {
            child: { id: ANU, lastName: "Батжаргал", firstName: "Ану" },
            enrollmentId: "e1",
            records: {
              [TODAY]: {
                id: "r1",
                status: "PRESENT",
                note: "Ханиалгатай",
                arrivedWith: "MOTHER",
                arrivedWithName: null,
                arrivedAt: `${TODAY}T00:15:00.000Z`,
                pickedUpWith: null,
                pickedUpAt: null,
              },
            },
          },
          {
            child: { id: BAT, lastName: "Дорж", firstName: "Бат" },
            enrollmentId: "e2",
            records: {},
          },
          {
            child: { id: SARA, lastName: "Пүрэв", firstName: "Сараа" },
            enrollmentId: "e3",
            records: { [TODAY]: { id: "r3", status: "SICK", note: null } },
          },
        ],
      },
    },
    { path: `/children/${BAT}/attendance/${TODAY}`, method: "PUT", body: {} },
    { path: `/children/${ANU}/attendance/${TODAY}/pickup`, method: "PATCH", body: {} },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Гараас гарт", () => {
  it("lists the class by number with arrival and departure for the day", async () => {
    stub();
    renderWithProviders(<HandoverPanel groupId={GROUP} />);

    const table = await screen.findByRole("table", { name: "Гараас гарт" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(/^1Батжаргал Ану\d\d:\d\dЭэж\+ Тэмдэглэх$/);
    // No record yet: arrival can be filled in, departure waits for it.
    expect(within(rows[1]!).getByRole("button", { name: "Дорж Бат — явсан" })).toBeDisabled();
    // Absent: the status, and nothing to hand over.
    expect(rows[2]).toHaveTextContent("Өвчтэй");
    expect(within(rows[2]!).queryByRole("button")).toBeNull();
  });

  it("records an arrival the way the register does, keeping the day's status and note", async () => {
    const user = userEvent.setup();
    const api = stub();
    renderWithProviders(<HandoverPanel groupId={GROUP} />);

    await user.click(await screen.findByRole("button", { name: "Дорж Бат — ирсэн" }));
    const dialog = await screen.findByRole("dialog", { name: "Дорж Бат — ирсэн" });
    await user.click(within(dialog).getByRole("radio", { name: "Аав" }));
    await user.clear(within(dialog).getByLabelText("Цаг"));
    await user.type(within(dialog).getByLabelText("Цаг"), "08:20");
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    const put = api.calls.find((c) => c.method === "PUT")!;
    expect(put.body).toMatchObject({
      status: "PRESENT",
      note: null,
      arrivedWith: "FATHER",
      arrivedWithName: null,
    });
    expect(new Date((put.body as { arrivedAt: string }).arrivedAt).getHours()).toBe(8);
  });

  it("records who took a child home, with a name for «Бусад»", async () => {
    const user = userEvent.setup();
    const api = stub();
    renderWithProviders(<HandoverPanel groupId={GROUP} />);

    await user.click(await screen.findByRole("button", { name: "Батжаргал Ану — явсан" }));
    const dialog = await screen.findByRole("dialog", { name: "Батжаргал Ану — явсан" });
    await user.click(within(dialog).getByRole("radio", { name: "Бусад" }));
    expect(within(dialog).getByRole("button", { name: "Хадгалах" })).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox", { name: /^Хэн/ }), "Эмээ");
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toMatchObject({
      pickedUpWith: "OTHER",
      pickedUpWithName: "Эмээ",
    });
  });

  it("downloads the month for Excel", async () => {
    const user = userEvent.setup();
    stub();
    const created: Blob[] = [];
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: (blob: Blob) => {
        created.push(blob);
        return "blob:csv";
      },
      revokeObjectURL: () => {},
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderWithProviders(<HandoverPanel groupId={GROUP} />);

    await screen.findByRole("table", { name: "Гараас гарт" });
    await user.click(screen.getByRole("button", { name: "Excel" }));

    await waitFor(() => expect(created).toHaveLength(1));
    const bytes = await new Promise<Uint8Array>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(created[0]!);
    });
    // A UTF-8 BOM, so Excel opens the Cyrillic as Cyrillic.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes.slice(3));
    expect(text).toMatch(/^"Огноо","№","Хүүхэд","Төлөв","Ирсэн цаг","Хэнтэй ирсэн"/);
    expect(text).toContain('"Батжаргал Ану","Ирсэн"');
  });
});

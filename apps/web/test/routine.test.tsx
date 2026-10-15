import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setParams, stubApi } from "./support/render";
import GroupRoutinePage from "@/app/(app)/groups/[groupId]/routine/page";
import ChildRoutinePage from "@/app/(app)/children/[childId]/routine/page";
import AdminRoutinePage from "@/app/(app)/admin/routine/page";
import { ROUTINE_TEMPLATE, parseRoutineTable, routineToCsv } from "@/lib/routine";

/*
 * ★ Өдрийн дэглэм · Сургалтын чиглэл · Дугуйлан — 2026-10-09, the client. Per
 * group, the same every day; clubs per group, which a family asks to join and
 * the teacher approves; the director reads. Contract: `lib/routine.ts`.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";
const CHILD = "66666666-6666-4666-8666-666666666666";
const CLUB_PHOTO = "77777777-7777-4777-8777-777777777777";

const routine = (overrides: Record<string, unknown> = {}) => ({
  group: { id: GROUP, name: "Нарлаг" },
  items: [
    {
      start: "08:00",
      end: "08:40",
      name: "Өглөөний хүлээн авалт",
      areas: ["Нийгэм-сэтгэл хөдлөл"],
    },
    { start: "08:40", end: "08:55", name: "Өглөөний дасгал", areas: [] },
  ],
  plan: [],
  clubs: [
    {
      id: "club-1",
      name: "Бяцхан хөгжимчин",
      teacherName: "Д.Энхжаргал",
      photoMediaFileId: CLUB_PHOTO,
      days: [1, 3],
      start: "15:00",
      end: "15:35",
      areas: ["Хөгжим"],
      goal: "Хэмнэл мэдэрч, хамтран дуулна.",
      description: "Дуу, хөдөлгөөнийг хослуулсан 35 минутын хичээл.",
    },
  ],
  requests: [],
  ...overrides,
});

const GROUP_DETAIL = { id: GROUP, name: "Нарлаг", kindergartenId: KG };

beforeEach(() => setParams({ groupId: GROUP }));
afterEach(() => vi.unstubAllGlobals());

describe("the routine as a table", () => {
  it("reads cells pasted from Excel, skipping the header and broken rows", () => {
    const pasted = [
      "Эхлэх\tДуусах\tҮйл ажиллагаа\tТайлбар\tСургалтын чиглэл",
      "9:00\t09:30\tТойргийн цаг\tЯрилцлага\tХэл яриа; Математик",
      "08:00\t08:40\tӨглөөний хүлээн авалт\t\t",
      "оройн\t\tНэргүй мөр\t\t",
    ].join("\n");
    const { items, skipped } = parseRoutineTable(pasted);
    expect(skipped).toBe(1);
    expect(items.map((i) => [i.start, i.name, i.areas])).toEqual([
      ["08:00", "Өглөөний хүлээн авалт", []],
      ["09:00", "Тойргийн цаг", ["Хэл яриа", "Математик"]],
    ]);
  });

  it("writes a CSV it can read back", () => {
    const { items } = parseRoutineTable(routineToCsv(ROUTINE_TEMPLATE));
    expect(items).toHaveLength(ROUTINE_TEMPLATE.length);
    expect(items[0]).toMatchObject({ start: "08:00", name: "Өглөөний хүлээн авалт" });
  });
});

describe("a teacher's routine", () => {
  /*
   * ★ 2026-10-11: the API answers this route, so a 404 means the reader may not
   * see this group's routine (CLAUDE.md §1.7). The page says so — it no longer
   * shows the curriculum template in its place as if it were the group's.
   */
  it("shows a 404 as an error, with no sample routine in its place", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/groups/${GROUP}/routine`,
        status: 404,
        body: { title: "x", status: 404, requestId: "t" },
      },
      { path: `/groups/${GROUP}`, body: GROUP_DETAIL },
    ]);
    renderWithProviders(<GroupRoutinePage />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Жишээ загвар/)).toBeNull();
    expect(screen.queryByText("Тойргийн цаг")).toBeNull();
  });

  it("saves the whole routine to the API after an edit", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/groups/${GROUP}/routine/items`, method: "PUT", body: {} },
      { path: `/groups/${GROUP}/routine`, body: routine() },
      { path: `/groups/${GROUP}`, body: GROUP_DETAIL },
    ]);
    renderWithProviders(<GroupRoutinePage />);

    await user.click(await screen.findByRole("button", { name: "Өглөөний дасгал — үйлдэл" }));
    await user.click(screen.getByRole("menuitem", { name: "Засах" }));
    const dialog = screen.getByRole("dialog", { name: "Үйл ажиллагаа засах" });
    await user.click(within(dialog).getByRole("button", { name: "Хөдөлгөөн, эрүүл мэнд" }));
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() =>
      expect(api.calls.find((c) => c.method === "PUT")?.body).toMatchObject({
        items: [
          { start: "08:00", name: "Өглөөний хүлээн авалт" },
          { start: "08:40", name: "Өглөөний дасгал", areas: ["Хөдөлгөөн, эрүүл мэнд"] },
        ],
      }),
    );
  });

  it("replaces the routine from rows pasted out of Excel", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/groups/${GROUP}/routine/items`, method: "PUT", body: {} },
      { path: `/groups/${GROUP}/routine`, body: routine() },
      { path: `/groups/${GROUP}`, body: GROUP_DETAIL },
    ]);
    renderWithProviders(<GroupRoutinePage />);

    await user.click(await screen.findByRole("button", { name: /Excel-ээс оруулах/ }));
    const dialog = screen.getByRole("dialog", { name: "Excel-ээс оруулах" });
    await user.click(within(dialog).getByLabelText(/хуулаад буулгана/));
    await user.paste("08:00\t09:00\tӨглөөний хүлээн авалт\t\t");
    await user.click(within(dialog).getByRole("button", { name: "1 мөр оруулах" }));

    await waitFor(() =>
      expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({
        items: [
          {
            start: "08:00",
            end: "09:00",
            name: "Өглөөний хүлээн авалт",
            description: null,
            areas: [],
          },
        ],
      }),
    );
  });

  it("adds a club and approves a family's request", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/groups/${GROUP}/clubs`,
        method: "POST",
        body: {
          id: "c2",
          name: "Урлан",
          teacherName: "Б.Оюун",
          days: [2],
          start: "15:00",
          end: "15:30",
          areas: ["Зураг, урлал"],
        },
      },
      { path: `/groups/${GROUP}/club-requests/r1/approve`, method: "POST", body: {} },
      {
        path: `/groups/${GROUP}/routine`,
        body: routine({
          requests: [
            {
              id: "r1",
              clubId: "club-1",
              childId: CHILD,
              childName: "Б.Ану",
              status: "PENDING",
              createdAt: "2026-10-09T01:00:00.000Z",
            },
          ],
        }),
      },
      { path: `/groups/${GROUP}`, body: GROUP_DETAIL },
    ]);
    renderWithProviders(<GroupRoutinePage />);

    await user.click(await screen.findByRole("tab", { name: "Дугуйлан" }));
    expect(screen.getByRole("img", { name: "Бяцхан хөгжимчин зураг" })).toBeInTheDocument();
    const clubPhoto = screen.getByTestId(`club-photo-club-1`);
    const camera = within(clubPhoto).getByLabelText("Бяцхан хөгжимчин — зураг солих");
    expect(camera).toBeInTheDocument();
    expect(camera.closest(".absolute")).toHaveClass("bottom-1", "right-1");
    expect(
      screen.getByRole("button", { name: "Бяцхан хөгжимчин — зургийг устгах" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Хүсэлт/ }));
    const requests = screen.getByRole("dialog", { name: "Дугуйлангийн хүсэлт" });
    expect(within(requests).getByText(/Хүлээгдэж буй · 1/)).toBeInTheDocument();
    await user.click(within(requests).getByRole("button", { name: "Батлах" }));
    await waitFor(() =>
      expect(api.calls.some((c) => c.url === `/groups/${GROUP}/club-requests/r1/approve`)).toBe(
        true,
      ),
    );

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Нэмэх" }));
    const dialog = screen.getByRole("dialog", { name: "Дугуйлан нэмэх" });
    expect(within(dialog).getByText("Дугуйлангийн зураг")).toBeInTheDocument();
    expect(within(dialog).getByText("Зураг нэмэх")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Дугуйлангийн нэр/), "Урлан");
    await user.type(within(dialog).getByLabelText(/Багшийн нэр/), "Б.Оюун");
    await user.click(within(dialog).getByRole("button", { name: "Даваа" }));
    await user.click(within(dialog).getByRole("button", { name: "Мягмар" }));
    await user.click(within(dialog).getByRole("button", { name: "Зураг, урлал" }));
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() =>
      expect(api.calls.find((c) => c.url === `/groups/${GROUP}/clubs`)?.body).toMatchObject({
        name: "Урлан",
        teacherName: "Б.Оюун",
        days: [2],
        areas: ["Зураг, урлал"],
      }),
    );
  });
});

describe("the director's view", () => {
  it("lists the groups, and reads a group's routine without editing it", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: `/groups/${GROUP}/routine`, body: routine() },
      { path: `/groups/${GROUP}`, body: GROUP_DETAIL },
      {
        path: "/groups",
        body: { items: [GROUP_DETAIL], page: 1, pageSize: 100, total: 1, totalPages: 1 },
      },
    ]);
    const list = renderWithProviders(<AdminRoutinePage />);
    expect(await screen.findByRole("link", { name: "Нарлаг бүлэг" })).toHaveAttribute(
      "href",
      `/groups/${GROUP}/routine`,
    );
    list.unmount();

    renderWithProviders(<GroupRoutinePage />);
    expect(await screen.findByText("Өглөөний дасгал")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Нэмэх" })).toBeNull();
    expect(screen.queryByRole("button", { name: /— үйлдэл$/ })).toBeNull();
  });
});

describe("a family's routine", () => {
  it("asks to join a club", async () => {
    const user = userEvent.setup();
    setParams({ childId: CHILD });
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: `/children/${CHILD}/club-requests`, method: "POST", body: {} },
      { path: `/children/${CHILD}/routine`, body: routine() },
    ]);
    renderWithProviders(<ChildRoutinePage />);

    await user.click(await screen.findByRole("tab", { name: "Дугуйлан" }));
    expect(screen.queryByRole("button", { name: "Нэмэх" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Хүсэлт/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Хамрагдах хүсэлт" }));
    await waitFor(() =>
      expect(api.calls.find((c) => c.url === `/children/${CHILD}/club-requests`)?.body).toEqual({
        clubId: "club-1",
      }),
    );
  });

  it("carries no Excel button for a family", async () => {
    setParams({ childId: CHILD });
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: `/children/${CHILD}/routine`, body: routine() },
    ]);
    renderWithProviders(<ChildRoutinePage />);

    expect(await screen.findByText("Өглөөний дасгал")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Excel/ })).toBeNull();
  });

  it("opens a club to show its learning goal and detailed information", async () => {
    const user = userEvent.setup();
    setParams({ childId: CHILD });
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: `/children/${CHILD}/routine`, body: routine() },
    ]);
    renderWithProviders(<ChildRoutinePage />);

    await user.click(await screen.findByRole("tab", { name: "Дугуйлан" }));
    expect(screen.queryByText("Хэмнэл мэдэрч, хамтран дуулна.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Бяцхан хөгжимчин/ }));
    expect(screen.getByText("Хэмнэл мэдэрч, хамтран дуулна.")).toBeInTheDocument();
    expect(screen.getByText("Дуу, хөдөлгөөнийг хослуулсан 35 минутын хичээл.")).toBeInTheDocument();
  });
});

/*
  ★ «Хүсэлт» — the children and the clubs each attends, the total below, and a
  download (client, 2026-10-09).
*/
describe("the clubs' requests table", () => {
  it("lists each child with the clubs they attend, and the total", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/groups/${GROUP}/routine`,
        body: routine({
          clubs: [
            ...routine().clubs,
            {
              id: "club-2",
              name: "Урлан",
              teacherName: "Б.Оюун",
              days: [2],
              start: "15:00",
              end: "15:30",
              areas: ["Зураг, урлал"],
            },
          ],
          requests: [
            {
              id: "r1",
              clubId: "club-1",
              childId: "c1",
              childName: "Б.Ану",
              status: "APPROVED",
              createdAt: "2026-10-01T00:00:00.000Z",
            },
            {
              id: "r2",
              clubId: "club-2",
              childId: "c1",
              childName: "Б.Ану",
              status: "APPROVED",
              createdAt: "2026-10-01T00:00:00.000Z",
            },
            {
              id: "r3",
              clubId: "club-2",
              childId: "c2",
              childName: "Г.Бат",
              status: "APPROVED",
              createdAt: "2026-10-01T00:00:00.000Z",
            },
            {
              id: "r4",
              clubId: "club-1",
              childId: "c3",
              childName: "Д.Сараа",
              status: "REJECTED",
              createdAt: "2026-10-01T00:00:00.000Z",
            },
          ],
        }),
      },
      { path: `/groups/${GROUP}`, body: GROUP_DETAIL },
    ]);
    renderWithProviders(<GroupRoutinePage />);

    await user.click(await screen.findByRole("tab", { name: "Дугуйлан" }));
    await user.click(screen.getByRole("button", { name: /^Хүсэлт/ }));
    const table = screen.getByRole("table", { name: "Дугуйланд хамрагдах хүүхдүүд" });
    const anu = within(table).getByText("Б.Ану").closest("tr")!;
    expect(anu).toHaveTextContent("Бяцхан хөгжимчин, Урлан");
    expect(within(table).queryByText("Д.Сараа")).toBeNull();
    expect(within(table).getByText("Нийт: 2 хүүхэд")).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog", { name: "Дугуйлангийн хүсэлт" })).getByRole("button", {
        name: /Excel/,
      }),
    ).toBeEnabled();
  });
});

describe("the curriculum tab", () => {
  it("lists the seven areas with their pictures and no numbers, each opening downward", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/groups/${GROUP}/routine`, body: routine() },
      { path: `/groups/${GROUP}`, body: GROUP_DETAIL },
    ]);
    renderWithProviders(<GroupRoutinePage />);

    await user.click(await screen.findByRole("tab", { name: "Сургалтын чиглэл" }));
    expect(
      screen.getByText("СӨБ-ын сургалтын чиглэл · хүүхдэд эзэмшүүлэх зорилго, агуулга"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/СӨБ-ын сургалтын 7 чиглэл/)).not.toBeInTheDocument();
    const toggles = screen
      .getAllByRole("button", { expanded: false })
      .filter((b) => b.getAttribute("aria-controls")?.startsWith("area-"));
    expect(toggles).toHaveLength(7);
    const music = screen.getByRole("button", { name: "Хөгжим" });
    // The client's 3D picture, and no number before the name.
    expect(music.querySelector("img")?.getAttribute("src")).toContain("area-music");
    expect(music).not.toHaveTextContent(/\d/);
    await user.click(music);
    expect(music).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Хөгжим сонсох, дуулах/)).toBeInTheDocument();
  });

  it("lets the teacher rename an area, keeping the standard name as its key", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/groups/${GROUP}/routine/plan`, method: "PUT", body: {} },
      { path: `/groups/${GROUP}/routine`, body: routine() },
      { path: `/groups/${GROUP}`, body: GROUP_DETAIL },
    ]);
    renderWithProviders(<GroupRoutinePage />);

    await user.click(await screen.findByRole("tab", { name: "Сургалтын чиглэл" }));
    await user.click(screen.getByRole("button", { name: "Хөгжим — үйлдэл" }));
    await user.click(screen.getByRole("menuitem", { name: "Засах" }));
    const dialog = screen.getByRole("dialog", { name: "Хөгжим" });
    const name = within(dialog).getByLabelText(/Сургалтын чиглэлийн нэр/);
    await user.clear(name);
    await user.type(name, "Хөгжим, бүжиг");
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => {
      const plan = (api.calls.find((c) => c.method === "PUT")?.body as { plan: unknown[] })?.plan;
      expect(plan).toContainEqual(
        expect.objectContaining({ area: "Хөгжим", label: "Хөгжим, бүжиг" }),
      );
    });
  });
});

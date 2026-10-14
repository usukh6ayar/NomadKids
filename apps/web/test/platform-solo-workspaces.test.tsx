import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi, type RouteStub } from "./support/render";
import SoloWorkspacesPage from "@/app/(app)/platform/solo-workspaces/page";

/*
 * ★ D3 (2026-10-11): the operator merges a solo teacher's workspace into a
 * kindergarten. «Нэгтгэх» stays disabled until a preview has said yes.
 */
afterEach(() => vi.unstubAllGlobals());

const operator = () => {
  const base = sessionFor([]);
  return { ...base, memberships: [], user: { ...base.user, isSuperAdmin: true } };
};

const SOLO_ID = "77777777-7777-4777-8777-777777777777";
const TARGET_ID = "88888888-8888-4888-8888-888888888888";

const page = (items: unknown[]) => ({
  items,
  page: 1,
  pageSize: 100,
  total: items.length,
  totalPages: 1,
});

const WORKSPACE = {
  id: SOLO_ID,
  name: "Д.Сараа — бие даасан багш",
  phone: "99112233",
  email: "saraa@example.mn",
  location: "Баянзүрх дүүрэг",
  workplace: "Нарлаг цэцэрлэг",
  childCount: 4,
  createdAt: "2026-10-11T08:00:00.000Z",
};

const KINDERGARTEN = {
  id: TARGET_ID,
  name: "Нарлаг цэцэрлэг",
  isActive: true,
  createdAt: "2026-09-01T00:00:00.000Z",
};

const RESULT = {
  moved: { "children.kindergartenId": 4, "groups.kindergartenId": 1 },
  membershipsMoved: 3,
  membershipsJoined: 0,
  adminsDropped: 1,
  groupsRenamed: [{ from: "Миний бүлэг", to: "Миний бүлэг (бие даасан)" }],
  childrenAttached: [],
  kept: {},
  intoExistingGroup: false,
};

const GROUP_ID = "99999999-9999-4999-8999-999999999999";
const TARGET_GROUPS = [{ id: GROUP_ID, name: "Нарлаг бүлэг" }];

function stub(previewBody: unknown) {
  return stubApi([
    { path: "/auth/me", body: operator() },
    {
      path: `/platform/solo-workspaces/${SOLO_ID}/merge-preview`,
      method: "POST",
      body: previewBody,
    },
    { path: `/platform/solo-workspaces/${SOLO_ID}/merge`, method: "POST", body: RESULT },
    { path: "/platform/solo-workspaces", body: page([WORKSPACE]) },
    { path: "/platform/kindergartens", body: page([KINDERGARTEN]) },
  ]);
}

/** The merge opens from the row's «⋯» since the page became a table (2026-10-14). */
async function openMerge(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Д.Сараа — үйлдэл" }));
  await user.click(screen.getByRole("menuitem", { name: "Цэцэрлэгт нэгтгэх" }));
}

describe("the operator's solo workspaces", () => {
  /*
   * ★ Made simple on 2026-10-14 (the user): the kindergarten the teacher named
   * is chosen already, the preview runs by itself, and «Нэгтгэх» asks once
   * more — nothing is undone.
   */
  it("chooses the teacher's kindergarten, previews by itself, and merges after asking", async () => {
    const user = userEvent.setup();
    const api = stub({ ok: true, result: RESULT, targetGroups: TARGET_GROUPS });
    renderWithProviders(<SoloWorkspacesPage />);

    // « — бие даасан багш» is not repeated in the solo teachers' own table.
    const row = (await screen.findByText("Д.Сараа")).closest("tr")!;
    expect(screen.queryByText(WORKSPACE.name)).toBeNull();
    expect(row).toHaveTextContent("Нарлаг цэцэрлэг");
    await openMerge(user);
    const dialog = await screen.findByRole("dialog", { name: "Д.Сараа-г цэцэрлэгт нэгтгэх" });

    // «Нарлаг цэцэрлэг» — what the teacher wrote — is chosen, and previewed.
    expect(await within(dialog).findByText("Хүүхэд: 4")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Цэцэрлэг/)).toHaveTextContent("Нарлаг цэцэрлэг");
    expect(within(dialog).getByText(/Багшийн бичсэн «Нарлаг цэцэрлэг»-аар/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Урьдчилан харах" })).toBeNull();
    // The name clashes, so — and only so — it is asked for.
    expect(within(dialog).getByLabelText(/Бүлгийн нэр давхцаж байна/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Нэгтгэх" }));
    const confirm = await screen.findByRole("dialog", {
      name: "Д.Сараа-г Нарлаг цэцэрлэг-т нэгтгэх үү?",
    });
    expect(api.calls.some((c) => c.url.endsWith("/merge"))).toBe(false);
    await user.click(within(confirm).getByRole("button", { name: "Нэгтгэх" }));
    await waitFor(() =>
      expect(api.calls.find((c) => c.url.endsWith("/merge"))?.body).toEqual({
        targetKindergartenId: TARGET_ID,
      }),
    );
  });

  it("offers no inactive kindergarten", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/solo-workspaces", body: page([{ ...WORKSPACE, workplace: null }]) },
      {
        path: "/platform/kindergartens",
        body: page([
          KINDERGARTEN,
          {
            ...KINDERGARTEN,
            id: "99999999-9999-4999-8999-999999999990",
            name: "Хаалттай",
            isActive: false,
          },
        ]),
      },
    ]);
    renderWithProviders(<SoloWorkspacesPage />);

    await openMerge(user);
    const dialog = await screen.findByRole("dialog", { name: "Д.Сараа-г цэцэрлэгт нэгтгэх" });
    await user.click(within(dialog).getByLabelText(/Цэцэрлэг/));
    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toContain("Нарлаг цэцэрлэг");
    expect(options).not.toContain("Хаалттай");
  });

  it("names a child matching two of the kindergarten's children, and keeps «Нэгтгэх» off", async () => {
    const user = userEvent.setup();
    stub({
      ok: false,
      refusal: { kind: "ambiguous", children: [{ soloChildId: SOLO_ID, name: "Дорж Тэмүүлэн" }] },
      targetGroups: TARGET_GROUPS,
    });
    renderWithProviders(<SoloWorkspacesPage />);

    await openMerge(user);
    const dialog = await screen.findByRole("dialog", { name: "Д.Сараа-г цэцэрлэгт нэгтгэх" });

    expect(await within(dialog).findByText(/Дорж Тэмүүлэн/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Нэгтгэх" })).toBeDisabled();
  });

  it("merges into a chosen group, leaving a matched child separate, with the preview of those choices", async () => {
    const user = userEvent.setup();
    const api = stub({
      ok: true,
      result: {
        ...RESULT,
        childrenAttached: [
          { soloChildId: SOLO_ID, targetChildId: TARGET_ID, name: "Дорж Тэмүүлэн" },
        ],
      },
      targetGroups: TARGET_GROUPS,
    });
    renderWithProviders(<SoloWorkspacesPage />);

    await openMerge(user);
    const dialog = await screen.findByRole("dialog", { name: "Д.Сараа-г цэцэрлэгт нэгтгэх" });
    expect(await within(dialog).findByText(/бичлэгт нэгтгэгдэх хүүхэд: 1/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("radio", { name: "«Нарлаг бүлэг» бүлэгт нэгтгэх" }));
    await user.click(await within(dialog).findByLabelText(/Дорж Тэмүүлэн — тусад нь үлдээх/));

    // Each change previews again by itself; the last preview carries every choice.
    await waitFor(() =>
      expect(api.calls.filter((c) => c.url.endsWith("/merge-preview")).at(-1)?.body).toEqual({
        targetKindergartenId: TARGET_ID,
        targetGroupId: GROUP_ID,
        keepSeparate: [SOLO_ID],
      }),
    );
    const merge = within(dialog).getByRole("button", { name: "Нэгтгэх" });
    await waitFor(() => expect(merge).toBeEnabled());
    await user.click(merge);
    await user.click(
      within(await screen.findByRole("dialog", { name: /нэгтгэх үү\?/ })).getByRole("button", {
        name: "Нэгтгэх",
      }),
    );
    await waitFor(() =>
      expect(api.calls.find((c) => c.url.endsWith("/merge"))?.body).toEqual({
        targetKindergartenId: TARGET_ID,
        targetGroupId: GROUP_ID,
        keepSeparate: [SOLO_ID],
      }),
    );
  });

  it("says why a kindergarten without a school year cannot take the workspace", async () => {
    const user = userEvent.setup();
    const api = stub({ ok: false, refusal: { kind: "noSchoolYear" }, targetGroups: [] });
    renderWithProviders(<SoloWorkspacesPage />);

    await openMerge(user);
    const dialog = await screen.findByRole("dialog", { name: "Д.Сараа-г цэцэрлэгт нэгтгэх" });

    expect(
      await within(dialog).findByText("Цэцэрлэгт идэвхтэй хичээлийн жил алга."),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Нэгтгэх" })).toBeDisabled();
    expect(api.calls.some((c) => c.url.endsWith("/merge"))).toBe(false);
  });

  it("says where a solo teacher comes from when there is none yet", async () => {
    stubApi([
      { path: "/auth/me", body: operator() },
      { path: "/platform/solo-workspaces", body: page([]) },
    ]);
    renderWithProviders(<SoloWorkspacesPage />);

    expect(await screen.findByText("Бие даасан багш алга")).toBeInTheDocument();
    expect(
      screen.getByText("Багш «Үнийн санал» хуудаснаас бүртгүүлэхэд энд харагдана."),
    ).toBeInTheDocument();
  });

  /*
   * ★ A solo teacher does not pay; each family pays its child's fee by QPay and
   * the child is active once it does (2026-10-14, the user).
   */
  it("counts the children paid for and those not, and filters by it", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: operator() },
      {
        path: "/platform/solo-workspaces",
        body: page([
          { ...WORKSPACE, paidChildCount: 1 },
          {
            ...WORKSPACE,
            id: "66666666-6666-4666-8666-666666666666",
            name: "Б.Ану — бие даасан багш",
            childCount: 3,
            paidChildCount: 3,
          },
        ]),
      },
    ]);
    renderWithProviders(<SoloWorkspacesPage />);
    const table = await screen.findByRole("table");
    const row = (name: string) => within(table).getByText(name).closest("tr")!;
    const cells = (name: string) =>
      [...row(name).querySelectorAll("td")].map((td) => td.textContent);

    // Children, paid, not paid.
    expect(cells("Д.Сараа").slice(5, 8)).toEqual(["4", "1", "3"]);
    expect(cells("Б.Ану").slice(5, 8)).toEqual(["3", "3", "0"]);
    const totals = table.querySelectorAll("thead tr")[1]!;
    expect(totals).toHaveTextContent("Нийт: 2 багш");
    expect([...totals.querySelectorAll("td")].map((td) => td.textContent).slice(5, 8)).toEqual([
      "7",
      "4",
      "3",
    ]);

    await user.click(screen.getByLabelText("Хүүхдийн төлбөрөөр шүүх"));
    await user.click(screen.getByRole("option", { name: "Төлөөгүй хүүхэдтэй" }));
    expect(table.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(within(table).getByText("Д.Сараа")).toBeInTheDocument();
  });

  /*
   * ★ Idle solo teachers — 2026-10-14, the user: warned at 14 days, deletable
   * by the operator from then, deleted on their own at 30.
   */
  describe("idle teachers", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 9, 14));
    });
    afterEach(() => vi.useRealTimers());

    const IDLE = { ...WORKSPACE, lastActiveAt: "2026-09-28T09:00:00.000Z", paidChildCount: 2 };
    const FRESH = {
      ...WORKSPACE,
      id: "66666666-6666-4666-8666-666666666666",
      name: "Б.Ану — бие даасан багш",
      lastActiveAt: "2026-10-12T09:00:00.000Z",
    };

    function renderIdle(extra: RouteStub[] = []) {
      const api = stubApi([
        ...extra,
        { path: "/auth/me", body: operator() },
        { path: "/platform/solo-workspaces", body: page([IDLE, FRESH]) },
      ]);
      renderWithProviders(<SoloWorkspacesPage />);
      return api;
    }

    it("counts down to the automatic deletion from day 14", async () => {
      renderIdle();
      const table = await screen.findByRole("table");
      const row = (name: string) => within(table).getByText(name).closest("tr")!;

      expect(row("Д.Сараа")).toHaveTextContent("16 хоног идэвхгүй · 14 хоногийн дараа устна");
      expect(row("Б.Ану")).toHaveTextContent("2026.10.12");
      expect(row("Б.Ану")).not.toHaveTextContent("идэвхгүй");
    });

    it("filters the idle ones", async () => {
      const user = userEvent.setup();
      renderIdle();
      const table = await screen.findByRole("table");

      await user.click(screen.getByLabelText("Идэвхээр шүүх"));
      await user.click(screen.getByRole("option", { name: "14+ хоног идэвхгүй" }));
      expect(table.querySelectorAll("tbody tr")).toHaveLength(1);
      expect(within(table).getByText("Д.Сараа")).toBeInTheDocument();
    });

    it("offers «Устгах» from day 14 only, asks first, and names the paid children", async () => {
      const user = userEvent.setup();
      const api = renderIdle([
        { path: `/platform/solo-workspaces/${SOLO_ID}`, method: "DELETE", status: 204 },
      ]);
      await screen.findByRole("table");

      await user.click(screen.getByRole("button", { name: "Б.Ану — үйлдэл" }));
      expect(screen.queryByRole("menuitem", { name: "Устгах" })).toBeNull();
      await user.keyboard("{Escape}");

      await user.click(screen.getByRole("button", { name: "Д.Сараа — үйлдэл" }));
      await user.click(screen.getByRole("menuitem", { name: "Устгах" }));
      const confirm = await screen.findByRole("dialog", { name: "Д.Сараа-г устгах уу?" });
      expect(confirm).toHaveTextContent(
        "16 хоног идэвхгүй. 4 хүүхэд, үүнээс 2 хүүхдийн эцэг эх төлбөр төлсөн",
      );
      expect(api.calls.some((call) => call.method === "DELETE")).toBe(false);

      await user.click(within(confirm).getByRole("button", { name: "Устгах" }));
      await waitFor(() =>
        expect(api.calls.find((call) => call.method === "DELETE")?.url).toBe(
          `/platform/solo-workspaces/${SOLO_ID}`,
        ),
      );
    });

    it("counts nobody idle while the API does not say when they were active", async () => {
      stubApi([
        { path: "/auth/me", body: operator() },
        { path: "/platform/solo-workspaces", body: page([WORKSPACE]) },
      ]);
      renderWithProviders(<SoloWorkspacesPage />);
      const table = await screen.findByRole("table");

      expect(within(table).getByText("Д.Сараа").closest("tr")).not.toHaveTextContent("идэвхгүй");
    });
  });

  /*
   * ★ A solo teacher locked out has nobody above them but the operator —
   * 2026-10-14, the user.
   */
  it("issues a solo teacher a password-reset link from «⋯», once checked", async () => {
    const user = userEvent.setup();
    const RESET = `/platform/solo-workspaces/${SOLO_ID}/password-reset`;
    const api = stubApi([
      { path: RESET, method: "POST", body: { resetToken: "tok-solo" } },
      { path: "/auth/me", body: operator() },
      { path: "/platform/solo-workspaces", body: page([WORKSPACE]) },
    ]);
    renderWithProviders(<SoloWorkspacesPage />);

    await user.click(await screen.findByRole("button", { name: "Д.Сараа — үйлдэл" }));
    await user.click(screen.getByRole("menuitem", { name: "Нууц үг сэргээх" }));
    const dialog = await screen.findByRole("dialog", { name: "Нууц үг сэргээх" });
    expect(within(dialog).getByRole("button", { name: "Холбоос үүсгэх" })).toBeDisabled();
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "Холбоос үүсгэх" }));

    await waitFor(() => expect(api.calls.find((call) => call.url === RESET)?.method).toBe("POST"));
    expect(
      await screen.findByRole("dialog", { name: "Нууц үг сэргээх холбоос" }),
    ).toHaveTextContent("/reset-password/tok-solo");
  });
});

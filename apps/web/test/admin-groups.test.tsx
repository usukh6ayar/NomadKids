import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  selectOption,
  sessionFor,
  setSearchParams,
  stubApi,
} from "./support/render";
import AdminGroupsPage from "@/app/(app)/admin/groups/page";

/**
 * Managing an existing group — `PATCH /groups/:id` and `DELETE /groups/:id`.
 *
 * ★ The two operations look alike and are not alike, which is the whole reason
 * this file is careful about which control does what.
 *
 * `PATCH { status: "ARCHIVED" | "ACTIVE" }` is a flag the row keeps: the group
 * stays in every listing, keeps its children, and flips back with one press.
 * `DELETE` runs `archiveGroup`, which sets `deletedAt` — after which
 * `baseWhere` hides the row from every query in the product and no endpoint
 * restores it. So the first is a toggle with no confirmation and the second is
 * confirmed, and these assert that the screen keeps them apart.
 *
 * ★★ `DELETE` also refuses while children are enrolled, with a 409 whose
 * message names the count and says what to do. That message is the instruction,
 * so it has to survive on screen rather than pass in a toast.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";
const YEAR = "55555555-5555-4555-8555-555555555555";

function group(over: Record<string, unknown> = {}) {
  return {
    id: GROUP,
    name: "Дунд бүлэг",
    ageBand: "JUNIOR",
    kindergartenId: KG,
    schoolYearId: YEAR,
    status: "ACTIVE",
    schoolYear: { id: YEAR, name: "2026-2027", isCurrent: true },
    _count: { enrollments: 0 },
    photoMediaFileId: null,
    ...over,
  };
}

function stubGroups(over: Record<string, unknown> = {}, extra: Parameters<typeof stubApi>[0] = []) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    ...extra,
    {
      path: "/groups",
      body: { items: [group(over)], page: 1, pageSize: 20, total: 1, totalPages: 1 },
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

/**
 * Promoting a whole group — Order А/261, Annex 2 §1 item 9, mandatory.
 *
 * ★ The two outcomes are decided by a field the director is not looking at.
 *
 * `POST /groups/:id/promotions` derives дэвшсэн or давтан суралцсан from the two
 * groups\' age bands, so a director picking a target from a dropdown is choosing
 * between them without being asked which they meant. The dialog says which it
 * will be before they commit, and these hold that sentence to the bands rather
 * than to whichever branch was written first.
 */
describe("бүлгээр дэвшүүлэх", () => {
  const NEXT = "66666666-6666-4666-8666-666666666666";
  const NEXT_YEAR = "77777777-7777-4777-8777-777777777777";

  /** The source group with children in it, plus one target group. */
  function stubTwoGroups(
    targetOver: Record<string, unknown> = {},
    extra: Parameters<typeof stubApi>[0] = [],
  ) {
    const source = group({ _count: { enrollments: 12 } });
    const target = {
      ...group(),
      id: NEXT,
      name: "Бэлтгэл бүлэг",
      ageBand: "SENIOR",
      schoolYearId: NEXT_YEAR,
      schoolYear: { id: NEXT_YEAR, name: "2027-2028", isCurrent: false },
      ...targetOver,
    };

    return stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      ...extra,
      {
        path: "/groups",
        body: { items: [source, target], page: 1, pageSize: 20, total: 2, totalPages: 1 },
      },
    ]);
  }

  it("offers the action on a group that has children", async () => {
    stubTwoGroups();
    renderWithProviders(<AdminGroupsPage />);

    const u = userEvent.setup();
    const entries = await openRowMenu(u);
    expect(entries.map((e) => e.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Бүлгээр дэвшүүлэх")]),
    );
  });

  /**
   * An empty group has nobody to promote and the API answers 400. The screen
   * refuses first, so the director never meets that error.
   *
   * ★ Omitted rather than disabled, since the controls became a menu.
   * `RowMenuItem` has no disabled state on purpose — an entry that cannot be
   * chosen is a line to read and then be refused by. It returns the moment a
   * child is enrolled, which the test above covers.
   */
  it("omits the action on an empty group", async () => {
    stubGroups({ _count: { enrollments: 0 } });
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    const entries = await openRowMenu(u);
    expect(entries.map((e) => e.textContent ?? "").join(" ")).not.toContain("Бүлгээр дэвшүүлэх");
  });

  it("says the move will be recorded as a promotion when the bands differ", async () => {
    stubTwoGroups();
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /Бүлгээр дэвшүүлэх/);
    await selectOption(u, /Хүлээн авах бүлэг/, /Бэлтгэл бүлэг/);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/дэвшсэн/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/давтан суралцсан/)).toBeNull();
  });

  it("says давтан суралцсан when the target carries the same band", async () => {
    // JUNIOR, the same band the source group has.
    stubTwoGroups({ ageBand: "JUNIOR" });
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /Бүлгээр дэвшүүлэх/);
    await selectOption(u, /Хүлээн авах бүлэг/, /Бэлтгэл бүлэг/);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/давтан суралцсан/)).toBeInTheDocument();
  });

  it("posts the target group and nothing else", async () => {
    const { calls } = stubTwoGroups({}, [
      {
        path: `/groups/${GROUP}/promotions`,
        method: "POST",
        body: { outcome: "PROMOTED", movedCount: 12, groupId: NEXT },
      },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /Бүлгээр дэвшүүлэх/);
    await selectOption(u, /Хүлээн авах бүлэг/, /Бэлтгэл бүлэг/);
    const dialog = await screen.findByRole("dialog");
    await u.click(within(dialog).getByRole("button", { name: "Дэвшүүлэх" }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST");
      expect(post).toBeDefined();
      expect(post!.url).toBe(`/groups/${GROUP}/promotions`);
      // ★ No `outcome`. The server derives it; a client that sent its own
      // answer would be a second source of the same fact.
      expect(post!.body).toEqual({ toGroupId: NEXT });
    });
  });

  it("sends nothing until a target is chosen", async () => {
    const { calls } = stubTwoGroups();
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /Бүлгээр дэвшүүлэх/);
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByRole("button", { name: "Дэвшүүлэх" })).toBeDisabled();
    await u.click(within(dialog).getByRole("button", { name: "Болих" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  /**
   * ★ A kindergarten may name a group after its age band, and the demo data
   * does: SENIOR\'s label is "Бэлтгэл бүлэг" and so is the group\'s name. The
   * obvious option label renders it twice — "Бэлтгэл бүлэг · 2027-2028 ·
   * Бэлтгэл бүлэг" — which reads as a rendering fault. `GroupRow` already meets
   * this problem one screen away.
   */
  it("does not print the age band when it only repeats the name", async () => {
    stubTwoGroups();
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /Бүлгээр дэвшүүлэх/);
    await u.click(await screen.findByLabelText(/Хүлээн авах бүлэг/));

    const option = await screen.findByRole("option", { name: /Бэлтгэл бүлэг/ });
    expect(option).toHaveTextContent("Бэлтгэл бүлэг · 2027-2028");
    expect(option.textContent).not.toMatch(/Бэлтгэл бүлэг.*Бэлтгэл бүлэг/);
  });

  /** The school year survives, because it is what actually tells two candidate
   *  groups apart — a promotion targets next year\'s. */
  it("keeps a band that differs from the name", async () => {
    stubTwoGroups({ name: "Нар", ageBand: "SENIOR" });
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /Бүлгээр дэвшүүлэх/);
    await u.click(await screen.findByLabelText(/Хүлээн авах бүлэг/));

    expect(await screen.findByRole("option", { name: /Нар/ })).toHaveTextContent(
      "Нар · 2027-2028 · Бэлтгэл бүлэг",
    );
  });

  /** The source group must not be offered as its own target — the API returns
   *  400 for it, and the list it is drawn from contains it. */
  it("does not offer the group itself as the target", async () => {
    stubTwoGroups();
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /Бүлгээр дэвшүүлэх/);
    await u.click(await screen.findByLabelText(/Хүлээн авах бүлэг/));

    expect(await screen.findByRole("option", { name: /Бэлтгэл бүлэг/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Дунд бүлэг/ })).toBeNull();
  });
});

describe("бүлэг засах", () => {
  it("renders an edit action per group", async () => {
    stubGroups();
    renderWithProviders(<AdminGroupsPage />);

    const u = userEvent.setup();
    const entries = await openRowMenu(u);
    expect(entries.map((e) => e.textContent ?? "").join(" ")).toContain("Засах");
  });

  it("prefills the name and age band", async () => {
    stubGroups();
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /^Засах/);
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText(/Бүлгийн нэр/)).toHaveValue("Дунд бүлэг");
    expect(within(dialog).getByText("Дунд бүлэг", { selector: "span" })).toBeInTheDocument();
  });

  it("cancelling sends nothing", async () => {
    const { calls } = stubGroups();
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /^Засах/);
    await u.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Болих" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  /**
   * ★ The four fields `updateGroupSchema` accepts, and no others.
   *
   * `status` has its own control and `schoolYearId` is not in the DTO at all.
   * `programKind` and `attendanceForm` joined the form for Order А/261, Annex 2
   * §1 items 6, 14 and 16, and they are sent on every save — the dialog re-seeds
   * from the row on open, so an unchanged group posts back what it already had
   * rather than silently resetting to the default.
   */
  it("sends only the fields the DTO accepts", async () => {
    const { calls } = stubGroups({}, [
      { path: `/groups/${GROUP}`, method: "PATCH", body: group({ name: "Бэлтгэл" }) },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /^Засах/);
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText(/Бүлгийн нэр/);
    await u.clear(name);
    await u.type(name, "Бэлтгэл");
    await u.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => {
      const patch = calls.find((c) => c.method === "PATCH");
      expect(patch).toBeDefined();
      expect(patch!.url).toBe(`/groups/${GROUP}`);
      expect(patch!.body).toEqual({
        name: "Бэлтгэл",
        ageBand: "JUNIOR",
        programKind: "MAIN",
        attendanceForm: "STANDARD",
      });
    });
  });

  it("submits a changed age band", async () => {
    const { calls } = stubGroups({}, [
      { path: `/groups/${GROUP}`, method: "PATCH", body: group({ ageBand: "SENIOR" }) },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /^Засах/);
    await selectOption(u, /Насны бүлэг/, "Бэлтгэл бүлэг");
    await u.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Хадгалах" }),
    );

    await waitFor(() =>
      expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ ageBand: "SENIOR" }),
    );
  });

  it("refetches and confirms with a toast", async () => {
    const { calls } = stubGroups({}, [
      { path: `/groups/${GROUP}`, method: "PATCH", body: group() },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /^Засах/);
    await u.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Хадгалах" }),
    );

    await waitFor(() =>
      expect(
        calls.filter((c) => c.method === "GET" && c.url.startsWith("/groups")).length,
      ).toBeGreaterThan(1),
    );
    expect(await screen.findByText(/хадгалагдлаа/)).toBeInTheDocument();
  });

  it("puts a field validation error under its field and keeps the dialog open", async () => {
    stubGroups({}, [
      {
        path: `/groups/${GROUP}`,
        method: "PATCH",
        status: 400,
        body: {
          type: "about:blank",
          title: "Мэдээлэл буруу байна",
          status: 400,
          requestId: "test",
          errors: { name: ["Бүлгийн нэрийг оруулна уу"] },
          detail: "Бүлгийн нэрийг оруулна уу",
        },
      },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /^Засах/);
    const dialog = await screen.findByRole("dialog");
    await u.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    expect(await within(dialog).findByText("Бүлгийн нэрийг оруулна уу")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("архивлах ба сэргээх", () => {
  /** ★ Reversible, so no confirmation — the same rule that keeps a prompt off
   *  assessment publish. The one-way delete is the one that asks. */
  it("archives with a single press and no confirmation", async () => {
    const { calls } = stubGroups({}, [
      { path: `/groups/${GROUP}`, method: "PATCH", body: group({ status: "ARCHIVED" }) },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /^Архивлах/);

    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => {
      const patch = calls.find((c) => c.method === "PATCH");
      expect(patch!.url).toBe(`/groups/${GROUP}`);
      expect(patch!.body).toEqual({ status: "ARCHIVED" });
    });
    expect(await screen.findByText(/архивлагдлаа/)).toBeInTheDocument();
  });

  it("shows an archived group as archived, and offers to restore it", async () => {
    stubGroups({ status: "ARCHIVED" });
    renderWithProviders(<AdminGroupsPage />);

    const u = userEvent.setup();
    expect(await screen.findByText("Архивласан")).toBeInTheDocument();
    const entries = await openRowMenu(u);
    const names = entries.map((e) => e.textContent ?? "").join(" ");
    expect(names).toContain("Сэргээх");
    expect(names).not.toContain("Архивлах");
  });

  /** ★★ The backend takes `status` both ways, so the UI must not be one-way. */
  it("restores by sending status ACTIVE", async () => {
    const { calls } = stubGroups({ status: "ARCHIVED" }, [
      { path: `/groups/${GROUP}`, method: "PATCH", body: group({ status: "ACTIVE" }) },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /^Сэргээх/);

    await waitFor(() =>
      expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ status: "ACTIVE" }),
    );
    expect(await screen.findByText(/сэргээгдлээ/)).toBeInTheDocument();
  });

  /**
   * ★ A toast since 2026-09-06, where this was an inline message beside the
   * archive button.
   *
   * The row's controls are one overflow menu, which closes when an entry is
   * chosen — so there is no longer a control for a message to sit beside. What
   * must not change is that a failed archive is *reported*: a mutation that
   * silently does nothing is the state this test exists to prevent.
   */
  it("reports an archive failure", async () => {
    stubGroups({}, [
      {
        path: `/groups/${GROUP}`,
        method: "PATCH",
        status: 500,
        body: { type: "about:blank", title: "Алдаа", status: 500, requestId: "test" },
      },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /^Архивлах/);
    expect(await screen.findByText(/Алдаа|дахин/i)).toBeInTheDocument();
  });
});

describe("бүлгийг устгах", () => {
  it("confirms before deleting, and says archiving is the reversible option", async () => {
    stubGroups();
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /^Устгах/);
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText(/Буцаах боломжгүй/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Архивлах/)).toBeInTheDocument();
  });

  it("cancelling sends no DELETE", async () => {
    const { calls } = stubGroups();
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /^Устгах/);
    await u.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Болих" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("confirming sends exactly one DELETE and confirms with a toast", async () => {
    const { calls } = stubGroups({}, [
      { path: `/groups/${GROUP}`, method: "DELETE", body: group() },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /^Устгах/);
    await u.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Устгах" }),
    );

    await waitFor(() => {
      const deletes = calls.filter((c) => c.method === "DELETE");
      expect(deletes).toHaveLength(1);
      expect(deletes[0]!.url).toBe(`/groups/${GROUP}`);
    });
    expect(await screen.findByText(/устгагдлаа/)).toBeInTheDocument();
  });

  /**
   * ★ The enrolment rule is the backend's, and it is preserved rather than
   * bypassed. The disabled button is a courtesy — the count in the list can be
   * stale, so the server is still the one that decides.
   */
  /**
   * ★ Warned rather than disabled, since the controls became a menu.
   *
   * The button carried the reason in a `title` — a tooltip a touch screen never
   * shows — and was disabled from a count the list may have fetched minutes
   * ago. The entry now states the condition on its own second line and the
   * server still decides, which is the arrangement the note below always
   * described: "the disabled button is a courtesy — the count in the list can
   * be stale".
   */
  it("warns that enrolled children block a delete, and still offers archiving", async () => {
    stubGroups({ _count: { enrollments: 12 } });
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    const names = (await openRowMenu(u)).map((e) => e.textContent ?? "").join(" ");
    expect(names).toContain("Эхлээд хүүхдүүдийг шилжүүлнэ");
    // Archiving is still available — it has no enrolment guard.
    expect(names).toContain("Архивлах");
  });

  /** ★★ The 409 names the count and says what to do next, so it stays on the
   *  page instead of disappearing on a timer. */
  /**
   * ★★ The 409 names the count and says what to do next, and it is a toast
   * since 2026-09-06 — see `DeleteGroupDialog`'s own note.
   *
   * It was an inline message beside the delete button, kept there deliberately
   * so an instruction would not slide away on a timer. Two things took that
   * place away: the row's controls became one overflow menu, and
   * `ConfirmDialog` closes on both outcomes by design. What this still pins is
   * the part that matters — the server's sentence reaches the reader **verbatim**
   * rather than as a generic failure, and a refused delete never reports success.
   */
  it("reports the enrolment conflict with the server's own instruction", async () => {
    stubGroups({}, [
      {
        path: `/groups/${GROUP}`,
        method: "DELETE",
        status: 409,
        body: {
          type: "about:blank",
          title: "Зөрчил",
          detail: "Энэ бүлэгт 12 хүүхэд бүртгэлтэй байна. Эхлээд тэднийг өөр бүлэгт шилжүүлнэ үү.",
          status: 409,
          requestId: "test",
        },
      },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /^Устгах/);
    await u.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Устгах" }),
    );

    expect(await screen.findByText(/өөр бүлэгт шилжүүлнэ үү/)).toBeInTheDocument();
    // And it is not reported as a success.
    expect(screen.queryByText(/устгагдлаа/)).toBeNull();
  });
});

describe("эрх", () => {
  /** `RequireRole roles={["ADMIN"]}` gates the whole screen; a teacher never
   *  reaches any of these controls. */
  it("keeps a teacher off the screen entirely", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/groups",
        body: { items: [group()], page: 1, pageSize: 20, total: 1, totalPages: 1 },
      },
    ]);
    renderWithProviders(<AdminGroupsPage />);

    await waitFor(() => expect(screen.queryByRole("button", { name: /— засах/ })).toBeNull());
    expect(screen.queryByRole("button", { name: /архивлах/i })).toBeNull();
  });
});

/**
 * Дэвшүүлэх — everyone, or a chosen few (2026-09-04).
 *
 * ★ The two modes are different *requests*, not the same one with a fuller list.
 *
 * Omitting `childIds` means "every active enrolment at the moment the server
 * runs"; sending ids fixes the set at what this dialog had loaded. Those differ
 * if a child is enrolled in between, and the first is the honest reading of
 * "бүлгээр дэвшүүлэх". These hold that distinction, because the tempting
 * simplification — always send ids, ticked by default — looks identical on
 * screen and is not the same call.
 */
/**
 * Opens a row's "⋯" menu and chooses an entry.
 *
 * ★ Every control on this row moved behind one menu on 2026-09-06, at the
 * client's request — "тэр ард нь баахан шаваарлалдсан icon-той дардаг хэсэг".
 *
 * What these tests pin is unchanged: the dialogs, the request bodies, the
 * enrolment guard and the error handling. Only reaching them costs a click, so
 * that is one helper rather than a rewritten expectation in twenty places.
 *
 * `name` picks a row when the fixture renders more than one.
 */
async function rowAction(
  u: ReturnType<typeof userEvent.setup>,
  label: string | RegExp,
  name = "Дунд бүлэг",
) {
  await u.click(await screen.findByRole("button", { name: `${name} — үйлдэл` }));
  await u.click(await screen.findByRole("menuitem", { name: label }));
}

/** The entries a row's menu offers, without choosing any of them. */
async function openRowMenu(u: ReturnType<typeof userEvent.setup>, name = "Дунд бүлэг") {
  await u.click(await screen.findByRole("button", { name: `${name} — үйлдэл` }));
  return screen.findAllByRole("menuitem");
}

describe("дэвшүүлэх — бүгд эсвэл сонгосон", () => {
  const NEXT = "66666666-6666-4666-8666-666666666666";

  function stubForPromotion(extra: Parameters<typeof stubApi>[0] = []) {
    const source = group({ _count: { enrollments: 2 } });
    const target = { ...group(), id: NEXT, name: "Бэлтгэл бүлэг", ageBand: "SENIOR" };

    return stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      ...extra,
      {
        path: "/groups",
        body: { items: [source, target], page: 1, pageSize: 20, total: 2, totalPages: 1 },
      },
    ]);
  }

  it("sends no childIds when the whole group is promoted", async () => {
    const u = userEvent.setup();
    const { calls } = stubForPromotion([
      {
        path: "/groups/" + GROUP + "/promotions",
        method: "POST",
        body: { outcome: "PROMOTED", movedCount: 2 },
      },
    ]);
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /Бүлгээр дэвшүүлэх/);
    await selectOption(u, /Хүлээн авах бүлэг/, /Бэлтгэл бүлэг/);

    const dialog = await screen.findByRole("dialog");
    await u.click(within(dialog).getByRole("button", { name: "Дэвшүүлэх" }));

    await waitFor(() => {
      const posted = calls.find((c) => c.method === "POST" && c.url.includes("/promotions"));
      expect(posted).toBeTruthy();
      // ★ The whole assertion: no `childIds` key at all, not an empty array and
      // not every id.
      expect(posted!.body).toEqual({ toGroupId: NEXT });
    });
  });

  /** The roster stays out of the way until somebody asks to choose. */
  it("shows the roster only once «Сонгосон хүүхдүүд» is picked", async () => {
    const u = userEvent.setup();
    stubForPromotion();
    renderWithProviders(<AdminGroupsPage />);

    await rowAction(u, /Бүлгээр дэвшүүлэх/);
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).queryByText(/сонгосон$/)).toBeNull();

    await u.click(within(dialog).getByLabelText("Сонгосон хүүхдүүд"));
    expect(await within(dialog).findByText(/сонгосон$/)).toBeInTheDocument();
  });
});

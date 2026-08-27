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

describe("бүлэг засах", () => {
  it("renders an edit action per group", async () => {
    stubGroups();
    renderWithProviders(<AdminGroupsPage />);

    expect(await screen.findByRole("button", { name: "Засах" })).toBeInTheDocument();
  });

  it("prefills the name and age band", async () => {
    stubGroups();
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await u.click(await screen.findByRole("button", { name: "Засах" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText(/Бүлгийн нэр/)).toHaveValue("Дунд бүлэг");
    expect(within(dialog).getByText("Дунд бүлэг", { selector: "span" })).toBeInTheDocument();
  });

  it("cancelling sends nothing", async () => {
    const { calls } = stubGroups();
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await u.click(await screen.findByRole("button", { name: "Засах" }));
    await u.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Болих" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  /** ★ `name` and `ageBand` only. `status` has its own control, and
   *  `schoolYearId` is not in `updateGroupSchema` at all. */
  it("sends only the fields the DTO accepts", async () => {
    const { calls } = stubGroups({}, [
      { path: `/groups/${GROUP}`, method: "PATCH", body: group({ name: "Бэлтгэл" }) },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await u.click(await screen.findByRole("button", { name: "Засах" }));
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText(/Бүлгийн нэр/);
    await u.clear(name);
    await u.type(name, "Бэлтгэл");
    await u.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => {
      const patch = calls.find((c) => c.method === "PATCH");
      expect(patch).toBeDefined();
      expect(patch!.url).toBe(`/groups/${GROUP}`);
      expect(patch!.body).toEqual({ name: "Бэлтгэл", ageBand: "JUNIOR" });
    });
  });

  it("submits a changed age band", async () => {
    const { calls } = stubGroups({}, [
      { path: `/groups/${GROUP}`, method: "PATCH", body: group({ ageBand: "SENIOR" }) },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await u.click(await screen.findByRole("button", { name: "Засах" }));
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

    await u.click(await screen.findByRole("button", { name: "Засах" }));
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

    await u.click(await screen.findByRole("button", { name: "Засах" }));
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

    await u.click(await screen.findByRole("button", { name: /Архивлах/ }));

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

    expect(await screen.findByText("Архивласан")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Сэргээх/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Архивлах/ })).toBeNull();
  });

  /** ★★ The backend takes `status` both ways, so the UI must not be one-way. */
  it("restores by sending status ACTIVE", async () => {
    const { calls } = stubGroups({ status: "ARCHIVED" }, [
      { path: `/groups/${GROUP}`, method: "PATCH", body: group({ status: "ACTIVE" }) },
    ]);
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await u.click(await screen.findByRole("button", { name: /Сэргээх/ }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ status: "ACTIVE" }),
    );
    expect(await screen.findByText(/сэргээгдлээ/)).toBeInTheDocument();
  });

  it("keeps an archive failure visible on the row", async () => {
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

    await u.click(await screen.findByRole("button", { name: /Архивлах/ }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("бүлгийг устгах", () => {
  it("confirms before deleting, and says archiving is the reversible option", async () => {
    stubGroups();
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await u.click(await screen.findByRole("button", { name: "Дунд бүлэг — устгах" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText(/Буцаах боломжгүй/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Архивлах/)).toBeInTheDocument();
  });

  it("cancelling sends no DELETE", async () => {
    const { calls } = stubGroups();
    const u = userEvent.setup();
    renderWithProviders(<AdminGroupsPage />);

    await u.click(await screen.findByRole("button", { name: "Дунд бүлэг — устгах" }));
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

    await u.click(await screen.findByRole("button", { name: "Дунд бүлэг — устгах" }));
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
  it("disables delete while the list shows enrolled children", async () => {
    stubGroups({ _count: { enrollments: 12 } });
    renderWithProviders(<AdminGroupsPage />);

    expect(await screen.findByRole("button", { name: "Дунд бүлэг — устгах" })).toBeDisabled();
    // Archiving is still available — it has no enrolment guard.
    expect(screen.getByRole("button", { name: /Архивлах/ })).toBeEnabled();
  });

  /** ★★ The 409 names the count and says what to do next, so it stays on the
   *  page instead of disappearing on a timer. */
  it("leaves the enrolment conflict on screen as an actionable message", async () => {
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

    await u.click(await screen.findByRole("button", { name: "Дунд бүлэг — устгах" }));
    await u.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Устгах" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/өөр бүлэгт шилжүүлнэ үү/);
    // Not swallowed by a toast that would take the instruction away.
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

    await waitFor(() => expect(screen.queryByRole("button", { name: "Засах" })).toBeNull());
    expect(screen.queryByRole("button", { name: /Архивлах/ })).toBeNull();
  });
});

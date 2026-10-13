import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, selectOption, sessionFor, stubApi } from "./support/render";
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

describe("the operator's solo workspaces", () => {
  it("previews the merge, then merges into the chosen kindergarten", async () => {
    const user = userEvent.setup();
    const api = stub({ ok: true, result: RESULT, targetGroups: TARGET_GROUPS });
    renderWithProviders(<SoloWorkspacesPage />);

    expect(await screen.findByText(/Ажилладаг: Нарлаг цэцэрлэг · 4 хүүхэд/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Цэцэрлэгт нэгтгэх" }));
    const dialog = await screen.findByRole("dialog");
    const merge = within(dialog).getByRole("button", { name: "Нэгтгэх" });
    expect(merge).toBeDisabled();

    await selectOption(user, /Цэцэрлэг/, "Нарлаг цэцэрлэг");
    await user.click(within(dialog).getByRole("button", { name: "Урьдчилан харах" }));
    expect(await within(dialog).findByText("Хүүхэд: 4")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/«Миний бүлэг» бүлэг «Миний бүлэг \(бие даасан\)»/),
    ).toBeInTheDocument();

    await user.click(merge);
    await waitFor(() =>
      expect(api.calls.find((c) => c.url.endsWith("/merge"))?.body).toEqual({
        targetKindergartenId: TARGET_ID,
      }),
    );
  });

  it("names a child matching two of the kindergarten's children, and keeps «Нэгтгэх» off", async () => {
    const user = userEvent.setup();
    stub({
      ok: false,
      refusal: { kind: "ambiguous", children: [{ soloChildId: SOLO_ID, name: "Дорж Тэмүүлэн" }] },
      targetGroups: TARGET_GROUPS,
    });
    renderWithProviders(<SoloWorkspacesPage />);

    await user.click(await screen.findByRole("button", { name: "Цэцэрлэгт нэгтгэх" }));
    const dialog = await screen.findByRole("dialog");
    await selectOption(user, /Цэцэрлэг/, "Нарлаг цэцэрлэг");
    await user.click(within(dialog).getByRole("button", { name: "Урьдчилан харах" }));

    expect(await within(dialog).findByText(/Дорж Тэмүүлэн/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Нэгтгэх" })).toBeDisabled();
  });

  it("merges into a chosen group, leaving a matched child separate, only after a fresh preview", async () => {
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

    await user.click(await screen.findByRole("button", { name: "Цэцэрлэгт нэгтгэх" }));
    const dialog = await screen.findByRole("dialog");
    await selectOption(user, /Цэцэрлэг/, "Нарлаг цэцэрлэг");
    await user.click(within(dialog).getByRole("button", { name: "Урьдчилан харах" }));
    expect(await within(dialog).findByText(/бичлэгт нэгтгэгдэх хүүхэд: 1/)).toBeInTheDocument();

    await selectOption(user, /^Бүлэг/, "Нарлаг бүлэг бүлэгт нэгтгэх");
    await user.click(within(dialog).getByLabelText(/Дорж Тэмүүлэн — тусад нь үлдээх/));
    const merge = within(dialog).getByRole("button", { name: "Нэгтгэх" });
    expect(merge).toBeDisabled();

    await user.click(within(dialog).getByRole("button", { name: "Урьдчилан харах" }));
    await waitFor(() => expect(merge).toBeEnabled());
    await user.click(merge);
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

    await user.click(await screen.findByRole("button", { name: "Цэцэрлэгт нэгтгэх" }));
    const dialog = await screen.findByRole("dialog");
    await selectOption(user, /Цэцэрлэг/, "Нарлаг цэцэрлэг");
    await user.click(within(dialog).getByRole("button", { name: "Урьдчилан харах" }));

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
});

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
};

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
    const api = stub({ ok: true, result: RESULT });
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

  it("says which children are already on the kindergarten's roll, and keeps «Нэгтгэх» off", async () => {
    const user = userEvent.setup();
    stub({
      ok: false,
      refusal: {
        kind: "duplicates",
        children: [{ soloChildId: SOLO_ID, targetChildId: TARGET_ID, name: "Дорж Тэмүүлэн" }],
      },
    });
    renderWithProviders(<SoloWorkspacesPage />);

    await user.click(await screen.findByRole("button", { name: "Цэцэрлэгт нэгтгэх" }));
    const dialog = await screen.findByRole("dialog");
    await selectOption(user, /Цэцэрлэг/, "Нарлаг цэцэрлэг");
    await user.click(within(dialog).getByRole("button", { name: "Урьдчилан харах" }));

    expect(await within(dialog).findByText(/Дорж Тэмүүлэн/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Нэгтгэх" })).toBeDisabled();
  });
});

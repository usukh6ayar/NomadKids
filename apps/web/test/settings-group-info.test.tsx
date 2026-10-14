import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  selectOption,
  sessionFor,
  stubApi,
  type RouteStub,
} from "./support/render";
import { GroupInfoCard } from "@/components/settings/group-info-card";

/*
 * ★ «Бүлгийн мэдээлэл» in a teacher's «Хувийн тохиргоо» — 2026-10-14, the
 * user: the name, the kind, how many children, boys and girls — counted from
 * the roster. ESIS pulls it where the kindergarten has ESIS; elsewhere it is
 * filled in by hand.
 */
afterEach(() => vi.unstubAllGlobals());

/** The kindergarten `sessionFor` puts on every membership. */
const KINDERGARTEN_ID = "33333333-3333-4333-8333-333333333333";
const GROUP_ID = "55555555-5555-4555-8555-555555555555";

const GROUP = {
  id: GROUP_ID,
  name: "Миний бүлэг",
  ageBand: "MIDDLE",
  kindergartenId: KINDERGARTEN_ID,
  schoolYearId: null,
};

const roster = (sexes: string[]) => ({
  items: sexes.map((sex, index) => ({ id: `c${index}`, sex })),
  page: 1,
  pageSize: 100,
  total: sexes.length,
  totalPages: 1,
});

function renderCard(
  roles: Parameters<typeof sessionFor>[0],
  esisInstitutionId: string | null,
  extra: RouteStub[] = [],
) {
  const api = stubApi([
    ...extra,
    { path: "/auth/me", body: sessionFor(roles) },
    { path: `/kindergartens/${KINDERGARTEN_ID}`, body: { esisInstitutionId } },
    {
      path: "/groups",
      body: { items: [GROUP], page: 1, pageSize: 20, total: 1, totalPages: 1 },
    },
    { path: "/children", body: roster(["MALE", "MALE", "FEMALE"]) },
  ]);
  renderWithProviders(<GroupInfoCard />);
  return api;
}

describe("a teacher's group in the settings", () => {
  it("shows the name, the kind, and boys and girls counted from the roster", async () => {
    renderCard(["TEACHER"], null);

    expect(await screen.findByText("Бүлгийн мэдээлэл")).toBeInTheDocument();
    expect(screen.getByText("Миний бүлэг")).toBeInTheDocument();
    expect(screen.getByText("Ахлах бүлэг")).toBeInTheDocument();
    const row = (label: string) => screen.getByText(label).parentElement!;
    await waitFor(() => expect(row("Хүүхдийн тоо")).toHaveTextContent("3 хүүхэд"));
    expect(row("Эрэгтэй")).toHaveTextContent("2 хүүхэд");
    expect(row("Эмэгтэй")).toHaveTextContent("1 хүүхэд");
  });

  it("fills it in by hand without ESIS, «Холимог» among the kinds", async () => {
    const user = userEvent.setup();
    const api = renderCard(["ADMIN", "TEACHER"], null, [
      { path: `/groups/${GROUP_ID}`, method: "PATCH", body: {} },
    ]);

    await user.click(await screen.findByRole("button", { name: "Засах" }));
    const dialog = await screen.findByRole("dialog", { name: "Бүлгийн мэдээлэл засах" });
    expect(screen.queryByRole("button", { name: "ESIS татах" })).toBeNull();
    await user.clear(within(dialog).getByLabelText(/Бүлгийн нэр/));
    await user.type(within(dialog).getByLabelText(/Бүлгийн нэр/), "Нарлаг");
    await selectOption(user, "Бүлгийн төрөл", "Холимог бүлэг");
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() =>
      expect(
        api.calls.find((c) => c.method === "PATCH" && c.url === `/groups/${GROUP_ID}`)?.body,
      ).toEqual({ name: "Нарлаг", ageBand: "MIXED" }),
    );
  });

  it("says plainly when only the director may change it", async () => {
    const user = userEvent.setup();
    renderCard(["TEACHER"], null, [
      { path: `/groups/${GROUP_ID}`, method: "PATCH", status: 403, body: {} },
    ]);

    await user.click(await screen.findByRole("button", { name: "Засах" }));
    const dialog = await screen.findByRole("dialog", { name: "Бүлгийн мэдээлэл засах" });
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));
    expect(
      await within(dialog).findByText("Бүлгийн мэдээллийг одоогоор зөвхөн эрхлэгч засна."),
    ).toBeInTheDocument();
  });

  it("pulls it from ESIS where the kindergarten has ESIS", async () => {
    const user = userEvent.setup();
    const api = renderCard(["ADMIN", "TEACHER"], "esis-1", [
      {
        path: `/kindergartens/${KINDERGARTEN_ID}/esis/sync-groups`,
        method: "POST",
        body: {
          schoolYears: { created: 0, updated: 0 },
          groups: { created: 0, updated: 1 },
          warnings: [],
          syncedAt: "2026-10-14T00:00:00.000Z",
        },
      },
    ]);

    await user.click(await screen.findByRole("button", { name: "ESIS татах" }));
    expect(screen.queryByRole("button", { name: "Засах" })).toBeNull();
    await waitFor(() =>
      expect(
        api.calls.some(
          (c) =>
            c.method === "POST" && c.url === `/kindergartens/${KINDERGARTEN_ID}/esis/sync-groups`,
        ),
      ).toBe(true),
    );
  });

  it("shows nothing to a parent", async () => {
    renderCard(["PARENT"], null);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText("Бүлгийн мэдээлэл")).toBeNull();
  });
});

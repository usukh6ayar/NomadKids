import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setPathname, stubApi } from "./support/render";
import AppLayout from "@/app/(app)/layout";

/**
 * The sidebar: brand, icons, active state, role and the way out.
 *
 * ★ Rendered through `AppLayout`, not through `AppShell` directly.
 *
 * The navigation is *derived* from the session — which sections a person sees,
 * and whether the admin entry exists at all, are decisions the layout makes
 * from their roles. Handing `AppShell` a fixed `nav` array would test the
 * chrome and skip the part that can actually be wrong.
 *
 * ★★ The icon assertions are the reason this file exists. Every section entry
 * shipped without one: `NavSection` had the field, `staffSections` passed it
 * for none of its eight links, and nothing failed — so the desktop sidebar was
 * eight bare text rows beside a fully illustrated bottom bar.
 */

const GROUPS = {
  items: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Дэлбээ бүлэг",
      ageBand: "MIDDLE",
      schoolYear: { id: "55555555-5555-4555-8555-555555555555", name: "2025-2026" },
      childCount: 18,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

function renderShell(roles: Parameters<typeof sessionFor>[0], pathname = "/dashboard") {
  setPathname(pathname);
  stubApi([
    { path: "/auth/me", body: sessionFor(roles) },
    { path: "/groups", body: GROUPS },
    { path: "/children/mine", body: [] },
    { path: "/notifications/unread-count", body: { count: 0 } },
  ]);

  return renderWithProviders(
    <AppLayout>
      <p>содержимое</p>
    </AppLayout>,
  );
}

/** The desktop sidebar, by its accessible name. */
async function sidebar(): Promise<HTMLElement> {
  return waitFor(() => screen.getByRole("navigation", { name: "Үндсэн цэс" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  setPathname("/");
});

// ═══════════════════════════════════════════════════════════════════════════
// Brand
// ═══════════════════════════════════════════════════════════════════════════

describe("the brand header", () => {
  it("renders the existing logo mark, named for a screen reader", async () => {
    renderShell(["TEACHER"]);
    const nav = await sidebar();

    const mark = within(nav).getByAltText("Бяцхан нүүдэлчид");
    expect(mark).toBeInTheDocument();
    // The asset that already ships — this task introduced no new logo file.
    expect(mark.getAttribute("src")).toContain("mark-96");
  });

  it("links the brand home", async () => {
    renderShell(["TEACHER"]);
    const nav = await sidebar();

    expect(within(nav).getByAltText("Бяцхан нүүдэлчид").closest("a")).toHaveAttribute("href", "/");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Icons — the gap this task closed
// ═══════════════════════════════════════════════════════════════════════════

describe("navigation icons", () => {
  it("gives every staff section entry an icon", async () => {
    renderShell(["TEACHER", "ADMIN"]);
    const nav = await sidebar();

    const entries = [
      "Хүүхдүүд",
      "Ажиглалт хянах",
      "Чөлөөний хүсэлт хянах",
      "Ангийн самбар / Мэдээ",
      "Судалгаа",
      "Баримт бичгийн сан",
      "Багшийн мэдээлэл",
      "Бүлэг, цэцэрлэгийн мэдээлэл",
    ];

    for (const label of entries) {
      const link = within(nav).getByRole("link", { name: label });
      // lucide renders an <svg>; a row without one is the old bare-text state.
      expect(link.querySelector("svg"), `${label} has no icon`).not.toBeNull();
    }
  });

  it("sizes section icons one step below the top level", async () => {
    renderShell(["TEACHER"]);
    const nav = await sidebar();

    const icon = within(nav).getByRole("link", { name: "Судалгаа" }).querySelector("svg")!;
    expect(icon.getAttribute("width")).toBe("18");
  });

  /*
   * ★ The property the route→icon map exists to guarantee.
   *
   * `/notifications` appears in the staff sections, the parent sections and
   * both bottom bars; `/settings` in three places. Before the map each call
   * site picked its own glyph and they had already drifted.
   */
  it("uses one icon per destination, wherever that destination appears", async () => {
    renderShell(["TEACHER"]);
    const nav = await sidebar();

    const paths = within(nav)
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href") === "/notifications");

    expect(paths.length).toBeGreaterThan(0);
    const names = new Set(
      paths.map((a) => a.querySelector("svg")?.getAttribute("class") ?? "none"),
    );
    expect(names.size).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Active state
// ═══════════════════════════════════════════════════════════════════════════

describe("the active route", () => {
  it("marks the current page and tints it, with more than colour", async () => {
    renderShell(["TEACHER"], "/surveys");
    const nav = await sidebar();

    const link = within(nav).getByRole("link", { name: "Судалгаа" });
    expect(link).toHaveAttribute("aria-current", "page");
    // Tint, weight and a rail — colour alone must not carry the state.
    expect(link.className).toContain("bg-primary-soft");
    expect(link.className).toContain("font-semibold");
  });

  it("leaves other entries unmarked", async () => {
    renderShell(["TEACHER"], "/surveys");
    const nav = await sidebar();

    expect(within(nav).getByRole("link", { name: "Хүүхдүүд" })).not.toHaveAttribute("aria-current");
  });

  it("treats a child route as inside its section entry", async () => {
    renderShell(["TEACHER"], "/documents/123");
    const nav = await sidebar();

    expect(within(nav).getByRole("link", { name: "Баримт бичгийн сан" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Role-based navigation
// ═══════════════════════════════════════════════════════════════════════════

describe("role-based navigation", () => {
  it("shows a teacher their sections and no admin entry", async () => {
    renderShell(["TEACHER"]);
    const nav = await sidebar();

    expect(within(nav).getByRole("link", { name: "Хүүхдүүд" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Ажиглалт хянах" })).toBeInTheDocument();
    expect(
      within(nav).queryByRole("link", { name: "Бүлэг, цэцэрлэгийн мэдээлэл" }),
    ).not.toBeInTheDocument();
  });

  it("adds the administration entry for an admin", async () => {
    renderShell(["TEACHER", "ADMIN"]);
    const nav = await sidebar();

    expect(
      within(nav).getByRole("link", { name: "Бүлэг, цэцэрлэгийн мэдээлэл" }),
    ).toBeInTheDocument();
  });

  it("gives a parent their own sections, not the staff ones", async () => {
    renderShell(["PARENT"], "/home");
    const nav = await sidebar();

    expect(within(nav).getByText("Хүүхдийн мэдээлэл")).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Ажиглалт хянах" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Баримт бичгийн сан" })).not.toBeInTheDocument();
  });

  /*
   * ★ Chat and finance are named but not offered.
   *
   * Both are in the parent menu as inert rows so the product describes what the
   * client was shown — an `<a href="/chat">` that 404s teaches someone the
   * product is broken. The assertion is that they are *not links*.
   */
  it("does not make unbuilt features clickable", async () => {
    renderShell(["PARENT"], "/home");
    const nav = await sidebar();

    expect(within(nav).getByText("Чат")).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: /Чат/ })).not.toBeInTheDocument();

    expect(within(nav).getByText("Санхүү")).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: /Санхүү/ })).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The footer
// ═══════════════════════════════════════════════════════════════════════════

describe("the sidebar footer", () => {
  it("names the teacher and the one group they are responsible for", async () => {
    renderShell(["TEACHER"]);
    const nav = await sidebar();

    await waitFor(() => expect(within(nav).getByText("Дэлбээ бүлэг")).toBeInTheDocument());
    expect(within(nav).getByText("Тест Хэрэглэгч")).toBeInTheDocument();
  });

  it("gives a teacher no group picker", async () => {
    renderShell(["TEACHER"]);
    const nav = await sidebar();

    await waitFor(() => expect(within(nav).getByText("Дэлбээ бүлэг")).toBeInTheDocument());
    // The product assigns one group; a switcher would invent a choice.
    expect(within(nav).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(nav).getByText("Дэлбээ бүлэг").closest("button")).toBeNull();
  });

  it("names an admin by role, never by one of the groups they oversee", async () => {
    renderShell(["TEACHER", "ADMIN"]);
    const nav = await sidebar();

    expect(within(nav).getByText("Админ")).toBeInTheDocument();
    // `GET /groups` returns every group to an admin; naming the first would
    // say they run one when they run all of them.
    expect(within(nav).queryByText("Дэлбээ бүлэг")).not.toBeInTheDocument();
  });

  it("names a parent by role", async () => {
    renderShell(["PARENT"], "/home");
    const nav = await sidebar();

    expect(within(nav).getByText("Эцэг эх")).toBeInTheDocument();
  });

  it("keeps settings and the way out reachable", async () => {
    renderShell(["TEACHER"]);
    const nav = await sidebar();

    // The identity block is the settings link — see the note in `WhoAmI`: a
    // third 44px control leaves a Mongolian name about 96px to live in.
    expect(within(nav).getByRole("link", { name: /Тест Хэрэглэгч — тохиргоо/ })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(within(nav).getByRole("button", { name: "Гарах" })).toBeInTheDocument();
  });

  it("truncates a long name rather than pushing the controls off the panel", async () => {
    renderShell(["TEACHER"]);
    const nav = await sidebar();

    expect(within(nav).getByText("Тест Хэрэглэгч").className).toContain("truncate");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Mobile
// ═══════════════════════════════════════════════════════════════════════════

describe("mobile navigation", () => {
  it("keeps the bottom bar, with the sidebar hidden below lg", async () => {
    renderShell(["TEACHER"]);

    const bar = await waitFor(() => screen.getByRole("navigation", { name: "Доод цэс" }));
    expect(bar).toBeInTheDocument();

    const nav = await sidebar();
    expect(nav.className).toContain("lg:flex");
    expect(nav.className).toContain("hidden");
  });

  it("uses the same destinations as the sidebar for the shared routes", async () => {
    renderShell(["TEACHER"]);

    const bar = await waitFor(() => screen.getByRole("navigation", { name: "Доод цэс" }));
    const hrefs = within(bar)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));

    // Both surfaces are built from one `nav` array, so this is a regression
    // guard on that staying true rather than an aspiration.
    expect(hrefs).toContain("/children");
    expect(hrefs).toContain("/notifications");
  });
});

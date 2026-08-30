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

/** A guardian's own child — the parent menu builds its rows from the first. */
const OWN_CHILD = {
  id: "66666666-6666-4666-8666-666666666666",
  lastName: "Батмөнх",
  firstName: "Тэмүүлэн",
  dateOfBirth: "2021-04-02",
  sex: "MALE",
  photoMediaFileId: null,
  group: null,
};

function renderShell(
  roles: Parameters<typeof sessionFor>[0],
  pathname = "/dashboard",
  /*
   * ★ Empty by default, because most cases here are about the staff menu and a
   * child would only add fetches. The parent cases that read the child's rows
   * pass one — without it `parentSections` correctly renders "Холбогдсон
   * хүүхэд алга" and there is nothing to assert against.
   */
  ownChildren: unknown[] = [],
) {
  setPathname(pathname);
  stubApi([
    { path: "/auth/me", body: sessionFor(roles) },
    { path: "/groups", body: GROUPS },
    { path: "/children/mine", body: ownChildren },
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

    /*
      The client's 2026-08-30 labels. "Үнэлгээ" is "Явцын үнэлгээ" and "Мэдээ"
      is "Ангийн самбар / Мэдээ" — both are the names on their drawing, and
      both now point at a landing page rather than at a group-scoped href.
    */
    const entries = [
      "Хүүхдүүд",
      "Явцын үнэлгээ",
      "Ирц",
      "Хоол ба цэс",
      "Ангийн самбар / Мэдээ",
      "Судалгаа",
      // Систем ба тохиргоо — the seven that were behind the hub, plus the hub
      "Удирдлага",
      "Цэцэрлэгийн мэдээлэл",
      "Хэрэглэгч ба эрх",
      "Хичээлийн жил",
      "Улирал",
      "Үнэлгээний тохиргоо",
      "Аудит",
      "Баримт бичгийн сан",
      "Багшийн мэдээлэл",
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
    expect(within(nav).getByRole("link", { name: "Ирц" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Удирдлага" })).not.toBeInTheDocument();
  });

  /**
   * ★ Two review queues left the menu on 2026-08-30 and kept their screens.
   *
   * Чөлөөний хүсэлт is rendered under the attendance day sheet, where approving
   * one writes the very rows that sheet is about; Ажиглалт хянах is reached
   * from the dashboard alert that counts what is waiting. A row that says
   * nothing about whether there is anything to review is a row somebody opens
   * to find out — which is what both of these were.
   */
  it("keeps the review queues out of the menu", async () => {
    renderShell(["TEACHER", "ADMIN"]);
    const nav = await sidebar();

    expect(within(nav).queryByRole("link", { name: "Ажиглалт хянах" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Чөлөөний хүсэлт" })).not.toBeInTheDocument();
  });

  /**
   * ★ Every administration destination is admin-only, not merely the hub.
   *
   * Surfacing the seven screens that used to sit behind "Удирдлага" made seven
   * new ways to show a teacher a row the API answers 404 to
   * (`TenantAccessService.assertAdmin`). One `queryByRole` per destination,
   * because a single spot-check would have passed while six others leaked.
   */
  it("hides every administration destination from a teacher", async () => {
    renderShell(["TEACHER"]);
    const nav = await sidebar();

    for (const label of [
      "Ирц ба тооцоолол",
      "Цэцэрлэгийн мэдээлэл",
      "Хэрэглэгч ба эрх",
      "Хичээлийн жил",
      "Улирал",
      "Үнэлгээний тохиргоо",
      "Аудит",
    ]) {
      expect(
        within(nav).queryByRole("link", { name: label }),
        `${label} is visible to a teacher`,
      ).not.toBeInTheDocument();
    }
  });

  /** The headings the staff menu groups the product by, per the 2026-08-29 drawing. */
  it("groups the staff menu into named sections", async () => {
    renderShell(["TEACHER", "ADMIN"]);
    const nav = await sidebar();

    expect(within(nav).getByText("Хүүхдийн хөгжил ба үнэлгээ")).toBeInTheDocument();
    expect(within(nav).getByText("Өдөр тутмын бүртгэл")).toBeInTheDocument();
    expect(within(nav).getByText("Харилцаа холбоо")).toBeInTheDocument();
    expect(within(nav).getByText("Багш ба байгууллага")).toBeInTheDocument();
  });

  /**
   * ★ The reason the seven rows were added: a hub row does not name what is
   * behind it, and "Улирал" was a word this menu never said.
   */
  it("names each administration screen rather than hiding it behind the hub", async () => {
    renderShell(["ADMIN"]);
    const nav = await sidebar();

    for (const [label, href] of [
      ["Цэцэрлэгийн мэдээлэл", "/admin/kindergarten"],
      ["Хэрэглэгч ба эрх", "/admin/users"],
      ["Хичээлийн жил", "/admin/school-years"],
      ["Улирал", "/admin/terms"],
      ["Үнэлгээний тохиргоо", "/admin/assessment-config"],
      ["Аудит", "/admin/audit"],
      ["Ирц ба тооцоолол", "/admin/funding"],
    ] as const) {
      expect(within(nav).getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("adds the administration entry for an admin", async () => {
    renderShell(["TEACHER", "ADMIN"]);
    const nav = await sidebar();

    expect(within(nav).getByRole("link", { name: "Удирдлага" })).toBeInTheDocument();
  });

  it("gives a parent their own sections, not the staff ones", async () => {
    renderShell(["PARENT"], "/home");
    const nav = await sidebar();

    expect(within(nav).getByText("Хүүхдийн мэдээлэл")).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Хүүхдүүд" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Баримт бичгийн сан" })).not.toBeInTheDocument();
  });

  /*
   * ★ Finance is named but not offered.
   *
   * It is in the parent menu as an inert row so the product describes what the
   * client was shown — an `<a href="/finance">` that 404s teaches someone the
   * product is broken. The assertion is that it is *not a link*.
   *
   * ★★ Chat used to be asserted here beside it, and is not any more.
   *
   * That pairing held while both were unbuilt. On 2026-08-29 CLAUDE.md §7 moved
   * chat into scope at the client's request and `AppShell` began rendering
   * `ChatWidget` on every screen for every role — so a parent has chat, from
   * anywhere, with an unread badge. A greyed row reading "удахгүй" beside a
   * working floating button is worse than either alone: it tells a family the
   * feature is missing while the feature waves from the corner of the same
   * page. The row is gone, and this asserts it stays gone rather than being
   * restored by someone reading the old comment.
   */
  /**
   * ★ There are no dead rows left anywhere in the product.
   *
   * The parent menu carried an inert "Санхүү" label — the reference's device
   * for naming a feature the build has not reached — and it was the last one
   * after `staffSections` was rewritten. Parent invoices are `нэмэлт.md`
   * §7–§10 and not started; a family reading grey text learns only that
   * something is missing.
   *
   * Чат is the other side of the same rule: built, and reachable from the
   * floating widget on every screen, so it is not a menu row at all.
   */
  it("leaves no unbuilt feature named in either menu", async () => {
    renderShell(["PARENT"], "/home");
    const nav = await sidebar();

    expect(within(nav).queryByText("Санхүү")).not.toBeInTheDocument();
    expect(within(nav).queryByText("Чат")).not.toBeInTheDocument();
    expect(within(nav).queryByText("удахгүй")).not.toBeInTheDocument();
  });

  /**
   * ★ A parent's menu names every tab of their child's file.
   *
   * Ирц, Хоол and Судалгаа are routes a parent opens constantly and had no
   * name in this menu — reachable only by landing on the child's page and
   * finding the tab there.
   */
  it("names the child's tabs a parent actually opens", async () => {
    renderShell(["PARENT"], "/home", [OWN_CHILD]);
    const nav = await sidebar();

    await waitFor(() =>
      expect(within(nav).getByRole("link", { name: /Батмөнх/ })).toBeInTheDocument(),
    );

    for (const label of ["Ажиглалт", "Ирц", "Хоол", "Судалгаа"]) {
      expect(
        within(nav).queryByRole("link", { name: label }),
        `${label} is missing from the parent menu`,
      ).toBeInTheDocument();
    }
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

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setPathname, stubApi } from "./support/render";
import AppLayout from "@/app/(app)/layout";
import { BRAND } from "@/lib/vocabulary";

/**
 * The sidebar: brand, icons, active state, role and the profile entry point.
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
  /*
   * ★ Overridable since 2026-09-05, for the shortcut box.
   *
   * A teacher with no group is a real state — a new hire before an assignment
   * — and it is the one where a quick link to Ирц would have nowhere to go.
   * Testing that needs a roster with no groups in it.
   */
  groups: unknown = GROUPS,
  unreadCount = 0,
  isSuperAdmin = false,
) {
  setPathname(pathname);
  const session = sessionFor(roles);
  stubApi([
    {
      path: "/auth/me",
      body: isSuperAdmin ? { ...session, user: { ...session.user, isSuperAdmin: true } } : session,
    },
    { path: "/groups", body: groups },
    { path: "/children/mine", body: ownChildren },
    { path: "/notifications/unread-count", body: { count: unreadCount } },
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

/**
 * The collapsible sections, without the "Түргэн холбоос" box above them.
 *
 * ★ Two rows are deliberately in the sidebar twice as of 2026-09-05 —
 * "Хүүхдүүд" and "Ирц" are shortcuts *and* section entries, which is what a
 * shortcut is. An assertion about the section menu has to say which of the two
 * it means, or it fails on the duplication rather than on anything real.
 */
async function sections(): Promise<HTMLElement> {
  const nav = await sidebar();
  return within(nav).getByTestId("nav-sections");
}

beforeEach(() => {
  vi.clearAllMocks();
  setPathname("/");
});

// ═══════════════════════════════════════════════════════════════════════════
// Brand
// ═══════════════════════════════════════════════════════════════════════════

describe("the brand header", () => {
  it("renders the full logo, named for a screen reader", async () => {
    renderShell(["TEACHER"]);
    const nav = await sidebar();

    const mark = within(nav).getByAltText(BRAND);
    expect(mark).toBeInTheDocument();
    // The filename is asserted rather than merely "some image", because the
    // sidebar renders it through next/image and a missing public asset is a 404
    // the component itself never notices.
    expect(mark.getAttribute("src")).toContain("brand-mark.png");
  });

  it("links the brand home", async () => {
    renderShell(["TEACHER"]);
    const nav = await sidebar();

    expect(within(nav).getByAltText(BRAND).closest("a")).toHaveAttribute("href", "/");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Icons — the gap this task closed
// ═══════════════════════════════════════════════════════════════════════════

describe("navigation icons", () => {
  it("gives every staff section entry an icon", async () => {
    renderShell(["TEACHER", "ADMIN"]);
    const nav = await sections();

    /*
      The client's 2026-08-30 labels. "Үнэлгээ" is "Явцын үнэлгээ" and "Мэдээ"
      is "Ангийн самбар / Мэдээ" — both are the names on their drawing, and
      both now point at a landing page rather than at a group-scoped href.
    */
    const entries = [
      "Хүүхдүүд",
      "Явцын үнэлгээ",
      "Ирц",
      "Хоолны цэс",
      "Ангийн самбар / Мэдээ",
      "Судалгаа",
      // The screens that used to sit behind the "Удирдлага" hub, which no
      // longer has a row of its own — see "does not repeat the administration
      // hub". "Бүлгүүд" joined them on 2026-09-04, when the hub page stopped
      // carrying tiles and it became the one destination with no other way in.
      "Цэцэрлэгийн мэдээлэл",
      "Хэрэглэгч ба эрх",
      "Хичээлийн жил",
      "Улирал",
      "Бүлгүүд",
      "Баримт бичгийн сан",
    ];

    for (const label of entries) {
      const link = within(nav).getByRole("link", { name: label });
      // Feature art renders an <img>; the rest of the icon set stays SVG.
      expect(link.querySelector("svg, img"), `${label} has no icon`).not.toBeNull();
    }
  });

  it("sizes section icons one step below the top level", async () => {
    renderShell(["TEACHER"]);
    const nav = await sidebar();

    const icon = within(nav).getByRole("link", { name: "Судалгаа" }).querySelector("img")!;
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
    const names = new Set(paths.map((a) => a.querySelector("img")?.getAttribute("src") ?? "none"));
    expect(names.size).toBe(1);
    expect([...names][0]).toContain("icon-notice");
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
    const nav = await sections();

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
    const nav = await sections();

    expect(within(nav).getByRole("link", { name: "Хүүхдүүд" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Ирц" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Удирдлага" })).not.toBeInTheDocument();
  });

  /**
   * ★ The review queues are NOT rows, and this assertion has now been written
   * in both directions — twice.
   *
   * The case against them was always recorded in `(app)/layout.tsx`: Чөлөөний
   * хүсэлт renders inside Ирц, where approving one writes the very rows the day
   * sheet is about; Ажиглалт хянах is reached from the dashboard alert that
   * counts what is waiting. Both rows were nonetheless asserted *present* here
   * until 2026-09-04, because the client had listed them by name and the owner
   * chose the client's list over the tidier argument.
   *
   * The client then asked for both to go — "ажиглалт, чөлөөний хүсэлт 2 огт
   * хэрэггүй" — which settles it in the direction the reasoning always pointed.
   * The assertion flips with the decision rather than being deleted, so a
   * future tidy-up finds a recorded choice instead of an absence.
   *
   * ★★ Чат keeps its row and its own assertion, unchanged: the same client list
   * carried it and the same client has not asked for it back.
   */
  it("keeps the review queues out of the menu, and chat in it", async () => {
    renderShell(["TEACHER", "ADMIN"]);
    const nav = await sidebar();

    expect(within(nav).queryByRole("link", { name: "Ажиглалт хянах" })).not.toBeInTheDocument();
    expect(
      within(nav).queryByRole("link", { name: "Чөлөөний хүсэлт хянах" }),
    ).not.toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Чат" })).toHaveAttribute("href", "/chat");
  });

  /**
   * ★ Бүлгүүд moved under Хүүхдүүд on 2026-09-04, at the client's request.
   *
   * It had been filed with the setup screens in "Багш ба байгууллага", among
   * the things configured once a year. A group is a list of children with two
   * teachers on it, and the question that sends somebody here is the one the
   * row above answers for the whole kindergarten.
   */
  it("puts Бүлгүүд directly under Хүүхдүүд", async () => {
    renderShell(["ADMIN"]);
    const nav = await sections();

    const links = within(nav).getAllByRole("link");
    const children = links.findIndex((link) => link.textContent?.includes("Хүүхдүүд"));
    const groups = links.findIndex((link) => link.textContent?.includes("Бүлгүүд"));

    expect(children).toBeGreaterThanOrEqual(0);
    expect(groups).toBe(children + 1);
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
      "Бүлгүүд",
    ]) {
      expect(
        within(nav).queryByRole("link", { name: label }),
        `${label} is visible to a teacher`,
      ).not.toBeInTheDocument();
    }
  });

  /** The headings the staff menu groups the product by, per the 2026-08-29 drawing. */
  /**
   * ★ 2026-09-09 — this asserted on the four section *headings*.
   *
   * The staff sidebar was a set of collapsible `<details>` groups and this
   * test named their summaries. It is one flat list now, the same shape the
   * parent shell already used, so those headings no longer exist and the old
   * assertions could only have been satisfied by putting the accordion back.
   *
   * What the headings were protecting is not the headings. `layout.tsx` still
   * declares the sections — flattening happens in `app-shell.tsx`, at render —
   * and the risk of `flatMap` is that a whole section's entries go missing
   * without anything failing, because every remaining row still looks right.
   * So this now asserts on one destination out of each of the four groups: if
   * a section stops being rendered, its row disappears and this test says so.
   */
  it("renders a destination from every staff section", async () => {
    renderShell(["TEACHER", "ADMIN"]);
    const nav = await sidebar();

    // Хүүхдийн хөгжил ба үнэлгээ
    expect(within(nav).getByRole("link", { name: "Явцын үнэлгээ" })).toBeInTheDocument();
    // Өдөр тутмын бүртгэл
    expect(within(nav).getByRole("link", { name: "Ирц" })).toBeInTheDocument();
    /*
      ★ Two rows since 2026-09-11: the menu, and the register underneath it.

      The client asked for the menu in this slot ("хоолны хуучин бүртгэл гэсэн
      хэсгийг арилгаад … хоолны цэс хэсгийг … оруул"). The register kept a row
      rather than being dropped — `нэмэлт.md` §3 multiplies its "хооллосон
      өдөр" into the food-cost calculation, and a screen with no door is a
      funding figure that quietly stops being entered.
    */
    expect(within(nav).getByRole("link", { name: "Хоолны цэс" })).toHaveAttribute("href", "/menu");
    // Харилцаа холбоо
    expect(within(nav).getByRole("link", { name: "Судалгаа" })).toBeInTheDocument();
    // Багш ба байгууллага: the foot's own row is the single route to /settings.
    expect(within(nav).getByRole("link", { name: "Хувийн тохиргоо" })).toBeInTheDocument();
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
      ["Бүлгүүд", "/admin/groups"],
      ["Ирц ба тооцоолол", "/admin/funding"],
    ] as const) {
      expect(within(nav).getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  /**
   * ★ No hub row, and that is deliberate rather than an omission.
   *
   * Every screen the "Удирдлага" tile page used to list has its own row above
   * this assertion, so the hub's only remaining job was to name what the menu
   * already names — and on 2026-09-04 the tiles went too, leaving `/admin` as
   * the administrator's dashboard rather than a list of links. It is still
   * where the root redirect lands an administrator (`app/page.tsx`), so the
   * screen is not orphaned by losing the line.
   */
  it("does not repeat the administration hub as a row", async () => {
    renderShell(["TEACHER", "ADMIN"]);
    const nav = await sidebar();

    expect(within(nav).queryByRole("link", { name: "Удирдлага" })).not.toBeInTheDocument();
    // The screens it used to hide are still reachable, which is the point.
    // ★ This assertion named "Аудит" until 2026-09-06, when that row and
    // "Үнэлгээний тохиргоо" were removed at the client's request. It is
    // re-pointed at "Хэрэглэгч ба эрх" rather than deleted: the property under
    // test is that losing the hub row did not orphan the screens behind it,
    // and any surviving row proves it.
    expect(within(nav).getByRole("link", { name: "Хэрэглэгч ба эрх" })).toHaveAttribute(
      "href",
      "/admin/users",
    );
  });

  /**
   * ★ 2026-09-06 — the client asked for both rows to go.
   *
   * The screens stay and keep their own `RequireRole`; what goes is the
   * permanent menu row for work that is done in August (the assessment
   * configuration) or only in answer to a question (the audit trail).
   */
  it("does not give the assessment configuration or the audit log a row", async () => {
    renderShell(["TEACHER", "ADMIN"]);
    const nav = await sidebar();

    expect(
      within(nav).queryByRole("link", { name: "Үнэлгээний тохиргоо" }),
    ).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Аудит" })).not.toBeInTheDocument();
  });

  /**
   * ★ The accountant's rail — client request, 2026-09-09.
   *
   * "Самбар" is `supportNav`'s first entry, which the rail renders *above* the
   * sections as its primary link. Giving the same route a section row as well
   * drew "Самбар" twice, one under the other — reported from a screenshot the
   * same day, and the duplication this change set exists to remove rather than
   * a new one to add. So the board appears once, and "Санхүүжилт" keeps its
   * short name below it.
   */
  it("names the board once, above a section that keeps its own name", async () => {
    renderShell(["ACCOUNTANT"], "/finance/dashboard");
    const nav = await sidebar();

    expect(within(nav).getAllByRole("link", { name: "Самбар" })).toHaveLength(1);
    expect(within(nav).getByRole("link", { name: "Самбар" })).toHaveAttribute(
      "href",
      "/finance/dashboard",
    );
    expect(within(nav).getByRole("link", { name: "Санхүүжилт" })).toHaveAttribute(
      "href",
      "/finance",
    );
    expect(
      within(await sections()).queryByRole("link", { name: "Самбар" }),
    ).not.toBeInTheDocument();
  });

  /**
   * ★★ One row lights up, not two.
   *
   * `/finance/dashboard` sits beneath `/finance`, so a bare prefix test marked
   * both rows current and emitted `aria-current="page"` twice — which is not a
   * thing a page can be. `activeHrefIn` resolves the longest match per menu,
   * across the primary link and the sections together; this is what pins it.
   */
  it("marks only the most specific row when one route sits beneath another", async () => {
    renderShell(["ACCOUNTANT"], "/finance/dashboard");
    const nav = await sidebar();

    expect(within(nav).getByRole("link", { name: "Самбар" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Санхүүжилт" })).not.toHaveAttribute(
      "aria-current",
    );
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
   * Чат is the other side of the same rule for a *parent*: the row added on
   * 2026-08-31 is in `staffSections`, and `parentSections` still has none — a
   * guardian reaches chat from the floating widget. This case is about the
   * parent menu, so it is unaffected by that row and still asserts absence.
   */
  it("leaves no unbuilt feature named in either menu", async () => {
    renderShell(["PARENT"], "/home");
    const nav = await sidebar();

    expect(within(nav).queryByText("Санхүү")).not.toBeInTheDocument();
    expect(within(nav).queryByText("Чат")).not.toBeInTheDocument();
    expect(within(nav).queryByText("удахгүй")).not.toBeInTheDocument();
  });

  it("renders the guardian-only reference menu and unread badge", async () => {
    renderShell(["PARENT"], "/home", [OWN_CHILD], GROUPS, 3);
    const nav = await sidebar();

    expect(await within(nav).findByRole("combobox", { name: "Хүүхэд сонгох" })).toHaveValue(
      OWN_CHILD.id,
    );
    expect(within(nav).getAllByText("Батмөнх Тэмүүлэн").length).toBeGreaterThan(0);

    // The rows a guardian navigates with, plus the folding group's own header.
    for (const label of [
      "Нүүр",
      "Хүүхдийн мэдээлэл",
      "Цэцэрлэгийн мэдээлэл",
      "Мэдээ",
      "Багштай холбогдох",
      "Үйлчилгээний эрх",
      "Тусламж",
    ]) {
      expect(within(nav).getByText(label), `${label} is missing`).toBeVisible();
    }

    expect(within(nav).getByText("3")).toBeInTheDocument();
    expect(within(nav).getByText("Жилийн")).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Нүүр" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Хүүхдийн мэдээлэл" })).toHaveAttribute(
      "href",
      `/children/${OWN_CHILD.id}/general`,
    );
    expect(within(nav).getByRole("link", { name: "Багштай холбогдох" })).toHaveAttribute(
      "href",
      "/chat",
    );
  });

  /*
   * The six reference rows fold away so the menu the parent actually uses fits
   * a phone screen. `toBeVisible` rather than `toBeInTheDocument` is the whole
   * point of these two cases: the panel stays mounted while closed, so the
   * weaker matcher would pass on a disclosure that never opens *and* on one
   * that never closes.
   */
  const FOLDED = [
    "Миний гэрээ",
    "Гарын авлага",
    "Түгээмэл асуулт",
    "Үйлчилгээний нөхцөл",
    "Нууцлалын бодлого",
    "Холбоо барих",
  ];

  it("keeps the six help rows folded away until Тусламж is opened", async () => {
    const user = userEvent.setup();
    renderShell(["PARENT"], "/home", [OWN_CHILD], GROUPS, 3);
    const nav = await sidebar();

    const toggle = within(nav).getByRole("button", { name: "Тусламж" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    for (const label of FOLDED) {
      expect(within(nav).getByText(label), `${label} should start folded`).not.toBeVisible();
    }

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    for (const label of FOLDED) {
      expect(within(nav).getByText(label), `${label} should be revealed`).toBeVisible();
    }
  });

  it("folds Тусламж shut again, and reaches support last", async () => {
    const user = userEvent.setup();
    renderShell(["PARENT"], "/home", [OWN_CHILD], GROUPS, 3);
    const nav = await sidebar();

    const toggle = within(nav).getByRole("button", { name: "Тусламж" });
    await user.click(toggle);

    // Ordered so the address to write to sits below the five pages that may
    // save the parent from needing it.
    const opened = FOLDED.map((label) => within(nav).getByText(label));
    for (let i = 1; i < opened.length; i += 1) {
      expect(
        opened[i - 1]!.compareDocumentPosition(opened[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${FOLDED[i]} should follow ${FOLDED[i - 1]}`,
      ).toBeTruthy();
    }
    expect(within(nav).getByRole("link", { name: "Холбоо барих" })).toHaveAttribute(
      "href",
      "mailto:Nomadkidsmn@gmail.com",
    );

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(nav).getByText("Миний гэрээ")).not.toBeVisible();
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

  /**
   * The menu's foot, for every role — 2026-09-11, at the client's instruction.
   *
   * ★ Three things where there was one: who you are, where to change it, and
   * the way out.
   *
   * It was a single 56px row doing two jobs — naming the signed-in person and
   * being the only door to `/settings` — and sign-out lived at the bottom of
   * that screen, three taps away and past a page of read-only records. The
   * client asked for the two to be split ("Энэ 2-ыг салга") and for the way out
   * to sit at the foot in red ("хамгийн доор нь системээс гарах гэж улаанаар
   * бич").
   *
   * ★★ Asserted for all five audiences, because the client asked for all five
   * ("5 хэрэглэгчийг тавууланг нь ийм болго") and because one `SidebarContent`
   * serves them — a regression would take every role at once, or none.
   */
  it.each([
    { label: "teacher", roles: ["TEACHER"] as const },
    { label: "parent", roles: ["PARENT"] as const },
    { label: "admin", roles: ["ADMIN"] as const },
    { label: "cook", roles: ["COOK"] as const },
    { label: "accountant", roles: ["ACCOUNTANT"] as const },
  ])("names the person, their settings and the way out for $label", async ({ label, roles }) => {
    renderShell([...roles], label === "parent" ? "/home" : "/dashboard", [OWN_CHILD]);
    const nav = await sidebar();

    // Who — plain text now, not the label of a control.
    expect(within(nav).getByText("Тест Хэрэглэгч")).toBeInTheDocument();

    expect(within(nav).getByRole("link", { name: "Хувийн тохиргоо" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(within(nav).getByRole("button", { name: "Системээс гарах" })).toBeInTheDocument();
  });

  it("offers the same three at the foot of the platform menu", async () => {
    renderShell([], "/platform", [], GROUPS, 0, true);
    const nav = await sidebar();

    expect(within(nav).getByRole("link", { name: "Хувийн тохиргоо" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(within(nav).getByRole("button", { name: "Системээс гарах" })).toBeInTheDocument();
  });

  /*
    ★ Red, and the assertion is on the token rather than a hex value.

    `text-danger` is the one meaning in `tone.ts` that says "this ends
    something". A class assertion is weak on its own; what it defends is a later
    tidy-up repainting the row as a neutral ghost button, which is exactly what
    it was before the client asked.
  */
  it("paints the way out in the danger tone", async () => {
    renderShell(["TEACHER"]);
    const nav = await sidebar();

    const out = within(nav).getByRole("button", { name: "Системээс гарах" });
    expect(out.className).toContain("text-danger");
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

  it("gives the parent's four main tabs their own supplied drawing", async () => {
    renderShell(["PARENT"], "/home", [OWN_CHILD]);

    const bar = await waitFor(() => screen.getByRole("navigation", { name: "Доод цэс" }));
    const expected = [
      ["Нүүр", "icon-nav-home"],
      ["Мэдээ", "icon-nav-news"],
      ["Зураг", "icon-nav-gallery"],
      ["Хоол", "icon-nav-food"],
    ] as const;

    for (const [label, asset] of expected) {
      const link = within(bar).getByRole("link", { name: label });
      expect(link.querySelector("img")?.getAttribute("src")).toContain(asset);
      // The label itself stays on screen — this bar follows the same visible
      // caption pattern every other tab bar in the shell already uses.
      expect(within(link).getByText(label)).not.toHaveClass("sr-only");
    }
  });

  /*
    ★ "Хоолны бүртгэл" is the director's row — 2026-09-12, at the client's
    request ("багшаас хоолны бүртгэл хас").

    It is the per-child "did this child eat", and `нэмэлт.md` §3 multiplies its
    "хооллосон өдөр" into the food cost — so it keeps a door rather than losing
    one. The API is untouched: a teacher following a link still records, because
    they are the one in the room at lunch.
  */
  it("keeps the meal register off a teacher's menu and on a director's", async () => {
    renderShell(["TEACHER"]);
    const teacherNav = await sidebar();

    expect(within(teacherNav).getByRole("link", { name: "Хоолны цэс" })).toBeInTheDocument();
    expect(
      within(teacherNav).queryByRole("link", { name: "Хоолны бүртгэл" }),
    ).not.toBeInTheDocument();
  });

  it("gives a director the register", async () => {
    renderShell(["ADMIN"]);
    const nav = await sidebar();

    expect(within(nav).getByRole("link", { name: "Хоолны бүртгэл" })).toBeInTheDocument();
  });
});

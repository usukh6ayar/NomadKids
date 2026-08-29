"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Building2,
  // `ChevronRight` left with the child-picker modal `origin/main` removed;
  // `CalendarCheck` stays because the staff nav still labels Ирц with it.
  CalendarCheck,
  ClipboardCheck,
  ClipboardList,
  Newspaper,
  FileText,
  Home,
  Images,
  LayoutGrid,
  Bell,
  Menu,
  NotebookPen,
  Settings,
  ShieldCheck,
  Users,
  UtensilsCrossed,
  // `X` was the picker modal's close button and went with it. The type stays:
  // `ICON_FOR` below is keyed by href and annotated with it.
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { childSummarySchema, type ChildSummary } from "@kinder/contracts";
import { z } from "zod";
import { AppShell, type NavItem, type NavSection } from "@/components/shell/app-shell";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { ChildAvatar } from "@/components/media/media-image";
import { useMyGroup } from "@/components/dashboard/use-my-group";
import { LoadingState } from "@/components/ui/states";
import { useSession } from "@/lib/auth/session";
import { fullName } from "@/lib/format";

const ownChildrenSchema = z.array(childSummarySchema);

/**
 * The authenticated shell.
 *
 * ★ One route tree, not three.
 *
 * The obvious structure — `(teacher)`, `(parent)`, `(admin)` route groups — is
 * impossible here: Next resolves route groups to the same URL space, and all
 * three audiences need `/children/[childId]`, `/notifications` and `/settings`.
 * Three groups would be a build error, and prefixing the parent's routes
 * (`/my/children/…`) would give the same child two URLs, so a link shared
 * between a teacher and a parent would break for one of them.
 *
 * Instead the navigation is derived from the session's roles, and the handful
 * of screens both audiences reach render the view appropriate to the viewer.
 * The data those screens receive is already filtered by the API — a parent's
 * `/children/:id/observations` simply does not contain private notes — so the
 * difference here is layout and affordances, never data hiding.
 *
 * A dual-role user (an admin who is also a parent, which the client has) gets
 * one coherent product rather than two apps they must sign out of to switch.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { session, isLoading, hasRole, isSuperAdmin } = useSession();
  const router = useRouter();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");

  useEffect(() => {
    if (isLoading || session) return;
    const from = encodeURIComponent(window.location.pathname + window.location.search);
    router.replace(`/login?from=${from}`);
  }, [isLoading, session, router]);

  /*
   * ★ Powers both the desktop sidebar's "Хүүхдийн мэдээлэл" section and the
   * phone bottom bar's "Зураг" tab, not this page.
   *
   * Same query key as `/children`'s own fetch (`ChildrenPage`), so a parent
   * who has already opened that screen this session sees both resolve from
   * cache rather than firing a second request.
   *
   * Called unconditionally (hooks must not follow the early returns below) and
   * gated by role with `enabled` instead.
   */
  /*
   * The group whose registers the sidebar links to — see `staffSections`.
   * `useMyGroup` shares its key with the dashboard's cards, so on any screen
   * that has already loaded them this resolves from cache.
   */
  const myGroup = useMyGroup({ enabled: Boolean(session) && isStaff });

  const myChildren = useQuery({
    queryKey: qk.myChildren(),
    queryFn: () => get("/children/mine", ownChildrenSchema),
    enabled: Boolean(session) && !isSuperAdmin && !isStaff,
    staleTime: 60_000,
  });

  if (isLoading || !session) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-4 py-10">
        <LoadingState label="Ачаалж байна…" />
      </div>
    );
  }

  // Checked ahead of the staff/parent split: a superadmin holds no
  // kindergarten membership (CLAUDE.md §1.1), so `hasRole` reads false for
  // everything and this would otherwise fall into the parent shell — the
  // "Танд холбогдсон хүүхэд байхгүй байна" screen a platform operator has no
  // business seeing.
  if (isSuperAdmin) {
    return (
      <AppShell nav={platformNav()} variant="platform">
        {children}
      </AppShell>
    );
  }

  const nav = isStaff
    ? staffNav(hasRole("ADMIN"), myGroup.count === 1 ? (myGroup.group?.id ?? null) : null)
    : parentNav(myChildren.data);

  return (
    /*
     * ★ The merge takes `origin/main`'s shape and this side's `isAdmin`, and
     * neither half of that is arbitrary.
     *
     * This side wrapped the shell in a fragment to hang a `ChildPickerModal`
     * off `childPickerOpen`. `origin/main` removed the parent child switcher
     * outright — 6064be3, "drop the header greeting and child switcher from
     * the parent home page" — so the state hook and the component it rendered
     * are both gone. Keeping the fragment would have left three identifiers
     * referenced and none of them defined: a build failure, not a conflict.
     * The picker is upstream's deliberate removal and it stays removed.
     *
     * `isAdmin` goes the other way. It is a real prop on the merged `AppShell`
     * (it drives `WhoAmI`'s role line), and `origin/main` simply predates it,
     * so dropping it would silently mislabel every administrator as a teacher
     * in their own sidebar.
     */
    <AppShell
      nav={nav}
      sections={
        isStaff
          ? staffSections(
              hasRole("ADMIN"),
              myGroup.count === 1 ? (myGroup.group?.id ?? null) : null,
            )
          : parentSections(myChildren.data)
      }
      variant={isStaff ? "teacher" : "parent"}
      isAdmin={hasRole("ADMIN")}
    >
      {children}
    </AppShell>
  );
}

const iconProps = { size: 20, strokeWidth: 2, "aria-hidden": true } as const;

/**
 * Section entries sit one level in, so their icons are one step down.
 *
 * 18px against the top level's 20px: the indent already says "child of the
 * row above", and matching the parent's size would make the sub-level compete
 * with it. `parentSections` had been spelling `size={18}` inline on each entry,
 * which is the same number three times and no name for it.
 */
const sectionIconProps = { size: 18, strokeWidth: 2, "aria-hidden": true } as const;

/**
 * One icon per destination, chosen once.
 *
 * ★ Keyed by `href`, and that is the point rather than a convenience.
 *
 * Several routes appear in more than one menu — `/notifications` is in the
 * staff sections, the parent sections and both bottom bars; `/settings` is in
 * three. Each call site used to pick its own glyph, and they had already
 * drifted: the same route was `Bell` in one list and nothing at all in
 * another. A map keyed by the destination makes "the same feature, two icons"
 * unrepresentable instead of merely discouraged.
 *
 * ★★ Existing choices are kept, not re-picked. `/children` was already `Users`
 * and `/observations/review` already `ClipboardList` in the top-level nav; both
 * stay, so the phone's bottom bar and the desktop sidebar keep agreeing. Only
 * the four routes that had no icon anywhere are new decisions.
 */
const ROUTE_ICON: Record<string, LucideIcon> = {
  "/dashboard": LayoutGrid,
  "/home": Home,
  "/children": Users,
  "/observations/review": ClipboardList,
  "/attendance-requests/review": CalendarCheck,
  "/notifications": Newspaper,
  "/surveys": BarChart3,
  "/documents": FileText,
  "/settings": Settings,
  "/admin": ShieldCheck,
  "/platform": Building2,
};

/** The section-level icon for a route, or nothing if it has no destination. */
function routeIcon(href: string | undefined) {
  if (!href) return undefined;
  const Icon = ROUTE_ICON[href];

  return Icon ? <Icon {...sectionIconProps} /> : undefined;
}

/**
 * Staff navigation — the phone's bottom bar, and the sidebar's first entry.
 *
 * ★ Rewritten 2026-08-28 to the client's own drawing: Самбар · Мэдээ · Явцын
 * үнэлгээ · Судалгаа · Цэс.
 *
 * Five tabs, and the two that left are the reason "Цэс" is the fifth.
 * **Хүүхдүүд** and **Ажиглалт хянах** used to sit here and are now reached
 * from the menu the last tab opens — `MobileMenuDrawer`, which renders the same
 * sections the desktop sidebar does. That is the drawer's whole purpose and
 * what the client described: the things a five-tab bar cannot name live one tap
 * behind it. Neither destination lost a route.
 *
 * ★★ "Явцын үнэлгээ" is a tab now, having been deliberately absent for months.
 *
 * The old note here read: "assessment always begins from a group, so it lives
 * on the dashboard rather than as a menu item that would first ask 'which
 * group?'". That reasoning was sound and its premise is gone twice over — the
 * dashboard no longer carries the entry point (the 2026-08-28 redesign removed
 * `GroupsSection` and `TeacherHero`), and `useMyGroup()` resolves the group in
 * the layout, so the tab can point straight at it without asking anything.
 *
 * The fallbacks are the honest part. A teacher with one group gets that
 * group's assessment sheet. An admin sees every group in the kindergarten, so
 * there is no single sheet to open and the tab goes to `/admin/groups`, whose
 * rows carry a Үнэлгээ link each. A teacher with no group assigned goes to
 * `/children`, where assessment can still be reached per child. No branch is a
 * dead link, and none of them opens a screen whose first act is "which group?".
 */
function staffNav(isAdmin: boolean, groupId: string | null): NavItem[] {
  const assessmentHref = groupId
    ? `/groups/${groupId}/assessment`
    : isAdmin
      ? "/admin/groups"
      : "/children";

  return [
    { href: "/dashboard", label: "Самбар", icon: <LayoutGrid {...iconProps} /> },
    { href: "/notifications", label: "Мэдээ", icon: <Newspaper {...iconProps} />, badge: "unread" },
    { href: assessmentHref, label: "Явцын үнэлгээ", icon: <ClipboardCheck {...iconProps} /> },
    { href: "/surveys", label: "Судалгаа", icon: <BarChart3 {...iconProps} /> },
    /*
      ★ `/settings` is what `AppShell` matches on to open the drawer instead of
      navigating (see its `bottomNav` mapping), so the href is load-bearing even
      though this tab never uses it as a destination on a phone. The label is
      the client's; `parentNav` already calls the same tab "Цэс".
    */
    { href: "/settings", label: "Цэс", icon: <Menu {...iconProps} /> },
  ];
}

/**
 * The desktop sidebar's grouped sections.
 *
 * ★ Every entry goes somewhere. There are no "удахгүй" placeholders.
 *
 * This sidebar previously named the whole product across three phases and left
 * eight of its thirteen entries as dead labels. Two failure modes came out of
 * that, and the second is the worse one:
 *
 *  - **Чат · Санхүү** are a later phase (CLAUDE.md §7). A
 *    teacher opening the menu every day and reading six things they cannot do
 *    learns that most of this product is broken. They are gone until the
 *    screen behind them exists; adding a line back is a one-line change on
 *    the day it ships. **Ирц** and **Судалгаа** were pulled forward by
 *    explicit client request and shipped 2026-08-24: the attendance day
 *    sheet is reached from the dashboard's group card, same as assessment,
 *    with its own review-queue line below for a guardian's advance notice;
 *    survey management earns a line here directly since — unlike
 *    attendance — it has no group to start from. Хоол ба цэс shipped the
 *    same day too, reached from the child page rather than the sidebar,
 *    since there is nothing kindergarten-wide to manage from here — only
 *    per-day content that belongs where a family reads it. **Баримт бичгийн
 *    сан** joined them on 2026-08-25 as RFP §9 shipped — staff only, so it
 *    appears here and never in `parentSections`.
 *
 *  - **Явцын үнэлгээ** and **Тайлан** were marked `soon` while both are fully
 *    built. Assessment begins from a group and a report from a child, so
 *    neither has a top-level route — but advertising a working feature as
 *    missing is worse than not listing it. They are reached where the work
 *    actually starts: the dashboard's group card, and the child page's PDF
 *    button.
 *
 * **Бүлэг, цэцэрлэгийн мэдээлэл** is an admin destination, so a teacher does
 * not see it at all. Showing it to them greyed out promised something that was
 * never going to arrive for that account.
 */
function staffSections(isAdmin: boolean, groupId: string | null): NavSection[] {
  /*
   * ★ Every entry takes its icon from `ROUTE_ICON` rather than naming one.
   *
   * All eight of these shipped with no icon at all — the `icon` field existed
   * on `NavSection` and this builder passed it for none of them, so the desktop
   * sidebar was three headings over eight bare text links while the bottom bar
   * beside it was fully illustrated. Resolving by route also means an entry
   * added here cannot disagree with the same destination in the top-level nav.
   */
  const entry = (label: string, href: string) => ({ label, href, icon: routeIcon(href) });

  /*
   * ★ A teacher with one group skips the picker; everybody else gets it.
   *
   * `/attendance`, `/assessment` and `/meals` are group-scoped features, so
   * each has a landing page that asks which group (`GroupPicker`). For a
   * teacher who has exactly one, that page has exactly one row — a click that
   * only ever has one answer, on the screen they open every morning. So their
   * sidebar links straight past it, and an administrator, who has no single
   * group to link to, lands on the picker.
   *
   * The destination differs; the label does not. One feature has one name
   * wherever it is reached from.
   */
  const scoped = (feature: string) => (groupId ? `/groups/${groupId}/${feature}` : `/${feature}`);

  return [
    /*
     * ★ Three sections, named after the client's own 2026-08-29 drawing.
     *
     * It groups the product as Суралцагч / Санхүү / Систем, which is a
     * different cut from the "Хүүхдийн хөгжил ба үнэлгээ · Харилцаа холбоо ·
     * Багш ба байгууллага" this sidebar used — and a better one for the
     * audience, because it separates *what you do with a child* from *what you
     * run the kindergarten with*.
     *
     * ★★ The drawing's names are kept; its exact contents are not.
     *
     * It files "Мэдээ / Ангийн самбар" and "Чат" under Санхүү, which they are
     * not — the reference system's own heading for that group was "Үйл
     * ажиллагаа ба санхүү", operations *and* finance, and the shortened label
     * lost the half that made it true. This uses the longer name.
     *
     * Санхүү itself has no entry: `apps/api/src/funding` exists, but
     * `docs/reference/FINANCE_SCOPE.md` records the tariffs and the definition
     * of a funding day as still outstanding from the client (D3, D4), so the
     * engine "will correctly calculate nothing" until they arrive. A menu row
     * that opens an empty screen is what this sidebar's own rule forbids.
     */
    /*
     * ★ Four sections, and the cut is by *what the work is*, not by subject.
     *
     * The client's 2026-08-29 drawing groups the product as Суралцагч /
     * Санхүү / Систем, and the first pass here took those three names
     * literally. That produced a "Үйл ажиллагаа" holding the meal register, the
     * class board, surveys and the staff PDF library — four rows doing three
     * unrelated jobs, which is what a section becomes when it is really the
     * leftovers.
     *
     * The structural fact that settles it: Ирц, Хоол ба цэс and Үнэлгээ are
     * the same screen three times. All three are recorded against a group, all
     * three land on `GroupPicker`, all three link straight past it for a
     * teacher with one group. Splitting them across two sections — two under
     * the child, one under operations — was arbitrary, and it is the reason
     * nothing else fell into place.
     *
     * So the registers sit together and each remaining name becomes exactly
     * true: a child's file, the group's registers, what goes out to a family,
     * and what you set up or look up. Two to three rows each.
     *
     * ★★ Where Санхүү goes when it arrives.
     *
     * Not here. `docs/reference/FINANCE_SCOPE.md` records the tariffs and the
     * definition of a funding day as still outstanding from the client (D3,
     * D4) — the engine "will correctly calculate nothing" until they arrive —
     * and it is nine reports and an invoicing flow, not a menu row. It earns
     * its own section on the day it can answer a question.
     */
    {
      title: "Суралцагч",
      entries: [
        entry("Хүүхдүүд", "/children"),
        entry("Ажиглалт хянах", "/observations/review"),
        entry("Чөлөөний хүсэлт хянах", "/attendance-requests/review"),
      ],
    },
    {
      /*
       * ★ The name this section had before the redesign, restored.
       *
       * It was "Бүлгийн бүртгэл" and it was right — these three are the
       * kindergarten's registers, kept per group. The redesign scattered them
       * and the section's own docblock had already argued they belong together.
       *
       * The icons are passed explicitly rather than resolved by `routeIcon()`:
       * for a teacher these hrefs are interpolated with a group id, so a
       * literal-keyed lookup returns `undefined` and the rows render as bare
       * text — the exact gap `sidebar.test.tsx` exists to catch.
       */
      title: "Бүлгийн бүртгэл",
      entries: [
        { label: "Ирц", href: scoped("attendance"), icon: <CalendarCheck {...sectionIconProps} /> },
        {
          label: "Хоол ба цэс",
          href: scoped("meals"),
          icon: <UtensilsCrossed {...sectionIconProps} />,
        },
        {
          label: "Үнэлгээ",
          href: scoped("assessment"),
          icon: <ClipboardCheck {...sectionIconProps} />,
        },
      ],
    },
    {
      /*
       * ★ Outward only — both of these leave the building.
       *
       * A notice goes on the class board a family reads at home; a survey asks
       * them a question. Neither is something a teacher does *to* a record,
       * which is what separates them from the section above.
       */
      title: "Харилцаа холбоо",
      entries: [entry("Мэдээ", "/notifications"), entry("Судалгаа", "/surveys")],
    },
    {
      title: "Систем",
      entries: [
        /*
         * RFP §9 — "Багшид зориулсан PDF баримт бичгийн сан": хөтөлбөр, арга
         * зүй, дотоод журам. Staff only, so it never appears in
         * `parentSections`.
         *
         * ★ It sat under "Үйл ажиллагаа" and does not belong there: a shelf you
         * read from is not an activity. It is reference material, which is what
         * this section is for.
         */
        entry("Баримт бичгийн сан", "/documents"),
        entry("Багшийн мэдээлэл", "/settings"),
        /*
         * ★ "Удирдлага", not "Бүлэг, цэцэрлэгийн мэдээлэл".
         *
         * The sidebar entry is `text-compact` beside a 16px icon inside a
         * 280px rail, which leaves room for about twenty characters. The old
         * label was twenty-seven and rendered as "Бүлэг, цэцэрлэгийн м…" on
         * every desktop — an ellipsis where the destination's name should be,
         * on the one entry a director uses most. It also named two of the
         * seven screens behind it and omitted the other five.
         *
         * It matches the bottom bar's tab for the same href, which is the
         * point: one destination, one name.
         */
        ...(isAdmin ? [entry("Удирдлага", "/admin")] : []),
      ],
    },
  ];
}

/**
 * Platform-operator navigation.
 *
 * Two items, because the operator's whole job in this MVP is registering
 * kindergartens — everything else (their teachers, groups, children) belongs
 * to the kindergarten's own admin from that point on. §7 keeps this MVP's
 * platform surface deliberately small.
 */
function platformNav(): NavItem[] {
  return [
    { href: "/platform", label: "Цэцэрлэгүүд", icon: <Building2 {...iconProps} /> },
    { href: "/settings", label: "Профайл", icon: <Settings {...iconProps} /> },
  ];
}

/**
 * Parent navigation — four items: Нүүр / Мэдээ / Зураг / Цэс.
 *
 * ★ Renamed from the brief's original Нүүр / Хавтас / Мэдэгдэл / Профайл to
 * match the parent's own mock-up. "Мэдээ" is `Мэдэгдэл` renamed; the route
 * and the unread badge are the same query `NotificationBell` reads
 * (`app-shell.tsx`). "Цэс" is `Профайл` renamed — still `/settings`, just
 * under the label and icon the mock-up gives a fourth, catch-all tab. It
 * opens `MobileMenuDrawer` (`app-shell.tsx`), which matches on `href ===
 * "/settings"` regardless of label, so this tab's own name differing from
 * `staffNav`'s "Профайл" costs nothing there.
 *
 * ★★ "Зураг" is a plain link, no popup. It goes straight to the first
 * child's `/overview` — the same "first child, most families only ever
 * have one" default `/home`'s own switcher and `selected` use. A family with
 * more than one child still gets exactly this behaviour rather than being
 * asked which child first: the tab always resolves to *a* real page, and once
 * there, that child's own switcher (or the sidebar's "Хүүхдийн мэдээлэл" list
 * on desktop) is how they reach a different one — the same pattern every
 * other per-child destination in this product already follows, rather than a
 * picker unique to this one tab. Before `myChildren` has loaded (or for a
 * family connected to none), it falls back to `/children` — a real list,
 * never a dead link and never a modal.
 *
 * "Ирц" and "Хоол ба цэс" briefly had their own bottom-bar tabs, each
 * resolving to a `?tab=` deep link on a confirmed single child or to
 * `/children` otherwise. For any family that isn't exactly one child, that
 * put three of the six tabs on the same destination: a wasted tab, and on
 * that landing page, three simultaneous "current page" highlights. A parent
 * reaches both from their child's own page, or from the home grid.
 *
 * `myChildren` comes from `AppLayout`, which owns the query — this function
 * has no hooks of its own to fetch with.
 */
function parentNav(myChildren: ChildSummary[] | undefined): NavItem[] {
  const zuragHref = myChildren?.[0] ? `/children/${myChildren[0].id}/overview` : "/children";

  return [
    { href: "/home", label: "Нүүр", icon: <Home {...iconProps} /> },
    { href: "/notifications", label: "Мэдээ", icon: <Bell {...iconProps} />, badge: "unread" },
    { href: zuragHref, label: "Зураг", icon: <Images {...iconProps} /> },
    { href: "/settings", label: "Цэс", icon: <Menu {...iconProps} /> },
  ];
}

/**
 * The desktop sidebar's grouped sections — parent side.
 *
 * Same shape as `staffSections` and the same rule for anything actually
 * built: every real entry is a link, duplicated here from `parentNav` for
 * the same reason the staff sidebar duplicates its own (see the comment
 * above `NavSection`) — a desktop reader sees the whole menu in one place
 * rather than a partial one that sends them hunting in the bottom bar. Each
 * duplicated entry carries the same icon `parentNav` gave its bottom-bar
 * tab, so the two surfaces read as one menu rather than two that happen to
 * agree.
 *
 * Санхүү is the one deliberate exception, named without a link. CLAUDE.md §7
 * puts finance in a later phase — it is not built, and pulling it forward was
 * not asked for here. Naming it anyway, as inert "удахгүй" text rather than a
 * link, was a specific choice for this sidebar: it is the reference's own
 * device (see `NavSection`'s doc comment), not the "eight dead links" version
 * this codebase already tried once and removed. Чат was the same kind of
 * entry and is gone entirely instead — removed on direct instruction, not a
 * decision made here.
 *
 * ★ "Хүүхдийн мэдээлэл" names the children, not the features.
 *
 * The first version of this listed "Миний хүүхдүүд" / "Ирц" / "Хоол ба цэс" as
 * three separate rows, all pointing at the same `/children` list for any
 * family that isn't exactly one child — see `parentNav`'s doc comment for why
 * that fallback existed and was then removed entirely. A parent has one or
 * two children, never a menu of features to browse; naming the children
 * directly, straight into each one's own page, is one tap to the thing a
 * parent actually wants instead of a route to a list they then pick from
 * anyway.
 *
 * ★★ Two rows per child, not one, since the child hub was deleted
 * (2026-08-28). It used to carry Ерөнхий and Ажиглалт as tabs on one page;
 * without that page a desktop reader needs both named here directly, the
 * same way `parentNav`'s own "Зураг" tab already links straight to a specific
 * child's page rather than to a list. `/general`'s icon is the child's own
 * avatar, matching every other per-child row this menu has ever shown; the
 * Ажиглалт row underneath it carries a plain glyph instead, so a family with
 * two children reads two two-row groups rather than four look-alike rows.
 */
function parentSections(myChildren: ChildSummary[] | undefined): NavSection[] {
  return [
    {
      title: "Хүүхдийн мэдээлэл",
      entries:
        myChildren && myChildren.length > 0
          ? myChildren.flatMap((child) => [
              {
                label: fullName(child),
                href: `/children/${child.id}/general`,
                icon: <ChildAvatar child={child} size={24} />,
              },
              {
                label: "Ажиглалт",
                href: `/children/${child.id}/observations`,
                icon: <NotebookPen size={18} aria-hidden="true" />,
              },
            ])
          : [{ label: "Холбогдсон хүүхэд алга" }],
    },
    {
      title: "Харилцаа холбоо",
      entries: [
        {
          label: "Мэдээ",
          href: "/notifications",
          icon: routeIcon("/notifications"),
        },
        /*
         * ★ Chat is no longer a dead row — it is built, and it is reachable.
         *
         * This said "chat is RFP Phase IV" and rendered as inert text. Both
         * halves stopped being true on 2026-08-29: CLAUDE.md §7 moved chat into
         * scope at the client's explicit request, and `AppShell` now renders
         * `ChatWidget` on every screen for every role — so a parent already has
         * it, from anywhere, with an unread badge.
         *
         * A greyed-out row saying "удахгүй" beside a working floating button is
         * worse than either alone: it tells a family the feature is missing
         * while the feature waves at them from the corner of the same page.
         */
      ],
    },
    {
      title: "Санхүү ба бүртгэл",
      entries: [
        { label: "Санхүү" },
        { label: "Миний бүртгэл", href: "/settings", icon: routeIcon("/settings") },
      ],
    },
  ];
}

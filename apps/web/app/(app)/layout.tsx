"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Boxes,
  Building2,
  Carrot,
  ChefHat,
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
  MessageCircle,
  NotebookPen,
  CalendarDays,
  CalendarRange,
  School,
  Receipt,
  ScrollText,
  Settings,
  Shapes,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  UserCog,
  UtensilsCrossed,
  Users,
  Wallet,
  // `X` was the picker modal's close button and went with it. The type stays:
  // `ICON_FOR` below is keyed by href and annotated with it.
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { childSummarySchema, type ChildSummary } from "@kinder/contracts";
import { z } from "zod";
import {
  AppShell,
  type ChildSwitcher,
  type NavItem,
  type NavSection,
} from "@/components/shell/app-shell";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { ChildAvatar } from "@/components/media/media-image";
import { useMyGroup } from "@/components/dashboard/use-my-group";
import { LoadingState } from "@/components/ui/states";
import { useSession } from "@/lib/auth/session";
import { SelectedChildProvider, useSelectedChild } from "@/lib/selected-child";
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
  /*
    ★ Neither of these is `isStaff`, and the shell has to say so before the
    parent branch does.

    `assertStaff` on the API means TEACHER or ADMIN and gates the teaching
    surface; a cook and an accountant deliberately fail it. Without a branch of
    their own they fall through to `parentNav`, which renders "Танд холбогдсон
    хүүхэд байхгүй байна" — the same wrong screen the superadmin check a few
    lines down exists to prevent, for the same reason.
  */
  const isCook = hasRole("COOK");
  const isAccountant = hasRole("ACCOUNTANT");

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

  // Ahead of the provider for the same reason the superadmin branch is: a cook
  // and an accountant are staff, so `/children/mine` never ran for them and
  // there is no selected child to provide. Their shell is the two screens their
  // role has and nothing else.
  if (isCook || isAccountant) {
    return (
      <AppShell nav={supportNav(isCook)} sections={supportSections(isCook)} variant="teacher">
        {children}
      </AppShell>
    );
  }

  const groupId = myGroup.count === 1 ? (myGroup.group?.id ?? null) : null;

  return (
    <SelectedChildProvider myChildIds={myChildren.data?.map((child) => child.id)}>
      <AuthenticatedShell
        isStaff={isStaff}
        isAdmin={hasRole("ADMIN")}
        groupId={groupId}
        myChildren={myChildren.data}
      >
        {children}
      </AuthenticatedShell>
    </SelectedChildProvider>
  );
}

/**
 * Split out of `AppLayout` so it can read `useSelectedChild()` — that hook
 * only works below `SelectedChildProvider`, and the provider itself needs
 * `myChildren` from the component above it.
 */
function AuthenticatedShell({
  isStaff,
  isAdmin,
  groupId,
  myChildren,
  children,
}: {
  isStaff: boolean;
  isAdmin: boolean;
  /** The teacher's one group, resolved once by `useMyGroup()` in `AppLayout` — null for an admin (every group) or a teacher assigned none. */
  groupId: string | null;
  myChildren: ChildSummary[] | undefined;
  children: ReactNode;
}) {
  const { selectedChildId, setSelectedChildId } = useSelectedChild();

  const nav = isStaff ? staffNav(isAdmin, groupId) : parentNav(myChildren, selectedChildId);

  // Below two children there is nothing to switch between — the sidebar
  // already names the one child directly, same as before this existed.
  const childSwitcher: ChildSwitcher | undefined =
    !isStaff && myChildren && myChildren.length > 1 && selectedChildId
      ? {
          children: myChildren,
          selectedId: selectedChildId,
          onSelect: setSelectedChildId,
        }
      : undefined;

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
        isStaff ? staffSections(isAdmin, groupId) : parentSections(myChildren, selectedChildId)
      }
      variant={isStaff ? "teacher" : "parent"}
      isAdmin={isAdmin}
      childSwitcher={childSwitcher}
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
  "/chat": MessageCircle,
  "/surveys": BarChart3,
  "/documents": FileText,
  "/settings": Settings,
  "/menu": UtensilsCrossed,
  "/finance": Wallet,
  "/invoices": Receipt,
  "/finance/audit-log": ScrollText,
  "/kitchen/ingredients": Carrot,
  "/kitchen/recipes": ChefHat,
  "/kitchen/suppliers": Truck,
  "/kitchen/orders": ShoppingCart,
  "/kitchen/stock": Boxes,
  "/kitchen/reports": BarChart3,
  "/admin": ShieldCheck,
  "/admin/funding": Wallet,
  "/platform": Building2,
  "/platform/revenue": Wallet,

  /*
   * ★ The seven administration screens, which had no icons because they had no
   * rows — every one of them sat behind the single "Удирдлага" hub.
   *
   * `Building2` is not reused for `/admin/kindergarten`: it is already
   * `/platform`, the superadmin's list of *every* kindergarten, and one glyph
   * for "the estate" and "my own building" is the drift this map exists to
   * prevent. `School` is the narrower thing.
   */
  "/admin/groups": Shapes,
  "/admin/kindergarten": School,
  "/admin/users": UserCog,
  "/admin/school-years": CalendarRange,
  "/admin/terms": CalendarDays,
  "/admin/assessment-config": SlidersHorizontal,
  "/admin/audit": ScrollText,
};

/**
 * One section row, taking its icon from the route it points at.
 *
 * ★ Module-level, so `staffSections` and `parentSections` cannot build a row
 * two different ways. Both menus name `/notifications` and `/settings`, and a
 * per-builder copy is how the same destination came to carry one glyph in one
 * menu and none in the other — the drift `ROUTE_ICON` exists to prevent, one
 * level up.
 */
function entry(label: string, href: string) {
  return { label, href, icon: routeIcon(href) };
}

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
 * This sidebar once named the whole product across three phases and left eight
 * of its thirteen entries as dead labels — a teacher opening the menu every day
 * and reading six things they cannot do learns that most of the product is
 * broken. Every rule below follows from that.
 *
 * ★★ **The section headings are the 2026-08-29 drawing's**, kept as they were
 * merged: Хүүхдийн хөгжил ба үнэлгээ · Өдөр тутмын бүртгэл · Харилцаа холбоо ·
 * Санхүү ба баримт бичиг · Багш ба байгууллага.
 *
 * A second pass on this branch renamed them to the reference's three — Сургалт
 * ба сурагчид · Үйл ажиллагаа ба санхүү · Систем ба тохиргоо — at the same
 * hour as the rename above landed on `main`, and only one naming can survive a
 * merge. The one that shipped stays. What that second pass added *besides* the
 * names is kept below, because none of it depends on them.
 *
 * **The seven administration screens are rows now.** They were all behind a
 * single "Удирдлага" hub, so a director looking for "Улирал" read one word that
 * did not say it and had to open a page to find out. The reference names its
 * destinations directly and it is right to: a menu whose job is to say what is
 * in the product should not make you open a screen to read the menu. The hub
 * keeps its row — it carries kindergarten-wide figures an admin who also
 * teaches cannot get from `/dashboard`, which gives that person the class
 * board — and now sits above the screens it used to hide.
 *
 * **"Багшийн удирдлага" is not a second row.** The reference has a teacher
 * module beside its user module; here both are `/admin/users`, one screen with
 * a role filter. Two rows pointing at one URL would light the same row for
 * both — `NavLink` matches on `pathname`, which carries no query string — so
 * one row, named for what the screen actually is.
 *
 * **Чат has no row.** It is built and it is reachable from every screen in the
 * product, as a floating button with its own unread badge (`ChatWidget`). A
 * menu row beside a button that is already on screen is a second way in for a
 * feature that needs one.
 *
 * ★★★ A teacher sees only what a teacher may open. Every admin destination is
 * gated on `isAdmin` rather than shown greyed out — the API answers 404 to a
 * teacher on all of them (`TenantAccessService.assertAdmin`), so a visible row
 * would promise something that account will never get.
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
  const entry = navEntry;

  /** An entry only an administrator has, dropped entirely for anyone else. */
  const adminEntry = (label: string, href: string) => (isAdmin ? [entry(label, href)] : []);

  /*
   * ★ A teacher with one group links straight at it; everybody else takes the
   * doorway.
   *
   * `/attendance`, `/assessment` and `/meals` are group-scoped, so something
   * has to decide which group. It used to be a page listing them, which for a
   * teacher with one group was a page with one row, every morning. Those routes
   * now resolve the first group and forward, and the register carries the
   * groups as chips along its top (`GroupSwitcher`) — so an administrator lands
   * on a real register and switches in place instead of returning to a menu.
   *
   * A teacher with exactly one group still gets the direct link, which skips
   * even the redirect. The destination differs; the label does not. One feature
   * has one name wherever it is reached from.
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
     * ★★ Санхүү has its own section as of 2026-08-30, and only its first row.
     *
     * This said finance was "not here… it earns its own section on the day it
     * can answer a question", and that day is what changed: `/admin/funding`
     * reads the month's attendance register priced against the tariffs an
     * administrator has entered. D3 and D4 (the state formula, and what counts
     * as a funding day) are still unanswered by the client and this does not
     * pretend otherwise — `нэмэлт.md` §4 *requires* the tariffs to be
     * configuration rather than code, so the screen shows whatever rules the
     * kindergarten has entered and no government number is hard-coded anywhere
     * behind it. The nine reports and the invoicing flow are still to come, and
     * still get no row until they exist.
     *
     * ★★★ Admin only, and it is the one section that is. §13 of `нэмэлт.md`:
     * "Багш санхүүгийн бүрэн мэдээллийг харах эрхгүй байна". The API agrees —
     * every funding route is `@Roles("ADMIN")` — so a teacher who reached the
     * URL would get a 403 from a menu row that promised otherwise.
     */
    /*
      ★ Five sections, named for the subject matter — the client's 2026-08-30
      drawing.

      The cut before this was Суралцагч · Бүлгийн бүртгэл · Харилцаа холбоо ·
      Систем, which grouped by *what a teacher does to a record*. The client's
      groups by what the work is about, and it puts the two things a teacher
      opens most — the children and their assessment — in one section instead
      of two.

      Three items on the drawing are not reproduced literally, and each is a
      place where the drawing is older than the code:

        - **Баримт бичиг** is drawn greyed with "удахгүй". It shipped with RFP
          §9 on 2026-08-25 and works. Advertising a working feature as missing
          is the mistake this file already records making with Явцын үнэлгээ.
        - **Санхүү** is drawn the same way. It exists as of 2026-08-30 but it
          is the *platform operator's* — `platformNav()` carries it. A greyed
          row here would promise a teacher something that will never arrive for
          their account, which is why "Бүлэг, цэцэрлэгийн мэдээлэл" stopped
          being shown to teachers.
        - **Чат** has no row: the widget floats over every screen
          (`chat-widget.tsx`), so a link would point at something already on
          screen. The drawing predates the widget.
    */
    {
      title: "Хүүхдийн хөгжил ба үнэлгээ",
      entries: [
        entry("Хүүхдүүд", "/children"),
        {
          label: "Явцын үнэлгээ",
          href: scoped("assessment"),
          icon: <ClipboardCheck {...sectionIconProps} />,
        },
        /*
         * ★ Neither review queue is a menu row, decided twice now.
         *
         * **Чөлөөний хүсэлт** is the attendance register read from the other
         * end: approving a request writes the very `Attendance` rows the day
         * sheet is about, so `AttendanceRequestQueue` renders *inside* Ирц
         * under "Эцэг эхийн мэдэгдэл". A separate row asked a teacher to know
         * that the absence they were about to mark by hand might already have
         * been explained on another screen.
         *
         * **Ажиглалт хянах** is reached from the dashboard alert that counts
         * what is waiting. A menu row says nothing about whether there is
         * anything in the queue, so it is a row somebody opens to find out.
         *
         * ★★ Both rows are in the menu, and this note is the third entry in
         * an argument that has now been settled by the person who gets to
         * settle it.
         *
         * They were removed on 2026-08-30 for the reasons above, restored on
         * 2026-08-31 because the client listed both by name in a written list
         * of the destinations the menu must carry, and removed again the same
         * day by `1513f7e` — whose case is the one written above and is a good
         * one: an empty queue is exactly the day nobody needs to open it.
         *
         * The owner chose the client's list. That is the tie-breaker rather
         * than the stronger argument, and deliberately so: the reasoning on
         * both sides is about which is tidier, while the request is about what
         * somebody was promised. Recorded in full so the next person reads a
         * decision instead of a flip-flop.
         */
        entry("Ажиглалт хянах", "/observations/review"),
        entry("Чөлөөний хүсэлт хянах", "/attendance-requests/review"),
      ],
    },
    {
      /*
       * The registers, kept per day.
       *
       * Icons passed explicitly rather than resolved by `routeIcon()`: for a
       * teacher these hrefs carry a group id, so a literal-keyed lookup returns
       * `undefined` and the rows render as bare text — the gap
       * `sidebar.test.tsx` exists to catch.
       */
      title: "Өдөр тутмын бүртгэл",
      entries: [
        { label: "Ирц", href: scoped("attendance"), icon: <CalendarCheck {...sectionIconProps} /> },
        {
          label: "Хоол ба цэс",
          href: scoped("meals"),
          icon: <UtensilsCrossed {...sectionIconProps} />,
        },
      ],
    },
    {
      /*
       * ★ What you set up once, and what you look up afterwards.
       *
       * The seven administration screens were behind the "Удирдлага" hub until
       * 2026-08-30; the hub keeps its row and now sits above them rather than
       * instead of them.
       *
       * A notice goes on a board a family reads at home; a survey asks them a
       * question. Neither is something a teacher does *to* a record, which is
       * what separates them from the sections above.
       */
      title: "Харилцаа холбоо",
      entries: [
        entry("Ангийн самбар / Мэдээ", "/notifications"),
        entry("Судалгаа", "/surveys"),
        /*
         * ★ Чат keeps its row, on the same 2026-08-31 ruling as the two review
         * queues above.
         *
         * The argument against it is real and is the one this file has carried
         * from the start: `chat-widget.tsx` floats over every screen, so a menu
         * entry points at something the reader is already looking at. The
         * client asked for the row anyway — in the navigation drawing and again
         * in writing, after the widget had shipped — and the owner chose the
         * client's list.
         *
         * `/chat` is not merely a second door onto the panel: at `lg` it puts
         * the room list and the open conversation side by side, which the
         * floating panel cannot. It renders the widget's own `ChatList` and
         * `ChatRoom`, so there is one implementation in two frames.
         */
        entry("Чат", "/chat"),
      ],
    },
    ...(isAdmin
      ? [
          {
            title: "Санхүү",
            entries: [
              entry("Ирц ба тооцоолол", "/admin/funding"),
              entry("Ирцийн дэлгэрэнгүй", "/attendance/journal"),
            ],
          },
        ]
      : []),
    {
      title: "Санхүү ба баримт бичиг",
      entries: [
        /*
         * RFP §9 — "Багшид зориулсан PDF баримт бичгийн сан": хөтөлбөр, арга
         * зүй, дотоод журам. Staff only, so it never appears in
         * `parentSections`.
         */
        entry("Баримт бичгийн сан", "/documents"),
      ],
    },
    {
      title: "Багш ба байгууллага",
      entries: [
        entry("Багшийн мэдээлэл", "/settings"),
        /*
         * ★ The seven administration screens, named — and no "Удирдлага" row
         * above them any more.
         *
         * Reaching "Аудит" used to mean opening the hub and finding it among
         * seven tiles: two steps for a screen a director opens daily. Once
         * every one of those screens has its own row, the hub is a row whose
         * only remaining job is to list what is already listed directly
         * beneath it.
         *
         * `/admin` itself stays, and losing its row orphans nothing: signing
         * in *lands* an administrator on it (`app/page.tsx` redirects the root
         * by role), so the row pointed at the page they had just arrived from.
         * It carries kindergarten-wide figures an administrator who also
         * teaches cannot get from `/dashboard`; it is the sidebar line, not the
         * screen, that had stopped earning itself.
         */
        ...adminEntry("Цэцэрлэгийн мэдээлэл", "/admin/kindergarten"),
        ...adminEntry("Хэрэглэгч ба эрх", "/admin/users"),
        ...adminEntry("Хичээлийн жил", "/admin/school-years"),
        ...adminEntry("Улирал", "/admin/terms"),
        ...adminEntry("Үнэлгээний тохиргоо", "/admin/assessment-config"),
        ...adminEntry("Аудит", "/admin/audit"),
      ],
    },
  ];
}

/**
 * The cook's and the accountant's bottom bar — 2026-08-30.
 *
 * ★ One function for both, because they differ by exactly one destination.
 *
 * Each has a screen of their own (the weekly menu, the kindergarten's funding),
 * the news every employee reads, and their profile. Chat is the floating
 * widget, which is on every screen already and needs no tab.
 *
 * Самбар is deliberately absent. `/dashboard` is `RequireRole
 * ["TEACHER","ADMIN"]` and every widget on it is about children — a cook
 * opening it would meet a permission wall on the first screen of the app. The
 * client's list has "Самбар" for both roles, and it is the one line of their
 * sketch that describes a screen neither role can see.
 */
function supportNav(isCook: boolean): NavItem[] {
  return [
    isCook
      ? { href: "/menu", label: "Цэс", icon: <UtensilsCrossed {...iconProps} /> }
      : { href: "/finance", label: "Санхүү", icon: <Wallet {...iconProps} /> },
    { href: "/notifications", label: "Мэдээ", icon: <Newspaper {...iconProps} /> },
    { href: "/settings", label: "Профайл", icon: <Settings {...iconProps} /> },
  ];
}

/**
 * A section row, with its icon resolved from the href.
 *
 * ★ Module-level since 2026-08-30, when `supportSections` needed it too.
 *
 * It was a closure inside `staffSections`, which is fine until a second
 * function wants the same three-line shape — at which point the choice is
 * lifting it or copying it, and a copy is where `routeIcon()` stops being
 * consulted on one of them.
 */
const navEntry = (label: string, href: string) => ({ label, href, icon: routeIcon(href) });

function supportSections(isCook: boolean): NavSection[] {
  return [
    {
      title: isCook ? "Гал тогоо" : "Санхүү",
      entries: isCook
        ? [
            navEntry("Долоо хоногийн цэс", "/menu"),
            navEntry("Орц, түүхий эд", "/kitchen/ingredients"),
            navEntry("Технологийн карт", "/kitchen/recipes"),
            navEntry("Нийлүүлэгч", "/kitchen/suppliers"),
            navEntry("Хүнсний захиалга", "/kitchen/orders"),
            navEntry("Нөөц", "/kitchen/stock"),
            navEntry("Тайлан", "/kitchen/reports"),
          ]
        : [
            navEntry("Санхүүжилт", "/finance"),
            navEntry("Эцэг эхийн нэхэмжлэл", "/invoices"),
            /*
             * ★ Added 2026-09-02. `/admin/funding` widened to
             * `RequireRole(["ADMIN", "ACCOUNTANT"])` the same day — see that
             * page's own comment — because `нэмэлт.md` §13 names "Улсын
             * санхүүжилт" and "Төлбөрийн тулгалт" for this role and the API
             * had allowed it since the role shipped. A widened `RequireRole`
             * with no row pointing at it is a page an accountant can only
             * reach by typing the URL, which is the same kind of gap this
             * screen exists to close.
             */
            navEntry("Ирц ба тооцоолол", "/admin/funding"),
            /*
             * ★ The raw grid the figure above is computed from — child by
             * child, day by day, over any range of dates. `/admin/funding`
             * answers "what does the month come to"; this answers "who was
             * here, and when", which is the question that precedes it and the
             * one an accountant is asked when a number is queried.
             */
            navEntry("Ирцийн дэлгэрэнгүй", "/attendance/journal"),
            navEntry("Санхүүгийн аудит", "/finance/audit-log"),
          ],
    },
    {
      title: "Харилцаа холбоо",
      entries: [navEntry("Ангийн самбар / Мэдээ", "/notifications")],
    },
    {
      title: "Миний мэдээлэл",
      entries: [navEntry("Профайл", "/settings")],
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
    /*
      ★ Санхүү — the operator's own money, not a kindergarten's.

      `/kindergartens/:id/funding` is the administrator's screen and correctly
      refuses a superadmin, who holds no membership (§1.1). This is the question
      above it: what arrived across every kindergarten, and how the agreed
      shares divide it. It is the second item because registering kindergartens
      is still the operator's first job — §7 keeps the platform surface small,
      and this is the one addition the client asked for.
    */
    { href: "/platform/revenue", label: "Санхүү", icon: <Wallet {...iconProps} /> },
    { href: "/settings", label: "Профайл", icon: <Settings {...iconProps} /> },
  ];
}

/**
 * Parent navigation — five items: Нүүр / Мэдээ / Зураг / Хоол / Цэс.
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
 * ★★ "Зураг" and "Хоол" are plain links, no popup — each goes straight to
 * the *selected* child's `/overview` or `/menu` (2026-08-28: was always the
 * first child before the switcher existed — see `SelectedChildProvider`).
 * Before `myChildren` has loaded (or for a family connected to none), both
 * fall back to `/children` — a real list, never a dead link.
 *
 * "Ирц" and "Хоол ба цэс" briefly had their own bottom-bar tabs, each
 * resolving to a `?tab=` deep link on a confirmed single child or to
 * `/children` otherwise — removed for exactly the reason "Хоол" now avoids:
 * for any family that isn't exactly one child, that put multiple tabs on the
 * same `/children` destination with nothing to say which child they meant.
 * `SelectedChildProvider` is what makes bringing "Хоол" back honest — the
 * tab now always resolves to one specific child's menu, the same one every
 * other selected-child destination in the shell already points at.
 *
 * `myChildren` comes from `AppLayout`, which owns the query — this function
 * has no hooks of its own to fetch with.
 */
function parentNav(
  myChildren: ChildSummary[] | undefined,
  selectedChildId: string | undefined,
): NavItem[] {
  const activeId = selectedChildId ?? myChildren?.[0]?.id;
  const zuragHref = activeId ? `/children/${activeId}/overview` : "/children";
  const hoolHref = activeId ? `/children/${activeId}/menu` : "/children";

  return [
    { href: "/home", label: "Нүүр", icon: <Home {...iconProps} /> },
    { href: "/notifications", label: "Мэдээ", icon: <Bell {...iconProps} />, badge: "unread" },
    { href: zuragHref, label: "Зураг", icon: <Images {...iconProps} /> },
    { href: hoolHref, label: "Хоол", icon: <UtensilsCrossed {...iconProps} /> },
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
 * ★★ Four rows for the *selected* child, not one, since the child hub was
 * deleted (2026-08-28) — it used to carry Ерөнхий and Ажиглалт as tabs on one
 * page, and without that page a desktop reader needs both named here
 * directly. `/general`'s icon is the child's own avatar, matching every
 * per-child row this menu has ever shown; Ажиглалт, Хоол and Цэцэрлэгийн
 * архив underneath it carry a plain glyph instead.
 *
 * ★★★ One child, not every child — 2026-08-28's second change the same day.
 * This mapped every one of a family's children in, which put two identical
 * "Ажиглалт" rows on the menu for any family with two — the same label twice
 * with nothing beside it to say whose. `SelectedChildProvider` (the
 * switcher `app-shell.tsx` renders above this section) is what disambiguates
 * now: one child is "current" at a time, same as `parentNav`'s "Зураг" and
 * "Хоол" tabs, and this section follows it rather than listing everyone at
 * once. "Хоол" joined the same day, mirroring `parentNav`'s own addition —
 * both surfaces name the same three destinations for the same reason.
 *
 * "Цэцэрлэгийн архив" joined later, at the client's request for a "Цэцэрлэг,
 * бүлгийн архив" screen: current placement, its teacher, and the family's
 * full enrollment history (`/children/[childId]/enrollment-archive`). It has
 * no bottom-bar tab of its own — that row is spent on `parentNav`'s four
 * destinations already — so a phone reader reaches it from the home page's
 * "Цэцэрлэг" tile (`(app)/home/page.tsx`) instead.
 */
function parentSections(
  myChildren: ChildSummary[] | undefined,
  selectedChildId: string | undefined,
): NavSection[] {
  const selected = myChildren?.find((child) => child.id === selectedChildId) ?? myChildren?.[0];

  /*
   * ★ Seven rows for the selected child, not two.
   *
   * A parent's whole product *is* their child's file, and three of its tabs —
   * Ирц, Хоол, Судалгаа — had no name anywhere in this menu even though a
   * parent opens them constantly and each is a real route. They were reachable
   * only by landing on the child's page first and finding the tab, which is a
   * menu that names a third of what it leads to.
   *
   * The switcher above decides *which* child; these rows decide *what about
   * them*, so they follow the selection rather than repeating per child.
   *
   * ★★ "Цэцэрлэгийн архив" is not the sixth any more and it still comes from
   * `main`, not from here. It is the one row that is not about a day —
   * placement, teacher and the family's full enrollment history — so it sits
   * last, after the ones that are. Its icon stays `Building2`, the glyph
   * `main` chose for it, but spelled with `sectionIconProps` like every other
   * row in this list: the size is the same 18 either way, and this file
   * already argues that writing the number inline is "the same number three
   * times and no name for it".
   *
   * ★★★ "Төлбөр" joined 2026-09-01, once `ChildInvoicesController` and
   * `/children/[childId]/finance` existed to point it at — see that route's
   * own comment. It sits beside Хоол rather than after Судалгаа: both are
   * money the family owes the kindergarten for the same reason, tuition and
   * meals together, and a parent scanning this list reads them as one kind of
   * thing.
   */
  const childEntries = selected
    ? [
        {
          label: fullName(selected),
          href: `/children/${selected.id}/general`,
          icon: <ChildAvatar child={selected} size={24} />,
        },
        {
          label: "Ажиглалт",
          href: `/children/${selected.id}/observations`,
          icon: <NotebookPen {...sectionIconProps} />,
        },
        {
          label: "Ирц",
          href: `/children/${selected.id}/attendance`,
          icon: <CalendarCheck {...sectionIconProps} />,
        },
        {
          label: "Хоол",
          href: `/children/${selected.id}/menu`,
          icon: <UtensilsCrossed {...sectionIconProps} />,
        },
        {
          label: "Төлбөр",
          href: `/children/${selected.id}/finance`,
          icon: <Receipt {...sectionIconProps} />,
        },
        {
          label: "Судалгаа",
          href: `/children/${selected.id}/surveys`,
          icon: <BarChart3 {...sectionIconProps} />,
        },
        {
          label: "Цэцэрлэгийн архив",
          href: `/children/${selected.id}/enrollment-archive`,
          icon: <Building2 {...sectionIconProps} />,
        },
      ]
    : [{ label: "Холбогдсон хүүхэд алга" }];

  return [
    { title: "Хүүхдийн мэдээлэл", entries: childEntries },
    {
      /*
       * ★ Чат has no row here either, for the reason `staffSections` gives:
       * `ChatWidget` floats on every screen for every role, with its own unread
       * badge. A menu row beside a button already on screen is a second way in
       * for a feature that needs one.
       */
      title: "Харилцаа холбоо",
      entries: [entry("Мэдээ", "/notifications")],
    },
    {
      /*
       * ★ The inert "Санхүү" row that used to sit here is gone for good, not
       * merely renamed. It was label-only — the reference's device for naming
       * a feature the build had not reached — and this file argued three
       * times that a grey row teaches a family only that something is
       * missing. Parent invoices are built now (`нэмэлт.md` §7–§10), so the
       * real row lives with the rest of the selected child's own tabs above
       * ("Төлбөр"), not here: a family's money is about a specific child, the
       * same reason Ирц and Хоол are child rows rather than kindergarten-wide
       * settings.
       */
      title: "Тохиргоо",
      entries: [entry("Миний бүртгэл", "/settings")],
    },
  ];
}

"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  BookOpen,
  Boxes,
  Carrot,
  ClipboardList,
  FileText,
  Home,
  Images,
  LayoutGrid,
  Menu,
  CalendarDays,
  CalendarRange,
  Database,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  UserCog,
  FileBarChart,
  FileCheck2,
  Headphones,
  HelpCircle,
  LockKeyhole,
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
import { useMyGroup } from "@/components/dashboard/use-my-group";
import { LoadingState } from "@/components/ui/states";
import { Art, type ArtName } from "@/components/ui/art";
import { useNavigationHistory } from "@/lib/nav-history";
import { useSession } from "@/lib/auth/session";
import { SelectedChildProvider, useSelectedChild } from "@/lib/selected-child";

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
  // Counts navigations so `BackButton` knows whether there is anywhere to go
  // back *to*. Mounted here because it has to see every route change, and this
  // shell is the one thing under `(app)` that never unmounts between them.
  useNavigationHistory();
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
    enabled: Boolean(session) && !isSuperAdmin && !isStaff && !isCook && !isAccountant,
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
      <AppShell nav={platformNav()} variant="platform" workspaceTheme="platform">
        {children}
      </AppShell>
    );
  }

  // Ahead of the provider for the same reason the superadmin branch is. A cook
  // and an accountant have no selected child to provide; their shell contains
  // only the operational screens for their role.
  if (isCook || isAccountant) {
    return (
      <AppShell
        nav={supportNav(isCook)}
        sections={supportSections(isCook)}
        variant="teacher"
        workspaceTheme={isCook ? "kitchen" : "finance"}
      >
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

  const currentChildId = selectedChildId ?? myChildren?.[0]?.id;

  // The parent reference keeps the selected child at the top even for a
  // one-child family. With several children this is a real switcher; with one
  // it remains the sidebar's visual context rather than disappearing.
  const childSwitcher: ChildSwitcher | undefined =
    !isStaff && myChildren && myChildren.length > 0 && currentChildId
      ? {
          children: myChildren,
          selectedId: currentChildId,
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
      teacherTheme={isStaff && !isAdmin}
      workspaceTheme={isAdmin ? "admin" : isStaff ? "teacher" : "parent"}
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

const ROUTE_ART: Partial<Record<string, ArtName>> = {
  "/dashboard": "dashboard",
  "/children": "child",
  "/attendance-requests/review": "attendance",
  "/attendance/daily": "attendance",
  "/attendance/journal": "attendance",
  "/kitchen/attendance": "attendance",
  "/notifications": "notice",
  "/surveys": "survey",
  "/chat": "chat",
  "/documents": "documents",
  "/settings": "settings",
  "/reports": "report",
  "/incidents": "safety",
  "/admin/groups": "group",
  "/menu": "food",
  "/kitchen/recipes": "food",
  "/finance": "finance",
  "/invoices": "finance",
  "/admin/funding": "finance",
  "/platform": "kindergarten",
  "/platform/revenue": "finance",
  "/platform/applications": "kindergarten",
  "/admin/kindergarten": "kindergarten",
};

function artIcon(name: ArtName, size: 18 | 20) {
  return <Art name={name} size={size} className={size === 20 ? "size-5" : "size-[18px]"} />;
}

/**
 * One icon per destination, chosen once.
 *
 * ★ Keyed by `href`, and that is the point rather than a convenience.
 *
 * Several routes appear in more than one menu — `/notifications` is in the
 * staff sections, the parent sections and both bottom bars; `/settings` is in
 * three. Each call site used to pick its own glyph, and they had already
 * drifted: the same route was `Bell` in one list and nothing at all in
 * another. `ROUTE_ART` holds the owner's illustrated feature icons and
 * `ROUTE_ICON` holds the remaining Lucide glyphs; both are keyed by destination,
 * making "the same feature, two icons" unrepresentable instead of merely
 * discouraged.
 *
 * `/observations/review` keeps its existing `ClipboardList`; supplied feature
 * drawings live in `ROUTE_ART`, so the phone bar and desktop sidebar always
 * agree on the same asset.
 */
const ROUTE_ICON: Record<string, LucideIcon> = {
  "/dashboard": LayoutGrid,
  "/home": Home,
  "/observations/review": ClipboardList,
  "/documents": FileText,
  "/settings": Settings,
  "/finance/audit-log": ScrollText,
  "/kitchen/dashboard": LayoutGrid,
  "/kitchen/ingredients": Carrot,
  "/kitchen/suppliers": Truck,
  "/kitchen/orders": ShoppingCart,
  "/kitchen/stock": Boxes,
  "/kitchen/reports": BarChart3,
  "/admin": ShieldCheck,
  "/reports": FileBarChart,
  "/incidents": ShieldAlert,

  /* Administration screens without supplied feature artwork. */
  "/admin/users": UserCog,
  "/admin/school-years": CalendarRange,
  "/admin/terms": CalendarDays,
  "/admin/assessment-config": SlidersHorizontal,
  "/admin/audit": ScrollText,
  "/admin/integrations/esis": Database,
  "/admin/curriculum": BookOpen,
};

/** The section-level icon for a route, or nothing if it has no destination. */
function routeIcon(href: string | undefined) {
  if (!href) return undefined;
  const art = ROUTE_ART[href];
  if (art) return artIcon(art, 18);

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
    { href: "/dashboard", label: "Самбар", icon: artIcon("dashboard", 20) },
    { href: "/notifications", label: "Мэдээ", icon: artIcon("notice", 20), badge: "unread" },
    { href: assessmentHref, label: "Явцын үнэлгээ", icon: artIcon("progress", 20) },
    { href: "/surveys", label: "Судалгаа", icon: artIcon("survey", 20) },
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
 * **The administration screens are rows now.** They were all behind a single
 * "Удирдлага" hub, so a director looking for "Улирал" read one word that did
 * not say it and had to open a page to find out. The reference names its
 * destinations directly and it is right to: a menu whose job is to say what is
 * in the product should not make you open a screen to read the menu.
 *
 * The hub kept its own row for a day and then lost that too, and on 2026-09-04
 * lost its tiles as well — `/admin` is the administrator's dashboard now, not a
 * list of links to what this menu already names. `Бүлгүүд` joined the rows in
 * the same pass, being the one destination the tiles carried that these rows
 * did not — and moved up under Хүүхдүүд the same day, where the question it
 * answers actually belongs.
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
        /*
         * ★ Directly under Хүүхдүүд, moved there 2026-09-04 at the client's
         * request — and it is the right place for it.
         *
         * It sat in "Багш ба байгууллага" with the setup screens, among the
         * things you configure once a year. But a group is a list of children
         * with two teachers on it, and the question that sends somebody here —
         * "who is in Дэлбээ?" — is the same question the row above answers for
         * the whole kindergarten. Setup screens are what you visit in August;
         * this one is visited all year.
         */
        ...adminEntry("Бүлгүүд", "/admin/groups"),
        {
          label: "Явцын үнэлгээ",
          href: scoped("assessment"),
          icon: artIcon("progress", 18),
        },
        /*
         * ★ "Тайлан" — added 2026-09-05, at the client's request, after they
         * compared this menu with the reference system's.
         *
         * It goes here because that is where the reference puts it: under the
         * development-and-assessment heading, below Явцын үнэлгээ. It is the
         * teacher's own group read by the month, which is what a teacher means
         * by a report — the director's cross-group view is Ирц, and one child's
         * narrative is on the child.
         *
         * ★★ The screen was built rather than the row pointed at something
         * adjacent. `/attendance/daily` is ADMIN/ACCOUNTANT and `term-report`
         * is per child, so there was no existing destination — and a row that
         * 404s is exactly what rule 1 above forbids.
         */
        entry("Тайлан", "/reports"),
        /*
         * ★ Neither review queue is a menu row — settled 2026-09-04, and this
         * time by the client rather than by the argument.
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
         * ★★ The history, because this row has now moved four times.
         *
         * Removed 2026-08-30 for the reasons above; restored 2026-08-31
         * because the client listed both by name among the destinations the
         * menu must carry; removed again the same day by `1513f7e`; restored
         * again when the owner chose the client's list over the tidier
         * argument. On 2026-09-04 the client asked for both to go — "ажиглалт,
         * чөлөөний хүсэлт 2 огт хэрэггүй" — which settles it in the same
         * direction the reasoning always pointed.
         *
         * ★★★ **The rows go; the screens and the endpoints stay.**
         *
         * `/observations/review` and `/attendance-requests/review` still
         * render, and both are still linked from where they are actually
         * needed — the dashboard's waiting-count alert, `AttendanceRequestQueue`
         * inside Ирц, and `/admin/funding`. Deleting them would take the
         * guardian's own "Чөлөө хүсэх" with it, which is a parent-facing
         * feature nobody asked to remove.
         */
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
        /*
         * ★ "Ирц" means two different screens, and which one you get is the
         * job you have — 2026-09-04.
         *
         * A teacher lands on their group's day sheet, where a child is a row
         * and six buttons record the morning. An administrator lands on
         * `/attendance/daily`, which is the same register at the grain they
         * asked for: one row per group per day, counts only, nothing to press.
         * The client was explicit — "ерөөсөө захирал тэнд ирсэн, хагас өдөр
         * гэх мэт тийм товчнуудыг дарахгүй".
         *
         * ★★ An administrator who also teaches gets the director's screen,
         * because that is the one their `isAdmin` says they can read. Their
         * own group's sheet is a click away from any row of it — the group
         * name on each row links to that group's day sheet.
         */
        {
          label: "Ирц",
          href: isAdmin ? "/attendance/daily" : scoped("attendance"),
          icon: artIcon("attendance", 18),
        },
        {
          label: "Хоол ба цэс",
          href: scoped("meals"),
          icon: artIcon("food", 18),
        },
        entry("Аюулгүй байдал", "/incidents"),
      ],
    },
    {
      /*
       * ★ What you set up once, and what you look up afterwards.
       *
       * The administration screens were behind the "Удирдлага" hub until
       * 2026-08-30. They are rows of their own now, and the hub is no longer a
       * hub at all — see the note above `adminEntry` below.
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
        /*
         * ★ "Хувийн тохиргоо", not "Багшийн мэдээлэл" — renamed 2026-09-06 at
         * the client's request.
         *
         * The row points at `/settings`, which is the signed-in person's *own*
         * account: their name, their contact details, their password. It is
         * not a directory of the kindergarten's teachers — that is
         * "Хэрэглэгч ба эрх" one row below, and the old name promised this row
         * was it. A cook and an accountant share this menu too, so "Багшийн"
         * was wrong for them in a second way.
         */
        entry("Хувийн тохиргоо", "/settings"),
        /*
         * ★ The administration screens, named — and no "Удирдлага" row above
         * them any more.
         *
         * Reaching "Аудит" used to mean opening the hub and finding it among
         * seven tiles: two steps for a screen a director opens daily. Once
         * every one of those screens has its own row, the hub was a row whose
         * only remaining job was to list what is already listed directly
         * beneath it.
         *
         * `/admin` itself stays, and losing its row orphans nothing: signing
         * in *lands* an administrator on it (`app/page.tsx` redirects the root
         * by role), so the row pointed at the page they had just arrived from.
         *
         * ★★ And on 2026-09-04 the page stopped being a hub too. Its tiles
         * were the same six destinations these rows name, so it was listing
         * the menu beside it; `AdminOverview` moved onto the URL instead, from
         * a branch inside `/dashboard` that the login redirect never reached.
         * What is left there is the kindergarten-wide dashboard — figures no
         * row here can carry — which is what makes the missing row correct
         * rather than merely tolerable.
         */
        ...adminEntry("Цэцэрлэгийн мэдээлэл", "/admin/kindergarten"),
        ...adminEntry("Хэрэглэгч ба эрх", "/admin/users"),
        ...adminEntry("Хичээлийн жил", "/admin/school-years"),
        ...adminEntry("Улирал", "/admin/terms"),
        /*
         * ★ Added 2026-09-10 with the four ESIS curriculum services. It sits
         * after Улирал because it answers the same kind of question — what
         * shape does the year take — and before the ESIS hub, which is the
         * operator's whole-catalog view rather than a working screen.
         */
        ...adminEntry("Сургалтын хөтөлбөр", "/admin/curriculum"),
        ...adminEntry("ESIS мэдээллийн төв", "/admin/integrations/esis"),
        /*
         * ★ "Үнэлгээний тохиргоо" and "Аудит" lost their rows on 2026-09-06,
         * at the client's request — and, as with the two review queues above,
         * **the rows go and the screens stay.**
         *
         * `/admin/assessment-config` and `/admin/audit` still render, still
         * carry their own `RequireRole`, and are still reached from where the
         * question actually arises: the assessment configuration from
         * `/admin` overview, and the audit trail from the same place plus
         * `/finance`'s own "Аудит" link. Neither is a screen a director opens
         * daily — the configuration is August work and the audit log is
         * something you go to *because* of a question — so a permanent row
         * for each was two of the eight rows in this section spent on
         * occasional work.
         */
      ],
    },
  ];
}

/**
 * The cook's and the accountant's bottom bar.
 *
 * ★ One function for both — kept together because they used to differ by
 * exactly one destination. They now differ in shape as well as content, which
 * is why each branch returns its own array rather than sharing one built from
 * per-position ternaries.
 *
 * ★★ The cook's bar went from three tabs to the four-tab shape `staffNav` and
 * `parentNav` already use — Самбар · Хоолны цэс · Технологийн карт · Цэс —
 * 2026-09-05, on the client's own drawing for this role. The last tab opens
 * `MobileMenuDrawer` rather than navigating: `AppShell`'s `bottomNav` mapping
 * matches on the `/settings` href, not the label, so renaming "Профайл" to
 * "Цэс" and its icon to `Menu` is enough to make it read as the same hamburger
 * button every other role's last tab already is. The drawer is where
 * everything this bar has no room for still lives — Түүхий эд, Хүнсний
 * захиалга, Нөөц, Ирц, Тайлан, Мэдээ (COOK only, 2026-09-08), Чат — unchanged
 * from `supportSections`. ("Нийлүүлэгч" is off `supportSections` itself right
 * now, so it is not in the drawer either — see that array's own comment.)
 *
 * This does put `/menu` and `/kitchen/recipes` on two surfaces at once, both
 * already reachable from the sidebar. The 2026-09-04 note this replaced
 * argued against exactly that, but for a *second bottom-bar tab* pointing at
 * a route the first tab already opened — the same route was never a bottom
 * bar's *only* door in this file: `staffNav`'s Самбар and `parentNav`'s Хоол
 * duplicate a sidebar row on purpose, because the bar's whole job is a
 * one-tap phone route to what the drawer would otherwise cost a tap to reach.
 *
 * ★★★ The accountant's bar moved onto the same four-tab shape on 2026-09-07 —
 * Санхүү · Нэхэмжлэл · Ирц · Цэс, matching the cook's row above and
 * `staffNav`/`parentNav`. It was Санхүү, Мэдээ, Профайл: "Мэдээ" pointed at
 * `/notifications`, a class's board an accountant does not belong to (the
 * same reason it lost its `supportSections` row on 2026-09-05, see below —
 * this bar had simply not been revisited to match). `/invoices` and
 * `/attendance/journal` replace it with the two screens this role actually
 * opens daily, both already one tap away in `supportSections`; the last tab
 * is the drawer, not a fourth destination, for the reason the cook's is.
 */
function supportNav(isCook: boolean): NavItem[] {
  return isCook
    ? [
        { href: "/kitchen/dashboard", label: "Самбар", icon: <LayoutGrid {...iconProps} /> },
        { href: "/menu", label: "Хоолны цэс", icon: artIcon("food", 20) },
        { href: "/kitchen/recipes", label: "Технологийн карт", icon: artIcon("food", 20) },
        { href: "/settings", label: "Цэс", icon: <Menu {...iconProps} /> },
      ]
    : [
        { href: "/finance", label: "Санхүү", icon: artIcon("finance", 20) },
        { href: "/invoices", label: "Нэхэмжлэл", icon: artIcon("finance", 20) },
        { href: "/attendance/journal", label: "Ирц", icon: artIcon("attendance", 20) },
        { href: "/settings", label: "Цэс", icon: <Menu {...iconProps} /> },
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
            navEntry("Хоолны цэс", "/menu"),
            navEntry("Түүхий эд", "/kitchen/ingredients"),
            navEntry("Технологийн карт", "/kitchen/recipes"),
            // ★ "Нийлүүлэгч" (/kitchen/suppliers) off the sidebar — restored
            // briefly 2026-09-08, taken off again the same day: still "not
            // needed for now" per the client. The route and its data are
            // untouched; a food order still names a supplier, this just stops
            // promoting the management screen for it. Re-add the row here to
            // bring it back.
            navEntry("Хүнсний захиалга", "/kitchen/orders"),
            navEntry("Нөөц", "/kitchen/stock"),
            navEntry("Ирц", "/kitchen/attendance"),
            navEntry("Тайлан", "/kitchen/reports"),
          ]
        : [
            navEntry("Санхүүжилт", "/finance"),
            navEntry("Нэхэмжлэл", "/invoices"),
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
      /*
       * ★ Чат, not "Ангийн самбар / Мэдээ" — 2026-09-05.
       *
       * The row pointed at `/notifications`, which is a class's board: posts
       * scoped to a group a cook or an accountant does not belong to. Neither
       * role had a full-page door onto chat before this — only the floating
       * widget (`chat-widget.tsx`) — while `staffSections` has carried one
       * beside its own notifications row since 2026-08-31. This gives them
       * that same page, in the one slot this section has.
       *
       * ★★ "Мэдээ" returns for COOK only, 2026-09-08 — client decision. The
       * board is no longer a class-scoped thing this role can't reach:
       * `NotificationsService.audienceFilter` now reads a cook's own
       * kindergarten-wide, published notices (closures, holidays) the same
       * way staff do, while `create()` still refuses them — read, not post.
       * Accountant is untouched; that role's audience filter was not widened.
       */
      title: "Харилцаа холбоо",
      entries: isCook
        ? [navEntry("Мэдээ", "/notifications"), navEntry("Чат", "/chat")]
        : [navEntry("Чат", "/chat")],
    },
    {
      title: "Миний мэдээлэл",
      entries: [navEntry("Хувийн тохиргоо", "/settings")],
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
    { href: "/platform", label: "Цэцэрлэгүүд", icon: artIcon("kindergarten", 20) },
    /*
      ★ Санхүү — the operator's own money, not a kindergarten's.

      `/kindergartens/:id/funding` is the administrator's screen and correctly
      refuses a superadmin, who holds no membership (§1.1). This is the question
      above it: what arrived across every kindergarten, and how the agreed
      shares divide it. It is the second item because registering kindergartens
      is still the operator's first job — §7 keeps the platform surface small,
      and this is the one addition the client asked for.
    */
    { href: "/platform/revenue", label: "Санхүү", icon: artIcon("finance", 20) },
    /*
      ★ The onboarding queue — `docs/CONTRACT_ONBOARDING.md` step 3. It sits
      below the money because approving an application is occasional work and
      reading the month's income is not, but it is on the sidebar rather than
      buried: an application nobody looks at is a kindergarten that filled in a
      form and never heard back.
    */
    {
      href: "/platform/applications",
      label: "Байгууллагын хүсэлт",
      icon: artIcon("kindergarten", 20),
    },
    { href: "/settings", label: "Хувийн тохиргоо", icon: <Settings {...iconProps} /> },
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
  const zuragHref = activeId ? `/children/${activeId}/portfolio/gallery` : "/children";
  const hoolHref = activeId ? `/children/${activeId}/menu` : "/children";

  return [
    { href: "/home", label: "Нүүр", icon: <Home {...iconProps} /> },
    { href: "/notifications", label: "Мэдээ", icon: artIcon("notice", 20), badge: "unread" },
    { href: zuragHref, label: "Зураг", icon: <Images {...iconProps} /> },
    { href: hoolHref, label: "Хоол", icon: artIcon("food", 20) },
    { href: "/settings", label: "Цэс", icon: <Menu {...iconProps} /> },
  ];
}

/** The flat guardian menu; the selected child supplies every child-scoped URL. */
function parentSections(
  myChildren: ChildSummary[] | undefined,
  selectedChildId: string | undefined,
): NavSection[] {
  const selected = myChildren?.find((child) => child.id === selectedChildId) ?? myChildren?.[0];

  const childBase = selected ? `/children/${selected.id}` : "/children";

  return [
    {
      title: "Эцэг эхийн үндсэн цэс",
      entries: [
        {
          label: "Хүүхдийн мэдээлэл",
          href: selected ? `${childBase}/general` : childBase,
          icon: artIcon("child", 20),
        },
        {
          label: "Цахим хувийн хавтас",
          href: selected ? `${childBase}/portfolio` : childBase,
          icon: <Images {...iconProps} />,
        },
        {
          label: "Цэцэрлэгийн мэдээлэл",
          href: selected ? `${childBase}/enrollment-archive` : childBase,
          icon: artIcon("kindergarten", 20),
        },
        {
          label: "Мэдээ",
          href: "/notifications",
          icon: artIcon("notice", 20),
          badge: "unread",
        },
        {
          label: "Багштай холбогдох",
          href: "/chat",
          icon: artIcon("chat", 20),
        },
      ],
    },
    {
      title: "Үйлчилгээ ба тусламж",
      separatorBefore: true,
      entries: [
        {
          label: "Үйлчилгээний эрх",
          href: selected ? `${childBase}/finance` : childBase,
          icon: <ShieldCheck {...iconProps} />,
          tag: "Жилийн",
        },
        { label: "Миний гэрээ", icon: <FileText {...iconProps} /> },
        { label: "Гарын авлага", icon: <BookOpen {...iconProps} /> },
        { label: "Түгээмэл асуулт", icon: <HelpCircle {...iconProps} /> },
        {
          label: "Холбоо барих",
          href: "mailto:Nomadkidsmn@gmail.com",
          icon: <Headphones {...iconProps} />,
        },
        { label: "Үйлчилгээний нөхцөл", icon: <FileCheck2 {...iconProps} /> },
        { label: "Нууцлалын бодлого", icon: <LockKeyhole {...iconProps} /> },
      ],
    },
  ];
}

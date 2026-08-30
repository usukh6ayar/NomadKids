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
  CalendarDays,
  CalendarRange,
  School,
  ScrollText,
  Settings,
  Shapes,
  ShieldCheck,
  SlidersHorizontal,
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
  "/surveys": BarChart3,
  "/documents": FileText,
  "/settings": Settings,
  "/admin": ShieldCheck,
  "/admin/funding": Wallet,
  "/platform": Building2,

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
 * ★★ **Rewritten 2026-08-30 to the client's own reference sidebar**, which
 * groups the product in three: Сургалт ба сурагчид · Үйл ажиллагаа ба санхүү ·
 * Систем ба тохиргоо. Those names are kept exactly; what they hold is this
 * product's screens rather than the reference's, which differ in three ways
 * worth naming.
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

  /*
   * ★ The three group-scoped rows name their icons inline.
   *
   * For a teacher these hrefs carry a group id, so `routeIcon()`'s literal
   * lookup returns `undefined` and the rows would render as bare text — the
   * exact gap `sidebar.test.tsx` exists to catch.
   */
  const scopedEntry = (label: string, feature: string, icon: ReactNode) => ({
    label,
    href: scoped(feature),
    icon,
  });

  return [
    {
      /*
       * ★ The children, and everything recorded against them.
       *
       * Ирц and Үнэлгээ sit here rather than in a registers section of their
       * own, which is where a previous pass put them. The reference is right
       * and the reason is the audience: a teacher does not think "now I will
       * use a register", they think "now I will do something with my group".
       * Хоол ба цэс is the one that leaves — see the next section.
       */
      title: "Сургалт ба сурагчид",
      entries: [
        entry("Хүүхдийн удирдлага", "/children"),
        ...adminEntry("Бүлгийн удирдлага", "/admin/groups"),
        scopedEntry("Ирц", "attendance", <CalendarCheck {...sectionIconProps} />),
        scopedEntry("Үнэлгээ", "assessment", <ClipboardCheck {...sectionIconProps} />),
        entry("Ажиглалт хянах", "/observations/review"),
        /*
         * "Чөлөөний хүсэлт", not "…хүсэлт хянах". The rail fits about twenty
         * characters at `text-compact` beside a 16px icon; the longer label is
         * twenty-one and clipped on every desktop. The row above it already
         * establishes that a review queue is what this part of the menu holds.
         */
        entry("Чөлөөний хүсэлт", "/attendance-requests/review"),
      ],
    },
    {
      /*
       * ★ What the kindergarten *runs*, and what it costs — the reference's own
       * pairing, and the half this product kept splitting apart.
       *
       * Хоол ба цэс is here rather than beside Ирц because the kitchen is an
       * operation: somebody cooks, somebody counts portions, and the same
       * numbers land in Санхүү two rows down as "хооллосон өдөр". Мэдээ and
       * Судалгаа are here because both go *out* — to a family, at home — which
       * is the same kind of work and not something done to a child's record.
       */
      title: "Үйл ажиллагаа ба санхүү",
      entries: [
        scopedEntry("Хоол ба цэс", "meals", <UtensilsCrossed {...sectionIconProps} />),
        /*
         * ★ Санхүү arrived 2026-08-30 and is admin-only.
         *
         * `нэмэлт.md` §13: "Багш санхүүгийн бүрэн мэдээллийг харах эрхгүй
         * байна". Every funding route is `@Roles("ADMIN")`, so a teacher who
         * followed this row would get a 404 from a menu that promised a screen.
         *
         * It reads the month's attendance register priced against the tariffs
         * an administrator has entered. D3 and D4 — the state formula, and what
         * counts as a funding day — are still unanswered by the client, and
         * `нэмэлт.md` §4 requires the tariffs to be configuration rather than
         * code, so nothing from a government schedule is hard-coded behind it.
         */
        ...adminEntry("Санхүү", "/admin/funding"),
        /*
         * The reference calls this "Мэдээ / Ангийн самбар" and both halves are
         * true — it is the board a family reads at home. Shortened because the
         * full label is twenty-one characters in a rail that fits twenty, and
         * a destination whose name ends in "…" is the fault this file has
         * already fixed once.
         */
        entry("Мэдээ ба самбар", "/notifications"),
        entry("Судалгаа", "/surveys"),
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
       * Хичээлийн жил and Улирал are two rows where the reference has one
       * ("Улирал, хичээлийн жил") because this product has two screens, and one
       * row would have to drop a reader on one of them and leave the other
       * unnamed. Both labels fit; the combined one does not.
       */
      title: "Систем ба тохиргоо",
      entries: [
        ...adminEntry("Удирдлага", "/admin"),
        ...adminEntry("Цэцэрлэгийн мэдээлэл", "/admin/kindergarten"),
        ...adminEntry("Хэрэглэгч ба эрх", "/admin/users"),
        ...adminEntry("Хичээлийн жил", "/admin/school-years"),
        ...adminEntry("Улирал", "/admin/terms"),
        ...adminEntry("Үнэлгээний тохиргоо", "/admin/assessment-config"),
        ...adminEntry("Аудит", "/admin/audit"),
        /*
         * RFP §9 — "Багшид зориулсан PDF баримт бичгийн сан": хөтөлбөр, арга
         * зүй, дотоод журам. Staff only, so it never appears in
         * `parentSections`. Reference material, which is what this section is
         * for — a shelf you read from is not an activity.
         */
        entry("Баримт бичгийн сан", "/documents"),
        entry("Багшийн мэдээлэл", "/settings"),
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
 * ★★ Three rows for the *selected* child, not one, since the child hub was
 * deleted (2026-08-28) — it used to carry Ерөнхий and Ажиглалт as tabs on one
 * page, and without that page a desktop reader needs both named here
 * directly. `/general`'s icon is the child's own avatar, matching every
 * per-child row this menu has ever shown; Ажиглалт and Хоол underneath it
 * carry a plain glyph instead.
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
 */
function parentSections(
  myChildren: ChildSummary[] | undefined,
  selectedChildId: string | undefined,
): NavSection[] {
  const selected = myChildren?.find((child) => child.id === selectedChildId) ?? myChildren?.[0];

  /*
   * ★ Five rows for the selected child, not two.
   *
   * A parent's whole product *is* their child's file, and three of its tabs —
   * Ирц, Хоол, Судалгаа — had no name anywhere in this menu even though a
   * parent opens them constantly and each is a real route. They were reachable
   * only by landing on the child's page first and finding the tab, which is a
   * menu that names a third of what it leads to.
   *
   * The switcher above decides *which* child; these rows decide *what about
   * them*, so they follow the selection rather than repeating per child.
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
          label: "Судалгаа",
          href: `/children/${selected.id}/surveys`,
          icon: <BarChart3 {...sectionIconProps} />,
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
       * ★ The inert "Санхүү" row is gone.
       *
       * It was label-only — the reference's device for naming a feature the
       * build has not reached — and it was the last one left in the product
       * after `staffSections` was rewritten. Parent invoices are `нэмэлт.md`
       * §7–§10 and not started; until they are, a family reading "Санхүү" in
       * grey learns only that something is missing. This file argues that case
       * three times about the staff menu and then did the opposite here.
       */
      title: "Тохиргоо",
      entries: [entry("Миний бүртгэл", "/settings")],
    },
  ];
}

"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  ClipboardList,
  Home,
  Images,
  LayoutGrid,
  Bell,
  Menu,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { childSummarySchema, type ChildSummary } from "@kinder/contracts";
import { z } from "zod";
import { AppShell, type NavItem, type NavSection } from "@/components/shell/app-shell";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { ChildAvatar } from "@/components/media/media-image";
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

  const nav = isStaff ? staffNav(hasRole("ADMIN")) : parentNav(myChildren.data);

  return (
    <AppShell
      nav={nav}
      sections={isStaff ? staffSections(hasRole("ADMIN")) : parentSections(myChildren.data)}
      variant={isStaff ? "teacher" : "parent"}
    >
      {children}
    </AppShell>
  );
}

const iconProps = { size: 20, strokeWidth: 2, "aria-hidden": true } as const;

/**
 * Staff navigation.
 *
 * Six items at most — the bottom bar on a 375px screen fits six 44px targets
 * and no more. "Үнэлгээ" is deliberately absent as a top-level destination:
 * assessment always begins from a group, so it lives on the dashboard and the
 * child page rather than as a menu item that would first ask "which group?".
 */
function staffNav(isAdmin: boolean): NavItem[] {
  const items: NavItem[] = [
    { href: "/dashboard", label: "Нүүр", icon: <LayoutGrid {...iconProps} /> },
    { href: "/children", label: "Хүүхдүүд", icon: <Users {...iconProps} /> },
    { href: "/observations/review", label: "Хянах", icon: <ClipboardList {...iconProps} /> },
    { href: "/notifications", label: "Мэдэгдэл", icon: <Bell {...iconProps} />, badge: "unread" },
  ];

  if (isAdmin) {
    items.push({ href: "/admin", label: "Удирдлага", icon: <ShieldCheck {...iconProps} /> });
  }

  items.push({ href: "/settings", label: "Профайл", icon: <Settings {...iconProps} /> });
  return items;
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
function staffSections(isAdmin: boolean): NavSection[] {
  return [
    {
      title: "Хүүхдийн хөгжил ба үнэлгээ",
      entries: [
        { label: "Хүүхдүүд", href: "/children" },
        { label: "Ажиглалт хянах", href: "/observations/review" },
        { label: "Чөлөөний хүсэлт хянах", href: "/attendance-requests/review" },
      ],
    },
    {
      title: "Харилцаа холбоо",
      entries: [
        { label: "Ангийн самбар / Мэдээ", href: "/notifications" },
        { label: "Судалгаа", href: "/surveys" },
      ],
    },
    {
      title: "Багш ба байгууллага",
      entries: [
        // RFP §9 — "Багшид зориулсан PDF баримт бичгийн сан". Staff only, so it
        // lives here and never in `parentSections`.
        { label: "Баримт бичгийн сан", href: "/documents" },
        { label: "Багшийн мэдээлэл", href: "/settings" },
        ...(isAdmin ? [{ label: "Бүлэг, цэцэрлэгийн мэдээлэл", href: "/admin" }] : []),
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
 */
function parentSections(myChildren: ChildSummary[] | undefined): NavSection[] {
  return [
    {
      title: "Хүүхдийн мэдээлэл",
      entries:
        myChildren && myChildren.length > 0
          ? myChildren.map((child) => ({
              label: fullName(child),
              href: `/children/${child.id}`,
              icon: <ChildAvatar child={child} size={24} />,
            }))
          : [{ label: "Холбогдсон хүүхэд алга" }],
    },
    {
      title: "Харилцаа холбоо",
      entries: [
        {
          label: "Ангийн самбар / Мэдээ",
          href: "/notifications",
          icon: <Bell size={18} aria-hidden="true" />,
        },
        // No `href`: chat is RFP Phase IV. It renders as a disabled row, the
        // same treatment "Санхүү" below gets, so the menu describes the product
        // the client was shown without offering a link into nothing.
        { label: "Чат" },
      ],
    },
    {
      title: "Санхүү ба бүртгэл",
      entries: [
        { label: "Санхүү" },
        {
          label: "Миний бүртгэл",
          href: "/settings",
          icon: <Settings size={18} aria-hidden="true" />,
        },
      ],
    },
  ];
}


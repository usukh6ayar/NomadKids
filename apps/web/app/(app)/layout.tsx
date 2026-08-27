"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  Building2,
  CalendarCheck,
  ChevronRight,
  ClipboardList,
  FileText,
  Home,
  LayoutGrid,
  ListChecks,
  Bell,
  Settings,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { childSummarySchema, type ChildSummary } from "@kinder/contracts";
import { z } from "zod";
import { AppShell, type NavItem, type NavSection } from "@/components/shell/app-shell";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { ChildAvatar } from "@/components/media/media-image";
import { LoadingState } from "@/components/ui/states";
import { useSession } from "@/lib/auth/session";
import { formatAge, fullName } from "@/lib/format";
import { MY_CHILDREN } from "@/lib/vocabulary";

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
  const [childPickerOpen, setChildPickerOpen] = useState(false);

  useEffect(() => {
    if (isLoading || session) return;
    const from = encodeURIComponent(window.location.pathname + window.location.search);
    router.replace(`/login?from=${from}`);
  }, [isLoading, session, router]);

  /*
   * ★ Powers both the desktop sidebar's "Хүүхдийн мэдээлэл" section and the
   * phone bottom bar's child-picker modal, not this page.
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

  const nav = isStaff ? staffNav(hasRole("ADMIN")) : parentNav(() => setChildPickerOpen(true));

  return (
    <>
      <AppShell
        nav={nav}
        sections={isStaff ? staffSections(hasRole("ADMIN")) : parentSections(myChildren.data)}
        variant={isStaff ? "teacher" : "parent"}
        isAdmin={hasRole("ADMIN")}
      >
        {children}
      </AppShell>

      {!isStaff && childPickerOpen ? (
        <ChildPickerModal myChildren={myChildren.data} onClose={() => setChildPickerOpen(false)} />
      ) : null}
    </>
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
  "/notifications": Bell,
  "/surveys": ListChecks,
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

  return [
    {
      title: "Хүүхдийн хөгжил ба үнэлгээ",
      entries: [
        entry("Хүүхдүүд", "/children"),
        entry("Ажиглалт хянах", "/observations/review"),
        entry("Чөлөөний хүсэлт хянах", "/attendance-requests/review"),
      ],
    },
    {
      title: "Харилцаа холбоо",
      entries: [entry("Ангийн самбар / Мэдээ", "/notifications"), entry("Судалгаа", "/surveys")],
    },
    {
      title: "Багш ба байгууллага",
      entries: [
        // RFP §9 — "Багшид зориулсан PDF баримт бичгийн сан". Staff only, so it
        // lives here and never in `parentSections`.
        entry("Баримт бичгийн сан", "/documents"),
        entry("Багшийн мэдээлэл", "/settings"),
        ...(isAdmin ? [entry("Бүлэг, цэцэрлэгийн мэдээлэл", "/admin")] : []),
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
 * Parent navigation — four items, the brief's original Нүүр / Хавтас /
 * Мэдэгдэл / Профайл.
 *
 * ★ "Хавтас" opens the child picker in place rather than navigating.
 *
 * "Ирц" and "Хоол ба цэс" briefly had their own bottom-bar tabs, each
 * resolving to a `?tab=` deep link on a confirmed single child or to
 * `/children` otherwise. For any family that isn't exactly one child, that
 * put three of the six tabs — this one included — on the same destination:
 * a wasted tab, and on that landing page, three simultaneous "current page"
 * highlights. Removed; a parent reaches both from their child's own page,
 * same as every other per-child screen (Ажиглалт, Үнэлгээ, Зураг).
 *
 * The picker needs `onOpenChildPicker` from `AppLayout`, which owns both the
 * modal's open state and the `myChildren` query behind it — this function has
 * no hooks of its own to fetch with.
 */
function parentNav(onOpenChildPicker: () => void): NavItem[] {
  return [
    { href: "/home", label: "Нүүр", icon: <Home {...iconProps} /> },
    { label: MY_CHILDREN, icon: <BookOpen {...iconProps} />, onSelect: onOpenChildPicker },
    { href: "/notifications", label: "Мэдэгдэл", icon: <Bell {...iconProps} />, badge: "unread" },
    { href: "/settings", label: "Профайл", icon: <Settings {...iconProps} /> },
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
          icon: routeIcon("/notifications"),
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
        { label: "Миний бүртгэл", href: "/settings", icon: routeIcon("/settings") },
      ],
    },
  ];
}

/**
 * The phone bottom bar's "Миний хүүхдүүд" tab — a sheet over the current
 * screen rather than a navigation to `/children`.
 *
 * ★ Picking a child closes the sheet as well as navigating.
 *
 * `AppLayout` does not unmount on a route change — it is the shared layout
 * every route renders inside — so `childPickerOpen` would otherwise still be
 * `true` on the child's own page, ready to reopen the instant something else
 * calls `setChildPickerOpen(true)` from stale state. Each row's `onClick`
 * closes it explicitly rather than relying on navigation to do that for free.
 *
 * Same dialog recipe as `RequestDialog` (`components/child/child-attendance.tsx`)
 * and `CreateSurveyDialog` (`app/(app)/surveys/page.tsx`): a fixed overlay,
 * Escape to close, body scroll locked while open. Not a shared component
 * because the other two are forms and this is a list — the only thing in
 * common is the shell, and three call sites do not justify extracting it.
 */
function ChildPickerModal({
  myChildren,
  onClose,
}: {
  myChildren: ChildSummary[] | undefined;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={MY_CHILDREN}
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      {/* `stopPropagation` — a tap on the sheet itself must not bubble to the
          overlay's own close handler. */}
      <div
        className="max-h-[80dvh] w-full overflow-y-auto rounded-t-card border border-border bg-surface p-4 sm:max-w-[420px] sm:rounded-card sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-title font-semibold text-ink">{MY_CHILDREN}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Хаах"
            className="grid size-11 shrink-0 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {!myChildren ? (
          <LoadingState rows={2} />
        ) : myChildren.length === 0 ? (
          <p className="px-1 py-6 text-center text-body text-muted">
            Танд холбогдсон хүүхэд байхгүй байна.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {myChildren.map((child) => (
              <Link
                key={child.id}
                href={`/children/${child.id}`}
                onClick={onClose}
                className="flex min-h-[64px] items-center gap-3 rounded-row border border-border bg-surface px-3 py-2 transition-colors hover:border-primary"
              >
                <ChildAvatar child={child} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{fullName(child)}</span>
                  <span className="block text-body text-muted">{formatAge(child.dateOfBirth)}</span>
                </span>
                {/* Same chevron every other "this row opens something else" row
                    in the product carries — the picker takes you to that
                    child's own page, unlike the pills on /home, which stay
                    put and just change what the cards below them show. */}
                <ChevronRight size={18} className="shrink-0 text-faint" aria-hidden="true" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

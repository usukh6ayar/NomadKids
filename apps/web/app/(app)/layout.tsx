"use client";

import {
  BookOpen,
  ClipboardList,
  Home,
  LayoutGrid,
  Bell,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import {
  AppShell,
  type NavItem,
  type NavSection,
  type NavShortcut,
} from "@/components/shell/app-shell";
import { LoadingState } from "@/components/ui/states";
import { useSession } from "@/lib/auth/session";

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
  const { session, isLoading, hasRole } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (isLoading || session) return;
    const from = encodeURIComponent(window.location.pathname + window.location.search);
    router.replace(`/login?from=${from}`);
  }, [isLoading, session, router]);

  if (isLoading || !session) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-4 py-10">
        <LoadingState label="Ачаалж байна…" />
      </div>
    );
  }

  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");
  const nav = isStaff ? staffNav(hasRole("ADMIN")) : parentNav();

  return (
    <AppShell
      nav={nav}
      sections={isStaff ? staffSections(hasRole("ADMIN")) : undefined}
      shortcuts={isStaff ? STAFF_SHORTCUTS : undefined}
      variant={isStaff ? "teacher" : "parent"}
    >
      {children}
    </AppShell>
  );
}

const iconProps = { size: 20, strokeWidth: 2, "aria-hidden": true } as const;

/**
 * The quick-links box. Three destinations a teacher reaches every day.
 *
 * The reference's third is Ирц, which is Phase 2 here; the review queue takes
 * that slot because it is the teacher's actual daily task in the MVP.
 */
const STAFF_SHORTCUTS: NavShortcut[] = [
  { href: "/children", label: "Хүүхдүүд", icon: <Users size={18} aria-hidden /> },
  { href: "/observations/review", label: "Хянах", icon: <ClipboardList size={18} aria-hidden /> },
  { href: "/notifications", label: "Самбар", icon: <Bell size={18} aria-hidden /> },
];

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
 *  - **Ирц · Хоол · Судалгаа · Чат · Санхүү · Баримт бичиг** are Phase 2 and
 *    Phase 3 (CLAUDE.md §7). A teacher opening the menu every day and reading
 *    six things they cannot do learns that most of this product is broken.
 *    They are gone until the screen behind them exists; adding a line back is
 *    a one-line change on the day it ships.
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
      ],
    },
    {
      title: "Харилцаа холбоо",
      entries: [{ label: "Ангийн самбар / Мэдээ", href: "/notifications" }],
    },
    {
      title: "Багш ба байгууллага",
      entries: [
        { label: "Багшийн мэдээлэл", href: "/settings" },
        ...(isAdmin ? [{ label: "Бүлэг, цэцэрлэгийн мэдээлэл", href: "/admin" }] : []),
      ],
    },
  ];
}

/** Parent navigation — four items, the brief's Нүүр / Хавтас / Мэдэгдэл plus profile. */
function parentNav(): NavItem[] {
  return [
    { href: "/home", label: "Нүүр", icon: <Home {...iconProps} /> },
    { href: "/children", label: "Хавтас", icon: <BookOpen {...iconProps} /> },
    { href: "/notifications", label: "Мэдэгдэл", icon: <Bell {...iconProps} />, badge: "unread" },
    { href: "/settings", label: "Профайл", icon: <Settings {...iconProps} /> },
  ];
}

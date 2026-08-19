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
import { AppShell, type NavItem } from "@/components/shell/app-shell";
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
    <AppShell nav={nav} variant={isStaff ? "teacher" : "parent"}>
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

/** Parent navigation — four items, the brief's Нүүр / Хавтас / Мэдэгдэл plus profile. */
function parentNav(): NavItem[] {
  return [
    { href: "/home", label: "Нүүр", icon: <Home {...iconProps} /> },
    { href: "/children", label: "Хавтас", icon: <BookOpen {...iconProps} /> },
    { href: "/notifications", label: "Мэдэгдэл", icon: <Bell {...iconProps} />, badge: "unread" },
    { href: "/settings", label: "Профайл", icon: <Settings {...iconProps} /> },
  ];
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { unreadCountSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { useLogout, useSession } from "@/lib/auth/session";
import { fullName, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Shows the unread-notification count. Only one item ever sets this. */
  badge?: "unread";
}

/**
 * The application chrome.
 *
 * ★ One shell, two behaviours, because the two audiences use the product in
 * genuinely different postures:
 *
 *  - **Teacher** — desktop-first. A persistent left sidebar from `lg` up, since
 *    they move between children all day and a hidden menu costs a tap each time.
 *  - **Parent** — mobile-first. A bottom tab bar on a phone, which is where
 *    they read it, in the evening, one-handed.
 *
 * Both collapse to the same bottom bar below `lg`. Nothing is hidden behind a
 * hamburger: with four or five destinations a drawer adds a tap and hides the
 * product's entire surface area.
 */
export function AppShell({
  nav,
  children,
  variant = "teacher",
}: {
  nav: NavItem[];
  children: ReactNode;
  variant?: "teacher" | "parent";
}) {
  const desktopSidebar = variant === "teacher";

  return (
    <div className="min-h-dvh bg-canvas">
      {desktopSidebar ? <Sidebar nav={nav} /> : null}

      <TopBar variant={variant} />

      {/*
        `pb-24` on mobile clears the fixed bottom bar. Without it the last row
        of every list sits underneath the navigation and cannot be tapped —
        which only shows up when a list is long enough to scroll to the end.
      */}
      <main
        className={cn(
          "mx-auto w-full max-w-[1200px] px-4 pb-24 pt-4 sm:px-6 lg:pb-10",
          desktopSidebar && "lg:pl-[248px]",
        )}
      >
        {children}
      </main>

      <BottomBar nav={nav} hideOnDesktop={desktopSidebar} />
    </div>
  );
}

function Sidebar({ nav }: { nav: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Үндсэн цэс"
      className="fixed inset-y-0 left-0 z-20 hidden w-[232px] flex-col gap-1 border-r border-border bg-surface px-3 py-5 lg:flex"
    >
      <Link href="/" className="mb-4 flex items-center gap-2 px-2 py-1">
        <span className="flex size-9 items-center justify-center rounded-[12px] bg-primary text-sm font-bold text-primary-ink">
          NK
        </span>
        <span className="text-sm font-semibold text-ink">NomadKids</span>
      </Link>

      {nav.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} orientation="vertical" />
      ))}
    </nav>
  );
}

function TopBar({ variant }: { variant: "teacher" | "parent" }) {
  const { session } = useSession();
  const logout = useLogout();

  return (
    <header
      className={cn(
        "sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur",
        variant === "teacher" && "lg:pl-[232px]",
      )}
    >
      <div className="mx-auto flex h-[60px] w-full max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className={cn(
            "flex items-center gap-2 font-semibold text-ink",
            variant === "teacher" && "lg:invisible",
          )}
        >
          <span className="flex size-8 items-center justify-center rounded-[10px] bg-primary text-xs font-bold text-primary-ink">
            NK
          </span>
          <span className="text-sm">NomadKids</span>
        </Link>

        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            className="flex min-h-[44px] items-center gap-2 rounded-[12px] px-2 hover:bg-canvas"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
              {initials(session?.user)}
            </span>
            <span className="hidden max-w-[160px] truncate text-sm text-ink sm:inline">
              {fullName(session?.user)}
            </span>
          </Link>

          <button
            type="button"
            onClick={() => void logout()}
            className="min-h-[44px] rounded-[12px] px-3 text-sm text-muted hover:bg-canvas hover:text-ink"
          >
            Гарах
          </button>
        </div>
      </div>
    </header>
  );
}

function BottomBar({ nav, hideOnDesktop }: { nav: NavItem[]; hideOnDesktop: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Үндсэн цэс"
      className={cn(
        "fixed inset-x-0 bottom-0 z-20 flex items-stretch justify-around border-t border-border bg-surface",
        // `env(safe-area-inset-bottom)` keeps the tabs above the iPhone home
        // indicator, which otherwise overlaps the last few pixels of the row.
        "pb-[env(safe-area-inset-bottom)]",
        hideOnDesktop && "lg:hidden",
      )}
    >
      {nav.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} orientation="horizontal" />
      ))}
    </nav>
  );
}

function NavLink({
  item,
  pathname,
  orientation,
}: {
  item: NavItem;
  pathname: string;
  orientation: "vertical" | "horizontal";
}) {
  // Prefix match so `/children/abc` keeps "Хүүхдүүд" lit. Exact match for the
  // root of a section, or every item would match `/`.
  const active =
    item.href === "/"
      ? pathname === "/"
      : pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <Link
      href={item.href}
      // The single most useful ARIA attribute in a navigation: it tells a
      // screen reader which page you are on, which colour alone cannot.
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-2.5 rounded-[12px] font-medium transition-colors",
        orientation === "vertical"
          ? "min-h-[44px] px-3 py-2 text-sm"
          : "min-h-[56px] flex-1 flex-col justify-center gap-1 px-1 py-2 text-[11px]",
        active ? "bg-primary-soft text-primary" : "text-muted hover:bg-canvas hover:text-ink",
      )}
    >
      <span className="relative flex items-center justify-center">
        {item.icon}
        {item.badge === "unread" ? <UnreadDot /> : null}
      </span>
      <span className={orientation === "horizontal" ? "leading-none" : undefined}>
        {item.label}
      </span>
    </Link>
  );
}

/**
 * The unread indicator.
 *
 * Polled through the normal query cache with a short stale time —
 * `refetchOnWindowFocus` means returning to the tab updates it, which is the
 * MVP's stand-in for realtime (docs/ARCHITECTURE.md §7).
 *
 * The number is inside the dot, not conveyed by the dot's presence alone, and
 * it carries an `sr-only` phrase so it is announced as "3 уншаагүй мэдэгдэл"
 * rather than as a bare digit.
 */
function UnreadDot() {
  const { data } = useQuery({
    queryKey: qk.unreadCount(),
    queryFn: () => get("/notifications/unread-count", unreadCountSchema),
    staleTime: 60_000,
    retry: false,
  });

  const count = data?.count ?? 0;
  if (count === 0) return null;

  return (
    <span className="absolute -right-2.5 -top-1.5 flex min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-[18px] text-primary-ink">
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{count} уншаагүй мэдэгдэл</span>
    </span>
  );
}

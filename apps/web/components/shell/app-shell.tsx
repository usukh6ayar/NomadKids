"use client";

import Image from "next/image";
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
 * One collapsible section of the desktop sidebar.
 *
 * ★ Ported from the reference's `<details class="nav-group">`.
 *
 * Every entry is a link. There is no placeholder variant, deliberately: a menu
 * entry that goes nowhere teaches users the system is broken, and the version
 * of this sidebar that had eight of them proved the point. A section names the
 * parts of the product that are built, and gains a line on the day another one
 * ships.
 */
export interface NavSection {
  title: string;
  entries: { label: string; href: string }[];
}

/** The tinted quick-links box above the sections — the reference's `.nav-shortcuts`. */
export interface NavShortcut {
  href: string;
  label: string;
  icon: ReactNode;
}

/**
 * The page header: a title, an optional supporting line, and who is signed in.
 *
 * ★ Ported from the reference's `.topbar`, which every one of its screens uses.
 * The identity pill sits at the right on a desktop and disappears below 900px,
 * where the phone header already carries it — the reference's own resolution of
 * the same duplication, and the reason the pill is `hidden lg:flex` here.
 *
 * The lede is what makes a screen explain itself: "Хариуцсан бүлгийн хүүхдүүд"
 * under "Хүүхдүүд". Optional, because a few screens genuinely have nothing to
 * add and a placeholder sentence is worse than none.
 */
export function PageHeader({
  title,
  lede,
  actions,
}: {
  title: string;
  lede?: string;
  /** Trailing controls — a count, a filter, a primary action. */
  actions?: ReactNode;
}) {
  const { session, roles } = useSession();
  const roleLabel = roles.has("TEACHER") ? "Багш" : roles.has("ADMIN") ? "Админ" : "Эцэг эх";

  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[1.5rem] leading-[1.35] tracking-[-.01em] text-ink">{title}</h1>
        {lede ? <p className="mt-0.5 text-sm text-muted">{lede}</p> : null}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {actions}

        <span className="hidden items-center gap-2.5 rounded-full border border-border bg-surface py-1.5 pl-1.5 pr-3.5 lg:flex">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
            {initials(session?.user)}
          </span>
          <span className="min-w-0">
            <span className="block max-w-[180px] truncate text-[.87rem] font-semibold leading-[1.2] text-ink">
              {fullName(session?.user)}
            </span>
            <span className="block text-[.75rem] text-muted">{roleLabel}</span>
          </span>
        </span>
      </div>
    </div>
  );
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
  sections,
  shortcuts,
  children,
  variant = "teacher",
}: {
  nav: NavItem[];
  /** Desktop sidebar sections. Without them the sidebar renders `nav` flat. */
  sections?: NavSection[];
  shortcuts?: NavShortcut[];
  children: ReactNode;
  variant?: "teacher" | "parent";
}) {
  const desktopSidebar = variant === "teacher";
  const subtitle = variant === "teacher" ? "Багшийн хэсэг" : "Эцэг эхийн хэсэг";

  return (
    <div className="min-h-dvh bg-canvas">
      {desktopSidebar ? (
        <Sidebar nav={nav} sections={sections} shortcuts={shortcuts} subtitle={subtitle} />
      ) : null}

      <MobileHeader variant={variant} subtitle={subtitle} />

      {/*
        `pb-24` on mobile clears the fixed bottom bar. Without it the last row
        of every list sits underneath the navigation and cannot be tapped —
        which only shows up when a list is long enough to scroll to the end.

        Padding matches the reference's `.main`: 22px 26px 48px on a desktop,
        tightened on a phone where 26px of side padding costs a seventh of the
        width.
      */}
      <main
        className={cn(
          /*
           * Room to breathe on a desktop, tight on a phone.
           *
           * 26px of side padding costs a seventh of a 375px screen, so the
           * phone keeps 16px and the space appears where there is space to
           * give: 32px of side padding and 40px of lead-in from `lg` up.
           */
          "mx-auto w-full max-w-[1200px] px-4 pb-24 pt-[22px] sm:px-6 lg:pt-10 lg:pb-16 lg:pl-8 lg:pr-8",
          // The sidebar is `fixed`, so the column is offset by a margin and its
          // cap reduced by the same amount. Capping at a flat 1200px instead
          // overflows by exactly the sidebar's overhang — measured at 1440.
          desktopSidebar && "lg:ml-[244px] lg:max-w-[calc(100%-244px)]",
        )}
      >
        {children}
      </main>

      <BottomBar nav={nav} hideOnDesktop={desktopSidebar} />
    </div>
  );
}

/**
 * The brand block.
 *
 * ★ The mark sits in a tinted rounded square rather than on the panel directly.
 * The reference's own note explains why and it holds here: the logo is drawn on
 * white, so against any panel that is not white it would float. `object-contain`
 * is the guard against a future logo with different proportions being stretched.
 *
 * Two lines — the product name, then which part of it you are in — matching
 * `.brand__name` / `.brand__sub`.
 */
function Brand({ subtitle }: { subtitle: string }) {
  return (
    <Link href="/" className="flex min-h-[44px] items-center gap-[11px]">
      <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[#f1efff] p-0.5">
        <Image
          src="/mark-96.png"
          alt="Бяцхан нүүдэлчид"
          width={36}
          height={26}
          className="w-full object-contain"
          style={{ height: "auto" }}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[.9rem] font-bold leading-[1.25] text-ink">
          Хүүхдийн хөгжлийн
          <br />
          цахим хувийн хавтас
        </span>
        <span className="block text-[.75rem] text-muted">{subtitle}</span>
      </span>
    </Link>
  );
}

/**
 * Who is signed in, and the way out — at the foot of the sidebar.
 *
 * `mt-auto` pins it to the bottom however short the navigation is. Ported from
 * `.whoami`; the logout control is a 44px square, as it is there.
 */
function WhoAmI({ subtitle }: { subtitle: string }) {
  const { session } = useSession();
  const logout = useLogout();

  return (
    <div className="flex min-h-[44px] shrink-0 items-center gap-2 rounded-[14px] bg-canvas px-3 py-2">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-[.7rem] font-bold text-primary">
        {initials(session?.user)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[.78rem] font-semibold leading-[1.2] text-ink [overflow-wrap:anywhere]">
          {fullName(session?.user)}
        </span>
        <span className="block text-[.75rem] text-muted">{subtitle}</span>
      </span>
      <button
        type="button"
        onClick={() => void logout()}
        aria-label="Гарах"
        className="grid size-11 shrink-0 place-items-center rounded-[12px] text-muted hover:bg-surface hover:text-primary"
      >
        <LogoutIcon />
      </button>
    </div>
  );
}

function Sidebar({
  nav,
  sections,
  shortcuts,
  subtitle,
}: {
  nav: NavItem[];
  sections?: NavSection[];
  shortcuts?: NavShortcut[];
  subtitle: string;
}) {
  const pathname = usePathname();

  // The first item stays a top-level link above the shortcuts box, as
  // "Хяналтын самбар" does in the reference. The rest are reachable from the
  // sections below and from the bottom bar on a phone.
  const [primary] = nav;

  return (
    <nav
      aria-label="Үндсэн цэс"
      /*
       * ★ Only the menu scrolls.
       *
       * The sidebar can be taller than a laptop viewport, and when the whole
       * panel scrolled, `whoami`'s `mt-auto` put it at the foot of the
       * *content* rather than the panel — so it overlapped the last section
       * and the way out scrolled off the screen. The brand and the identity
       * are fixed now, and the nav between them takes the overflow. Trimming
       * the menu to built screens made this comfortable rather than moot: it
       * has to keep holding as sections come back.
       */
      className="fixed inset-y-0 left-0 z-20 hidden w-[244px] flex-col gap-5 overflow-hidden border-r border-border bg-surface px-3.5 py-[18px] lg:flex"
    >
      <Brand subtitle={subtitle} />

      <div className="-mr-1.5 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1.5">
        {primary ? <NavLink item={primary} pathname={pathname} orientation="vertical" /> : null}

        {shortcuts?.length ? <NavShortcuts shortcuts={shortcuts} /> : null}

        {sections?.length
          ? sections.map((section) => (
              <NavGroup key={section.title} section={section} pathname={pathname} />
            ))
          : nav
              .slice(1)
              .map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} orientation="vertical" />
              ))}
      </div>

      <WhoAmI subtitle={subtitle} />
    </nav>
  );
}

/**
 * The quick-links box.
 *
 * ★ Warm, where the reference is cool blue.
 *
 * The reference tints this `#f7fbff` on a `#dbe9f3` border — the one cool
 * element in an otherwise warm product, and it reads as a widget bolted onto
 * the menu rather than part of it. The job it does is separation, and the warm
 * canvas does that just as well against the white sidebar.
 *
 * What carries "these are different" now is the label and the layout, not a
 * second colour temperature. One less decorative surface, per the platform
 * direction this product is being held to.
 */
function NavShortcuts({ shortcuts }: { shortcuts: NavShortcut[] }) {
  return (
    <section
      aria-label="Түргэн холбоос"
      className="my-2 grid grid-cols-3 gap-1 rounded-[12px] border border-border bg-canvas p-2.5"
    >
      {/*
        11px, not the reference's .64rem (10.2px). An all-caps eyebrow at 10px
        is the smallest type in the product and the hardest to read — the extra
        pixel costs no layout and the letter-spacing still carries the style.
      */}
      <span className="col-span-full px-1 pb-1 pt-px text-[11px] font-extrabold tracking-[.08em] text-muted">
        ТҮРГЭН ХОЛБООС
      </span>
      {shortcuts.map((s) => (
        <Link
          key={s.href}
          href={s.href}
          className="flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-[.7rem] font-bold text-ink transition-colors hover:bg-surface hover:text-primary [&_svg]:text-primary"
        >
          {s.icon}
          <span className="text-center leading-tight">{s.label}</span>
        </Link>
      ))}
    </section>
  );
}

/**
 * A collapsible section.
 *
 * `open` by default, like the reference: the menu's job is to show what the
 * product contains, and a teacher should not have to open five drawers to find
 * out. `<details>` rather than state, so it works before hydration and keeps
 * the platform's own keyboard behaviour.
 */
function NavGroup({ section, pathname }: { section: NavSection; pathname: string }) {
  return (
    <details open className="border-b border-border py-0.5 [&[open]>summary>svg]:rotate-180">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between px-2.5 py-2 text-[.8rem] font-[750] text-ink [&::-webkit-details-marker]:hidden">
        {section.title}
        <ChevronIcon />
      </summary>

      {section.entries.map((entry) => {
        const active = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
        return (
          <Link
            key={entry.label}
            href={entry.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "ml-3 flex min-h-[44px] items-center rounded-lg px-2.5 py-1.5 text-[.8rem] transition-colors",
              active
                ? "bg-primary-soft font-semibold text-primary"
                : "text-muted hover:bg-canvas hover:text-ink",
            )}
          >
            {entry.label}
          </Link>
        );
      })}
    </details>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-4 shrink-0 text-faint transition-transform"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * The phone header.
 *
 * ★ Ported from the reference's `.mhead`, and it exists so the bottom bar does
 * not have to carry a logout beside the tabs. On a phone the sidebar is gone
 * entirely — this plus the bottom navigation is a deliberate mobile layout
 * rather than a folded desktop one.
 *
 * Hidden on the teacher's desktop, where the sidebar already carries all three
 * facts (brand, identity, logout). Showing them twice is what crowded the page
 * title in the reference, which solved it the same way.
 */
function MobileHeader({ variant, subtitle }: { variant: "teacher" | "parent"; subtitle: string }) {
  const { session } = useSession();
  const logout = useLogout();

  return (
    <header
      className={cn(
        "sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-surface px-4 py-3",
        variant === "teacher" && "lg:hidden",
      )}
    >
      <Link href="/" className="flex min-h-[44px] items-center gap-3">
        <span className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-[#f1efff] p-0.5">
          <Image
            src="/mark-96.png"
            alt="Бяцхан нүүдэлчид"
            width={30}
            height={22}
            className="w-full object-contain"
            style={{ height: "auto" }}
          />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[.87rem] font-semibold leading-[1.2] text-ink">
            Хүүхдийн хавтас
          </span>
          <span className="block text-[.75rem] text-muted">{subtitle}</span>
        </span>
      </Link>

      <div className="ml-auto flex items-center gap-1">
        <Link
          href="/settings"
          aria-label="Миний бүртгэл"
          className="grid size-11 place-items-center rounded-[12px] hover:bg-canvas"
        >
          <span className="grid size-8 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
            {initials(session?.user)}
          </span>
        </Link>
        <button
          type="button"
          onClick={() => void logout()}
          aria-label="Гарах"
          className="grid size-11 place-items-center rounded-[12px] text-muted hover:bg-canvas hover:text-ink"
        >
          <LogoutIcon />
        </button>
      </div>
    </header>
  );
}

function LogoutIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-[18px]"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
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
          ? "min-h-[44px] gap-[11px] px-3 py-2.5 text-[.92rem]"
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
    // 11px: a number read at a glance from a phone in someone's hand, and
    // 10px was the smallest visible type anywhere in the product.
    <span className="absolute -right-2.5 -top-1.5 flex min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold leading-[18px] text-primary-ink">
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{count} уншаагүй мэдэгдэл</span>
    </span>
  );
}

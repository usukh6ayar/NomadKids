"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Bell, ChevronDown, LogOut, Search } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { unreadCountSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { Input } from "@/components/ui/field";
import { qk } from "@/lib/api/keys";
import { useLogout, useSession } from "@/lib/auth/session";
import { fullName, initials } from "@/lib/format";
import { BRAND } from "@/lib/vocabulary";
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

/**
 * The page header: a title, an optional supporting line, and who is signed in.
 *
 * ★ Ported from the reference's `.topbar`, which every one of its screens uses.
 * The identity pill sits at the right and disappears below 900px, where the
 * phone header already carries it — the reference's own resolution of that
 * duplication, and the reason the pill is `hidden lg:flex` here. It also
 * disappears for staff at every width, because their sidebar carries it; see
 * `hasSidebar` below.
 *
 * The lede is what makes a screen explain itself: "Хариуцсан бүлгийн хүүхдүүд"
 * under "Хүүхдүүд". Optional, because a few screens genuinely have nothing to
 * add and a placeholder sentence is worse than none.
 *
 * ★★ The bell and the search box are opt-in, and neither is decoration.
 *
 * `search` renders a real field: `/children` already accepts `?q=` and the API
 * already filters on it, so submitting navigates into the existing search
 * rather than into a box that swallows what you type. It is off by default —
 * a search field on a settings screen searches nothing.
 *
 * The bell shows from `lg` up, beside the identity pill. It duplicates the
 * sidebar's Мэдэгдэл entry on purpose — the sidebar answers "where do I go",
 * the bell answers "is there anything new", and both read the same query — but
 * only where the phone's bottom bar is not already answering the second
 * question three inches below. See `NotificationBell`.
 */
export function PageHeader({
  title,
  lede,
  actions,
  search = false,
}: {
  title: string;
  lede?: string;
  /** Trailing controls — a count, a filter, a primary action. */
  actions?: ReactNode;
  /** Shows the header search field. Screens with something to search set it. */
  search?: boolean;
}) {
  const { session, hasRole } = useSession();

  /*
   * ★ The identity pill is for the audiences that have no sidebar.
   *
   * It used to render for everyone from `lg` up — which is exactly the width
   * where a teacher's sidebar is showing `WhoAmI` with the same name three
   * inches to the left, and describing the same person differently: "Багш" in
   * the pill, "Багшийн хэсэг" at the foot of the sidebar. One person, twice, two
   * descriptions, on the same screen.
   *
   * The condition matches `AppLayout`'s `isStaff`, which is what picks
   * `variant="teacher"` and therefore what decides the sidebar exists. Reading
   * roles here rather than taking a prop keeps `PageHeader` usable from any
   * screen without every screen having to know which shell wraps it — and the
   * two derivations cannot drift apart, because there is only one rule: staff
   * have a sidebar, and a sidebar already says who you are.
   */
  const hasSidebar = hasRole("TEACHER") || hasRole("ADMIN");

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      {/* No `flex-1`: the search below centres itself with auto margins, and a
          title that grew to fill the row would leave those margins nothing to
          absorb. `min-w-0` still lets a long title shrink rather than push. */}
      <div className="min-w-0">
        {/*
          ★ `font-semibold` is not decoration here.

          Tailwind's preflight resets heading weight to `inherit`, so without it
          this `<h1>` rendered at 400 while `SectionHeader`'s `<h2>` renders at
          600 — every section heading on every screen was bolder than the page
          title above it, which is the hierarchy exactly inverted. Every other
          heading in the product sets its weight explicitly; this was the one
          that did not.
        */}
        <h1 className="text-display font-semibold leading-[1.35] tracking-[-.01em] text-ink">
          {title}
        </h1>
        {lede ? <p className="mt-0.5 text-body text-muted">{lede}</p> : null}
      </div>

      {/*
        Centred between the title and the identity cluster from `lg` up, and a
        full-width row of its own below it — at 375px a field sharing a line
        with a title is about 90px wide, which fits neither a name nor a
        placeholder.
      */}
      {search ? (
        <HeaderSearch className="order-last basis-full lg:order-none lg:basis-auto" />
      ) : null}

      <div className="flex shrink-0 items-center gap-2">
        {actions}

        <NotificationBell />

        {hasSidebar ? null : (
          <span className="hidden items-center gap-2.5 rounded-pill border border-border bg-surface py-1.5 pl-1.5 pr-3.5 lg:flex">
            <span className="grid size-8 shrink-0 place-items-center rounded-pill bg-primary-soft text-caption font-semibold text-primary">
              {initials(session?.user)}
            </span>
            <span className="min-w-0">
              <span className="block max-w-[180px] truncate text-body font-semibold leading-[1.2] text-ink">
                {fullName(session?.user)}
              </span>
              <span className="block text-caption text-muted">Эцэг эх</span>
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The header search field.
 *
 * ★ A form that submits, not a box that filters as you type.
 *
 * `/children` has its own debounced live search, and that is the right
 * behaviour *on* a list you are looking at. From a header the same behaviour
 * would push a route on every keystroke, so this submits once — Enter, or the
 * button — and lands on `/children?q=…`, where the list picks the term up from
 * the URL and takes over.
 *
 * The label is `sr-only` rather than absent. A placeholder is not a label
 * (CLAUDE.md §5): it disappears the moment someone types, and a screen reader
 * reaching a bare text field announces "edit text" and nothing else.
 *
 * The id comes from `useId()`, as every other control in the product does. A
 * literal would be unique only while exactly one screen opts in — the second
 * one, or a transition that briefly mounts two headers, gives two elements the
 * same id and the label silently binds to whichever rendered first.
 */
function HeaderSearch({ className }: { className?: string }) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const id = useId();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = term.trim();
    // An empty submit opens the unfiltered list rather than doing nothing —
    // pressing Enter and getting no response reads as a broken control.
    router.push(q ? `/children?q=${encodeURIComponent(q)}` : "/children");
  };

  return (
    <form
      role="search"
      onSubmit={onSubmit}
      /*
        280px, not 420px. It sat at `min(420px,32vw)` — a third of the header on
        a laptop, for a field that takes a child's name. A search box wider than
        its longest realistic query reads as the page's main event rather than
        as a way past the list.
      */
      className={cn("min-w-0 lg:mx-auto lg:w-[min(280px,24vw)]", className)}
    >
      <label htmlFor={id} className="sr-only">
        Хүүхэд хайх
      </label>
      <div className="relative">
        <Search
          size={18}
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
        />
        {/*
          ★ The shared `Input`, not a bespoke field.

          This was `h-[44px] rounded-pill` with the placeholder "Хүүхдийн нэрээр
          хайх…", while `/children` — the screen this submits into — renders the
          48px `rounded-control` `Input` with "Нэр эсвэл овгоор хайх". Two
          shapes, two heights and two wordings for one job, and using the first
          one puts you next to the second.

          `Input` also names no font size, which is what keeps a focused field
          at the 16px iOS needs. That property was the reason this field was
          wrong before; inheriting it is how it stays right.
        */}
        <Input
          id={id}
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Нэр эсвэл овгоор хайх"
          className="pl-11"
        />
      </div>
    </form>
  );
}

/**
 * The notification bell.
 *
 * The badge is red — `--color-danger`, which carries white text at 5.44:1 —
 * rather than the brand blue it used to be. On a screen whose primary action is
 * that same blue, a blue count beside a blue button stopped reading as
 * "unresolved".
 *
 * ★ The number is inside the badge and repeated in the link's accessible name.
 * A dot alone says "something changed" to everyone who can see it and nothing
 * at all to anyone who cannot.
 *
 * ★★ Desktop only, like the identity pill beside it.
 *
 * `PageHeader` is shared with the parent's screens, and below `lg` every
 * audience already has Мэдэгдэл in the bottom bar carrying the same count. The
 * bell earns its place where that bar is gone or the menu is a column of
 * destinations rather than a live count — not next to a copy of itself on a
 * 375px screen.
 */
function NotificationBell() {
  const count = useUnreadCount();

  return (
    <Link
      href="/notifications"
      aria-label={count > 0 ? `Мэдэгдэл, ${count} уншаагүй` : "Мэдэгдэл"}
      className="relative hidden size-11 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-canvas hover:text-ink lg:grid"
    >
      <Bell size={20} strokeWidth={2} aria-hidden="true" />
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 flex min-w-[18px] items-center justify-center rounded-pill bg-danger px-1 text-caption font-bold leading-[18px] text-white"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
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
  children,
  variant = "teacher",
}: {
  nav: NavItem[];
  /** Desktop sidebar sections. Without them the sidebar renders `nav` flat. */
  sections?: NavSection[];
  children: ReactNode;
  variant?: "teacher" | "parent";
}) {
  const desktopSidebar = variant === "teacher";
  const subtitle = variant === "teacher" ? "Багшийн хэсэг" : "Эцэг эхийн хэсэг";

  return (
    <div className="min-h-dvh bg-canvas">
      {desktopSidebar ? <Sidebar nav={nav} sections={sections} subtitle={subtitle} /> : null}

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
      <span className="grid size-10 shrink-0 place-items-center rounded-control bg-[#f1efff] p-0.5">
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
        <span className="block text-body font-semibold leading-[1.25] text-ink">{BRAND}</span>
        <span className="block text-caption text-muted">{subtitle}</span>
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
    <div className="flex min-h-[44px] shrink-0 items-center gap-2 rounded-row bg-canvas px-3 py-2">
      <span className="grid size-7 shrink-0 place-items-center rounded-pill bg-primary-soft text-caption font-bold text-primary">
        {initials(session?.user)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-compact font-semibold leading-[1.2] text-ink [overflow-wrap:anywhere]">
          {fullName(session?.user)}
        </span>
        <span className="block text-caption text-muted">{subtitle}</span>
      </span>
      <button
        type="button"
        onClick={() => void logout()}
        aria-label="Гарах"
        className="grid size-11 shrink-0 place-items-center rounded-control text-muted hover:bg-surface hover:text-primary"
      >
        <LogOut size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

function Sidebar({
  nav,
  sections,
  subtitle,
}: {
  nav: NavItem[];
  sections?: NavSection[];
  subtitle: string;
}) {
  const pathname = usePathname();

  // The first item stays a top-level link above the sections, as "Хяналтын
  // самбар" does in the reference. The rest are reachable from the sections
  // below and from the bottom bar on a phone.
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

/*
 * ★ The quick-links box ("Түргэн холбоос") was removed on 2026-08-23.
 *
 * Its three icons were Хүүхдүүд, Хянах and Самбар — all three already one line
 * below in the sections, and all three already in the bottom bar on a phone. A
 * tinted grid repeating what the menu underneath it says is the widget that
 * makes a sidebar look like an admin template, and removing it is what lets the
 * remaining sections read as the whole menu rather than as the part below the
 * shortcuts. The `NavShortcut` type and `shortcuts` prop went with it: a prop
 * nothing passes is the next person's puzzle.
 */

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
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between px-2.5 py-2 text-compact font-semibold text-ink [&::-webkit-details-marker]:hidden">
        {section.title}
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="shrink-0 text-faint transition-transform"
        />
      </summary>

      {section.entries.map((entry) => {
        const active = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
        return (
          <Link
            key={entry.label}
            href={entry.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative ml-3 flex min-h-[44px] items-center rounded-control px-2.5 py-1.5 text-compact transition-colors",
              active
                ? // The blue-700 rule is the active marker; the tint and the
                  // weight are what make it readable. Three signals, because
                  // colour alone must not carry the state.
                  "bg-primary-soft font-semibold text-primary before:absolute before:-left-2 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-pill before:bg-primary"
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
        <span className="grid size-[34px] shrink-0 place-items-center rounded-control bg-[#f1efff] p-0.5">
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
          <span className="block truncate text-body font-semibold leading-[1.2] text-ink">
            {BRAND}
          </span>
          <span className="block text-caption text-muted">{subtitle}</span>
        </span>
      </Link>

      <div className="ml-auto flex items-center gap-1">
        <Link
          href="/settings"
          aria-label="Миний бүртгэл"
          className="grid size-11 place-items-center rounded-control hover:bg-canvas"
        >
          <span className="grid size-8 place-items-center rounded-pill bg-primary-soft text-caption font-semibold text-primary">
            {initials(session?.user)}
          </span>
        </Link>
        <button
          type="button"
          onClick={() => void logout()}
          aria-label="Гарах"
          className="grid size-11 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
        >
          <LogOut size={18} aria-hidden="true" />
        </button>
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
        "relative flex items-center gap-2.5 rounded-control font-medium transition-colors",
        orientation === "vertical"
          ? "min-h-[44px] gap-[11px] px-3 py-2.5 text-lead"
          : "min-h-[56px] flex-1 flex-col justify-center gap-1 px-1 py-2 text-caption",
        active ? "bg-primary-soft text-primary" : "text-muted hover:bg-canvas hover:text-ink",
        // A blue-700 rule marks the current destination: down the left edge in
        // the sidebar, across the top of a tab in the phone's bottom bar.
        active &&
          (orientation === "vertical"
            ? "before:absolute before:left-0 before:top-1/2 before:h-6 before:w-[3px] before:-translate-y-1/2 before:rounded-pill before:bg-primary"
            : "before:absolute before:inset-x-5 before:top-0 before:h-[3px] before:rounded-pill before:bg-primary"),
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
 * The unread count.
 *
 * Polled through the normal query cache with a short stale time —
 * `refetchOnWindowFocus` means returning to the tab updates it, which is the
 * MVP's stand-in for realtime (docs/ARCHITECTURE.md §7).
 *
 * ★ One hook, two call sites. The bell in the header and the badge on the nav
 * item read the same query key, so they cannot disagree — and they share a
 * single request, which is the whole point of the cache key being stable.
 */
function useUnreadCount(): number {
  const { data } = useQuery({
    queryKey: qk.unreadCount(),
    queryFn: () => get("/notifications/unread-count", unreadCountSchema),
    staleTime: 60_000,
    retry: false,
  });

  return data?.count ?? 0;
}

/**
 * The unread indicator on a navigation item.
 *
 * The number is inside the dot, not conveyed by the dot's presence alone, and
 * it carries an `sr-only` phrase so it is announced as "3 уншаагүй мэдэгдэл"
 * rather than as a bare digit.
 *
 * Red rather than the brand blue, matching the header bell — see
 * `NotificationBell`.
 */
function UnreadDot() {
  const count = useUnreadCount();
  if (count === 0) return null;

  return (
    // 11px: a number read at a glance from a phone in someone's hand, and
    // 10px was the smallest visible type anywhere in the product.
    <span className="absolute -right-2.5 -top-1.5 flex min-w-[18px] items-center justify-center rounded-pill bg-danger px-1 text-caption font-bold leading-[18px] text-white">
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{count} уншаагүй мэдэгдэл</span>
    </span>
  );
}

"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ChevronDown, LogOut, Search, X } from "lucide-react";
import { useId, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import {
  ROLE_LABEL,
  notificationSchema,
  paginated,
  type ChildSummary,
  type Role,
  unreadCountSchema,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { z } from "zod";
import { Input, Select } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/states";
import { qk } from "@/lib/api/keys";
import { useLogout, useSession } from "@/lib/auth/session";
import { formatRelative, fullName, initials } from "@/lib/format";
import { BRAND } from "@/lib/vocabulary";
import { cn } from "@/lib/utils";
import { useMyGroup } from "@/components/dashboard/use-my-group";
import { ChatWidget } from "@/components/chat/chat-widget";

/** The bell panel reads five rows; the feed reads fifteen and paginates. */
const bellListSchema = paginated(notificationSchema);

/** Which audience this shell is rendering for. */
export type Variant = "teacher" | "parent" | "platform";

export interface NavItem {
  /**
   * Either this or `onSelect` — never neither, never both.
   *
   * Omitted for a tab that opens something in place rather than navigating,
   * e.g. the parent bottom bar's child picker. Such a tab is rendered as a
   * `<button>`, never claims the "current page" active state, and cannot be
   * `key`ed by `href` — see the `key={item.label}` call sites.
   */
  href?: string;
  label: string;
  icon: ReactNode;
  /** Shows the unread-notification count. Only one item ever sets this. */
  badge?: "unread";
  /** Runs instead of navigating. See `href`. */
  onSelect?: () => void;
}

/**
 * One collapsible section of the desktop sidebar.
 *
 * ★ Ported from the reference's `<details class="nav-group">`.
 *
 * Every entry is a link *or* a plain, non-interactive label — never a link to
 * nowhere. `staffSections` below uses only links: a teacher's whole product
 * fits on one screen, so a dead entry there would only ever have been
 * decoration. An `entry` with no `href` renders as inert text with a small
 * "удахгүй" tag — the reference's own device for naming a feature that exists
 * in the product but not yet in this build (`app.css`'s `.nav a.soon`,
 * rendered there as a `<span>`, never an `<a>`). The distinction that matters
 * is exactly the one the reference draws: a `<span>` cannot be clicked and so
 * cannot disappoint a click, where an `<a href="/chat">` that 404s teaches
 * someone the product is broken.
 */
export interface NavSection {
  title: string;
  entries: {
    label: string;
    href?: string;
    /**
     * A small mark before the label — a lucide icon at the same weight as
     * `parentNav`'s own, or (for `parentSections`' one child per entry) a
     * 24px `ChildAvatar`. Optional: a section this small doesn't need one on
     * every row to stay scannable, and forcing one everywhere is how a
     * plain-text row ends up with a `null` nobody chose on purpose.
     */
    icon?: ReactNode;
  }[];
}

/**
 * The sidebar's child picker — parent-only, and only when it has something to
 * pick between. `(app)/layout.tsx`'s `AuthenticatedShell` builds this from
 * `SelectedChildProvider`, so the rest of the shell never touches
 * `localStorage` directly.
 */
export interface ChildSwitcher {
  children: ChildSummary[];
  selectedId: string;
  onSelect: (id: string) => void;
}

/**
 * The page header: a title, an optional supporting line, and the screen's own
 * actions.
 *
 * ★ Ported from the reference's `.topbar`, which every one of its screens uses.
 *
 * The lede is what makes a screen explain itself: "Хариуцсан бүлгийн хүүхдүүд"
 * under "Хүүхдүүд". Optional, because a few screens genuinely have nothing to
 * add and a placeholder sentence is worse than none.
 *
 * ★★ The search box is opt-in, and it is not decoration.
 *
 * `search` renders a real field: `/children` already accepts `?q=` and the API
 * already filters on it, so submitting navigates into the existing search
 * rather than into a box that swallows what you type. It is off by default —
 * a search field on a settings screen searches nothing.
 *
 * ★★★ The identity pill and the notification bell both left this component on
 * 2026-08-28, and what replaced them is a header rather than nothing.
 *
 * Both were `hidden … lg:*` — they existed only at the width where the desktop
 * chrome shows, and the desktop chrome now has a header of its own
 * (`DesktopHeader`) carrying exactly those two things once for the whole app
 * instead of once per screen. That is the difference that matters: a screen
 * which forgot to render `PageHeader` silently had no bell at all, and thirty-
 * four copies of a control that never varies is thirty-four chances to drift.
 *
 * The pill was already dead code behind a `hasSidebar` constant pinned to
 * `true`, with a note saying removing it was a cleanup "this merge should not
 * make unasked". A desktop header with a profile area on the right is the ask,
 * and `page-header.test.tsx` already asserts that no name is repeated here —
 * so the removal is the behaviour that file specifies rather than a new one.
 */
export function PageHeader({
  title,
  lede,
  actions,
  search = false,
  icon,
  meta,
}: {
  title: string;
  lede?: string;
  /** Trailing controls — a count, a filter, a primary action. */
  actions?: ReactNode;
  /** Shows the header search field. Screens with something to search set it. */
  search?: boolean;
  /**
   * A visual identity for the screen — an `IconChip`, usually.
   *
   * ★ Optional, and most screens should stay without one.
   *
   * A header that opens every screen identically is the thing this fixes, but
   * the fix is *some* screens carrying a face, not all 34 growing one. A chip
   * on every list in the product is the same flatness with more colour in it.
   * Reserve it for screens a person navigates to on purpose — a dashboard, a
   * child's profile — rather than for every table.
   *
   * ★★ It is a slot, not an icon name. A lucide glyph today and an illustrated
   * `.webp` later occupy it without this signature changing.
   */
  icon?: ReactNode;
  /**
   * A chip row under the title — counts, status, the term being viewed.
   *
   * Sits below the lede rather than beside the title: Mongolian compounds wrap
   * at almost every width (`--leading-heading` exists for exactly that), and a
   * chip sharing the title's line is the first thing to be pushed off it.
   */
  meta?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 lg:mb-6">
      {/* No `flex-1`: the search below centres itself with auto margins, and a
          title that grew to fill the row would leave those margins nothing to
          absorb. `min-w-0` still lets a long title shrink rather than push. */}
      {/*
        The identity block: chip and titles on one row, so a wrapping title
        stays beside its icon rather than under it. `items-start` keeps the
        chip aligned to the first line of a two-line heading.
      */}
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <div className="mt-0.5 shrink-0">{icon}</div> : null}

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
          <h1 className="text-heading font-semibold leading-[1.3] tracking-[-.01em] text-ink md:text-display md:leading-[1.35]">
            {title}
          </h1>
          {lede ? <p className="mt-0.5 text-body text-muted">{lede}</p> : null}

          {/*
          `flex-wrap`, because a row of chips at 375px is the width that
          decides how many fit — not a number chosen here.
        */}
          {meta ? <div className="mt-2 flex flex-wrap items-center gap-1.5">{meta}</div> : null}
        </div>
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

      {/*
        ★ `max-w-full`, added because `shrink-0` alone overflowed the page.

        `shrink-0` is right for the common case: a header action must not be
        squeezed into an unreadable sliver by a long title. But it pins the
        block at its *max-content* width, and max-content ignores any wrapping
        its children could do. On `/children` that block is a count plus three
        44px buttons — about 430px — so at 390px it ran off the screen and cut
        "Хүүхэд бүртгэх" in half. Measured: `scrollWidth` 469 against a
        `clientWidth` of 390.

        `max-w-full` caps it at the row's width without letting a title squeeze
        it, which is what turns the children's own `flex-wrap` into an actual
        second line. `justify-end` keeps the wrapped rows right-aligned under
        the title instead of drifting left.

        `html { overflow-x: hidden }` in `globals.css` was hiding the symptom —
        the button was clipped rather than reachable by scrolling, which is the
        worse of the two failures and the reason this went unnoticed.
      */}
      <div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
        {actions}
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
 * ★★ Desktop only, and now by position rather than by a class.
 *
 * It used to carry `hidden … lg:grid` because it lived in `PageHeader`, which
 * every audience renders at every width — and below `lg` all of them already
 * have Мэдэгдэл in the bottom bar carrying the same count. Its one call site is
 * `DesktopHeader`, which is itself `hidden … lg:flex`, so the visibility rule
 * now lives in one place instead of two that have to agree.
 */
function NotificationBell() {
  const count = useUnreadCount();
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label={count > 0 ? `Мэдэгдэл, ${count} уншаагүй` : "Мэдэгдэл"}
        className="relative grid size-11 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-canvas hover:text-ink"
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
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        {/*
          Anchored under the bell on a desktop and centred near the top on a
          phone — a panel either way, never a page. A `Popover` would be the
          textbook control, and `@radix-ui/react-popover` is not a dependency
          of this app; `Dialog` is, it is what `MobileMenuDrawer` already uses,
          and the client asked for this to "work like a modal".
        */}
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-4 top-16 z-50 mx-auto flex max-h-[70vh] w-auto max-w-[420px] flex-col overflow-hidden rounded-card border border-border bg-surface shadow-xl sm:inset-x-auto sm:right-6 sm:top-[68px] sm:w-[380px]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <Dialog.Title className="text-lead font-semibold text-ink">Мэдэгдэл</Dialog.Title>
            <Dialog.Close
              aria-label="Хаах"
              className="grid size-11 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
            >
              <X size={18} aria-hidden="true" />
            </Dialog.Close>
          </div>

          <NotificationBellList onNavigate={() => setOpen(false)} unreadCount={count} />

          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="flex min-h-[44px] items-center justify-center border-t border-border text-body font-medium text-primary hover:bg-canvas"
          >
            Бүх мэдээг харах
          </Link>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The five most recent notices, inside the bell's panel.
 *
 * ★ Its own small query rather than the feed's.
 *
 * `/notifications` paginates at 15 and `NotificationsPage` stitches pages
 * together with an infinite query — reusing that key here would make the bell
 * hold the whole feed in memory and, worse, share a cache entry whose contents
 * depend on whichever filters that screen last applied. Five rows under their
 * own key is a different question with a different answer.
 *
 * `enabled` on the panel being open: a bell that nobody presses costs nothing.
 */
function NotificationBellList({
  onNavigate,
  unreadCount,
}: {
  onNavigate: () => void;
  unreadCount: number;
}) {
  const queryClient = useQueryClient();

  /**
   * "Бүгдийг уншсан", built from the per-notice endpoint.
   *
   * ★ There is no `POST /notifications/read-all`, and this does not invent one.
   *
   * It marks the rows the panel is actually showing — the five it fetched —
   * sequentially, then refetches. That is honest about what it did: a person
   * who has fifty unread notices and presses this clears the five they can see,
   * and the badge drops by five rather than to zero. The button is hidden when
   * none of the visible rows is unread, so it never promises more than it does.
   *
   * A real "mark everything read" is one endpoint away and belongs on the
   * server, where it is a single `updateMany` rather than N round trips. Worth
   * adding the day a kindergarten's boards get busy enough to need it.
   */
  const markVisibleRead = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await mutate(`/notifications/${id}/read`, z.unknown(), { method: "POST" });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const { data, isLoading } = useQuery({
    queryKey: qk.notifications({ bell: true }),
    queryFn: () => get("/notifications?page=1&pageSize=5", bellListSchema),
    staleTime: 30_000,
    retry: false,
  });

  const items = data?.items ?? [];

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }

  if (items.length === 0) {
    return <p className="px-4 py-8 text-center text-body text-muted">Мэдэгдэл алга байна.</p>;
  }

  const unreadIds = items.filter((n) => n.reads.length === 0).map((n) => n.id);

  return (
    <>
      {unreadIds.length > 0 ? (
        <div className="flex items-center justify-between gap-2 border-b border-border-soft px-4 py-2">
          <span className="text-caption text-muted">{unreadCount} уншаагүй</span>
          <button
            type="button"
            onClick={() => markVisibleRead.mutate(unreadIds)}
            disabled={markVisibleRead.isPending}
            className="min-h-[36px] rounded-control px-2 text-caption font-medium text-primary transition-colors hover:bg-canvas disabled:text-faint"
          >
            {markVisibleRead.isPending ? "Тэмдэглэж байна…" : "Эдгээрийг уншсан болгох"}
          </button>
        </div>
      ) : null}

      <ul className="min-h-0 flex-1 divide-y divide-border-soft overflow-y-auto">
        {items.map((notification) => {
          const unread = notification.reads.length === 0;
          return (
            <li key={notification.id}>
              <Link
                href={`/notifications/${notification.id}`}
                onClick={onNavigate}
                /*
                ★ An unread row sits on the brand tint; a read one is plain.

                The dot alone was the whole difference and it is 8px. Tinting
                the row is what makes "which of these have I not seen" a glance
                rather than a search — the same three-signal rule the feed's own
                cards follow (tint, weight, and a word for a screen reader).
              */
                className={cn(
                  "flex items-start gap-2.5 px-4 py-3 transition-colors",
                  unread ? "bg-primary-soft/60 hover:bg-primary-soft" : "hover:bg-canvas",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-pill",
                    unread ? "bg-primary" : "bg-transparent",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-body text-ink",
                      unread ? "font-semibold" : "font-medium",
                    )}
                  >
                    {notification.title}
                  </span>
                  {unread ? <span className="sr-only">Уншаагүй</span> : null}
                  <span className="mt-0.5 block text-caption text-muted">
                    {formatRelative(notification.publishedAt ?? notification.createdAt)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
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
 * Both collapse to the same bottom bar below `lg`. Three of its tabs are still
 * direct links — a drawer behind all of them would add a tap to everything.
 * Only the one that points at `/settings` ("Профайл" for either role) opens
 * `MobileMenuDrawer` instead: below `lg` that tab was the only way to
 * `/settings` itself *and* the only way to everything the desktop sidebar's
 * sections carry (a specific child's own page, "Ангийн самбар", …), which a
 * four-item bottom bar has no room to name individually. The drawer is that
 * same sidebar content, reused rather than redesigned — see `SidebarContent`.
 */
export function AppShell({
  nav,
  sections,
  shortcuts,
  children,
  variant = "teacher",
  isAdmin = false,
  childSwitcher,
}: {
  nav: NavItem[];
  /** Desktop sidebar sections. Without them the sidebar renders `nav` flat. */
  sections?: NavSection[];
  /** "Түргэн холбоос" — see `NavShortcuts`. Omitted, nothing is drawn. */
  shortcuts?: NavItem[];
  children: ReactNode;
  variant?: Variant;
  /**
   * Whether this person administers the kindergarten.
   *
   * The footer reads it to decide between naming a teacher's group and naming
   * a role — an admin sees every group, so the first of them is not "theirs" —
   * and the masthead reads it for the subtitle below. Passed rather than
   * derived here so the shell keeps taking its role decisions from one place,
   * `(app)/layout.tsx`.
   */
  isAdmin?: boolean;
  /** A parent with more than one child — see `ChildSwitcher`. */
  childSwitcher?: ChildSwitcher;
}) {
  const { session } = useSession();

  // Every role gets the sidebar from `lg` up; only the bottom bar is
  // role-dependent (mobile-only, all three variants).
  const desktopSidebar = true;

  /*
   * ★ The staff variant names the role, not the larger of the two audiences.
   *
   * `variant` is `teacher` for a director as well — the route tree is one tree
   * (`(app)/layout.tsx`) and both roles reach the same screens — so this line
   * greeted a kindergarten's director with "Багшийн хэсэг" on every page of the
   * product, including the seven screens only they can open. The masthead is
   * the one place that says whose product this is; getting it wrong there is
   * not cosmetic.
   */
  /*
    ★★ Two more staff roles share the teacher variant since 2026-08-30.

    They get the same frame — they are employees of one kindergarten and the
    route tree is one tree — so without a branch of their own a cook read
    "Багшийн хэсэг" under the kindergarten's name. That is the same mistake
    this docblock records fixing for the director, one role along.
  */
  const subtitle =
    variant === "teacher"
      ? isAdmin
        ? "Захирлын хэсэг"
        : (SUPPORT_SUBTITLE[highestRole(session?.memberships)] ?? "Багшийн хэсэг")
      : variant === "platform"
        ? "Платформын удирдлага"
        : "Эцэг эхийн хэсэг";

  const [menuOpen, setMenuOpen] = useState(false);

  /*
   * ★ Identified by `href`, not by position or label.
   *
   * Every nav array's settings tab points at `/settings` — matching on that
   * href (rather than, say, "the last item") is what keeps this working for
   * any nav array without the shell needing to know which role or label it
   * is rendering. Every other tab keeps its own `href` and still navigates
   * normally.
   */
  const bottomNav = nav.map((item) =>
    item.href === "/settings"
      ? { ...item, href: undefined, onSelect: () => setMenuOpen(true) }
      : item,
  );

  return (
    <div className="min-h-dvh bg-canvas">
      {desktopSidebar ? (
        <Sidebar
          nav={nav}
          sections={sections}
          shortcuts={shortcuts}
          subtitle={subtitle}
          variant={variant}
          isAdmin={isAdmin}
          childSwitcher={childSwitcher}
        />
      ) : null}

      <MobileHeader subtitle={subtitle} />

      {/*
        ★ Padding on the frame, a capped column inside it — not a margin.

        This was one element carrying `mx-auto max-w-[1200px]` *and*
        `lg:ml-[244px] lg:max-w-[calc(100%-244px)]`, and the two halves fought.
        `lg:max-w-[calc(100%-244px)]` is the later, more specific cap, so from
        `lg` up the 1200px ceiling simply stopped applying: at 1920px the
        content column measured 1676px and ran flush to the right edge, with
        `mx-auto` unable to centre anything because `lg:ml-[244px]` had already
        replaced its left margin. Cards stretched to fill it, which is the one
        thing the brief is explicit about not doing above 1440px.

        The frame now owns the sidebar offset (`lg:pl-[244px]`, padding rather
        than margin, so it cannot collide with auto-centring) and the column
        inside it owns the cap. `mx-auto` then centres the content in the space
        the sidebar leaves over, at every width, which is what "keep content
        centered, max-width around 1400px" asks for.
      */}
      <div className={cn(desktopSidebar && "lg:pl-[244px]")}>
        <DesktopHeader variant={variant} isAdmin={isAdmin} />

        {/*
          `pb-24` on mobile clears the fixed bottom bar. Without it the last row
          of every list sits underneath the navigation and cannot be tapped —
          which only shows up when a list is long enough to scroll to the end.

          Side padding: 16px on a phone, where 26px would cost a seventh of a
          375px screen, rising to 32px from `lg` and 40px at `2xl` — the widths
          that have room to give. `lg:pt-8` rather than the old `lg:pt-10`
          because `DesktopHeader` now sits above this and supplies the lead-in.
        */}
        <main className="mx-auto w-full max-w-[1400px] px-4 pb-24 pt-4 sm:px-6 lg:px-8 lg:pb-16 lg:pt-8 2xl:px-10">
          {children}
        </main>
      </div>

      <BottomBar nav={bottomNav} hideOnDesktop={desktopSidebar} />

      {/*
        ★ Mounted here, so it is on every authenticated screen and on none of
        the unauthenticated ones — `AuthShell` wraps login and the invitation
        pages and never renders this. One instance for the app, which is what
        keeps the panel's open state from resetting on every navigation.
      */}
      <ChatWidget />

      <MobileMenuDrawer
        open={menuOpen}
        onOpenChange={setMenuOpen}
        nav={nav}
        sections={sections}
        shortcuts={shortcuts}
        subtitle={subtitle}
        variant={variant}
        isAdmin={isAdmin}
        childSwitcher={childSwitcher}
      />
    </div>
  );
}

/**
 * The desktop header — the one row of chrome above every screen from `lg` up.
 *
 * ★ It exists because two things were being rendered per *page* that belong to
 * the *app*: the notification bell and an identity pill, both inside
 * `PageHeader`, both `hidden … lg:*`. Thirty-four screens each rendered their
 * own copy of a control that never varies, and a screen that forgot to use
 * `PageHeader` silently had no bell at all.
 *
 * ★★ Context on the left, and it is deliberately not a *selector*.
 *
 * The brief asks for a "kindergarten/group selector where applicable", and for
 * a teacher there is no applicable choice: `use-my-group.ts` and `WhoAmI` both
 * record that this product assigns a teacher exactly one group and that a
 * switcher "would invent a choice the product does not offer". So the group is
 * stated, as a chip, and the date sits beside it — the two facts that scope
 * every number on a teacher's screen. An admin sees every group, so naming one
 * of them would be a lie; they get the date alone, as does a parent.
 *
 * ★★★ The profile area is an avatar, not a second name.
 *
 * The sidebar's own footer names the signed-in person forty pixels away, and
 * `page-header.test.tsx` exists because that name was previously on screen
 * twice at this exact width. The header carries the affordance — a 40px target
 * that opens `/settings` — and puts the name in its accessible label, where it
 * is available to a screen reader without being read twice by eye.
 */
function DesktopHeader({ variant, isAdmin }: { variant: Variant; isAdmin: boolean }) {
  const { session, hasRole } = useSession();
  /*
    ★ `hasRole("TEACHER")`, not "the teacher variant and not an admin".

    Since 2026-08-30 a cook and an accountant share this variant — they are
    employees of one kindergarten and the frame is the same — and neither
    teaches a group. `GET /groups` is `@Roles("TEACHER","ADMIN")`, so the old
    condition fired a request that 404s on every render of their shell, four
    times a page load, to fill a chip that was never going to have a value.
  */
  const isTeacher = variant === "teacher" && !isAdmin && hasRole("TEACHER");
  const { group, count } = useMyGroup({ enabled: isTeacher });

  return (
    <header
      data-print-hide
      /*
       * Sticky rather than fixed: a fixed header would need every page below it
       * padded by its own height, which is the class of coupling `AppShell`
       * exists to keep out of the screens. `bg-surface` and the hairline are
       * what separate it from the canvas as content scrolls under it.
       *
       * `z-10` sits under the sidebar's `z-20` on purpose — the sidebar is a
       * full-height panel to the left and nothing here should ever paint over
       * it.
       */
      className="sticky top-0 z-10 hidden border-b border-border bg-surface lg:block"
    >
      {/*
        ★ The bar is full-bleed; its contents are not.

        The hairline has to run the whole width or it stops reading as the edge
        of the chrome. What sits on it must line up with the page underneath —
        measured at 1920, an uncapped row put the avatar at x≈1900 while the
        content column ended at 1782, so the profile control floated 118px past
        every card it was meant to sit above. Same cap and same padding as
        `<main>`, so the two columns are one column.
      */}
      <div className="mx-auto flex w-full max-w-[1400px] items-center gap-4 px-8 py-3 2xl:px-10">
        {/*
          ★ The group, and no longer the date.

          Both were here until 2026-08-28, when `/dashboard` began stating
          "Дэлбээ бүлэг · 2026.08.28" as its own lede — the same two facts, sixty
          pixels below, at every width this header exists at. `PageHeader` has a
          test file devoted to precisely that kind of duplication (a name
          appearing twice at `lg`), and the resolution is the same one it
          reached: a fact belongs to whichever surface can state it once.

          The date went because a page that is about today is the thing that
          should say so. The group stays, because it is the piece of context the
          other thirty-three screens have nowhere else to get.
        */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {isTeacher && count === 1 && group ? (
            <span className="shrink-0 rounded-pill bg-primary-soft px-3 py-1 text-caption font-semibold text-primary">
              {group.name}
            </span>
          ) : null}
        </div>

        <NotificationBell />

        <Link
          href="/settings"
          aria-label={`${fullName(session?.user)} — тохиргоо`}
          className="grid size-11 shrink-0 place-items-center rounded-control transition-colors hover:bg-canvas"
        >
          <span className="grid size-9 place-items-center rounded-pill bg-primary-soft text-caption font-semibold text-primary">
            {initials(session?.user)}
          </span>
        </Link>
      </div>
    </header>
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
      {/*
        ★ `bg-primary-soft`, not the `#f1efff` this carried until 2026-08-28.
        That literal was left over from the violet palette two repaints ago —
        `globals.css` records both — so the one tinted square in the sidebar was
        the only surface in the product that did not move when the brand
        colour did. It is also the arbitrary-colour mistake the token system
        exists to prevent, sitting in the shell.
      */}
      <span className="grid size-10 shrink-0 place-items-center rounded-control bg-primary-soft p-0.5">
        <Image
          src="/mark.png"
          alt={BRAND}
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
 * Ported from `.whoami`; the logout control is a 44px square, as it is there.
 */
/**
 * The sidebar's foot: who is signed in, where they are, and the way out.
 *
 * ★ The second line names the person's **context**, not the section they are
 * looking at.
 *
 * It used to repeat the sidebar's own subtitle — "Багшийн хэсэг" under a
 * teacher's name, on the teacher's sidebar. A label that restates the panel it
 * sits in tells a reader nothing. A teacher now sees the group they are
 * responsible for, and everyone else sees their role.
 *
 * ★★ The group appears only when there is exactly one, and only for a teacher
 * who is not an admin.
 *
 * `GET /groups` returns every group in the kindergarten to an admin, so
 * showing the first would tell them they run "Дэлбээ" when they run all of it —
 * and `TeacherAssignment` permits a second group, where naming one of two is a
 * silent lie. Both fall back to the role. There is deliberately no picker: the
 * product gives a teacher one group, and a switcher would invent a choice that
 * does not exist.
 */
function WhoAmI({ variant, isAdmin }: { variant: Variant; isAdmin: boolean }) {
  const { session, hasRole } = useSession();
  const logout = useLogout();

  // `hasRole("TEACHER")` for the reason `DesktopHeader` gives: the teacher
  // variant now covers three roles and only one of them has a group.
  const isTeacher = variant === "teacher" && !isAdmin && hasRole("TEACHER");
  const { group, count } = useMyGroup({ enabled: isTeacher });

  /*
    ★ The role a person is actually in, named from `ROLE_LABEL` — 2026-08-30.

    This chain read `isAdmin ? "Админ" : "Багш"` under the teacher shell, which
    was true while the teacher shell held only those two. A cook and an
    accountant share that shell now (they are staff of a kindergarten and get
    the same frame), so the fallback would have labelled both of them "Багш" —
    the one line on screen that tells a person what the system thinks they are.

    A teacher with exactly one group still sees the group's name instead: it is
    the more useful fact, and it is what the client's drawing shows.
  */
  const context =
    isTeacher && count === 1 && group
      ? group.name
      : variant === "platform"
        ? "Платформын удирдлага"
        : ROLE_LABEL[highestRole(session?.memberships)];

  return (
    /*
      ★ A rule above it, because the list scrolls behind it.

      On a short window the nav overflows and its last row is cut by this
      footer. Without a boundary that reads as a boundary the cut looks like a
      rendering fault; with one, the list visibly continues underneath. The
      negative margin makes the rule span the panel's full width rather than
      stopping at this card's own inset.
    */
    /*
      ★ REDESIGN 2026-09-03 — the footer reads as an account card.

      It was a flat `bg-canvas` strip with a 28px initials dot, which at the
      foot of a white panel was barely distinguishable from the nav rows above
      it. A bordered sunken card with a 36px avatar gives the identity a
      surface of its own, which is what makes "this is you, and this is the way
      out" legible at a glance rather than on inspection.

      `bg-sunken` and not a tint: this is chrome, not content, and a coloured
      footer would be the loudest thing in a panel whose active row is supposed
      to be.
    */
    <div className="-mx-3.5 shrink-0 border-t border-border px-3.5 pt-3">
      <div className="flex min-h-[44px] items-center gap-2.5 rounded-row border border-border bg-sunken px-2.5 py-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-pill bg-primary-soft text-compact font-bold text-primary">
          {initials(session?.user)}
        </span>

        {/*
          `min-w-0` on the growing column and `truncate` on both lines: a
          Mongolian full name and a group name are each long enough to push the
          two buttons off the 244px panel, and the name is what has to give.
        */}
        {/*
          ★ The identity *is* the settings link, rather than a third control
          beside the other two.

          A separate 44px settings button is the obvious reading of "settings in
          the footer", and it does not fit: the panel is 244px, and an avatar plus
          two tap targets plus padding leaves about 96px for the name — which
          truncates a Mongolian full name to a few characters. Tapping your own
          name to reach your own account is the conventional affordance anyway,
          and it costs no width, so the column keeps ~140px.
        */}
        {/*
          ★ `min-h-[44px]` and centred — measured at 33.6px in browser QA,
          2026-09-03.

          The row around it carries the 44px floor, but this link is the actual
          tap target for `/settings` and it was only as tall as its own two
          lines of text. `justify-center` keeps the name optically centred in
          the taller box rather than pinned to its top.
        */}
        <Link
          href="/settings"
          className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center rounded-control hover:opacity-80"
          aria-label={`${fullName(session?.user)} — тохиргоо`}
        >
          <span className="block truncate text-compact font-semibold leading-[1.2] text-ink">
            {fullName(session?.user)}
          </span>
          <span className="block truncate text-caption text-muted">{context}</span>
        </Link>

        <button
          type="button"
          onClick={() => void logout()}
          aria-label="Гарах"
          className="grid size-11 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-surface hover:text-danger"
        >
          <LogOut size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/**
 * The menu itself — brand, primary link, sections, identity — with no opinion
 * on what frames it.
 *
 * ★ Split out of `Sidebar` so `MobileMenuDrawer` renders the exact same
 * markup rather than a second copy that could drift from it. The only thing
 * that differs between the two frames is layout (a fixed column vs. a Radix
 * dialog panel) and, on mobile, that tapping a link should also close the
 * drawer — handled by the drawer's own wrapper (`closeOnLinkClick`), not by
 * this component, so neither `NavLink` nor `NavGroup` needs to know a drawer
 * exists.
 */
function SidebarContent({
  nav,
  sections,
  shortcuts,
  subtitle,
  variant,
  isAdmin,
  childSwitcher,
}: {
  nav: NavItem[];
  sections?: NavSection[];
  /** "Түргэн холбоос" — see `NavShortcuts`. Omitted, nothing is drawn. */
  shortcuts?: NavItem[];
  /** The brand's second line — which part of the product this is. */
  subtitle: string;
  variant: Variant;
  /** Whether the signed-in person administers this kindergarten. */
  isAdmin: boolean;
  childSwitcher?: ChildSwitcher;
}) {
  const pathname = usePathname();

  // The first item stays a top-level link above the sections, as "Хяналтын
  // самбар" does in the reference. The rest are reachable from the sections
  // below and from the bottom bar on a phone.
  const [primary] = nav;

  return (
    <>
      <Brand subtitle={subtitle} />

      {/*
        Above the scrolling list rather than inside it: which child the sidebar
        is about is not one of the rows it scrolls past, and a switcher that
        can scroll out of sight is a switcher a parent cannot find.
      */}
      {childSwitcher ? <ChildSwitcherControl switcher={childSwitcher} /> : null}

      {/*
        ★ A fade at the bottom edge, so a cut-off row reads as "there is more"
        rather than as a layout fault.

        The list scrolls whenever the window is short enough, and on macOS the
        scrollbar is an overlay that stays invisible until it is used — so the
        only signal was a row sliced in half at the bottom of the rail. The
        gradient is `--color-surface` fading to transparent over the last 24px
        and is `pointer-events-none`, so it cannot eat a click on the row
        underneath it.

        `group-has-[:last-child]` is not available here, so it is unconditional:
        over a list that does not scroll it sits on the panel's own background
        and is invisible anyway.

        ★★ Both sides of this conflict were real, and the merge keeps both.
        `origin/main` added the child switcher; this branch added the fade and
        the wrapper it needs. Taking either alone would have lost a fix that
        shipped for a reason — the switcher went in one commit above the list,
        the fade one commit below it, and neither touches the other's job.
      */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="-mr-1.5 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1.5">
          {primary ? <NavLink item={primary} pathname={pathname} orientation="vertical" /> : null}

          {shortcuts?.length ? <NavShortcuts items={shortcuts} pathname={pathname} /> : null}

          {sections?.length ? (
            /*
                ★ `display: contents`, so the wrapper is in the DOM but not in
                the layout — the sections keep the parent's own `gap-0.5`
                rhythm rather than becoming one flex child with none.

                It exists because "Хүүхдүүд" and "Ирц" appear twice in this
                sidebar since the shortcut box returned (2026-09-05), and an
                assertion about the *section* menu needs to be able to say so.
                `sidebar.test.tsx` scopes to it.
              */
            <div data-testid="nav-sections" className="contents">
              {sections.map((section) => (
                <NavGroup key={section.title} section={section} pathname={pathname} />
              ))}
            </div>
          ) : (
            nav
              .slice(1)
              .map((item) => (
                <NavLink key={item.label} item={item} pathname={pathname} orientation="vertical" />
              ))
          )}
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-surface to-transparent"
        />
      </div>

      {/*
        ★ Both sides of this conflict were carrying a real improvement, and the
        merge keeps both rather than picking one.

        `origin/main` extracted this `SidebarContent` so the desktop column and
        the phone's `MobileMenuDrawer` render one menu instead of two copies —
        that extraction is the whole reason the drawer stays in step with the
        sidebar, so it stays.

        This side threaded `variant` and `isAdmin` down to `WhoAmI`, which is
        what lets the identity row say "Захирал" rather than calling every
        administrator a teacher. `origin/main`'s `WhoAmI` predates that and
        took `subtitle` instead. The props are threaded through the extracted
        component, so the drawer gets the correct role line too — which the
        pre-merge code on neither side did.
      */}
      <WhoAmI variant={variant} isAdmin={isAdmin} />
    </>
  );
}

function Sidebar({
  nav,
  sections,
  shortcuts,
  subtitle,
  variant,
  isAdmin,
  childSwitcher,
}: {
  nav: NavItem[];
  sections?: NavSection[];
  shortcuts?: NavItem[];
  subtitle: string;
  variant: Variant;
  isAdmin: boolean;
  childSwitcher?: ChildSwitcher;
}) {
  return (
    <nav
      aria-label="Үндсэн цэс"
      // Chrome, not content — see the print block in `globals.css`.
      data-print-hide
      /*
       * ★ Only the menu scrolls.
       *
       * The sidebar can be taller than a laptop viewport, and when the whole
       * panel scrolled, `WhoAmI`'s row sat at the foot of the *content* rather
       * than the panel — so it overlapped the last section and the way out
       * scrolled off the screen. The brand and the identity are fixed now, and
       * the nav between them takes the overflow.
       */
      className="fixed inset-y-0 left-0 z-20 hidden w-[244px] flex-col gap-5 overflow-hidden border-r border-border bg-surface px-3.5 py-[18px] lg:flex"
    >
      <SidebarContent
        nav={nav}
        sections={sections}
        shortcuts={shortcuts}
        subtitle={subtitle}
        variant={variant}
        isAdmin={isAdmin}
        childSwitcher={childSwitcher}
      />
    </nav>
  );
}

/**
 * The parent's own child picker, above the sidebar's nav — the only place a
 * family with more than one child chooses which is "current" for the
 * sections below and for Home's tiles. Uses the same `Select` every form in
 * this product uses (`components/ui/field.tsx`) rather than a bespoke
 * control, so it does not have to teach a second interaction pattern for one
 * dropdown.
 */
function ChildSwitcherControl({ switcher }: { switcher: ChildSwitcher }) {
  return (
    <div>
      <label htmlFor="child-switcher" className="sr-only">
        Хүүхэд сонгох
      </label>
      <Select
        id="child-switcher"
        value={switcher.selectedId}
        onChange={(event) => switcher.onSelect(event.target.value)}
      >
        {switcher.children.map((child) => (
          <option key={child.id} value={child.id}>
            {fullName(child)}
          </option>
        ))}
      </Select>
    </div>
  );
}

/**
 * The same sidebar, off-canvas — how a phone reaches everything the desktop
 * column shows for free.
 *
 * ★ A right-side sheet, not a centred dialog. It opens from the tab that
 * triggered it (the bottom bar's rightmost item) and matches the desktop
 * sidebar's own 244px width — one "how wide is a menu" answer for the
 * product, not two.
 *
 * ★★ Closes itself on a link tap, via event delegation on the one wrapper
 * rather than threading a callback through `NavLink` and `NavGroup`. Every
 * real destination in this menu is an `<a>` — `WhoAmI`'s logout button is
 * not, and does not need to close anything it is about to navigate away from
 * regardless.
 */
function MobileMenuDrawer({
  open,
  onOpenChange,
  nav,
  sections,
  shortcuts,
  subtitle,
  variant,
  isAdmin,
  childSwitcher,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nav: NavItem[];
  sections?: NavSection[];
  subtitle: string;
  /*
   * ★ Both added by the merge, and the drawer is the reason they matter.
   *
   * `SidebarContent` is shared with the desktop column, and its `WhoAmI` now
   * names the signed-in person's role. Without these the phone's menu would
   * render the one identity row in the product that calls an administrator a
   * teacher — the failure is invisible on a desktop, which is where this was
   * built.
   */
  variant: Variant;
  isAdmin: boolean;
  childSwitcher?: ChildSwitcher;
  shortcuts?: NavItem[];
}) {
  const closeOnLinkClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("a")) onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40 lg:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-[244px] max-w-[85vw] flex-col gap-5 border-l border-border bg-surface px-3.5 py-[18px] shadow-xl lg:hidden"
        >
          <Dialog.Title className="sr-only">Цэс</Dialog.Title>
          <Dialog.Close
            aria-label="Хаах"
            className="absolute right-3 top-3 grid size-11 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
          >
            <X size={18} aria-hidden="true" />
          </Dialog.Close>

          <div onClick={closeOnLinkClick} className="contents">
            <SidebarContent
              nav={nav}
              sections={sections}
              shortcuts={shortcuts}
              subtitle={subtitle}
              variant={variant}
              isAdmin={isAdmin}
              childSwitcher={childSwitcher}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * "Түргэн холбоос" — the two or three destinations opened every morning.
 *
 * ★ This was removed on 2026-08-23 and is back on 2026-09-05, at the client's
 * request, after they compared the two products side by side. Both arguments
 * are recorded here because the next person will meet them again.
 *
 * **Why it went:** its rows repeat entries that are one line below in the
 * sections, and on a phone they are in the bottom bar as well. A tinted grid
 * restating the menu underneath it is the widget that makes a sidebar look
 * like an admin template.
 *
 * **Why it is back:** repetition is the point of a shortcut. A teacher opens
 * Ирц every morning and should not read down four collapsed sections to find
 * it, and the reference system this product is modelled on puts the same box
 * in the same place. The duplication argument is true and was judged to cost
 * less than the daily scan.
 *
 * ★★ It renders **nothing** when it is not passed, so no audience gets an
 * empty tinted box, and a caller that has no obvious top three simply does not
 * pass any. `layout.tsx` builds the teacher's; every other role is left alone.
 *
 * ★★★ `aria-hidden` is deliberately NOT set. These are real links to real
 * destinations — a screen reader user gets them twice, once here and once in
 * the section, which is the same bargain a sighted user is being offered.
 * Hiding them would make the shortcut a sighted-only affordance.
 */
function NavShortcuts({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <nav aria-label="Түргэн холбоос" className="rounded-row border border-border bg-sunken p-2">
      <p className="px-1.5 pb-1.5 text-caption font-semibold uppercase tracking-[.06em] text-faint">
        Түргэн холбоос
      </p>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active = item.href
            ? pathname === item.href || pathname.startsWith(`${item.href}/`)
            : false;
          return (
            <li key={item.label}>
              <Link
                href={item.href ?? "#"}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[44px] items-center gap-2.5 rounded-control px-2 text-compact font-medium transition-colors",
                  active
                    ? "bg-surface text-primary shadow-sm"
                    : "text-muted hover:bg-surface hover:text-ink",
                )}
              >
                <span className="shrink-0">{item.icon}</span>
                <span className="min-w-0 leading-snug">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
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
    /*
      ★ No vertical padding, and no rule under the last section.
      
      Four sections at `py-0.5` plus their gaps put the staff sidebar 12px over
      its own scroll container at a 900px window — so the last entry rendered
      half-cut with no scrollbar to explain it (macOS draws overlay scrollbars,
      which are invisible until you scroll). It read as a broken layout rather
      than as a list that continues.
      
      `last:border-b-0` because the footer below already separates itself with
      its own tinted surface; the rule was drawing a second line 8px above it.
    */
    <details
      open
      className="border-b border-border last:border-b-0 [&[open]>summary>svg]:rotate-180"
    >
      {/*
        ★ REDESIGN 2026-09-03 — the section title is a label, not a heading in
        disguise.

        It was `text-compact font-semibold text-ink`, the same weight and
        colour as an *active* entry beneath it, so a collapsed group heading
        competed with the one row on screen that was meant to stand out.
        Uppercase at `text-caption` with tracking is the conventional treatment
        for a group label and it settles the hierarchy: headings recede, the
        current page is the loudest thing in the panel.

        `items-start` and `gap-2` for the same reason the entries have them —
        "Хүүхдийн хөгжил ба үнэлгээ" is the longest string in the menu and
        wraps to two lines at 244px.
      */}
      <summary className="flex min-h-[44px] cursor-pointer list-none items-start justify-between gap-2 px-2.5 py-3 text-caption font-semibold uppercase tracking-[.06em] text-faint transition-colors hover:text-muted [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 leading-snug">{section.title}</span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="mt-px shrink-0 text-faint transition-transform"
        />
      </summary>

      {section.entries.map((entry) => {
        if (!entry.href) {
          return (
            <span
              key={entry.label}
              className="ml-3 flex min-h-[44px] items-center gap-1.5 px-2.5 py-1.5 text-compact text-faint"
            >
              {entry.label}
              <span className="text-caption">(удахгүй)</span>
            </span>
          );
        }

        const active = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
        return (
          <Link
            key={entry.href}
            href={entry.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              /*
                ★ REDESIGN 2026-09-03 — `items-center` → `items-start` with
                `py-2.5`, because these labels wrap and used to be truncated.

                The label carried `truncate`, which is exactly what brief
                constraint 2 forbids: "Чөлөөний хүсэлт хянах" and "Ангийн
                самбар / Мэдээ" do not fit 244px minus an icon and padding at
                any weight, so the two longest entries in a teacher's menu were
                rendering as "Чөлөөний хүсэлт х…". A menu that hides the end of
                its own words is the first thing that reads as unfinished, and
                it is the one place the product can least afford ambiguity.

                Wrapping needs the row to grow, so the height is a `min-h`
                floor with real vertical padding rather than a fixed centre,
                and the icon gets `mt-px` to sit on the first line's optical
                centre instead of the block's.
              */
              "relative ml-3 flex min-h-[44px] items-start gap-2.5 rounded-control px-2.5 py-2.5 text-compact leading-snug transition-colors",
              active
                ? // The blue-700 rule is the active marker; the tint and the
                  // weight are what make it readable. Three signals, because
                  // colour alone must not carry the state.
                  "bg-primary-soft font-semibold text-primary before:absolute before:-left-2 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-pill before:bg-primary"
                : "text-muted hover:bg-canvas hover:text-ink",
            )}
          >
            <span className="mt-px shrink-0">{entry.icon}</span>
            <span className="min-w-0">{entry.label}</span>
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
 * Hidden from `lg` up on every variant, where the sidebar already carries all
 * three facts (brand, identity, logout). Showing them twice is what crowded
 * the page title in the reference, which solved it the same way.
 */
function MobileHeader({ subtitle }: { subtitle: string }) {
  return (
    <header
      className={cn(
        "sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-surface px-4 py-3 lg:hidden",
      )}
    >
      <Link href="/" className="flex min-h-[44px] items-center gap-3">
        <span className="grid size-[34px] shrink-0 place-items-center rounded-control bg-primary-soft p-0.5">
          <Image
            src="/mark.png"
            alt={BRAND}
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

      {/*
        ★ The bell, and only the bell — the avatar and the logout left on
        2026-08-28.

        The client's drawing puts one control up here: a bell with its unread
        count. Both of the others were already reachable one tap away and are
        still there: `MobileMenuDrawer`, behind the bottom bar's "Цэс" tab,
        renders `WhoAmI` with the signed-in name (a link to `/settings`) and
        the logout button beside it. Two identity controls in a header three
        inches above the tab that opens the same two is the duplication the
        drawer exists to remove.
      */}
      <div className="ml-auto flex items-center">
        <NotificationBell />
      </div>
    </header>
  );
}

function BottomBar({ nav, hideOnDesktop }: { nav: NavItem[]; hideOnDesktop: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      data-print-hide
      /*
       * ★ A distinct name from the sidebar's, which is also "Үндсэн цэс".
       *
       * Both landmarks shipped with the same label, so a screen reader's list
       * of navigation regions read "Үндсэн цэс, Үндсэн цэс" and neither entry
       * said which was which. They are both real — the sidebar from `lg` up,
       * this from below it — so the fix is two names, not one landmark.
       */
      aria-label="Доод цэс"
      className={cn(
        /*
          ★ REDESIGN 2026-09-03 — a shadow above the bar, not just a hairline.

          The bar sat on a 1px border, so content scrolling underneath ran
          right up to it and, on a white list, the two merged: the tabs looked
          like part of the page rather than like chrome floating over it. An
          upward shadow separates them at every scroll position, which a
          border cannot do.
        */
        "fixed inset-x-0 bottom-0 z-20 flex items-stretch justify-around border-t border-border bg-surface shadow-[0_-2px_12px_-4px_rgb(15_23_42_/_0.08)]",
        // `env(safe-area-inset-bottom)` keeps the tabs above the iPhone home
        // indicator, which otherwise overlaps the last few pixels of the row.
        "pb-[env(safe-area-inset-bottom)]",
        // ★ Forces its own compositor layer. A known iOS Safari quirk lets a
        // plain `fixed` element miss a repaint for a frame during momentum
        // scrolling — the address bar collapsing resizes the visual viewport
        // mid-gesture, and without its own layer this element sometimes
        // renders a beat late, reading as "disappeared". `translateZ(0)`
        // promotes it ahead of time instead of leaving that to chance. Pure
        // rendering hint, not a positioning change — `sticky` was tried
        // instead and reverted (see git history) because it broke any page
        // shorter than the viewport outright, which this does not risk.
        "transform-[translateZ(0)] will-change-transform",
        hideOnDesktop && "lg:hidden",
      )}
    >
      {nav.map((item) => (
        <NavLink key={item.label} item={item} pathname={pathname} orientation="horizontal" />
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
  // root of a section, or every item would match `/`. A button-style item
  // (no `href`) opens something in place — it is never the current page.
  const active = !item.href
    ? false
    : item.href === "/"
      ? pathname === "/"
      : pathname === item.href || pathname.startsWith(`${item.href}/`);

  const horizontal = orientation === "horizontal";

  const className = cn(
    "relative flex items-center rounded-control font-medium transition-colors",
    horizontal
      ? // ★ `min-h-[60px]` and `leading-tight`, because one tab's label wraps.
        //
        // "Явцын үнэлгээ" is two words and the client's drawing sets it on two
        // lines. The bar was `min-h-[56px]` with `leading-none`, which is right
        // for five one-word labels and makes two lines touch. The nav is
        // `items-stretch`, so the tallest tab sets the height for all five and
        // the row stays even.
        "min-h-[60px] flex-1 flex-col justify-center gap-1 px-1 py-2 text-center text-caption"
      : "min-h-[44px] gap-[11px] px-3 py-2.5 text-lead",
    /*
      ★ On a phone the tint is on the **icon**, not on the tab.

      The client's drawing puts a rounded light-blue square behind the current
      tab's glyph and leaves its label as plain blue text under it — so the
      whole-tab wash and the 3px rule across the top both came off. The
      sidebar keeps both: there a row is a full-width strip and the left-edge
      rule is what makes the current one findable down a column of eleven.

      Colour is still not the only signal. `aria-current="page"` is on the
      link, the label changes weight with the tint, and the icon's own
      background is a second visual cue beside the text colour.
    */
    active ? "text-primary" : "text-muted hover:text-ink",
    !horizontal && (active ? "bg-primary-soft" : "hover:bg-canvas"),
    !horizontal &&
      active &&
      "before:absolute before:left-0 before:top-1/2 before:h-6 before:w-[3px] before:-translate-y-1/2 before:rounded-pill before:bg-primary",
  );

  const content = (
    <>
      <span
        className={cn(
          // ★ `transition-all` and a slight scale on the active well — the tab
          // now visibly *settles* when it becomes current instead of the tint
          // appearing instantly. 150ms, and `prefers-reduced-motion` flattens
          // it globally, so it stays a cue rather than an animation.
          "relative flex items-center justify-center transition-all duration-150",
          // The tinted well the drawing puts behind the active glyph. Sized so
          // a 20px icon sits in a 40×28 rounded rectangle, as drawn.
          horizontal && "h-7 w-10 rounded-control",
          horizontal && active && "scale-105 bg-primary-soft",
        )}
      >
        {item.icon}
        {item.badge === "unread" ? <UnreadDot /> : null}
      </span>
      <span className={cn(horizontal && "leading-tight", horizontal && active && "font-semibold")}>
        {item.label}
      </span>
    </>
  );

  if (!item.href) {
    return (
      <button type="button" onClick={item.onSelect} className={className}>
        {content}
      </button>
    );
  }

  return (
    <Link
      href={item.href}
      // The single most useful ARIA attribute in a navigation: it tells a
      // screen reader which page you are on, which colour alone cannot.
      aria-current={active ? "page" : undefined}
      className={className}
    >
      {content}
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

/**
 * The role to call someone by, when they hold more than one.
 *
 * ★ Ranked, not `memberships[0]`.
 *
 * A director is very often ADMIN *and* TEACHER — they run the kindergarten and
 * they have a group — and the array's order is whatever Prisma returned. The
 * line under their name is the one place the app tells a person what it thinks
 * they are, and telling a director "Багш" because their teacher membership was
 * created first is exactly the mislabelling the old `isAdmin ? … : …` was
 * written to avoid. This keeps that guarantee and extends it to the two roles
 * added on 2026-08-30.
 *
 * Falls back to PARENT: a guardian holds one membership and never reaches the
 * tie-break at all.
 */
function highestRole(memberships: { role: Role }[] | undefined): Role {
  const rank: Role[] = ["ADMIN", "TEACHER", "ACCOUNTANT", "COOK", "PARENT"];
  for (const role of rank) {
    if (memberships?.some((m) => m.role === role)) return role;
  }
  return "PARENT";
}

/** The masthead line for the roles that share the staff frame. */
const SUPPORT_SUBTITLE: Partial<Record<Role, string>> = {
  COOK: "Гал тогооны хэсэг",
  ACCOUNTANT: "Санхүүгийн хэсэг",
};

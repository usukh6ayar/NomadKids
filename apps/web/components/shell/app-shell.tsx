"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import {
  createContext,
  isValidElement,
  useId,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
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
import { Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/states";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { formatRelative, fullName, initials } from "@/lib/format";
import { BRAND } from "@/lib/vocabulary";
import { Art } from "@/components/ui/art";
import { cn } from "@/lib/utils";
import { useMyGroup } from "@/components/dashboard/use-my-group";
import { ChildAvatar } from "@/components/media/media-image";
import { ChatWidget } from "@/components/chat/chat-widget";

/** The bell panel reads five rows; the feed reads fifteen and paginates. */
const bellListSchema = paginated(notificationSchema);

/** Which audience this shell is rendering for. */
export type Variant = "teacher" | "parent" | "platform";
export type WorkspaceTheme = "teacher" | "admin" | "parent" | "kitchen" | "finance" | "platform";

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
  /** Small trailing context used by the guardian service row. */
  tag?: string;
  /** Runs instead of navigating. See `href`. */
  onSelect?: () => void;
}

/**
 * A navigation section used to organize route configuration and permissions.
 * The sidebar flattens these entries into one list, and a section's title is
 * not shown — unless it sets `collapsible`, which is what that title names.
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
  /**
   * Renders the section as one folding row named by `title`, instead of
   * flattening its entries into the list around it. The parent menu's
   * "Тусламж" is the only one; see `parentSections`.
   *
   * ★ This replaced `separatorBefore`, which was set once and read nowhere —
   * the divider it promised had never been drawn. A folding header separates
   * the same two blocks and is the thing the client asked for, so the dead
   * flag went rather than being left beside a working one.
   */
  collapsible?: boolean;
  /** The mark on a `collapsible` section's own header row. */
  icon?: ReactNode;
  entries: {
    label: string;
    href?: string;
    badge?: "unread";
    tag?: string;
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

const WorkspaceThemeContext = createContext<WorkspaceTheme | null>(null);

function navIconTone(label: string) {
  const normalized = label.toLocaleLowerCase("mn-MN");
  if (normalized.includes("ирц") || normalized.includes("хүүхд")) {
    return "bg-sky text-sky-ink";
  }
  if (normalized.includes("үнэлгээ") || normalized.includes("тайлан")) {
    return "bg-peach text-peach-ink";
  }
  if (normalized.includes("хоол") || normalized.includes("цэс")) return "bg-sun text-sun-ink";
  if (
    normalized.includes("мэдээ") ||
    normalized.includes("чат") ||
    normalized.includes("судалгаа")
  ) {
    return "bg-mint text-mint-ink";
  }
  return "bg-cornflower text-primary";
}

function isBackgroundlessArt(icon: ReactNode) {
  return isValidElement(icon) && icon.type === Art;
}

/**
 * The page header: a title and the screen's own actions.
 *
 * ★ Ported from the reference's `.topbar`, which every one of its screens uses.
 *
 * ★★ Supporting text is opt-in. Most screens need only their title; workflow
 * screens can add one sentence when it changes how the task should be done.
 *
 * ★★★ The search box is opt-in, and it is not decoration.
 *
 * `search` renders a real field: `/children` already accepts `?q=` and the API
 * already filters on it, so submitting navigates into the existing search
 * rather than into a box that swallows what you type. It is off by default —
 * a search field on a settings screen searches nothing.
 *
 * Identity and notification controls stay out of this per-page component.
 * Desktop reaches them from the sidebar; mobile carries the notification bell
 * in its compact header. The row stays focused on the current screen and its
 * actions.
 */
export function PageHeader({
  title,
  actions,
  search = false,
  meta,
  lede,
}: {
  title: string;
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
  /** A screen-specific sentence that adds context beyond the page title. */
  lede?: ReactNode;
  /**
   * A chip row under the title — counts, status, the term being viewed.
   *
   * Sits below the title rather than beside it: Mongolian compounds wrap at
   * almost every width (`--leading-heading` exists for exactly that), and a
   * chip sharing the title's line is the first thing to be pushed off it.
   */
  meta?: ReactNode;
}) {
  return (
    <div
      data-ui="page-header"
      className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 lg:mb-5"
    >
      {/* `icon` remains a compatibility prop, but the compact header does not
          spend a second visual slot on decorative artwork. */}
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-display font-semibold leading-heading tracking-[-0.02em] text-ink">
            {title}
          </h1>

          {lede ? <div className="mt-1 text-body text-muted">{lede}</div> : null}

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
      {actions ? (
        <div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      ) : null}
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
        Capped at 360px. It is wide enough for the more explicit Mongolian
        placeholder without becoming the page's main event. The teacher shell
        opts into 380px where the toolbar has the full workspace width.
      */
      className={cn("min-w-0 lg:mx-auto lg:w-[min(360px,32vw)]", className)}
    >
      <label htmlFor={id} className="sr-only">
        Хүүхэд хайх
      </label>
      <div className="group relative rounded-control border border-border bg-surface shadow-sm transition-all focus-within:border-primary focus-within:shadow-md">
        <span className="pointer-events-none absolute left-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-control bg-primary-soft text-primary transition-colors group-focus-within:bg-primary group-focus-within:text-primary-ink">
          <Search size={17} aria-hidden="true" />
        </span>
        {/*
          ★ The shared `Input`, not a bespoke field.

          This was `h-[44px] rounded-pill`, while `/children` — the screen this
          submits into — renders the 48px `rounded-control` `Input`. The shared
          input keeps the height and keyboard behaviour aligned; the wrapper
          supplies the persistent search identity and focus treatment.

          `Input` also names no font size, which is what keeps a focused field
          at the 16px iOS needs. That property was the reason this field was
          wrong before; inheriting it is how it stays right.
        */}
        <Input
          id={id}
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Хүүхдийн нэр эсвэл овгоор хайх"
          className="border-0 bg-transparent pl-12 pr-12 shadow-none focus:bg-transparent"
        />
        {term ? (
          <button
            type="button"
            onClick={() => setTerm("")}
            aria-label="Хайлтыг цэвэрлэх"
            title="Хайлтыг цэвэрлэх"
            className="absolute right-0.5 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-control text-muted transition-colors hover:bg-canvas hover:text-ink"
          >
            <X size={17} aria-hidden="true" />
          </button>
        ) : null}
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
 * It is mounted by the mobile header. Desktop reaches the same feed from the
 * sidebar's Мэдээ row and unread badge, avoiding a separate toolbar whose only
 * job was to repeat navigation already present beside it.
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
  children,
  variant = "teacher",
  isAdmin = false,
  childSwitcher,
  teacherTheme = false,
  workspaceTheme,
}: {
  nav: NavItem[];
  /** Desktop sidebar sections. Without them the sidebar renders `nav` flat. */
  sections?: NavSection[];
  children: ReactNode;
  variant?: Variant;
  /** Login palette, enabled only by the teacher workspace. */
  teacherTheme?: boolean;
  /** Role-specific colour and surface vocabulary for the authenticated workspace. */
  workspaceTheme?: WorkspaceTheme;
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
  const pathname = usePathname();
  const resolvedTheme = workspaceTheme ?? (teacherTheme ? "teacher" : null);
  const isTeacherWorkspace = resolvedTheme === "teacher";
  /*
   * ★ Restored 2026-09-10. It was dropped — with the `<ChatWidget />` below —
   * by `d8af069`, a commit about ESIS demo mode that had no business touching
   * either. Nothing referenced the widget afterwards, so it simply stopped
   * rendering anywhere in the product and no test caught it: `sidebar.test.tsx`
   * asserts chat has no *menu row*, which stayed true, and the floating button
   * it names as the reason for that is the thing that had gone.
   */
  const hasDedicatedChatNavigation = resolvedTheme === "teacher" || resolvedTheme === "admin";
  const isChatPage = pathname === "/chat";

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
        ? "Удирдлагын хэсэг"
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
    <WorkspaceThemeContext.Provider value={resolvedTheme}>
      <div className="min-h-dvh bg-canvas" data-app-theme={resolvedTheme ?? undefined}>
        {desktopSidebar ? (
          <Sidebar
            nav={nav}
            sections={sections}
            subtitle={subtitle}
            variant={variant}
            isAdmin={isAdmin}
            childSwitcher={childSwitcher}
            teacherTheme={isTeacherWorkspace}
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

        The frame now owns the sidebar offset (`lg:pl-[232px]`: the 220px rail
        plus a 12px gutter), padding rather than margin, so it cannot collide
        with auto-centring. The column inside it owns the cap. `mx-auto` then
        centres the content in the space the sidebar leaves over, at every
        width.
      */}
        <div
          className={cn(
            desktopSidebar &&
              (isTeacherWorkspace
                ? "lg:pl-[276px]"
                : variant === "parent"
                  ? "lg:pl-[256px]"
                  : "lg:pl-[232px]"),
          )}
        >
          {/*
          `pb-24` on mobile clears the fixed bottom bar. Without it the last row
          of every list sits underneath the navigation and cannot be tapped —
          which only shows up when a list is long enough to scroll to the end.

          Side padding: 16px on a phone, where 26px would cost a seventh of a
          375px screen, rising to 28px from `lg` and 32px at `2xl` — the widths
          that have room to give. Desktop starts directly with the page header;
          the separate top toolbar was removed so it does not spend a full row
          on controls already available from the sidebar and each list page.

          ★ The cap is 1920px as of 2026-09-09, raised from 1420px on the
          client's instruction that the desktop layout should use the full
          width. It is a raise rather than a removal: at 1420px a 2560px
          monitor left a third of the screen empty on either side, and with no
          cap at all the same monitor gives a register row roughly 2400px of
          travel between a child's name and the figure at the end of it, which
          is the distance the eye loses a row over. 1920px covers every laptop
          and nearly every desktop panel in use; only wider ones centre.
        */}
          <main
            data-layout={isChatPage ? "full-page" : "content"}
            className={cn(
              "w-full",
              isChatPage
                ? "h-[calc(100dvh-4.25rem)] overflow-hidden pb-[calc(var(--size-bottom-nav)+env(safe-area-inset-bottom))] lg:h-dvh lg:max-w-none lg:pb-0"
                : "mx-auto max-w-[1920px] px-4 pb-24 pt-4 sm:px-6 lg:px-7 lg:pb-16 lg:pt-6 2xl:px-8",
            )}
          >
            {children}
          </main>
        </div>

        <BottomBar nav={bottomNav} hideOnDesktop={desktopSidebar} />

        {/*
          Teachers and administrators already have Chat in the sidebar, the
          mobile menu and the dashboard preview. The floating trigger covered
          register actions and form controls, so it stays only for audiences
          without that navigation — a parent, a cook, an accountant.
        */}
        {!hasDedicatedChatNavigation ? <ChatWidget /> : null}

        <MobileMenuDrawer
          open={menuOpen}
          onOpenChange={setMenuOpen}
          nav={nav}
          sections={sections}
          subtitle={subtitle}
          variant={variant}
          isAdmin={isAdmin}
          childSwitcher={childSwitcher}
        />
      </div>
    </WorkspaceThemeContext.Provider>
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
      <span data-brand-mark className="grid size-[52px] shrink-0 place-items-center">
        <Image
          src="/brand-mark.png"
          alt={BRAND}
          width={52}
          height={52}
          className="size-full object-contain"
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
 * The sidebar's foot: who is signed in and the route to their profile.
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

  // The teacher variant covers three staff roles; only a real teacher has a
  // group to show beneath their name.
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
    <div className="-mx-1 shrink-0 border-t border-border-soft pt-3">
      {/*
        ★ Named "Тохиргоо", not "Профайл" — 2026-09-10, with the rename that
        gave `/settings` one name in every role's menu.

        This row is the sidebar's only door to that screen (`SidebarContent`
        filters the `/settings` entry out of the nav lists so it is not offered
        twice), so its accessible name is what a screen-reader user is told the
        destination is called. "Профайл" here and "Тохиргоо" in the menu is the
        same screen under two names, which is the confusion this pass removes.

        The person's name stays in the label: the row shows their name and
        their role, and an accessible name of just "Тохиргоо" would drop what
        the row visibly says.
      */}
      <Link
        href="/settings"
        aria-label={`Тохиргоо: ${fullName(session?.user)}`}
        className="group flex min-h-[56px] items-center gap-2.5 rounded-card bg-canvas/70 px-3 py-2 transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-pill bg-primary-soft text-compact font-bold text-primary">
          {initials(session?.user)}
        </span>

        {/* The whole row is the one profile affordance. Long names yield to
            the route chevron instead of widening the sidebar. */}
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <span className="block truncate text-compact font-semibold leading-[1.2] text-ink">
            {fullName(session?.user)}
          </span>
          <span className="block truncate text-caption text-muted">{context}</span>
        </div>
        <ChevronRight
          size={17}
          className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
          aria-hidden="true"
        />
      </Link>
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
 * this component, so `NavLink` does not need to know a drawer exists.
 */
function SidebarContent({
  nav,
  sections,
  subtitle,
  variant,
  isAdmin,
  childSwitcher,
  showTeacherArt = false,
}: {
  nav: NavItem[];
  sections?: NavSection[];
  /** The brand's second line — which part of the product this is. */
  subtitle: string;
  variant: Variant;
  /** Whether the signed-in person administers this kindergarten. */
  isAdmin: boolean;
  childSwitcher?: ChildSwitcher;
  showTeacherArt?: boolean;
}) {
  const pathname = usePathname();
  const sectionEntries =
    sections?.flatMap((section) => section.entries).filter((entry) => entry.href !== "/settings") ??
    [];

  // The first item stays a top-level link above the sections, as "Хяналтын
  // самбар" does in the reference. The rest are reachable from the sections
  // below and from the bottom bar on a phone.
  const [primary] = nav;

  /*
    ★ Resolved once for the whole rail, not per row.

    The primary link and every section entry are one visual list, so they
    compete for the same highlight — see `activeHrefIn` for what went wrong
    when each row decided for itself.
  */
  const activeHref = activeHrefIn(pathname, [
    primary?.href,
    ...(sections ? sectionEntries : nav.slice(1)).map((entry) => entry.href),
  ]);

  return (
    <>
      <Brand subtitle={subtitle} />

      {variant === "parent" ? (
        <ParentSidebarContent
          primary={primary}
          sections={sections ?? []}
          pathname={pathname}
          childSwitcher={childSwitcher}
        />
      ) : (
        <>
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
              {primary ? (
                <NavLink
                  item={primary}
                  pathname={pathname}
                  orientation="vertical"
                  activeHref={activeHref}
                />
              ) : null}

              {sectionEntries.length ? (
                <div data-testid="nav-sections" className="contents">
                  {/*
                    ★ **An administrator's menu keeps its section headings;
                    nobody else's does — 2026-09-10, at the client's request:**
                    "захирал илүү их зүйлтэй болохоор category хэрэгтэй
                    байна... бусдыг категорилох хэрэггүй".

                    `staffSections` has always returned titled sections, and
                    this list has always thrown the titles away with a
                    `flatMap`. For a teacher that is right: six rows read fine
                    as one list, and headings over them are furniture. A
                    director sees fourteen, and at that length the same list
                    needs the headings the data already carries.

                    ★★ **Flat headings, never a disclosure.** The client was
                    explicit — "тэгэхдээ хураагддаараар биш". Nothing folds; a
                    heading is a heading.

                    ★★★ The grouping is `staffSections`' own, unchanged. An
                    earlier attempt at this moved rows between sections and
                    renamed two of them, which is not what was asked: the
                    categories existed already and only needed drawing.
                  */}
                  {isAdmin && sections
                    ? sections.map((section, sectionIndex) => (
                        <div key={section.title} className="contents">
                          <p
                            className={cn(
                              "px-3 pb-1 pt-5 text-caption font-semibold uppercase tracking-wide text-faint",
                              sectionIndex === 0 && "pt-2",
                            )}
                          >
                            {section.title}
                          </p>
                          {section.entries.map((entry, index) => (
                            <NavLink
                              key={`${entry.href ?? entry.label}-${index}`}
                              item={{ ...entry, icon: entry.icon ?? null }}
                              pathname={pathname}
                              orientation="vertical"
                              activeHref={activeHref}
                            />
                          ))}
                        </div>
                      ))
                    : sectionEntries.map((entry, index) => (
                        <NavLink
                          key={`${entry.href ?? entry.label}-${index}`}
                          item={{ ...entry, icon: entry.icon ?? null }}
                          pathname={pathname}
                          orientation="vertical"
                          activeHref={activeHref}
                        />
                      ))}
                </div>
              ) : (
                nav
                  .slice(1)
                  .filter((item) => item.href !== "/settings")
                  .map((item) => (
                    <NavLink
                      key={item.label}
                      item={item}
                      pathname={pathname}
                      orientation="vertical"
                      activeHref={activeHref}
                    />
                  ))
              )}
            </div>

            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-surface to-transparent"
            />
          </div>

          {showTeacherArt ? (
            <div className="relative hidden h-36 shrink-0 overflow-hidden rounded-card bg-mint/70 xl:block">
              <Image
                src="/illustrations/teacher-talking-with-children.png"
                alt=""
                fill
                priority
                unoptimized
                sizes="264px"
                className="object-cover object-[68%_43%]"
              />
            </div>
          ) : null}
        </>
      )}

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

type ParentSidebarEntry = NavSection["entries"][number] | NavItem;

/**
 * The guardian-only navigation from the supplied reference.
 *
 * It is intentionally separate from the staff accordion: a parent scans one
 * short, always-open list, while staff still need grouped operational modules.
 */
function ParentSidebarContent({
  primary,
  sections,
  pathname,
  childSwitcher,
}: {
  primary: NavItem | undefined;
  sections: NavSection[];
  pathname: string;
  childSwitcher?: ChildSwitcher;
}) {
  // One highlight for the whole rail — the primary row and the sections are a
  // single visual list. See `activeHrefIn`.
  const activeHref = activeHrefIn(pathname, [
    primary?.href,
    ...sections.flatMap((section) => section.entries).map((entry) => entry.href),
  ]);

  return (
    <>
      {childSwitcher ? <ChildSwitcherControl switcher={childSwitcher} /> : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="-mr-1.5 flex min-h-0 flex-1 flex-col overflow-y-auto pr-1.5">
          {primary ? (
            <ParentSidebarRow item={primary} pathname={pathname} activeHref={activeHref} />
          ) : null}

          <div data-testid="nav-sections" className="flex flex-col">
            {sections.map((section) =>
              section.collapsible ? (
                <ParentSidebarDisclosure
                  key={section.title}
                  section={section}
                  pathname={pathname}
                  activeHref={activeHref}
                />
              ) : (
                section.entries.map((item, index) => (
                  <ParentSidebarRow
                    key={`${item.href ?? item.label}-${index}`}
                    item={item}
                    pathname={pathname}
                    activeHref={activeHref}
                  />
                ))
              ),
            )}
          </div>
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-surface to-transparent"
        />
      </div>
    </>
  );
}

/**
 * One named group of the guardian menu, folded away until asked for.
 *
 * Closed on mount rather than remembered: the rows inside are read once, so
 * the state worth restoring is the short menu, not whichever way this was
 * left. That also keeps the phone drawer and the desktop column agreeing
 * without anything to persist between them.
 *
 * The header is a `<button>`, so `MobileMenuDrawer`'s close-on-link-click —
 * which fires on `closest("a")` — steps over it and the drawer survives the
 * toggle. `hidden` rather than an unmount keeps the panel's ids stable for
 * `aria-controls`.
 */
function ParentSidebarDisclosure({
  section,
  pathname,
  activeHref,
}: {
  section: NavSection;
  pathname: string;
  /** The one href the whole rail resolved as current — see `activeHrefIn`. */
  activeHref?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-[47px] w-full items-center gap-3 rounded-card px-3 py-2.5 text-left text-lead text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800"
      >
        <span className="grid size-7 shrink-0 place-items-center text-sky-500">{section.icon}</span>
        <span className="min-w-0 flex-1 leading-snug">{section.title}</span>
        <ChevronDown
          size={18}
          aria-hidden="true"
          className={cn("shrink-0 text-slate-400 transition-transform", open && "rotate-180")}
        />
      </button>

      {/*
        `flex` only while open: `display:flex` would beat the user agent's
        `[hidden] { display: none }` and the panel would never actually close.
      */}
      <div
        id={panelId}
        hidden={!open}
        className={cn("ml-[26px] flex-col border-l border-slate-100", open && "flex")}
      >
        {section.entries.map((item, index) => (
          <ParentSidebarRow
            key={`${item.href ?? item.label}-${index}`}
            item={item}
            pathname={pathname}
            activeHref={activeHref}
          />
        ))}
      </div>
    </div>
  );
}

function ParentSidebarRow({
  item,
  pathname,
  activeHref,
}: {
  item: ParentSidebarEntry;
  pathname: string;
  /**
   * The one href this rail resolved as current (`activeHrefIn`). A caller that
   * passes nothing falls back to prefix matching on `pathname`.
   */
  activeHref?: string | null;
}) {
  const active = Boolean(
    item.href?.startsWith("/") &&
    (activeHref !== undefined
      ? item.href === activeHref
      : pathname === item.href || pathname.startsWith(`${item.href}/`)),
  );

  const content = (
    <>
      <span className="grid size-7 shrink-0 place-items-center text-sky-500">{item.icon}</span>
      <span className="min-w-0 flex-1 leading-snug">{item.label}</span>
      {item.badge === "unread" ? <ParentUnreadBadge /> : null}
      {item.tag ? (
        <span className="shrink-0 text-compact font-medium text-sky-600">{item.tag}</span>
      ) : null}
    </>
  );
  const className = cn(
    "flex min-h-[47px] w-full items-center gap-3 rounded-card px-3 py-2.5 text-left text-lead transition-colors",
    active
      ? "bg-sky-50 font-semibold text-sky-700"
      : item.href
        ? "text-slate-600 hover:bg-slate-50 hover:text-slate-800"
        : "text-slate-500",
  );

  if (!item.href) return <span className={className}>{content}</span>;

  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={className}>
      {content}
    </Link>
  );
}

function ParentUnreadBadge() {
  const count = useUnreadCount();
  if (count === 0) return null;

  return (
    <span className="flex min-w-6 shrink-0 items-center justify-center rounded-pill bg-rose-500 px-1.5 text-caption font-bold leading-6 text-white">
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{count} уншаагүй мэдэгдэл</span>
    </span>
  );
}

function Sidebar({
  nav,
  sections,
  subtitle,
  variant,
  isAdmin,
  childSwitcher,
  teacherTheme = false,
}: {
  nav: NavItem[];
  sections?: NavSection[];
  subtitle: string;
  variant: Variant;
  isAdmin: boolean;
  childSwitcher?: ChildSwitcher;
  teacherTheme?: boolean;
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
       * than the panel — so it overlapped the last section and the profile
       * route scrolled off the screen. The brand and the identity are fixed now, and
       * the nav between them takes the overflow.
       */
      className={cn(
        "fixed inset-y-0 left-0 z-20 hidden flex-col overflow-hidden border-r border-border-soft bg-surface/92 py-[18px] shadow-[8px_0_28px_-22px_rgb(29_78_216_/_0.28)] backdrop-blur lg:flex",
        teacherTheme
          ? "w-[264px] gap-5 px-3.5"
          : variant === "parent"
            ? "w-[244px] gap-4 px-4"
            : "w-[220px] gap-5 px-3.5",
      )}
    >
      <SidebarContent
        nav={nav}
        sections={sections}
        subtitle={subtitle}
        variant={variant}
        isAdmin={isAdmin}
        childSwitcher={childSwitcher}
        showTeacherArt={teacherTheme}
      />
    </nav>
  );
}

/**
 * The parent's own child picker, above the sidebar's nav — the only place a
 * family chooses which child is "current" for the sections below and Home's
 * tiles. It remains visible for a one-child family because the reference uses
 * this row as the sidebar's context, not only as a switching control.
 */
function ChildSwitcherControl({ switcher }: { switcher: ChildSwitcher }) {
  const selected =
    switcher.children.find((child) => child.id === switcher.selectedId) ?? switcher.children[0];
  if (!selected) return null;

  return (
    <label className="relative flex min-h-[64px] w-full cursor-pointer items-center gap-3 rounded-card border border-sky-100 bg-sky-50/40 px-3 py-2.5 text-slate-700 transition-colors hover:bg-sky-50 focus-within:ring-2 focus-within:ring-sky-400 focus-within:ring-offset-2">
      <ChildAvatar child={selected} size={44} className="bg-sky-100 text-sky-700" />
      <span className="min-w-0 flex-1 truncate text-lead font-semibold">{fullName(selected)}</span>
      <ChevronDown size={20} className="shrink-0 text-slate-700" aria-hidden="true" />
      <select
        id="child-switcher"
        aria-label="Хүүхэд сонгох"
        value={switcher.selectedId}
        onChange={(event) => switcher.onSelect(event.target.value)}
        className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0"
      >
        {switcher.children.map((child) => (
          <option key={child.id} value={child.id}>
            {fullName(child)}
          </option>
        ))}
      </select>
    </label>
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
 * rather than threading a callback through `NavLink`. Every
 * real destination in this menu is an `<a>`, including the profile row, so
 * one delegated handler closes the sheet for every navigation.
 */
function MobileMenuDrawer({
  open,
  onOpenChange,
  nav,
  sections,
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
 * The phone header.
 *
 * ★ Ported from the reference's `.mhead`, and it exists so the bottom bar does
 * not have to carry account actions beside the tabs. On a phone the sidebar is gone
 * entirely — this plus the bottom navigation is a deliberate mobile layout
 * rather than a folded desktop one.
 *
 * Hidden from `lg` up on every variant, where the sidebar already carries all
 * the brand and identity. Showing them twice is what crowded
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
        <span data-brand-mark className="grid size-[42px] shrink-0 place-items-center">
          <Image
            src="/brand-mark.png"
            alt={BRAND}
            width={42}
            height={42}
            className="size-full object-contain"
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
        The bell, and only the bell.

        The client's drawing puts one control up here: a bell with its unread
        count. Both of the others were already reachable one tap away and are
        still there: `MobileMenuDrawer`, behind the bottom bar's "Цэс" tab,
        renders the signed-in name as the route to `/settings`. Sign-out lives
        inside that profile screen for every role.
      */}
      <div className="ml-auto flex items-center">
        <NotificationBell />
      </div>
    </header>
  );
}

function BottomBar({ nav, hideOnDesktop }: { nav: NavItem[]; hideOnDesktop: boolean }) {
  const pathname = usePathname();

  // One tab lit, resolved across the bar's own five — see `activeHrefIn`. The
  // bar and the sidebar carry different sets, so each answers for itself.
  const activeHref = activeHrefIn(
    pathname,
    nav.map((entry) => entry.href),
  );

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
        <NavLink
          key={item.label}
          item={item}
          pathname={pathname}
          orientation="horizontal"
          activeHref={activeHref}
        />
      ))}
    </nav>
  );
}

/**
 * Which one of a menu's own entries is the current page.
 *
 * ★ **The longest match wins, and only one row lights up.**
 *
 * A bare prefix test is right for `/children/abc` keeping "Хүүхдүүд" lit, and
 * wrong the moment a menu carries both a route and a route beneath it: on
 * `/finance/dashboard` both "Улсын санхүүжилт" (`/finance`) and "Самбар"
 * (`/finance/dashboard`) satisfied `startsWith`, so the sidebar highlighted two
 * rows and `aria-current="page"` appeared twice — which is not a thing a page
 * can be. `/finance/audit-log` had done this quietly since it shipped.
 *
 * Resolving it per **list** rather than per row is what makes it correct: a row
 * cannot know whether a more specific sibling exists, and the answer differs
 * between the sidebar and the phone bar, which carry different sets.
 *
 * Returns `null` when nothing matches, which is a real state — `/no-access` and
 * a child's own sub-pages belong to no row.
 */
function activeHrefIn(pathname: string, hrefs: (string | undefined)[]): string | null {
  let best: string | null = null;

  for (const href of hrefs) {
    if (!href?.startsWith("/")) continue;

    // Exact match for the root, or every row would match `/`.
    const matches =
      href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

    if (matches && (best === null || href.length > best.length)) best = href;
  }

  return best;
}

function NavLink({
  item,
  pathname,
  orientation,
  activeHref,
}: {
  item: NavItem;
  pathname: string;
  orientation: "vertical" | "horizontal";
  /**
   * The one href this list resolved as current — see `activeHrefIn`. Omitted
   * only by callers that render a single item with no siblings to lose to.
   */
  activeHref?: string | null;
}) {
  // A button-style item (no `href`) opens something in place — it is never the
  // current page. Otherwise the list has already resolved which single row is
  // current (`activeHrefIn`); a caller that passes nothing falls back to the
  // per-row prefix test, which is the same answer whenever no sibling sits
  // beneath another.
  const active = !item.href
    ? false
    : activeHref !== undefined
      ? item.href === activeHref
      : item.href === "/"
        ? pathname === "/"
        : pathname === item.href || pathname.startsWith(`${item.href}/`);

  const horizontal = orientation === "horizontal";
  const backgroundlessIcon = isBackgroundlessArt(item.icon);

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
    /*
      ★★ The weight is what the paragraph above already promised.

      It used to live on `NavGroup`'s own `<Link>`, which drew the rows inside
      each collapsible section; the flattened sidebar sends those same rows
      through `NavLink` instead, and the weight did not come with them — so the
      current page lost a cue and kept only colour, which is the one thing this
      comment says must never carry the state alone. `sidebar.test.tsx` caught
      it. It sits beside the tint rather than in the `text-*` line so the two
      halves of "changes weight with the tint" cannot drift apart again.
    */
    !horizontal && active && "font-semibold",
    !horizontal &&
      active &&
      "before:absolute before:left-0 before:top-1/2 before:h-6 before:w-[3px] before:-translate-y-1/2 before:rounded-pill before:bg-primary",
  );

  const content = (
    <>
      <span
        data-nav-icon
        data-icon-surface={backgroundlessIcon ? "none" : "tinted"}
        className={cn(
          // ★ `transition-all` and a slight scale on the active well — the tab
          // now visibly *settles* when it becomes current instead of the tint
          // appearing instantly. 150ms, and `prefers-reduced-motion` flattens
          // it globally, so it stays a cue rather than an animation.
          "relative flex items-center justify-center transition-all duration-150",
          // The tinted well the drawing puts behind the active glyph. Sized so
          // a 20px icon sits in a 40×28 rounded rectangle, as drawn.
          horizontal
            ? "h-7 w-10 rounded-control"
            : backgroundlessIcon
              ? "bg-transparent"
              : navIconTone(item.label),
          !horizontal && "size-9 rounded-control",
          horizontal && active && "scale-105",
          horizontal && active && !backgroundlessIcon && "bg-primary-soft",
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

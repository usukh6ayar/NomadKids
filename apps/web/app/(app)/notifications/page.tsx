"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABEL,
  childSummarySchema,
  notificationSchema,
  paginated,
  surveySchema,
  type NotificationCategory,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { PageHeader } from "@/components/shell/app-shell";
import { LikeButton } from "@/components/notifications/like-button";
import { ChildAvatar, MediaThumb } from "@/components/media/media-image";
import { useSession } from "@/lib/auth/session";
import {
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  Newspaper,
  PenLine,
  Search,
  Trash2,
} from "lucide-react";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RowCard, RowList } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FilterChip, FilterChipRow } from "@/components/ui/filter-chip";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { excerpt, formatRelative, fullName } from "@/lib/format";
import { SURVEY_TONE_BG, SURVEY_TYPE_META } from "@/lib/survey-meta";
import { cn } from "@/lib/utils";

const listSchema = paginated(notificationSchema);
const ownChildrenSchema = z.array(childSummarySchema);
const activeSurveysSchema = z.array(surveySchema);

/**
 * Announcements.
 *
 * Read state comes from `reads` — the API returns only *this* user's receipt,
 * so "have I read it" is answerable without exposing who else has, which for a
 * kindergarten announcement would be a small but real disclosure about other
 * families.
 *
 * There is no realtime channel in the MVP. The unread badge and this list
 * refresh on window focus, which for announcements that arrive a few times a
 * week is indistinguishable from a push (docs/ARCHITECTURE.md §7).
 */
export default function NotificationsPage() {
  const { hasRole, session } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  /*
   * Filtered in the browser, unlike `unread` and `q` which the API understands.
   * `isImportant` is on every row the list already returned, so narrowing here
   * costs nothing; adding `?important=` to the endpoint for a boolean the
   * client is holding would be a round trip for an `Array.filter`.
   */
  const [importantOnly, setImportantOnly] = useState(false);

  /*
   * ★ Debounced, not submit-on-Enter — unlike `HeaderSearch` (`app-shell.tsx`),
   * which navigates to a different screen on submit, this search narrows the
   * list it already sits above, so live filtering as the reader types is the
   * right behaviour rather than a second surprise. 350ms is long enough that
   * one word does not fire a request per keystroke, short enough that it still
   * reads as live.
   */
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  /*
    ★ Category, and a date range — the client's 2026-08-30 filter.

    `null` is "Бүгд" rather than a tenth enum value: the API omits the
    parameter entirely for "all", and encoding "no filter" as a category would
    mean every request carried one and the server had to know which was special.
  */
  const [category, setCategory] = useState<NotificationCategory | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [datesOpen, setDatesOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters = { unread: showUnreadOnly, q, category, from, to };

  /*
   * ★ Two tabs, one screen — the mock-up's own pairing of Мэдээ and Судалгаа
   * under the bottom bar's single "Мэдээ" tab. Staff never sees the second
   * tab: a teacher's surveys are the ones they manage from the sidebar's own
   * `/surveys`, not ones written *to* them, so there is nothing personal for
   * this tab to show them. "Ангийн чат" from the mock-up is not here at all —
   * chat is Phase 2 (CLAUDE.md §7), and this screen does not get to pull it
   * forward on its own.
   */
  const [tab, setTab] = useState<"news" | "surveys">("news");

  const myChildren = useQuery({
    queryKey: qk.myChildren(),
    queryFn: () => get("/children/mine", ownChildrenSchema),
    enabled: !isStaff,
    staleTime: 60_000,
  });

  const [surveyChildId, setSurveyChildId] = useState<string | null>(null);
  const surveyChildren = myChildren.data ?? [];
  const selectedSurveyChild =
    surveyChildren.find((c) => c.id === surveyChildId) ?? surveyChildren[0];

  /*
   * ★ One query per child, so the tab's own badge counts every family
   * member's unanswered surveys — not only whichever one happens to be
   * selected below. A family with one child (most of them) pays for exactly
   * one request; the same shape `home/page.tsx`'s `SurveyTile` already pays
   * per child, just summed here instead of shown per tile.
   */
  const surveyQueries = useQueries({
    queries: surveyChildren.map((child) => ({
      queryKey: qk.childSurveys(child.id),
      queryFn: () => get(`/children/${child.id}/surveys`, activeSurveysSchema),
      enabled: !isStaff,
      staleTime: 60_000,
    })),
  });
  const totalPending = surveyQueries.reduce(
    (sum, q) => sum + (q.data?.filter((s) => !s.respondedByMe).length ?? 0),
    0,
  );
  const selectedChildSurveys = surveyChildren.findIndex((c) => c.id === selectedSurveyChild?.id);
  const selectedSurveys = surveyQueries[selectedChildSurveys];

  /**
   * ★ An endless feed, not pages.
   *
   * A class board is read the way a phone is read — thumb down until something
   * looks familiar. "Өмнөх / Дараах" makes the reader hold a page number in
   * their head to answer "have I seen this one", which is the wrong question to
   * make a parent answer on a bus.
   *
   * The API is still paginated; this stitches the pages together. `totalPages`
   * is what says whether another exists, so the last page ends rather than
   * fetching for ever.
   */
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: qk.notifications(filters),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ page: String(pageParam), pageSize: "15" });
      if (showUnreadOnly) params.set("unread", "true");
      if (q) params.set("q", q);
      if (category) params.set("category", category);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      return get(`/notifications?${params}`, listSchema);
    },
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });

  const items = (data?.pages.flatMap((p) => p.items) ?? []).filter(
    (n) => !importantOnly || n.isImportant,
  );

  /**
   * The sentinel below the list. Loading on intersection rather than on a
   * button: the button is the thing the feed exists to remove.
   *
   * `rootMargin` starts the fetch before the reader reaches the end, so the
   * next batch is usually there by the time they get to it.
   */
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title={tab === "news" ? "Мэдээ" : "Судалгаа"}
        lede={
          tab === "news"
            ? "Цэцэрлэгээс ирсэн зар, мэдээлэл."
            : "Танай хүүхдэд зориулсан судалгаанууд."
        }
      />

      {/*
        Capped from `lg` up. Full width is right on a phone, where the field is
        the only thing on its row; at 1336px an unbounded search box for a
        two-word query is the widest element on the screen and reads as the
        page's main event rather than as a way past the list — the same
        reasoning that put `HeaderSearch` (`app-shell.tsx`) on a 280px cap.
      */}
      {/*
        ★ The tabs come first, because they decide what the rest of the page is
        about.

        They sat below the search field and the filter chips, which put a
        "Мэдээнээс хайх" placeholder and a "Чухал" filter above the control that
        chooses between Мэдээ and Судалгаа — so a parent read two narrowing
        controls before the one that says what is being narrowed. Search and
        filters both change meaning with the tab; the tab changes meaning with
        nothing.
      */}
      {!isStaff ? (
        <div role="tablist" aria-label="Мэдээ эсвэл судалгаа" className="flex gap-2">
          <TabButton
            active={tab === "news"}
            onClick={() => setTab("news")}
            icon={<Newspaper size={16} aria-hidden="true" />}
          >
            Мэдээ
          </TabButton>
          <TabButton
            active={tab === "surveys"}
            onClick={() => setTab("surveys")}
            icon={<CheckCircle2 size={16} aria-hidden="true" />}
            badge={totalPending > 0 ? totalPending : undefined}
          >
            Судалгаа
          </TabButton>
        </div>
      ) : null}

      {/*
        ★ The search field and the compose button share a row.

        They were two stacked blocks with a `gap-6` between them, and with the
        filter chips below that the screen spent three rows and ~200px of
        chrome before the first post. None of the three is the page's subject;
        the feed is.

        Both keep the sizing their own notes argue for — the field capped so it
        does not read as the page's main event, the button full-width on a
        phone where it is the one primary action on its own line. From `sm` they
        sit side by side because there is room for both and no reason for the
        button to have a row of its own.
      */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-[420px]">
          <Search
            size={18}
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
          />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={tab === "news" ? "Мэдээнээс хайх" : "Судалгаанаас хайх"}
            aria-label={tab === "news" ? "Мэдээнээс хайх" : "Судалгаанаас хайх"}
            className="pl-11"
          />
        </div>

        {isStaff && tab === "news" ? (
          <Button asChild className="w-full sm:w-auto">
            <Link href="/notifications/new">
              <PenLine size={18} aria-hidden="true" />
              Пост оруулах
            </Link>
          </Button>
        ) : null}
      </div>

      {/*
        ★ The category row — the work the note that stood here predicted.

        It read: "A real category needs a column, a value in the compose form
        and a query parameter. It is a small piece of work and not one a
        component can do." `Notification.category` is that column, the composer
        sets it, and `?category=` is the parameter. The chips filter on the
        server now rather than sorting nothing.

        `scroll` keeps ten chips on one line — see `FilterChipRow`. Wrapped they
        take three rows and 130px above the first post.

        Уншаагүй and Чухал stay: they are not categories but they are how a
        parent finds what they have not seen, and dropping them to make room
        would trade a working filter for a taxonomy.
      */}
      {tab === "news" ? (
        <div className="flex flex-col gap-2">
          <FilterChipRow label="Мэдээг ангиллаар шүүх" scroll>
            <FilterChip
              active={category === null && !showUnreadOnly && !importantOnly}
              onClick={() => {
                setCategory(null);
                setShowUnreadOnly(false);
                setImportantOnly(false);
              }}
            >
              Бүгд
            </FilterChip>
            {NOTIFICATION_CATEGORIES.map((value) => (
              <FilterChip
                key={value}
                active={category === value}
                onClick={() => setCategory(category === value ? null : value)}
              >
                {NOTIFICATION_CATEGORY_LABEL[value]}
              </FilterChip>
            ))}
          </FilterChipRow>

          <div className="flex flex-wrap items-center gap-2">
            <FilterChip
              active={showUnreadOnly}
              onClick={() => {
                setShowUnreadOnly(!showUnreadOnly);
                setImportantOnly(false);
              }}
            >
              Уншаагүй
            </FilterChip>
            <FilterChip
              active={importantOnly}
              onClick={() => {
                setImportantOnly(!importantOnly);
                setShowUnreadOnly(false);
              }}
            >
              Чухал
            </FilterChip>

            {/*
              ★ The date range is behind a toggle, not two inputs always on
              screen.

              The client asked for it — "2026.08.01–2026.08.30 хоорондох" — and
              also asked that the filter UI stay "хэт том, төвөгтэй болгохгүй".
              Two date fields permanently above the feed are 80px a parent
              scrolls past every visit to reach the thing they came for. The
              chip carries the range once it is set, so a filter that is on is
              never invisible.
            */}
            <FilterChip active={Boolean(from || to)} onClick={() => setDatesOpen(!datesOpen)}>
              <CalendarRange size={14} aria-hidden="true" />
              {from || to ? `${from || "…"} — ${to || "…"}` : "Огноогоор"}
            </FilterChip>

            {from || to ? (
              <button
                type="button"
                onClick={() => {
                  setFrom("");
                  setTo("");
                }}
                className="text-caption text-muted underline-offset-2 hover:text-ink hover:underline"
              >
                Огноог арилгах
              </button>
            ) : null}
          </div>

          {datesOpen ? (
            <div className="grid gap-3 rounded-card border border-border bg-surface p-3 sm:max-w-[420px] sm:grid-cols-2">
              <Field label="Эхлэх огноо">
                {({ id }) => (
                  <Input
                    id={id}
                    type="date"
                    value={from}
                    max={to || undefined}
                    onChange={(event) => setFrom(event.target.value)}
                  />
                )}
              </Field>
              <Field label="Дуусах огноо">
                {({ id }) => (
                  <Input
                    id={id}
                    type="date"
                    value={to}
                    min={from || undefined}
                    onChange={(event) => setTo(event.target.value)}
                  />
                )}
              </Field>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "surveys" && !isStaff ? (
        <SurveysTab
          familyChildren={surveyChildren}
          selectedChild={selectedSurveyChild}
          onSelectChild={setSurveyChildId}
          surveys={selectedSurveys}
          searchTerm={searchInput}
        />
      ) : null}

      {tab === "news" ? (
        <>
          {isLoading ? <LoadingState rows={4} /> : null}

          {isError ? (
            <ErrorState
              description={errorMessage(error)}
              action={
                <Button variant="secondary" onClick={() => void refetch()}>
                  Дахин оролдох
                </Button>
              }
            />
          ) : null}

          {data && items.length === 0 ? (
            <EmptyState
              icon={<Image src="/background/mascot-teacher.webp" alt="" width={96} height={96} />}
              title={showUnreadOnly ? "Уншаагүй мэдэгдэл алга" : "Мэдэгдэл алга"}
              description={
                showUnreadOnly
                  ? "Бүх мэдэгдлийг уншсан байна."
                  : "Цэцэрлэгээс мэдэгдэл ирэхэд энд харагдана."
              }
            />
          ) : null}

          {items.length > 0 ? (
            /*
             * ★ One heading over a flat feed, where this was a dot-and-line
             * rail with a heading per day.
             *
             * The rail is the right device for a chronological *record* — it
             * is what `/home`'s "Сүүлийн мөчүүд" still uses, and the argument
             * for it here was that a class board is the same shape of content.
             * The client's 2026-08-28 drawing is a social feed instead: one
             * "Сүүлийн мэдээ" heading, then posts that carry their own
             * timestamp beside their author. With `formatRelative` on every
             * card, a per-day heading above them repeats what each card under
             * it already says, and the rail's 20px gutter costs a twentieth of
             * a 375px screen to draw it.
             */
            <section
              aria-labelledby="news-feed-heading"
              className="flex w-full max-w-[640px] flex-col gap-3 lg:max-w-[760px] xl:max-w-[880px]"
            >
              <h2 id="news-feed-heading" className="text-title font-semibold text-ink">
                Сүүлийн мэдээ
              </h2>

              {/*
                ★ One column, capped — not the two-across grid this carried
                until 2026-08-29.

                The grid was answering "use the horizontal space" and produced
                the wrong thing: a post is гарчиг, дэлгэрэнгүй, зураг read in
                that order, and at 1336px split two ways each card was a 465px
                banner whose photograph dwarfed the words above it. The report
                was that it "looks odd on a big screen" and should read the same
                as it does on a phone.

                So the feed is a column that stops growing — but it grows with
                the screen first. A flat 640px cap left 500px of nothing beside
                it at 1440, which is the same fault in the other direction: a
                cap is a limit on a *line*, not a layout for a page. The steps
                are 640 · 760 · 880, so a card is never narrower than a phone's
                and never wider than about a hundred characters of Mongolian.

                The photographs do not grow with it — see the media grid below,
                which keeps its own cap. That is what makes widening safe: the
                objection to the two-across grid was never the width itself, it
                was a 465px card whose banner dwarfed the words above it.

                ★★ Left-aligned, not centred, and the cap moved up to the
                `<section>`.

                `mx-auto` was on this div while the heading above it, the search
                field, the compose button and the filter chips all sat at the
                page's left edge — so the cards floated off on their own with a
                300px gutter to their left and nothing in it. The report was
                that the feed "comes out small in the middle", and that is
                exactly what a centred column does beside four left-aligned
                controls: it stops looking capped and starts looking stranded.

                Capping the section instead puts the heading and its cards on
                one left edge, shared with everything above them. The whitespace
                still exists; it is now all on one side, where it reads as a
                margin rather than as a hole.
              */}
              <div className="flex flex-col gap-3">
                {items.map((notification) => (
                  <NotificationRow
                    key={notification.id}
                    notification={notification}
                    /*
                      An admin may withdraw any post in their kindergarten; a
                      teacher only their own. The same rule `requireStaffOwned`
                      applies on the server — this only decides whether the
                      button is drawn.
                    */
                    canDelete={
                      hasRole("ADMIN") || (isStaff && notification.author?.id === session?.user?.id)
                    }
                  />
                ))}
              </div>
            </section>
          ) : null}

          {/* Height, so it can intersect at all — a zero-height div never does. */}
          <div ref={sentinel} aria-hidden="true" className="h-px" />

          {/*
            ★ Centred within the feed's column, not within the page.

            `text-center` on a full-width `<p>` put "Бүх мэдэгдлийг үзлээ." in
            the middle of the content area while the column it belongs to ended
            640px earlier — so the line that closes the feed sat under the empty
            half of the screen, detached from the last card it is about. The
            same cap the section carries puts it back under its own column.
          */}
          {isFetchingNextPage ? (
            <p
              role="status"
              className="max-w-[640px] py-2 text-center text-body text-muted lg:max-w-[760px] xl:max-w-[880px]"
            >
              Ачаалж байна…
            </p>
          ) : null}

          {!hasNextPage && items.length > 0 ? (
            <p className="max-w-[640px] py-2 text-center text-body text-muted lg:max-w-[760px] xl:max-w-[880px]">
              Бүх мэдэгдлийг үзлээ.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** One tab of the Мэдээ / Судалгаа switcher — see `NotificationsPage`. */
function TabButton({
  active,
  onClick,
  icon,
  badge,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex min-h-11 items-center gap-2 rounded-pill border px-4 text-body font-medium transition-colors",
        active
          ? "border-primary bg-primary-soft text-primary"
          : "border-border bg-surface text-muted hover:text-ink",
      )}
    >
      {icon}
      {children}
      {badge ? (
        <span className="flex min-w-[18px] items-center justify-center rounded-pill bg-danger px-1 text-caption font-bold leading-[18px] text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The "Судалгаа" tab's body — every child's surveys, one child at a time.
 *
 * ★ Same row treatment as `/children/[childId]/surveys` (an answered survey
 * is a plain row with a badge, never a link — there is no "view my answers"
 * endpoint for it to open). A single-child family, the common case, never
 * sees the switcher at all — same rule `/home`'s own child switcher follows.
 */
function SurveysTab({
  familyChildren,
  selectedChild,
  onSelectChild,
  surveys,
  searchTerm,
}: {
  familyChildren: { id: string; firstName?: string | null; lastName?: string | null }[];
  selectedChild: { id: string; firstName?: string | null; lastName?: string | null } | undefined;
  onSelectChild: (id: string) => void;
  surveys:
    | { data?: z.infer<typeof activeSurveysSchema>; isLoading: boolean; isError: boolean }
    | undefined;
  /** Filters the already-loaded list client-side — see the search box's own note above. */
  searchTerm: string;
}) {
  if (familyChildren.length === 0) {
    return (
      <EmptyState
        title="Холбогдсон хүүхэд алга"
        description="Танд холбогдсон хүүхэд байхгүй байна."
      />
    );
  }

  const term = searchTerm.trim().toLowerCase();
  const data = (surveys?.data ?? []).filter(
    (s) =>
      !term ||
      s.title.toLowerCase().includes(term) ||
      (s.description ?? "").toLowerCase().includes(term),
  );

  return (
    <div className="flex flex-col gap-4">
      {familyChildren.length > 1 ? (
        <div role="group" aria-label="Хүүхэд сонгох" className="flex gap-2 overflow-x-auto pb-1">
          {familyChildren.map((child) => {
            const active = child.id === selectedChild?.id;
            return (
              <button
                key={child.id}
                type="button"
                aria-pressed={active}
                onClick={() => onSelectChild(child.id)}
                className={cn(
                  "flex min-h-[40px] shrink-0 items-center gap-2 rounded-pill border px-3 py-1.5 text-body font-medium transition-colors",
                  active
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border bg-surface text-muted hover:text-ink",
                )}
              >
                <ChildAvatar child={child} size={24} />
                <span className="max-w-[140px] truncate">{child.firstName}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {surveys?.isLoading ? <LoadingState rows={2} /> : null}
      {surveys?.isError ? <ErrorState description="Судалгаа ачаалахад алдаа гарлаа." /> : null}

      {!surveys?.isLoading && !surveys?.isError && data.length === 0 ? (
        <EmptyState
          title={term ? "Хайлтад тохирох судалгаа алга" : "Идэвхтэй судалгаа алга"}
          description={
            term
              ? "Өөр түлхүүр үгээр хайж үзнэ үү."
              : "Цэцэрлэгээс судалгаа явуулахад энд харагдана."
          }
        />
      ) : null}

      {data.length > 0 ? (
        <RowList>
          {data.map((survey) => {
            const answered = Boolean(survey.respondedByMe);
            const open = !answered && survey.status !== "CLOSED";
            const meta = SURVEY_TYPE_META[survey.questions[0]?.type ?? "TEXT"];
            const questionCount = survey.questions.length;

            const body = (
              <>
                <span
                  className={cn(
                    "grid size-11 shrink-0 place-items-center rounded-control",
                    SURVEY_TONE_BG[meta.tone],
                  )}
                  aria-hidden="true"
                >
                  <meta.Icon size={20} aria-hidden="true" />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="mb-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {answered ? (
                      <Badge tone="mint">Хариулсан</Badge>
                    ) : open ? (
                      <Badge tone="sun">Хариулаагүй</Badge>
                    ) : (
                      <Badge tone="neutral">Хаагдсан</Badge>
                    )}
                  </span>
                  <span className="block font-semibold text-ink">{survey.title}</span>
                  <span className="mt-0.5 block text-caption text-muted">
                    {questionCount > 0 ? `Нийт ${questionCount} асуулттай` : survey.description}
                  </span>
                </span>

                {open ? (
                  <ChevronRight size={18} className="shrink-0 text-faint" aria-hidden />
                ) : null}
              </>
            );

            return open ? (
              <Link
                key={survey.id}
                href={`/children/${selectedChild?.id}/surveys/${survey.id}`}
                className="flex items-start gap-3 rounded-row border border-border bg-surface px-4 py-3.5 transition-colors hover:border-primary"
              >
                {body}
              </Link>
            ) : (
              <RowCard key={survey.id} className="flex items-start gap-3">
                {body}
              </RowCard>
            );
          })}
        </RowList>
      ) : null}
    </div>
  );
}

/**
 * One notice, as the client's 2026-08-28 drawing shows it: a post.
 *
 * ★ Author, time, title, body, photographs, reactions — the shape of a feed
 * card rather than the 72px list row this was.
 *
 * ★★ What the drawing asks for and this does **not** render, with the reason,
 * because three of them look like omissions and none is:
 *
 *  - **A comment count (💬 5).** `notificationSchema` has no comment field and
 *    its docblock says so on purpose: "There is no comment field, and that is
 *    deliberate — see the `like` endpoint". Comments are a Phase IV
 *    conversation feature (CLAUDE.md §7, alongside chat).
 *
 *  - **A view count (👁 35).** `reads` on this schema is *this* reader's own
 *    receipt and nothing else — `notifications.repository.ts` refuses to expose
 *    who else has opened a notice, so a parent cannot work out which other
 *    families are reading the board. The number exists for the *author* on
 *    `boardNotice.readCount` (the dashboard's Сүүлийн нийтлэл card shows it),
 *    which is the one place the disclosure is safe.
 *
 *  - **Category chips (Зарлал · Үйл ажиллагаа · Сургалт).** There is no
 *    category on a notification. `isImportant` is the only classification the
 *    model carries, and it is rendered — as "Чухал", where the drawing puts its
 *    category label. Inventing a taxonomy would mean a chip row that filters on
 *    a field nobody fills.
 *
 * Adding any of the three is a schema change plus an endpoint, not a component
 * edit; each is a small, well-scoped piece of work whenever the client wants it.
 */
function NotificationRow({
  notification,
  canDelete,
}: {
  notification: z.infer<typeof notificationSchema>;
  /**
   * Whether *this* reader may withdraw *this* post.
   *
   * ★ Decided by the caller, and re-decided by the API.
   *
   * `requireStaffOwned` is the authority: a teacher reaches their own notice,
   * an admin reaches any in their kindergarten, and everyone else gets a 404.
   * This flag only decides whether to draw a button — a card that hides the
   * menu is a courtesy, not a permission, and `notifications.test.ts` pins the
   * server side of it with a second teacher in the same kindergarten.
   */
  canDelete: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const isUnread = notification.reads.length === 0;

  const remove = useMutation({
    mutationFn: () =>
      mutate(`/notifications/${notification.id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Пост устлаа.");
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const markRead = useMutation({
    mutationFn: () =>
      mutate(`/notifications/${notification.id}/read`, z.unknown(), { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const when = notification.publishedAt ?? notification.createdAt;

  return (
    /*
      ★ Read and unread are two visibly different cards, not one card with a
      bolder title.

      The only difference used to be the "Шинэ" pill and a font weight, which
      on a phone at arm's length is no difference at all — the report was that
      a teacher cannot tell which posts they have already opened. Three signals
      separate them now, and each survives the loss of the others:

        · a blue rail down the left edge of an unread card
        · the card's tint — white while unread, the page's own canvas once read
        · the title's weight, and the "Шинэ" pill above it

      A read card is deliberately *quieter* rather than greyed out: its text
      stays `--color-ink` at full contrast, because a notice a family has
      already opened is still a notice they may need to re-read. What changes
      is the surface it sits on, not its legibility.
    */
    <article
      className={cn(
        "flex flex-col gap-2.5 rounded-card border p-4 transition-colors",
        isUnread
          ? "border-l-4 border-l-primary border-y-border border-r-border bg-surface hover:border-primary"
          : "border-border-soft bg-canvas hover:border-border",
      )}
    >
      {/* Who posted it, and when. `ChildAvatar` takes any `{firstName,
          lastName}` and draws initials when there is no photograph — an author
          has no `photoMediaFileId`, so it is always the initials here. */}
      <div className="flex items-center gap-2.5">
        <ChildAvatar child={notification.author ?? {}} size={40} />

        {/*
          ★ One line, not two.

          The author sat over the timestamp in a two-line stack, which is 36px
          of a card whose content is often two lines itself. They are one fact —
          who posted this and when — and a middot joins them the way every feed
          does. `truncate` on the name and `shrink-0` on the time means a long
          Mongolian name gives way rather than pushing the date off the row.
        */}
        <p className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate text-body font-semibold text-ink">
            {fullName(notification.author)}
          </span>
          <span aria-hidden="true" className="text-faint">
            ·
          </span>
          <span className="shrink-0 text-caption text-muted">{formatRelative(when)}</span>
        </p>
        {/*
          ★ Both classifications sit here, and both are `Badge`.

          "Чухал" was a bare red word in the footer while "Шинэ" was a pill in
          the header — two status signals in two corners of the same card, in
          two different treatments, so neither read as a status. A reader
          scanning the feed had to check the top of a card for one and the
          bottom for the other.

          `Badge` rather than a hand-rolled pill: `badge.tsx` documents its
          tones as meanings and pins their contrast, and this card had been
          spelling `bg-primary-soft px-2 py-0.5 …` inline — the fourth copy of
          something the component exists to own.

          Important leads, because it is the one that changes what a family
          does about the notice; new only says they have not seen it yet.
        */}
        <span className="flex shrink-0 items-center gap-1.5">
          {/*
            ★ The category, which the note above this component said could not
            be rendered — until 2026-08-30 it was right.

            It read: "There is no category on a notification. `isImportant` is
            the only classification the model carries… Inventing a taxonomy
            would mean a chip row that filters on a field nobody fills."
            `Notification.category` is that field now, the composer sets it and
            the feed filters on it, so the chip is a fact rather than an
            invention.

            `neutral`, not a colour per category: nine tones would make the
            header a paint chart and none of them would mean anything. The two
            coloured badges beside it are *statuses* — something to do, or
            something unseen — and colour is how a reader tells those from a
            label.
          */}
          <Badge tone="neutral">{NOTIFICATION_CATEGORY_LABEL[notification.category]}</Badge>
          {notification.isImportant ? <Badge tone="danger">Чухал</Badge> : null}
          {isUnread ? <Badge tone="primary">Шинэ</Badge> : null}

          {/*
            Withdrawing a post. `ConfirmDialog` owns its own open state and
            takes the control that opens it, so the button *is* the trigger —
            CLAUDE.md §5 asks for a confirmation before a delete and this is
            the shape the rest of the product uses for one.
          */}
          {canDelete ? (
            <ConfirmDialog
              trigger={
                <button
                  type="button"
                  aria-label="Постыг устгах"
                  className="grid size-9 place-items-center rounded-control text-muted transition-colors hover:bg-canvas hover:text-danger"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              }
              title="Энэ постыг устгах уу?"
              description="Эцэг эхийн самбараас хасагдана. Хэн устгасныг бүртгэлд үлдээнэ."
              confirmLabel="Устгах"
              cancelLabel="Цуцлах"
              tone="danger"
              pending={remove.isPending}
              onConfirm={() => remove.mutate()}
            />
          ) : null}
        </span>
      </div>

      {/*
        The title is the link, not the whole card.

        A card-wide `<a>` swallows the like button and the photographs — the
        row this replaced had exactly that problem and worked around it by
        stopping the click inside `LikeButton`. One link with a real accessible
        name is both simpler and what a screen reader can navigate.
      */}
      <div className="min-w-0">
        {/*
          ★ The link wraps the title, or the body when there is no title.

          Titles became optional on 2026-08-30 — the client asked for posts that
          are a photograph and a sentence. An `<h3>` containing nothing would
          leave the card with no link at all and a screen reader with an empty
          heading in the outline, so a post without a heading makes its first
          line the link instead. The card still has exactly one link with a real
          accessible name, which is what the note below is about.
        */}
        <h3
          className={cn(
            "text-lead leading-heading text-ink",
            isUnread ? "font-semibold" : "font-medium",
          )}
        >
          <Link
            href={`/notifications/${notification.id}`}
            onClick={() => {
              if (isUnread) markRead.mutate();
            }}
            className="hover:underline"
          >
            {notification.title ?? excerpt(notification.body ?? "", 80)}
            {/*
              ★ Inside the link, not beside it.

              Unread is signalled three ways — the "Шинэ" pill above, the
              title's weight, and this word — because a pill is invisible to a
              screen reader and weight alone is easy to miss. It sits *within*
              the anchor so the state is part of the link's accessible name:
              a reader tabbing through the feed hears "Аялал, Уншаагүй, link"
              rather than having to associate a pill somewhere above it.
            */}
            {isUnread ? <span className="sr-only"> Уншаагүй</span> : null}
          </Link>
        </h3>
        {/*
          ★ `--color-ink`, not `--color-muted`.

          The excerpt is the post — the thing a family opened the board to
          read — and it was set in the same grey as the timestamp above it. A
          card whose only body text is styled as metadata reads as a card with
          no body: the eye takes the title and moves on, which is the opposite
          of what a class board is for.
        */}
        {notification.title && notification.body ? (
          <p className="mt-1 text-body leading-relaxed text-ink">
            {excerpt(notification.body, 140)}
          </p>
        ) : null}
      </div>

      {/*
        ★ The photographs stop growing before the card does.

        The card widens with the screen (640 · 760 · 880) and a 16:9 banner at
        880 is 495px tall — a picture that arrives before the headline and
        pushes the next post off the screen. 640 is the width the single-photo
        case was designed at, so the grid keeps it and the extra width goes to
        the text, which is what a reader came for.
      */}
      {notification.media.length > 0 ? (
        <div
          className={cn(
            "grid max-w-[640px] gap-1.5 overflow-hidden rounded-control",
            notification.media.length === 1 ? "grid-cols-1" : "grid-cols-2",
          )}
        >
          {notification.media.slice(0, 4).map((photo) => (
            <MediaThumb
              key={photo.id}
              mediaId={photo.id}
              caption={photo.caption}
              className={notification.media.length === 1 ? "aspect-[16/9]" : "aspect-square"}
            />
          ))}
        </div>
      ) : null}

      {/*
        ★ No rule, and no reserved row.

        This was a `border-t` with 10px of padding over a 44px control — about
        55px of card, on every post, to hold one hollow heart. Most notices have
        no likes, so most cards spent that on nothing and the divider drew a
        line under an empty space.

        The button keeps its 44px target (`LikeButton` owns that) and the
        negative margin pulls its padding back into the card's own, so the row
        costs the height of the glyph rather than the height of the control.
        "Чухал" used to sit at this row's right-hand end and has moved up beside
        "Шинэ" — a classification is something you read *about* a post, not
        something you do *with* it.
      */}
      <div className="-mb-2 flex items-center">
        <LikeButton
          notificationId={notification.id}
          likeCount={notification.likeCount}
          likedByMe={notification.likedByMe}
          className="-my-2"
        />
      </div>
    </article>
  );
}

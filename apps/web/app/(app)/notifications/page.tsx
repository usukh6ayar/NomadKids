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
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  NOTIFICATION_CATEGORIES,
  type ChildSummary,
  NOTIFICATION_CATEGORY_LABEL,
  childSummarySchema,
  notificationSchema,
  paginated,
  surveySchema,
  type NotificationCategory,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { useSwitchableGroups } from "@/components/shell/group-switcher";
import { RowMenu } from "@/components/ui/menu";
import { SavePostPhoto } from "@/components/notifications/save-post-photo";
import { LikeButton } from "@/components/notifications/like-button";
import { ChildAvatar, MediaThumb } from "@/components/media/media-image";
import { useSession } from "@/lib/auth/session";
import {
  CalendarRange,
  ChevronRight,
  PenLine,
  MoreVertical,
  Search,
  Pencil,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { Art } from "@/components/ui/art";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FilterChip, FilterChipRow } from "@/components/ui/filter-chip";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { excerpt, formatRelative, shortName } from "@/lib/format";
import { SURVEY_CATEGORY_META, SURVEY_TONE_BG } from "@/lib/survey-meta";
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
  /*
   * ★ Added 2026-09-08, when COOK started reading this board too
   * (`NotificationsService.audienceFilter`). Every guardian-only branch below
   * used to read `!isStaff`, which was correct only because COOK/ACCOUNTANT
   * previously got nothing back from the API and neither had a nav row here —
   * `!isStaff` and "is a parent" happened to be the same set of users who
   * ever saw this page. They no longer are: a cook is `!isStaff` too, and has
   * no children and no surveys to answer. Guardian-shaped UI (the Мэдээ/
   * Судалгаа tab switcher, the child-scoped surveys tab) now checks this
   * instead; `isStaff` still gates compose/edit, unchanged.
   */
  const isGuardian = hasRole("PARENT");
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  /*
   * ★ The board, one group at a time — §8.1's targeting, read back.
   *
   * A notice is aimed at a group, at a child, or at the whole kindergarten, and
   * this screen showed all of them in one undifferentiated feed: a teacher of
   * Дэлбээ бүлэг scrolled past every notice written for Наран бүлэг to find
   * their own. The chips below narrow to one group's board, and the API
   * includes the kindergarten-wide notices in it — a closure announcement
   * belongs on every board, not only on the one nobody filtered.
   *
   * Empty string is "бүх бүлэг", which is the unfiltered feed rather than a
   * fourth audience.
   */
  const [groupId, setGroupId] = useState("");

  const filters = { unread: showUnreadOnly, q, groupId, category, from, to };

  /*
   * How many narrowing choices are on — the number on the filter icon. The
   * group board is not counted: it is which board this is, not a filter over
   * it, and a teacher always has one selected.
   */
  const activeFilters =
    (category ? 1 : 0) + (showUnreadOnly ? 1 : 0) + (importantOnly ? 1 : 0) + (from || to ? 1 : 0);

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

  /*
   * Staff only. A guardian's board is already narrowed to the groups their own
   * children are in — `audienceFilter` does it server-side — so offering them
   * a group chip row would be a control that filters a list already filtered,
   * with names of groups they may not have a child in.
   */
  const boardGroups = useSwitchableGroups(isStaff);

  /*
   * ★ A teacher lands on their own group, not on an unfiltered feed.
   *
   * The "Бүх бүлэг" chip is administrator-only now, so leaving `groupId` empty
   * for a teacher would show every group's board with no chip lit to say so —
   * the state the chip row was added to end, reached by removing its escape
   * hatch. An administrator keeps the empty default: reading across the
   * kindergarten is what their board is for.
   */
  const isAdmin = hasRole("ADMIN");
  const firstGroupId = boardGroups.data?.items[0]?.id;
  useEffect(() => {
    if (isAdmin || !isStaff || !firstGroupId) return;
    setGroupId((current) => current || firstGroupId);
  }, [isAdmin, isStaff, firstGroupId]);

  const myChildren = useQuery({
    queryKey: qk.myChildren(),
    queryFn: () => get("/children/mine", ownChildrenSchema),
    enabled: isGuardian,
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
      enabled: isGuardian,
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
      if (groupId) params.set("groupId", groupId);
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

  /** The board's own name — the group's, or the kindergarten's whole board. */
  const boardName = groupId
    ? (boardGroups.data?.items.find((g) => g.id === groupId)?.name ?? "Бүлгийн самбар")
    : "Бүх бүлгийн самбар";

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
    <div className="flex flex-col gap-4 lg:gap-5">
      {/*
        ★ The heading is `sr-only` — 2026-09-10, at the client's request that
        the first word go and the page move up.

        `PageHeader` already draws its `<h1>` `sr-only` on every other screen
        (see `page-header.test.tsx`); what this removes is the block's own
        vertical space above a toolbar that names the tab anyway. The heading
        itself stays, because a page with no `<h1>` has no name in a screen
        reader's landmark list and no top level in its outline.
      */}
      <h1 className="sr-only">{tab === "news" ? "Мэдээ" : "Судалгаа"}</h1>

      <section
        aria-label={tab === "news" ? "Мэдээний удирдлага" : "Судалгааны удирдлага"}
        data-ui="communications-toolbar"
        /*
         * ★ No card around the controls — 2026-09-10, at the client's request
         * that the box behind "Мэдээ хайх" and "Шинэ мэдээ" go.
         *
         * The feed under it is a column of cards, so a bordered panel above
         * them read as one more card that happened to hold controls, and its
         * padding pushed the first post further down a phone screen. The
         * guardian's tab strip keeps its own surface below — that one is a
         * control that needs a ground to sit on.
         */
        className="flex flex-col gap-3"
      >
        {isGuardian ? (
          <div className="rounded-card bg-sunken p-1.5">
            <div
              role="tablist"
              aria-label="Мэдээ эсвэл судалгаа"
              data-ui="communication-tabs"
              className="grid max-w-[520px] grid-cols-2 gap-1"
            >
              <TabButton
                active={tab === "news"}
                onClick={() => setTab("news")}
                icon={<Art name="notice" size={20} className="size-5" />}
              >
                Мэдээ
              </TabButton>
              <TabButton
                active={tab === "surveys"}
                onClick={() => setTab("surveys")}
                icon={<Art name="survey" size={20} className="size-5" />}
                badge={totalPending > 0 ? totalPending : undefined}
              >
                Судалгаа
              </TabButton>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="relative min-w-0 flex-1 sm:max-w-[440px]">
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
                className="border-border-soft bg-canvas pl-11 focus:bg-surface"
              />
            </div>

            {/*
              ★ The filters fold behind one icon — 2026-09-10, at the client's
              request ("шүүлтүүр гэсэн товч үсэггүй зургаар бай").

              Nine categories, two flags and a date range is four rows of chips
              above a feed, which on a phone is most of the first screen spent
              on controls nobody has asked for yet. The icon opens them; the
              dot on it says some are on, so a filter that is set is never
              invisible — the same concern the date chip's own note records.
            */}
            {tab === "news" ? (
              <Button
                type="button"
                variant={filtersOpen ? "primary" : "secondary"}
                size="icon"
                aria-expanded={filtersOpen}
                aria-controls="news-filters"
                aria-label="Шүүлтүүр"
                className="relative shrink-0"
                onClick={() => setFiltersOpen(!filtersOpen)}
              >
                <SlidersHorizontal aria-hidden="true" />
                {activeFilters > 0 ? (
                  <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-pill bg-danger px-1 text-compact font-bold text-white">
                    {activeFilters}
                    <span className="sr-only">шүүлтүүр идэвхтэй</span>
                  </span>
                ) : null}
              </Button>
            ) : null}

            {isStaff && tab === "news" ? (
              <Button asChild className="w-full sm:ml-auto sm:w-auto">
                <Link href="/notifications/new">
                  <PenLine size={18} aria-hidden="true" />
                  Шинэ мэдээ
                </Link>
              </Button>
            ) : null}
          </div>

          {tab === "news" ? (
            <div className="flex flex-col gap-3 border-t border-border-soft pt-3">
              {/*
            ★ Two filter rows, and they are not the same kind of question.

            "Бүлгийн самбар" chooses *whose* board this is; the category chips
            below narrow the one already chosen. Stacked as a single row they
            read as one set of alternatives and behave as two, so a reader has
            to discover by clicking which chips are exclusive with which. The
            audience comes first, because it is the question the other depends
            on.
          */}
              {/*
                ★ "Бүх бүлэг" is an administrator's chip — 2026-09-10, at the
                client's request that a teacher see only their own group.

                A director reads across the kindergarten and needs the
                unfiltered board; a teacher's own board is their group's, and
                offering them "all groups" invited the scroll past Наран
                бүлэг's notices that this chip row exists to end. A teacher
                assigned to two groups still picks between those two — the row
                itself is unchanged, only the "everything" escape hatch is
                administrator-only.
              */}
              {isStaff && (boardGroups.data?.items.length ?? 0) > 1 ? (
                <FilterChipRow label="Бүлгийн самбар">
                  {isAdmin ? (
                    <FilterChip active={!groupId} onClick={() => setGroupId("")}>
                      Бүх бүлэг
                    </FilterChip>
                  ) : null}
                  {(boardGroups.data?.items ?? []).map((group) => (
                    <FilterChip
                      key={group.id}
                      active={groupId === group.id}
                      onClick={() => setGroupId(group.id)}
                    >
                      {group.name}
                    </FilterChip>
                  ))}
                </FilterChipRow>
              ) : null}

              {/*
                `flex` only while open: `display:flex` beats the user agent's
                `[hidden] { display: none }`, so the panel would never close —
                the same trap `ParentSidebarDisclosure` records.
              */}
              <div
                id="news-filters"
                hidden={!filtersOpen}
                className={cn("flex-col gap-3", filtersOpen && "flex")}
              >
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
                  <div className="grid gap-3 rounded-row bg-sunken p-3 sm:max-w-[440px] sm:grid-cols-2">
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
            </div>
          ) : null}
        </div>
      </section>

      {tab === "surveys" && isGuardian ? (
        <SurveysTab
          familyChildren={surveyChildren}
          selectedChild={selectedSurveyChild}
          onSelectChild={setSurveyChildId}
          surveys={selectedSurveys}
          searchTerm={searchInput}
        />
      ) : null}

      {/*
        ★ What you are looking at, and how much of it there is.

        With the group chips above, the same feed now has several possible
        subjects, and a board that does not name its own is a board a reader has
        to remember the state of. The count is the API's `total` for exactly the
        filters in force — not a fold over the pages loaded so far, which would
        creep upward as the reader scrolls and read as posts arriving.
      */}
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
              className="flex w-full max-w-[920px] flex-col gap-3"
            >
              {/*
                ★ The heading is `sr-only` — 2026-09-10, at the client's
                request ("Дэлбээ бүлэг / 3 мэдээ энэ бичиг арилга").

                The chip row above already names whose board this is, and the
                count restated what the feed under it shows. Two lines of
                chrome between the filters and the first post is what a reader
                came past, not for. It stays in the accessibility tree, because
                a section that `aria-labelledby` points at must have something
                to point at — and the live count goes with it, so a screen
                reader is still told when filtering changes the total.
              */}
              <div className="sr-only">
                <h2 id="news-feed-heading">{boardName}</h2>
                <p aria-live="polite">
                  {data?.pages[0]?.total ?? 0} мэдээ
                  {showUnreadOnly ? " · зөвхөн уншаагүй" : ""}
                  {importantOnly ? " · зөвхөн чухал" : ""}
                </p>
              </div>

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
                    savableChildren={isGuardian ? surveyChildren : undefined}
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
            <p role="status" className="max-w-[920px] py-2 text-center text-body text-muted">
              Ачаалж байна…
            </p>
          ) : null}

          {!hasNextPage && items.length > 0 ? (
            <p className="max-w-[920px] py-2 text-center text-body text-muted">
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
        "flex min-h-[48px] items-center justify-center gap-2 rounded-control border px-3 text-body font-semibold transition-all",
        active
          ? "border-border bg-surface text-primary shadow-sm"
          : "border-transparent text-muted hover:bg-surface/70 hover:text-ink",
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
    <section aria-label="Идэвхтэй судалгаа" className="flex w-full max-w-[920px] flex-col gap-4">
      {familyChildren.length > 1 ? (
        <div className="rounded-card border border-border bg-surface p-2 shadow-sm">
          <div role="group" aria-label="Хүүхэд сонгох" className="flex gap-1.5 overflow-x-auto">
            {familyChildren.map((child) => {
              const active = child.id === selectedChild?.id;
              return (
                <button
                  key={child.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelectChild(child.id)}
                  className={cn(
                    "flex min-h-[44px] shrink-0 items-center gap-2 rounded-control border px-3 py-1.5 text-body font-semibold transition-colors",
                    active
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-transparent text-muted hover:bg-sunken hover:text-ink",
                  )}
                >
                  <ChildAvatar child={child} size={24} />
                  <span className="max-w-[140px] truncate">{child.firstName}</span>
                </button>
              );
            })}
          </div>
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {data.map((survey) => {
            const answered = Boolean(survey.respondedByMe);
            const open = !answered && survey.status !== "CLOSED";
            const meta = SURVEY_CATEGORY_META[survey.category];
            const questionCount = survey.questions.length;

            const body = (
              <>
                <span className="flex items-start justify-between gap-3">
                  <span
                    className={cn(
                      "grid size-12 shrink-0 place-items-center rounded-control",
                      SURVEY_TONE_BG[meta.tone],
                    )}
                    aria-hidden="true"
                  >
                    <meta.Icon size={22} aria-hidden="true" />
                  </span>

                  <span className="flex flex-wrap justify-end gap-1.5">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {answered ? (
                      <Badge tone="mint">Хариулсан</Badge>
                    ) : open ? (
                      <Badge tone="sun">Хариулаагүй</Badge>
                    ) : (
                      <Badge tone="neutral">Хаагдсан</Badge>
                    )}
                  </span>
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block text-lead font-semibold leading-snug text-ink">
                    {survey.title}
                  </span>
                  {survey.description ? (
                    <span className="mt-1 line-clamp-2 block text-body text-muted">
                      {survey.description}
                    </span>
                  ) : null}
                </span>

                <span className="flex items-center justify-between border-t border-border-soft pt-3 text-caption text-muted">
                  <span>{questionCount} асуулт</span>
                  {open ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-primary">
                      Хариулах
                      <ChevronRight size={16} aria-hidden />
                    </span>
                  ) : (
                    <span>{answered ? "Хариулт илгээгдсэн" : "Хугацаа дууссан"}</span>
                  )}
                </span>
              </>
            );

            return open ? (
              <Link
                key={survey.id}
                href={`/children/${selectedChild?.id}/surveys/${survey.id}`}
                className="group flex min-h-[220px] flex-col gap-4 rounded-card border border-border bg-surface p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md sm:p-5"
              >
                {body}
              </Link>
            ) : (
              <article
                key={survey.id}
                className="flex min-h-[220px] flex-col gap-4 rounded-card border border-border-soft bg-sunken p-4 sm:p-5"
              >
                {body}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
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
  savableChildren,
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
  /**
   * The reader's own children, when they are a guardian — what "Хадгалах" on
   * a photograph files into. `undefined` for staff, who already own the album
   * and have no child of their own on this board.
   */
  savableChildren?: ChildSummary[];
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
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
      a teacher cannot tell which posts they have already opened.

      ★★ The coloured rail down the left edge is gone (2026-08-30, on request).

      It was a fourth signal and the loudest one: a 4px bar on every unread card
      turned a quiet feed into a striped one, and on a board where most posts
      are unread it drew a margin rather than marking an exception. The three
      that remain each still work without the others, which was the original
      requirement:

        · the card's tint — white while unread, the page's own canvas once read
        · the border — full strength while unread, `border-border-soft` after
        · the title's weight, the "Шинэ" pill, and the word inside the link
          itself for a screen reader

      A read card is deliberately *quieter* rather than greyed out: its text
      stays `--color-ink` at full contrast, because a notice a family has
      already opened is still a notice they may need to re-read. What changes
      is the surface it sits on, not its legibility.
    */
    /*
      ★ REDESIGN 2026-09-03 — unread gains a brand edge and elevation.

      The two states were "white card, grey border" versus "grey card, paler
      border", which inverts correctly but is a very quiet difference in a
      scrolling feed: on a canvas that is itself off-white, an unread notice
      and a read one were about one step of grey apart. §4.9 asks for unread to
      be marked three ways and the brief calls out that a dot alone is not
      enough.

      ★★ The 3px brand rule down the leading edge went on 2026-09-10, at the
      client's request. It was one of four signals and the only one that was
      pure decoration on the card's edge; the three that carry the meaning
      remain — an unread notice sits raised on `bg-surface` with the resting
      shadow while a read one lies flat on the canvas, its title is heavier,
      and it carries the "Шинэ" badge and the `sr-only` "Уншаагүй". So the rule
      the paragraph above states is intact: none of what is left is colour
      alone.
    */
    <article
      className={cn(
        "flex flex-col gap-2.5 rounded-card border p-4 transition-all duration-150",
        isUnread
          ? "border-border bg-surface shadow-sm hover:border-primary/50 hover:shadow-md"
          : "border-border-soft bg-canvas hover:border-border",
      )}
    >
      {/* Who posted it, and when. `ChildAvatar` takes any `{firstName,
          lastName}` and draws initials when there is no photograph — an author
          has no `photoMediaFileId`, so it is always the initials here. */}
      {/*
        ★ One row on a phone, and it cannot wrap — 2026-09-10, at the client's
        request.

        This row used to be `flex-wrap` with a `min-w-[9rem]` floor under the
        author line, and the wrapping was the point: three `shrink-0` badges
        took the row on a 390px phone and left the author about 90px, less than
        the timestamp alone. Wrapping fixed the clipping and cost four rows —
        the client's screen read author, name, time, badges, audience, one
        under another, before a single word of the actual notice.

        Wrapping is no longer needed because the row no longer holds anything
        unbounded. The two admin-editable labels — the category and the
        audience — moved down into the meta line under the name, where they
        are text that truncates instead of badges that push. What is left on
        the right is at most "Чухал", "Шинэ" and the menu: three fixed widths
        that always fit, so `flex-nowrap` is safe rather than a clipping risk.

        `min-w-0` on the author paragraph is what makes the truncation
        possible — a flex item's default `min-width: auto` refuses to shrink
        below its content, which is the usual reason `truncate` does nothing.
      */}
      <div className="flex items-center gap-2.5">
        <ChildAvatar child={notification.author ?? {}} size={36} />

        {/*
          ★ One line, not two.

          The author sat over the timestamp in a two-line stack, which is 36px
          of a card whose content is often two lines itself. They are one fact —
          who posted this and when — and a middot joins them the way every feed
          does. `truncate` on the name and `shrink-0` on the time means a long
          Mongolian name gives way rather than pushing the date off the row.
        */}
        {/*
          ★ The role leads and the name sits under it — 2026-09-10, at the
          client's request ("Бүлгийн багш гээд доор жижиг С.Дэлгэрмаа").

          A parent reading the board wants to know *who is speaking* before
          which person it is: "the group's teacher" is what tells them whether
          this is about their child's day, and the name is how they answer it
          later. `shortName` for the same reason the register uses it — a card
          header is not the place to spend a line on a patronymic.
        */}
        {/*
          ★ Four facts on one line, ordered by what a parent loses least.

          Name · time · audience · category, and `truncate` means the tail is
          what goes when the line runs out. That order is the argument: a
          parent scanning the board needs to know whose voice it is, how fresh
          it is, and **whether it is aimed at their child** before they need
          the category — and the category is the one label here with no upper
          bound on its length, because an administrator writes it. Putting the
          unbounded label last makes it the thing that gives way, which is also
          the thing the chip row at the top of the feed already filters by.
        */}
        <p className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body font-semibold text-ink">
            {notification.author ? "Бүлгийн багш" : "Цэцэрлэг"}
          </span>
          <span className="truncate text-caption text-muted">
            {[
              notification.author ? shortName(notification.author) : null,
              formatRelative(when),
              audienceLabel(notification.targets),
              NOTIFICATION_CATEGORY_LABEL[notification.category],
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
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
        {/*
          ★ `shrink-0` and no wrapping — and that is safe now, which it was not
          before.

          Browser QA on 2026-09-03 found this row `shrink-0` on one unwrappable
          line while it still held the category badge, and an administrator's
          "Сургалт, үйл ажиллагаа" made it **405px wide inside a 390px
          viewport**: every card pushed the document to 441px, the page
          overflowed horizontally, `html { overflow-x: hidden }` swallowed it,
          and the edit and delete buttons were simply off-screen. Wrapping was
          the fix then and it was the right one — the unbounded label was still
          in here.

          It is not any more. Only statuses remain, and a status is a fixed
          word this file chooses: "Чухал", "Шинэ", and a 36px menu. Constraint
          2 — never assume a Mongolian label fits — is answered by having
          nothing here that a Mongolian label can lengthen, rather than by
          giving the row somewhere to spill.

          ★★ Colour is what is left, and now it means one thing.

          The category used to sit here as a `neutral` badge beside two
          coloured ones, and that was the note's own compromise: a *label*
          drawn as a badge because there was nowhere else to put it. There is
          now — the meta line under the name — so what remains in this corner
          is only ever "something to do" or "something unseen". A reader no
          longer has to tell a status from a label by its tone.
        */}
        <span className="flex shrink-0 items-center gap-1.5">
          {notification.isImportant ? <Badge tone="danger">Чухал</Badge> : null}
          {isUnread ? <Badge tone="primary">Шинэ</Badge> : null}

          {/*
            ★ One overflow menu in the corner, not two icon buttons in the
            footer — 2026-09-10, at the client's request.

            `canDelete` gates both, and deliberately: it is "this reader wrote
            this post, or administers this kindergarten", which is exactly
            `requireStaffOwned`, the rule `PATCH` and `DELETE` both enforce.
            One flag for both actions because one server rule governs both — a
            second `canEdit` computed separately would be a second answer to
            the same question, and the two would drift.

            The delete opens `ConfirmDialog` from this component's own state
            rather than from a trigger: a menu closes when an entry is chosen,
            and a `Dialog.Trigger` that unmounts on the same click takes the
            dialog with it. `ConfirmDialog`'s own docblock names this case.
          */}
          {canDelete ? (
            <>
              <RowMenu
                ariaLabel="Постын үйлдэл"
                triggerIcon={<MoreVertical size={18} aria-hidden="true" />}
                items={[
                  {
                    label: "Засах",
                    icon: <Pencil size={16} />,
                    onSelect: () => router.push(`/notifications/${notification.id}/edit`),
                  },
                  {
                    label: "Устгах",
                    icon: <Trash2 size={16} />,
                    tone: "danger",
                    onSelect: () => setConfirmDelete(true),
                  },
                ]}
              />
              <ConfirmDialog
                open={confirmDelete}
                onOpenChange={(next) => (next ? undefined : setConfirmDelete(false))}
                title="Энэ постыг устгах уу?"
                description="Эцэг эхийн самбараас хасагдана. Хэн устгасныг бүртгэлд үлдээнэ."
                confirmLabel="Устгах"
                cancelLabel="Цуцлах"
                tone="danger"
                pending={remove.isPending}
                onConfirm={() => remove.mutate()}
              />
            </>
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
          {/*
            ★ 44px of target, and no extra space — browser QA, 2026-09-03.

            Measured at **18px tall**: this link is the primary way to open a
            notice, and it was one line of text. `inline-block` with 13px of
            vertical padding takes it to the 44px floor, and the matching
            negative margin cancels the padding's effect on layout — so the
            card looks exactly as it did and the thumb gets something to hit.
          */}
          <Link
            href={`/notifications/${notification.id}`}
            onClick={() => {
              if (isUnread) markRead.mutate();
            }}
            className="-my-[13px] inline-block py-[13px] hover:underline"
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
            /*
              ★ "Хадгалах" on each photograph — RFP §2.3, at the client's
              request. A teacher posts the morning's pictures and a parent
              recognising their own child had no way to keep it; the API copies
              the object into that child's album rather than pointing a second
              row at the same key. Guardians only: staff already own the album.
            */
            <div key={photo.id} className="relative">
              <MediaThumb
                mediaId={photo.id}
                caption={photo.caption}
                className={notification.media.length === 1 ? "aspect-[16/9]" : "aspect-square"}
              />
              {savableChildren ? (
                <SavePostPhoto mediaId={photo.id} children={savableChildren} />
              ) : null}
            </div>
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

/**
 * Who a notice was written for, as one phrase.
 *
 * ★ It reads the targeting rows rather than a summary field, because there is
 * no summary field and there should not be one.
 *
 * `NotificationTarget` is the audience: a row per group or per child, and
 * **no rows at all** means the whole kindergarten (`targetSchema` in the API
 * says so, and the storage layer uses the same convention so the two cannot
 * drift). A `scope` column beside them would be a second copy of that fact,
 * wrong the moment a target is added.
 *
 * ★★ Group names are listed; children are counted, never named.
 *
 * A notice aimed at three children is aimed at three *families*, and printing
 * their names on a board every other family reads would tell each of them who
 * else was written to. The same reasoning `notificationSchema` gives for
 * collapsing reactions to a count and reads to a boolean.
 *
 * ★★★ A string rather than a component, since 2026-09-10.
 *
 * This was a `<p>` with a building-or-people icon on the card's own row, and
 * the row is what the client asked to reclaim. A phrase can join the meta line
 * under the author's name; an element with an icon cannot, not inside a
 * `truncate`. The icon is no loss — it distinguished "the kindergarten" from
 * "some groups", which is precisely what the words it sat beside already say.
 *
 * ★★★★ "Бүх цэцэрлэг" is still stated, not left blank. No target rows means
 * everyone, and rendering nothing for that case would make the widest audience
 * the one with no label — a reader would have to know the convention to read
 * the absence.
 */
function audienceLabel(targets: z.infer<typeof notificationSchema>["targets"]): string {
  if (targets.length === 0) return "Бүх цэцэрлэг";

  const groups = targets.map((t) => t.group?.name).filter((name): name is string => Boolean(name));
  const childCount = targets.filter((t) => t.childId).length;

  return [groups.join(", "), childCount > 0 ? `${childCount} хүүхэд` : ""]
    .filter(Boolean)
    .join(" · ");
}

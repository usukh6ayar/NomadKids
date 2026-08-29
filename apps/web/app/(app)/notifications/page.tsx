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
import { childSummarySchema, notificationSchema, paginated, surveySchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { PageHeader } from "@/components/shell/app-shell";
import { LikeButton } from "@/components/notifications/like-button";
import { ChildAvatar, MediaThumb } from "@/components/media/media-image";
import { useSession } from "@/lib/auth/session";
import { CheckCircle2, ChevronRight, Newspaper, PenLine, Search } from "lucide-react";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RowCard, RowList } from "@/components/ui/card";
import { FilterChip, FilterChipRow } from "@/components/ui/filter-chip";
import { Input } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
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
  const { hasRole } = useSession();
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
  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters = { unread: showUnreadOnly, q };

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
      <div className="relative lg:max-w-[420px]">
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

      {/*
        ★ Full width on a phone, sized to its label from `sm` — the drawing
        makes this the screen's one primary action and gives it the whole row.
        It was a small button in the page header; a header action competing
        with a title for a 375px line is the thing the drawing fixes.
      */}
      {isStaff && tab === "news" ? (
        <Button asChild className="w-full sm:w-auto sm:self-start">
          <Link href="/notifications/new">
            <PenLine size={18} aria-hidden="true" />
            Пост оруулах
          </Link>
        </Button>
      ) : null}

      {/*
        ★ The filter row, and the taxonomy question the drawing raises.

        The client's drawing shows Бүгд · Зарлал · Үйл ажиллагаа · Сургалт.
        `notificationSchema` has no category — `isImportant` is the only
        classification a notice carries — so these are the filters that exist
        rather than three that would sort nothing. `Чухал` is that flag;
        `Уншаагүй` is `reads`, which the API already filters on with `?unread`.

        A real category needs a column, a value in the compose form and a query
        parameter. It is a small piece of work and not one a component can do.
      */}
      {tab === "news" ? (
        <FilterChipRow label="Мэдээг шүүх">
          <FilterChip
            active={!showUnreadOnly && !importantOnly}
            onClick={() => {
              setShowUnreadOnly(false);
              setImportantOnly(false);
            }}
          >
            Бүгд
          </FilterChip>
          <FilterChip
            active={showUnreadOnly}
            onClick={() => {
              setShowUnreadOnly(true);
              setImportantOnly(false);
            }}
          >
            Уншаагүй
          </FilterChip>
          <FilterChip
            active={importantOnly}
            onClick={() => {
              setImportantOnly(true);
              setShowUnreadOnly(false);
            }}
          >
            Чухал
          </FilterChip>
        </FilterChipRow>
      ) : null}

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
            <section aria-labelledby="news-feed-heading" className="flex flex-col gap-3">
              <h2 id="news-feed-heading" className="text-title font-semibold text-ink">
                Сүүлийн мэдээ
              </h2>

              {/*
                ★ One centred column, capped — not the two-across grid this
                carried until 2026-08-29.

                The grid was answering "use the horizontal space" and produced
                the wrong thing: a post is гарчиг, дэлгэрэнгүй, зураг read in
                that order, and at 1336px split two ways each card was a 465px
                banner whose photograph dwarfed the words above it. The report
                was that it "looks odd on a big screen" and should read the same
                as it does on a phone.

                So the feed is a column that stops growing. 640px is about 75
                characters of Mongolian — the width prose is comfortable at, and
                what every social feed converges on for the same reason. A
                desktop reader gets the phone's card at the phone's proportions,
                centred, with the page's whitespace either side of it.
              */}
              <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3">
                {items.map((notification) => (
                  <NotificationRow key={notification.id} notification={notification} />
                ))}
              </div>
            </section>
          ) : null}

          {/* Height, so it can intersect at all — a zero-height div never does. */}
          <div ref={sentinel} aria-hidden="true" className="h-px" />

          {isFetchingNextPage ? (
            <p role="status" className="py-2 text-center text-body text-muted">
              Ачаалж байна…
            </p>
          ) : null}

          {!hasNextPage && items.length > 0 ? (
            <p className="py-2 text-center text-body text-muted">Бүх мэдэгдлийг үзлээ.</p>
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
function NotificationRow({ notification }: { notification: z.infer<typeof notificationSchema> }) {
  const queryClient = useQueryClient();
  const isUnread = notification.reads.length === 0;

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
        "flex flex-col gap-3 rounded-card border p-4 transition-colors",
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
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold text-ink">
            {fullName(notification.author)}
          </p>
          <p className="text-caption text-muted">{formatRelative(when)}</p>
        </div>
        {isUnread ? (
          <span className="shrink-0 rounded-pill bg-primary-soft px-2 py-0.5 text-caption font-medium text-primary">
            Шинэ
          </span>
        ) : null}
      </div>

      {/*
        The title is the link, not the whole card.

        A card-wide `<a>` swallows the like button and the photographs — the
        row this replaced had exactly that problem and worked around it by
        stopping the click inside `LikeButton`. One link with a real accessible
        name is both simpler and what a screen reader can navigate.
      */}
      <div className="min-w-0">
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
            {notification.title}
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
        {notification.body ? (
          <p className="mt-1 text-body text-muted">{excerpt(notification.body, 140)}</p>
        ) : null}
      </div>

      {notification.media.length > 0 ? (
        <div
          className={cn(
            "grid gap-1.5 overflow-hidden rounded-control",
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

      {/* The engagement row — a real reaction on the left, the one real
          classification on the right. See the docblock for the two counts and
          the category taxonomy the drawing shows and the model does not have. */}
      <div className="flex items-center justify-between gap-2 border-t border-border-soft pt-2.5">
        <LikeButton
          notificationId={notification.id}
          likeCount={notification.likeCount}
          likedByMe={notification.likedByMe}
          className="-my-2"
        />
        {notification.isImportant ? (
          <span className="text-caption font-medium text-danger">Чухал</span>
        ) : null}
      </div>
    </article>
  );
}

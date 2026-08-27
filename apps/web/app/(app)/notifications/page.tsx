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
import { CheckCircle2, ChevronRight, Newspaper, Plus, Search } from "lucide-react";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RowCard, RowList } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { excerpt, fullName, groupByDay } from "@/lib/format";
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
  const selectedSurveyChild = surveyChildren.find((c) => c.id === surveyChildId) ?? surveyChildren[0];

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

  const items = data?.pages.flatMap((p) => p.items) ?? [];

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
        /*
          A two-state toggle rendered as buttons with `aria-pressed`, so the
          current filter is announced rather than being visible only as a
          background colour. Staff-only "Шинэ мэдэгдэл" and the unread filter
          are news-tab actions — a parent on the surveys tab has neither.
        */
        actions={
          tab === "news" ? (
            <div className="flex flex-wrap items-center gap-2">
              {isStaff ? (
                <Button asChild size="sm">
                  <Link href="/notifications/new">
                    <Plus size={18} />
                    Шинэ мэдэгдэл
                  </Link>
                </Button>
              ) : null}

              <div className="flex gap-1 rounded-control border border-border bg-surface p-1">
                <FilterButton active={!showUnreadOnly} onClick={() => setShowUnreadOnly(false)}>
                  Бүгд
                </FilterButton>
                <FilterButton active={showUnreadOnly} onClick={() => setShowUnreadOnly(true)}>
                  Уншаагүй
                </FilterButton>
              </div>
            </div>
          ) : undefined
        }
      />

      {/*
        ★ One box, two behaviours — backend search on the news tab (the API
        now filters `title`/`body` case-insensitively, `notifications.repository.ts`),
        a client-side filter on the surveys tab. The survey list is never
        more than a handful of rows already sitting in memory (`SurveysTab`),
        so filtering it again on the server would be a request for data this
        screen already has — the same reasoning `/children`'s live search
        does not extend to a list this short.
      */}
      <div className="relative">
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
         * ★ Day-grouped, matching the home feed's own rail.
         *
         * A class board is exactly the same shape of content as "Сүүлийн
         * мөчүүд" — a chronological record — so it reads with the same
         * device rather than inventing a second one. Each row used to carry
         * its own relative timestamp; grouped by day, that fact belongs to
         * the day once, so `NotificationRow` drops it in favour of the
         * group's own label.
         */
        <div className="flex flex-col">
          {groupByDay(items, (n) => n.publishedAt ?? n.createdAt).map((group, index, all) => (
            <div key={group.key} className="flex gap-3">
              <div className="flex w-5 shrink-0 flex-col items-center" aria-hidden="true">
                <span className="mt-2 size-2.5 shrink-0 rounded-pill bg-primary ring-4 ring-primary-soft" />
                {index < all.length - 1 ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
              </div>
              <div className={cn("min-w-0 flex-1", index < all.length - 1 && "pb-5")}>
                <h3 className="mb-2 text-caption font-semibold uppercase tracking-wide text-muted">
                  {group.label}
                </h3>
                <RowList>
                  {group.items.map((notification) => (
                    <NotificationRow key={notification.id} notification={notification} />
                  ))}
                </RowList>
              </div>
            </div>
          ))}
        </div>
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
  surveys: { data?: z.infer<typeof activeSurveysSchema>; isLoading: boolean; isError: boolean } | undefined;
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
                    {questionCount > 0
                      ? `Нийт ${questionCount} асуулттай`
                      : survey.description}
                  </span>
                </span>

                {open ? <ChevronRight size={18} className="shrink-0 text-faint" aria-hidden /> : null}
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

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        // 44px, not 40: this is the tap floor the rest of the product holds to.
        "min-h-[44px] rounded-control px-3 text-body font-medium",
        active ? "bg-primary-soft text-primary" : "text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

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

  return (
    <Link
      href={`/notifications/${notification.id}`}
      // Marking read on open is the behaviour every user expects; doing it only
      // via an explicit button leaves the badge stuck at a number they have
      // already dealt with.
      onClick={() => {
        if (isUnread) markRead.mutate();
      }}
      // Its own card, per `.kidrow`. The border moving to the brand colour is
      // the reference's hover affordance for a row that is a link.
      className="flex min-h-[72px] items-start gap-3 rounded-row border border-border bg-surface px-4 py-3 transition-colors hover:border-primary"
    >
      {/*
        Unread is signalled three ways — a dot, a bolder title, and an sr-only
        word — because a dot alone is invisible to a screen reader and weight
        alone is easy to miss.
      */}
      <span
        aria-hidden="true"
        className={cn(
          "mt-2 size-2 shrink-0 rounded-pill",
          isUnread ? "bg-primary" : "bg-transparent",
        )}
      />

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn("text-ink", isUnread ? "font-semibold" : "font-medium")}>
            {notification.title}
          </span>
          {isUnread ? <span className="sr-only">Уншаагүй</span> : null}
          {notification.isImportant ? <Badge tone="peach">Чухал</Badge> : null}
        </span>

        <span className="mt-0.5 block text-body text-muted">{excerpt(notification.body, 110)}</span>

        {/*
          Photos, as a feed shows them: one fills the width, several become a
          grid. `max-h` keeps a tall portrait photo from pushing the next post
          off the screen — the row is a summary, and the detail page is where a
          picture gets to be its own size.
        */}
        {notification.media.length > 0 ? (
          <span
            className={cn(
              "mt-2 grid gap-1.5 overflow-hidden rounded-control",
              notification.media.length === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3",
            )}
          >
            {notification.media.slice(0, 6).map((photo) => (
              <MediaThumb
                key={photo.id}
                mediaId={photo.id}
                caption={photo.caption}
                className={notification.media.length === 1 ? "aspect-[16/9] max-h-[320px]" : ""}
              />
            ))}
          </span>
        ) : null}

        <span className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <span className="text-caption text-muted">{fullName(notification.author)}</span>

          {/* Inside the row, which is a link — the button stops the click. */}
          <LikeButton
            notificationId={notification.id}
            likeCount={notification.likeCount}
            likedByMe={notification.likedByMe}
            className="-my-2"
          />
        </span>
      </span>
    </Link>
  );
}

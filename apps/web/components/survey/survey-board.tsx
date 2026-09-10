"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import {
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  Copy,
  Download,
  ListChecks,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Users,
  UsersRound,
} from "lucide-react";
import {
  SURVEY_CATEGORY_LABEL,
  termSchema,
  personRefSchema,
  SURVEY_KIND_HINT,
  SURVEY_KIND_LABEL,
  groupListItemSchema,
  paginated,
  surveyCategorySchema,
  surveySchema,
  type SurveyCategory,
  type SurveyKind,
} from "@kinder/contracts";

const SURVEY_CATEGORIES = surveyCategorySchema.options;
const termsSchema = z.array(termSchema);

/** What `GET /surveys/:id/participation` answers — the roster, split. */
const participationRowSchema = z.object({
  child: personRefSchema,
  group: z.object({ id: z.string(), name: z.string() }).nullish(),
});
const participationSchema = z.object({
  answered: z.array(participationRowSchema.extend({ submittedAt: z.string() })),
  pending: z.array(participationRowSchema),
  familyResponses: z.number(),
  roster: z.number(),
});
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FilterChip, FilterChipRow } from "@/components/ui/filter-chip";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { formatDate, fullName } from "@/lib/format";
import { SURVEY_CATEGORY_META, SURVEY_TONE_BG } from "@/lib/survey-meta";
import { downloadUrl } from "@/lib/api/client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import { RowMenu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { TERM_NUMBERS, termLabel, termNumberForDay } from "@/lib/terms";
import { cn } from "@/lib/utils";

const surveysSchema = z.array(surveySchema);
const groupsSchema = paginated(groupListItemSchema);

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Ноорог",
  PUBLISHED: "Нийтэлсэн",
  CLOSED: "Хаасан",
};

const STATUS_TONE: Record<string, "neutral" | "mint" | "sun"> = {
  DRAFT: "neutral",
  PUBLISHED: "mint",
  CLOSED: "sun",
};

/**
 * One kind's whole screen — the client's 2026-09-10 drawing.
 *
 * ★ Two screens, not two tabs on one.
 *
 * They were a tab strip until this drawing arrived, and the client's words
 * about it were unambiguous: "Энэ 2 тусдаа байх ёстой." A tab strip says these
 * are two views of one thing; a poll and a questionnaire are two different
 * instruments that happen to share a table. The hub at `/surveys` chooses
 * between them and each has its own route, its own colour and its own back
 * arrow — which is also what makes a link to "the polls" possible at all.
 *
 * Everything below is shared by both and differs only by `kind`. One component
 * rather than two files that start identical and drift: the search, the
 * filters, the tabs, the card and the create dialog are the same screen with a
 * different noun in it.
 */
export function SurveyBoard({ kind }: { kind: SurveyKind }) {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <SurveysList kind={kind} />
    </RequireRole>
  );
}

/**
 * ★ Three tabs since 2026-09-10 — Идэвхтэй, Дууссан, Ноорог.
 *
 * `surveyStatusSchema` has exactly three states and now each has a tab, which
 * is the arrangement the client drew. It used to be two, with `DRAFT` folded
 * into Идэвхтэй on the argument that an unfinished survey is work in progress
 * and does not belong under "done" — true, and the reason it went there rather
 * than into Дууссан, but it made the Идэвхтэй count answer two questions at
 * once. A teacher glancing at "Идэвхтэй 2" could not tell whether either was
 * actually out with families.
 *
 * The badge inside each card still names the status, so the tab is where you
 * look and the badge is what it is — unchanged, and now they agree.
 */
const TABS = [
  { key: "active" as const, label: "Идэвхтэй", statuses: ["PUBLISHED"] },
  { key: "closed" as const, label: "Дууссан", statuses: ["CLOSED"] },
  { key: "draft" as const, label: "Ноорог", statuses: ["DRAFT"] },
];

type TabKey = (typeof TABS)[number]["key"];

function SurveysList({ kind }: { kind: SurveyKind }) {
  const { primaryKindergartenId } = useSession();
  /**
   * Which kind is being created, or `null` for "no dialog open".
   *
   * ★ Not a boolean any more: the two buttons above choose the kind, and the
   * dialog needs to open on it rather than on its own default.
   */
  const [creating, setCreating] = useState<SurveyKind | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tab, setTab] = useState<TabKey>("active");
  const [category, setCategory] = useState<SurveyCategory | null>(null);
  /**
   * Client-side, like the notifications page's survey tab and for the same
   * reason: a kindergarten's surveys are a handful of rows already in memory,
   * so filtering them again on the server would be a request for data this
   * screen is holding.
   */
  const [search, setSearch] = useState("");

  const surveys = useQuery({
    queryKey: qk.kindergartenSurveys(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/surveys`, surveysSchema),
    enabled: Boolean(primaryKindergartenId),
  });

  /*
    ★ Narrowed to this kind before anything else counts it.

    The tab counts, the two empty states and the term groups all read `all`,
    and on a screen that is only ever about one kind an unfiltered `all` would
    make every one of them report the other kind's rows — "Идэвхтэй 2" over an
    empty list is the failure that shape produces.
  */
  const all = (surveys.data ?? []).filter((survey) => survey.kind === kind);
  const term = search.trim().toLowerCase();
  /** How many narrowing choices are on — the number on the filter icon. */
  const activeFilters = (category ? 1 : 0) + (from || to ? 1 : 0);

  const statuses = TABS.find((t) => t.key === tab)!.statuses;

  /** The date a card shows — closed, else published, else created. */
  const surveyDay = (survey: z.infer<typeof surveySchema>) =>
    (survey.closedAt ?? survey.publishedAt ?? survey.createdAt).slice(0, 10);

  const visible = all.filter((survey) => {
    const day = surveyDay(survey);
    return (
      statuses.includes(survey.status) &&
      (!category || survey.category === category) &&
      survey.kind === kind &&
      (!from || day >= from) &&
      (!to || day <= to) &&
      (!term ||
        survey.title.toLowerCase().includes(term) ||
        (survey.description ?? "").toLowerCase().includes(term))
    );
  });

  /*
   * The kindergarten's configured terms. `termNumberForDay` falls back to the
   * Mongolian school year when none are set, so a fresh deployment groups
   * rather than showing a blank page — see `lib/terms.ts`.
   */
  const terms = useQuery({
    queryKey: qk.terms(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/terms`, termsSchema),
    enabled: Boolean(primaryKindergartenId),
    staleTime: 5 * 60_000,
  });

  const byTerm = TERM_NUMBERS.map((number) => ({
    number,
    surveys: visible.filter(
      (survey) => termNumberForDay(surveyDay(survey), terms.data ?? []) === number,
    ),
  })).filter((group) => group.surveys.length > 0);

  /** The tab counts, which the filters above must not change — see `TabPill`. */
  const countFor = (key: TabKey) =>
    all.filter((s) => TABS.find((t) => t.key === key)!.statuses.includes(s.status)).length;

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      {/*
        ★ The client's own order — 2026-09-10: search first, then the create
        button, then the two counts.

        It read tabs · search · a row of category chips, under a page header
        that carried the create button a scroll away from everything it
        relates to. The order now matches how the screen is used: find one,
        make one, or pick which pile you are looking at.
      */}
      {/*
        ★ A real heading with a "+ Шинэ" beside it — 2026-09-10's drawing.

        It was `sr-only`, on the argument that "Мэдээ"/"Судалгаа" over a screen
        you reached by pressing Судалгаа is a word that says nothing. That held
        while this was the only survey screen. It is not: there are two now,
        reached from a hub, and the heading is what tells you which one you
        landed on — the same word doing a different job.

        The sub-line is the kind's own hint, the half of the old radio pair
        worth keeping: it is the only place on either screen that says what
        distinguishes a poll from a questionnaire.
      */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title font-semibold leading-heading text-ink">
            {SURVEY_KIND_LABEL[kind]}
          </h1>
          <p className="mt-0.5 text-caption text-muted">{SURVEY_KIND_HINT[kind]}</p>
        </div>

        <Button className="shrink-0" onClick={() => setCreating(kind)}>
          <Plus size={18} aria-hidden="true" />
          Шинэ
        </Button>
      </header>

      <section
        aria-label="Судалгааны удирдлага"
        data-ui="communications-toolbar"
        className="flex flex-col gap-2.5"
      >
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              size={18}
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`${SURVEY_KIND_LABEL[kind]} хайх`}
              aria-label={`${SURVEY_KIND_LABEL[kind]} хайх`}
              className="border-border-soft bg-canvas pl-11 focus:bg-surface"
            />
          </div>

          {/*
            The six categories fold behind one icon, the same shape the class
            board uses — and for the same reason: a row of chips above a list
            is most of a phone screen spent on a filter nobody has asked for
            yet. The count says when one is on.
          */}
          <Button
            type="button"
            variant={filtersOpen ? "primary" : "secondary"}
            size="icon"
            aria-expanded={filtersOpen}
            aria-controls="survey-filters"
            aria-label="Шүүлтүүр"
            className="relative shrink-0"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <SlidersHorizontal aria-hidden="true" />
            {activeFilters > 0 ? (
              <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-pill bg-primary px-1 text-compact font-bold text-white">
                {activeFilters}
                <span className="sr-only">шүүлтүүр идэвхтэй</span>
              </span>
            ) : null}
          </Button>
        </div>

        <div
          id="survey-filters"
          hidden={!filtersOpen}
          data-testid="survey-filter-panel"
          className={cn(
            "rounded-card border border-border bg-surface p-3 shadow-sm sm:p-4",
            filtersOpen && "flex flex-col gap-3",
          )}
        >
          {/*
            ★ Three questions behind the icon, not one — 2026-09-10.

            Which kind, which subject, and when. They are separate rows because
            they are separate questions: a chip row that mixed "Асуулга" with
            "Сэтгэл ханамжийн судалгаа" would read as one set of alternatives
            and behave as two, which is the same mistake the class board's own
            filter note records avoiding.
          */}
          <FilterChipRow label="Судалгааны ангиллаар шүүх" scroll>
            <FilterChip active={category === null} onClick={() => setCategory(null)}>
              Бүгд
            </FilterChip>
            {SURVEY_CATEGORIES.map((key) => (
              <FilterChip key={key} active={category === key} onClick={() => setCategory(key)}>
                {SURVEY_CATEGORY_LABEL[key]}
              </FilterChip>
            ))}
          </FilterChipRow>

          {/*
            The range filters on whichever date describes the survey's own
            state — closed, else published, else created — which is the date
            the card shows. Filtering on `createdAt` while the card reads
            "хаагдсан 9-р сарын 2" would be a list that disagrees with itself.
          */}
          <div className="grid grid-cols-2 gap-2 sm:max-w-[420px]">
            <Field label="Эхлэх огноо">
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => setFrom(e.target.value)}
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
                  onChange={(e) => setTo(e.target.value)}
                />
              )}
            </Field>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Судалгааны төлөв"
          data-ui="communication-tabs"
          className="grid grid-cols-3 gap-1 rounded-card bg-sunken p-1 sm:w-[420px]"
        >
          {TABS.map((t) => (
            <TabPill
              key={t.key}
              active={tab === t.key}
              count={countFor(t.key)}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </TabPill>
          ))}
        </div>
      </section>

      {surveys.isLoading ? <LoadingState rows={3} /> : null}
      {surveys.isError ? <ErrorState description={errorMessage(surveys.error)} /> : null}

      {/*
        ★ No action on the empty state, because the button below the list is
        always drawn and would be the second one on the screen.

        It also said "Шинэ судалгаа" and created a `FORM` regardless of which
        tab was open — the exact mismatch the tab strip exists to remove.
      */}
      {surveys.data && all.length === 0 ? (
        <EmptyState
          title={`${SURVEY_KIND_LABEL[kind]} алга`}
          description={`Дээрх "Шинэ" товчоор эхний ${SURVEY_KIND_LABEL[kind].toLowerCase()}аа үүсгэнэ үү.`}
        />
      ) : null}

      {surveys.data && all.length > 0 && visible.length === 0 ? (
        <EmptyState
          title={`Тохирох ${SURVEY_KIND_LABEL[kind].toLowerCase()} алга`}
          description="Хайлт эсвэл шүүлтүүрээ өөрчилж үзнэ үү."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearch("");
                setCategory(null);
              }}
            >
              Шүүлтүүр цэвэрлэх
            </Button>
          }
        />
      ) : null}

      {/*
        ★ One column on a phone, two from `md`, three at `2xl`.

        The brief asks for wider cards on a desktop and a responsive grid where
        there are several — which are the same request at two window sizes. A
        1336px content column carrying one survey title per row is the
        stretched-mobile-page failure this pass exists to remove; three tracks
        at `2xl` put each card at about 430px, which is the width the card was
        designed around (a title over two meta lines).

        `items-stretch` is the default and is what makes cards in a row end
        level regardless of how long their titles wrap.
      */}
      {/*
        ★ Grouped by the school year's term — 2026-09-10, at the client's
        request ("хичээлийн жилийн улиралаар ангилж харагд").

        A kindergarten's year has three, and what a teacher asks of an old
        survey is which term it belonged to rather than which week. Empty
        terms are dropped: a heading over nothing is a term that reads as
        missing data instead of as a term nothing happened in.
      */}
      {visible.length > 0 ? (
        <div className="flex flex-col gap-6">
          {byTerm.map(({ number, surveys }) => (
            <section key={number} aria-labelledby={`term-${number}-surveys`}>
              <h2
                id={`term-${number}-surveys`}
                className="mb-3 flex items-baseline gap-2 text-lead font-semibold text-ink"
              >
                {termLabel(number)}
                <span className="text-caption font-normal text-muted">{surveys.length}</span>
              </h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 2xl:grid-cols-3">
                {surveys.map((survey) => (
                  <SurveyCard key={survey.id} survey={survey} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {creating && primaryKindergartenId ? (
        <CreateSurveyDialog
          kindergartenId={primaryKindergartenId}
          initialKind={creating}
          onClose={() => setCreating(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * One tab of the Идэвхтэй / Дууссан strip.
 *
 * ★ The count is of the *tab*, not of what is showing.
 *
 * It counts every survey in that state, ignoring the search box and the type
 * chips above. A count that moved with the filters would answer "how many did
 * my search find" — which the list underneath already answers — instead of
 * "is there anything over there", which is the only question a tab label can
 * usefully answer before you press it.
 */
function TabPill({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex min-h-[48px] items-center justify-center rounded-control border px-3 text-body font-semibold transition-all",
        active
          ? "border-border bg-surface text-primary shadow-sm"
          : "border-transparent text-muted hover:bg-surface/70 hover:text-ink",
      )}
    >
      {children}
      <span
        className={cn(
          "ml-2 inline-flex min-w-6 items-center justify-center rounded-pill px-1.5 text-caption font-bold tabular-nums",
          active ? "bg-primary-soft text-primary" : "bg-canvas text-faint",
        )}
      >
        {count}
      </span>
    </button>
  );
}

/**
 * A survey, as a card.
 *
 * ★ Replaces a 64px row carrying a title, a scope and a status badge.
 *
 * Everything on it comes from `surveySchema` — the category chip from
 * `category`, the question count from `questions.length`, and the date from
 * whichever of `closedAt` /
 * `publishedAt` / `createdAt` describes the state it is in. Nothing here is a
 * field the API does not send.
 *
 * `h-full` so a card in a grid row fills the height its tallest neighbour
 * sets, which is what keeps the footers of a row on one line.
 */
function SurveyCard({ survey }: { survey: z.infer<typeof surveySchema> }) {
  const meta = SURVEY_CATEGORY_META[survey.category];
  const questionCount = survey.questions.length;
  /*
    ★ Nullish, and read as zero rather than hidden.

    The API attaches these to the staff list only, so `?? 0` covers the
    child-facing shape — and a survey nobody has answered is genuinely "0 / 35",
    which is the most useful thing this row ever says.
  */
  const answered = survey.respondedCount ?? 0;
  const expected = survey.expectedCount ?? 0;
  const date = survey.closedAt ?? survey.publishedAt ?? survey.createdAt;
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [participation, setParticipation] = useState(false);

  const clone = useMutation({
    mutationFn: () =>
      mutate(`/surveys/${survey.id}/clone`, surveySchema, { method: "POST", body: {} }),
    onSuccess: (copy) => {
      toast.success("Судалгаа хуулагдлаа.");
      router.push(`/surveys/${copy.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: () => mutate(`/surveys/${survey.id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      setConfirmDelete(false);
      toast.success("Судалгаа устгагдлаа.");
      void queryClient.invalidateQueries({ queryKey: ["surveys"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="group relative h-full">
      {/*
        ★ The menu sits outside the link, not inside it — 2026-09-10.

        A `<button>` nested in an `<a>` is invalid HTML and, more to the point,
        every menu press would also follow the card. It is absolutely
        positioned over the card's corner instead, above the link in the stack.
      */}
      <div className="absolute right-2 top-2 z-10">
        <RowMenu
          ariaLabel={`${survey.title} үйлдэл`}
          triggerIcon={<MoreVertical size={18} aria-hidden="true" />}
          items={[
            {
              label: "Засах",
              icon: <Pencil size={16} />,
              onSelect: () => router.push(`/surveys/${survey.id}`),
            },
            {
              label: "Оролцоо",
              icon: <UsersRound size={16} />,
              hint: "Хэн бөглөсөн, хэн бөглөөгүй",
              onSelect: () => setParticipation(true),
            },
            {
              label: "Тайлан татах",
              icon: <Download size={16} />,
              onSelect: () => {
                window.location.href = downloadUrl(`/surveys/${survey.id}/export`);
              },
            },
            {
              label: "Дахин ашиглах",
              icon: <Copy size={16} />,
              hint: "Асуултуудыг хуулж шинэ ноорог үүсгэнэ",
              onSelect: () => clone.mutate(),
            },
            {
              label: "Устгах",
              icon: <Trash2 size={16} />,
              tone: "danger",
              separated: true,
              onSelect: () => setConfirmDelete(true),
            },
          ]}
        />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(next) => (next ? undefined : setConfirmDelete(false))}
        title="Энэ судалгааг устгах уу?"
        description="Жагсаалтаас хасагдана. Өгсөн хариултууд хэвээр үлдэж, бүртгэлд тэмдэглэгдэнэ."
        confirmLabel="Устгах"
        cancelLabel="Болих"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />

      <SurveyParticipation
        surveyId={survey.id}
        title={survey.title}
        open={participation}
        onClose={() => setParticipation(false)}
      />

      <Link href={`/surveys/${survey.id}`} className="block h-full">
        <Card
          pad="compact"
          className="flex h-full min-h-[190px] flex-col gap-3 transition-all group-hover:-translate-y-0.5 group-hover:border-primary group-hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-3">
            <span
              className={cn(
                "grid size-10 shrink-0 place-items-center rounded-control",
                SURVEY_TONE_BG[meta.tone],
              )}
              aria-hidden="true"
            >
              <meta.Icon size={20} />
            </span>

            {/*
              ★ `pe-9` — 2026-09-10. The overflow menu is absolutely positioned
              over this same corner, so without a reserved lane the two
              overlapped: the status badge sat under the three dots. The menu's
              trigger is a 44px icon button inset by 8px, and 36px of padding
              plus the row's own gap clears it.
            */}
            <div className="flex flex-wrap justify-end gap-1.5 pe-9">
              <Badge tone={meta.tone}>{meta.label}</Badge>
              <Badge tone={STATUS_TONE[survey.status]}>{STATUS_LABEL[survey.status]}</Badge>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="text-lead font-semibold leading-[1.35] text-ink transition-colors group-hover:text-primary">
              {survey.title}
            </h3>
            {survey.description ? (
              <p className="mt-1 line-clamp-2 text-body text-muted">{survey.description}</p>
            ) : null}
          </div>

          {/*
            ★ The footer is three bands now, not one row — 2026-09-10's drawing.

            It carried audience · scope · question count · date on one wrapping
            line, and the drawing replaces the scope with the fact a teacher
            actually chases: how many families have replied. That number wants
            a bar under it, and a bar wants its own line, so the date moved
            down to a line of its own rather than fighting the fill for the
            right-hand end.

            The scope ("Хүүхэд тус бүрээр") is dropped rather than moved. It
            describes how the survey is answered, which the family reading it
            needs and a teacher scanning a list does not — and it was the one
            item on the row nobody could act on.
          */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-soft pt-3 text-caption text-muted">
            {/*
            ★ The audience, before the answering shape — 2026-09-06.

            A survey aimed at one group is a different thing from a survey the
            whole kindergarten is being asked, and until `groupId` existed the
            list could not say which this was. It leads the footer because it
            is the question a teacher scans for; the scope follows it.
          */}
            <span className="inline-flex items-center gap-1.5">
              <Users size={14} aria-hidden="true" />
              {survey.group?.name ?? "Бүх бүлэг"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ListChecks size={14} aria-hidden="true" />
              {questionCount} асуулт
            </span>
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <CalendarCheck size={14} aria-hidden="true" />
              {answered} / {expected} хариулсан
            </span>
          </div>

          <SurveyProgress answered={answered} expected={expected} />

          <div className="flex items-center gap-1.5 text-caption tabular-nums text-muted">
            <CalendarDays size={14} aria-hidden="true" />
            {formatDate(date)}
            <ChevronRight
              size={16}
              className="ml-auto text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
              aria-hidden="true"
            />
          </div>
        </Card>
      </Link>
    </div>
  );
}

/**
 * How far a survey has got, as a bar and a percentage.
 *
 * ★ The percentage is of the audience, not of the answers.
 *
 * `expectedCount` is who was asked — one group, or the kindergarten — so "66%"
 * means two thirds of the families have replied. That is the figure a teacher
 * chases; a share of the replies received would always be 100% and say
 * nothing.
 *
 * ★★ A survey with nobody to ask draws an empty rail rather than dividing by
 * zero. A group whose children have all left is not 0% and not 100%; it is a
 * survey with no audience, and an empty rail is the honest picture of that.
 *
 * ★★★ `aria-hidden` on the rail, with the sentence beside it.
 *
 * The row above already reads "23 / 35 харуулсан", so a `progressbar`
 * announcing "66" would be the same fact a second time in a less useful form.
 */
function SurveyProgress({ answered, expected }: { answered: number; expected: number }) {
  const percent = expected > 0 ? Math.round((answered / expected) * 100) : 0;

  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden="true" className="h-1.5 flex-1 overflow-hidden rounded-pill bg-sunken">
        <span
          className="block h-full rounded-pill bg-primary transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="shrink-0 text-caption font-semibold tabular-nums text-ink">{percent}%</span>
    </div>
  );
}

/**
 * Оролцоо — who answered and who has not, at the client's request.
 *
 * ★ The pending half leads. `results` already reports how many replied; what
 * a teacher opens this for is the list to ring, so the names with nothing
 * against them come first and the answered list is the reassurance under it.
 *
 * Fetched only while open: a grid of twelve cards would otherwise fire twelve
 * requests for panels nobody has opened.
 */
function SurveyParticipation({
  surveyId,
  title,
  open,
  onClose,
}: {
  surveyId: string;
  title: string;
  open: boolean;
  onClose: () => void;
}) {
  const data = useQuery({
    queryKey: ["surveys", surveyId, "participation"],
    queryFn: () => get(`/surveys/${surveyId}/participation`, participationSchema),
    enabled: open,
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Оролцоо"
      description={title}
      footer={
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
          Хаах
        </Button>
      }
    >
      {data.isLoading ? <LoadingState rows={3} /> : null}
      {data.isError ? <ErrorState description={errorMessage(data.error)} /> : null}

      {data.data ? (
        <div className="flex flex-col gap-4">
          <p className="text-body text-muted">
            <span className="font-semibold text-ink">{data.data.answered.length}</span> /{" "}
            {data.data.roster} бөглөсөн
            {data.data.familyResponses > 0 ? (
              <> · гэр бүлээр {data.data.familyResponses} хариулт</>
            ) : null}
          </p>

          <ParticipationList
            heading="Бөглөөгүй"
            tone="peach"
            names={data.data.pending.map((row) => fullName(row.child))}
            empty="Бүгд бөглөсөн."
          />
          <ParticipationList
            heading="Бөглөсөн"
            tone="mint"
            names={data.data.answered.map((row) => fullName(row.child))}
            empty="Одоогоор хэн ч бөглөөгүй."
          />
        </div>
      ) : null}
    </FormDialog>
  );
}

function ParticipationList({
  heading,
  tone,
  names,
  empty,
}: {
  heading: string;
  tone: "peach" | "mint";
  names: string[];
  empty: string;
}) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-2 text-body font-semibold text-ink">
        {heading}
        <Badge tone={tone}>{names.length}</Badge>
      </h3>
      {names.length === 0 ? (
        <p className="text-caption text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {names.map((name) => (
            <li key={name} className="rounded-pill bg-canvas px-2.5 py-1 text-caption text-ink">
              {name}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CreateSurveyDialog({
  kindergartenId,
  initialKind,
  onClose,
}: {
  kindergartenId: string;
  /** Which button opened it — the choice is made before the dialog appears. */
  initialKind: SurveyKind;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<SurveyCategory>("PARENT_ENGAGEMENT");
  const [scope, setScope] = useState<"CHILD" | "KINDERGARTEN">("CHILD");
  /**
   * Which group the survey is for — "" is every group.
   *
   * ★ Added 2026-09-06, at the client's request: "хэнд зориулсан гэхэд бүх
   * бүлэг / бүлэг сонгох болгох". `Survey.groupId` carries it, and null there
   * means every group rather than a frozen list of the ones that exist today.
   */
  const [groupId, setGroupId] = useState("");
  /**
   * ★ Fixed by the tab that opened this dialog, and not editable here —
   * 2026-09-10, at the client's request ("Асуулга гэдэг товчин дээр судалгаа
   * гэсэн хажууд нь хэсэг орж ирж болохгүй. Энэ 2 тусдаа байх ёстой").
   *
   * It used to be a radio pair drawn as tabs, and it was asking the same
   * question twice: the teacher had already pressed Асуулга to get here, and
   * the dialog opened with Судалгаа sitting beside it as though the press had
   * not counted. Worse, changing it here left the teacher on the Асуулга tab
   * having made a Судалгаа — a survey that vanishes from the list the moment
   * it is created.
   *
   * `useState` rather than a plain `const` because the value still belongs to
   * this component's form state; nothing sets it, which is the point.
   */
  const [kind] = useState<SurveyKind>(initialKind);
  /**
   * The optional closing date, as the `yyyy-mm-dd` an `<input type="date">`
   * produces. Empty means no deadline, which the client asked to keep possible.
   */
  const [closesOn, setClosesOn] = useState("");

  // The audience options. Same key every register uses, so this normally reads
  // a cache the shell has already filled.
  const groups = useQuery({
    queryKey: qk.groups({ pageSize: 100 }),
    queryFn: () => get("/groups?page=1&pageSize=100", groupsSchema),
    staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/surveys`, surveySchema, {
        method: "POST",
        body: {
          title,
          category,
          scope,
          kind,
          /*
            ★ End of the chosen day, not its midnight.

            `<input type="date">` yields `2026-09-15`, which parses as
            00:00 — so sending it raw would close the survey at the start of
            the day a teacher wrote down, and everyone answering on the 15th
            would be a day late. `T23:59:59` makes the date inclusive, which is
            what "хаагдах огноо: 9-р сарын 15" means to the person typing it.
          */
          closesAt: closesOn ? new Date(`${closesOn}T23:59:59`).toISOString() : null,
          // "" is the whole kindergarten, which the API stores as a null
          // column rather than as every group listed.
          groupId: groupId || null,
        },
      }),
    onSuccess: (survey) => router.push(`/surveys/${survey.id}`),
  });

  const errors = fieldErrors(create.error);
  const createTitle = `Шинээр ${SURVEY_KIND_LABEL[kind].toLowerCase()} үүсгэх`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={createTitle}
      className="fixed inset-0 z-50 grid items-end overflow-y-auto bg-ink/50 p-0 sm:place-items-center sm:p-4"
    >
      <div className="max-h-[calc(100dvh-0.5rem)] w-full max-w-[520px] overflow-y-auto rounded-t-card border border-border bg-surface p-4 shadow-lg sm:max-h-[calc(100vh-2rem)] sm:rounded-card sm:p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!create.isPending) create.mutate();
          }}
          className="flex flex-col gap-3.5"
          noValidate
        >
          <h2 className="text-title font-semibold text-ink">{createTitle}</h2>

          <FormError message={create.isError ? errorMessage(create.error) : null} />

          {/*
            ★ What kind this is, stated rather than asked.

            The heading above already says "Шинээр асуулга үүсгэх", so this
            line is not repeating the choice — it is the one-line description
            of what that kind *does*, which the radio pair used to carry as a
            hint under each option and which is the half of that control worth
            keeping.
          */}
          <p className="-mt-1 text-caption text-muted">{SURVEY_KIND_HINT[kind]}</p>

          <Field label="Гарчиг" error={errors.title} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3" data-testid="survey-create-fields-primary">
            <Field label="Судалгааны ангилал" error={errors.category} required>
              {({ id, describedBy, invalid }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={category}
                  onChange={(e) => setCategory(e.target.value as SurveyCategory)}
                >
                  {SURVEY_CATEGORIES.map((value) => (
                    <option key={value} value={value}>
                      {SURVEY_CATEGORY_LABEL[value]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Хэнд зориулагдсан" hint="Сонгосон бүлгийн эцэг эхэд л харагдана.">
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                >
                  <option value="">Бүх бүлэг</option>
                  {(groups.data?.items ?? []).map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          {/*
            ★ No hint — 2026-09-10, at the client's request. The two options
            below say it themselves: "Хүүхэд тус бүрээр" against "Цэцэрлэгээр
            нэг удаа" is the whole distinction, and a sentence restating one of
            them under the control was a line to read past.
          */}
          <div className="grid grid-cols-2 gap-3" data-testid="survey-create-fields-secondary">
            <Field label="Хариулах хэлбэр">
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  value={scope}
                  onChange={(e) => setScope(e.target.value as "CHILD" | "KINDERGARTEN")}
                >
                  <option value="CHILD">Хүүхэд тус бүрээр</option>
                  <option value="KINDERGARTEN">Цэцэрлэгээр нэг удаа</option>
                </Select>
              )}
            </Field>

            <Field
              label="Хаагдах огноо"
              hint="Заавал биш — хоосон орхивол гараар хаах хүртэл нээлттэй байна."
              error={errors.closesAt}
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  type="date"
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={closesOn}
                  onChange={(e) => setClosesOn(e.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
            <Button type="submit" className="w-full" disabled={create.isPending}>
              {create.isPending ? "Үүсгэж байна…" : "Үргэлжлүүлэх"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={onClose}
              disabled={create.isPending}
            >
              Болих
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

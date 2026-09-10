"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import {
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
  personRefSchema,
  SURVEY_KIND_HINT,
  SURVEY_KIND_LABEL,
  groupListItemSchema,
  paginated,
  surveyCategorySchema,
  surveyKindSchema,
  surveySchema,
  type SurveyCategory,
  type SurveyKind,
} from "@kinder/contracts";

/** The two kinds in the order the client's drawing puts them: Пол, then Форм. */
const SURVEY_KINDS = surveyKindSchema.options;
const SURVEY_CATEGORIES = surveyCategorySchema.options;

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

const SCOPE_LABEL: Record<string, string> = {
  CHILD: "Хүүхэд тус бүрээр",
  KINDERGARTEN: "Цэцэрлэгээр нэг удаа",
};

export default function SurveysPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <SurveysList />
    </RequireRole>
  );
}

/**
 * ★ Two tabs, and the mapping to `status` is deliberate rather than obvious.
 *
 * `surveyStatusSchema` has three states and the brief asks for two tabs, so a
 * `DRAFT` has to land in one of them. It goes in Идэвхтэй: a draft is work in
 * progress that the person on this screen still has to finish, and the tab a
 * teacher opens to find unfinished work is not the one labelled "done". It
 * keeps its own "Ноорог" badge inside the card, so the two are never confused
 * for each other — the tab is where you look, the badge is what it is.
 */
const TABS = [
  { key: "active" as const, label: "Идэвхтэй", statuses: ["DRAFT", "PUBLISHED"] },
  { key: "closed" as const, label: "Дууссан", statuses: ["CLOSED"] },
];

function SurveysList() {
  const { primaryKindergartenId } = useSession();
  const [creating, setCreating] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tab, setTab] = useState<"active" | "closed">("active");
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

  const all = surveys.data ?? [];
  const term = search.trim().toLowerCase();
  const statuses = TABS.find((t) => t.key === tab)!.statuses;

  const visible = all.filter(
    (survey) =>
      statuses.includes(survey.status) &&
      (!category || survey.category === category) &&
      (!term ||
        survey.title.toLowerCase().includes(term) ||
        (survey.description ?? "").toLowerCase().includes(term)),
  );

  /** The tab counts, which the filters above must not change — see `TabPill`. */
  const countFor = (key: "active" | "closed") =>
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
      <h1 className="sr-only">Судалгаа</h1>

      <section
        aria-label="Судалгааны удирдлага"
        data-ui="communications-toolbar"
        className="flex flex-col gap-3"
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
              placeholder="Судалгаа хайх"
              aria-label="Судалгаа хайх"
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
            {category ? (
              <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-pill bg-danger px-1 text-compact font-bold text-white">
                1<span className="sr-only">шүүлтүүр идэвхтэй</span>
              </span>
            ) : null}
          </Button>
        </div>

        <div
          id="survey-filters"
          hidden={!filtersOpen}
          className={cn("flex-col gap-3", filtersOpen && "flex")}
        >
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
        </div>

        <Button block onClick={() => setCreating(true)} className="sm:w-auto sm:self-start">
          <Plus size={18} aria-hidden="true" />
          Санал асуулга үүсгэх
        </Button>

        <div
          role="tablist"
          aria-label="Судалгааны төлөв"
          data-ui="communication-tabs"
          className="grid grid-cols-2 gap-1 rounded-card bg-sunken p-1 sm:w-[360px]"
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

      {surveys.data && all.length === 0 ? (
        <EmptyState
          title="Судалгаа алга"
          description="Эхний судалгаагаа үүсгэж эхэлнэ үү."
          action={<Button onClick={() => setCreating(true)}>Шинэ судалгаа</Button>}
        />
      ) : null}

      {surveys.data && all.length > 0 && visible.length === 0 ? (
        <EmptyState
          title="Тохирох судалгаа алга"
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
      {visible.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 2xl:grid-cols-3">
          {visible.map((survey) => (
            <SurveyCard key={survey.id} survey={survey} />
          ))}
        </div>
      ) : null}

      {creating && primaryKindergartenId ? (
        <CreateSurveyDialog
          kindergartenId={primaryKindergartenId}
          onClose={() => setCreating(false)}
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
          pad="roomy"
          className="flex h-full min-h-[260px] flex-col gap-4 transition-all group-hover:-translate-y-0.5 group-hover:border-primary group-hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-3">
            <span
              className={cn(
                "grid size-12 shrink-0 place-items-center rounded-control",
                SURVEY_TONE_BG[meta.tone],
              )}
              aria-hidden="true"
            >
              <meta.Icon size={22} />
            </span>

            <div className="flex flex-wrap justify-end gap-1.5">
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
          The footer sits on a hairline and carries the three facts a teacher
          scans a list of surveys for: who it asks, how long it is, and when it
          last moved.
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
              {SCOPE_LABEL[survey.scope]}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ListChecks size={14} aria-hidden="true" />
              {questionCount} асуулт
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5 tabular-nums">
              {formatDate(date)}
              <ChevronRight
                size={16}
                className="text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                aria-hidden="true"
              />
            </span>
          </div>
        </Card>
      </Link>
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
  onClose,
}: {
  kindergartenId: string;
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
  const [kind, setKind] = useState<SurveyKind>("POLL");
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Шинэ судалгаа"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4"
    >
      <div className="w-full max-w-[480px] rounded-card border border-border bg-surface p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!create.isPending) create.mutate();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <h2 className="text-title font-semibold text-ink">Шинэ судалгаа</h2>

          <FormError message={create.isError ? errorMessage(create.error) : null} />

          {/*
            ★ The two kinds, as a radio group drawn like tabs.

            Tabs in appearance because that is the client's drawing, but
            `role="radiogroup"` underneath: these two choose *what is being
            created* rather than switching between two views of one thing, and
            a screen reader announcing "tab" for a permanent property of the
            survey would describe the wrong control.
          */}
          <fieldset>
            <legend className="mb-2 text-body font-medium text-ink">Төрөл</legend>
            <div className="grid grid-cols-2 gap-2">
              {SURVEY_KINDS.map((value) => (
                <label
                  key={value}
                  className={cn(
                    "cursor-pointer rounded-card border px-3 py-2.5 transition-colors",
                    kind === value
                      ? "border-primary bg-primary-soft"
                      : "border-border hover:bg-canvas",
                  )}
                >
                  <input
                    type="radio"
                    name="survey-kind"
                    value={value}
                    checked={kind === value}
                    onChange={() => setKind(value)}
                    className="sr-only"
                  />
                  <span
                    className={cn(
                      "block text-body font-semibold",
                      kind === value ? "text-primary" : "text-ink",
                    )}
                  >
                    {SURVEY_KIND_LABEL[value]}
                  </span>
                  <span className="block text-caption text-muted">{SURVEY_KIND_HINT[value]}</span>
                </label>
              ))}
            </div>
          </fieldset>

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

          {/*
            ★ Two questions, not one — and the label that used to cover both
            now covers the one it was actually about.

            "Хэнд зориулагдсан" named the *scope* control, which chooses how
            many times one family answers. That is a real question and it is
            not the one the client meant by the words: they meant the audience —
            "бүх бүлэг эсвэл бүлэг сонгох". Both are here now, in that order,
            each with the label that describes it.
          */}
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

          <Field
            label="Хариулах хэлбэр"
            hint="Хүүхэд тус бүрээр гэвэл эцэг эх хүүхдийнхээ нэрээр хариулна."
          >
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

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Үүсгэж байна…" : "Үргэлжлүүлэх"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>
              Болих
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

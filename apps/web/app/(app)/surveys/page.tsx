"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { ListChecks, Plus, Search, Users } from "lucide-react";
import {
  SURVEY_KIND_HINT,
  SURVEY_KIND_LABEL,
  groupListItemSchema,
  paginated,
  surveyKindSchema,
  surveySchema,
  type SurveyKind,
  type SurveyQuestionType,
} from "@kinder/contracts";

/** The two kinds in the order the client's drawing puts them: Пол, then Форм. */
const SURVEY_KINDS = surveyKindSchema.options;
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FilterChip, FilterChipRow } from "@/components/ui/filter-chip";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { formatDate } from "@/lib/format";
import { SURVEY_TONE_BG, SURVEY_TYPE_META } from "@/lib/survey-meta";
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
  const [tab, setTab] = useState<"active" | "closed">("active");
  /**
   * ★ Filtered by question type, not by a subject taxonomy.
   *
   * The client's mock-up draws Эрүүл мэнд / Бие бялдар / Оюун ухаан chips here,
   * and there is no field behind them: `surveySchema` carries a scope, a status,
   * a school year and an assessment period, and nothing that names a subject.
   * Inventing one would mean either a column nobody fills or a chip row that
   * filters on a guess. The type of a survey's first question is the taxonomy
   * this product actually has — `SURVEY_TYPE_META` already renders it as chips
   * on the parent's own list — so the row is built from that and the two lists
   * keep one vocabulary.
   */
  const [type, setType] = useState<SurveyQuestionType | null>(null);
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
      (!type || (survey.questions[0]?.type ?? "TEXT") === type) &&
      (!term ||
        survey.title.toLowerCase().includes(term) ||
        (survey.description ?? "").toLowerCase().includes(term)),
  );

  /** The tab counts, which the filters above must not change — see `TabPill`. */
  const countFor = (key: "active" | "closed") =>
    all.filter((s) => TABS.find((t) => t.key === key)!.statuses.includes(s.status)).length;

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Судалгаа"
        lede="Гэр бүлээс санал асуулга авах."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={18} aria-hidden="true" />
            Санал асуулга үүсгэх
          </Button>
        }
      />

      {/*
        ★ Search on its own row, chips on theirs — at every width.

        They shared a row from `lg` up in the first pass and it measured badly:
        six chips need about 900px, so beside a 320px field they wrapped, and
        the field sat vertically centred against a two-line block with a gap the
        width of a card between them. Stacked, the field is capped where a
        two-word query needs it and the chips get a full row to fit on one line.
      */}
      <div className="relative lg:w-[320px]">
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
          className="pl-11"
        />
      </div>

      {/*
        `overflow-x-auto` on a phone, wrapping from `lg`: six chips do not fit a
        375px row, and a horizontal scroller is how the rest of this product
        already handles that (`SurveysTab`'s child switcher). The negative
        margin lets the scroller bleed to the screen edge so a half-visible chip
        reads as "there is more", rather than stopping short inside the page
        padding where it reads as the end of the row.
      */}
      <FilterChipRow label="Судалгааны төрлөөр шүүх">
        <FilterChip active={type === null} onClick={() => setType(null)}>
          Бүгд
        </FilterChip>
        {(Object.keys(SURVEY_TYPE_META) as SurveyQuestionType[]).map((key) => (
          <FilterChip key={key} active={type === key} onClick={() => setType(key)}>
            {SURVEY_TYPE_META[key].label}
          </FilterChip>
        ))}
      </FilterChipRow>

      {/*
        An underlined tab strip rather than a second row of pills: the chips
        above are already pills, and two pill rows in a column read as ten
        equal filters instead of "which set, then narrowed how".
      */}
      <div
        role="tablist"
        aria-label="Судалгааны төлөв"
        className="flex gap-6 border-b border-border"
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
                setType(null);
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
        // `-mb-px` pulls the underline onto the container's own hairline so the
        // two are one line rather than two a pixel apart.
        "-mb-px min-h-[44px] border-b-2 px-1 text-lead font-semibold transition-colors",
        active ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink",
      )}
    >
      {children}
      <span className="ml-2 text-body font-medium tabular-nums text-faint">{count}</span>
    </button>
  );
}

/**
 * A survey, as a card.
 *
 * ★ Replaces a 64px row carrying a title, a scope and a status badge.
 *
 * Everything on it comes from `surveySchema` — the type chip from
 * `questions[0].type` (see `lib/survey-meta.ts` for why a survey's first
 * question is an honest stand-in for its kind), the question count from
 * `questions.length`, and the date from whichever of `closedAt` /
 * `publishedAt` / `createdAt` describes the state it is in. Nothing here is a
 * field the API does not send.
 *
 * `h-full` so a card in a grid row fills the height its tallest neighbour
 * sets, which is what keeps the footers of a row on one line.
 */
function SurveyCard({ survey }: { survey: z.infer<typeof surveySchema> }) {
  const meta = SURVEY_TYPE_META[survey.questions[0]?.type ?? "TEXT"];
  const questionCount = survey.questions.length;
  const date = survey.closedAt ?? survey.publishedAt ?? survey.createdAt;

  return (
    <Link href={`/surveys/${survey.id}`} className="group h-full">
      <Card
        pad="roomy"
        className="flex h-full flex-col gap-3 transition-colors hover:border-primary"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-caption font-semibold",
              SURVEY_TONE_BG[meta.tone],
            )}
          >
            <meta.Icon size={14} aria-hidden="true" />
            {meta.label}
          </span>
          <Badge tone={STATUS_TONE[survey.status]}>{STATUS_LABEL[survey.status]}</Badge>
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-lead font-semibold leading-[1.35] text-ink group-hover:underline">
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
          <span className="ml-auto tabular-nums">{formatDate(date)}</span>
        </div>
      </Card>
    </Link>
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

          {/*
            ★ Two questions, not one — and the label that used to cover both
            now covers the one it was actually about.

            "Хэнд зориулагдсан" named the *scope* control, which chooses how
            many times one family answers. That is a real question and it is
            not the one the client meant by the words: they meant the audience —
            "бүх бүлэг эсвэл бүлэг сонгох". Both are here now, in that order,
            each with the label that describes it.
          */}
          <Field
            label="Хэнд зориулагдсан"
            hint="Сонгосон бүлгийн эцэг эхэд л харагдана."
          >
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

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { Copy, FileSpreadsheet, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import {
  groupListItemSchema,
  paginated,
  SURVEY_PERIOD_LABEL,
  SURVEY_RESPONDENT_LABEL,
  surveyPeriodSchema,
  surveySchema,
  type SurveyPeriod,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { downloadUrl } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { RequireRole } from "@/components/shell/require-role";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { RowMenu } from "@/components/ui/menu";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { PeriodFilter } from "@/components/survey/period-buttons";
import { SearchField } from "@/components/ui/search-field";
import {
  AdministrationSurveysCard,
  GroupLinkRow,
  SchoolYearSelect,
  schoolYearStart,
  schoolYearsOf,
} from "@/components/survey/survey-hub-parts";
import { CreateSurveyWizard } from "@/components/survey/create-survey-wizard";
import { canManageSurvey, staffSurveysSchema, type StaffSurvey } from "@/lib/survey-access";
import { TableShell, Td, Th } from "@/components/ui/table";
import { SURVEY_CATEGORY_META } from "@/lib/survey-meta";
import { formatDate, shortName } from "@/lib/format";
import { cn } from "@/lib/utils";

const groupsSchema = paginated(groupListItemSchema);

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Ноорог",
  PUBLISHED: "Идэвхтэй",
  CLOSED: "Дууссан",
};

const STATUS_PILL: Record<string, string> = {
  DRAFT: "bg-sunken text-muted",
  PUBLISHED: "bg-primary-soft text-primary",
  CLOSED: "bg-mint text-mint-ink",
};

/**
 * Багшийн судалгаа — client, 2026-09-21.
 *
 * ★ Laid out as the families' hub is: the same four wave buttons (Бүгд ·
 * Гарааны · Явцын · Үр дүнгийн), kept in the URL for the same reason — the
 * back arrow from a survey returns to the list it was opened from. What
 * differs is the answerer: every survey here is filled in by the teacher, one
 * child at a time, from the survey's own page.
 */
export default function TeacherSurveysPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      {/* `Suspense` because the page reads `?period=` through `useSearchParams`. */}
      <Suspense fallback={<LoadingState rows={4} />}>
        <TeacherSurveys />
      </Suspense>
    </RequireRole>
  );
}

function TeacherSurveys() {
  const { primaryKindergartenId, hasRole, session } = useSession();
  const isAdmin = hasRole("ADMIN");
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [schoolYear, setSchoolYear] = useState(() => schoolYearStart(new Date().toISOString()));
  const router = useRouter();
  const searchParams = useSearchParams();
  const period = surveyPeriodSchema.safeParse(searchParams.get("period")).data ?? null;
  /*
    ★ A director reads teacher surveys by group — client, 2026-09-25: no
    create card, the groups first, and a group's surveys once one is pressed.
    The group is in the URL beside the wave, so the back arrow from a survey
    returns to the same group's list.
  */
  const groupId = isAdmin ? searchParams.get("group") : null;
  const hrefFor = (next: { period?: SurveyPeriod | null; group?: string | null }) => {
    const params = new URLSearchParams();
    const g = next.group === undefined ? groupId : next.group;
    const p = next.period === undefined ? period : next.period;
    if (g) params.set("group", g);
    if (p) params.set("period", p);
    const query = params.toString();
    return query ? `/surveys/teacher?${query}` : "/surveys/teacher";
  };
  const selectPeriod = (next: SurveyPeriod | null) =>
    router.replace(hrefFor({ period: next }), { scroll: false });

  const groups = useQuery({
    queryKey: qk.groups({ pageSize: 100 }),
    queryFn: () => get("/groups?page=1&pageSize=100", groupsSchema),
    enabled: isAdmin,
    staleTime: 60_000,
  });
  const selectedGroup = groups.data?.items.find((group) => group.id === groupId);

  // The same key and request as every other survey list — one bounded read.
  const surveys = useQuery({
    queryKey: qk.kindergartenSurveys(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/surveys`, staffSurveysSchema),
    enabled: Boolean(primaryKindergartenId),
  });

  const mine = (surveys.data ?? []).filter(
    (survey) =>
      survey.respondent === "TEACHER" && canManageSurvey(survey, session?.user.id, isAdmin),
  );
  const schoolYears = schoolYearsOf(mine);
  const inYear = mine.filter((survey) => schoolYearStart(survey.createdAt) === schoolYear);
  const inScope = groupId ? inYear.filter((survey) => survey.groupId === groupId) : inYear;
  const searchTerm = search.trim().toLowerCase();
  const visible = (period ? inScope.filter((survey) => survey.period === period) : inScope).filter(
    (survey) =>
      !searchTerm ||
      survey.title.toLowerCase().includes(searchTerm) ||
      (survey.description ?? "").toLowerCase().includes(searchTerm),
  );
  const emptyTitle = period
    ? `${SURVEY_PERIOD_LABEL[period]} алга`
    : `${SURVEY_RESPONDENT_LABEL.TEACHER} алга`;

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      {/*
        ★ The families' hub, drawn for the teacher — client, 2026-09-25: "одоо
        багшийн хэсгийг яг энэ загвараар". Title and school year, the card that
        starts a survey, the four waves, the administration's card, the list.

        One card where the families' hub has two: a teacher survey is always a
        Судалгаа — the API refuses a teacher Асуулга (`SurveysService.create`:
        a poll is a family's one-tap vote) — so an Асуулга card here would be a
        door onto an error. The card opens the create wizard, where "Шинэ" did.
      */}
      <header className="flex items-center gap-2 !bg-transparent !backdrop-blur-none sm:gap-3">
        <BackButton href={groupId ? hrefFor({ group: null, period: null }) : "/surveys"} />
        <h1 className="min-w-0 flex-1 text-lead font-semibold leading-heading text-ink sm:text-title">
          {groupId
            ? (selectedGroup?.name ?? SURVEY_RESPONDENT_LABEL.TEACHER)
            : SURVEY_RESPONDENT_LABEL.TEACHER}
        </h1>
        <SchoolYearSelect years={schoolYears} value={schoolYear} onChange={setSchoolYear} />
      </header>

      {isAdmin && !groupId ? (
        <section aria-labelledby="teacher-survey-groups" className="flex flex-col gap-2.5">
          <h2 id="teacher-survey-groups" className="text-title font-bold leading-heading text-ink">
            Бүлгүүд
          </h2>
          {groups.isLoading ? <LoadingState rows={3} /> : null}
          {groups.isError ? <ErrorState description={errorMessage(groups.error)} /> : null}
          {groups.data && groups.data.items.length === 0 ? (
            <EmptyState title="Бүлэг алга" description="Судалгаа харахын өмнө бүлэг үүсгэнэ үү." />
          ) : null}
          {(groups.data?.items ?? []).map((group) => (
            <GroupLinkRow
              key={group.id}
              href={hrefFor({ group: group.id, period: null })}
              name={group.name}
              meta={`${inYear.filter((survey) => survey.groupId === group.id).length} судалгаа`}
            />
          ))}
        </section>
      ) : null}

      {isAdmin && !groupId ? null : (
        <>
          <AdministrationSurveysCard />

          <section aria-labelledby="teacher-surveys" className="flex flex-col gap-2.5">
            {/*
              ★ «Бүлгийн судалгаа» with «+ Шинэ» beside it, then search and the
              filter, then the table — the families' «Судалгаа» board's order,
              client 2026-10-04. It replaces the «Судалгаа үүсгэх» card and the
              «Сүүлийн үүсгэсэн» heading; the wave chosen shows on the filter's
              count, as it does there.
            */}
            <div className="flex items-center gap-3">
              <h2
                id="teacher-surveys"
                className="min-w-0 flex-1 text-title font-semibold leading-heading text-ink"
              >
                Бүлгийн судалгаа
              </h2>
              {isAdmin ? null : (
                <Button className="shrink-0" onClick={() => setCreating(true)}>
                  <Plus size={18} aria-hidden="true" />
                  Шинэ
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <SearchField
                label="Судалгаа хайх"
                placeholder="Судалгаа хайх..."
                value={search}
                onChange={setSearch}
              />
              <PeriodFilter selected={period} onSelect={selectPeriod} />
            </div>

            {surveys.isLoading ? <LoadingState rows={3} /> : null}
            {surveys.isError ? <ErrorState description={errorMessage(surveys.error)} /> : null}

            {surveys.data && visible.length === 0 ? (
              <EmptyState
                title={emptyTitle}
                description={
                  isAdmin
                    ? "Энэ бүлгийн багш одоогоор судалгаа аваагүй байна."
                    : "«+ Шинэ» дээр дарж судалгаа үүсгээд, бүлгийнхээ хүүхэд бүрээр бөглөнө үү."
                }
              />
            ) : null}

            {/*
              ★ A table, the same columns as the families' «Судалгаа» — client,
              2026-10-04. Plus Төлөв: this screen has no Идэвхтэй/Ноорог tabs,
              so a draft would otherwise look like a published survey.
            */}
            {visible.length > 0 ? (
              <TableShell caption="Багшийн судалгаа" minWidth="min-w-[960px]">
                <thead>
                  <tr>
                    <Th>Гарчиг</Th>
                    <Th>Бүлэг</Th>
                    <Th>Ангилал</Th>
                    <Th>Судалгаа авсан</Th>
                    <Th>Төлөв</Th>
                    <Th numeric>Хариулт</Th>
                    <Th numeric>Хувь</Th>
                    <Th numeric>Огноо</Th>
                    <Th>
                      <span className="sr-only">Үйлдэл</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((survey) => (
                    <TeacherSurveyRow key={survey.id} survey={survey} />
                  ))}
                </tbody>
              </TableShell>
            ) : null}
          </section>
        </>
      )}

      {creating && primaryKindergartenId ? (
        <CreateSurveyWizard
          kindergartenId={primaryKindergartenId}
          kind="FORM"
          respondent="TEACHER"
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * One teacher survey — the hub's row (`SurveyListRow`), with the teacher's own
 * to-do in its empty corner: the group, how many of its children are filled
 * in, and whether the survey is finished. The ⋯ keeps Засах · Эксэл татах ·
 * Дахин ашиглах · Устгах (client, 2026-09-22).
 */
function TeacherSurveyRow({ survey }: { survey: StaffSurvey }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { primaryKindergartenId } = useSession();
  const [confirmDelete, setConfirmDelete] = useState(false);

  /*
    Дахин ашиглах and Устгах — the same two calls the families' card makes
    (`survey-board.tsx`), client 2026-09-22. A clone of a teacher survey stays
    a teacher survey: the API copies `respondent`.
  */
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
      void queryClient.invalidateQueries({
        queryKey: qk.kindergartenSurveys(primaryKindergartenId ?? ""),
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const filled = survey.respondedCount ?? 0;
  const expected = survey.expectedCount ?? 0;

  const percent = expected > 0 ? Math.round((filled / expected) * 100) : 0;

  return (
    <tr>
      <Td>
        <Link
          href={`/surveys/${survey.id}`}
          className="font-medium text-ink hover:text-primary hover:underline"
        >
          {survey.title}
        </Link>
      </Td>
      <Td className="text-muted">{survey.group?.name ?? (survey.groupId ? "—" : "Бүх бүлэг")}</Td>
      <Td className="text-muted">{SURVEY_CATEGORY_META[survey.category].label}</Td>
      <Td className="whitespace-nowrap text-muted">
        {survey.author ? `Бүлгийн багш · ${shortName(survey.author)}` : "Бүлгийн багш"}
      </Td>
      <Td>
        <span
          className={cn(
            "whitespace-nowrap rounded-pill px-2 py-0.5 text-caption font-semibold",
            STATUS_PILL[survey.status],
          )}
        >
          {STATUS_LABEL[survey.status]}
        </span>
      </Td>
      <Td numeric className="text-muted">
        {survey.status === "DRAFT" ? "—" : `${filled} / ${expected}`}
      </Td>
      <Td numeric className="font-medium text-ink">
        {survey.status === "DRAFT" ? "—" : `${percent}%`}
      </Td>
      <Td numeric className="text-muted">
        {formatDate(survey.closedAt ?? survey.publishedAt ?? survey.createdAt)}
      </Td>
      <Td className="w-12 text-right">
        <RowMenu
          ariaLabel={`${survey.title} үйлдэл`}
          triggerIcon={<MoreVertical size={18} aria-hidden="true" />}
          items={[
            {
              label: "Засах",
              icon: <Pencil size={16} aria-hidden="true" />,
              onSelect: () => router.push(`/surveys/${survey.id}`),
            },
            {
              label: "Эксэл татах",
              icon: <FileSpreadsheet size={16} aria-hidden="true" />,
              onSelect: () => {
                window.location.href = downloadUrl(`/surveys/${survey.id}/export`);
              },
            },
            {
              label: "Дахин ашиглах",
              icon: <Copy size={16} aria-hidden="true" />,
              hint: "Асуултуудыг хуулж шинэ ноорог үүсгэнэ",
              onSelect: () => clone.mutate(),
            },
            {
              label: "Устгах",
              icon: <Trash2 size={16} aria-hidden="true" />,
              tone: "danger",
              separated: true,
              onSelect: () => setConfirmDelete(true),
            },
          ]}
        />
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
      </Td>
    </tr>
  );
}

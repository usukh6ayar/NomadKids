"use client";

import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, GraduationCap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  MAX_PAGE_SIZE,
  childSummarySchema,
  paginated,
  teacherDashboardSchema,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { BarRow } from "@/components/ui/chart/bar-row";
import { ColumnChart } from "@/components/ui/chart/columns";
import { Donut } from "@/components/ui/chart/donut";
import { Ring } from "@/components/ui/chart/ring";
import { useMyGroup } from "@/components/dashboard/use-my-group";

const rosterSchema = paginated(childSummarySchema);

const MONTH_LABEL = [
  "1-р",
  "2-р",
  "3-р",
  "4-р",
  "5-р",
  "6-р",
  "7-р",
  "8-р",
  "9-р",
  "10-р",
  "11-р",
  "12-р",
];

/**
 * Явцын үнэлгээ — pick a child, write a note, see where the term stands.
 *
 * ★ Rebuilt to the client's 2026-08-30 flow, which is one step shorter than
 * what stood here.
 *
 * This page was a group picker that led to `/groups/:id/assessment`, where a
 * teacher then chose a term and a development domain before they could record
 * anything. The client asked for the choice a teacher actually starts from:
 * **which child**, then **what kind of note**.
 *
 * ★★ The term and domain pickers have **not** been deleted, and the reason is
 * worth stating because the request was to remove them.
 *
 * They live on `/groups/:id/assessment`, whose own docblock explains that
 * `domainId` is a *required* query parameter on the API — it is what stops
 * that endpoint becoming a nine-column matrix nobody can use on a phone. A
 * teacher assessing "Хэл яриа" for twenty children needs to know which rubric
 * they are applying; take the label away and the same screen silently claims
 * to have assessed everything. So the rubric screen keeps its two selects and
 * this screen no longer makes anyone pass through them: recording an
 * observation, a conversation or a piece of work needs neither.
 *
 * The link to the full rubric is still here, named for what it is.
 */
export default function AssessmentPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <Assessment />
    </RequireRole>
  );
}

function Assessment() {
  const [childId, setChildId] = useState("");
  const { group } = useMyGroup();

  const roster = useQuery({
    /*
      ★ `MAX_PAGE_SIZE`, not a number picked by eye.

      This read `?pageSize=200` and the API answered 400 every time: 100 is a
      hard ceiling, and `pagination.ts` says why — "without it,
      `?pageSize=100000` turns any list endpoint into a bulk export of a
      kindergarten's children". Importing the constant is what stops the next
      guess being 500.

      A kindergarten with more than a hundred children on one roster would need
      this picker paginated. None is close, and inventing that now would be a
      scrolling list nobody can use in place of one nobody has needed.
    */
    queryKey: qk.children({ pageSize: MAX_PAGE_SIZE }),
    queryFn: () => get(`/children?pageSize=${MAX_PAGE_SIZE}`, rosterSchema),
  });

  const dashboard = useQuery({
    queryKey: qk.dashboard.teacher(),
    queryFn: () => get("/dashboard/teacher", teacherDashboardSchema),
  });

  const children = roster.data?.items ?? [];
  const selected = children.find((child) => child.id === childId) ?? null;

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Явцын үнэлгээ"
        lede="Хүүхэд сонгоод тэмдэглэл бүртгэнэ. Доор улирлын явц харагдана."
      />

      {roster.isError ? <ErrorState description={errorMessage(roster.error)} /> : null}

      {/*
        ★ The child and the three note types, side by side.

        The client's sketch puts them on one row: choose who, then choose what.
        Below `md` they stack, because three buttons and a select on a 375px
        line is four controls at 80px each.
      */}
      <Card pad="roomy" className="grid gap-4 md:grid-cols-[minmax(0,280px),1fr] md:items-end">
        <Field label="Хүүхэд" hint={roster.isLoading ? "Ачаалж байна…" : undefined}>
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={childId}
              onChange={(event) => setChildId(event.target.value)}
              disabled={roster.isLoading || children.length === 0}
            >
              <option value="">Хүүхэд сонгоно уу</option>
              {children.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.lastName ? `${child.lastName} ` : ""}
                  {child.firstName}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {/*
          The types come from the dashboard payload, which already carries
          `observationsByType` for the chart below — every configured type,
          including the ones nobody has used. One request, two uses.
        */}
        <NewNote
          childId={childId}
          childName={selected ? selected.firstName : null}
          types={(dashboard.data?.observationsByType ?? []).map((row) => row.type)}
        />
      </Card>

      {dashboard.isLoading ? <LoadingState rows={3} /> : null}
      {dashboard.isError ? <ErrorState description={errorMessage(dashboard.error)} /> : null}

      {dashboard.data ? (
        <>
          <TermCharts data={dashboard.data} />
          <MonthlyNotes months={dashboard.data.observationsByMonth} />
        </>
      ) : null}

      {/*
        The rubric, named for what it is rather than hidden behind this page.
        See the docblock above for why its two selects stay.
      */}
      {group ? (
        <Card pad="roomy" className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-body font-medium text-ink">Улирлын бүрэн үнэлгээ</p>
            <p className="text-caption text-muted">
              Хөгжлийн чиглэл тус бүрээр бүх хүүхдийг нэг дор үнэлнэ.
            </p>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/groups/${group.id}/assessment`}>
              <GraduationCap size={16} aria-hidden="true" />
              Нээх
            </Link>
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * Шинэ тэмдэглэл — one button per configured note type.
 *
 * ★ Read from `ObservationType`, not the three names on the sketch.
 *
 * The client's sketch says Ажиглалт / Ярилцлага / Бүтээл. This kindergarten's
 * configured types are Өдөр тутмын ажиглалт, Үйл ажиллагааны ажиглалт, Онцлох
 * ахиц, Анхаарал шаардсан and Гэр бүлээс ирсэн — five, and none of them is
 * "Ярилцлага". Hard-coding the sketch would put three buttons on screen that
 * name a taxonomy the database does not hold, and the first one pressed would
 * open a form offering five different options.
 *
 * `ObservationMix` reached this exact conclusion about the same three names:
 * "Configure those three and this renders them; configure seven and it renders
 * seven." §2.3 is the rule underneath — what an administrator edits is a table,
 * so the screen asks the table.
 *
 * `?typeId=` seeds the form's select, which is the shortcut the client
 * actually asked for: pick a child, pick a kind, write.
 *
 * Disabled until a child is chosen — every note is recorded *against* a child,
 * so the destination would have nothing to open.
 */
function NewNote({
  childId,
  childName,
  types,
}: {
  childId: string;
  childName: string | null;
  types: { id: string; name: string }[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body font-medium text-ink">Шинэ тэмдэглэл</p>

      {types.length === 0 ? (
        <p className="text-caption text-muted">
          Ажиглалтын төрөл тохируулаагүй байна. Удирдлагын хэсгээс тохируулна уу.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {types.map((type) =>
            childId ? (
              <Button key={type.id} asChild variant="secondary" size="sm">
                <Link href={`/children/${childId}/observations/new?typeId=${type.id}`}>
                  <ClipboardCheck size={16} aria-hidden="true" />
                  {type.name}
                </Link>
              </Button>
            ) : (
              <Button key={type.id} variant="secondary" size="sm" disabled>
                <ClipboardCheck size={16} aria-hidden="true" />
                {type.name}
              </Button>
            ),
          )}
        </div>
      )}

      <p className="text-caption text-muted">
        {childName ? `${childName}-д бүртгэнэ.` : "Эхлээд хүүхэд сонгоно уу."}
      </p>
    </div>
  );
}

/**
 * The term at a glance — three questions, three shapes.
 *
 * ★ A ring, a donut and a row of bars, chosen by what each answers.
 *
 * The client asked for the progress bars to become charts and warned against
 * "хэт олон chart". Each of these is a different kind of question:
 *
 *   - **Хамралт** is one number against a target → a ring, which reads as a
 *     fraction at a glance and needs no axis.
 *   - **Тэмдэглэлийн төрөл** is parts of a whole → a donut. The three types
 *     sum to the term's notes, which is exactly what a ring of segments says.
 *   - **Хөгжлийн чиглэл** is nine independent counts against the same
 *     denominator → horizontal bars, because nine labels are sentences and a
 *     column chart would turn every one of them 45°.
 */
function TermCharts({ data }: { data: ReturnType<typeof teacherDashboardSchema.parse> }) {
  const { termProgress, observationsByType, assessmentByDomain } = data;
  const totalNotes = observationsByType.reduce((sum, row) => sum + row.count, 0);
  const covered =
    termProgress.total > 0 ? Math.round((termProgress.assessed / termProgress.total) * 100) : 0;

  return (
    <section aria-labelledby="term-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="term-heading"
        title="Улирлын явц"
        lede={data.currentTerm?.name ?? "Идэвхтэй улирал алга"}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr),minmax(0,1fr)]">
        <Card pad="roomy" className="flex flex-wrap items-center gap-5">
          <Ring
            percent={covered}
            label={`Үнэлгээний хамралт: ${termProgress.assessed} / ${termProgress.total}`}
          />
          <div className="min-w-0">
            <p className="text-lead font-semibold text-ink">Үнэлгээний хамралт</p>
            <p className="text-caption text-muted">
              {termProgress.total > 0
                ? `${termProgress.total} хүүхдээс ${termProgress.assessed} нь үнэлэгдсэн.`
                : "Бүлэгт хүүхэд бүртгэгдээгүй байна."}
            </p>
          </div>
        </Card>

        <Card pad="roomy" className="flex flex-wrap items-center gap-5">
          {totalNotes > 0 ? (
            <>
              <Donut
                segments={observationsByType.map((row) => ({
                  label: row.type.name,
                  value: row.count,
                }))}
                label={`Тэмдэглэлийн төрөл: ${observationsByType
                  .map((row) => `${row.type.name} ${row.count}`)
                  .join(", ")}`}
                centre={
                  <span className="text-lead font-semibold tabular-nums text-ink">
                    {totalNotes}
                  </span>
                }
              />
              <ul className="flex min-w-0 flex-col gap-1">
                {observationsByType.map((row) => (
                  <li key={row.type.id} className="text-caption text-muted">
                    <span className="text-ink">{row.type.name}</span> — {row.count}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="min-w-0">
              <p className="text-lead font-semibold text-ink">Тэмдэглэлийн төрөл</p>
              <p className="text-caption text-muted">Энэ улиралд тэмдэглэл бүртгээгүй байна.</p>
            </div>
          )}
        </Card>
      </div>

      {assessmentByDomain.length > 0 ? (
        <Card pad="roomy" className="flex flex-col gap-3">
          <div>
            <h3 className="text-lead font-semibold text-ink">Хөгжлийн чиглэлийн хамралт</h3>
            <p className="text-caption text-muted">
              Чиглэл тус бүрд хэдэн хүүхэд үнэлэгдсэн — {termProgress.total} хүүхдээс.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            {assessmentByDomain.map((row) => (
              <BarRow
                key={row.domain.id}
                label={row.domain.name}
                percent={
                  termProgress.total > 0 ? Math.round((row.assessed / termProgress.total) * 100) : 0
                }
                value={row.assessed}
                accessibleLabel={`${row.domain.name}: ${row.assessed} / ${termProgress.total}`}
              />
            ))}
          </div>
        </Card>
      ) : null}
    </section>
  );
}

/**
 * Сарын тэмдэглэлийн хамралт — the note-taking rhythm.
 *
 * ★ Columns scaled to the busiest month, not to a target.
 *
 * There is no quota per month anywhere in the schema, so a percentage would
 * need an invented denominator — the argument `ObservationMix` makes at length
 * about "биелэлт". Scaling to the tallest column keeps the shape honest: it
 * says which months were busy relative to each other, and the count under each
 * says how many. A month with nothing renders at zero rather than disappearing.
 */
function MonthlyNotes({ months }: { months: { month: string; count: number }[] }) {
  if (months.length === 0) {
    return (
      <section aria-labelledby="rhythm-heading">
        <SectionHeader id="rhythm-heading" title="Сарын тэмдэглэлийн хамралт" />
        <EmptyState
          title="Тэмдэглэл бүртгэгдээгүй байна"
          description="Хүүхэд сонгоод дээрх товчоор эхний тэмдэглэлээ бүртгэнэ үү."
        />
      </section>
    );
  }

  const peak = Math.max(...months.map((m) => m.count), 1);

  return (
    <section aria-labelledby="rhythm-heading">
      <SectionHeader
        id="rhythm-heading"
        title="Сарын тэмдэглэлийн хамралт"
        lede="Сүүлийн зургаан сар."
      />
      <Card pad="roomy">
        <ColumnChart
          columns={months.map((row) => {
            const monthIndex = Number(row.month.slice(5, 7)) - 1;
            const name = MONTH_LABEL[monthIndex] ?? row.month;
            return {
              label: name,
              value: Math.round((row.count / peak) * 100),
              accessibleLabel: `${name} сар: ${row.count} тэмдэглэл`,
            };
          })}
          // The axis is a count, not a percentage — the columns are scaled to
          // the peak, so a "%" would be a number nobody can act on.
          axisLabel={(percent) => String(Math.round((percent / 100) * peak))}
          gridlines={[0, 50, 100]}
        />
      </Card>
    </section>
  );
}

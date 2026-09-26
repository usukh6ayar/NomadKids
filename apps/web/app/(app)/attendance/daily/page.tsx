"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Pencil,
  Send,
  SlidersHorizontal,
} from "lucide-react";
import { z } from "zod";
import {
  attendanceSubmissionSchema,
  dailyAttendanceSchema,
  esisAttendancePreviewSchema,
  groupListItemSchema,
  paginated,
  type DailyAttendance,
  type DailyAttendanceRow,
  type EsisAttendancePreview,
  localDate,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { downloadUrl } from "@/lib/api/client";
import { EsisPullButton } from "@/components/esis/esis-pull-button";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { AttendanceViewSwitch } from "@/components/attendance/view-switch";
import { CalendarDays } from "@/components/attendance/calendar-days";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { TableShell, Td, Th } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { SelectBox, SelectionBar, useSelection } from "@/components/ui/selection";
import { useToast } from "@/components/ui/toast";
import { SearchField } from "@/components/ui/search-field";
import { formatDate, groupLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { STATUS_COLUMN } from "@/components/attendance/status-columns";

const groupsSchema = paginated(groupListItemSchema);

/**
 * "Өдөр тутмын ирц" — the director's attendance register.
 *
 * ★ It has no buttons, and that is the whole reason it exists.
 *
 * `/groups/:id/attendance` is the teacher's day sheet: a child per row and six
 * status buttons on each, because a teacher's job there is to record. A
 * director does not press those. The client said so directly on 2026-09-04 —
 * "ерөөсөө захирал тэнд ирсэн, хагас өдөр гэх мэт тийм товчнуудыг дарахгүй,
 * цаанаасаа бүртгэлтэй тэр нь тоонууд зэрэг нь л харагдна" — and they are
 * right: a director's question is "has Дэлбээ filled in Tuesday, and what did
 * it come to", which is one row per group per day and nothing to click.
 *
 * ★★ Three attendance screens, and each answers a different question.
 *
 *   · `/groups/:id/attendance` — one group, one day, *writable*. The teacher's.
 *   · `/attendance/daily` — every group, every day, as counts. This one.
 *   · `/attendance/journal` — every child, every day, as a grid. The one an
 *     accountant opens when a figure on this screen needs explaining.
 *
 * They share `buildRegister` on the API, so no two of them can disagree about
 * what "recorded" means.
 *
 * ★★★ The columns are the client's list, in their order, with `Хичээлийн жил`
 * moved in front — a register with no school year on it cannot be filed. The
 * Excel export writes the same columns from the same `summariseDays`, so the
 * file is what is on screen.
 */
export default function DailyAttendancePage() {
  return (
    <RequireRole roles={["ADMIN", "ACCOUNTANT"]}>
      <DailyAttendance />
    </RequireRole>
  );
}

function DailyAttendance() {
  const { primaryKindergartenId, hasRole } = useSession();

  /*
   * ★ Seeded from the URL — 2026-09-06, so `AttendanceViewSwitch` can hand the
   * period over to the child-grained register and back without resetting it.
   *
   * Read once, at mount, rather than kept in sync: the filters below are the
   * authority once the screen is open, and writing every date keystroke back
   * to the URL would put a history entry behind each one.
   */
  const searchParams = useSearchParams();
  const [from, setFrom] = useState(() => searchParams.get("from") || firstOfMonth());
  const [to, setTo] = useState(() => searchParams.get("to") || today());
  const [groupId, setGroupId] = useState(() => searchParams.get("groupId") ?? "");

  const filters = useMemo(
    () => ({ from, to, ...(groupId ? { groupId } : {}) }),
    [from, to, groupId],
  );

  const queryString = useMemo(() => new URLSearchParams(filters).toString(), [filters]);

  const daily = useQuery({
    queryKey: qk.attendanceDaily(primaryKindergartenId ?? "", filters),
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}/attendance/daily?${queryString}`,
        dailyAttendanceSchema,
      ),
    enabled: Boolean(primaryKindergartenId),
    // Keeps the table on screen while a date is being changed, rather than
    // collapsing to a skeleton on every keystroke in a date field.
    placeholderData: (previous) => previous,
  });

  /*
   * `GET /groups`, not `/kindergartens/:id/groups` — the second is POST-only,
   * and the funding register records what happened when a screen assumed
   * otherwise. The key matches `useSwitchableGroups`, so this usually reads a
   * cache the shell has already filled.
   */
  const groups = useQuery({
    queryKey: qk.groups({ pageSize: 100 }),
    queryFn: () => get("/groups?page=1&pageSize=100", groupsSchema),
    enabled: Boolean(primaryKindergartenId),
    staleTime: 5 * 60_000,
  });

  const data = daily.data;

  /*
   * ★ The selection is keyed by group *and* date, not by group.
   *
   * A row is one group on one day, and the same group appears once per day in
   * the range. Keying on `groupId` alone would tick five Tuesdays when somebody
   * meant one. `useSelection` only needs the keys to be unique and stable,
   * which `groupId date` is, and it prunes to what is on screen — so changing
   * the date range clears ticks rather than submitting days nobody can see.
   */
  /*
    ★ Open by default — 2026-09-17, the client: "амралт баярын өдрүүд гэсний
    дээр байсан хэсэг яагаад алга болчив, буцаагаад нэм."

    Folding the range and the group behind Шүүлтүүр took them off the screen
    entirely, and they are what the whole page is a view *of* — a director
    lands here to read a month, and a month they cannot see the bounds of is a
    table with no caption. The button stays, as a way to put three rows away
    once the period is set.
  */
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [search, setSearch] = useState("");

  const rowKey = (row: DailyAttendanceRow) => `${row.groupId} ${row.date}`;
  const selection = useSelection((data?.items ?? []).map(rowKey));
  const appliedDeepLinkSelection = useRef(false);

  useEffect(() => {
    if (
      appliedDeepLinkSelection.current ||
      searchParams.get("select") !== "1" ||
      !data?.items.some((row) => row.complete)
    ) {
      return;
    }

    appliedDeepLinkSelection.current = true;
    for (const row of data.items) {
      if (row.complete) selection.toggle(rowKey(row));
    }
  }, [data, searchParams, selection.toggle]);
  /*
    Display only: the search narrows what the table draws and never what is
    selected or submitted. A tick that disappeared because somebody typed a
    group's name would submit a different set than the one on screen.
  */
  const term = search.trim().toLocaleLowerCase("mn-MN");
  const visibleRows = (data?.items ?? []).filter(
    (row) => !term || row.group.toLocaleLowerCase("mn-MN").includes(term),
  );

  const selectedRows = (data?.items ?? []).filter((row) => selection.has(rowKey(row)));
  const selectedEntries = selectedRows.map((row) => ({ groupId: row.groupId, date: row.date }));
  const canPreviewEsis =
    Boolean(primaryKindergartenId) &&
    selectedRows.length > 0 &&
    selectedRows.every((row) => row.complete);

  const esisPreview = useQuery({
    queryKey: ["esis", "attendance-preview", primaryKindergartenId, selectedEntries],
    queryFn: () =>
      mutate(
        `/kindergartens/${primaryKindergartenId}/attendance/daily/esis-preview`,
        esisAttendancePreviewSchema,
        { method: "POST", body: { entries: selectedEntries } },
      ),
    enabled: canPreviewEsis,
    staleTime: Infinity,
    retry: false,
  });

  const toast = useToast();
  const queryClient = useQueryClient();

  /*
   * ★ "Ирц илгээх" — what the button actually does today.
   *
   * It records the submission: who declared this register final, when, and over
   * how many children. The eventual destination is ESIS, whose transport does
   * not exist yet (`docs/ESIS_API_READINESS.md` §1 — no API documentation, no
   * signed agreement, no token), and the API attaches that call
   * to the same row when it arrives. So the button works now and gains a
   * network hop later, rather than sitting disabled until a contract is signed.
   *
   * ★★ The API refuses an incomplete register and names which groups are
   * unfinished. That message is surfaced verbatim: "Ирц бүрэн бүртгэгдээгүй
   * байна: Дэлбээ (2026-09-03)" tells a director who to chase, which a generic
   * failure toast would not.
   */
  const submit = useMutation({
    mutationFn: () => {
      const entries = (data?.items ?? [])
        .filter((row) => selection.has(rowKey(row)))
        .map((row) => ({ groupId: row.groupId, date: row.date }));

      return mutate(
        `/kindergartens/${primaryKindergartenId}/attendance/daily/submit`,
        z.array(attendanceSubmissionSchema),
        { method: "POST", body: { entries } },
      );
    },
    onSuccess: (sent) => {
      toast.success(
        esisPreview.data?.demo
          ? `${sent.length} бүртгэлийг mock client хүлээн авлаа (DEMO_SUCCESS). Production ESIS рүү илгээгээгүй.`
          : `ESIS рүү ${sent.length} бүртгэл амжилттай илгээгдлээ.`,
      );
      selection.clear();
      void queryClient.invalidateQueries({ queryKey: ["attendance", "daily"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="flex flex-col gap-4 py-2">
      {/*
        ★ "Өдөр тутмын ирц", not "Ирц" — 2026-09-04.

        The teacher's day sheet is already titled "Ирц", and two screens with
        one name is a product where "go to Ирц" means different things to
        different people. The sidebar row stays "Ирц" for both — it is the same
        job seen from two chairs — and the page says which chair you are in.
      */}
      <PageHeader
        title="Өдөр тутмын ирц"
        actions={
          <>
            {/*
             * ★ No `params` passed on purpose. `groupId` here is a NomadKids
             * uuid and ESIS keys its own `studentGroupId`; until §15's external
             * id lands, the dialog asks the operator for the ESIS number rather
             * than sending an id the ministry has never seen.
             */}
            <EsisPullButton resource="groupAttendance" label="ESIS ирц" params={{ dayDate: to }} />
            <AttendanceViewSwitch current="group" from={from} to={to} groupId={groupId} />
            {/*
              ★ In the header — 2026-09-09, at the client's request, the same
              move `/attendance/journal` got: "excel татахыг нь дээш нь
              оруулдаг ч юм уу".

              It had a `flex justify-end` row of its own under the three
              filters, which is a full-width strip holding one right-aligned
              button and a screen's width of nothing beside it. Up here it
              joins the two controls this screen already had.

              ★★ A link, not a fetch — the browser downloads it with the
              session cookie it already has, and fetching would buffer a
              spreadsheet in memory only to hand it straight back. Absent
              rather than inert when there is no kindergarten to point at:
              `disabled` does nothing to an anchor.
            */}
            {primaryKindergartenId ? (
              <Button size="sm" variant="secondary" asChild>
                <a
                  href={downloadUrl(
                    `/kindergartens/${primaryKindergartenId}/attendance/register/export?${queryString}`,
                  )}
                >
                  <Download size={16} aria-hidden /> Excel татах
                </a>
              </Button>
            ) : null}
          </>
        }
      />

      {daily.isError ? (
        <ErrorState description={errorMessage(daily.error)} />
      ) : daily.isPending ? (
        <LoadingState rows={4} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="Бүртгэл алга"
          description="Сонгосон хугацаанд идэвхтэй бүлэг олдсонгүй. Хугацаагаа өргөтгөж эсвэл бүлгийн шүүлтээ цэвэрлэж үзнэ үү."
        />
      ) : (
        <>
          {/*
            ★ Two headings, so the screen reads as two sections — 2026-09-04.

            The figures and the register ran together with nothing between
            them, which is the fault the client named on the journal ("дээд
            гарчиг шиг хэсэг ялгагдахгүй"). The first lede repeats the range
            because the table's rows are dates and the reader should not have
            to scroll back to the filter to know which.
          */}
          {/*
            ★ The graphics went **inside** the four tiles — corrected
            2026-09-06, on the client's own reading of the first attempt.

            That attempt put a percentage, a segmented bar and a legend in a
            panel *above* the tiles, which answered "make the summary a
            dashboard" by adding a dashboard next to it — a second block of
            height on the screen the same client had just asked to compress
            ("дээр нь илүү зайнд ингэж нэмэхгүй").

            A tile already has a slot for exactly this: `StatCard`'s `footer`,
            documented as "a progress bar or a sparkline, below the figure". So
            each box now carries the picture of its own number and the screen
            gains no rows at all.
          */}
          {/*
            ★ The calendar sits above the figures it changes — 2026-09-17.

            A director reading "Ирц бүртгээгүй: 46" over Наадам wants the
            holiday recorded, not an explanation of why the number is wrong.
            Folded, so it costs one row until it is needed.
          */}
          {primaryKindergartenId ? (
            <CalendarDays
              kindergartenId={primaryKindergartenId}
              from={from}
              to={to}
              canEdit={hasRole("ADMIN")}
            />
          ) : null}

          <SubmissionOverview
            rows={data.items}
            sending={submit.isPending}
            onSendReady={() => {
              selection.clear();
              for (const row of data.items) {
                if (row.complete && !row.sentAt) selection.toggle(rowKey(row));
              }
            }}
          />

          {/*
            ★ The register's own header carries its two controls — 2026-09-17,
            the client's drawing: a Шүүлтүүр button and a "Бүлэг хайх" box on
            the title's row.

            The date range and the group select were a card of their own above
            the figures, which is three permanent rows for something a director
            sets once and then reads under. Folded behind the button, they cost
            one; the search is the control they reach for on a roster of twenty
            groups and it stays out.
          */}
          <SectionHeader
            title="Өдөр тутмын бүртгэл"
            action={
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={filtersOpen ? "primary" : "secondary"}
                  aria-expanded={filtersOpen}
                  aria-controls="daily-filters"
                  onClick={() => setFiltersOpen(!filtersOpen)}
                >
                  <SlidersHorizontal size={16} aria-hidden="true" />
                  Шүүлтүүр
                </Button>

                <SearchField
                  label="Бүлэг хайх"
                  placeholder="Бүлэг хайх…"
                  value={search}
                  onChange={setSearch}
                  className="w-full sm:w-56"
                />
              </div>
            }
          />

          {/*
            ★ It opens **under its own button** — 2026-09-17, the client:
            "Өдөр тутмын бүртгэл гэсний шүүлтүүрээр гар байгааг доор нь
            харагддаг болго."

            The panel lived at the top of the page while the control that
            toggles it sits down here beside the table, so pressing Шүүлтүүр
            changed something a screen above and read as a button that does
            nothing. A disclosure belongs directly beneath the row that opens
            it.

            `grid` only while open: `display:grid` beats the user agent's
            `[hidden] { display: none }`, so the panel would never close — the
            same trap the notice board records.
          */}
          <Card pad="compact" id="daily-filters" hidden={!filtersOpen}>
            <div className={cn("gap-3 sm:grid-cols-2 lg:grid-cols-3", filtersOpen && "grid")}>
              <Field label="Эхлэх">
                {({ id }) => (
                  <Input
                    id={id}
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Дуусах">
                {({ id }) => (
                  <Input id={id} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                )}
              </Field>
              <Field label="Бүлэг">
                {({ id }) => (
                  <Select id={id} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                    <option value="">Бүх бүлэг</option>
                    {(groups.data?.items ?? []).map((group) => (
                      <option key={group.id} value={group.id}>
                        {groupLabel(group.name)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </Card>

          {visibleRows.length === 0 ? (
            <EmptyState
              title="Тохирох бүлэг олдсонгүй"
              description="Хайлтын үгээ өөрчилж эсвэл шүүлтүүрээ цэвэрлэж үзнэ үү."
            />
          ) : (
            <DailyTable
              rows={visibleRows}
              kindergartenName={data.kindergartenName}
              selection={selection}
              rowKey={rowKey}
              canEdit={hasRole("ADMIN")}
            />
          )}

          {selection.count > 0 ? (
            <EsisPayloadPreview
              rows={selectedRows}
              preview={esisPreview.data}
              loading={canPreviewEsis && esisPreview.isPending}
              error={esisPreview.isError ? errorMessage(esisPreview.error) : null}
            />
          ) : null}

          {/*
            ★ Илгээх lives in the selection bar, not in the header.
            The client asked for a button "дээрээ" — above the table — and it
            began there, disabled, because there was nothing to submit *to*.
            Now that it submits specific group-days it needs to know which, and
            a button that acts on a selection belongs beside the count of what
            is selected. The bar is sticky, so it is on screen wherever the
            reader has scrolled to.
          */}
          <SelectionBar count={selection.count} onClear={selection.clear}>
            <Button
              size="sm"
              disabled={
                submit.isPending || !canPreviewEsis || esisPreview.isPending || !esisPreview.data
              }
              onClick={() => submit.mutate()}
            >
              <Send size={16} aria-hidden />
              {submit.isPending
                ? "Илгээж байна…"
                : esisPreview.isPending
                  ? "Payload бэлтгэж байна…"
                  : "ESIS рүү илгээх"}
            </Button>
          </SelectionBar>
        </>
      )}
    </div>
  );
}

function EsisPayloadPreview({
  rows,
  preview,
  loading,
  error,
}: {
  rows: DailyAttendanceRow[];
  preview?: EsisAttendancePreview;
  loading: boolean;
  error: string | null;
}) {
  const incomplete = rows.filter((row) => !row.complete);
  const requests = preview?.requests ?? [];

  return (
    <section aria-labelledby="esis-payload-heading">
      <SectionHeader
        id="esis-payload-heading"
        title="ESIS рүү илгээх өгөгдөл"
        lede={`API-000269 · ID ${preview?.apiId ?? 171} · POST ${
          preview?.endpoint ?? "/svc/api/hub/v2/group/school/attendance/save/v3"
        }`}
        action={
          <Badge tone={error || incomplete.length ? "sun" : loading ? "sky" : "mint"}>
            {loading ? "Бэлтгэж байна" : "ESIS холбогдсон"}
          </Badge>
        }
      />

      <Card pad="roomy" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 border-b border-border-soft pb-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-control bg-sky text-sky-ink">
            <Braces size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink">
              {requests.length} хүсэлт ·{" "}
              {requests.reduce((sum, item) => sum + item.payload.attendanceList.length, 0)} хүүхэд
            </p>
            <p className="text-caption text-muted">
              {preview?.demo
                ? "Demo / Test data · production ESIS рүү илгээхгүй"
                : "Бодит ESIS холболт"}{" "}
              · илгээх хүсэлт автоматаар бэлтгэгдсэн.
            </p>
          </div>
          {error ? (
            <Badge tone="sun">Засах шаардлагатай</Badge>
          ) : incomplete.length === 0 && !loading ? (
            <Badge tone="mint">
              <CheckCircle2 size={13} aria-hidden="true" /> Бэлэн
            </Badge>
          ) : incomplete.length ? (
            <Badge tone="sun">{incomplete.length} бүрэн бус</Badge>
          ) : null}
        </div>

        {loading ? <LoadingState rows={2} shape="text" /> : null}
        {error ? <p className="text-body text-danger">{error}</p> : null}

        {requests.map(({ groupId, groupName, payload }, index) => (
          <details key={`${groupId}-${payload.dayDate}`} open={index === 0}>
            <summary className="cursor-pointer rounded-control px-2 py-2 font-medium text-ink hover:bg-sunken">
              {groupName} · {formatDate(payload.dayDate)} · {payload.attendanceList.length} хүүхэд
            </summary>

            <div className="mt-3 flex flex-col gap-3 pl-2">
              <dl className="grid gap-3 sm:grid-cols-4">
                <PayloadValue label="institutionId" value={payload.institutionId} />
                <PayloadValue label="studentGroupId" value={payload.studentGroupId} />
                <PayloadValue label="dayDate" value={payload.dayDate} />
                <PayloadValue
                  label="attendanceList"
                  value={`${payload.attendanceList.length} мөр`}
                />
              </dl>

              <TableShell
                caption={`${groupName} бүлгийн ESIS ирцийн payload`}
                minWidth="min-w-[680px]"
              >
                <thead>
                  <tr>
                    <Th>personId</Th>
                    <Th>attendReasonCode</Th>
                    <Th numeric>tardyMinutes</Th>
                    <Th>attendReasonList</Th>
                  </tr>
                </thead>
                <tbody>
                  {payload.attendanceList.map((item) => (
                    <tr key={item.personId}>
                      <Td className="font-mono text-caption">{item.personId}</Td>
                      <Td>
                        <Badge tone={reasonTone(item.attendReasonCode)}>
                          {item.attendReasonCode}
                        </Badge>
                      </Td>
                      <Td numeric>{item.tardyMinutes}</Td>
                      <Td className="font-mono text-caption">[]</Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </div>
          </details>
        ))}
      </Card>
    </section>
  );
}

function PayloadValue({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="font-mono text-caption text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-body font-medium text-ink">{value}</dd>
    </div>
  );
}

function reasonTone(
  code: EsisAttendancePreview["requests"][number]["payload"]["attendanceList"][number]["attendReasonCode"],
) {
  if (code === "PRESENT") return "mint" as const;
  if (code === "EXCUSED") return "sky" as const;
  if (code === "SICK") return "sun" as const;
  return "danger" as const;
}

/**
 * Where each group-day stands with ESIS — the client's drawing, 2026-09-17.
 *
 * ★ White, not tinted — their correction the same day: "энэ зураг шиг гэхдээ
 * өнгөтэй биш цагаан болго."
 *
 * The drawing has four filled pastel boxes; what carries the meaning in it is
 * the glyph and the figure, not the wash behind them. So each tile is the
 * product's ordinary white card with the colour kept to a 32px chip — the
 * state is still readable at a glance and the row stops being a band of paint
 * across the top of the register.
 *
 * ★★ Three states, not four.
 *
 * The drawing has "Алдаатай" and this does not draw it, because nothing in the
 * system can answer it yet: a submission either writes an `AttendanceSubmission`
 * row or the request fails where it is made and stores nothing (`submitDays`).
 * There is no record of a failed send to count, and a tile reading 0 for ever
 * says "none failed" when the truth is "nobody is keeping score". When the
 * ministry transport lands (`docs/ESIS_API_READINESS.md` §1) a failure gets a
 * row of its own and this gains the fourth tile that reads it.
 *
 * ★★★ The panel beside them names rows rather than counting them: "4 бүртгэл
 * дутуу" is not actionable and "Наран бүлэг — 2026.09.17" is. Five at most —
 * a prompt to act, not a second register.
 */
function SubmissionOverview({
  rows,
  sending,
  onSendReady,
}: {
  rows: DailyAttendanceRow[];
  sending: boolean;
  onSendReady: () => void;
}) {
  const sent = rows.filter((row) => row.sentAt);
  const ready = rows.filter((row) => row.complete && !row.sentAt);
  const incomplete = rows.filter((row) => !row.complete);
  const total = rows.length;
  const share = (count: number) => (total > 0 ? Math.round((count / total) * 100) : 0);

  /* Newest first: the day a director is asked about is today's, not March's. */
  const attention = [...incomplete].sort((x, y) => y.date.localeCompare(x.date)).slice(0, 5);

  return (
    <section aria-label="ESIS-ийн төлөв" className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_1fr]">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatusTile
          label="ESIS-д илгээсэн"
          value={sent.length}
          percent={share(sent.length)}
          tone="mint"
          icon={<CheckCircle2 size={22} aria-hidden="true" />}
        />
        <StatusTile
          label="Илгээхэд бэлэн"
          value={ready.length}
          percent={share(ready.length)}
          tone="sun"
          icon={<Clock size={22} aria-hidden="true" />}
        />
        <StatusTile
          label="Бүртгэл дутуу"
          value={incomplete.length}
          percent={share(incomplete.length)}
          tone="sky"
          icon={<FileText size={22} aria-hidden="true" />}
        />
      </div>

      <Card pad="compact" className="flex flex-col gap-2">
        {attention.length === 0 && ready.length === 0 ? (
          <p className="text-body text-muted">Бүх бүртгэл илгээгдсэн байна.</p>
        ) : null}

        <ul className="flex flex-col gap-1">
          {attention.map((row) => (
            <li
              key={`${row.groupId} ${row.date}`}
              className="flex items-center gap-1.5 text-caption text-ink"
            >
              <AlertTriangle size={14} aria-hidden="true" className="shrink-0 text-sun-ink" />
              <span className="min-w-0 truncate">
                {groupLabel(row.group)} — {formatDate(row.date)}
                <span className="text-muted"> ({row.unrecorded} хүүхэд дутуу)</span>
              </span>
            </li>
          ))}
        </ul>

        {ready.length > 0 ? (
          <>
            <p className="text-caption text-ink">
              {ready.length} бүртгэл ESIS руу илгээхэд бэлэн байна.
            </p>
            <Button size="sm" variant="secondary" disabled={sending} onClick={onSendReady}>
              <Send size={15} aria-hidden="true" />
              Бэлэн {ready.length} бүртгэлийг сонгох
            </Button>
          </>
        ) : null}
      </Card>
    </section>
  );
}

/**
 * One state of the register: a colour chip, its name, the count and the share.
 *
 * ★ The card stays white and the tone lives in the 32px chip — the client,
 * 2026-09-17: "энэ зураг шиг гэхдээ өнгөтэй биш цагаан болго". The figure is
 * `text-ink` on `--color-surface` at every state, which is the contrast the
 * pastel fills were quietly costing.
 */
function StatusTile({
  label,
  value,
  percent,
  tone,
  icon,
}: {
  label: string;
  value: number;
  percent: number;
  tone: "mint" | "sun" | "sky";
  icon: ReactNode;
}) {
  const chips = {
    mint: "bg-mint text-mint-ink",
    sun: "bg-sun text-sun-ink",
    sky: "bg-sky text-sky-ink",
  } as const;

  return (
    /*
      ★ Larger, and drawn as a card rather than a row — 2026-09-17: "бага зэрэг
      томруул, загвар орчин үеийн болго."

      The label sits above a figure at `--text-figure` with the share beside it
      in the same baseline, the chip grows to 44px so the glyph reads at a
      glance, and the whole tile lifts a step on hover. Nothing here is a
      control, so the lift is the only affordance it gets: it says the card
      belongs to the register below rather than being a static header.
    */
    <Card
      pad="roomy"
      className="flex items-start gap-3.5 transition-shadow hover:shadow-md sm:gap-4"
    >
      <span
        aria-hidden="true"
        className={cn("grid size-11 shrink-0 place-items-center rounded-card", chips[tone])}
      >
        {icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-muted">{label}</span>
        <span className="mt-1.5 flex items-baseline gap-2">
          <span className="text-figure font-bold tabular-nums leading-none tracking-tight text-ink">
            {value}
          </span>
          <span className="text-body tabular-nums text-muted">{percent}%</span>
        </span>
      </span>
    </Card>
  );
}

/**
 * The register itself — the client's fourteen columns, in their order, and
 * the three request columns the ministry's SIS register reads beside them.
 *
 * ★ `Ирц бүрэн` is a badge rather than a tick.
 *
 * "Тийм"/"Үгүй" carries the fact in a word, so it survives being read aloud, and
 * the tone repeats it in colour for the eye running down the column. A tick and
 * a blank would say the same thing only to somebody who can see both.
 *
 * ★★ Nothing here is clickable except the group, which opens that group's day
 * sheet at that date — the one place a director does need to go, when a row
 * says a register was never filled in.
 */
function DailyTable({
  rows,
  kindergartenName,
  selection,
  rowKey,
  canEdit,
}: {
  rows: DailyAttendanceRow[];
  kindergartenName: string;
  selection: ReturnType<typeof useSelection>;
  rowKey: (row: DailyAttendanceRow) => string;
  canEdit: boolean;
}) {
  return (
    <TableShell caption="Өдөр тутмын ирцийн бүртгэл" minWidth="min-w-[1620px]">
      <thead>
        <tr>
          <Th className="w-10">
            <SelectBox
              checked={selection.allSelected}
              indeterminate={selection.someSelected}
              onChange={selection.toggleAll}
              label="Бүх мөрийг сонгох"
            />
          </Th>
          <Th>Хичээлийн жил</Th>
          <Th>Сургууль, цэцэрлэг</Th>
          <Th>Анги</Th>
          <Th>Огноо</Th>
          <Th numeric>Ирц бүртгээгүй</Th>
          <Th>Ирц бүрэн</Th>
          <Th numeric>Сурагчийн тоо</Th>
          <Th numeric className={STATUS_COLUMN.present.head}>
            Ирсэн
          </Th>
          <Th numeric className={STATUS_COLUMN.excused.head}>
            Чөлөөтэй
          </Th>
          <Th numeric className={STATUS_COLUMN.sick.head}>
            Өвчтэй
          </Th>
          <Th numeric className={STATUS_COLUMN.absent.head}>
            Тасалсан
          </Th>
          <Th numeric>Хүсэлт хүлээгдэж буй</Th>
          <Th numeric>Хүсэлт зөвшөөрсөн</Th>
          <Th numeric>Хүсэлт татгалзсан</Th>
          <Th>Илгээсэн</Th>
          <Th>Илгээсэн хэрэглэгч</Th>
          <Th>Үүссэн</Th>
          <Th>Үүсгэсэн хэрэглэгч (Web)</Th>
          <Th>Үйлдэл</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)} className="transition-colors hover:bg-sunken">
            <Td>
              {/*
                ★ Only a complete register can be ticked.

                The API refuses an incomplete one — submitting a day with
                children still unmarked is the mistake that turns into a wrong
                funding figure — so offering the box and then rejecting the
                press would teach a director to distrust the control. The row
                still shows its "Үгүй" badge and its unrecorded count, which is
                what says *why* it cannot be sent.
              */}
              {row.complete ? (
                <SelectBox
                  checked={selection.has(rowKey(row))}
                  onChange={() => selection.toggle(rowKey(row))}
                  label={`${groupLabel(row.group)}, ${row.date} — сонгох`}
                />
              ) : null}
            </Td>
            <Td className="whitespace-nowrap text-muted">{row.schoolYear || "—"}</Td>
            <Td className="text-muted">{kindergartenName || "—"}</Td>
            {/*
              ★ The one link on the screen, and it goes where a row that reads
              "Үгүй" sends you: that group's day sheet, on that date, where the
              register can actually be filled in. Every other cell is a figure.
            */}
            <Td className="whitespace-nowrap font-medium">
              <Link
                href={`/groups/${row.groupId}/attendance?date=${row.date}`}
                className="text-ink underline-offset-2 hover:text-primary hover:underline"
              >
                {groupLabel(row.group)}
              </Link>
            </Td>
            <Td className="whitespace-nowrap tabular-nums text-muted">{formatDate(row.date)}</Td>
            <Td numeric className={row.unrecorded > 0 ? "font-semibold text-ink" : "text-muted"}>
              {row.unrecorded}
            </Td>
            <Td>
              <Badge tone={row.complete ? "mint" : "sun"}>{row.complete ? "Тийм" : "Үгүй"}</Badge>
            </Td>
            <Td numeric className="text-muted">
              {row.expected}
            </Td>
            <Td numeric className={cn("font-semibold", STATUS_COLUMN.present.value)}>
              {row.present}
            </Td>
            <Td numeric className={row.excused > 0 ? STATUS_COLUMN.excused.value : "text-muted"}>
              {row.excused}
            </Td>
            <Td numeric className={row.sick > 0 ? STATUS_COLUMN.sick.value : "text-muted"}>
              {row.sick}
            </Td>
            <Td numeric className={row.absent > 0 ? STATUS_COLUMN.absent.value : "text-muted"}>
              {row.absent}
            </Td>
            {/*
              ★ Guardians' requests on the day's own row — 2026-09-26, after
              the ministry SIS register, which reads them beside the counts.
              A pending one is the figure that asks for something, so it is the
              one drawn in ink; the other two are history.
            */}
            <Td
              numeric
              className={row.requests.pending > 0 ? "font-semibold text-ink" : "text-muted"}
            >
              {row.requests.pending}
            </Td>
            <Td numeric className="text-muted">
              {row.requests.approved}
            </Td>
            <Td numeric className="text-muted">
              {row.requests.rejected}
            </Td>
            <Td className="whitespace-nowrap text-muted">
              {row.sentAt ? formatStamp(row.sentAt) : "—"}
            </Td>
            <Td className="text-muted">{row.sentBy ?? "—"}</Td>
            <Td className="whitespace-nowrap tabular-nums text-muted">
              {row.createdAt ? formatStamp(row.createdAt) : "—"}
            </Td>
            <Td className="text-muted">
              {row.createdBy.length > 0 ? row.createdBy.join(", ") : "—"}
            </Td>
            <Td>
              {canEdit ? (
                <Button size="sm" variant="ghost" asChild>
                  <Link href={`/groups/${row.groupId}/attendance?date=${row.date}&edit=1`}>
                    <Pencil size={16} aria-hidden /> Засах
                  </Link>
                </Button>
              ) : (
                "—"
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

/** `YYYY-MM-DD HH:mm` — the same UTC stamp the exported file writes. */
function formatStamp(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function today(): string {
  return localDate();
}

function firstOfMonth(): string {
  return `${localDate().slice(0, 7)}-01`;
}

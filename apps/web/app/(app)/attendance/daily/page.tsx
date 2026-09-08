"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Braces, CheckCircle2, Download, Pencil, Send } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { StatBar, StatCard } from "@/components/ui/stat-card";
import { TableShell, Td, Th } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { SelectBox, SelectionBar, useSelection } from "@/components/ui/selection";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";

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
          </>
        }
      />

      <Card pad="roomy" className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Эхлэх">
            {({ id }) => (
              <Input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
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
                    {group.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {/*
            ★ A link, not a fetch — the browser downloads it with the session
            cookie it already has, and fetching would buffer a spreadsheet in
            memory only to hand it straight back. Absent rather than inert when
            there is no kindergarten to point at: `disabled` does nothing to an
            anchor.
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
        </div>
      </Card>

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
          <SectionHeader
            title="Хугацааны дүн"
            lede={`${formatDate(data.from)} — ${formatDate(data.to)} · ${data.items.length} бүлэг-өдөр`}
          />
          <Totals totals={data.totals} />

          <SectionHeader
            title="Өдөр тутмын бүртгэл"
            lede="Бүлэг тус бүрийн өдрийн дүн. Бүрэн бүртгэгдсэн мөрийг сонгож илгээнэ."
          />
          <DailyTable
            rows={data.items}
            kindergartenName={data.kindergartenName}
            selection={selection}
            rowKey={rowKey}
            canEdit={hasRole("ADMIN")}
          />

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
            {loading ? "Бэлтгэж байна" : preview?.demo ? "MOCK · холболтгүй" : "ESIS холбогдсон"}
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
                : "Бодит ESIS холболт"} · илгээх хүсэлт автоматаар бэлтгэгдсэн.
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
 * The period's figures, above the register they are the sum of.
 *
 * ★ Every tile carries its own graphic, in `StatCard`'s `footer` slot.
 *
 * The first attempt at "хугацааны дүнг dashboard-той болгох" drew one big
 * chart above these four boxes. The client's correction was that the picture
 * belongs *in* the boxes — "энэ дотор box-нд нь dashboard-ийг нь нэмэх" — and
 * they are right about the shape as well as the height: a bar under a figure
 * is that figure explained, where a chart beside four figures is a fifth thing
 * to read and to reconcile with the other four.
 *
 * Each footer answers the question its own number raises:
 *
 *   · Ирц бүртгээгүй — how much of the period is filled in at all.
 *   · Нийт хүүхэд-өдөр — what those child-days were spent as, in four colours.
 *   · Ирсэн — the attendance rate, which is the one figure a director quotes.
 *   · Илгээсэн — how much of the register has been declared final.
 *
 * ★★ "Ирц бүртгээгүй" is still the only one that changes tone.
 *
 * The other numbers are context; this one is a to-do list. A director opening
 * this screen at nine in the morning is asking which groups have not filled in
 * today, and a figure in the same grey as the rest makes them read four cards
 * to find the one that needs them.
 */
function Totals({ totals: t }: { totals: DailyAttendance["totals"] }) {
  /*
    Everything below divides by the marks that **exist**, never by `expected`.

    A term whose last week has not been filled in yet would otherwise read as a
    collapse in attendance rather than as a register somebody has to finish —
    and "how much is unfilled" already has a tile of its own, one column to the
    left.
  */
  const marked = t.present + t.excused + t.sick + t.absent;
  const rate = marked > 0 ? Math.round((t.present / marked) * 100) : 0;
  const filled = t.days > 0 ? (t.complete / t.days) * 100 : 0;
  const sent = t.days > 0 ? (t.sent / t.days) * 100 : 0;

  return (
    <section aria-label="Хугацааны дүн" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label="Ирц бүртгээгүй"
        value={t.unrecorded}
        unit={`${t.complete} / ${t.days} өдөр бүрэн`}
        tone={t.unrecorded > 0 ? "sun" : "mint"}
        footer={<StatBar percent={filled} label="Бүрэн бүртгэсэн хувь" />}
      />
      <StatCard
        label="Нийт хүүхэд-өдөр"
        value={t.expected}
        unit={`${marked} нь бүртгэгдсэн`}
        tone="sky"
        footer={<StatusBar totals={t} marked={marked} />}
      />
      <StatCard
        label="Ирсэн"
        value={t.present}
        unit={`Ирцийн хувь ${rate}%`}
        tone="mint"
        footer={<StatBar percent={rate} label="Ирцийн хувь" />}
      />
      <StatCard
        label="Илгээсэн"
        value={t.sent}
        unit={`${t.days} өдрөөс`}
        tone={t.sent === t.days && t.days > 0 ? "mint" : "sky"}
        footer={<StatBar percent={sent} label="Илгээсэн хувь" />}
      />
    </section>
  );
}

/**
 * What the period's child-days were spent as — one four-colour bar.
 *
 * ★ Inside the "Нийт хүүхэд-өдөр" tile, because that is the number it divides.
 *
 * `StatBar` can only draw one proportion, and this is four. It is deliberately
 * the same height and radius so the row of tiles still reads as one row: what
 * differs is that this bar is a composition rather than a fraction.
 *
 * ★★ No legend. Four labels under a 2.5px bar in a quarter-width tile is
 * unreadable at 375px, and the same four counts are already named in the
 * register's own columns directly below. The colours are the ones the day
 * sheet, the child's calendar and the journal all use, so they are learnt once;
 * `aria-label` carries the whole sentence for anyone who cannot see them, and
 * each segment's `title` names itself on hover.
 */
function StatusBar({ totals: t, marked }: { totals: DailyAttendance["totals"]; marked: number }) {
  /*
    The four statuses in the product's own stat tints — `globals.css`'s
    mint/sky/sun/peach, which every badge and register on this screen already
    uses. Not `--color-danger`: a red segment would make an ordinary absence
    read as an incident, and the tone scale here means "category", not
    "severity".
  */
  const segments = [
    { key: "present", label: "Ирсэн", value: t.present, className: "bg-mint" },
    { key: "excused", label: "Чөлөөтэй", value: t.excused, className: "bg-sky" },
    { key: "sick", label: "Өвчтэй", value: t.sick, className: "bg-sun" },
    { key: "absent", label: "Тасалсан", value: t.absent, className: "bg-peach" },
  ].filter((segment) => segment.value > 0);

  // An empty bar reads as a rendering fault; the track alone says "nothing
  // recorded yet", which is what the tile beside it also says.
  if (marked === 0 || segments.length === 0) {
    return <div className="h-2 w-full rounded-pill bg-track" />;
  }

  return (
    <div
      role="img"
      aria-label={segments.map((segment) => `${segment.label} ${segment.value}`).join(", ")}
      className="flex h-2 w-full overflow-hidden rounded-pill bg-track"
    >
      {/* Inline widths: a share is data, and no utility class can express an
          arbitrary percentage. */}
      {segments.map((segment) => (
        <span
          key={segment.key}
          title={`${segment.label}: ${segment.value}`}
          className={segment.className}
          style={{ width: `${(segment.value / marked) * 100}%` }}
        />
      ))}
    </div>
  );
}

/**
 * The register itself — the client's fourteen columns, in their order.
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
    <TableShell caption="Өдөр тутмын ирцийн бүртгэл" minWidth="min-w-[1380px]">
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
          <Th numeric>Ирсэн</Th>
          <Th numeric>Чөлөөтэй</Th>
          <Th numeric>Өвчтэй</Th>
          <Th numeric>Тасалсан</Th>
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
                  label={`${row.group}, ${row.date} — сонгох`}
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
                {row.group}
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
            <Td numeric className="text-ink">
              {row.present}
            </Td>
            <Td numeric className="text-muted">
              {row.excused}
            </Td>
            <Td numeric className="text-muted">
              {row.sick}
            </Td>
            <Td numeric className="text-muted">
              {row.absent}
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
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

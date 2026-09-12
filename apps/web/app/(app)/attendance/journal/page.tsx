"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ATTENDANCE_STATUS_LABEL,
  attendanceJournalSchema,
  groupListItemSchema,
  paginated,
  type AttendanceJournal,
  type AttendanceJournalRow,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { useSearchParams } from "next/navigation";
import { RequireRole } from "@/components/shell/require-role";
import { AttendanceViewSwitch } from "@/components/attendance/view-switch";
import { Download } from "lucide-react";
import { downloadUrl } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { FilterChip, FilterChipRow } from "@/components/ui/filter-chip";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { SelectBox, SelectionBar, useSelection } from "@/components/ui/selection";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Ирцийн дэлгэрэнгүй — the whole kindergarten, a child per row and a day per
 * column, over any range of dates.
 *
 * ★ Every other attendance screen answers about one group on one day, or one
 * child in one month. This is the one a director opens to see the shape of a
 * term, and the one an accountant reads before a funding claim: those two
 * questions are asked over the period the claim covers, which is not obliged
 * to be a calendar month.
 *
 * ★★ ADMIN and ACCOUNTANT only, matching `assertCanReadFinance` on the API.
 * `RequireRole` is UX — it keeps the sidebar honest — and the real refusal is
 * the server's 404. A teacher reads their own group's sheet instead, which is
 * the view their job needs (нэмэлт.md §13).
 */
export default function AttendanceJournalPage() {
  return (
    <RequireRole roles={["ADMIN", "ACCOUNTANT"]}>
      <AttendanceJournal />
    </RequireRole>
  );
}

const groupsSchema = paginated(groupListItemSchema);

/** The four statuses visible to management. Legacy HALF_DAY rows are displayed
 * as PRESENT; OTHER stays readable by the API but has no UI category. */
const VISIBLE_STATUS_ORDER = ["PRESENT", "EXCUSED", "SICK", "ABSENT"] as const;

/**
 * The four a director may filter by — Ирсэн · Чөлөөтэй · Өвчтэй · Тасалсан.
 *
 * ★ 2026-09-12, at the client's request: "Ирсэн · Хагас өдөр — хас · Чөлөөтэй ·
 * Өвчтэй · Тасалсан · Бусад — хас."
 *
 * The same narrowing the teacher's day sheet already has
 * (`TEACHER_ATTENDANCE_STATUSES`, 2026-09-10: "4 сонголт л байна"), arriving
 * here for the same reason: no new day can be recorded as `HALF_DAY` or
 * `OTHER`, so a chip for either filters a set only history can fill.
 *
 * Historical HALF_DAY rows are folded into Ирсэн in the summaries and grid.
 * OTHER stays in the response for compatibility but is not exposed as a
 * management category.
 */
const FILTERABLE_STATUSES = ["PRESENT", "EXCUSED", "SICK", "ABSENT"] as const;

/**
 * One letter per status, for a grid where a word would not fit.
 *
 * ★ The full label is on the cell's `title` and its `aria-label`, so the
 * abbreviation is a convenience for sighted readers and never the only way to
 * know what a cell says.
 */
const STATUS_SHORT: Record<string, string> = {
  PRESENT: "И",
  EXCUSED: "Ч",
  SICK: "Ө",
  ABSENT: "Т",
};

/**
 * ★ Fixed 2026-09-06: every cell in this grid was uncoloured.
 *
 * These were `bg-success-soft text-success-strong` and four more of the same
 * shape, and not one of those tokens exists — `globals.css` defines the stat
 * tints as mint/sky/sun/peach plus `--color-danger`, and there is no
 * `success`, `info` or `warning` scale anywhere in the product. Tailwind
 * emits nothing for a class it cannot resolve and reports nothing either, so
 * the grid rendered every status in the same grey and the letters were the
 * only thing telling them apart. It surfaced now because the client asked for
 * the child-grained register to be reachable from the day sheet
 * (`AttendanceViewSwitch`), which is the first time anybody had reason to
 * read it closely.
 *
 * The tones are the ones the rest of the attendance screens use, so a status
 * is the same colour here as it is on the day sheet and in the summary bar.
 * `HALF_DAY` and `SICK` deliberately share `sun`: both mean "here, but not a
 * full day of care", which is the distinction the funding register draws.
 */
const STATUS_TONE: Record<string, string> = {
  PRESENT: "bg-mint text-mint-ink",
  EXCUSED: "bg-sky text-sky-ink",
  SICK: "bg-sun text-sun-ink",
  ABSENT: "bg-peach text-peach-ink",
};

function AttendanceJournal() {
  const { primaryKindergartenId } = useSession();

  /*
   * Seeded from the URL so `AttendanceViewSwitch` can carry the period over
   * from the group-grained register — see that component's note. Read once, at
   * mount: the filters below own the state from then on.
   */
  const searchParams = useSearchParams();
  const [from, setFrom] = useState(() => searchParams.get("from") || firstOfMonth());
  const [to, setTo] = useState(() => searchParams.get("to") || today());
  const [groupId, setGroupId] = useState(() => searchParams.get("groupId") ?? "");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({
      from,
      to,
      ...(groupId ? { groupId } : {}),
      ...(statuses.length ? { status: statuses.join(",") } : {}),
      ...(search.trim() ? { q: search.trim() } : {}),
      page,
      pageSize: 25,
    }),
    [from, to, groupId, statuses, search, page],
  );

  const queryString = useMemo(
    () => new URLSearchParams(Object.entries(filters).map(([k, v]) => [k, String(v)])).toString(),
    [filters],
  );

  const journal = useQuery({
    queryKey: qk.attendanceJournal(primaryKindergartenId ?? "", filters),
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}/attendance/register?${queryString}`,
        attendanceJournalSchema,
      ),
    enabled: Boolean(primaryKindergartenId),
    // Keeps the grid on screen while a filter is being changed, instead of
    // collapsing to a skeleton on every keystroke.
    placeholderData: (previous) => previous,
  });

  /*
   * `GET /groups`, not `/kindergartens/:id/groups` — the second is a POST-only
   * route, and the funding register's own comment records what happened when a
   * screen assumed otherwise. The key matches `useSwitchableGroups`, so this
   * reads a cache the shell has usually already filled.
   */
  const groups = useQuery({
    queryKey: qk.groups({ pageSize: 100 }),
    queryFn: () => get("/groups?page=1&pageSize=100", groupsSchema),
    enabled: Boolean(primaryKindergartenId),
    staleTime: 5 * 60_000,
  });

  function toggleStatus(status: string) {
    setPage(1);
    setStatuses((current) =>
      current.includes(status) ? current.filter((s) => s !== status) : [...current, status],
    );
  }

  const data = journal.data;

  /*
   * ★ Ticking rows so the export can be a hand-picked set — 2026-09-04.
   *
   * The filters answer "this group", "the five-year-olds", "the sick days";
   * none of them answers "these nine children", which is what somebody
   * assembling a file for one inspection is actually choosing. `useSelection`
   * prunes to the rows on screen, so paging or changing the date range clears
   * the ticks rather than carrying an invisible selection into a download.
   */
  const selection = useSelection((data?.items ?? []).map((row) => row.childId));

  return (
    <div className="flex flex-col gap-4 py-2">
      <PageHeader
        title="Ирцийн дэлгэрэнгүй"
        actions={
          <>
            <AttendanceViewSwitch current="child" from={from} to={to} groupId={groupId} />
            {/*
              ★ In the header, not under the filters — 2026-09-09, at the
              client's request: "excel татах гэдэг нь дороо орсноор маш том
              цагаан хэсэг гарч зай эзэлж байна … excel татахыг нь дээш нь
              оруулдаг ч юм уу".

              It shared a `justify-between` row with the status chips, so at any
              width where the two did not fill the line the gap between them was
              the widest thing on the screen, and at narrower ones the button
              wrapped to a line of its own — a 44px strip holding one control.
              Beside the view switch it is one of the screen's two actions,
              which is what it is.

              ★★ A link, not a fetch. The browser downloads it with the session
              cookie it already has; fetching would buffer a spreadsheet in
              memory only to hand it straight back — the reasoning
              `/admin/funding` records for its own export. `disabled` does
              nothing to an anchor, so the control is absent until there is a
              kindergarten to point it at rather than present and inert.
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

      <Card pad="compact" className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Эхлэх">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={from}
                onChange={(e) => {
                  setPage(1);
                  setFrom(e.target.value);
                }}
              />
            )}
          </Field>
          <Field label="Дуусах">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={to}
                onChange={(e) => {
                  setPage(1);
                  setTo(e.target.value);
                }}
              />
            )}
          </Field>
          <Field label="Бүлэг">
            {({ id }) => (
              <Select
                id={id}
                value={groupId}
                onChange={(e) => {
                  setPage(1);
                  setGroupId(e.target.value);
                }}
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
          <Field label="Хүүхдийн нэр">
            {({ id }) => (
              <Input
                id={id}
                value={search}
                placeholder="Нэрээр хайх"
                onChange={(e) => {
                  setPage(1);
                  setSearch(e.target.value);
                }}
              />
            )}
          </Field>
        </div>

        <FilterChipRow label="Ирцийн төлөв" scroll>
          {FILTERABLE_STATUSES.map((status) => (
            <FilterChip
              key={status}
              active={statuses.includes(status)}
              onClick={() => toggleStatus(status)}
            >
              {ATTENDANCE_STATUS_LABEL[status] ?? status}
            </FilterChip>
          ))}
        </FilterChipRow>
      </Card>

      {journal.isError ? (
        <ErrorState description={errorMessage(journal.error)} />
      ) : journal.isPending ? (
        <LoadingState rows={4} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="Бүртгэл алга"
          description="Сонгосон хугацаа, шүүлтэд тохирох хүүхэд олдсонгүй. Хугацаагаа өргөтгөж эсвэл шүүлтээ цэвэрлэж үзнэ үү."
        />
      ) : (
        <>
          <SectionHeader
            title="Хугацааны дүн"
            lede={`${formatDate(data.from)} — ${formatDate(data.to)}, ${data.total} хүүхэд`}
          />
          <Totals totals={data.totals} />

          {/*
            ★ A heading over the grid, added 2026-09-04.

            The table simply appeared under a card of figures, so nothing said
            where the summary stopped and the register began — the client's
            "дээд гарчиг шиг хэсэг ялгагдахгүй". Two headings turn one long
            scroll into two named sections, and the lede repeats the range
            because the grid's columns are days and the reader needs to know
            which days without scrolling back to the filter.
          */}
          <SectionHeader
            title="Ирцийн бүртгэл"
            lede="Хүүхэд бүрийн өдөр тутмын ирц. Мөрийг сонгож Excel-ээр татаж болно."
          />
          <Grid rows={data.items} days={data.days} selection={selection} />

          {/*
            ★ Class totals under the register — 2026-09-12, at the client's
            request ("доор ангийн нийт ирсэн, нийт гэсэн тоон үзүүлэлтүүдийг
            хойно нь бодож гарга").

            The figures come from the API, not from `data.items`: this screen
            pages over children, and a class total assembled from the twenty-five
            rows on screen would change when somebody turned to page two. They
            are counted across every child the filter matched, which is the same
            set the "Хугацааны дүн" card above reports, and the Excel export
            carries them on a sheet of their own.
          */}
          <GroupTotals groups={data.groups} totals={data.totals} />

          {/*
            ★ The register's own export, narrowed to the ticked rows.

            `?childId=` is a filter like `groupId` — it is ANDed into the same
            enrolment `where` behind `assertCanReadFinance`, so it can only ever
            return fewer children than the unticked export beside it. That is
            what makes "these nine" expressible at all: no filter can name an
            arbitrary set, and a director assembling a file for one inspection
            is picking by hand.
          */}
          <SelectionBar count={selection.count} onClear={selection.clear}>
            {primaryKindergartenId ? (
              <Button size="sm" variant="secondary" asChild>
                <a
                  href={downloadUrl(
                    `/kindergartens/${primaryKindergartenId}/attendance/register/export?${queryString}&childId=${selection.ids.join(",")}`,
                  )}
                >
                  <Download size={16} aria-hidden /> Сонгосныг Excel
                </a>
              </Button>
            ) : null}
          </SelectionBar>

          <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
        </>
      )}
    </div>
  );
}

/**
 * The period's totals, across every matching child rather than the page.
 *
 * ★ A box each — 2026-09-12, at the client's request: "энийг тусдаа жижиг
 * хайрцгуудад хий."
 *
 * They were six columns wrapping inside one roomy card, which on a phone put
 * "Өвчтэй" under "37" and left a reader pairing labels with figures by
 * eye. One card per figure is the same information with the pairing settled by
 * the border, and it is the shape every other count in this product already
 * has.
 *
 * Historical half-days are added to Ирсэн. The API may still return older
 * categories, but this management summary deliberately presents only the four
 * current statuses.
 */
function Totals({ totals }: { totals: Record<string, number> }) {
  const visible = VISIBLE_STATUS_ORDER.map((status) => ({
    status,
    count:
      status === "PRESENT" ? (totals.PRESENT ?? 0) + (totals.HALF_DAY ?? 0) : (totals[status] ?? 0),
  })).filter((item) => item.count > 0);
  if (visible.length === 0) return null;

  return (
    <div
      /*
        Named, so the six boxes are one addressable region. "Ирсэн" also labels
        a filter chip a few rows up, and without a landmark a reader — or a
        test — has no way to say which of the two they mean.
      */
      role="group"
      aria-label="Хугацааны дүн"
      className="grid grid-cols-2 gap-2 sm:grid-cols-4"
    >
      {visible.map(({ status, count }) => (
        <Card key={status} pad="compact" className="flex flex-col gap-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden="true"
              /*
                `STATUS_TONE`, this screen's own map — the same colour the grid
                cell and the legend below already give this status. Importing
                `ATTENDANCE_STATUS_BG` instead would put two disagreeing
                palettes on one screen: it paints SICK peach and this one
                paints it sun.
              */
              className={cn("size-2.5 shrink-0 rounded-pill", STATUS_TONE[status] ?? "bg-track")}
            />
            <span className="min-w-0 truncate text-caption text-muted">
              {ATTENDANCE_STATUS_LABEL[status]}
            </span>
          </span>
          <span className="text-title font-bold tabular-nums text-ink">{count}</span>
        </Card>
      ))}
    </div>
  );
}

/**
 * Ангийн дүн — a row per class, and the kindergarten's own row under it.
 *
 * ★ The same four columns the grid ends in, and deliberately: a director
 * reading "Ирсэн" across a child's row and "Ирсэн" across their class's row is
 * reading one definition, `TOTAL_COLUMNS`, rendered twice.
 *
 * "Нийт" is every recorded day, which is what the four are a breakdown of —
 * `OTHER` included, so a class with an unexplained status still adds up. The
 * four columns need not sum to it, for the reason `TOTAL_COLUMNS` gives.
 */
function GroupTotals({
  groups,
  totals,
}: {
  groups: AttendanceJournal["groups"];
  totals: Record<string, number>;
}) {
  if (groups.length === 0) return null;

  const recorded = groups.reduce((sum, group) => sum + group.recorded, 0);
  const children = groups.reduce((sum, group) => sum + group.children, 0);
  const sumOf = (counts: Record<string, number>, of: readonly string[]) =>
    of.reduce((sum, status) => sum + (counts[status] ?? 0), 0);

  return (
    <>
      <SectionHeader
        title="Ангийн дүн"
        lede="Шүүлтэд тохирсон бүх хүүхдээр бодсон — хуудсаар өөрчлөгдөхгүй"
      />

      <Card pad="none" className="overflow-x-auto">
        <table className="w-full border-collapse text-caption">
          <caption className="sr-only">Ангийн дүн</caption>
          <thead>
            <tr className="border-b-2 border-border bg-sunken text-ink">
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Анги
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                Хүүхэд
              </th>
              {TOTAL_COLUMNS.map((column) => (
                <th key={column.key} scope="col" className="px-2 py-2 text-right font-semibold">
                  {column.key}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Нийт
              </th>
            </tr>
          </thead>

          <tbody>
            {groups.map((group) => (
              <tr key={group.groupId} className="border-b border-line last:border-0">
                <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                  {group.group}
                </th>
                <td className="px-2 py-2 text-right tabular-nums text-muted">{group.children}</td>
                {TOTAL_COLUMNS.map((column) => (
                  <td key={column.key} className="px-2 py-2 text-right tabular-nums text-ink">
                    {sumOf(group.counts, column.of)}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">
                  {group.recorded}
                </td>
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr className="border-t-2 border-border bg-sunken font-semibold text-ink">
              <th scope="row" className="px-3 py-2 text-left">
                Нийт
              </th>
              <td className="px-2 py-2 text-right tabular-nums">{children}</td>
              {TOTAL_COLUMNS.map((column) => (
                <td key={column.key} className="px-2 py-2 text-right tabular-nums">
                  {sumOf(totals, column.of)}
                </td>
              ))}
              <td className="px-3 py-2 text-right tabular-nums">{recorded}</td>
            </tr>
          </tfoot>
        </table>
      </Card>
    </>
  );
}

/**
 * The grid itself.
 *
 * ★ The name column is sticky and the days scroll under it. A register whose
 * first column scrolls away is unreadable at exactly the width it is most
 * needed — a director on a laptop looking at a month.
 */
/**
 * ★ Four total columns, not one — 2026-09-04.
 *
 * The grid ended in a single "Ирсэн" figure, so the two questions a director
 * opens this register with — "who is off sick" and "who is on leave" — could
 * only be answered by counting coloured squares across a month. These are the
 * client's own column names, and the same four the export's "Өдрийн дүн" sheet
 * carries, so the screen and the file agree.
 *
 * `HALF_DAY` counts towards Ирсэн: a half day is a child who came, the reading
 * the admin dashboard already uses. `OTHER` is deliberately in none of them —
 * folding an unexplained status into Тасалсан is a policy call that moves a
 * funding figure, and it is not this table's to make. The four therefore need
 * not sum to the days in the range.
 *
 * ★★ A fifth Бусад column was added and reverted on 2026-09-13.
 *
 * The client asked for the accountant's class figures to read complete
 * ("бүлгийн сарын доод тооцоолол бүгд бүрэн харагд") and the columns not
 * summing to Нийт looked like the gap. It is not this one: what blocked that
 * screen was `GET /groups` refusing an accountant, so no group could be
 * selected at all (`TenantsService.listGroups`). Meanwhile `VISIBLE_STATUS_ORDER`
 * above deliberately keeps Хагас өдөр and Бусад off this screen, with tests
 * holding it — so a Бусад column here would contradict a decision, not fill a
 * hole. The export's "Дүн" and "Ангийн дүн" sheets do carry a Бусад column,
 * which is where a reconciliation to Нийт is available.
 */
const TOTAL_COLUMNS = [
  { key: "Ирсэн", of: ["PRESENT", "HALF_DAY"] },
  { key: "Чөлөөтэй", of: ["EXCUSED"] },
  { key: "Өвчтэй", of: ["SICK"] },
  { key: "Тасалсан", of: ["ABSENT"] },
] as const;

/**
 * Дугаарлагдсан толгой — "Да 1", "Мя 2".
 *
 * ★ A bare column of numbers was the complaint, and it was fair.
 *
 * The header printed `1 2 3 …` with nothing saying they were days of a month,
 * so a reader arriving at a grid of coloured letters had to work back from the
 * date filter above to know what a column meant. The weekday sits above the
 * number because that is the fact that explains a gap: an empty Saturday is a
 * closed kindergarten, and an empty Wednesday is a register nobody filled in.
 */
const WEEKDAY_SHORT = ["Ня", "Да", "Мя", "Лх", "Пү", "Ба", "Бя"];

/** UTC throughout — the day keys are UTC and a local `getDay()` drifts by one. */
function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00.000Z`).getUTCDay();
}

function isWeekend(day: string): boolean {
  const d = weekdayOf(day);
  return d === 0 || d === 6;
}

/**
 * The whole-kindergarten register — a child per row, a day per column.
 *
 * ★ Rebuilt 2026-09-04 after the client could not read it: "ялгагдахгүй … 1 2 3
 * гэсэн юун мэдэгдэхгүй". Four things were wrong and they compounded.
 *
 * **The header did not read as a header.** `text-muted` on the same `bg-surface`
 * as the body, separated by one hairline. It is `bg-sunken` now, with the
 * heavier rule under it that a table's first row earns.
 *
 * **The days were bare numbers.** They carry their weekday now, and weekends
 * are tinted — so an empty Saturday reads as "closed" rather than as a register
 * somebody forgot.
 *
 * **The dashes floated.** Every cell now renders the same 24px box whether it
 * holds a status or not, so the marks line up in columns instead of sitting at
 * whatever height the glyph happened to want. "Not recorded" is a hollow box
 * rather than an en dash — the *shape* says "nothing here" without competing
 * with the letters beside it.
 *
 * **The frozen name column merged into the grid.** It scrolls under the days
 * and had nothing but a matching background to say so; it has a right border
 * and a shadow now, which is what makes a frozen column look frozen.
 *
 * ★★★ It is drawn to fit the screen — 2026-09-12, at the client's instruction
 * ("хойшоо скролдож явдаг биш дэлгэцэд бүхлээрээ харагддаг бай").
 *
 * A month is 31 columns, so the only way a register of this shape fits without
 * scrolling sideways is for a day to be narrow: a 20px box, no horizontal
 * padding on a day cell, and the four totals set in the compact size. That is
 * about 940px for a full month, which a laptop holds. `overflow-x-auto` stays
 * on the wrapper — a phone cannot hold 31 columns at any size that can be read,
 * and a grid clipped is worse than a grid scrolled.
 *
 * ★★ The letters are explained on the page rather than in a tooltip.
 *
 * И, Х, Ч, Ө, Т, Б were readable only by hovering each square. A legend under
 * the grid costs one line and answers the question once for the whole table —
 * and it reads on a touch screen, where there is no hover at all.
 */
function Grid({
  rows,
  days,
  selection,
}: {
  rows: AttendanceJournalRow[];
  days: string[];
  selection: ReturnType<typeof useSelection>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Card pad="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-caption">
            <thead>
              <tr className="border-b-2 border-border bg-sunken">
                <th
                  scope="col"
                  className="sticky left-0 z-20 border-r border-border bg-sunken px-2 py-1.5 text-left font-semibold text-ink shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)]"
                >
                  {/*
                    The select-all sits inside the sticky name header rather
                    than in a column of its own: a separate sticky column would
                    need a second `left` offset kept in step with this one's
                    width at every breakpoint.
                  */}
                  <span className="flex items-center gap-2">
                    <SelectBox
                      checked={selection.allSelected}
                      indeterminate={selection.someSelected}
                      onChange={selection.toggleAll}
                      label="Энэ хуудсын бүх хүүхдийг сонгох"
                    />
                    Хүүхэд
                  </span>
                </th>

                {days.map((day) => (
                  <th
                    key={day}
                    scope="col"
                    /* The full date is the accessible name; the cell shows the
                       two facts that fit — a screen reader gets "2026-09-03"
                       rather than "Лх 3". */
                    aria-label={day}
                    className={cn(
                      "px-0 py-1 text-center font-medium",
                      isWeekend(day) ? "bg-canvas text-faint" : "text-muted",
                    )}
                  >
                    <span className="block text-compact font-normal leading-tight">
                      {WEEKDAY_SHORT[weekdayOf(day)]}
                    </span>
                    <span className="block text-compact font-semibold tabular-nums leading-tight text-ink">
                      {Number(day.slice(8, 10))}
                    </span>
                  </th>
                ))}

                {TOTAL_COLUMNS.map((column, index) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      "whitespace-nowrap px-1.5 py-1.5 text-right text-compact font-semibold text-ink",
                      // A rule where the days end and the totals begin: without
                      // it the last day and the first total read as neighbours.
                      index === 0 && "border-l border-border",
                    )}
                  >
                    {column.key}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => (
                <tr key={row.childId} className="border-b border-line last:border-0">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 max-w-[11rem] border-r border-border bg-surface px-2 py-1 text-left font-normal text-ink shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)]"
                  >
                    <span className="flex items-center gap-2">
                      <SelectBox
                        checked={selection.has(row.childId)}
                        onChange={() => selection.toggle(row.childId)}
                        label={`${row.child.lastName ?? ""} ${row.child.firstName} — сонгох`}
                      />
                      <span className="min-w-0 truncate">
                        {row.child.lastName} {row.child.firstName}
                        <span className="block text-compact text-muted">{row.group.name}</span>
                      </span>
                    </span>
                  </th>

                  {row.days.map((cell, index) => {
                    const day = days[index]!;
                    const visibleStatus =
                      cell?.status === "HALF_DAY"
                        ? "PRESENT"
                        : cell?.status === "OTHER"
                          ? null
                          : cell?.status;
                    const label = visibleStatus
                      ? `${day} — ${ATTENDANCE_STATUS_LABEL[visibleStatus] ?? visibleStatus}`
                      : cell
                        ? `${day} — бүртгэлтэй`
                        : `${day} — бүртгэлгүй`;

                    return (
                      <td
                        key={day}
                        className={cn("px-0 py-1 text-center", isWeekend(day) && "bg-canvas")}
                      >
                        {/*
                          ★ One 24px box per cell, filled or hollow.

                          A recorded status and an unrecorded day used to render
                          two different shapes at two different heights — a
                          tinted square and a floating en dash — so the marks
                          did not line up and the dashes read as debris. The box
                          is the same either way; only what is inside it
                          changes.

                          ★★ Hollow, not empty, and not "absent". Nothing was
                          recorded that day, which is a different fact from a
                          recorded absence — and it is the one that becomes a
                          funding claim if the two are confused.
                        */}
                        <span
                          title={label}
                          aria-label={label}
                          className={cn(
                            "inline-flex h-5 w-5 items-center justify-center rounded-control text-compact font-semibold",
                            visibleStatus
                              ? (STATUS_TONE[visibleStatus] ?? "bg-canvas text-muted")
                              : cell
                                ? "bg-canvas text-muted"
                                : "border border-dashed border-border text-transparent",
                          )}
                        >
                          {visibleStatus ? (STATUS_SHORT[visibleStatus] ?? "?") : "·"}
                        </span>
                      </td>
                    );
                  })}

                  {TOTAL_COLUMNS.map((column, index) => (
                    <td
                      key={column.key}
                      className={cn(
                        "px-1.5 py-1 text-right text-compact tabular-nums text-ink",
                        index === 0 && "border-l border-border",
                      )}
                    >
                      {column.of.reduce((sum, status) => sum + (row.counts[status] ?? 0), 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <StatusLegend />
    </div>
  );
}

/**
 * What the letters mean, once, under the grid.
 *
 * ★ Not a tooltip. Each square already carries its status in a `title`, which
 * is a hover away on a desktop and unreachable on a phone — and hovering
 * thirty squares to learn six letters is not reading a table. The legend is
 * one line and answers it for the whole screen.
 *
 * The tones come from `STATUS_TONE`, so a legend swatch cannot drift from the
 * colour it is explaining.
 */
function StatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-caption text-muted">
      {VISIBLE_STATUS_ORDER.map((status) => (
        <span key={status} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn(
              "inline-flex h-5 w-5 items-center justify-center rounded-check text-caption font-semibold",
              STATUS_TONE[status] ?? "bg-canvas text-muted",
            )}
          >
            {STATUS_SHORT[status]}
          </span>
          {ATTENDANCE_STATUS_LABEL[status] ?? status}
        </span>
      ))}

      <span className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="inline-flex h-5 w-5 items-center justify-center rounded-check border border-dashed border-border"
        />
        Бүртгэлгүй
      </span>
    </div>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

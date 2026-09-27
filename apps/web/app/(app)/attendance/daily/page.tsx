"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Calendar as CalendarIcon, Download, Pencil, Printer } from "lucide-react";
import {
  dailyAttendanceSchema,
  groupListItemSchema,
  paginated,
  type DailyAttendanceRow,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { downloadUrl } from "@/lib/api/client";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { SearchField } from "@/components/ui/search-field";
import { AttendanceBreakdown } from "@/components/attendance/attendance-breakdown";
import { ChildAttendance } from "@/components/attendance/child-attendance";
import { useDebounced } from "@/lib/use-debounced";
import { cn } from "@/lib/utils";

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

const PAGE_SIZE = 10;

type View = "day" | "child" | "breakdown";

/**
 * Өдөр тутмын ирц — the client's 2026-09-25 drawing: range, group and search
 * on one row, three tabs, and one table of the days with grouped headers.
 *
 * ★ Per the client ("загварын дагуу хийчих, дараа нь бак дээр хийж холбоно"):
 * the holiday calendar and the ESIS send flow that stood on this screen are
 * not in the drawing and went with it; the endpoints behind them still exist
 * and will be connected again. The approval columns have no data yet and read
 * "—"; ESIS shows only whether the day was sent — the API records the send,
 * not how many rows ESIS accepted or refused.
 */
function DailyAttendance() {
  const { primaryKindergartenId } = useSession();

  const searchParams = useSearchParams();
  const months = useMemo(() => schoolYearMonths(new Date()), []);
  const [month, setMonth] = useState(() => initialMonth(months, searchParams.get("from")));
  const { from, to } = monthRange(month);
  const [groupId, setGroupId] = useState(() => searchParams.get("groupId") ?? "");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [childSearch, setChildSearch] = useState("");
  const childQ = useDebounced(childSearch.trim());
  const [view, setView] = useState<View>("day");
  const [page, setPage] = useState(1);

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
    enabled: Boolean(primaryKindergartenId) && view === "day",
    placeholderData: (previous) => previous,
  });

  const groups = useQuery({
    queryKey: qk.groups({ pageSize: 100 }),
    queryFn: () => get("/groups?page=1&pageSize=100", groupsSchema),
    enabled: Boolean(primaryKindergartenId),
    staleTime: 5 * 60_000,
  });

  const term = search.trim().toLocaleLowerCase("mn-MN");
  const rows = (daily.data?.items ?? []).filter(
    (row) => !term || row.group.toLocaleLowerCase("mn-MN").includes(term),
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const visible = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const resetting =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };

  const exportParams = new URLSearchParams(filters);
  if (view === "child" && status) exportParams.set("status", status);
  if (view === "child" && childQ) exportParams.set("q", childQ);
  const exportQuery = exportParams.toString();
  const byChild = view === "child";
  const breakdown = view === "breakdown";

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border-soft bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-display font-bold leading-heading text-ink">
            {breakdown ? "Ирц бүртгэл" : byChild ? "Суралцагчаар" : "Өдөр тутмын ирц"}
          </h1>
          <p className="mt-1 text-body text-muted">
            {breakdown
              ? "Бүлэг болон сар сонгон тухайн бүлгийн ирцийн задаргаа харах."
              : byChild
                ? "Суралцагч бүрийн өдөр тутмын ирцийн мэдээллийг харна."
                : "Бүлэг болон сар сонгон өдөр тутмын ирцийн мэдээллийг бүртгэнэ."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {breakdown ? (
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer size={16} aria-hidden /> Хэвлэх
            </Button>
          ) : null}
          {primaryKindergartenId ? (
            <Button variant="secondary" asChild>
              <a
                href={downloadUrl(
                  `/kindergartens/${primaryKindergartenId}/attendance/register/export?${exportQuery}`,
                )}
              >
                <Download size={16} aria-hidden /> Excel татах
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "grid gap-3 sm:grid-cols-2",
          byChild
            ? "lg:grid-cols-[minmax(0,260px)_minmax(0,240px)_minmax(0,240px)_minmax(0,1fr)]"
            : breakdown
              ? "lg:grid-cols-[minmax(0,420px)_minmax(0,300px)]"
              : "lg:grid-cols-[minmax(0,420px)_minmax(0,300px)_minmax(0,1fr)]",
        )}
      >
        <div className="relative">
          <CalendarIcon
            size={18}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <Select
            aria-label="Сар"
            value={month}
            onChange={(e) => resetting(setMonth)(e.target.value)}
            className="pl-10"
          >
            {months.map((value) => (
              <option key={value} value={value}>
                {Number(value.slice(5))} сар
              </option>
            ))}
          </Select>
        </div>
        <Select
          aria-label="Бүлэг"
          value={groupId}
          onChange={(e) => resetting(setGroupId)(e.target.value)}
        >
          <option value="">Бүх бүлэг</option>
          {(groups.data?.items ?? []).map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </Select>
        {byChild ? (
          <>
            <Select aria-label="Төлөв" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Бүх төлөв</option>
              <option value="PRESENT,HALF_DAY">Ирсэн</option>
              <option value="SICK">Өвчтэй</option>
              <option value="EXCUSED">Чөлөөтэй</option>
              <option value="ABSENT">Тасалсан</option>
            </Select>
            <SearchField
              label="Нэрээр хайх"
              placeholder="Нэрээр хайх..."
              value={childSearch}
              onChange={setChildSearch}
            />
          </>
        ) : breakdown ? null : (
          <SearchField
            label="Бүлгийн нэрээр хайх"
            placeholder="Бүлгийн нэрээр хайх..."
            value={search}
            onChange={resetting(setSearch)}
          />
        )}
      </div>

      <div
        role="tablist"
        aria-label="Ирцийн харагдац"
        className="flex gap-6 border-b border-border"
      >
        {(
          [
            ["day", "Өдрөөр"],
            ["child", "Суралцагчаар"],
            ["breakdown", "Ирцийн задаргаа"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            onClick={() => setView(value)}
            className={cn(
              "-mb-px border-b-2 px-1 pb-2.5 text-lead font-medium transition-colors",
              view === value
                ? "border-primary text-primary"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "breakdown" ? (
        <AttendanceBreakdown from={from} to={to} groupId={groupId} />
      ) : byChild ? (
        <ChildAttendance from={from} to={to} groupId={groupId} status={status} q={childQ} />
      ) : daily.isError ? (
        <ErrorState description={errorMessage(daily.error)} />
      ) : daily.isPending ? (
        <LoadingState rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Бүртгэл алга"
          description="Сонгосон хугацаанд тохирох бүлэг олдсонгүй. Хугацаа, бүлэг эсвэл хайлтаа өөрчилж үзнэ үү."
        />
      ) : (
        <>
          <DayTable rows={visible} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-lead text-muted">
              Нийт <span className="font-bold tabular-nums text-ink">{rows.length}</span> бичлэг
            </p>
            <Pagination page={current} totalPages={totalPages} onPage={setPage} />
          </div>
        </>
      )}
    </div>
  );
}

const GROUP_HEAD = "border-b border-border px-3 py-2 text-center text-body font-semibold text-ink";

/** One day of one group per row, under three grouped headings. */
function DayTable({ rows }: { rows: DailyAttendanceRow[] }) {
  return (
    <div className="rounded-card border border-border">
      <table className="w-full border-collapse text-body">
        <caption className="sr-only">Өдөр тутмын ирцийн бүртгэл</caption>
        <thead>
          <tr>
            <th
              scope="col"
              rowSpan={2}
              className="rounded-tl-card bg-sunken px-3 py-2 text-left text-body font-semibold text-ink"
            >
              Өдөр
            </th>
            <th
              scope="col"
              rowSpan={2}
              className="bg-sunken px-3 py-2 text-left text-body font-semibold text-ink"
            >
              Бүлэг
            </th>
            <th scope="colgroup" colSpan={5} className={cn(GROUP_HEAD, "bg-primary-soft")}>
              Ирц
            </th>
            <th scope="colgroup" colSpan={3} className={cn(GROUP_HEAD, "bg-sun")}>
              Баталгаажуулалт
            </th>
            <th scope="colgroup" colSpan={3} className={cn(GROUP_HEAD, "bg-mint")}>
              ESIS
            </th>
            <th
              scope="col"
              rowSpan={2}
              className="rounded-tr-card bg-sunken px-3 py-2 text-center text-body font-semibold text-ink"
            >
              Ирц
            </th>
          </tr>
          <tr>
            {[
              ["Нийт", "bg-primary-soft/60"],
              ["Ирсэн", "bg-primary-soft/60"],
              ["Өвчтэй", "bg-primary-soft/60"],
              ["Чөлөөтэй", "bg-primary-soft/60"],
              ["Тасалсан", "bg-primary-soft/60"],
              ["Зөвшөөрсөн", "bg-sun/60"],
              ["Татгалзсан", "bg-sun/60"],
              ["Хүлээгдэж байгаа", "bg-sun/60"],
              ["Илгээсэн", "bg-mint/60"],
              ["Амжилттай", "bg-mint/60"],
              ["Алдаатай", "bg-mint/60"],
            ].map(([label, tone]) => (
              <th
                key={label}
                scope="col"
                className={cn(
                  "border-b border-border px-2 py-2 text-center text-caption font-medium text-ink",
                  tone,
                )}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.groupId}-${row.date}`}
              className="border-b border-border-soft last:border-b-0 even:bg-sunken/40"
            >
              <td className="px-3 py-1.5 tabular-nums text-ink">{row.date.slice(0, 10)}</td>
              <td className="px-3 py-1.5 text-ink">{row.group}</td>
              <NumberCell value={row.expected} tone="text-primary" />
              <NumberCell value={row.present} tone="text-mint-ink" />
              <NumberCell value={row.sick} tone="text-muted" />
              <NumberCell value={row.excused} tone="text-sun-ink" />
              <NumberCell value={row.absent} tone="text-muted" />
              {/* No approval counts per day yet. */}
              <DashCell />
              <DashCell />
              <DashCell />
              {/* The API records that the day was sent, not ESIS's per-row answer. */}
              <td className="px-2 py-1.5 text-center">
                {row.sentAt ? (
                  <span className="font-semibold text-mint-ink" title={formatStamp(row.sentAt)}>
                    ✓
                  </span>
                ) : (
                  <span className="text-faint">—</span>
                )}
              </td>
              <DashCell />
              <DashCell />
              <td className="px-2 py-1 text-center">
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/groups/${row.groupId}/attendance?date=${row.date.slice(0, 10)}`}>
                    <Pencil size={14} aria-hidden /> Бүртгэх
                  </Link>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NumberCell({ value, tone }: { value: number; tone: string }) {
  return (
    <td className={cn("px-2 py-1.5 text-center font-semibold tabular-nums", tone)}>{value}</td>
  );
}

function DashCell() {
  return <td className="px-2 py-1.5 text-center text-faint">—</td>;
}

function formatStamp(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

/**
 * The school year's months, September to May, as "YYYY-MM" — client,
 * 2026-09-27: pick a month directly rather than a date range. Before
 * September the year shown is the one that ended in May.
 */
function schoolYearMonths(now: Date): string[] {
  const year = now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  return [9, 10, 11, 12, 1, 2, 3, 4, 5].map(
    (m) => `${m >= 9 ? year : year + 1}-${String(m).padStart(2, "0")}`,
  );
}

/** A `?from=` link keeps its month; otherwise this month, or May in summer. */
function initialMonth(months: string[], from: string | null): string {
  const wanted = from?.slice(0, 7);
  if (wanted && months.includes(wanted)) return wanted;
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return months.includes(current) ? current : months[months.length - 1]!;
}

function monthRange(month: string): { from: string; to: string } {
  const [year, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

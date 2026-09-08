"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, Download, Info, RotateCw } from "lucide-react";
import { z } from "zod";
import {
  attendanceRegisterSchema,
  groupListItemSchema,
  paginated,
  FUNDING_SOURCE_LABEL,
  type AttendanceRegister,
  type FundingSource,
  type RegisterRow,
  type RegisterState,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { downloadUrl } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { formatMonthLabel, formatRelative, fullName } from "@/lib/format";
import {
  ATTENDANCE_STATUS_LABEL,
  ATTENDANCE_STATUS_ORDER,
  ATTENDANCE_STATUS_TONE,
} from "@/lib/attendance-meta";
import {
  currentMonth,
  formatTugrug,
  REGISTER_STATE_HINT,
  REGISTER_STATE_LABEL,
  REGISTER_STATE_TONE,
  shiftMonth,
} from "@/lib/funding-meta";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { FilterChip } from "@/components/ui/filter-chip";
import { Pagination, ResultCount } from "@/components/ui/pagination";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { Art } from "@/components/ui/art";

const groupsSchema = paginated(groupListItemSchema);

/**
 * What `POST /funding/calculate` returns — the month's rows, freshly written.
 *
 * ★ Parsed loosely, because nothing on this screen reads it.
 *
 * The table refetches from `/funding/register` on success (the calculation is
 * one of five inputs that answer folds together), so the mutation's own body is
 * only ever a success signal. Modelling all fourteen columns here to discard
 * them would be a second place the calculation's shape lives — contracts §1:
 * model only what the UI reads.
 */
const calculatedRowsSchema = z.array(z.object({ id: z.string() }));

const PAGE_SIZE = 25;

/**
 * Ирц ба тооцоолол — нэмэлт.md §6.
 *
 * ★ A second attendance screen, deliberately, and not a tab on the first one.
 *
 * `/groups/[groupId]/attendance` is a teacher's morning: one group, one day,
 * one tap per child, on a phone. This is a director's month-end: every group,
 * every day folded into counts, priced against the funding rules, on a desk.
 * They share a table (`Attendance`) and nothing else — not the audience, not
 * the device, not the cadence, and not the permission (§13 keeps teachers out
 * of the money entirely; ADMIN and ACCOUNTANT — see the third note below).
 *
 * Folding them into one screen would have put a fourteen-column financial
 * table behind a tab on the screen a teacher opens every morning on a phone,
 * which is the opposite of CLAUDE.md §5's first rule.
 *
 * ★★ The two tabs *here* are one dataset read twice.
 *
 * "Ирцийн дэлгэрэнгүй" is the register; "Санхүүгийн тооцоо" is that register
 * priced. One request serves both (`/funding/register`), because a figure and
 * its justification must never disagree about who was enrolled — see
 * `FundingService.monthlyRegister`.
 *
 * ★★★ `RequireRole` includes ACCOUNTANT as of 2026-09-02. The route's own
 * comment used to say "this whole route is ADMIN", which had already stopped
 * being true on the API side — `KindergartenFundingController` has been
 * `@Roles("ADMIN", "ACCOUNTANT")` since the role shipped — but nobody widened
 * the screen that reads it. `нэмэлт.md` §13 names "Улсын санхүүжилт" and
 * "Төлбөрийн тулгалт" for the accountant explicitly, and this is that screen:
 * the register a transfer gets reconciled against.
 */
export default function AdminFundingPage() {
  return (
    <RequireRole roles={["ADMIN", "ACCOUNTANT"]}>
      <FundingRegister />
    </RequireRole>
  );
}

type Tab = "attendance" | "funding";

function FundingRegister() {
  const { primaryKindergartenId } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [month, setMonth] = useState(currentMonth);
  const [groupId, setGroupId] = useState("");
  const [source, setSource] = useState<FundingSource | "">("");
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<Tab>("attendance");

  /*
   * ★ The filters are one object, and it keys the query.
   *
   * React Query refetches when the key changes, so every filter is wired to
   * the network by being in this object and nothing else — there is no
   * `useEffect` anywhere on this screen synchronising state to a fetch. The
   * page number resets from each filter's own setter below rather than from an
   * effect watching them, which is what keeps "change the group, land on page
   * four of a two-page result" from happening.
   */
  const filters = useMemo(
    () => ({
      month,
      ...(groupId ? { groupId } : {}),
      ...(source ? { source } : {}),
      ...(search.trim() ? { q: search.trim() } : {}),
      ...(statuses.length ? { status: statuses.join(",") } : {}),
      page,
      pageSize: PAGE_SIZE,
    }),
    [month, groupId, source, search, statuses, page],
  );

  const queryString = useMemo(
    () => new URLSearchParams(Object.entries(filters).map(([k, v]) => [k, String(v)])).toString(),
    [filters],
  );

  const register = useQuery({
    queryKey: qk.fundingRegister(primaryKindergartenId ?? "", filters),
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}/funding/register?${queryString}`,
        attendanceRegisterSchema,
      ),
    enabled: Boolean(primaryKindergartenId),
    placeholderData: (previous) => previous,
  });

  /*
   * ★ `GET /groups`, not `GET /kindergartens/:id/groups`.
   *
   * The second one does not exist. `kindergartens/:id/groups` is a **POST**
   * route — creating a group — and the API has no GET beside it, so this
   * screen's group filter answered 404 from the day it shipped: the select
   * rendered empty, and a director filtering the register by group silently
   * got nothing to choose from. The test mocked the wrong path too, which is
   * why it passed.
   *
   * The list route scopes itself to the actor's own memberships, so no
   * kindergarten id is needed — and the key matches `useSwitchableGroups` so
   * the register reads the same warm cache the register switcher fills.
   */
  const groups = useQuery({
    queryKey: qk.groups({ pageSize: 100 }),
    queryFn: () => get("/groups?page=1&pageSize=100", groupsSchema),
    enabled: Boolean(primaryKindergartenId),
    staleTime: 5 * 60_000,
  });

  /*
   * ★ Recalculating is a confirmed action, not a button that just fires.
   *
   * `replaceMonth` supersedes the month's existing rows — the previous answer
   * is kept, soft-deleted, but the figure on screen changes underneath anybody
   * who has already submitted it. CLAUDE.md §5 asks for a confirmation before
   * a delete; this is not a delete, but it is the same surprise.
   *
   * It runs one source at a time because the API does: a rule set is per
   * source, and "recalculate everything" would hide which of four claims just
   * moved. When no source filter is set the button asks for one rather than
   * guessing.
   */
  const calculate = useMutation({
    mutationFn: (forSource: FundingSource) =>
      mutate(`/kindergartens/${primaryKindergartenId}/funding/calculate`, calculatedRowsSchema, {
        method: "POST",
        body: { month, source: forSource },
      }),
    onSuccess: () => {
      toast.success("Тооцоо шинэчлэгдлээ.");
      void queryClient.invalidateQueries({ queryKey: ["funding", "register"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const data = register.data;
  const rows = data?.items ?? [];

  /** Every filter setter returns to page one — see `filters` above. */
  const withReset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };

  const toggleStatus = withReset((status: string) =>
    setStatuses((current) =>
      current.includes(status) ? current.filter((s) => s !== status) : [...current, status],
    ),
  );

  const filtersActive =
    Boolean(groupId) || Boolean(source) || Boolean(search.trim()) || statuses.length > 0;

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Ирц ба тооцоолол"
        actions={
          <div className="flex flex-wrap gap-2">
            {/*
              ★ A link, not a fetch — the browser saves the file itself.

              Fetching it would buffer a spreadsheet in memory only to hand it
              straight back to the browser. `disabled` does nothing to an
              anchor, so the control is absent until there is a kindergarten to
              point it at rather than present and inert.
            */}
            {primaryKindergartenId ? (
              <Button size="sm" variant="secondary" asChild>
                <a
                  href={downloadUrl(
                    `/kindergartens/${primaryKindergartenId}/funding/register/export?${queryString}`,
                  )}
                >
                  <Download size={16} aria-hidden /> Excel татах
                </a>
              </Button>
            ) : null}
            {/*
              ★ Without a source there is no button, only the reason.

              Calculation runs one source at a time because a rule set belongs
              to one — running "everything" would move four claims and say which
              of them changed nowhere. A disabled button with a tooltip states
              the requirement where the eye already is, and turns into the real
              control the moment the filter above answers it.
            */}
            {source ? (
              <ConfirmDialog
                trigger={
                  <Button size="sm">
                    <RotateCw size={16} aria-hidden /> Тооцоолол үүсгэх
                  </Button>
                }
                title="Тооцоолол шинээр үүсгэх үү?"
                description={`${formatMonthLabel(month)} сарын «${FUNDING_SOURCE_LABEL[source]}» тооцоог ирц, хоолны бүртгэлээс дахин бодно. Өмнөх тооцоо архивлагдаж, шинэ дүн харагдана.`}
                confirmLabel="Тооцоолох"
                pendingLabel="Тооцоолж байна…"
                pending={calculate.isPending}
                onConfirm={() => calculate.mutate(source)}
              />
            ) : (
              <Button size="sm" disabled title="Санхүүжилтийн эх үүсвэрээ сонгоно уу">
                <RotateCw size={16} aria-hidden /> Тооцоолол үүсгэх
              </Button>
            )}
          </div>
        }
      />

      <FilterBar
        month={month}
        onMonth={withReset(setMonth)}
        groupId={groupId}
        onGroup={withReset(setGroupId)}
        groups={groups.data?.items ?? []}
        source={source}
        onSource={withReset((value: string) => setSource(value as FundingSource | ""))}
        search={search}
        onSearch={withReset(setSearch)}
        statuses={statuses}
        onToggleStatus={toggleStatus}
        onClear={() => {
          setGroupId("");
          setSource("");
          setSearch("");
          setStatuses([]);
          setPage(1);
        }}
        clearable={filtersActive}
      />

      <SummaryCards register={data} />

      {register.isError ? <ErrorState description={errorMessage(register.error)} /> : null}

      {register.isLoading ? <LoadingState rows={6} /> : null}

      {data ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border">
            <div role="tablist" aria-label="Хүснэгтийн харагдац" className="flex gap-6">
              <TabButton
                active={tab === "attendance"}
                onClick={() => setTab("attendance")}
                count={data.total}
              >
                Ирцийн дэлгэрэнгүй
              </TabButton>
              <TabButton
                active={tab === "funding"}
                onClick={() => setTab("funding")}
                count={data.total}
              >
                Санхүүгийн тооцоо
              </TabButton>
            </div>

            <StateLegend className="pb-2" />
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title="Илэрц алга"
              description={
                filtersActive
                  ? "Шүүлтүүрт тохирох хүүхэд олдсонгүй. Шүүлтүүрээ цэвэрлэж үзнэ үү."
                  : "Энэ сард бүртгэлтэй хүүхэд байхгүй байна."
              }
            />
          ) : tab === "attendance" ? (
            <AttendanceTable rows={rows} totals={data.totals} />
          ) : (
            <FundingTable rows={rows} totals={data.totals} workingDays={data.workingDays} />
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <ResultCount total={data.total} noun="хүүхэд" />
            <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <AlertPanel register={data} className="lg:col-span-1" />
            <RulesPanel register={data} />
            <ExplainerPanel register={data} />
          </div>
        </>
      ) : null}
    </div>
  );
}

// ── Filters ──────────────────────────────────────────────────────────────────

/**
 * The filter bar — the client's own drawing, minus the date range.
 *
 * ★ A month, not a from/to pair.
 *
 * The drawing shows both a month picker and a date range. The money cannot
 * honour a range: `FundingCalculation` is unique per child **per month** per
 * source, and a claim is submitted monthly — a figure for "12 to 19 August"
 * does not exist to be shown. Offering the control anyway would let somebody
 * pick a range and read a month's total as its answer, which is the specific
 * failure `docs/reference/FINANCE_SCOPE.md` calls "plausible, precise and
 * wrong". The quick chips give the same reach in one tap.
 */
function FilterBar({
  month,
  onMonth,
  groupId,
  onGroup,
  groups,
  source,
  onSource,
  search,
  onSearch,
  statuses,
  onToggleStatus,
  onClear,
  clearable,
}: {
  month: string;
  onMonth: (value: string) => void;
  groupId: string;
  onGroup: (value: string) => void;
  groups: { id: string; name: string }[];
  source: string;
  onSource: (value: string) => void;
  search: string;
  onSearch: (value: string) => void;
  statuses: string[];
  onToggleStatus: (status: string) => void;
  onClear: () => void;
  clearable: boolean;
}) {
  const thisMonth = currentMonth();

  return (
    <Card className="flex flex-col gap-4 px-4 py-4 sm:px-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Сар">
          {({ id }) => (
            <Input
              id={id}
              type="month"
              max={thisMonth}
              value={month}
              onChange={(e) => onMonth(e.target.value)}
            />
          )}
        </Field>

        <Field label="Бүлэг">
          {({ id }) => (
            <Select id={id} value={groupId} onChange={(e) => onGroup(e.target.value)}>
              <option value="">Бүх бүлэг</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Санхүүжилтийн эх үүсвэр">
          {({ id }) => (
            <Select id={id} value={source} onChange={(e) => onSource(e.target.value)}>
              <option value="">Бүх эх үүсвэр</option>
              {(Object.keys(FUNDING_SOURCE_LABEL) as FundingSource[]).map((value) => (
                <option key={value} value={value}>
                  {FUNDING_SOURCE_LABEL[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Хүүхэд">
          {({ id }) => (
            <Input
              id={id}
              type="search"
              placeholder="Хүүхдийн нэрээр хайх"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
            />
          )}
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption text-muted">Шуурхай сонголт</span>
        <FilterChip active={month === thisMonth} onClick={() => onMonth(thisMonth)}>
          Энэ сар
        </FilterChip>
        <FilterChip
          active={month === shiftMonth(thisMonth, -1)}
          onClick={() => onMonth(shiftMonth(thisMonth, -1))}
        >
          Өмнөх сар
        </FilterChip>
        <FilterChip
          active={month === shiftMonth(thisMonth, -2)}
          onClick={() => onMonth(shiftMonth(thisMonth, -2))}
        >
          {formatMonthLabel(shiftMonth(thisMonth, -2))}
        </FilterChip>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption text-muted">Ирцийн төлөв</span>
        {ATTENDANCE_STATUS_ORDER.map((status) => (
          <FilterChip
            key={status}
            active={statuses.includes(status)}
            onClick={() => onToggleStatus(status)}
          >
            {ATTENDANCE_STATUS_LABEL[status]}
          </FilterChip>
        ))}

        {clearable ? (
          <Button variant="ghost" size="sm" onClick={onClear} className="ms-auto">
            Цэвэрлэх
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

// ── The four figures ─────────────────────────────────────────────────────────

/**
 * ★ Four cards, and the fourth is a deduction rather than a total.
 *
 * The client's drawing puts "Суутгалын дүн" here, not "Нийт төлбөр", and it is
 * the right choice: the gross is arithmetic anybody can do from the tariff and
 * the working days, while the deduction is the month's actual news — the money
 * that fell out of the claim and the figure somebody will be asked about.
 */
function SummaryCards({ register }: { register: AttendanceRegister | undefined }) {
  const attended = register ? register.totals.counts.PRESENT + register.totals.counts.HALF_DAY : 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Нийт хүүхэд"
        value={register?.totals.children ?? "—"}
        tone="sky"
        art={<Art name="child" size={36} />}
        artSurface={false}
      />
      <StatCard
        label="Ажлын өдөр"
        value={register?.workingDays ?? "—"}
        tone="cornflower"
        art={<CalendarDays size={22} aria-hidden />}
        footer={<p className="text-caption text-muted">Ирц бүртгэгдсэн өдрөөр тоолсон.</p>}
      />
      <StatCard
        label="Ирсэн хоног"
        value={register ? attended.toLocaleString("mn-MN") : "—"}
        tone="mint"
        art={<CheckCircle2 size={22} aria-hidden />}
        footer={
          register ? (
            <p className="text-caption text-muted">
              Хагас өдөр {register.totals.counts.HALF_DAY} орсон.
            </p>
          ) : undefined
        }
      />
      <StatCard
        label="Суутгалын дүн"
        value={formatTugrug(register?.totals.deductionAmount)}
        tone="peach"
        art={<Art name="finance" size={36} />}
        artSurface={false}
        footer={
          register ? (
            <p className="text-caption text-muted">
              Эцсийн төлбөр {formatTugrug(register.totals.netAmount)}
            </p>
          ) : undefined
        }
      />
    </div>
  );
}

// ── Tables ───────────────────────────────────────────────────────────────────

/**
 * ★ A real `<table>`, not the `DataList` row cards the other admin screens use.
 *
 * Those exist because an admin row is one name and two actions, and a card
 * reads better than a two-column table. This is eleven numeric columns a reader
 * compares *down* — "who has the most absences" is answered by scanning a
 * column, which is exactly what a table is for and what a stack of cards makes
 * impossible. It also lets the totals row be a real `<tfoot>` that stays with
 * its columns.
 *
 * The horizontal scroll is on the wrapper, so the page body never scrolls
 * sideways on a phone.
 */
function TableShell({ children, caption }: { children: React.ReactNode; caption: string }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-body">
          <caption className="sr-only">{caption}</caption>
          {children}
        </table>
      </div>
    </Card>
  );
}

function Th({ numeric, className, ...props }: React.ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap border-b border-border px-3 py-2.5 text-caption font-semibold text-muted",
        numeric ? "text-right" : "text-left",
        className,
      )}
      {...props}
    />
  );
}

function Td({ numeric, className, ...props }: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "border-b border-border px-3 py-2.5 align-middle",
        numeric ? "text-right tabular-nums" : "text-left",
        className,
      )}
      {...props}
    />
  );
}

/** The child's name and group, the first column of both tables. */
function ChildCell({ row }: { row: RegisterRow }) {
  return (
    <div className="min-w-0">
      <span className="block truncate font-medium text-ink">{fullName(row.child)}</span>
      <span className="block truncate text-caption text-muted">
        {row.group?.name ?? "Бүлэггүй"}
      </span>
    </div>
  );
}

function StateBadge({ state }: { state: RegisterState }) {
  return (
    <Badge tone={REGISTER_STATE_TONE[state]} title={REGISTER_STATE_HINT[state]}>
      {REGISTER_STATE_LABEL[state]}
    </Badge>
  );
}

function AttendanceTable({
  rows,
  totals,
}: {
  rows: RegisterRow[];
  totals: AttendanceRegister["totals"];
}) {
  return (
    <TableShell caption="Хүүхэд тус бүрийн сарын ирцийн задаргаа">
      <thead className="bg-canvas">
        <tr>
          <Th className="w-[220px]">Хүүхэд</Th>
          {ATTENDANCE_STATUS_ORDER.map((status) => (
            <Th key={status} numeric>
              {ATTENDANCE_STATUS_LABEL[status]}
            </Th>
          ))}
          <Th numeric>Бусад</Th>
          <Th numeric>Хоолны хоног</Th>
          <Th numeric>Актгүй хоног</Th>
          <Th>Төлөв</Th>
        </tr>
      </thead>

      <tbody>
        {rows.map((row) => (
          <tr key={row.child.id} className="hover:bg-canvas">
            <Td>
              <ChildCell row={row} />
            </Td>
            {ATTENDANCE_STATUS_ORDER.map((status) => (
              <Td key={status} numeric>
                <StatusCount status={status} count={row.counts[status]} />
              </Td>
            ))}
            <Td numeric>
              <StatusCount status="OTHER" count={row.counts.OTHER} />
            </Td>
            <Td numeric>{row.mealDays}</Td>
            <Td numeric>
              {/*
                ★ Zero is a dash, not a "0".
                A column of zeros with three real numbers in it hides the three.
              */}
              {row.undocumentedDays > 0 ? (
                <span className="font-semibold text-danger">{row.undocumentedDays}</span>
              ) : (
                <span className="text-faint">—</span>
              )}
            </Td>
            <Td>
              <StateBadge state={row.state} />
            </Td>
          </tr>
        ))}
      </tbody>

      <tfoot>
        <tr className="bg-canvas font-semibold">
          <Td>Нийт дүн</Td>
          {ATTENDANCE_STATUS_ORDER.map((status) => (
            <Td key={status} numeric>
              {totals.counts[status]}
            </Td>
          ))}
          <Td numeric>{totals.counts.OTHER}</Td>
          <Td numeric>{totals.mealDays}</Td>
          <Td numeric>{totals.missingDocuments > 0 ? totals.missingDocuments : "—"}</Td>
          <Td />
        </tr>
      </tfoot>
    </TableShell>
  );
}

/** A count, tinted with the status's own colour when it is not zero. */
function StatusCount({ status, count }: { status: string; count: number }) {
  if (count === 0) return <span className="text-faint">—</span>;

  const tone = ATTENDANCE_STATUS_TONE[status];
  return (
    <span
      className={cn(
        "font-medium",
        tone === "danger" ? "text-danger" : tone === "peach" ? "text-peach-ink" : "text-ink",
      )}
    >
      {count}
    </span>
  );
}

function FundingTable({
  rows,
  totals,
  workingDays,
}: {
  rows: RegisterRow[];
  totals: AttendanceRegister["totals"];
  workingDays: number;
}) {
  return (
    <TableShell caption="Хүүхэд тус бүрийн сарын санхүүжилтийн тооцоо">
      <thead className="bg-canvas">
        <tr>
          <Th className="w-[220px]">Хүүхэд</Th>
          <Th>Эх үүсвэр</Th>
          <Th numeric>Хоолны хоног</Th>
          <Th numeric>Өдрийн тариф</Th>
          <Th numeric title={`Өдрийн тариф × ажлын ${workingDays} өдөр`}>
            Нийт төлбөр
          </Th>
          <Th numeric>Суутгал</Th>
          <Th numeric>Эцсийн төлбөр</Th>
          <Th numeric>Баталгаажсан</Th>
          <Th>Төлөв</Th>
        </tr>
      </thead>

      <tbody>
        {rows.map((row) => (
          <tr key={row.child.id} className="hover:bg-canvas">
            <Td>
              <ChildCell row={row} />
            </Td>

            {row.funding ? (
              <>
                <Td>
                  <span className="text-caption text-muted">
                    {FUNDING_SOURCE_LABEL[row.funding.source]}
                  </span>
                </Td>
                <Td numeric>{row.funding.daysFed}</Td>
                <Td numeric>{formatTugrug(row.funding.dailyRate)}</Td>
                <Td numeric>{formatTugrug(row.funding.grossAmount)}</Td>
                <Td numeric>
                  {Number(row.funding.deductionAmount) > 0 ? (
                    <span className="text-danger">
                      −{formatTugrug(row.funding.deductionAmount)}
                    </span>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </Td>
                <Td numeric className="font-semibold text-ink">
                  {formatTugrug(row.funding.netAmount)}
                </Td>
                <Td numeric>{formatTugrug(row.funding.approvedAmount)}</Td>
              </>
            ) : (
              /*
               * ★ A child with no calculation gets one honest cell, not seven
               * dashes.
               *
               * They are here because they are enrolled; the reason there is no
               * figure is that no rule covers them or the month has not been
               * run — see `FundingService.calculateMonth`, which leaves such a
               * child out rather than funding them at zero. Seven "—" would
               * read as seven missing values instead of one missing answer.
               */
              <Td colSpan={7} className="text-caption text-muted">
                Тооцоо хийгдээгүй — энэ хүүхдэд тохирох санхүүжилтийн дүрэм алга байж болзошгүй.
              </Td>
            )}

            <Td>
              <StateBadge state={row.state} />
            </Td>
          </tr>
        ))}
      </tbody>

      <tfoot>
        <tr className="bg-canvas font-semibold">
          <Td>Нийт дүн</Td>
          <Td className="text-caption text-muted">{totals.children} хүүхэд</Td>
          <Td numeric>{totals.mealDays}</Td>
          <Td />
          <Td numeric>{formatTugrug(totals.grossAmount)}</Td>
          <Td numeric className="text-danger">
            {Number(totals.deductionAmount) > 0 ? `−${formatTugrug(totals.deductionAmount)}` : "—"}
          </Td>
          <Td numeric>{formatTugrug(totals.netAmount)}</Td>
          <Td numeric>{formatTugrug(totals.approvedAmount)}</Td>
          <Td />
        </tr>
      </tfoot>
    </TableShell>
  );
}

// ── Panels under the table ───────────────────────────────────────────────────

/**
 * ★ The alert names a count and a filter, not a "Шалгах" button.
 *
 * The drawing has a button beside this warning. A button implies an action the
 * screen can take, and there is none — nobody can conjure an акт from here; the
 * approval lives in `/attendance-requests/review`. So it filters the table to
 * exactly the rows in question, which is the actual next step, and links to
 * where the missing paperwork is approved.
 */
function AlertPanel({ register, className }: { register: AttendanceRegister; className?: string }) {
  const { needingCheck, missingDocuments } = register.totals;

  if (needingCheck === 0 && missingDocuments === 0) {
    return (
      <Card className={cn("flex items-start gap-3 border-mint px-4 py-4", className)}>
        <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-mint-ink" aria-hidden />
        <div>
          <p className="font-medium text-ink">Шалгах зүйл алга</p>
          <p className="mt-1 text-caption text-muted">
            Бүх тасалсан хоног баримтжсан, ирц хоолны бүртгэлтэй тохирч байна.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className={cn("flex flex-col gap-3 border-sun bg-sun/10 px-4 py-4", className)}>
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="mt-0.5 shrink-0 text-sun-ink" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium text-ink">Шалгах шаардлагатай мөр байна</p>
          <ul className="mt-1.5 flex flex-col gap-1 text-caption text-muted">
            {missingDocuments > 0 ? (
              <li>
                <strong className="font-semibold text-ink">{missingDocuments}</strong> хүүхдийн
                тасалсан хоногт баталгаажсан чөлөөний хүсэлт алга.
              </li>
            ) : null}
            {needingCheck > 0 ? (
              <li>
                <strong className="font-semibold text-ink">{needingCheck}</strong> хүүхдийн хоолны
                бүртгэл ирцээс их байна — хоёрын аль нэг нь буруу.
              </li>
            ) : null}
          </ul>
        </div>
      </div>

      <Button size="sm" variant="secondary" asChild className="self-start">
        <a href="/attendance-requests/review">Чөлөөний хүсэлт хянах</a>
      </Button>
    </Card>
  );
}

/** The tariffs the month was priced under — §5, read from the database. */
function RulesPanel({ register }: { register: AttendanceRegister }) {
  return (
    <Card className="px-4 py-4 sm:px-5">
      <SectionHeader title="Тооцооллын дүрэм" as="h3" />

      {register.rules.length === 0 ? (
        <p className="text-caption text-muted">
          Санхүүжилтийн дүрэм тохируулаагүй байна. Дүрэмгүйгээр тооцоо хийгдэхгүй.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {register.rules.map((rule) => (
            <li key={rule.id} className="flex flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-ink">{rule.name}</span>
                <span className="tabular-nums font-semibold text-ink">
                  {rule.dailyRate
                    ? `${formatTugrug(rule.dailyRate)}/өдөр`
                    : `${formatTugrug(rule.monthlyRate)}/сар`}
                </span>
              </div>
              <span className="text-caption text-muted">
                {FUNDING_SOURCE_LABEL[rule.source]} ·{" "}
                {rule.dependsOnAttendance && rule.dependsOnMeals
                  ? "ирц ба хоолноос хамаарна"
                  : rule.dependsOnMeals
                    ? "хооллосон өдрөөр"
                    : rule.dependsOnAttendance
                      ? "ирсэн өдрөөр"
                      : "ирцээс үл хамаарна"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * The formula, and when the month was last run.
 *
 * ★ Spelled out on the screen rather than left in a docblock.
 *
 * "Суутгал" is a derived figure — see `splitBilling` — and a number nobody can
 * reproduce is a number nobody trusts. Two lines of arithmetic here is the
 * difference between a director defending the claim and forwarding it.
 */
function ExplainerPanel({ register }: { register: AttendanceRegister }) {
  return (
    <Card className="flex flex-col gap-3 bg-sky/10 px-4 py-4 sm:px-5">
      <SectionHeader title="Тайлбар" as="h3" icon={<Info size={18} aria-hidden />} />

      <dl className="flex flex-col gap-2 text-caption">
        <div>
          <dt className="font-medium text-ink">Нийт төлбөр</dt>
          <dd className="text-muted">Өдрийн тариф × ажлын {register.workingDays} өдөр</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Суутгал</dt>
          <dd className="text-muted">Нийт төлбөр − эцсийн төлбөр</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Эцсийн төлбөр</dt>
          <dd className="text-muted">
            Дүрмийн тарифаар бодсон дүн — ирсэн буюу хооллосон хоногоор
          </dd>
        </div>
      </dl>

      <p className="text-caption text-muted">
        {register.calculatedAt
          ? `Сүүлийн тооцоолол — ${formatRelative(register.calculatedAt)}`
          : "Энэ сард тооцоолол хийгдээгүй байна."}
      </p>
    </Card>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "-mb-px min-h-[44px] border-b-2 px-1 text-lead font-semibold transition-colors",
        active ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink",
      )}
    >
      {children}
      <span className="ml-2 text-body font-medium tabular-nums text-faint">{count}</span>
    </button>
  );
}

/** What the three badges in the table mean, above the table rather than in a tooltip. */
function StateLegend({ className }: { className?: string }) {
  const shown: RegisterState[] = ["SETTLED", "MISSING_DOCUMENT", "CHECK"];

  return (
    <ul className={cn("flex flex-wrap items-center gap-3", className)}>
      {shown.map((state) => (
        <li key={state} className="flex items-center gap-1.5 text-caption text-muted">
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-pill",
              state === "SETTLED"
                ? "bg-mint-ink"
                : state === "MISSING_DOCUMENT"
                  ? "bg-sun-ink"
                  : "bg-danger",
            )}
          />
          {REGISTER_STATE_LABEL[state]}
        </li>
      ))}
    </ul>
  );
}

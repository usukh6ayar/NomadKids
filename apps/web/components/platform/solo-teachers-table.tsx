"use client";

import { useQuery } from "@tanstack/react-query";
import { FileDown, Search } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { paginated, soloWorkspaceSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { RowMenu } from "@/components/ui/menu";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { daysUntil, formatDate } from "@/lib/format";
import {
  FROZEN_NAME,
  FROZEN_NO,
  FilterChips,
  FilterSelect,
  SortHeader,
  labelOf,
  type Chip,
} from "@/components/platform/table-kit";

/*
 * «Багш дангаар» / «Бие даасан багш» — the solo teachers as the
 * kindergartens are: one table, shared by the tab on «Цэцэрлэгүүд» and the
 * page of its own (2026-10-14, the user: "цэцэрлэгүүдтэй ижил").
 */

/** Sums what the API sent; `null` while it sent none of it. */
function sumKnown(values: (number | null | undefined)[]): number | null {
  const known = values.filter((value): value is number => typeof value === "number");
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

const figure = (value: number | null) => (value === null ? "—" : value.toLocaleString("en-US"));

/*
 * ★ A solo teacher does not pay; each family pays its child's portal fee by
 * QPay, and the child is active once it does (2026-10-14, the user). So the
 * table counts the children who paid and those who have not. The API sends
 * `childCount` today; `paidChildCount` is asked of the admin — «—» until then.
 */
const soloRowSchema = soloWorkspaceSchema.extend({
  paidChildCount: z.number().int().nullish(),
  /*
   * «Төрийн» / «Төрийн бус» — asked on the sign-up form and kept, but the list
   * does not send it yet (asked of the admin, 2026-10-14); «—» until it does.
   */
  propertyType: z.string().nullish(),
  /*
   * ★ When the teacher was last active — 2026-10-14, the user: idle 14 days,
   * the operator is warned and may delete; idle 30, it is deleted on its own
   * (the nightly cleanup, asked of the admin). `null` = never signed in, so
   * idle since sign-up; absent = the API does not say yet, and nothing is
   * counted rather than everyone looking idle.
   */
  lastActiveAt: z.string().nullable().optional(),
});
export type SoloRow = z.infer<typeof soloRowSchema>;

const soloListSchema = paginated(soloRowSchema);

/**
 * «Б.Сувд» — the workspace's name without the « — бие даасан багш» the API
 * gives it (`solo-teachers.service.ts`): this table is the solo teachers', so
 * it says nothing (2026-10-14, the user). Display only; the name is unchanged.
 */
export function teacherName(row: { name: string }): string {
  return row.name.replace(/\s*—\s*бие даасан багш$/u, "");
}

export const IDLE_WARN_DAYS = 14;
export const IDLE_DELETE_DAYS = 30;

/** Days since the teacher was last active, or `null` while the API does not say. */
export function idleDays(row: SoloRow): number | null {
  if (row.lastActiveAt === undefined) return null;
  return Math.max(0, -daysUntil(row.lastActiveAt ?? row.createdAt));
}

/**
 * Whether the workspace may be deleted for idleness — 2026-10-14, the user: a
 * teacher whose children's families have paid, and whose fee still runs, is
 * never deleted; an empty workspace, or one whose fees have all run out, is.
 * `paidChildCount` counts the children paid for now; while the API does not
 * send it, nothing is offered for deletion.
 */
export function deletable(row: SoloRow): boolean {
  return row.paidChildCount === 0;
}

/** Children not yet paid for, or `null` while the API does not say. */
function unpaidOf(row: SoloRow): number | null {
  return typeof row.paidChildCount === "number"
    ? Math.max(0, row.childCount - row.paidChildCount)
    : null;
}

const OWNERSHIP_OPTIONS = [
  { value: "", label: "Бүгд" },
  { value: "Төрийн", label: "Төрийн" },
  { value: "Төрийн бус", label: "Төрийн бус" },
] as const;

/** «Бүгд», those active lately, or idle for 14 days and more. */
const ACTIVITY_OPTIONS = [
  { value: "", label: "Бүгд" },
  { value: "active", label: "Идэвхтэй" },
  { value: "idle", label: "14+ хоног идэвхгүй" },
] as const;

/** «Бүгд», every child paid for, or some child still waiting. */
const FEE_OPTIONS = [
  { value: "", label: "Бүгд" },
  { value: "all", label: "Бүгд төлсөн" },
  { value: "some", label: "Төлөөгүй хүүхэдтэй" },
] as const;

/** «Excel татах» for the solo teachers — the rows on screen, as the kindergartens' does. */
function downloadSoloSheet(rows: SoloRow[]) {
  const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const header = [
    "№",
    "Багш",
    "Ажилладаг цэцэрлэг",
    "Өмчийн хэлбэр",
    "Аймаг / дүүрэг",
    "Хүүхэд",
    "Төлсөн",
    "Төлөөгүй",
    "Утас",
    "И-мэйл",
    "Бүртгэсэн",
    "Сүүлд идэвхтэй",
  ];
  const body = rows.map((row, index) => [
    index + 1,
    teacherName(row),
    row.workplace ?? "",
    row.propertyType ?? "",
    row.location ?? "",
    row.childCount,
    row.paidChildCount ?? "",
    unpaidOf(row) ?? "",
    row.phone ?? "",
    row.email ?? "",
    formatDate(row.createdAt),
    row.lastActiveAt ? formatDate(row.lastActiveAt) : row.lastActiveAt === null ? "Нэвтрээгүй" : "",
  ]);
  const csv = [header, ...body].map((line) => line.map(quote).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "bie-daasan-bagsh.csv";
  link.click();
  URL.revokeObjectURL(url);
}

/** «Бүгд», those who named the kindergarten they work at, or those who did not. */
const WORKPLACE_OPTIONS = [
  { value: "", label: "Бүгд" },
  { value: "named", label: "Бичсэн" },
  { value: "blank", label: "Бичээгүй" },
] as const;

/** «Бүгд», teachers with children on their list, or those with none yet. */
const SOLO_CHILDREN_OPTIONS = [
  { value: "", label: "Бүгд" },
  { value: "some", label: "Хүүхэдтэй" },
  { value: "none", label: "Хүүхэдгүй" },
] as const;

type SoloSortKey = "name" | "area" | "children" | "unpaid" | "created" | "idle";

function compareSolo(a: SoloRow, b: SoloRow, key: SoloSortKey, dir: 1 | -1): number {
  const value = (row: SoloRow): string | number | null =>
    key === "name"
      ? teacherName(row)
      : key === "area"
        ? row.location || null
        : key === "children"
          ? row.childCount
          : key === "unpaid"
            ? unpaidOf(row)
            : key === "idle"
              ? idleDays(row)
              : row.createdAt;
  const x = value(a);
  const y = value(b);
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
  const order =
    typeof x === "number" && typeof y === "number"
      ? x - y
      : String(x).localeCompare(String(y), "mn");
  return order * dir;
}

/**
 * «Багш дангаар» — teachers working on their own, before their kindergarten
 * signs (#202). The same table and filter bar as the kindergartens
 * (2026-10-13, the user: "ийм байдлаар"); merging happens on «Бие даасан
 * багш», which the row's «⋯» opens.
 */
export function SoloTeachersTable({
  onMerge,
  onDelete,
  onResetPassword,
}: {
  /** Opens the merge here; without it, «⋯» links to «Бие даасан багш». */
  onMerge?: (row: SoloRow) => void;
  /** Offered from day 14 of idleness; without it, «⋯» has no «Устгах». */
  onDelete?: (row: SoloRow) => void;
  /** «Нууц үг сэргээх» — the teacher locked out with no one above them. */
  onResetPassword?: (row: SoloRow) => void;
}) {
  const [search, setSearch] = useState("");
  const [area, setArea] = useState("");
  const [workplace, setWorkplace] = useState("");
  const [children, setChildren] = useState("");
  const [fee, setFee] = useState("");
  const [ownership, setOwnership] = useState("");
  const [activity, setActivity] = useState("");
  const [sort, setSort] = useState<{ key: SoloSortKey; dir: 1 | -1 }>({
    key: "created",
    dir: -1,
  });
  const list = useQuery({
    queryKey: ["platform", "solo-workspaces"],
    queryFn: () => get("/platform/solo-workspaces?page=1&pageSize=100", soloListSchema),
  });
  const items = list.data?.items ?? [];
  const areas = [
    ...new Set(items.map((row) => row.location).filter((name): name is string => Boolean(name))),
  ].sort((a, b) => a.localeCompare(b, "mn"));
  const needle = search.trim().toLocaleLowerCase("mn");
  const rows = items
    .filter(
      (row) =>
        (!needle ||
          [row.name, row.workplace ?? "", row.location ?? ""].some((text) =>
            text.toLocaleLowerCase("mn").includes(needle),
          )) &&
        (!area || row.location === area) &&
        (!workplace || Boolean(row.workplace?.trim()) === (workplace === "named")) &&
        (!children || row.childCount > 0 === (children === "some")) &&
        (!ownership || row.propertyType === ownership) &&
        (!activity ||
          (idleDays(row) !== null && idleDays(row)! >= IDLE_WARN_DAYS === (activity === "idle"))) &&
        (!fee || (unpaidOf(row) !== null && unpaidOf(row)! > 0 === (fee === "some"))),
    )
    .sort((a, b) => compareSolo(a, b, sort.key, sort.dir));
  const chips = [
    search.trim() && { key: "q", label: `«${search.trim()}»`, clear: () => setSearch("") },
    area && { key: "area", label: area, clear: () => setArea("") },
    workplace && {
      key: "workplace",
      label: `Цэцэрлэг ${labelOf(WORKPLACE_OPTIONS, workplace).toLocaleLowerCase("mn")}`,
      clear: () => setWorkplace(""),
    },
    children && {
      key: "children",
      label: labelOf(SOLO_CHILDREN_OPTIONS, children),
      clear: () => setChildren(""),
    },
    ownership && { key: "ownership", label: ownership, clear: () => setOwnership("") },
    activity && {
      key: "activity",
      label: labelOf(ACTIVITY_OPTIONS, activity),
      clear: () => setActivity(""),
    },
    fee && { key: "fee", label: labelOf(FEE_OPTIONS, fee), clear: () => setFee("") },
  ].filter((chip): chip is Chip => Boolean(chip));
  const clearAll = () => {
    setSearch("");
    setArea("");
    setWorkplace("");
    setChildren("");
    setFee("");
    setOwnership("");
    setActivity("");
  };
  const sortBy = (key: SoloSortKey) =>
    setSort((current) => ({ key, dir: current.key === key ? (-current.dir as 1 | -1) : 1 }));
  const cell =
    "border-b border-r border-border-soft px-3 py-2 align-middle bg-white group-hover:bg-slate-50 last:border-r-0";

  return (
    <section aria-label="Бие даасан багшийн жагсаалт" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 sm:max-w-[480px]">
          <span className="sr-only">Багш, цэцэрлэгээр хайх</span>
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <Input
            type="search"
            aria-label="Багш, цэцэрлэгээр хайх"
            placeholder="Багшийн нэр, цэцэрлэгээр хайх"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9 text-compact"
          />
        </label>
        {list.data ? (
          <span className="ml-auto flex items-center gap-2">
            <span className="text-caption text-muted">
              {chips.length ? `${items.length}-оос ${rows.length}` : rows.length} багш
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={rows.length === 0}
              onClick={() => downloadSoloSheet(rows)}
            >
              <FileDown size={16} aria-hidden="true" />
              Excel татах
            </Button>
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FilterSelect
          label="Өмчийн хэлбэр"
          ariaLabel="Багшийг өмчийн хэлбэрээр шүүх"
          value={ownership}
          onChange={setOwnership}
          options={OWNERSHIP_OPTIONS}
        />
        <FilterSelect
          label="Аймаг / дүүрэг"
          ariaLabel="Багшийг аймаг, дүүргээр шүүх"
          value={area}
          onChange={setArea}
          options={[
            { value: "", label: "Бүгд" },
            ...areas.map((name) => ({ value: name, label: name })),
          ]}
        />
        <FilterSelect
          label="Ажилладаг цэцэрлэг"
          ariaLabel="Ажилладаг цэцэрлэгээр шүүх"
          value={workplace}
          onChange={setWorkplace}
          options={WORKPLACE_OPTIONS}
        />
        <FilterSelect
          label="Хүүхэд"
          ariaLabel="Хүүхдийн тоогоор шүүх"
          value={children}
          onChange={setChildren}
          options={SOLO_CHILDREN_OPTIONS}
        />
        <FilterSelect
          label="Хүүхдийн төлбөр"
          ariaLabel="Хүүхдийн төлбөрөөр шүүх"
          value={fee}
          onChange={setFee}
          options={FEE_OPTIONS}
        />
        <FilterSelect
          label="Идэвх"
          ariaLabel="Идэвхээр шүүх"
          value={activity}
          onChange={setActivity}
          options={ACTIVITY_OPTIONS}
        />
      </div>
      <FilterChips chips={chips} onClearAll={clearAll} />

      {list.isLoading ? <LoadingState rows={4} /> : null}
      {list.isError ? <ErrorState description={errorMessage(list.error)} /> : null}
      {list.data && rows.length === 0 ? (
        <EmptyState
          title="Бие даасан багш алга"
          description={
            chips.length
              ? "Шүүлтүүрээ өөрчилж үзнэ үү."
              : "Багш «Үнийн санал» хуудаснаас бүртгүүлэхэд энд харагдана."
          }
        />
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-control border border-border bg-white">
          <table className="w-full min-w-[1400px] border-separate border-spacing-0 text-left text-caption">
            <thead className="bg-slate-50 text-muted">
              <tr className="[&>th]:whitespace-nowrap [&>th]:border-b [&>th]:border-r [&>th]:border-border [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold [&>th:last-child]:border-r-0">
                <th scope="col" className={`${FROZEN_NO} bg-slate-50 text-right`}>
                  №
                </th>
                <SortHeader
                  label="Багш"
                  column="name"
                  sort={sort}
                  onSort={sortBy}
                  className={`${FROZEN_NAME} bg-slate-50`}
                />
                <th scope="col">Ажилладаг цэцэрлэг</th>
                <th scope="col">Өмчийн хэлбэр</th>
                <SortHeader label="Аймаг / дүүрэг" column="area" sort={sort} onSort={sortBy} />
                <SortHeader
                  label="Хүүхэд"
                  column="children"
                  sort={sort}
                  onSort={sortBy}
                  align="right"
                />
                <th scope="col" className="text-right">
                  Төлсөн
                </th>
                <SortHeader
                  label="Төлөөгүй"
                  column="unpaid"
                  sort={sort}
                  onSort={sortBy}
                  align="right"
                />
                <th scope="col">Утас</th>
                <th scope="col">И-мэйл</th>
                <SortHeader label="Бүртгэсэн" column="created" sort={sort} onSort={sortBy} />
                <SortHeader label="Сүүлд идэвхтэй" column="idle" sort={sort} onSort={sortBy} />
                <th scope="col" className="w-10">
                  <span className="sr-only">Үйлдэл</span>
                </th>
              </tr>
              <tr className="[&>td]:border-b-2 [&>td]:border-r [&>td]:border-border [&>td]:bg-slate-50 [&>td]:px-3 [&>td]:py-2 [&>td]:font-semibold [&>td]:text-ink [&>td:last-child]:border-r-0">
                <td className={FROZEN_NO} />
                <td className={FROZEN_NAME}>Нийт: {rows.length} багш</td>
                <td />
                <td />
                <td />
                <td className="text-right tabular-nums">
                  {rows.reduce((sum, row) => sum + row.childCount, 0).toLocaleString("en-US")}
                </td>
                <td className="text-right tabular-nums">
                  {figure(sumKnown(rows.map((row) => row.paidChildCount)))}
                </td>
                <td className="text-right tabular-nums">{figure(sumKnown(rows.map(unpaidOf)))}</td>
                <td colSpan={5} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id} className="group">
                  <td className={`${cell} ${FROZEN_NO} text-right tabular-nums text-muted`}>
                    {index + 1}
                  </td>
                  <td className={`${cell} ${FROZEN_NAME} font-semibold text-ink`}>
                    {teacherName(row)}
                  </td>
                  <td className={cell}>{row.workplace || "—"}</td>
                  <td className={cell}>{row.propertyType || "—"}</td>
                  <td className={cell}>{row.location || "—"}</td>
                  <td className={`${cell} text-right tabular-nums`}>{row.childCount}</td>
                  <td className={`${cell} text-right tabular-nums`}>{row.paidChildCount ?? "—"}</td>
                  <td
                    className={`${cell} text-right tabular-nums ${
                      (unpaidOf(row) ?? 0) > 0 ? "font-semibold text-danger" : ""
                    }`}
                  >
                    {unpaidOf(row) ?? "—"}
                  </td>
                  <td className={`${cell} whitespace-nowrap tabular-nums`}>{row.phone || "—"}</td>
                  <td className={`${cell} max-w-[200px] truncate`}>{row.email || "—"}</td>
                  <td className={`${cell} whitespace-nowrap tabular-nums`}>
                    {formatDate(row.createdAt)}
                  </td>
                  <td className={`${cell} whitespace-nowrap`}>
                    <IdleCell row={row} />
                  </td>
                  <td className={`${cell} text-right`}>
                    <RowMenu
                      ariaLabel={`${teacherName(row)} — үйлдэл`}
                      items={[
                        onMerge
                          ? { label: "Цэцэрлэгт нэгтгэх", onSelect: () => onMerge(row) }
                          : { label: "Цэцэрлэгт нэгтгэх", href: "/platform/solo-workspaces" },
                        ...(onResetPassword
                          ? [{ label: "Нууц үг сэргээх", onSelect: () => onResetPassword(row) }]
                          : []),
                        // From day 14 only — an action that cannot run is not shown.
                        ...(onDelete && deletable(row) && (idleDays(row) ?? 0) >= IDLE_WARN_DAYS
                          ? [
                              {
                                label: "Устгах",
                                onSelect: () => onDelete(row),
                                tone: "danger" as const,
                                separated: true,
                              },
                            ]
                          : []),
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

/**
 * «Сүүлд идэвхтэй» — the day, and from day 14 how long until it goes:
 * «16 хоног идэвхгүй · 14 хоногийн дараа устна».
 */
function IdleCell({ row }: { row: SoloRow }) {
  const idle = idleDays(row);
  if (idle === null) return <>—</>;
  const left = IDLE_DELETE_DAYS - idle;
  const goes = deletable(row);
  return (
    <span className="inline-flex items-center gap-2">
      {row.lastActiveAt ? formatDate(row.lastActiveAt) : "Нэвтрээгүй"}
      {idle >= IDLE_WARN_DAYS ? (
        <span
          className={`rounded-pill px-2 py-0.5 text-caption font-semibold ${
            !goes
              ? "bg-slate-100 text-slate-700"
              : left <= 3
                ? "bg-red-100 text-red-700"
                : "bg-amber-100 text-amber-800"
          }`}
        >
          {idle} хоног идэвхгүй ·{" "}
          {!goes
            ? "төлбөртэй хүүхэдтэй тул устахгүй"
            : left > 0
              ? `${left} хоногийн дараа устна`
              : "өнөөдөр устна"}
        </span>
      ) : null}
    </span>
  );
}

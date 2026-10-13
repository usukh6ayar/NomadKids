"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { Building2, FileDown, Plus, Search } from "lucide-react";
import { paginated, platformKindergartenSchema, platformStatsSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { RequireSuperAdmin } from "@/components/shell/require-role";
import { useToggleKindergartenActive } from "@/components/admin/toggle-kindergarten-active";
import { RowMenu } from "@/components/ui/menu";
import { DeleteKindergartenButton } from "@/components/admin/delete-kindergarten-button";
import { RegisterKindergartenDialog } from "@/components/platform/register-kindergarten-dialog";
import { PlatformPageHeading } from "@/components/platform/platform-page-heading";
import { PlatformStatsStrip } from "@/components/platform/platform-stats-strip";
import { daysUntil, formatDate } from "@/lib/format";

/** "" = no filter (Бүгд); the API's `isActive` param is a `z.stringbool()`. */
const STATUS_OPTIONS = [
  { value: "", label: "Бүгд" },
  { value: "true", label: "Идэвхтэй" },
  { value: "false", label: "Идэвхгүй" },
] as const;

/*
 * ★ The columns the operator asked for (2026-10-13). The list route returns
 * name, address, phone, e-mail and state today; ownership, province/district,
 * the ESIS number, the group count and the contract's end date are read when
 * the API adds them and show «—» until then — never a guessed value.
 */
const rowSchema = platformKindergartenSchema.extend({
  propertyType: z.string().nullish(),
  province: z.string().nullish(),
  district: z.string().nullish(),
  esisInstitutionId: z.string().nullish(),
  groupCount: z.number().int().nullish(),
  /** The contract's first day; the registration date stands in until it is sent. */
  contractStartsOn: z.string().nullish(),
  /** The contract's last day — a red date within 14 days of it. */
  contractEndsOn: z.string().nullish(),
  /** Linked to ESIS; read from `esisInstitutionId` until the API says so itself. */
  esisConnected: z.boolean().nullish(),
});
type Row = z.infer<typeof rowSchema>;
const listSchema = paginated(rowSchema);

/**
 * The platform operator's overview: register and inspect kindergartens.
 *
 * ★ Registering one always creates its first ADMIN, never a teacher or a
 * parent directly. From that account on, the kindergarten runs itself — its
 * own admin invites teachers from `/admin/users`, and teachers invite
 * families from a child's page. The operator does not reach further down than
 * this; §7 keeps that out of the MVP's platform surface on purpose.
 *
 * No password is set here, for the same reason `/admin/users` never sets one:
 * the API generates a throwaway hash and an invitation token, and the
 * director chooses their own password on `/invitation/[token]`.
 */
export default function PlatformPage() {
  return (
    <RequireSuperAdmin>
      <Platform />
    </RequireSuperAdmin>
  );
}

function Platform() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [ownership, setOwnership] = useState("");
  const [area, setArea] = useState("");
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });

  const stats = useQuery({
    queryKey: qk.platformStats(),
    queryFn: () => get("/platform/stats", platformStatsSchema),
  });

  const kindergartens = useQuery({
    queryKey: qk.platformKindergartens({ q: query, isActive: status }),
    queryFn: () => {
      const params = new URLSearchParams({ page: "1", pageSize: "50" });
      if (query.trim()) params.set("q", query.trim());
      if (status) params.set("isActive", status);
      return get(`/platform/kindergartens?${params}`, listSchema);
    },
  });

  const items = kindergartens.data?.items ?? [];
  // Ownership and area are filtered here, over the page the API returned (50).
  const areas = [
    ...new Set(items.map(areaOf).filter((name): name is string => Boolean(name))),
  ].sort((a, b) => a.localeCompare(b, "mn"));
  const rows = items
    .filter((kg) => (!ownership || kg.propertyType === ownership) && (!area || areaOf(kg) === area))
    .sort((a, b) => compareRows(a, b, sort.key, sort.dir));
  const sortBy = (key: SortKey) =>
    setSort((current) => ({ key, dir: current.key === key ? (-current.dir as 1 | -1) : 1 }));

  return (
    <div className="flex flex-col gap-5 pb-8">
      <PlatformPageHeading
        title="Цэцэрлэгүүд"
        lede="Байгууллагуудын бүртгэл, идэвх болон хамрах хүрээг нэг дороос хянаарай."
        backHref={null}
        mark={<Building2 />}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={18} aria-hidden="true" />
            Цэцэрлэг бүртгэх
          </Button>
        }
      />

      {stats.data ? <PlatformStatsStrip stats={stats.data} /> : null}

      {/*
        ★ ЭСИС-тэй тулгалт, platform-wide — 2026-09-24, the same request that
        put it on the director's dashboard: how much of this came from the
        ministry, and how much of it can actually sign in.

        ★★ Local sums, no outbound call. `EsisStaffRoster` holds every tenant's
        staff list already; reading each kindergarten live would be one request
        per tenant on a page open.

        ★★★ The children and group figures count records carrying a ministry
        id — provenance, not ESIS's own totals, which are not stored. Labelled
        as such rather than presented as the ministry's number.
      */}
      {stats.data?.esis ? (
        <section
          aria-label="ЭСИС-тэй тулгалт"
          className="rounded-card border border-border bg-white px-4 py-3"
        >
          <h2 className="text-caption font-semibold uppercase tracking-[0.12em] text-muted">
            ЭСИС-тэй тулгалт
          </h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 xl:grid-cols-5">
            <PlatformEsisFigure
              label="Холбогдсон цэцэрлэг"
              value={`${stats.data.esis.connected} / ${stats.data.kindergartens}`}
            />
            <PlatformEsisFigure
              label="ЭСИС-д бүртгэлтэй ажилтан"
              value={stats.data.esis.staffInRoster}
            />
            <PlatformEsisFigure
              label="Системд бүртгэлтэй ажилтан"
              value={stats.data.esis.staffRegistered}
            />
            <PlatformEsisFigure
              label="ЭСИС-тэй холбогдсон бүртгэл"
              value={`${stats.data.esis.staffLinked} / ${stats.data.esis.staffRegistered}`}
              /* The one figure that is a backlog: an unlinked account is a
                 person the staff directory cannot match to their ESIS row. */
              warn={stats.data.esis.staffLinked < stats.data.esis.staffRegistered}
            />
            <PlatformEsisFigure
              label="ЭСИС-ээс ирсэн суралцагч"
              value={`${stats.data.esis.childrenLinked} / ${stats.data.children}`}
            />
          </dl>
        </section>
      ) : null}

      <section aria-label="Цэцэрлэгийн жагсаалт" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 sm:max-w-[320px]">
            <span className="sr-only">Нэрээр хайх</span>
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <Input
              type="search"
              aria-label="Нэрээр хайх"
              placeholder="Цэцэрлэгийн нэрээр хайх"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 pl-9 text-compact"
            />
          </label>
          <Select
            aria-label="Өмчийн хэлбэрээр шүүх"
            value={ownership}
            onChange={(e) => setOwnership(e.target.value)}
            className="h-9 w-full text-compact sm:w-[150px]"
          >
            <option value="">Өмчийн хэлбэр</option>
            <option value="Төрийн">Төрийн</option>
            <option value="Төрийн бус">Төрийн бус</option>
          </Select>
          <Select
            aria-label="Аймаг, дүүргээр шүүх"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            className="h-9 w-full text-compact sm:w-[170px]"
          >
            <option value="">Аймаг / дүүрэг</option>
            {areas.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Төлвөөр шүүх"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 w-full text-compact sm:w-[130px]"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value ? option.label : "Төлөв"}
              </option>
            ))}
          </Select>
          {kindergartens.data ? (
            <span className="ml-auto flex items-center gap-2">
              <span className="text-caption text-muted">{rows.length} цэцэрлэг</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={rows.length === 0}
                onClick={() => downloadSheet(rows)}
              >
                <FileDown size={16} aria-hidden="true" />
                Excel татах
              </Button>
            </span>
          ) : null}
        </div>

        {kindergartens.isLoading ? <LoadingState rows={5} /> : null}
        {kindergartens.isError ? (
          <ErrorState description={errorMessage(kindergartens.error)} />
        ) : null}

        {kindergartens.data && rows.length === 0 ? (
          <EmptyState
            title="Цэцэрлэг олдсонгүй"
            description={
              query || status || ownership || area
                ? "Хайлт, шүүлтээ өөрчилж үзнэ үү."
                : "Эхний цэцэрлэгээ бүртгээрэй."
            }
          />
        ) : null}

        {rows.length > 0 ? (
          <div className="overflow-x-auto rounded-control border border-border bg-white">
            <table className="w-full min-w-[1200px] border-separate border-spacing-0 text-left text-caption">
              <thead className="bg-slate-50 text-muted">
                <tr className="[&>th]:whitespace-nowrap [&>th]:border-b [&>th]:border-r [&>th]:border-border [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold [&>th:last-child]:border-r-0">
                  <th scope="col" className={`${FROZEN_NO} bg-slate-50 text-right`}>
                    №
                  </th>
                  <SortHeader
                    label="Цэцэрлэг"
                    column="name"
                    sort={sort}
                    onSort={sortBy}
                    className={`${FROZEN_NAME} bg-slate-50`}
                  />
                  <th scope="col">Өмчийн хэлбэр</th>
                  <SortHeader label="Аймаг / дүүрэг" column="area" sort={sort} onSort={sortBy} />
                  <th scope="col">ЭСИС</th>
                  <SortHeader
                    label="Бүлэг"
                    column="groups"
                    sort={sort}
                    onSort={sortBy}
                    align="right"
                  />
                  <th scope="col">Утас</th>
                  <th scope="col">И-мэйл</th>
                  <SortHeader label="Эхэлсэн" column="start" sort={sort} onSort={sortBy} />
                  <SortHeader label="Дуусах" column="contract" sort={sort} onSort={sortBy} />
                  <th scope="col">Төлөв</th>
                  <th scope="col" className="w-10">
                    <span className="sr-only">Үйлдэл</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((kg, index) => (
                  <KindergartenRow
                    key={kg.id}
                    kg={kg}
                    index={index + 1}
                    onDelete={() => setDeleting(kg)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {deleting ? (
        <DeleteKindergartenButton
          kindergarten={deleting}
          open
          onOpenChange={(next) => (next ? undefined : setDeleting(null))}
          onDeleted={() => setDeleting(null)}
        />
      ) : null}

      {creating ? <RegisterKindergartenDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

/** One figure in the platform's ESIS strip. */
function PlatformEsisFigure({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: string | number;
  warn?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-muted">{label}</dt>
      <dd
        className={`mt-0.5 truncate text-body font-semibold tabular-nums ${
          warn ? "text-sun-ink" : "text-ink"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/** «Сүхбаатар аймаг · Сүхбаатар сум», or what the record has. */
function areaOf(kg: Row): string | null {
  return [kg.province, kg.district].filter(Boolean).join(" · ") || null;
}

/*
 * ★ № and the name stay put while the rest scrolls sideways — 2026-10-13,
 * the user. `border-separate` (not `collapse`) so a sticky cell keeps its own
 * borders; the faint shadow marks the edge the columns slide under.
 */
const FROZEN_NO = "sticky left-0 z-10 w-10 min-w-10";
const FROZEN_NAME = "sticky left-10 z-10 min-w-[200px] shadow-[1px_0_0_0_var(--color-border)]";

/** ESIS: «Холбогдсон» with the institution number, or «Холбогдоогүй». */
function EsisCell({ kg }: { kg: Row }) {
  const connected = kg.esisConnected ?? Boolean(kg.esisInstitutionId);
  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-pill ${connected ? "bg-emerald-500" : "bg-slate-300"}`}
        />
        {connected ? "Холбогдсон" : "Холбогдоогүй"}
      </span>
      {kg.esisInstitutionId ? (
        <span className="pl-3 tabular-nums text-muted">{kg.esisInstitutionId}</span>
      ) : null}
    </span>
  );
}

/** When the kindergarten began using NomadKids: the contract, else registration. */
function startedOn(kg: Row): string {
  return kg.contractStartsOn ?? kg.createdAt;
}

function KindergartenRow({
  kg,
  index,
  onDelete,
}: {
  kg: Row;
  index: number;
  onDelete: () => void;
}) {
  const toggle = useToggleKindergartenActive(kg);
  const cell =
    "border-b border-r border-border-soft px-3 py-2 align-middle bg-white group-hover:bg-slate-50 last:border-r-0";
  return (
    <tr className="group">
      <td className={`${cell} ${FROZEN_NO} text-right tabular-nums text-muted`}>{index}</td>
      <td className={`${cell} ${FROZEN_NAME}`}>
        <Link
          href={`/platform/${kg.id}`}
          className="font-semibold text-ink hover:text-primary hover:underline"
        >
          {kg.name}
        </Link>
      </td>
      <td className={cell}>{kg.propertyType || "—"}</td>
      <td className={cell}>{areaOf(kg) ?? "—"}</td>
      <td className={cell}>
        <EsisCell kg={kg} />
      </td>
      <td className={`${cell} text-right tabular-nums`}>{kg.groupCount ?? "—"}</td>
      <td className={`${cell} whitespace-nowrap tabular-nums`}>{kg.phone || "—"}</td>
      <td className={`${cell} max-w-[200px] truncate`}>{kg.email || "—"}</td>
      <td className={`${cell} whitespace-nowrap tabular-nums`}>{formatDate(startedOn(kg))}</td>
      <td className={`${cell} whitespace-nowrap tabular-nums`}>
        {kg.contractEndsOn ? (
          <span className={daysUntil(kg.contractEndsOn) <= 14 ? "font-semibold text-danger" : ""}>
            {formatDate(kg.contractEndsOn)}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className={cell}>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-pill ${kg.isActive ? "bg-emerald-500" : "bg-slate-300"}`}
          />
          {kg.isActive ? "Идэвхтэй" : "Идэвхгүй"}
        </span>
      </td>
      <td className={`${cell} text-right`}>
        <RowMenu
          ariaLabel={`${kg.name} — үйлдэл`}
          items={[
            { label: "Дэлгэрэнгүй", href: `/platform/${kg.id}` },
            {
              label: kg.isActive ? "Идэвхгүй болгох" : "Идэвхжүүлэх",
              onSelect: toggle.run,
            },
            { label: "Устгах", onSelect: onDelete, tone: "danger", separated: true },
          ]}
        />
      </td>
    </tr>
  );
}

type SortKey = "name" | "area" | "groups" | "start" | "contract";

/** Missing values sort last whichever way the column runs. */
function compareRows(a: Row, b: Row, key: SortKey, dir: 1 | -1): number {
  const value = (row: Row): string | number | null =>
    key === "name"
      ? row.name
      : key === "area"
        ? areaOf(row)
        : key === "groups"
          ? (row.groupCount ?? null)
          : key === "start"
            ? startedOn(row)
            : (row.contractEndsOn ?? null);
  const x = value(a);
  const y = value(b);
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
  const order =
    typeof x === "number" && typeof y === "number"
      ? x - y
      : String(x).localeCompare(String(y), "mn");
  return order * dir;
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
  align = "left",
  className,
}: {
  label: string;
  column: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (column: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === column;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      className={
        [align === "right" ? "text-right" : "", className ?? ""].join(" ").trim() || undefined
      }
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-1 font-semibold hover:text-ink ${active ? "text-ink" : ""}`}
      >
        {label}
        <span aria-hidden="true" className="text-faint">
          {active ? (sort.dir === 1 ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

/**
 * «Excel татах» — the rows on screen, filtered and sorted, as a CSV Excel
 * opens with its Cyrillic intact (the UTF-8 mark first), the way the yearly
 * attendance export does.
 */
function downloadSheet(rows: Row[]) {
  const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const header = [
    "№",
    "Цэцэрлэг",
    "Өмчийн хэлбэр",
    "Аймаг / дүүрэг",
    "ЭСИС холболт",
    "ЭСИС дугаар",
    "Бүлэг",
    "Утас",
    "И-мэйл",
    "Эхэлсэн",
    "Дуусах",
    "Төлөв",
  ];
  const body = rows.map((kg, index) => [
    index + 1,
    kg.name,
    kg.propertyType ?? "",
    areaOf(kg) ?? "",
    (kg.esisConnected ?? Boolean(kg.esisInstitutionId)) ? "Холбогдсон" : "Холбогдоогүй",
    kg.esisInstitutionId ?? "",
    kg.groupCount ?? "",
    kg.phone ?? "",
    kg.email ?? "",
    formatDate(startedOn(kg)),
    kg.contractEndsOn ? formatDate(kg.contractEndsOn) : "",
    kg.isActive ? "Идэвхтэй" : "Идэвхгүй",
  ]);
  const csv = [header, ...body].map((line) => line.map(quote).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "tsetserleguud.csv";
  link.click();
  URL.revokeObjectURL(url);
}

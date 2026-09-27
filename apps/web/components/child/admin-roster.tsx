"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Info, MoreHorizontal, Plus, RefreshCw } from "lucide-react";
import { SEX_LABEL, childSummarySchema, groupListItemSchema, paginated } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { downloadUrl } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { useDebounced } from "@/lib/use-debounced";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { RowMenu } from "@/components/ui/menu";
import { Pagination } from "@/components/ui/pagination";
import { SearchField } from "@/components/ui/search-field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Td, Th } from "@/components/ui/table";
import type { z } from "zod";
import { useRouter } from "next/navigation";

const listSchema = paginated(childSummarySchema);
const groupsSchema = paginated(groupListItemSchema);

const PAGE_SIZES = [20, 50, 100] as const;

/**
 * The director's roster — client, 2026-09-25, with a drawing: one compact
 * table of every child, filtered by group, sex and discount, searched by name.
 *
 * ★ Nothing on it is invented. Two things the drawing shows have no data
 * behind them yet — a child's discount (Хөнгөлөлт) and their ESIS match state
 * (ESIS төлөв) — and neither does the date the national register last synced.
 * Their columns, the discount filter and the summary figures are drawn, and
 * read "—" until the API sends real values; nothing is guessed from other
 * fields. The same goes for the "ESIS Хөнгөлөлттэй" button, which has no
 * screen or action to open and is shown disabled.
 *
 * A teacher's roster is unchanged; this is the administrator's only.
 */
export function AdminRoster() {
  const { primaryKindergartenId } = useSession();
  const [typed, setTyped] = useState("");
  const search = useDebounced(typed.trim());
  const [groupId, setGroupId] = useState("");
  const [sex, setSex] = useState<"" | "MALE" | "FEMALE">("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(20);

  const filters = new URLSearchParams();
  if (search) filters.set("q", search);
  if (groupId) filters.set("groupId", groupId);
  if (sex) filters.set("sex", sex);
  filters.set("sort", "name");
  filters.set("order", "asc");
  const filterQuery = filters.toString();

  const roster = useQuery({
    queryKey: qk.children({
      q: search || undefined,
      groupId: groupId || undefined,
      sex: sex || undefined,
      sort: "name",
      order: "asc",
      page,
      pageSize,
    }),
    queryFn: () => get(`/children?${filterQuery}&page=${page}&pageSize=${pageSize}`, listSchema),
  });

  const groups = useQuery({
    queryKey: qk.groups({ pageSize: 100 }),
    queryFn: () => get("/groups?page=1&pageSize=100", groupsSchema),
    staleTime: 60_000,
  });

  // A filter change starts the list again from its first page.
  const resetting =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };

  const data = roster.data;
  const offset = (page - 1) * pageSize;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Суралцагч"
        backHref="/dashboard"
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {primaryKindergartenId ? (
              <Button asChild size="sm" variant="secondary">
                <a
                  href={downloadUrl(
                    `/kindergartens/${primaryKindergartenId}/children/export?${filterQuery}`,
                  )}
                >
                  <Download size={16} aria-hidden /> Excel
                </a>
              </Button>
            ) : null}
            {/* No screen or action exists for this yet — shown, never faked. */}
            <Button
              size="sm"
              variant="secondary"
              disabled
              title="ESIS-ийн хөнгөлөлтийн мэдээлэл хараахан холбогдоогүй байна"
            >
              <RefreshCw size={16} aria-hidden /> ESIS Хөнгөлөлттэй
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link href="/admin/integrations/esis">
                <RefreshCw size={16} aria-hidden /> ESIS Суралцагч
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/children/new">
                <Plus size={16} aria-hidden /> Суралцагч
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[180px_160px_200px_minmax(0,1fr)]">
        <Select
          aria-label="Бүлэг"
          value={groupId}
          onChange={(event) => resetting(setGroupId)(event.target.value)}
        >
          <option value="">Бүх бүлэг</option>
          {(groups.data?.items ?? []).map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Хүйс"
          value={sex}
          onChange={(event) => resetting(setSex)(event.target.value as "" | "MALE" | "FEMALE")}
        >
          <option value="">Бүх хүйс</option>
          <option value="FEMALE">{SEX_LABEL.FEMALE}</option>
          <option value="MALE">{SEX_LABEL.MALE}</option>
        </Select>
        {/*
          Drawn and disabled: the API has no discount field to filter on yet.
          Enabling it before then would filter nothing while claiming to.
        */}
        <Select
          aria-label="Хөнгөлөлт"
          value=""
          disabled
          title="Хөнгөлөлтийн мэдээлэл хараахан холбогдоогүй байна"
        >
          <option value="">Бүгд (хөнгөлөлт)</option>
          <option value="WITH">Хөнгөлөлттэй</option>
          <option value="WITHOUT">Хөнгөлөлтгүй</option>
        </Select>
        <SearchField
          label="Нэр эсвэл регистрээр хайх"
          placeholder="Нэр эсвэл регистрээр хайх..."
          value={typed}
          onChange={resetting(setTyped)}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-caption text-muted">
        <p aria-live="polite">
          Нийт <span className="font-semibold tabular-nums text-ink">{data?.total ?? "—"}</span>{" "}
          суралцагч · Хөнгөлөлттэй <span className="text-ink">—</span> · Хөнгөлөлтгүй{" "}
          <span className="text-ink">—</span>
        </p>
        <p className="inline-flex items-center gap-1">
          <Info size={14} aria-hidden /> Нэгдсэн журмаар шинэчлэгдсэн: —
        </p>
      </div>

      {roster.isLoading ? <LoadingState rows={6} /> : null}
      {roster.isError ? <ErrorState description={errorMessage(roster.error)} /> : null}

      {data && data.items.length === 0 ? (
        <EmptyState
          title="Суралцагч олдсонгүй"
          description="Шүүлтүүр эсвэл хайлтаа өөрчилж үзнэ үү."
        />
      ) : null}

      {data && data.items.length > 0 ? (
        <ChildRosterTable caption="Суралцагчийн жагсаалт" items={data.items} offset={offset} />
      ) : null}

      {data ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-caption text-muted">
            Нийт <span className="tabular-nums">{data.total}</span> суралцагч
          </p>
          <Pagination page={page} totalPages={data.totalPages} onPage={setPage} />
          <label className="flex items-center gap-2 text-caption text-muted">
            Хуудас тутамд:
            <Select
              aria-label="Хуудас тутамд"
              value={String(pageSize)}
              onChange={(event) => {
                setPageSize(Number(event.target.value) as (typeof PAGE_SIZES)[number]);
                setPage(1);
              }}
              className="h-9 w-auto px-2"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={String(size)}>
                  {size}
                </option>
              ))}
            </Select>
          </label>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The director's roster table — shared by Суралцагч and a group's own page
 * (client, 2026-09-25: the group's children "ийм загвараар"). Plain and
 * unclipped, so the ⋯ menu opens whole over the rows beneath it.
 *
 * Discount and ESIS state have no data behind them yet and read "—".
 */
export function ChildRosterTable({
  caption,
  items,
  offset = 0,
}: {
  caption: string;
  items: z.infer<typeof childSummarySchema>[];
  offset?: number;
}) {
  const router = useRouter();
  return (
    <div className="rounded-card border border-border bg-surface">
      <table className="w-full border-collapse text-body">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <Th className="w-12 rounded-tl-card py-2">№</Th>
            <Th className="py-2">Суралцагчийн нэр</Th>
            <Th className="py-2">Регистр</Th>
            <Th className="py-2">Хүйс</Th>
            <Th className="py-2">Бүлэг</Th>
            <Th className="py-2">Хөнгөлөлт</Th>
            <Th className="py-2">ESIS төлөв</Th>
            <Th className="w-12 rounded-tr-card py-2">
              <span className="sr-only">Үйлдэл</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {items.map((child, index) => (
            <tr key={child.id} className="hover:bg-sunken/60">
              <Td className="py-1.5 tabular-nums text-muted">{offset + index + 1}</Td>
              <Td className="py-1.5">
                <Link
                  href={`/children/${child.id}/general`}
                  className="font-medium text-ink hover:text-primary hover:underline"
                >
                  {child.lastName} {child.firstName}
                </Link>
              </Td>
              <Td className="py-1.5 tabular-nums text-muted">
                {child.nationalId ?? child.foreignId ?? "—"}
              </Td>
              <Td className="py-1.5 text-muted">{(child.sex && SEX_LABEL[child.sex]) || "—"}</Td>
              <Td className="py-1.5 text-muted">{child.enrollments?.[0]?.group?.name ?? "—"}</Td>
              {/* No discount on the record yet — see the note above. */}
              <Td className="py-1.5 text-faint">—</Td>
              {/* No ESIS match state on the record yet — see the note above. */}
              <Td className="py-1.5 text-faint">—</Td>
              <Td className="py-1 text-right">
                <RowMenu
                  ariaLabel={`${child.lastName} ${child.firstName} — үйлдэл`}
                  triggerIcon={<MoreHorizontal size={18} aria-hidden="true" />}
                  items={[
                    {
                      label: "Дэлгэрэнгүй",
                      onSelect: () => router.push(`/children/${child.id}/general`),
                    },
                    {
                      label: "Засах",
                      onSelect: () => router.push(`/children/${child.id}/edit`),
                    },
                    {
                      label: "Бүртгэлийн түүх",
                      onSelect: () => router.push(`/children/${child.id}/enrollment-archive`),
                    },
                  ]}
                />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

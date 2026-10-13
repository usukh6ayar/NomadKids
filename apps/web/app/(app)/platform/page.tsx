"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Building2, Plus, Search } from "lucide-react";
import { paginated, platformKindergartenSchema, platformStatsSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { RequireSuperAdmin } from "@/components/shell/require-role";
import { ToggleActiveButton } from "@/components/admin/toggle-kindergarten-active";
import { DeleteKindergartenButton } from "@/components/admin/delete-kindergarten-button";
import { RegisterKindergartenDialog } from "@/components/platform/register-kindergarten-dialog";
import { PlatformPageHeading } from "@/components/platform/platform-page-heading";
import { PlatformStatsStrip } from "@/components/platform/platform-stats-strip";
import { formatRelative } from "@/lib/format";

/** "" = no filter (Бүгд); the API's `isActive` param is a `z.stringbool()`. */
const STATUS_OPTIONS = [
  { value: "", label: "Бүгд" },
  { value: "true", label: "Идэвхтэй" },
  { value: "false", label: "Идэвхгүй" },
] as const;

const listSchema = paginated(platformKindergartenSchema);

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

      <section aria-label="Цэцэрлэгийн жагсаалт" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 sm:max-w-[440px]">
            <span className="sr-only">Нэрээр хайх</span>
            <Search
              size={18}
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <Input
              type="search"
              aria-label="Нэрээр хайх"
              placeholder="Цэцэрлэгийн нэрээр хайх"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 pl-11"
            />
          </label>
          <Select
            aria-label="Төлөвөөр шүүх"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-10 w-full sm:w-[170px]"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          {kindergartens.data ? (
            <span className="ml-auto text-caption text-muted">
              {kindergartens.data.total} цэцэрлэг
            </span>
          ) : null}
        </div>

        {kindergartens.isLoading ? <LoadingState rows={5} /> : null}
        {kindergartens.isError ? (
          <ErrorState description={errorMessage(kindergartens.error)} />
        ) : null}

        {kindergartens.data && items.length === 0 ? (
          <EmptyState
            title="Цэцэрлэг олдсонгүй"
            description={
              query || status ? "Хайлт, шүүлтээ өөрчилж үзнэ үү." : "Эхний цэцэрлэгээ бүртгээрэй."
            }
          />
        ) : null}

        {items.length > 0 ? (
          <ul className="divide-y divide-border-soft overflow-hidden rounded-card border border-border bg-white">
            {items.map((kg) => (
              <li
                key={kg.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-canvas"
              >
                <Link href={`/platform/${kg.id}`} className="min-w-[180px] flex-1 py-0.5">
                  <span className="block truncate text-body font-semibold text-ink hover:text-primary">
                    {kg.name}
                  </span>
                  <span className="block truncate text-caption text-muted">
                    {[kg.address, kg.phone, kg.email].filter(Boolean).join(" · ") || "—"}
                    {" · "}
                    {formatRelative(kg.createdAt)}
                  </span>
                </Link>

                {/*
                  Three verbs, in the order of how far they go: the state, the
                  toggle between the two reversible ones, and Устгах last and
                  the only one painted as danger.
                */}
                <span className="flex items-center gap-1">
                  <span className="mr-1 inline-flex items-center gap-1.5 text-caption text-muted">
                    <span
                      aria-hidden="true"
                      className={`size-1.5 rounded-pill ${kg.isActive ? "bg-emerald-500" : "bg-slate-300"}`}
                    />
                    {kg.isActive ? "Идэвхтэй" : "Идэвхгүй"}
                  </span>
                  <ToggleActiveButton kindergarten={kg} />
                  <DeleteKindergartenButton kindergarten={kg} />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

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

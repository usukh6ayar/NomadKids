"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Baby, Building2, GraduationCap, Plus, Search, UsersRound } from "lucide-react";
import { paginated, platformKindergartenSchema, platformStatsSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RowList } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { RequireSuperAdmin } from "@/components/shell/require-role";
import { Art } from "@/components/ui/art";
import { ToggleActiveButton } from "@/components/admin/toggle-kindergarten-active";
import { DeleteKindergartenButton } from "@/components/admin/delete-kindergarten-button";
import { RegisterKindergartenDialog } from "@/components/platform/register-kindergarten-dialog";
import { PlatformPageHeading } from "@/components/platform/platform-page-heading";
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
    <div className="flex flex-col gap-6 pb-8 lg:gap-7">
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

      {stats.data ? (
        <section
          aria-label="Системийн товч мэдээлэл"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"
        >
          {[
            { label: "Нийт цэцэрлэг", value: stats.data.kindergartens, icon: Building2 },
            { label: "Нийт бүлэг", value: stats.data.groups, icon: UsersRound },
            { label: "Нийт хүүхэд", value: stats.data.children, icon: Baby },
            { label: "Багш, ажилтан", value: stats.data.staff, icon: GraduationCap },
            { label: "Идэвхтэй эцэг эх", value: stats.data.guardians, icon: UsersRound },
          ].map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="rounded-card border border-border bg-white p-4 shadow-sm sm:p-5"
            >
              <span
                className="grid size-10 place-items-center rounded-control bg-primary-soft text-primary"
                aria-hidden="true"
              >
                <Icon size={20} strokeWidth={1.8} />
              </span>
              <p className="mt-4 text-caption font-medium text-muted">{label}</p>
              <p className="mt-1 text-heading font-extrabold tabular-nums text-ink">{value}</p>
            </div>
          ))}
        </section>
      ) : null}

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
          className="rounded-card border border-border bg-white p-4 shadow-sm sm:p-5"
        >
          <h2 className="text-body font-semibold text-ink">ЭСИС-тэй тулгалт</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-5">
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

      <section aria-label="Цэцэрлэгийн жагсаалт" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-title font-bold text-ink">Байгууллагууд</h2>
            <p className="mt-1 text-caption text-muted">Бүртгэлтэй цэцэрлэгүүдийн мэдээлэл</p>
          </div>
          {kindergartens.data ? (
            <span className="rounded-pill bg-primary-soft px-3 py-1.5 text-caption font-semibold text-primary">
              {kindergartens.data.total} цэцэрлэг
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-3 rounded-card border border-border bg-white p-3 shadow-sm sm:p-4">
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
              className="bg-sunken pl-11"
            />
          </label>
          <Select
            aria-label="Төлөвөөр шүүх"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full sm:w-[170px]"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
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
          <RowList>
            {items.map((kg) => (
              <div
                key={kg.id}
                className="flex min-h-[84px] flex-wrap items-center gap-3 rounded-card border border-border bg-white px-4 py-3 shadow-sm transition-all has-[a:hover]:border-primary has-[a:hover]:shadow-md sm:px-5"
              >
                <Link
                  href={`/platform/${kg.id}`}
                  className="flex min-w-[180px] flex-1 items-center gap-3 py-1"
                >
                  <span className="grid size-12 shrink-0 place-items-center rounded-control bg-primary-soft">
                    <Art name="kindergarten" size={36} className="size-9" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lead font-bold text-ink">{kg.name}</span>
                    <span className="mt-px block truncate text-compact text-muted">
                      {[kg.address, kg.phone, kg.email].filter(Boolean).join(" · ") || "—"}
                      {" · "}
                      {formatRelative(kg.createdAt)}
                    </span>
                  </span>
                </Link>

                {/*
                Three verbs, in the order of how far they go: the badge says
                which state it is in, the toggle moves between the two
                reversible ones, and Устгах is last and the only one painted
                as danger. `DeleteKindergartenButton` is where the difference
                between suspending and retiring is spelled out.
              */}
                <span className="flex w-full flex-wrap items-center gap-1 border-t border-border-soft pt-2 sm:w-auto sm:border-0 sm:pt-0">
                  <Badge tone={kg.isActive ? "mint" : "neutral"}>
                    {kg.isActive ? "Идэвхтэй" : "Идэвхгүй"}
                  </Badge>
                  <ToggleActiveButton kindergarten={kg} />
                  <DeleteKindergartenButton kindergarten={kg} />
                </span>
              </div>
            ))}
          </RowList>
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
        className={`mt-0.5 truncate text-lead font-semibold tabular-nums ${
          warn ? "text-sun-ink" : "text-ink"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

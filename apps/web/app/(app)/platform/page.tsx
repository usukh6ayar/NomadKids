"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import { paginated, platformKindergartenSchema, platformStatsSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RowList } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireSuperAdmin } from "@/components/shell/require-role";
import { Stat } from "@/components/admin/dashboard-sections";
import { Art } from "@/components/ui/art";
import { ToggleActiveButton } from "@/components/admin/toggle-kindergarten-active";
import { DeleteKindergartenButton } from "@/components/admin/delete-kindergarten-button";
import { RegisterKindergartenDialog } from "@/components/platform/register-kindergarten-dialog";
import { formatRelative } from "@/lib/format";

/** "" = no filter (Бүгд); the API's `isActive` param is a `z.stringbool()`. */
const STATUS_OPTIONS = [
  { value: "", label: "Бүгд" },
  { value: "true", label: "Идэвхтэй" },
  { value: "false", label: "Идэвхгүй" },
] as const;

const listSchema = paginated(platformKindergartenSchema);

/**
 * The platform operator's whole job in this MVP: register a kindergarten.
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
    <div className="flex flex-col gap-5 lg:gap-7">
      <PageHeader
        title="Цэцэрлэгүүд"
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={18} />
            Цэцэрлэг бүртгэх
          </Button>
        }
      />

      {stats.data ? (
        <section
          aria-label="Системийн товч мэдээлэл"
          className="grid grid-cols-2 gap-3 sm:grid-cols-5"
        >
          <Stat label="Нийт цэцэрлэг" value={stats.data.kindergartens} />
          <Stat label="Нийт бүлэг" value={stats.data.groups} />
          <Stat label="Нийт хүүхэд" value={stats.data.children} />
          <Stat label="Багш, ажилтан" value={stats.data.staff} />
          <Stat label="Идэвхтэй эцэг эх" value={stats.data.guardians} />
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Input
          type="search"
          aria-label="Нэрээр хайх"
          placeholder="Цэцэрлэгийн нэрээр хайх"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-[320px] flex-1"
        />
        <Select
          aria-label="Төлөвөөр шүүх"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="max-w-[160px]"
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
              className="flex min-h-[64px] flex-wrap items-center gap-3 rounded-row border border-border bg-surface px-4 py-3 transition-colors has-[a:hover]:border-primary"
            >
              <Link href={`/platform/${kg.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center bg-transparent">
                  <Art name="kindergarten" size={36} className="size-9" />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lead font-semibold text-ink">{kg.name}</span>
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
              <span className="flex flex-wrap items-center gap-1">
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

      {creating ? <RegisterKindergartenDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

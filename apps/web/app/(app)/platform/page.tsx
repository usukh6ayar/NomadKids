"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import {
  createdKindergartenSchema,
  paginated,
  platformKindergartenSchema,
  platformStatsSchema,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RowList } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireSuperAdmin } from "@/components/shell/require-role";
import { InvitationHandover } from "@/components/admin/invitation-handover";
import { Stat } from "@/components/admin/dashboard-sections";
import { Art } from "@/components/ui/art";
import { ToggleActiveButton } from "@/components/admin/toggle-kindergarten-active";
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

              <span className="flex items-center gap-1">
                <Badge tone={kg.isActive ? "mint" : "neutral"}>
                  {kg.isActive ? "Идэвхтэй" : "Идэвхгүй"}
                </Badge>
                <ToggleActiveButton kindergarten={kg} />
              </span>
            </div>
          ))}
        </RowList>
      ) : null}

      {creating ? <CreateKindergartenDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function CreateKindergartenDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [adminUsername, setAdminUsername] = useState("");
  const [adminLastName, setAdminLastName] = useState("");
  const [adminFirstName, setAdminFirstName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");

  const create = useMutation({
    mutationFn: () =>
      mutate("/platform/kindergartens", createdKindergartenSchema, {
        method: "POST",
        body: {
          name,
          address: address.trim() === "" ? null : address.trim(),
          phone: phone.trim() === "" ? null : phone.trim(),
          email: email.trim() === "" ? null : email.trim(),
          admin: {
            username: adminUsername,
            lastName: adminLastName,
            firstName: adminFirstName,
            email: adminEmail.trim() === "" ? null : adminEmail.trim(),
          },
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["platform", "kindergartens"] });
      // Registering a kindergarten adds one to the total and its director to
      // the staff count — the toggle button doesn't touch either, so only this
      // mutation needs to invalidate the totals.
      void queryClient.invalidateQueries({ queryKey: qk.platformStats() });
    },
  });

  const errors = fieldErrors(create.error);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Цэцэрлэг бүртгэх"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4"
    >
      <div className="w-full max-w-[520px] rounded-card border border-border bg-surface p-5">
        {create.isSuccess ? (
          <InvitationHandover
            token={create.data.invitationToken}
            title="Цэцэрлэг бүртгэгдлээ"
            subtitle={`${create.data.kindergarten.name} — ${create.data.admin.lastName} ${create.data.admin.firstName}, удирдлага`}
            onClose={onClose}
          />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!create.isPending) create.mutate();
            }}
            className="flex flex-col gap-4"
            noValidate
          >
            <div>
              <h2 className="text-title font-semibold text-ink">Цэцэрлэг бүртгэх</h2>
              <p className="mt-0.5 text-body text-muted">
                Эхний удирдлагын бүртгэл нэгэн зэрэг үүснэ. Нууц үгээ тэр хүн өөрөө сонгоно.
              </p>
            </div>

            <FormError message={create.isError ? errorMessage(create.error) : null} />

            <Field label="Цэцэрлэгийн нэр" error={errors.name} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Хаяг" error={errors.address}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Утас" error={errors.phone}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                )}
              </Field>
            </div>

            <Field label="И-мэйл" error={errors.email} hint="Заавал биш.">
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoCapitalize="none"
                />
              )}
            </Field>

            <div className="border-t border-border pt-4">
              <p className="mb-3 text-body font-semibold text-ink">Эхний удирдлага</p>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Овог" error={errors["admin.lastName"]} required>
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={adminLastName}
                      onChange={(e) => setAdminLastName(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Нэр" error={errors["admin.firstName"]} required>
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={adminFirstName}
                      onChange={(e) => setAdminFirstName(e.target.value)}
                    />
                  )}
                </Field>
              </div>

              <div className="mt-4">
                <Field
                  label="Нэвтрэх нэр"
                  error={errors["admin.username"]}
                  hint="Латин үсэг, тоо, . _ -"
                  required
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={adminUsername}
                      onChange={(e) => setAdminUsername(e.target.value)}
                      autoCapitalize="none"
                    />
                  )}
                </Field>
              </div>

              <div className="mt-4">
                <Field label="И-мэйл" error={errors["admin.email"]} hint="Заавал биш.">
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      type="email"
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      autoCapitalize="none"
                    />
                  )}
                </Field>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <Button type="submit" disabled={create.isPending}>
                <Plus size={18} />
                {create.isPending ? "Бүртгэж байна…" : "Бүртгэх"}
              </Button>
              <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>
                Болих
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

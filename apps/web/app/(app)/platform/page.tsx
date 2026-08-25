"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Building2, Plus } from "lucide-react";
import {
  createdKindergartenSchema,
  paginated,
  platformKindergartenSchema,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RowList } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireSuperAdmin } from "@/components/shell/require-role";
import { InvitationHandover } from "@/components/admin/invitation-handover";
import { formatRelative } from "@/lib/format";

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
  const [creating, setCreating] = useState(false);

  const kindergartens = useQuery({
    queryKey: qk.platformKindergartens({ q: query }),
    queryFn: () => {
      const params = new URLSearchParams({ page: "1", pageSize: "50" });
      if (query.trim()) params.set("q", query.trim());
      return get(`/platform/kindergartens?${params}`, listSchema);
    },
  });

  const items = kindergartens.data?.items ?? [];

  return (
    <div className="flex flex-col gap-5 lg:gap-7">
      <PageHeader
        title="Цэцэрлэгүүд"
        lede="Платформд бүртгэлтэй цэцэрлэгүүд. Шинээр бүртгэхэд эхний удирдлагын бүртгэл үүснэ."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={18} />
            Цэцэрлэг бүртгэх
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Input
          type="search"
          aria-label="Нэрээр хайх"
          placeholder="Цэцэрлэгийн нэрээр хайх"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-[320px] flex-1"
        />
      </div>

      {kindergartens.isLoading ? <LoadingState rows={5} /> : null}
      {kindergartens.isError ? (
        <ErrorState description={errorMessage(kindergartens.error)} />
      ) : null}

      {kindergartens.data && items.length === 0 ? (
        <EmptyState
          title="Цэцэрлэг олдсонгүй"
          description={query ? "Хайлтаа өөрчилж үзнэ үү." : "Эхний цэцэрлэгээ бүртгээрэй."}
        />
      ) : null}

      {items.length > 0 ? (
        <RowList>
          {items.map((kg) => (
            <div
              key={kg.id}
              className="flex min-h-[64px] flex-wrap items-center gap-3 rounded-row border border-border bg-surface px-4 py-3"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-pill bg-primary-soft text-primary">
                <Building2 size={18} aria-hidden />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-lead font-semibold text-ink">{kg.name}</span>
                <span className="mt-px block truncate text-compact text-muted">
                  {[kg.address, kg.phone, kg.email].filter(Boolean).join(" · ") || "—"}
                  {" · "}
                  {formatRelative(kg.createdAt)}
                </span>
              </span>

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

/**
 * Suspending or reinstating a tenant.
 *
 * A platform decision, not the kindergarten's own admin's — CLAUDE.md §3.2,
 * §2.3. Deactivating does not delete anything; every record stays, and
 * flipping it back is a second click, not a support ticket.
 */
function ToggleActiveButton({
  kindergarten,
}: {
  kindergarten: { id: string; name: string; isActive: boolean };
}) {
  const queryClient = useQueryClient();

  const toggle = useMutation({
    mutationFn: () =>
      mutate(`/platform/kindergartens/${kindergarten.id}`, platformKindergartenSchema, {
        method: "PATCH",
        body: { isActive: !kindergarten.isActive },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["platform", "kindergartens"] });
    },
  });

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={toggle.isPending}
      onClick={() => {
        const message = kindergarten.isActive
          ? `${kindergarten.name}-г идэвхгүй болгох уу?\n\nБагш, эцэг эх нэвтрэх боломжгүй болно. Дараа нь дахин идэвхжүүлж болно.`
          : `${kindergarten.name}-г идэвхжүүлэх үү?`;
        if (window.confirm(message)) toggle.mutate();
      }}
    >
      {kindergarten.isActive ? "Идэвхгүй болгох" : "Идэвхжүүлэх"}
    </Button>
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

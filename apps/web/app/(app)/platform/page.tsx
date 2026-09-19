"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import {
  createdKindergartenSchema,
  esisInstitutionLookupSchema,
  paginated,
  platformKindergartenSchema,
  platformStatsSchema,
  type EsisInstitutionLookup,
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

  /*
   * ★ The ESIS half of this form is optional from end to end.
   *
   * A deployment with no ministry presence still registers kindergartens
   * exactly as it did before — leave the id blank and nothing below this line
   * runs. What it buys when it is used is that the tenant is born already
   * mapped: setting the institution afterwards on a separate screen left a
   * window in which a kindergarten existed unmapped, or mapped to the wrong
   * institution, and nothing detected either.
   */
  const [institutionId, setInstitutionId] = useState("");
  const [institution, setInstitution] = useState<EsisInstitutionLookup | null>(null);
  const [adminPersonId, setAdminPersonId] = useState<string | null>(null);

  const lookup = useMutation({
    mutationFn: () =>
      get(
        `/platform/esis/institutions/${encodeURIComponent(institutionId.trim())}`,
        esisInstitutionLookupSchema,
      ),
    onSuccess: (found) => {
      setInstitution(found);
      setName(found.name);
      setAddress(found.address ?? "");
      setAdminPersonId(null);
    },
    onError: () => {
      // The previous answer must not survive a failed re-lookup: a stale name
      // beside a new id is the one state this screen must never show.
      setInstitution(null);
      setAdminPersonId(null);
    },
  });

  /*
   * The one blocking state, and only this one.
   *
   * ★ A failed lookup does **not** block. A refusal from the ministry or an
   * outage at it leaves `institution` null, which posts no ESIS fields at all
   * — so the operator registers the kindergarten now and maps it later,
   * exactly as they did before this screen existed. Blocking there would let
   * someone else's outage stop the work entirely.
   *
   * `alreadyUsed` is different: the id is taken, the insert would fail on a
   * unique index, and there is nothing useful to submit.
   */
  const institutionBlocked = institution?.alreadyUsed === true;

  const chooseStaff = (person: EsisInstitutionLookup["staff"][number]) => {
    setAdminPersonId(person.personId);
    // The API overwrites these from the roster anyway — the ministry's
    // spelling is what self-registration matches on later — so the form must
    // not sit there disagreeing with what will actually be saved.
    setAdminLastName(person.lastName);
    setAdminFirstName(person.firstName);
  };

  const create = useMutation({
    mutationFn: () =>
      mutate("/platform/kindergartens", createdKindergartenSchema, {
        method: "POST",
        body: {
          name,
          address: address.trim() === "" ? null : address.trim(),
          phone: phone.trim() === "" ? null : phone.trim(),
          email: email.trim() === "" ? null : email.trim(),
          // Omitted entirely rather than sent as null: the API refuses
          // `adminEsisPersonId` without `esisInstitutionId`, and a form that
          // never touched ESIS must post exactly what it posted before.
          ...(institution ? { esisInstitutionId: institution.institutionId } : {}),
          ...(institution && adminPersonId ? { adminEsisPersonId: adminPersonId } : {}),
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

            <div className="rounded-card border border-border bg-canvas p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <Field
                    label="ESIS institution ID"
                    hint="Заавал биш. Бөглөвөл нэр, хаяг, ажилтны жагсаалт яамнаас ирнэ."
                  >
                    {({ id, describedBy }) => (
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        value={institutionId}
                        onChange={(e) => setInstitutionId(e.target.value)}
                        placeholder="Жишээ: 42778"
                        inputMode="numeric"
                      />
                    )}
                  </Field>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={institutionId.trim() === "" || lookup.isPending}
                  onClick={() => lookup.mutate()}
                >
                  {lookup.isPending ? "Татаж байна…" : "ESIS-ээс татах"}
                </Button>
              </div>

              {lookup.isError ? (
                <p className="mt-2 text-caption text-danger">{errorMessage(lookup.error)}</p>
              ) : null}

              {institution ? (
                <div className="mt-2 flex flex-col gap-1">
                  <p className="text-caption text-muted">
                    {[institution.name, institution.classification, institution.propertyType]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {institution.alreadyUsed ? (
                    <p className="text-caption text-danger">
                      Энэ институц аль хэдийн бүртгэлтэй: {institution.name}
                    </p>
                  ) : null}
                  {/*
                    A warning, not a block. The ministry's classification is
                    free text we do not control, and refusing outright would
                    make a mislabelled kindergarten unregisterable.
                  */}
                  {!institution.isKindergarten ? (
                    <p className="text-caption text-warning">
                      Энэ байгууллага цэцэрлэг биш ({institution.classification ?? "тодорхойгүй"}).
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {institution && !institution.alreadyUsed ? (
              <fieldset className="rounded-card border border-border p-3">
                <legend className="px-1 text-caption text-muted">Захирал/Эрхлэгч сонгох</legend>
                {institution.staff.length === 0 ? (
                  <p className="text-caption text-muted">
                    Энэ байгууллагад бүртгэлтэй ажилтан ESIS-ээс ирсэнгүй. Удирдлагын нэрийг доор
                    гараар бөглөнө үү.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {institution.staff.map((person) => (
                      <label
                        key={person.personId}
                        className="flex cursor-pointer items-start gap-2 rounded-card px-2 py-1.5 hover:bg-canvas"
                      >
                        <input
                          type="radio"
                          name="esis-admin"
                          className="mt-1"
                          value={person.personId}
                          checked={adminPersonId === person.personId}
                          onChange={() => chooseStaff(person)}
                        />
                        <span className="min-w-0">
                          <span className="block text-body text-ink">
                            {person.lastName} {person.firstName}
                          </span>
                          {person.positionName ? (
                            <span className="block text-caption text-muted">
                              {person.positionName}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            ) : null}

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
              <Button type="submit" disabled={create.isPending || institutionBlocked}>
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

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Inbox,
  Plus,
  School,
  Building2,
  FileText,
  Info,
  MapPin,
  Phone,
  RefreshCw,
  Save,
  UsersRound,
} from "lucide-react";
import { z } from "zod";
import { esisResourceReadSchema, schoolYearSchema, uuidSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { mediaUrl } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { Art } from "@/components/ui/art";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { SearchField } from "@/components/ui/search-field";
import { Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { RequireRole } from "@/components/shell/require-role";
import { SingleImageUpload } from "@/components/media/single-image-upload";

/**
 * The kindergarten's own details, for its director.
 *
 * The sidebar entry has always been called "Бүлэг, цэцэрлэгийн мэдээлэл", but
 * only the бүлэг half existed: an admin could create school years, groups and
 * users and had nowhere to correct their own kindergarten's name, address or
 * telephone number. `PATCH /kindergartens/:id` has been there since Phase 4
 * with no screen in front of it.
 *
 * ★ `isActive` is deliberately not offered here.
 *
 * The endpoint accepts it, but deactivating a kindergarten is a platform
 * decision — it is how the operator suspends a tenant, not something its own
 * director should be able to do to themselves by mis-clicking a switch on a
 * profile form. It lives on the platform routes instead.
 */
const detailSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  address: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  description: z.string().nullish(),
  logoMediaFileId: uuidSchema.nullish(),
  capacity: z.number().int().nullish(),
  isActive: z.boolean().nullish(),
});

const schoolYearsSchema = z.array(schoolYearSchema);

export default function AdminKindergartenPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <AdminKindergarten />
    </RequireRole>
  );
}

type Tab = "main" | "method";

function AdminKindergarten() {
  const { primaryKindergartenId } = useSession();
  const kindergartenId = primaryKindergartenId ?? "";
  const [tab, setTab] = useState<Tab>("main");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: qk.adminKindergarten(kindergartenId),
    queryFn: () => get(`/kindergartens/${kindergartenId}`, detailSchema),
    enabled: Boolean(primaryKindergartenId),
  });

  if (isLoading) return <LoadingState rows={3} />;
  if (isError) return <ErrorState description={errorMessage(error)} />;

  const nav: { value: Tab; label: string; icon: ReactNode }[] = [
    { value: "main", label: "Үндсэн мэдээлэл", icon: <School size={18} aria-hidden /> },
    { value: "method", label: "Заах аргын нэгдэл", icon: <FileText size={18} aria-hidden /> },
  ];

  /*
    ★ The client's 2026-09-25 drawing, third pass: the kindergarten on the left
    with two sections, and "Үндсэн мэдээлэл" as one form — general, address,
    contact and capacity. The ESIS panels that stood below the form went —
    "ESIS татах" is how this screen reads the ministry now, and the panels
    repeated it ("давхар мэдээлэл гарахгүй").

    ★★ Address, capacity, telephone and e-mail are ours and save. Website,
    Facebook and the head's name and telephone have no column yet and are
    shown empty. Short name, ownership, type, province and district are ESIS's and
    are read-only, filled only by a LIVE answer to "ESIS татах"; a demo answer
    is never shown as the kindergarten's own. Location, country and the
    responsible unit have no source and stay empty.
  */
  return (
    <div className="grid w-full items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-3">
        {/* White, not the blue gradient — client, 2026-09-25. */}
        <div className="flex flex-col items-center gap-2 rounded-card border border-border-soft bg-surface p-5 text-center shadow-sm">
          <KindergartenMark data={data} size="lg" />
          <p className="text-lead font-bold leading-snug text-ink">{data?.name}</p>
        </div>
        <nav aria-label="Байгууллагын мэдээлэл" className="flex flex-col gap-1">
          {nav.map(({ value, label, icon }) => (
            <button
              key={value}
              type="button"
              aria-current={tab === value ? "page" : undefined}
              onClick={() => setTab(value)}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-control px-3 py-2 text-left text-body transition-colors",
                tab === value
                  ? "bg-primary-soft font-semibold text-primary shadow-[inset_3px_0_0_var(--color-primary)]"
                  : "text-muted hover:bg-canvas hover:text-ink",
              )}
            >
              {icon}
              {label}
            </button>
          ))}
        </nav>
      </aside>

      {tab === "main" ? <MainDetails kindergartenId={kindergartenId} data={data} /> : null}
      {tab === "method" ? <MethodUnions kindergartenId={kindergartenId} /> : null}
    </div>
  );
}

type Detail = z.infer<typeof detailSchema> | undefined;

function KindergartenMark({ data, size }: { data: Detail; size: "lg" | "md" }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-pill border border-border-soft bg-surface",
        size === "lg" ? "size-28" : "size-20",
      )}
    >
      {data?.logoMediaFileId ? (
        <img
          src={mediaUrl(data.logoMediaFileId)}
          alt={`${data.name}-ийн лого`}
          className="size-full object-cover"
        />
      ) : (
        <Art name="kindergarten" size={size === "lg" ? 88 : 60} />
      )}
    </span>
  );
}

/** Title, lede and the two actions — the shape every section of this screen opens with. */
function Pane({
  title,
  lede,
  actions,
  children,
  onSubmit,
}: {
  title: string;
  lede: string;
  actions: ReactNode;
  children: ReactNode;
  onSubmit: () => void;
}) {
  return (
    <form
      className="flex flex-col gap-5 rounded-card border border-border-soft bg-surface p-5 shadow-sm sm:p-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-display font-bold leading-heading text-ink">{title}</h1>
          <p className="mt-1 text-body text-muted">{lede}</p>
        </div>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
      {children}
    </form>
  );
}

function SaveButton({ disabled, pending }: { disabled: boolean; pending: boolean }) {
  return (
    <Button type="submit" disabled={disabled || pending}>
      <Save size={16} aria-hidden /> {pending ? "Хадгалж байна…" : "Хадгалах"}
    </Button>
  );
}

function useKindergartenSave(kindergartenId: string, onDone: () => void) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      mutate(`/kindergartens/${kindergartenId}`, detailSchema, { method: "PATCH", body }),
    onSuccess: () => {
      toast.success("Мэдээлэл хадгалагдлаа.");
      onDone();
      void queryClient.invalidateQueries({ queryKey: qk.adminKindergarten(kindergartenId) });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

function MainDetails({ kindergartenId, data }: { kindergartenId: string; data: Detail }) {
  const [address, setAddress] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const currentAddress = address ?? data?.address ?? "";
  const currentPhone = phone ?? data?.phone ?? "";
  const currentEmail = email ?? data?.email ?? "";
  const currentCapacity =
    capacity ??
    (data?.capacity === null || data?.capacity === undefined ? "" : String(data.capacity));
  const dirty = address !== null || capacity !== null || phone !== null || email !== null;

  /* One press, one call to the ministry — the ESIS panels' own rule. */
  const esis = useQuery({
    queryKey: qk.esisResource(kindergartenId, "organization", "resource=organization"),
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/esis/resource?resource=organization`,
        esisResourceReadSchema,
      ),
    enabled: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const live =
    esis.data && esis.data.source === "LIVE" && esis.data.status === "SUCCEEDED"
      ? esis.data.rows[0]
      : undefined;
  const fromEsis = (key: string) => {
    const value = live?.[key];
    return value === null || value === undefined ? "" : String(value);
  };

  const save = useKindergartenSave(kindergartenId, () => {
    setAddress(null);
    setCapacity(null);
    setPhone(null);
    setEmail(null);
  });
  const errors = fieldErrors(save.error);

  return (
    <Pane
      title="Үндсэн мэдээлэл"
      lede="Байгууллагын ерөнхий мэдээллийг засах боломжтой."
      onSubmit={() => {
        if (dirty && !save.isPending)
          save.mutate({
            address: currentAddress.trim() || null,
            capacity: currentCapacity.trim() === "" ? null : Number(currentCapacity),
            phone: currentPhone.trim() || null,
            email: currentEmail.trim() || null,
          });
      }}
      actions={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void esis.refetch()}
            disabled={esis.isFetching || !kindergartenId}
          >
            <RefreshCw size={16} aria-hidden /> {esis.isFetching ? "Татаж байна…" : "ESIS татах"}
          </Button>
          <SaveButton disabled={!dirty} pending={save.isPending} />
        </>
      }
    >
      {esis.isError ? (
        <p role="status" className="rounded-control bg-danger-soft px-3 py-2 text-body text-danger">
          ESIS-ээс татаж чадсангүй: {errorMessage(esis.error)}
        </p>
      ) : esis.data && !live ? (
        <p role="status" className="rounded-control bg-sun px-3 py-2 text-body text-sun-ink">
          ESIS туршилтын горимд байна — бодит мэдээлэл биш тул талбарт оруулсангүй.
        </p>
      ) : null}

      <FormSection
        icon={<Building2 size={20} aria-hidden />}
        title="Ерөнхий мэдээлэл"
        lede="Байгууллагын нэр, хэлбэр, өмчийн хэлбэр болон хариуцах нэгжийн мэдээлэл."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <ReadOnlyField label="Байршил" value="" />
          <ReadOnlyField label="Өмчийн хэлбэр" value={fromEsis("propertyTypeName")} />
          <ReadOnlyField label="Хэв шинж" value={fromEsis("institutionTypeName")} />
          <ReadOnlyField label="Товч нэр" value={fromEsis("shortName")} />
          <ReadOnlyField label="Хариуцалагч нэгж" value="" />
          <div className="flex flex-col gap-1.5">
            <span className="text-body font-medium text-ink">Лого оруулах</span>
            <div className="flex items-center gap-3">
              <KindergartenMark data={data} size="md" />
              <SingleImageUpload
                endpoint={`/kindergartens/${kindergartenId}/logo`}
                currentMediaId={data?.logoMediaFileId}
                label="Файл сонгох"
                alt={`${data?.name ?? "Цэцэрлэг"}-ийн лого`}
                hint="PNG, JPG (зөвлөмж: 800×800px)"
                hidePreview
                invalidateKeys={[qk.adminKindergarten(kindergartenId), qk.session()]}
              />
            </div>
          </div>
        </div>
      </FormSection>

      <FormSection
        icon={<MapPin size={20} aria-hidden />}
        title="Хаягийн мэдээлэл"
        lede="Байгууллагын албан ёсны хаяг."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <ReadOnlyField label="Улс" value="" />
          <ReadOnlyField label="Аймаг/Нийслэл" value={fromEsis("provinceName")} />
          <ReadOnlyField label="Дүүрэг" value={fromEsis("districtName")} />
        </div>
        <Field label="Дэлгэрэнгүй хаяг" error={errors.address}>
          {({ id, describedBy, invalid }) => (
            <div className="flex flex-col gap-1">
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                maxLength={255}
                value={currentAddress}
                onChange={(event) => setAddress(event.target.value)}
              />
              <span className="self-end text-caption tabular-nums text-muted">
                {currentAddress.length}/255
              </span>
            </div>
          )}
        </Field>
      </FormSection>

      <FormSection
        icon={<Phone size={20} aria-hidden />}
        title="Холбоо барих мэдээлэл"
        lede="Байгууллагатай холбогдох үндсэн мэдээлэл."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Утас" error={errors.phone}>
            {({ id }) => (
              <Input
                id={id}
                maxLength={20}
                value={currentPhone}
                onChange={(e) => setPhone(e.target.value)}
              />
            )}
          </Field>
          <Field label="И-мэйл" error={errors.email}>
            {({ id }) => (
              <Input
                id={id}
                type="email"
                value={currentEmail}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          {/* No column for these yet — shown, never invented. */}
          <ReadOnlyField label="Вэб сайт" value="" />
          <ReadOnlyField label="Facebook" value="" />
          <ReadOnlyField label="Удирдлагын нэр" value="" />
          <ReadOnlyField label="Удирдлагын утас" value="" />
        </div>
      </FormSection>

      <FormSection
        icon={<UsersRound size={20} aria-hidden />}
        title="Хүчин чадал"
        lede="Байгууллагын нийт хүчин чадал (оролцсон тоогоор)."
      >
        <div className="grid items-end gap-4 md:grid-cols-2">
          <Field label="Хүүхдийн тоо" error={errors.capacity}>
            {({ id, describedBy, invalid }) => (
              <div className="relative">
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={5000}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={currentCapacity}
                  onChange={(event) => setCapacity(event.target.value)}
                  className="pe-20"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-body text-muted">
                  хүүхэд
                </span>
              </div>
            )}
          </Field>
          {/* What the figure is actually used for today — nothing more. */}
          <p className="flex items-center gap-2 rounded-control border border-primary/20 bg-primary-soft px-3 py-3 text-body text-primary">
            <Info size={18} aria-hidden /> Энэ тоог эцэг эхчүүд цэцэрлэгийн мэдээлэл дээр харна.
          </p>
        </div>
      </FormSection>
    </Pane>
  );
}

function FormSection({
  icon,
  title,
  lede,
  children,
}: {
  icon: ReactNode;
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-card border border-border-soft">
      <div className="flex items-start gap-3 rounded-t-card bg-sunken px-4 py-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-control bg-primary-soft text-primary">
          {icon}
        </span>
        <div>
          <h2 className="text-lead font-semibold text-ink">{title}</h2>
          {lede ? <p className="text-caption text-muted">{lede}</p> : null}
        </div>
      </div>
      <div className="flex flex-col gap-4 px-4 pb-4">{children}</div>
    </section>
  );
}

/**
 * A field this record does not store: shown, never editable, and empty rather
 * than guessed when there is nothing to show.
 */
function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <Field label={label}>
      {({ id }) => <Input id={id} value={value} placeholder="—" readOnly disabled />}
    </Field>
  );
}

/**
 * Заах аргын нэгдэл — the client's 2026-09-25 drawing, as an empty shell.
 *
 * ★ Nothing stores a method union yet: no model, no endpoint, and ESIS answers
 * one teacher's union by their ESIS id, never the kindergarten's list. So the
 * list is drawn with its columns and an empty state that says so, "Нэгдэл
 * нэмэх" is disabled, and the search and year filter narrow an empty list.
 * The day the API lands, the rows go where the empty state is.
 */
function MethodUnions({ kindergartenId }: { kindergartenId: string }) {
  const [typed, setTyped] = useState("");
  const [yearId, setYearId] = useState("");
  const years = useQuery({
    queryKey: qk.adminSchoolYears(kindergartenId),
    queryFn: () => get(`/kindergartens/${kindergartenId}/school-years`, schoolYearsSchema),
    enabled: Boolean(kindergartenId),
  });

  return (
    <div className="flex flex-col gap-5 rounded-card border border-border-soft bg-surface p-5 shadow-sm sm:p-6">
      <div>
        <h1 className="text-display font-bold leading-heading text-ink">Заах аргын нэгдэл</h1>
        <p className="mt-1 text-body text-muted">
          Байгууллагын заах аргын нэгдлийн мэдээллийг удирдах боломжтой.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-[320px]">
          <SearchField
            label="Нэгдлийг нэрээр хайх"
            placeholder="Нэрээр хайх..."
            value={typed}
            onChange={setTyped}
          />
        </div>
        <Select
          aria-label="Хичээлийн жил"
          value={yearId}
          onChange={(event) => setYearId(event.target.value)}
          className="w-full sm:w-[300px]"
        >
          <option value="">Хичээлийн жил</option>
          {(years.data ?? []).map((year) => (
            <option key={year.id} value={year.id}>
              {year.name}
            </option>
          ))}
        </Select>
        {/*
          No service returns the kindergarten's unions, so this opens the ESIS
          hub — as on Анги, бүлэг and Багш, ажилтан — where one teacher's
          union is read by their ESIS id.
        */}
        <Button asChild variant="secondary" className="ml-auto">
          <Link href="/admin/integrations/esis">
            <RefreshCw size={16} aria-hidden /> ESIS татах
          </Link>
        </Button>
        <Button
          type="button"
          disabled
          title="Заах аргын нэгдлийг бүртгэх боломж backend хөгжүүлэлтийн дараа идэвхжинэ"
        >
          <Plus size={16} aria-hidden /> Нэгдэл нэмэх
        </Button>
      </div>

      <div className="rounded-card border border-border">
        <table className="w-full border-collapse text-body">
          <caption className="sr-only">Заах аргын нэгдлийн жагсаалт</caption>
          <thead>
            <tr>
              <Th className="w-12 rounded-tl-card">№</Th>
              <Th>Заах аргын нэгдлийн нэр</Th>
              <Th>Ахлагч багш</Th>
              <Th>Багшийн тоо</Th>
              <Th>Хичээлийн жил</Th>
              <Th className="w-12 rounded-tr-card">
                <span className="sr-only">Үйлдэл</span>
              </Th>
            </tr>
          </thead>
        </table>
        <div className="px-4 py-10">
          <EmptyState
            icon={<Inbox size={40} aria-hidden />}
            title="Нэгдэл бүртгэгдээгүй байна"
            description="Заах аргын нэгдлийн мэдээллийг бүртгэх боломж backend хөгжүүлэлтийн дараа идэвхжинэ."
          />
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <p className="text-body font-semibold text-ink">Нийт: 0</p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled
              aria-label="Өмнөх хуудас"
              className="grid size-9 place-items-center rounded-control text-faint"
            >
              <ChevronLeft size={18} aria-hidden />
            </button>
            <button
              type="button"
              disabled
              aria-label="Дараах хуудас"
              className="grid size-9 place-items-center rounded-control text-faint"
            >
              <ChevronRight size={18} aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

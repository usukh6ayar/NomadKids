"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
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
import { esisResourceReadSchema, uuidSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { mediaUrl } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { Art } from "@/components/ui/art";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { RequireRole } from "@/components/shell/require-role";
import { MethodUnions } from "@/components/admin/method-unions";
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
  // The «Байгууллага» profile — #145, 2026-09-27. Free text, all of it.
  shortName: z.string().nullish(),
  propertyType: z.string().nullish(),
  institutionType: z.string().nullish(),
  location: z.string().nullish(),
  responsibleUnit: z.string().nullish(),
  country: z.string().nullish(),
  province: z.string().nullish(),
  district: z.string().nullish(),
  website: z.string().nullish(),
  facebook: z.string().nullish(),
  headName: z.string().nullish(),
  headPhone: z.string().nullish(),
});

/** The text fields this form edits, each stored as-is (null when emptied). */
type TextField =
  | "shortName"
  | "propertyType"
  | "institutionType"
  | "location"
  | "responsibleUnit"
  | "country"
  | "province"
  | "district"
  | "address"
  | "phone"
  | "email"
  | "website"
  | "facebook"
  | "headName"
  | "headPhone";

/**
 * What «ESIS татах» can fill, from ESIS's organisation read. A suggestion into
 * the form, never a save: the director sees it and presses Хадгалах.
 */
const FROM_ESIS: Partial<Record<TextField, string>> = {
  shortName: "shortName",
  propertyType: "propertyTypeName",
  institutionType: "institutionTypeName",
  province: "provinceName",
  district: "districtName",
};

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

    ★★ Every field is ours and saves (#145, 2026-09-27). «ESIS татах» fills the
    ministry's five — short name, ownership, type, province, district — into
    the form as unsaved edits, from a LIVE answer only; the director saves.
    Заах аргын нэгдэл is `MethodUnions`, over #148's endpoints.
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
          <h1 className="text-heading font-bold leading-heading text-ink sm:text-display">
            {title}
          </h1>
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
  const toast = useToast();
  const [draft, setDraft] = useState<Partial<Record<TextField, string>>>({});
  const [capacity, setCapacity] = useState<string | null>(null);
  const value = (key: TextField) => draft[key] ?? data?.[key] ?? "";
  const set = (key: TextField) => (next: string) => setDraft((prev) => ({ ...prev, [key]: next }));
  const currentCapacity =
    capacity ??
    (data?.capacity === null || data?.capacity === undefined ? "" : String(data.capacity));
  const dirty = Object.keys(draft).length > 0 || capacity !== null;

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

  /*
    ★ ESIS fills the form; it does not save it. What came back is put into the
    fields as unsaved edits, so the director reads the ministry's values next to
    their own and presses Хадгалах — or does not.
  */
  async function pullFromEsis() {
    const result = await esis.refetch();
    const row =
      result.data?.source === "LIVE" && result.data.status === "SUCCEEDED"
        ? result.data.rows[0]
        : undefined;
    if (!row) return;
    const filled: Partial<Record<TextField, string>> = {};
    for (const [field, esisKey] of Object.entries(FROM_ESIS) as [TextField, string][]) {
      const raw = row[esisKey];
      if (raw !== null && raw !== undefined && String(raw).trim()) filled[field] = String(raw);
    }
    setDraft((prev) => ({ ...prev, ...filled }));
    toast.success(
      Object.keys(filled).length > 0
        ? "ESIS-ийн мэдээллийг талбарт орууллаа. Шалгаад «Хадгалах» дарна уу."
        : "ESIS-ээс шинэ мэдээлэл ирсэнгүй.",
    );
  }

  const save = useKindergartenSave(kindergartenId, () => {
    setDraft({});
    setCapacity(null);
  });
  const errors = fieldErrors(save.error);

  const text = (
    key: TextField,
    label: string,
    props: { type?: string; maxLength?: number } = {},
  ) => (
    <Field label={label} error={errors[key]}>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          aria-describedby={describedBy}
          invalid={invalid}
          type={props.type}
          maxLength={props.maxLength ?? 200}
          value={value(key)}
          onChange={(event) => set(key)(event.target.value)}
        />
      )}
    </Field>
  );

  return (
    <Pane
      title="Үндсэн мэдээлэл"
      lede="Байгууллагын ерөнхий мэдээллийг засах боломжтой."
      onSubmit={() => {
        if (!dirty || save.isPending) return;
        const body: Record<string, unknown> = {};
        for (const key of Object.keys(draft) as TextField[]) body[key] = draft[key]!.trim() || null;
        if (capacity !== null) {
          body.capacity = capacity.trim() === "" ? null : Number(capacity);
        }
        save.mutate(body);
      }}
      actions={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void pullFromEsis()}
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
      ) : null}

      <FormSection
        icon={<Building2 size={20} aria-hidden />}
        title="Ерөнхий мэдээлэл"
        lede="Байгууллагын нэр, хэлбэр, өмчийн хэлбэр болон хариуцах нэгжийн мэдээлэл."
      >
        <div className="grid gap-4 md:grid-cols-2">
          {text("location", "Байршил")}
          {text("propertyType", "Өмчийн хэлбэр")}
          {text("institutionType", "Хэв шинж")}
          {text("shortName", "Товч нэр", { maxLength: 100 })}
          {text("responsibleUnit", "Хариуцалагч нэгж")}
          <div className="flex flex-col gap-1.5">
            <span className="text-body font-medium text-ink">Лого оруулах</span>
            <div className="flex flex-wrap items-center gap-3">
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
              {data?.logoMediaFileId ? <RemoveLogoButton kindergartenId={kindergartenId} /> : null}
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
          {text("country", "Улс", { maxLength: 100 })}
          {text("province", "Аймаг/Нийслэл", { maxLength: 100 })}
          {text("district", "Дүүрэг", { maxLength: 100 })}
        </div>
        {/* 500, the API's limit — the screen used to stop at 255. */}
        <Field label="Дэлгэрэнгүй хаяг" error={errors.address}>
          {({ id, describedBy, invalid }) => (
            <div className="flex flex-col gap-1">
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                maxLength={500}
                value={value("address")}
                onChange={(event) => set("address")(event.target.value)}
              />
              <span className="self-end text-caption tabular-nums text-muted">
                {value("address").length}/500
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
          {text("phone", "Утас", { maxLength: 20 })}
          {text("email", "И-мэйл", { type: "email" })}
          {text("website", "Вэб сайт", { type: "url" })}
          {text("facebook", "Facebook", { type: "url" })}
          {text("headName", "Удирдлагын нэр")}
          {text("headPhone", "Удирдлагын утас", { maxLength: 20 })}
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

/** «Лого устгах» — `DELETE /kindergartens/:id/logo`, after a confirmation. */
function RemoveLogoButton({ kindergartenId }: { kindergartenId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/logo`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Лого устгагдлаа.");
      void queryClient.invalidateQueries({ queryKey: qk.adminKindergarten(kindergartenId) });
      void queryClient.invalidateQueries({ queryKey: qk.session() });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="ghost" size="sm">
          Лого устгах
        </Button>
      }
      title="Логог устгах уу?"
      description="Тайлан, толгой хэсэгт лого харагдахгүй болно."
      confirmLabel="Устгах"
      tone="danger"
      pending={remove.isPending}
      onConfirm={() => remove.mutate()}
    />
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

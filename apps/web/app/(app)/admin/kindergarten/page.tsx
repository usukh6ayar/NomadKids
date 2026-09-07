"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { uuidSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { mediaUrl } from "@/lib/api/client";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
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
});

type Detail = z.infer<typeof detailSchema>;

export default function AdminKindergartenPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <AdminKindergarten />
    </RequireRole>
  );
}

function AdminKindergarten() {
  const { primaryKindergartenId } = useSession();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: qk.adminKindergarten(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}`, detailSchema),
    enabled: Boolean(primaryKindergartenId),
  });

  const [form, setForm] = useState<Partial<Detail>>({});

  /*
   * ★ Read first, edit on purpose — 2026-09-06, at the client's request.
   *
   * Every field on this screen was a live input the moment the page loaded, so
   * the kindergarten's own name — the string that prints on every PDF it
   * issues and heads every parent's app — sat one stray keystroke from being
   * changed. Nothing here is edited more than a few times a year, which is
   * exactly the shape that should not be permanently armed: "шууд ингэж ил
   * байлгаж болохгүй, ирээдүйд буруу зүйл хийхээс урьдчилан сэргийлэх".
   *
   * The gate is a mode, not a confirmation dialog. A dialog asks "are you
   * sure?" *after* the damage is typed and is answered reflexively; a mode
   * means the damage cannot be typed at all until somebody says they came here
   * to change something.
   *
   * ★★ There is deliberately no delete. Removing a kindergarten is the
   * platform operator's decision, for the same reason `isActive` is not
   * offered here — see the docblock at the top of this file.
   */
  const [editing, setEditing] = useState(false);

  // The form is only seeded once the record arrives; typing before that would
  // be overwritten the moment it did.
  useEffect(() => {
    if (!data) return;
    setForm({
      name: data.name,
      address: data.address ?? "",
      phone: data.phone ?? "",
      email: data.email ?? "",
      description: data.description ?? "",
    });
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${primaryKindergartenId}`, detailSchema, {
        method: "PATCH",
        body: {
          name: form.name?.trim(),
          // null clears the field; "" would fail the email format check.
          address: form.address?.trim() || null,
          phone: form.phone?.trim() || null,
          email: form.email?.trim() || null,
          description: form.description?.trim() || null,
        },
      }),
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ["admin", "kindergarten"] });
      // The shell prints the kindergarten's name under the logo, so a rename
      // that did not refresh the session would show the old one until reload.
      void queryClient.invalidateQueries({ queryKey: qk.session() });
    },
  });

  const errors = fieldErrors(save.error);

  if (isLoading) return <LoadingState rows={3} />;
  if (isError) return <ErrorState description={errorMessage(error)} />;

  return (
    /*
      ★ The form is capped at a readable measure rather than the shell's width.

      Every control here ran the full 1,140px of the content column, so the
      phone number and the email address each got an input wide enough for a
      paragraph. An input's width is a hint about what belongs in it, and one
      this wide says nothing except that the layout had space left over — while
      making the eye travel from a label on the left edge to a value that stops
      a third of the way across.

      760px is the page-level counterpart to the measures the modal forms
      already keep — `auth-shell` at 440 and `FormDialog` at 480 — which are
      narrower because a dialog floats over the page and a full screen would
      look thin at either. It applies to the wrapper, so the logo card above
      and the form below stay the same width instead of stepping.
    */
    <div className="flex max-w-[760px] flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Цэцэрлэгийн мэдээлэл"
        actions={
          editing ? null : (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" />
              Засах
            </Button>
          )
        }
      />

      {/*
        The saved confirmation lives outside the form now: the form unmounts on
        success (the screen returns to its reading state), so a status rendered
        inside it would flash and vanish with the thing that raised it.
      */}
      {save.isSuccess && !editing ? (
        <p role="status" className="rounded-control bg-mint px-3.5 py-2.5 text-body text-mint-ink">
          Хадгалагдлаа.
        </p>
      ) : null}

      {/*
        RFP §3.2 asks for the logo, and §10.3 puts it on every generated PDF —
        which is the reason it sits at the top of this form rather than at the
        bottom. It is not decoration on a profile page; it is the mark on every
        report the kindergarten issues.

        Its own card, outside the form: it saves on selection, and a file input
        inside a form whose Save button does not apply to it is a reliable way
        to have somebody upload a logo and then wonder why "Хадгалах" is
        greyed out.
      */}
      {/*
        ★ The logo is behind the same gate, and it is the field that needed it
        most: `SingleImageUpload` saves on selection, with no Хадгалах between
        the file picker and the mark on every report the kindergarten issues.
        Out of edit mode the current logo is shown and nothing can replace it.
      */}
      <Card pad="roomy">
        <SectionHeader title="Лого" />
        {editing ? (
          <SingleImageUpload
            endpoint={`/kindergartens/${primaryKindergartenId}/logo`}
            currentMediaId={data?.logoMediaFileId}
            label="Лого нэмэх"
            alt={`${data?.name ?? "Цэцэрлэг"}-ийн лого`}
            hint="Тайлан, PDF бүрд хэвлэгдэнэ. JPEG, PNG эсвэл WebP."
            invalidateKeys={[qk.adminKindergarten(primaryKindergartenId ?? ""), qk.session()]}
          />
        ) : data?.logoMediaFileId ? (
          // `/media/:id` 302s to a presigned URL, which `next/image` cannot
          // follow — every other media surface in this product uses a plain
          // <img> for the same reason.
          <img
            src={mediaUrl(data.logoMediaFileId)}
            alt={`${data.name}-ийн лого`}
            className="h-24 w-auto rounded-control object-contain"
          />
        ) : (
          <p className="text-body text-muted">Лого оруулаагүй байна.</p>
        )}
      </Card>

      {editing ? (
        <Card pad="roomy">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!save.isPending) save.mutate();
            }}
            className="flex flex-col gap-4"
            noValidate
          >
            <FormError
              message={
                save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null
              }
            />

            <Field label="Цэцэрлэгийн нэр" error={errors.name} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={form.name ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              )}
            </Field>

            <Field label="Хаяг" error={errors.address}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={form.address ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                />
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Утас" error={errors.phone}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    type="tel"
                    inputMode="tel"
                    value={form.phone ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                )}
              </Field>

              <Field label="И-мэйл" error={errors.email}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    type="email"
                    inputMode="email"
                    value={form.email ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  />
                )}
              </Field>
            </div>

            <Field
              label="Танилцуулга"
              error={errors.description}
              hint="Эцэг эхэд цэцэрлэгээ танилцуулах богино тайлбар."
            >
              {({ id, describedBy, invalid }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  rows={4}
                  value={form.description ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              )}
            </Field>

            <div className="flex justify-end gap-2">
              {/*
                Болих restores the record's own values rather than merely closing
                the form: without the reset, re-opening it would show whatever
                was half-typed before the reader changed their mind, which reads
                as unsaved work the screen intends to keep.
              */}
              <Button
                type="button"
                variant="secondary"
                disabled={save.isPending}
                onClick={() => {
                  setEditing(false);
                  save.reset();
                  if (data) {
                    setForm({
                      name: data.name,
                      address: data.address ?? "",
                      phone: data.phone ?? "",
                      email: data.email ?? "",
                      description: data.description ?? "",
                    });
                  }
                }}
              >
                Болих
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Card pad="roomy">
          <dl className="flex flex-col gap-4">
            <DetailRow label="Цэцэрлэгийн нэр" value={data?.name} />
            <DetailRow label="Хаяг" value={data?.address} />
            <DetailRow label="Утас" value={data?.phone} />
            <DetailRow label="И-мэйл" value={data?.email} />
            <DetailRow label="Танилцуулга" value={data?.description} />
          </dl>
        </Card>
      )}
    </div>
  );
}

/**
 * One label/value pair in the reading state.
 *
 * An empty field says so rather than rendering a blank line: "—" on its own
 * leaves the reader unsure whether the value is missing or the screen failed
 * to load it, and this form has four optional fields.
 */
function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className={value ? "text-body text-ink" : "text-body text-faint"}>
        {value || "Бөглөөгүй"}
      </dd>
    </div>
  );
}

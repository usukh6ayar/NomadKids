"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { uuidSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";

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
    <div className="flex flex-col gap-5 lg:gap-7">
      <PageHeader
        title="Цэцэрлэгийн мэдээлэл"
        lede="Эцэг эхэд харагдах нэр, хаяг, холбоо барих мэдээлэл."
      />

      <Card className="px-4 py-4 sm:px-5">
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

          {save.isSuccess ? (
            <p
              role="status"
              className="rounded-control bg-mint px-3.5 py-2.5 text-body text-mint-ink"
            >
              Хадгалагдлаа.
            </p>
          ) : null}

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

          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { userProfileSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useLogout } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";

const profileSchema = userProfileSchema.extend({
  specialization: z.string().nullish(),
  education: z.string().nullish(),
});

const MIN_PASSWORD_LENGTH = 8;

/**
 * Own profile and password.
 *
 * Two independent forms on one page. Deliberately separate mutations: a failed
 * password change must not discard edits to the name field, and a single
 * combined save would make "what exactly did I just change" unanswerable.
 */
export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6 py-2">
      <h1 className="text-xl font-semibold text-ink">Профайл</h1>
      <ProfileForm />
      <PasswordForm />
      <SignOutCard />
    </div>
  );
}

function ProfileForm() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: qk.profile(),
    queryFn: () => get("/me/profile", profileSchema),
  });

  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!data) return;
    setForm({
      lastName: data.lastName ?? "",
      firstName: data.firstName ?? "",
      email: data.email ?? "",
      phone: data.phone ?? "",
      specialization: data.specialization ?? "",
      education: data.education ?? "",
      bio: data.bio ?? "",
    });
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      mutate("/me/profile", profileSchema, {
        method: "PATCH",
        body: {
          lastName: form.lastName?.trim(),
          firstName: form.firstName?.trim(),
          // null clears the field; "" would fail the email format check.
          email: form.email?.trim() || null,
          phone: form.phone?.trim() || null,
          specialization: form.specialization?.trim() || null,
          education: form.education?.trim() || null,
          bio: form.bio?.trim() || null,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.profile() });
      // The shell shows the name, so the session has to be refreshed too.
      void queryClient.invalidateQueries({ queryKey: qk.session() });
    },
  });

  const errors = fieldErrors(save.error);

  if (isLoading) return <LoadingState rows={3} />;
  if (isError) return <ErrorState description={errorMessage(error)} />;

  return (
    <section aria-labelledby="profile-heading">
      <SectionHeader title="Хувийн мэдээлэл" />

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
            <p role="status" className="rounded-[12px] bg-mint px-3.5 py-2.5 text-sm text-mint-ink">
              Хадгалагдлаа.
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Овог" error={errors.lastName} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={form.lastName ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                />
              )}
            </Field>

            <Field label="Нэр" error={errors.firstName} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={form.firstName ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
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
                  autoComplete="email"
                  value={form.email ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
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
                  autoComplete="tel"
                  value={form.phone ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              )}
            </Field>
          </div>

          <Field label="Танилцуулга" error={errors.bio}>
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={form.bio ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
              />
            )}
          </Field>

          <div>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}

function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: () =>
      mutate("/auth/password", z.unknown(), {
        method: "POST",
        body: { currentPassword, newPassword },
      }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    },
  });

  const errors = fieldErrors(change.error);

  return (
    <section aria-labelledby="password-heading">
      <SectionHeader title="Нууц үг солих" />

      <Card className="px-4 py-4 sm:px-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (change.isPending) return;

            if (newPassword.length < MIN_PASSWORD_LENGTH) {
              setLocalError(`Шинэ нууц үг дор хаяж ${MIN_PASSWORD_LENGTH} тэмдэгт байх ёстой.`);
              return;
            }
            if (newPassword !== confirm) {
              setLocalError("Хоёр нууц үг таарахгүй байна.");
              return;
            }

            setLocalError(null);
            change.mutate();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <FormError message={localError ?? (change.isError ? errorMessage(change.error) : null)} />

          {change.isSuccess ? (
            <p role="status" className="rounded-[12px] bg-mint px-3.5 py-2.5 text-sm text-mint-ink">
              Нууц үг солигдлоо. Бусад төхөөрөмжөөс гарсан байна.
            </p>
          ) : null}

          <Field label="Одоогийн нууц үг" error={errors.currentPassword} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Шинэ нууц үг" error={errors.newPassword} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              )}
            </Field>

            <Field label="Шинэ нууц үг давтах" required>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              )}
            </Field>
          </div>

          <div>
            <Button type="submit" disabled={change.isPending}>
              {change.isPending ? "Солиж байна…" : "Нууц үг солих"}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}

function SignOutCard() {
  const logout = useLogout();

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
      <div>
        <p className="font-medium text-ink">Системээс гарах</p>
        <p className="text-sm text-muted">Энэ төхөөрөмжөөс гарна.</p>
      </div>
      <Button variant="secondary" onClick={() => void logout()}>
        Гарах
      </Button>
    </Card>
  );
}

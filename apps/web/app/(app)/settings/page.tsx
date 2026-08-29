"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { z } from "zod";
import { userProfileSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { PageHeader } from "@/components/shell/app-shell";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useLogout } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { SingleImageUpload } from "@/components/media/single-image-upload";

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
    /*
      ★ A capped column, like the feed — 2026-08-29.

      These are three forms, and a form at 1336px is a label on the far left
      with its field running to the far right: the eye has to travel the whole
      width to connect the two. `/notifications` was capped at 640px in the same
      pass and for the same reason; a settings page has even less excuse, since
      none of its fields is longer than a phone number.

      760px rather than 640: the profile's name and email sit two-across from
      `sm`, and 640 squeezed that pair to about 300px each.
    */
    <div className="flex w-full max-w-[760px] flex-col gap-6 lg:gap-8">
      <PageHeader title="Профайл" lede="Хувийн мэдээлэл, нэвтрэх нууц үг." />
      <ProfileForm />
      <PasswordForm />
      <SignOutCard />
    </div>
  );
}

function ProfileForm() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: qk.profile(),
    queryFn: () => get("/me/profile", profileSchema),
  });

  const [form, setForm] = useState<Record<string, string>>({});
  /**
   * ★ A profile reads as a profile until you ask to change it.
   *
   * This screen was a form that was always open — six text inputs and a Save
   * button, whether or not anybody intended to edit anything. That is a form
   * with a heading, not a profile: there is no state in which a teacher can
   * simply *look at* their own details, and an always-editable field invites
   * the accidental keystroke that a Save button then makes permanent.
   *
   * Reading is the default and editing is a mode you enter deliberately, which
   * is what "Засах дарж байгаад засна" asks for. Cancelling restores the saved
   * values rather than keeping a half-typed draft around.
   */
  const [editing, setEditing] = useState(false);

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
      toast.success("Хувийн мэдээлэл хадгалагдлаа.");
      setEditing(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  /** Throws away the draft and returns to the read view. */
  function cancelEdit() {
    if (data) {
      setForm({
        lastName: data.lastName ?? "",
        firstName: data.firstName ?? "",
        email: data.email ?? "",
        phone: data.phone ?? "",
        specialization: data.specialization ?? "",
        education: data.education ?? "",
        bio: data.bio ?? "",
      });
    }
    save.reset();
    setEditing(false);
  }

  const errors = fieldErrors(save.error);

  if (isLoading) return <LoadingState rows={3} />;
  if (isError) return <ErrorState description={errorMessage(error)} />;

  return (
    <section aria-labelledby="profile-heading">
      <SectionHeader
        id="profile-heading"
        title="Хувийн мэдээлэл"
        action={
          editing ? undefined : (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil size={16} aria-hidden="true" />
              Засах
            </Button>
          )
        }
      />

      {/*
        RFP §3.3 — профайл зураг. Outside the form and above it: the upload
        saves on selection, so putting it inside a form with its own Save button
        would leave somebody choosing a picture and then wondering why the
        button stayed greyed out.

        Only ever the signed-in user's own — the API refuses any other id, and
        this component has no way to name one.
      */}
      <Card pad="roomy" className="mb-4">
        <SingleImageUpload
          endpoint={`/users/${data?.id}/photo`}
          currentMediaId={data?.photoMediaFileId}
          label="Зураг нэмэх"
          alt="Таны профайл зураг"
          shape="round"
          invalidateKeys={[qk.profile(), qk.session()]}
        />
      </Card>

      {!editing ? (
        /*
          The read view. A definition list rather than disabled inputs: a greyed
          field still looks like something you failed to type into, where a
          label over a value looks like a record — and an empty one says "—"
          instead of showing a blank box.
        */
        <Card pad="roomy">
          <dl className="grid gap-4 sm:grid-cols-2">
            <ReadField label="Овог" value={data?.lastName} />
            <ReadField label="Нэр" value={data?.firstName} />
            <ReadField label="И-мэйл" value={data?.email} />
            <ReadField label="Утас" value={data?.phone} />
            <ReadField label="Танилцуулга" value={data?.bio} className="sm:col-span-2" />
          </dl>
        </Card>
      ) : (
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

            {/*
            ★ The inline "Хадгалагдлаа." block that sat here is now a toast.

            This form is long enough to scroll, and the submit button is at its
            foot — so a confirmation rendered at the top was frequently off
            screen at the moment it appeared, which is the failure mode
            CLAUDE.md §5's "toast after save" exists to prevent. The error above
            stays inline: it is attached to the fields the user has to fix.
          */}

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

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
              </Button>
              <Button type="button" variant="ghost" onClick={cancelEdit} disabled={save.isPending}>
                Болих
              </Button>
            </div>
          </form>
        </Card>
      )}
    </section>
  );
}

/** One label-and-value pair of the read view. */
function ReadField({
  label,
  value,
  className,
}: {
  label: string;
  value?: string | null;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-caption text-muted">{label}</dt>
      {/* An em dash, not an empty node: a blank line under a label reads as a
          rendering fault rather than as "nothing recorded". */}
      <dd className="mt-0.5 whitespace-pre-wrap text-body text-ink">{value?.trim() || "—"}</dd>
    </div>
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
      <SectionHeader id="password-heading" title="Нууц үг солих" />

      <Card pad="roomy">
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
            <p
              role="status"
              className="rounded-control bg-mint px-3.5 py-2.5 text-body text-mint-ink"
            >
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
    <Card pad="roomy" className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-medium text-ink">Системээс гарах</p>
        <p className="text-body text-muted">Энэ төхөөрөмжөөс гарна.</p>
      </div>
      <Button variant="secondary" onClick={() => void logout()}>
        Гарах
      </Button>
    </Card>
  );
}

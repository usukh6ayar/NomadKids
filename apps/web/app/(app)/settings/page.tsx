"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  Database,
  KeyRound,
  Mail,
  Pencil,
} from "lucide-react";
import { z } from "zod";
import {
  esisMyProfileSchema,
  PASSWORD_RULES,
  userProfileSchema,
  validatePasswordStrength,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { PageHeader } from "@/components/shell/app-shell";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useLogout, useSession } from "@/lib/auth/session";
import { buildEsisDemoProfile, type EsisDemoField } from "@/lib/esis/demo-profile";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, PasswordInput, Textarea } from "@/components/ui/field";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { ChildAvatar } from "@/components/media/media-image";
import { PhotoBadgeButton } from "@/components/media/photo-badge-button";

const profileSchema = userProfileSchema.extend({
  specialization: z.string().nullish(),
  education: z.string().nullish(),
});

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
      ★ Capped, and one column again — 2026-09-06.

      It was two columns from `xl`: the profile on the left, the password form
      and the sign-out row on the right. That split existed because there were
      two forms; there is one now. "Нууц үг солих" is a dialog opened from the
      profile card (see `PasswordDialog`), so the right-hand column held a
      single sign-out row — a column of chrome beside a column of content.

      The reasoning the old note recorded, kept because it is still the reason
      for the 760px cap:

      A form at 1336px is a label on the far left with its field running to the
      far right, and the eye has to travel the whole width to connect them. So
      the forms are capped, and were capped at a flat 760px until 2026-08-29.

      That fixed the field width and created a different fault: on a 1440px
      screen the content column is about 1140px, so a 760px page left 380px of
      nothing down its right-hand side. The report was that it does not fill the
      screen — and it does not, because a cap is a limit on a *line*, not a
      layout for a page.

      A cap is a limit on a *line*, not a layout for a page — but with one form
      on the page, the line is the page.
    */
    <div className="flex w-full flex-col gap-6 lg:gap-8">
      <PageHeader title="Хувийн тохиргоо" />

      <div className="flex w-full max-w-[760px] flex-col gap-6 lg:gap-8">
        <ProfileForm />
        <EsisProfileSection />
        <SignOutCard />
      </div>
    </div>
  );
}

/** ESIS values belong on the user's profile, visible without a separate pull action. */
function EsisProfileSection() {
  const { roles, primaryKindergartenId } = useSession();
  const { data, isLoading, isError } = useQuery({
    queryKey: qk.profile(),
    queryFn: () => get("/me/profile", profileSchema),
  });
  const esisQuery = useQuery({
    queryKey: ["esis", "my-profile", primaryKindergartenId],
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/esis/my-profile`, esisMyProfileSchema),
    enabled: Boolean(primaryKindergartenId),
    retry: false,
  });

  if (isLoading || esisQuery.isLoading || isError || !data) return null;
  if (esisQuery.isError) {
    return (
      <section aria-labelledby="esis-profile-heading">
        <SectionHeader id="esis-profile-heading" title="ESIS мэдээлэл" />
        <Card pad="compact" tone="sun">
          <p className="font-medium text-ink">ESIS мэдээлэл түр татагдсангүй.</p>
          <p className="mt-1 text-body text-muted">{errorMessage(esisQuery.error)}</p>
        </Card>
      </section>
    );
  }

  const esis = buildEsisDemoProfile(data, roles);
  const live = esisQuery.data?.mode === "LIVE" ? esisQuery.data : null;
  if (!esis && !live) return null;

  if (live) {
    const fields = live.fields
      .filter((field) => field.ingested)
      .map((field) => ({ label: field.label, value: live.row[field.name] ?? "—" }));
    return (
      <section aria-labelledby="esis-profile-heading">
        <SectionHeader
          id="esis-profile-heading"
          title="ESIS мэдээлэл"
          action={
            <Badge tone="mint">
              <CheckCircle2 size={13} aria-hidden="true" />
              Бодит ESIS синк
            </Badge>
          }
        />
        <Card pad="roomy" className="flex flex-col gap-5">
          <div className="flex flex-wrap items-start gap-3 border-b border-border-soft pb-5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-control bg-sky text-sky-ink">
              <Database size={21} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">
                {live.resource === "teachers" ? "Багшийн бүртгэл" : "Ажилтны бүртгэл"}
              </p>
              <p className="mt-0.5 text-body text-muted">
                API {live.slug} · {live.endpoint}
              </p>
            </div>
            <p className="shrink-0 text-caption text-muted">
              Шинэчилсэн: {new Date(live.syncedAt).toLocaleString("mn-MN")}
            </p>
          </div>
          <EsisFieldGroup
            icon={BriefcaseBusiness}
            title={`ESIS гаралтын ${fields.length} талбар`}
            fields={fields}
          />
        </Card>
      </section>
    );
  }

  if (!esis) return null;

  return (
    <section aria-labelledby="esis-profile-heading">
      <SectionHeader id="esis-profile-heading" title="ESIS мэдээлэл" />

      <Card pad="roomy" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start gap-3 border-b border-border-soft pb-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-control bg-sky text-sky-ink">
            <Database size={21} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-ink">{esis.resourceLabel}</p>
            </div>
            <p className="mt-0.5 text-body text-muted">Эх сурвалж: ESIS · {esis.resource}</p>
          </div>
          <p className="shrink-0 text-caption text-muted">Шинэчилсэн: {esis.syncedAt}</p>
        </div>

        <EsisFieldGroup
          icon={Building2}
          title="Байгууллага ба үндсэн мэдээлэл"
          fields={[
            { label: "Байгууллагын нэр", value: esis.institutionName },
            { label: "Байгууллагын код", value: esis.institutionId },
            ...esis.summary,
          ]}
        />
        <EsisFieldGroup icon={BriefcaseBusiness} title="Томилгоо" fields={esis.employment} />
        <EsisFieldGroup icon={Mail} title="Холбоо барих мэдээлэл" fields={esis.contact} />

        <p className="border-t border-border-soft pt-4 text-caption text-muted">
          Татахгүй талбар: регистр, иргэний бүртгэлийн дугаар, нэвтрэх мэдээлэл.
        </p>
      </Card>
    </section>
  );
}

function EsisFieldGroup({
  icon: Icon,
  title,
  fields,
}: {
  icon: typeof Building2;
  title: string;
  fields: EsisDemoField[];
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-body font-semibold text-ink">
        <Icon size={17} className="text-primary" aria-hidden="true" />
        <h3>{title}</h3>
      </div>
      <dl className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        {fields.map((field) => (
          <ReadField key={field.label} label={field.label} value={field.value} />
        ))}
      </dl>
    </div>
  );
}

function ProfileForm() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { roles } = useSession();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: qk.profile(),
    queryFn: () => get("/me/profile", profileSchema),
  });
  const esisProfile = data ? buildEsisDemoProfile(data, roles) : null;
  const specialization = data?.specialization || esisProfile?.profileDefaults.specialization || "";

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
      specialization,
      education: data.education ?? "",
      bio: data.bio ?? "",
    });
  }, [data, specialization]);

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
        specialization,
        education: data.education ?? "",
        bio: data.bio ?? "",
      });
    }
    save.reset();
    setEditing(false);
  }

  const errors = fieldErrors(save.error);

  if (isLoading) return <LoadingState rows={4} shape="text" />;
  if (isError) return <ErrorState description={errorMessage(error)} />;

  return (
    <section aria-labelledby="profile-heading">
      <SectionHeader id="profile-heading" title="Хувийн мэдээлэл" />

      {!editing ? (
        /*
          The read view. A definition list rather than disabled inputs: a greyed
          field still looks like something you failed to type into, where a
          label over a value looks like a record — and an empty one says "—"
          instead of showing a blank box.

          ★ One card, with the picture in its header — it was two.

          The upload sat in a `Card` of its own above this one: a dashed circle,
          a full-width "Зураг нэмэх" button and a line of hint text, which is
          most of a card's height to say one thing. Under it a second card held
          the four fields. A profile is one record, and splitting it put a rule
          and 16px of gap through the middle of it.

          Now the picture leads the card and the person's name sits beside it,
          which is the shape every profile converges on for the same reason: the
          two identify the same person and belong on the same line.
        */
        <Card pad="roomy" className="flex flex-col gap-5">
          {/*
            ★ The picture is the control — 2026-09-06, at the client's request:
            "зураг нэмэх гэж тусдаа button байхгүй, камерын зурагтай тэнд нь
            дардаг болгоё".

            A "Зураг нэмэх" button sat under the name and took a line of its
            own to say what the avatar beside it already showed. The camera
            badge is the affordance every product uses for this, it is on the
            thing being changed, and it costs no layout — the same argument
            `child-photo-button.tsx` made for a child's portrait, now shared as
            `PhotoBadgeButton`.

            `ChildAvatar` draws the picture, or the person's initials on a
            tinted circle when there is none — a name is a real answer where
            `SingleImageUpload`'s dashed ring reads as a broken image.

            ★★ The badge stays outside the form and works in both states,
            because this endpoint saves on selection: a picture chosen inside a
            form with a Хадгалах button reads as unsaved until one is pressed.
            Only ever the signed-in user's own — the API refuses any other id.
          */}
          <div className="flex flex-wrap items-center gap-4 border-b border-border-soft pb-5">
            <span className="relative shrink-0">
              <ChildAvatar child={data ?? {}} size={72} />
              <PhotoBadgeButton
                endpoint={`/users/${data?.id}/photo`}
                label="Профайл зураг солих"
                invalidateKeys={[qk.profile(), qk.session()]}
              />
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-title font-semibold text-ink">
                {[data?.lastName, data?.firstName].filter(Boolean).join(" ") || "—"}
              </p>
              <p className="truncate text-body text-muted">{data?.email || "И-мэйл оруулаагүй"}</p>
            </div>

            {/*
              ★ Засах moved off the page header and into the card — same
              request, second half: "тэр edit-ийг нь дээр нь байхгүйгээр box-ын
              дотор нь оруулж гоё байрлуулж өгөх".

              It belongs to this record, not to the screen, and the screen's
              header is above a card that is now the only thing on the page —
              so a control up there was pointing down at the one object beneath
              it from outside its own box. On the identity row it sits opposite
              the name it edits, which is where a profile puts it.
            */}
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0"
              onClick={() => setEditing(true)}
            >
              <Pencil size={16} aria-hidden="true" />
              Засах
            </Button>
          </div>

          {/*
            ★ One sentence when every optional field is empty, not four dashes.

            The header already states the name and the email, so what is left
            here is only what it does not say — and on a fresh account that is
            Утас, Мэргэжил, Боловсрол and Танилцуулга, all blank. Four labels
            over four em dashes reads as a form that failed to load, and it is
            the first thing a new teacher sees on their own profile.

            The dash is still right for *one* missing value among several: it
            says "we asked and there is no answer". A whole card of them says
            something else, so the empty case gets a sentence and the Засах
            button in the header above is the next step.
          */}
          {!data?.phone && !specialization && !data?.education && !data?.bio ? (
            <p className="text-body text-muted">
              Утас, мэргэжил, боловсролоо нэмбэл багш нарын жагсаалтад бүрэн харагдана.
            </p>
          ) : (
            <dl className="grid gap-4 sm:grid-cols-2">
              <ReadField label="Утас" value={data?.phone} />
              <ReadField label="Мэргэжил" value={specialization} />
              <ReadField label="Боловсрол" value={data?.education} />
              <ReadField label="Танилцуулга" value={data?.bio} className="sm:col-span-2" />
            </dl>
          )}
        </Card>
      ) : (
        <Card pad="roomy" className="flex flex-col gap-5">
          {/*
            The same identity row as the read view, so pressing Засах changes
            what is editable and not where anything is. The badge stays outside
            the form below it, for the reason its own note gives: this endpoint
            saves on selection, and a picture chosen inside a form with a
            Хадгалах button reads as unsaved until one is pressed.
          */}
          <div className="flex flex-wrap items-center gap-4 border-b border-border-soft pb-5">
            <span className="relative shrink-0">
              <ChildAvatar child={data ?? {}} size={72} />
              <PhotoBadgeButton
                endpoint={`/users/${data?.id}/photo`}
                label="Профайл зураг солих"
                invalidateKeys={[qk.profile(), qk.session()]}
              />
            </span>

            <p className="min-w-0 flex-1 text-body text-muted">
              Зургаа солихдоо камерын тэмдэг дээр дарна уу.
            </p>
          </div>

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

          {/*
            ★ The password lives inside the edit card — corrected 2026-09-06,
            twice.

            It began as a permanently open card beside the profile: four policy
            rules and three password fields on screen every time anybody came to
            check their own telephone number, for a thing people do once a year.
            The client asked for that to stop.

            The first correction moved it into a dialog opened from a second
            header button, and the client's answer was "шал сонин байна" — fair,
            and the reason is legible in hindsight: two buttons where the screen
            had one, and a modal for a form that belongs to the record already
            open behind it. Changing your password is *editing your account*,
            not a separate errand.

            So it is the last section of the edit form, under a rule, folded
            shut. You press Засах, and the way to change your password is where
            you would look for it — "profile дотроо edit гэхэд нь".

            ★★ Its own submit, and that is not an oversight.

            `PATCH /me/profile` and `POST /auth/password` are two endpoints with
            two outcomes, and the second signs every other device out. One
            "Хадгалах" spanning both would make a name correction capable of
            ending somebody's sessions, and would have to decide what "half
            saved" means when one call succeeds and the other does not.
          */}
          <PasswordSection />
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

/**
 * Changing your own password — `POST /auth/password`.
 *
 * ★ The last section of the profile's edit form, folded shut. See the note at
 * its call site for the two attempts this replaces.
 *
 * ★★ The fields exist only while the section is open.
 *
 * Not `hidden`, not disabled — unmounted. A "current password" input sitting
 * in the DOM of a page somebody left open is a credential a password manager
 * will offer to fill and a shoulder will read; there is no reason for it to be
 * there before somebody has said they are changing their password, and closing
 * the section clears whatever was typed.
 *
 * ★★★ The success line stays until the section is closed, deliberately. It
 * says every other device has been signed out, which is a consequence somebody
 * needs to read *after* the change rather than a toast that slides away.
 */
function PasswordSection() {
  const [open, setOpen] = useState(false);
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

  function close() {
    setOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirm("");
    setLocalError(null);
    change.reset();
  }

  return (
    <div className="mt-5 border-t border-border-soft pt-5">
      {/*
        The row that is always there: what this section is, and one control.
        Under a rule, so it reads as a second subject rather than a seventh
        field of the profile above it.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-body font-medium text-ink">Нэвтрэх нууц үг</p>
          <p className="text-caption text-muted">
            Солисны дараа бусад төхөөрөмжөөс автоматаар гарна.
          </p>
        </div>

        {open ? (
          <Button type="button" variant="ghost" size="sm" onClick={close}>
            Болих
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-expanded={false}
            onClick={() => setOpen(true)}
          >
            <KeyRound size={16} aria-hidden="true" />
            Нууц үг солих
          </Button>
        )}
      </div>

      {open ? (
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (change.isPending) return;

            // Same rules the API runs, from the same module — see
            // `@kinder/contracts/password`.
            const weaknesses = validatePasswordStrength(newPassword);
            if (weaknesses.length > 0) {
              setLocalError(`${weaknesses.join(". ")}.`);
              return;
            }
            if (newPassword !== confirm) {
              setLocalError("Хоёр нууц үг таарахгүй байна.");
              return;
            }

            setLocalError(null);
            change.mutate();
          }}
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

          {/*
            ★ The rules, before anything is typed — 2026-09-04.

            This form has always *checked* `validatePasswordStrength` and never
            *shown* what it checks, so the only way to learn the rules was to
            fail them: type a password, submit, read a red line naming what was
            wrong, try again. The client's report was exactly that — "алдаа
            байнга гараад байна".

            `/invitation/:token` and `/reset-password/:token` already listed
            them (`password-policy.test.tsx` pins both). This screen is the
            third place a password is set and was the one that did not — which
            is why it is where the errors came from.

            Same `PASSWORD_RULES` the server enforces, so the list cannot drift
            from the check.
          */}
          <ul className="list-disc space-y-1 pl-5 text-body text-muted">
            {PASSWORD_RULES.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>

          <Field label="Одоогийн нууц үг" error={errors.currentPassword} required>
            {({ id, describedBy, invalid }) => (
              <PasswordInput
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Шинэ нууц үг" error={errors.newPassword} required>
              {({ id, describedBy, invalid }) => (
                <PasswordInput
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              )}
            </Field>

            <Field label="Шинэ нууц үг давтах" required>
              {({ id, describedBy }) => (
                <PasswordInput
                  id={id}
                  aria-describedby={describedBy}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={change.isPending}>
              {change.isPending ? "Солиж байна…" : "Нууц үг шинэчлэх"}
            </Button>
            {/*
              "Хаах" once it has worked, "Болих" before: the same control, and
              the word says which of the two it is. The success line above stays
              on screen until this is pressed — see the docblock.
            */}
            <Button type="button" variant="ghost" onClick={close} disabled={change.isPending}>
              {change.isSuccess ? "Хаах" : "Болих"}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
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

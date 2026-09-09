"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { BriefcaseBusiness, Building2, Database, KeyRound, Mail } from "lucide-react";
import { z } from "zod";
import {
  esisMyProfileSchema,
  PASSWORD_RULES,
  userProfileSchema,
  validatePasswordStrength,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useLogout, useSession } from "@/lib/auth/session";
import { buildEsisDemoProfile, type EsisDemoField } from "@/lib/esis/demo-profile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, PasswordInput } from "@/components/ui/field";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";
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
        <ProfileCard />
        <EsisProfileSection />
        {/*
          ★ The kindergarten's teaching staff, under the reader's own record —
          2026-09-09, at the client's request ("багшийн ерөнхий мэдээлэл").

          `EsisProfileSection` above is `my-profile`: one person, matched to
          whoever is signed in. This is `teacher/list`, the whole roll — the
          instructor ids the group services refer to, and the assignment each
          one carries. A teacher's own screen is where it belongs, because the
          user list that would otherwise hold it is `@Roles("ADMIN")`.

          It renders nothing for a cook or an accountant: `teachers` is not in
          their service list, so the catalog does not return it.
        */}
        <EsisDataPanel
          resource="teachers"
          /*
            ★ "Жагсаалт" for the same reason the roster panel took it —
            2026-09-09. `api-41` is `teacher/list` and returns the roll; the
            reader's *own* ESIS record is the panel above this one, built from
            `my-profile`. Two panels, two questions, and only the first is a
            list.
          */
          title="Багшийн жагсаалт"
          description="ESIS-д бүртгэлтэй багш нарын томилгоо"
        />
        <SignOutCard />
      </div>
    </div>
  );
}

/**
 * The signed-in person's employment record, on their own settings screen.
 *
 * ★ No "ESIS мэдээлэл" heading and no `Demo ESIS` badge — 2026-09-08, at the
 * client's instruction, the same one that took them off the director's screens:
 * the record is to read as this screen's own, not as a labelled import. Where
 * the values come from is recorded here and on `/admin/integrations/esis`,
 * which keeps its badges because it exists to answer exactly that question.
 *
 * ★★ It has always been built from the signed-in account — see
 * `buildEsisDemoProfile`. The name, the e-mail and the position are the
 * person's own; only the ESIS identifiers are illustrative, and no civil id,
 * register number or credential is ever represented.
 */
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
      <section aria-label="Ажлын мэдээлэл">
        <Card pad="compact" tone="sun">
          <p className="font-medium text-ink">Ажлын мэдээлэл түр татагдсангүй.</p>
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
      <section aria-label="Ажлын мэдээлэл">
        <Card pad="roomy" className="flex flex-col gap-5">
          <div className="flex flex-wrap items-start gap-3 border-b border-border-soft pb-5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-control bg-sky text-sky-ink">
              <Database size={21} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-ink">
                {live.resource === "teachers" ? "Багшийн бүртгэл" : "Ажилтны бүртгэл"}
              </h2>
              <p className="mt-0.5 break-all font-mono text-caption text-faint">
                {live.slug} · {live.endpoint}
              </p>
            </div>
            <p className="shrink-0 text-caption text-muted">
              Шинэчилсэн: {new Date(live.syncedAt).toLocaleString("mn-MN")}
            </p>
          </div>
          <EsisFieldGroup
            icon={BriefcaseBusiness}
            title={`${fields.length} талбар`}
            fields={fields}
          />
        </Card>
      </section>
    );
  }

  if (!esis) return null;

  return (
    <section aria-labelledby="esis-profile-heading">
      <SectionHeader
        id="esis-profile-heading"
        title="ESIS мэдээлэл"
        action={<Badge tone="sun">Demo / Test data · MOCK</Badge>}
      />

      <Card pad="roomy" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start gap-3 border-b border-border-soft pb-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-control bg-sky text-sky-ink">
            <Database size={21} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-ink">{esis.resourceLabel}</h2>
              <Badge tone="sun">Жинхэнэ ESIS синк биш</Badge>
            </div>
            <p className="mt-0.5 text-body text-muted">
              Эх сурвалж: ESIS schema-тай mock fixture · {esis.resource}
            </p>
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

/**
 * Who is signed in, and their picture.
 *
 * ★ No editing — 2026-09-08, at the client's instruction: "цаанаасаа шууд
 * оруулж мэдээлэл авах болохоор edit гэсэн хэсэгт байгаа edit-үүдийг арилга".
 *
 * The form this card used to open — овог, нэр, и-мэйл, утас, мэргэжил,
 * боловсрол, танилцуулга — is gone, and `PATCH /me/profile` has no caller left
 * in this product. What the panel below shows is what ESIS holds about this
 * person, and the client's position is that it is not a thing to hand-correct
 * here.
 *
 * ★★ Two things stayed, and both are deliberate:
 *
 *   The **picture**, because ESIS supplies none. Removing its badge would mean
 *   nobody could ever set a profile photo again, which is not information
 *   arriving from anywhere — it saves on selection, against its own endpoint.
 *
 *   The **password**, which was the last section of that form (see
 *   `PasswordSection`'s own note for the two arrangements the client rejected
 *   before it landed there). Changing a password is not correcting a record;
 *   losing it with the form would have left an account with no way to rotate
 *   its own credentials. It sits on the page now, folded shut, which is the
 *   shape it already had inside the form.
 */
function ProfileCard() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: qk.profile(),
    queryFn: () => get("/me/profile", profileSchema),
  });

  if (isLoading) return <LoadingState rows={2} shape="text" />;
  if (isError) return <ErrorState description={errorMessage(error)} />;

  return (
    <section aria-label="Хувийн тохиргоо">
      <Card pad="roomy" className="flex flex-col gap-5">
        {/*
          ★ The picture is the control — 2026-09-06, at the client's request:
          "зураг нэмэх гэж тусдаа button байхгүй, камерын зурагтай тэнд нь
          дардаг болгоё". `ChildAvatar` draws the picture, or the person's
          initials on a tinted circle when there is none — a name is a real
          answer where a dashed ring reads as a broken image.
        */}
        <div className="flex flex-wrap items-center gap-4">
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
        </div>

        <div className="border-t border-border-soft pt-5">
          <PasswordSection identifier={data?.email || data?.username || ""} email={data?.email} />
        </div>
      </Card>
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
function PasswordSection({
  identifier,
  email,
}: {
  /** What `POST /auth/password-reset` is asked about — this account. */
  identifier: string;
  /** Where the link would land, or nothing. */
  email?: string | null;
}) {
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

  /**
   * "Мартсан уу?" — the same reset `/forgot-password` requests, from here.
   *
   * ★ 2026-09-08, at the client's request: "одоогийн нууц үгээ мэдэхгүй ч
   * байж болишд". `POST /auth/password` needs the current password, so
   * somebody who has forgotten it could change nothing from this screen and
   * had to sign out to reach the recovery they were already signed in beside.
   *
   * ★★ It sends this account's own identifier rather than asking for one.
   * `/forgot-password` asks because it serves a stranger and must not confirm
   * whether an identifier exists; here the caller is authenticated and it is
   * their own account, so the neutral wording that page needs would be
   * evasive rather than careful. It says what happened.
   */
  const forgot = useMutation({
    mutationFn: () =>
      mutate("/auth/password-reset", z.unknown(), {
        method: "POST",
        body: { identifier },
      }),
  });

  const errors = fieldErrors(change.error);

  function close() {
    setOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirm("");
    setLocalError(null);
    change.reset();
    forgot.reset();
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

          {/*
            Under the field it rescues, because that is where somebody
            discovers they cannot fill it in.
          */}
          {forgot.isSuccess ? (
            <p role="status" className="text-body text-mint-ink">
              Сэргээх холбоосыг {email} хаяг руу илгээлээ. И-мэйлээ шалгана уу.
            </p>
          ) : email ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 self-start"
              disabled={forgot.isPending}
              onClick={() => forgot.mutate()}
            >
              {forgot.isPending ? "Илгээж байна…" : "Одоогийн нууц үгээ мартсан уу?"}
            </Button>
          ) : (
            /*
              No e-mail, so no link can be sent. Saying so is the honest answer
              and it is not an enumeration leak: this is the signed-in person's
              own account, and they can act on it.
            */
            <p className="text-caption text-muted">
              Нууц үгээ мартсан бол эрхлэгчид хандана уу — бүртгэлд и-мэйл бүртгээгүй тул сэргээх
              холбоос илгээх боломжгүй.
            </p>
          )}
          {forgot.isError ? (
            <p role="alert" className="text-body text-danger">
              {errorMessage(forgot.error)}
            </p>
          ) : null}

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

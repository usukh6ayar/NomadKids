"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Database, IdCard, KeyRound, Pencil, UsersRound } from "lucide-react";
import { z } from "zod";
import {
  esisMyProfileSchema,
  parentDashboardSchema,
  PASSWORD_RULES,
  ROLE_LABEL,
  userProfileSchema,
  validatePasswordStrength,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { PageHeader } from "@/components/shell/app-shell";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, PasswordInput } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { useToast } from "@/components/ui/toast";
import { useMyGroup } from "@/components/dashboard/use-my-group";
import { fullName, groupLabel } from "@/lib/format";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { PhotoBadgeButton } from "@/components/media/photo-badge-button";
import { ChildPhotoButton } from "@/components/child/child-photo-button";

const profileSchema = userProfileSchema.extend({
  specialization: z.string().nullish(),
  education: z.string().nullish(),
});

/** Own profile, its compact edit dialog and password control. */
export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader title="Хувийн тохиргоо" lede="Хувийн мэдээлэл болон нэвтрэх эрхээ удирдана." />
      <ProfileCard />
      <ChildPhotosCard />
    </div>
  );
}

/** The password form, fed the account's own identifier. */
function PasswordFromProfile() {
  const { data } = useQuery({
    queryKey: qk.profile(),
    queryFn: () => get("/me/profile", profileSchema),
  });
  return <PasswordSection identifier={data?.email || data?.username || ""} email={data?.email} />;
}

/** Compact read view. Empty properties stay hidden instead of creating dashes. */
function ProfileCard() {
  const { session } = useSession();
  /*
   * ★ A teacher's own group only — 2026-09-29. `GET /groups` is staff-only,
   * so a guardian's call answered 404, and an administrator (who sees every
   * group) got the first one printed on their card as if it were theirs.
   */
  const isTeacher = Boolean(session?.memberships?.some((m) => m.role === "TEACHER"));
  const { group: myGroup } = useMyGroup({ enabled: isTeacher });
  const group = isTeacher ? myGroup : null;
  const [editing, setEditing] = useState(false);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: qk.profile(),
    queryFn: () => get("/me/profile", profileSchema),
  });

  if (isLoading) return <LoadingState rows={2} shape="text" />;
  if (isError) return <ErrorState description={errorMessage(error)} />;

  const role = session?.memberships?.[0]?.role;
  const roleLabel = role ? ROLE_LABEL[role] : "Эцэг эх";
  const facts = [
    { label: "Утас", value: data?.phone },
    { label: "И-мэйл", value: data?.email },
    ...(role === "TEACHER" || role === "ADMIN"
      ? [
          { label: "Мэргэжил", value: data?.specialization },
          { label: "Мэргэшлийн зэрэг", value: data?.qualification },
          { label: "Төгссөн сургууль", value: data?.education },
        ]
      : []),
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value?.trim()));

  return (
    <section aria-label="Хувийн мэдээлэл">
      <Card className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          {/*
            ★ The picture is the control — 2026-09-06, the client: "камерын
            зурагтай тэнд нь дардаг болгоё".
          */}
          <span className="relative shrink-0">
            <ChildAvatar child={data ?? {}} size={72} />
            <PhotoBadgeButton
              endpoint={`/users/${data?.id}/photo`}
              label="Профайл зураг солих"
              invalidateKeys={[qk.profile(), qk.session()]}
            />
          </span>

          <div className="flex min-w-[180px] flex-1 flex-col gap-1.5">
            <p className="truncate text-lead font-semibold text-ink">{fullName(data)}</p>
            <div className="flex flex-wrap gap-2">
              {group ? (
                <Badge tone="primary">
                  <UsersRound size={14} aria-hidden="true" /> {groupLabel(group.name)}
                </Badge>
              ) : null}
              <Badge tone="neutral">
                <IdCard size={14} aria-hidden="true" /> {roleLabel}
              </Badge>
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="text-caption font-normal text-muted hover:text-ink"
            onClick={() => setEditing(true)}
          >
            <Pencil size={14} aria-hidden="true" />
            Мэдээлэл засах
          </Button>
        </div>
        {facts.length > 0 ? (
          <dl className="grid gap-x-6 gap-y-2 border-t border-border-soft pt-3 sm:grid-cols-2">
            {facts.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="text-caption text-muted">{fact.label}</dt>
                <dd className="truncate text-body text-ink">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <PasswordFromProfile />
      </Card>

      {data ? <EditProfileDialog open={editing} onOpenChange={setEditing} profile={data} /> : null}
    </section>
  );
}

/**
 * «Мэдээлэл засах» — the fields `PATCH /me/profile` accepts that a person
 * owns: their name, phone and e-mail. Toast on save (§5); the server's field
 * errors land under the field they are about.
 */
function EditProfileDialog({
  open,
  onOpenChange,
  profile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: z.infer<typeof profileSchema>;
}) {
  const { hasRole, primaryKindergartenId } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");
  const [form, setForm] = useState({
    lastName: profile.lastName ?? "",
    firstName: profile.firstName ?? "",
    phone: profile.phone ?? "",
    email: profile.email ?? "",
    specialization: profile.specialization ?? "",
    qualification: profile.qualification ?? "",
    education: profile.education ?? "",
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      lastName: profile.lastName ?? "",
      firstName: profile.firstName ?? "",
      phone: profile.phone ?? "",
      email: profile.email ?? "",
      specialization: profile.specialization ?? "",
      qualification: profile.qualification ?? "",
      education: profile.education ?? "",
    });
  }, [
    open,
    profile.lastName,
    profile.firstName,
    profile.phone,
    profile.email,
    profile.specialization,
    profile.qualification,
    profile.education,
  ]);

  const esis = useQuery({
    queryKey: ["esis", "my-profile", primaryKindergartenId],
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/esis/my-profile`, esisMyProfileSchema),
    enabled: false,
    retry: false,
  });

  async function fillFromEsis() {
    const result = await esis.refetch();
    const row = result.data?.row;
    if (!row) {
      toast.error(result.error ? errorMessage(result.error) : "ЭСИС-ээс мэдээлэл ирсэнгүй.");
      return;
    }
    const pick = (...names: string[]) => {
      for (const name of names) {
        const value = row[name];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      return "";
    };
    const values = {
      lastName: pick("lastName", "familyName"),
      firstName: pick("firstName", "givenName"),
      phone: pick("phone", "phoneNumber", "mobilePhone"),
      email: pick("googleEmail", "officialEmail", "email"),
      specialization: pick("subjectDepartmentName", "positionName"),
      qualification: pick("instructorTypeName"),
      education: pick("education", "graduatedSchoolName"),
    };
    setForm((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(values) as [keyof typeof values, string][]) {
        if (value && !current[key].trim()) next[key] = value;
      }
      return next;
    });
    toast.success("ЭСИС-ийн мэдээллийг талбаруудад орууллаа. Шалгаад хадгална уу.");
  }

  const save = useMutation({
    mutationFn: () =>
      mutate("/me/profile", z.unknown(), {
        method: "PATCH",
        body: {
          lastName: form.lastName.trim(),
          firstName: form.firstName.trim(),
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          ...(isStaff
            ? {
                specialization: form.specialization.trim() || null,
                qualification: form.qualification.trim() || null,
                education: form.education.trim() || null,
              }
            : {}),
        },
      }),
    onSuccess: () => {
      toast.success("Мэдээлэл хадгалагдлаа.");
      void queryClient.invalidateQueries({ queryKey: qk.profile() });
      void queryClient.invalidateQueries({ queryKey: qk.session() });
      onOpenChange(false);
    },
  });
  const errors = save.isError ? fieldErrors(save.error) : {};
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Мэдээлэл засах"
      busy={save.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Болих
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </>
      }
    >
      {isStaff && primaryKindergartenId ? (
        <div className="flex items-center justify-between gap-3 rounded-control bg-sunken px-3 py-2">
          <p className="text-caption text-muted">ЭСИС-ээс нөхөөд, хадгалахаас өмнө шалгана.</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={esis.isFetching}
            onClick={() => void fillFromEsis()}
          >
            <Database size={16} aria-hidden="true" />
            {esis.isFetching ? "Татаж байна…" : "Esis татах"}
          </Button>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Овог" error={errors.lastName} required>
          {({ id }) => <Input id={id} value={form.lastName} onChange={set("lastName")} />}
        </Field>
        <Field label="Нэр" error={errors.firstName} required>
          {({ id }) => <Input id={id} value={form.firstName} onChange={set("firstName")} />}
        </Field>
        <Field label="Утас" error={errors.phone}>
          {({ id }) => (
            <Input id={id} inputMode="numeric" value={form.phone} onChange={set("phone")} />
          )}
        </Field>
        <Field label="И-мэйл" error={errors.email}>
          {({ id }) => <Input id={id} type="email" value={form.email} onChange={set("email")} />}
        </Field>
        {isStaff ? (
          <>
            <Field label="Мэргэжил" error={errors.specialization}>
              {({ id }) => (
                <Input id={id} value={form.specialization} onChange={set("specialization")} />
              )}
            </Field>
            <Field label="Мэргэшлийн зэрэг" error={errors.qualification}>
              {({ id }) => (
                <Input id={id} value={form.qualification} onChange={set("qualification")} />
              )}
            </Field>
            <Field label="Төгссөн сургууль" error={errors.education} className="sm:col-span-2">
              {({ id }) => <Input id={id} value={form.education} onChange={set("education")} />}
            </Field>
          </>
        ) : null}
      </div>
      <FormError
        message={save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null}
      />
    </FormDialog>
  );
}

/**
 * "Хүүхдийн зураг" — a guardian changes the face on their child's card.
 *
 * ★ Client, 2026-09-24: "цэс хэсэг дээр хувийн тохиргоо байгаа, энэ дээр
 * хүүхдийн зургийг нь сольдог байя". The badge on the child's own avatar does
 * the same thing and stays; this is the place people look when they cannot
 * find it, and the only place a family with two children sees both at once.
 *
 * ★★ The picture only. The name, the birth date and the group are the
 * kindergarten's record and stay staff-only — `canRecordForChild`, unchanged.
 *
 * Renders nothing for staff: `/dashboard/parent` is the guardian's own
 * endpoint, and a teacher opening this page has no children of their own to
 * list here.
 */
function ChildPhotosCard() {
  const { hasRole } = useSession();
  const isGuardian = hasRole("PARENT");

  const { data } = useQuery({
    queryKey: qk.dashboard.parent(),
    queryFn: () => get("/dashboard/parent", parentDashboardSchema),
    enabled: isGuardian,
  });

  if (!isGuardian || !data || data.children.length === 0) return null;

  return (
    <Card pad="roomy" className="flex flex-col gap-4">
      <SectionHeader
        title="Хүүхдийн зураг"
        lede="Зураг дээрх камер дээр дарж солино. Нэр, бүлгийг цэцэрлэг өөрчилнө."
      />
      <ul className="flex flex-col gap-3">
        {data.children.map((child) => (
          <li key={child.id} className="flex items-center gap-3">
            <div className="relative shrink-0">
              <ChildAvatar child={child} size={56} />
              <ChildPhotoButton childId={child.id} childName={fullName(child)} />
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink">{fullName(child)}</p>
              <p className="truncate text-caption text-muted">
                {child.group?.name ?? "Бүлэг тодорхойгүй"}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Changing the signed-in account's password. Fields mount only when opened. */
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

  if (!open) {
    return (
      <div className="flex justify-end border-t border-border-soft pt-2">
        <button
          type="button"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-control px-2 text-caption text-muted transition-colors hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          <KeyRound size={14} aria-hidden="true" />
          Нууц үг солих
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-border-soft pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-body font-medium text-ink">Нэвтрэх нууц үг</p>
          <p className="text-caption text-muted">
            Солисны дараа бусад төхөөрөмжөөс автоматаар гарна.
          </p>
        </div>

        <Button type="button" variant="ghost" size="sm" onClick={close}>
          Болих
        </Button>
      </div>

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
    </div>
  );
}

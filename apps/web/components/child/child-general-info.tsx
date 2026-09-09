"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  CalendarDays,
  ChevronDown,
  GraduationCap,
  IdCard,
  Mars,
  Pencil,
  Phone,
  School,
  User,
  UserPlus,
  Users,
  Venus,
  VenusAndMars,
} from "lucide-react";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { z } from "zod";
import {
  enrollmentArchiveSchema,
  GUARDIAN_RELATION_LABEL,
  SEX_LABEL,
  type ChildDetail,
  type EnrollmentArchive,
  ENROLLMENT_STATUS_LABEL,
  ENROLLMENT_STATUS_TONE,
} from "@kinder/contracts";
import { GuardianAccessButton } from "@/components/child/guardian-access-button";
import { InviteGuardianDialog } from "@/components/child/invite-guardian-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { EmptyState, FormError } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import {
  ChildEsisGuardians,
  ChildEsisHousehold,
  ChildEsisLiving,
  ChildEsisRegistration,
} from "@/components/child/child-esis";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { excerpt, formatAge, formatDate, fullName } from "@/lib/format";

const AGE_BAND_LABEL: Record<string, string> = {
  NURSERY: "Бага бүлэг",
  JUNIOR: "Дунд бүлэг",
  MIDDLE: "Ахлах бүлэг",
  SENIOR: "Бэлтгэл бүлэг",
};

type Enrollment = ChildDetail["enrollments"][number];

function enrollmentAgeBandLabel(group: Enrollment["group"]): string | null {
  if (!group?.ageBand) return null;

  const ageBand = AGE_BAND_LABEL[group.ageBand] ?? null;
  return ageBand === group.name ? null : ageBand;
}

function groupLabel(enrollment: Enrollment | null | undefined): string {
  if (!enrollment?.group) return "—";
  return [enrollment.group.name, enrollmentAgeBandLabel(enrollment.group)]
    .filter(Boolean)
    .join(" · ");
}

function schoolYearLabel(value: string | null | undefined): string {
  return value?.replace(/(\d{4})-(\d{4})/, "$1–$2") ?? "—";
}

function phoneLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const compact = value.replace(/\s/g, "");
  return /^\d{8}$/.test(compact) ? `${compact.slice(0, 4)} ${compact.slice(4)}` : value;
}

function teacherLabel(archive: EnrollmentArchive | undefined): string {
  const teacher =
    archive?.current?.teachers.find((person) => person.role === "LEAD") ??
    archive?.current?.teachers[0];
  if (!teacher) return "—";
  return `${teacher.lastName.slice(0, 1)}. ${teacher.firstName}`;
}

/**
 * The "Ерөнхий" tab: today's placement and contacts first, history second.
 *
 * The richer enrollment archive is already the product's canonical source for
 * the current teacher and each enrollment's kindergarten. React Query shares
 * this response with the "Шилжилт хөдөлгөөн" tab, so opening that tab later
 * does not repeat the request.
 */
export function ChildGeneralInfo({
  child,
  childId,
  isStaff,
}: {
  child: ChildDetail;
  childId: string;
  /** Health notes and guardian access controls are staff-only. */
  isStaff: boolean;
}) {
  const { session, hasRole } = useSession();
  const archive = useQuery({
    queryKey: qk.enrollmentArchive(childId),
    queryFn: () => get(`/children/${childId}/enrollment-archive`, enrollmentArchiveSchema),
  });

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="general-information-heading">
        <ProfileSectionHeader
          id="general-information-heading"
          title="Ерөнхий мэдээлэл"
          lede="Хүүхдийн одоогийн бүртгэл болон холбоо барих мэдээлэл."
        />
        <div className="flex flex-col gap-4">
          <ChildIdentityCard child={child} />
          <EnrollmentCard child={child} archive={archive.data} canEdit={hasRole("ADMIN")} />
        </div>
      </section>

      <Guardians
        child={child}
        childId={childId}
        canManage={isStaff}
        canEditAny={hasRole("ADMIN")}
        currentUserId={session?.user.id ?? null}
      />

      {/*
        ★ The ESIS half of this page — 2026-09-10, at the client's instruction.
        Contacts sit with the guardians they describe; өрхийн мэдээлэл and
        амьдрах орчин are two further sections of the same record.

        Staff only. The services are also absent from a parent's own ESIS list,
        so each panel would draw nothing anyway — see `child-esis.tsx`, which
        explains why both guards are wanted for this particular data.
      */}
      {isStaff ? (
        <>
          <ChildEsisRegistration childId={childId} />
          <ChildEsisHousehold />
          <ChildEsisLiving />
        </>
      ) : null}

      <Enrollments child={child} archive={archive.data} />

      {isStaff && child.healthNotes ? (
        <section aria-label="Эрүүл мэндийн тэмдэглэл">
          <SectionHeader title="Эрүүл мэндийн тэмдэглэл" />
          <Card pad="compact" className="border-l-4 border-l-peach">
            <p className="whitespace-pre-wrap text-body text-ink">
              {excerpt(child.healthNotes, 500)}
            </p>
          </Card>
        </section>
      ) : null}

      {/*
        ★ This child's record as ESIS holds it — 2026-09-09, at the client's
        request: from the roster, click a child and their general information is
        here, inside Ерөнхий.

        `student/info/:personRegNumber` is keyed by the register number, and the
        one passed is the child's own — already on their record because this
        product collects it (the roster has a Регистр column). So the number
        travels *to* ESIS and is never read back: `personRegNumber` is a refused
        output on this service as on every roster service, and `read` keeps the
        value out of the audit row.

        ★★ It never asks for the number, and never explains its absence
        either — `askForParams={false}`. Searching by register is how you find
        a child *among many*, which is the roster's own panel; a box here would
        be a second search on a screen about one person, and a sentence in its
        place is a screen explaining itself instead of showing the record. A
        child with no регистр on file simply cannot be pulled live yet.

        ★★★ It renders nothing for a guardian: `studentInfo` is on the teacher's
        and the administrator's service lists and on nobody else's, so the
        scoped catalog simply omits it.
      */}
      <EsisDataPanel
        resource="studentInfo"
        title="Сурагчийн ерөнхий мэдээлэл"
        description="ESIS дэх энэ хүүхдийн бүртгэл"
        params={{ personRegNumber: child.nationalId ?? undefined }}
        askForParams={false}
      />
    </div>
  );
}

function ProfileSectionHeader({ id, title, lede }: { id: string; title: string; lede: string }) {
  return (
    <div className="mb-4">
      <h2 id={id} className="text-heading font-semibold text-ink md:text-display">
        {title}
      </h2>
      <p className="mt-1 text-body text-muted md:text-lead">{lede}</p>
    </div>
  );
}

function CardHeading({
  icon,
  children,
  action,
}: {
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border pb-4">
      <div className="flex min-w-0 items-center gap-3 text-lead font-semibold text-ink md:text-heading">
        <span aria-hidden="true" className="shrink-0 text-sky-ink">
          {icon}
        </span>
        <h3 className="truncate">{children}</h3>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function ChildIdentityCard({ child }: { child: ChildDetail }) {
  const SexIcon = child.sex === "FEMALE" ? Venus : child.sex === "MALE" ? Mars : VenusAndMars;

  return (
    <Card pad="roomy">
      <CardHeading icon={<User size={26} strokeWidth={1.9} />}>
        Хүүхдийн үндсэн мэдээлэл
      </CardHeading>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <IdentityFact icon={<User size={18} aria-hidden="true" />} label="Овог, нэр">
          {fullName(child)}
        </IdentityFact>
        <IdentityFact
          icon={<CalendarDays size={18} aria-hidden="true" />}
          label="Нас, төрсөн он сар өдөр"
        >
          {formatAge(child.dateOfBirth)} · {formatDate(child.dateOfBirth)}
        </IdentityFact>
        <IdentityFact icon={<IdCard size={18} aria-hidden="true" />} label="Регистрийн дугаар">
          {child.nationalId || "—"}
        </IdentityFact>
        <IdentityFact icon={<SexIcon size={18} aria-hidden="true" />} label="Хүйс">
          {(child.sex && SEX_LABEL[child.sex]) || "—"}
        </IdentityFact>
      </dl>
    </Card>
  );
}

function IdentityFact({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[76px] items-center gap-3 rounded-row border border-border bg-canvas px-4 py-3">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-caption text-muted">{label}</dt>
        <dd className="mt-0.5 break-words font-semibold text-ink">{children}</dd>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  children,
  last = false,
}: {
  label: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-1 py-4 sm:grid-cols-2 sm:items-center sm:gap-6 ${
        last ? "" : "border-b border-border"
      }`}
    >
      <dt className="text-body text-muted">{label}</dt>
      <dd className="min-w-0 text-lead font-medium text-ink">{children}</dd>
    </div>
  );
}

function EnrollmentCard({
  child,
  archive,
  canEdit,
}: {
  child: ChildDetail;
  archive: EnrollmentArchive | undefined;
  canEdit: boolean;
}) {
  const active = child.enrollments.find((enrollment) => enrollment.status === "ACTIVE") ?? null;
  const kindergarten = archive?.current?.kindergarten.name ?? child.kindergarten?.name ?? "—";

  return (
    <Card pad="roomy">
      <CardHeading
        icon={<School size={26} strokeWidth={1.9} />}
        action={
          canEdit ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={`/children/${child.id}/edit`}>
                <Pencil size={16} aria-hidden="true" />
                Засах
              </Link>
            </Button>
          ) : undefined
        }
      >
        Цэцэрлэгийн бүртгэл
      </CardHeading>
      <dl>
        <InfoRow label="Одоогийн цэцэрлэг">{active ? kindergarten : "—"}</InfoRow>
        <InfoRow label="Бүлэг">{groupLabel(active)}</InfoRow>
        <InfoRow label="Ангийн багш">{active ? teacherLabel(archive) : "—"}</InfoRow>
        <InfoRow label="Элссэн огноо">{formatDate(active?.startedOn)}</InfoRow>
        <InfoRow label="Хичээлийн жил">{schoolYearLabel(active?.schoolYear?.name)}</InfoRow>
        <InfoRow label="Төлөв" last>
          {active ? <Badge tone="mint">Суралцаж байгаа</Badge> : <Badge>Бүртгэлгүй</Badge>}
        </InfoRow>
      </dl>
    </Card>
  );
}

function Guardians({
  child,
  childId,
  canManage,
  canEditAny,
  currentUserId,
}: {
  child: ChildDetail;
  childId: string;
  canManage: boolean;
  canEditAny: boolean;
  currentUserId: string | null;
}) {
  const invite = (
    <InviteGuardianDialog
      childId={childId}
      childName={fullName(child)}
      trigger={
        <Button variant="secondary" size="sm">
          <UserPlus size={18} />
          Урих
        </Button>
      }
    />
  );

  if (child.guardianships.length === 0) {
    return (
      <section aria-label="Асран хамгаалагч">
        <EmptyState
          icon={<Users size={28} aria-hidden="true" />}
          title="Асран хамгаалагч холбогдоогүй байна"
          description={
            canManage
              ? "Эцэг эх урьсны дараа тэд хүүхдийнхээ хавтсыг гар утаснаасаа харах боломжтой болно."
              : "Асран хамгаалагчийн мэдээлэл одоогоор бүртгэгдээгүй байна."
          }
          action={canManage ? invite : undefined}
        />
        {canManage ? <ChildEsisGuardians child={child} /> : null}
      </section>
    );
  }

  return (
    <section aria-label="Асран хамгаалагч">
      <div className="flex flex-col gap-3">
        {child.guardianships.map((guardianship, index) => {
          const revoked = guardianship.canView === false;
          const guardian = guardianship.guardian;
          const canEdit = Boolean(guardian && (canEditAny || guardian.id === currentUserId));
          const href = guardian?.phone
            ? `tel:${guardian.phone}`
            : guardian?.email
              ? `mailto:${guardian.email}`
              : null;

          return (
            <Card key={guardianship.id} pad="roomy">
              <CardHeading
                icon={<Users size={26} strokeWidth={1.9} />}
                action={
                  canEdit || (canManage && index === 0) ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {canEdit && guardian ? (
                        <EditGuardianDialog
                          childId={childId}
                          guardianship={guardianship}
                          currentUserId={currentUserId}
                        />
                      ) : null}
                      {canManage && index === 0 ? invite : null}
                    </div>
                  ) : undefined
                }
              >
                Асран хамгаалагч
              </CardHeading>
              <dl>
                <InfoRow label="Асран хамгаалагч">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={revoked ? "truncate text-muted line-through" : "truncate"}>
                      {fullName(guardian)}
                    </span>
                    {revoked ? <Badge>Хураасан</Badge> : null}
                    {canManage ? (
                      <GuardianAccessButton
                        guardianshipId={guardianship.id}
                        childId={childId}
                        guardianName={fullName(guardian)}
                        canView={!revoked}
                      />
                    ) : null}
                  </span>
                </InfoRow>
                <InfoRow label="Хүүхэдтэй холбоо">
                  {GUARDIAN_RELATION_LABEL[guardianship.relation] ?? guardianship.relation}
                </InfoRow>
                <InfoRow label="Холбоо барих утас" last>
                  {phoneLabel(guardian?.phone)}
                </InfoRow>
              </dl>

              {href ? (
                <a
                  href={href}
                  className="mt-4 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-control bg-primary-soft px-4 text-lead font-medium text-primary transition-colors hover:bg-sky"
                >
                  <Phone size={20} aria-hidden="true" />
                  Холбоо барих
                </a>
              ) : (
                <div className="mt-4 flex min-h-[44px] w-full items-center justify-center rounded-control bg-sunken px-4 text-body text-muted">
                  Холбоо барих мэдээлэл алга
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/*
        ★ ESIS's own guardian record, **inside** the Guardian section —
        2026-09-10, at the client's instruction that it live in
        "Ерөнхий мэдээлэл → Асран хамгаалагч". It was briefly a sibling section
        of its own, which put two headings reading "Асран хамгаалагч" one after
        the other on the same page.

        Staff only: a guardian sees their own record here, not the ministry's
        copy of the whole institution's contact list.
      */}
      {canManage ? <ChildEsisGuardians child={child} /> : null}
    </section>
  );
}

type Guardianship = ChildDetail["guardianships"][number];

function localPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("976") ? digits.slice(3) : digits;
}

/**
 * Turns the single display-name field back into the API's two name fields.
 * Mongolian names are commonly written both as "Батжаргал Энхцэцэг" and with
 * an initial directly before the given name: "Б.Энхцэцэг".
 */
function parseGuardianName(value: string): { lastName: string; firstName: string } | null {
  const normalized = value.trim().replace(/\s+/g, " ");
  const abbreviated = normalized.match(/^(\p{L}\.)\s*(.+)$/u);
  if (abbreviated) return { lastName: abbreviated[1]!, firstName: abbreviated[2]! };

  const spaced = normalized.match(/^(\S+)\s+(.+)$/u);
  if (spaced) return { lastName: spaced[1]!, firstName: spaced[2]! };

  return null;
}

function EditGuardianDialog({
  childId,
  guardianship,
  currentUserId,
}: {
  childId: string;
  guardianship: Guardianship;
  currentUserId: string | null;
}) {
  const guardian = guardianship.guardian!;
  const formId = useId();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(fullName(guardian));
  const [relation, setRelation] = useState(guardianship.relation);
  const [phone, setPhone] = useState(localPhone(guardian.phone ?? ""));
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: async (values: { lastName: string; firstName: string; phone: string }) => {
      const ownProfile = guardian.id === currentUserId;
      await mutate(ownProfile ? "/me/profile" : `/users/${guardian.id}`, z.unknown(), {
        method: "PATCH",
        body: {
          lastName: values.lastName,
          firstName: values.firstName,
          phone: values.phone,
        },
      });
      await mutate(`/guardianships/${guardianship.id}`, z.unknown(), {
        method: "PATCH",
        body: { relation },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.child(childId) });
      void queryClient.invalidateQueries({ queryKey: qk.profile() });
      void queryClient.invalidateQueries({ queryKey: qk.session() });
      toast.success("Асран хамгаалагчийн мэдээлэл хадгалагдлаа.");
      setOpen(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const serverErrors = fieldErrors(save.error);

  function beginEdit() {
    setName(fullName(guardian));
    setRelation(guardianship.relation);
    setPhone(localPhone(guardian.phone ?? ""));
    setLocalErrors({});
    save.reset();
    setOpen(true);
  }

  function submit() {
    const parsedName = parseGuardianName(name);
    const normalizedPhone = localPhone(phone);
    const nextErrors: Record<string, string> = {};

    if (!parsedName) {
      nextErrors.name = "Овог, нэр эсвэл Б.Энхцэцэг хэлбэрээр оруулна уу";
    }
    if (!/^[5-9]\d{7}$/.test(normalizedPhone)) {
      nextErrors.phone = "Утасны дугаар 8 оронтой байх ёстой";
    }
    setLocalErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    save.mutate({
      lastName: parsedName!.lastName,
      firstName: parsedName!.firstName,
      phone: normalizedPhone,
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={beginEdit}>
        <Pencil size={16} aria-hidden="true" />
        Засах
      </Button>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Асран хамгаалагчийн мэдээлэл засах"
        description="Нэр, хүүхэдтэй холбоо болон утасны дугаарыг шинэчилнэ."
        busy={save.isPending}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={save.isPending}>
              Цуцлах
            </Button>
            <Button type="submit" form={formId} disabled={save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!save.isPending) submit();
          }}
          noValidate
        >
          <FormError
            message={
              save.isError && Object.keys(serverErrors).length === 0
                ? errorMessage(save.error)
                : null
            }
          />

          <Field
            label="Асран хамгаалагчийн нэр"
            error={localErrors.name ?? serverErrors.lastName ?? serverErrors.firstName}
            required
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
              />
            )}
          </Field>

          <Field label="Хүүхэдтэй холбоо" error={serverErrors.relation} required>
            {({ id, describedBy, invalid }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={relation}
                onChange={(event) => setRelation(event.target.value)}
              >
                <option value="FATHER">Аав</option>
                <option value="MOTHER">Ээж</option>
                <option value="OTHER">Асран хамгаалагч</option>
              </Select>
            )}
          </Field>

          <Field label="Холбоо барих утас" error={localErrors.phone ?? serverErrors.phone} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="9912 3456"
                autoComplete="tel"
              />
            )}
          </Field>
        </form>
      </FormDialog>
    </>
  );
}

function Enrollments({
  child,
  archive,
}: {
  child: ChildDetail;
  archive: EnrollmentArchive | undefined;
}) {
  const enrollments = child.enrollments ?? [];
  const kindergartenByEnrollment = new Map<string, string>();
  if (archive?.current) {
    kindergartenByEnrollment.set(archive.current.id, archive.current.kindergarten.name);
  }
  for (const entry of archive?.history ?? []) {
    kindergartenByEnrollment.set(entry.id, entry.kindergarten.name);
  }

  return (
    <section aria-labelledby="enrollment-history-heading">
      <ProfileSectionHeader
        id="enrollment-history-heading"
        title="Бүртгэлийн түүх"
        lede="Хамрагдсан бүлэг болон хичээлийн жилүүд."
      />

      {enrollments.length === 0 ? (
        <EmptyState
          icon={<GraduationCap size={28} aria-hidden="true" />}
          title="Бүлэгт бүртгэгдээгүй байна"
          description="Хүүхдийг бүлэгт бүртгэсний дараа ажиглалт, үнэлгээ хийх боломжтой болно."
        />
      ) : (
        <Card className="divide-y divide-border">
          {enrollments.map((enrollment, index) => {
            const active = enrollment.status === "ACTIVE";
            const kindergarten =
              (enrollment.id ? kindergartenByEnrollment.get(enrollment.id) : null) ??
              child.kindergarten?.name ??
              "Цэцэрлэг тодорхойгүй";
            const endedOn = enrollment.endedOn ? formatDate(enrollment.endedOn) : null;

            return (
              <details
                key={enrollment.id ?? `${enrollment.schoolYear?.id}-${index}`}
                className="group"
              >
                <summary className="flex min-h-[88px] cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-4 marker:content-none md:px-6 [&::-webkit-details-marker]:hidden">
                  <GraduationCap
                    size={24}
                    strokeWidth={1.9}
                    aria-hidden="true"
                    className="shrink-0 text-sky-ink"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-center gap-2 text-lead font-medium text-ink">
                      <span className="truncate">
                        {enrollment.group?.name ?? "Бүлэг тодорхойгүй"}
                      </span>
                      {enrollmentAgeBandLabel(enrollment.group) ? (
                        <>
                          <span aria-hidden="true" className="text-border">
                            ·
                          </span>
                          <span className="shrink-0">
                            {enrollmentAgeBandLabel(enrollment.group)}
                          </span>
                        </>
                      ) : null}
                    </p>
                    <p className="truncate text-body text-muted">{kindergarten}</p>
                    <p className="mt-0.5 truncate text-body text-faint">
                      {schoolYearLabel(enrollment.schoolYear?.name)} · Элссэн:{" "}
                      {formatDate(enrollment.startedOn)}
                    </p>
                  </div>

                  <span className="grid size-11 shrink-0 place-items-center rounded-pill border border-border bg-surface text-ink shadow-sm">
                    <ChevronDown
                      size={22}
                      aria-hidden="true"
                      className="transition-transform group-open:rotate-180"
                    />
                  </span>
                  <Badge
                    tone={
                      active
                        ? "mint"
                        : (ENROLLMENT_STATUS_TONE[enrollment.status ?? "ENDED"] ?? "neutral")
                    }
                    className="ml-auto sm:ml-0"
                  >
                    {active
                      ? "Одоогийн"
                      : (ENROLLMENT_STATUS_LABEL[enrollment.status ?? "ENDED"] ??
                        ENROLLMENT_STATUS_LABEL.ENDED)}
                  </Badge>
                </summary>
                <div className="border-t border-border-soft px-4 py-3 text-body text-muted md:px-6">
                  {endedOn ? `Дууссан: ${endedOn}` : "Одоогоор суралцаж байна."}
                </div>
              </details>
            );
          })}
        </Card>
      )}
    </section>
  );
}

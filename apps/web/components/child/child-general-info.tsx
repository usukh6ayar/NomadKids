"use client";

import { useIsFetching, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Query } from "@tanstack/react-query";
import Link from "next/link";
import { House, Pencil, Phone, School, TriangleAlert, User, UserPlus, Users } from "lucide-react";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { z } from "zod";
import {
  enrollmentArchiveSchema,
  GUARDIAN_RELATION_LABEL,
  SEX_LABEL,
  type ChildDetail,
  type EnrollmentArchive,
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
import { ChildEsisContactsSend, ChildEsisHousehold } from "@/components/child/child-esis";
import { EsisFactsWriteButton } from "@/components/esis/esis-write";
import { useEsisRows } from "@/components/esis/use-esis-rows";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { excerpt, formatAge, formatDate, fullName, capitalize } from "@/lib/format";
import { EsisButton } from "@/components/esis/esis-button";

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
  const name = capitalize(enrollment.group.name);
  const band = enrollmentAgeBandLabel(enrollment.group);
  // "ахлах бүлэг · Ахлах бүлэг" said one thing twice (2026-09-29).
  const same = band && band.toLocaleLowerCase("mn-MN") === name.toLocaleLowerCase("mn-MN");
  return [name, same ? null : band].filter(Boolean).join(" · ");
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
  return `${teacher.lastName.slice(0, 1)}. ${capitalize(teacher.firstName)}`;
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

  /*
    ★ ESIS's copy of this child, folded into the two cards — 2026-10-01, at
    the client's request (phase 2 of tidying this tab). "ЭСИС дэх бүртгэл" and
    "Сурагчийн ерөнхий мэдээлэл" were two more full sections repeating the
    name, the birth date and the group; their facts now sit on the rows they
    describe, marked ESIS, and every field ESIS returned is still one press
    away under "ЭСИС-ийн бүх мэдээлэл".

    The same query keys `EsisDataPanel` uses, so the folded panels below and
    these rows are one request each, not two. `studentInfo` is keyed by the
    регистр and simply does not run without one.
  */
  const esisInfo = useEsisRows("studentInfo", {
    enabled: isStaff,
    params: { personRegNumber: child.nationalId },
  }).rows[0];
  const esisCheck = useEsisRows("studentCheck", { enabled: isStaff, params: { childId } }).rows[0];

  /*
    ★ Compacted 2026-10-01, at the client's request — the tab repeated itself
    and spent most of a phone screen on padding. The identity and placement
    cards sit side by side from `lg`, the rows are body-sized, and the
    placement history that also lives on "Суралцсан түүх" is no longer drawn
    here a second time. Nothing was removed from the data: every ESIS panel
    below is a live read, and every action (send to ESIS, invite, edit,
    revoke) is still on the page.
  */
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="general-information-heading" className="flex flex-col gap-3">
        <ProfileSectionHeader
          id="general-information-heading"
          title="Ерөнхий мэдээлэл"
          action={
            isStaff ? <EsisPullAll childId={childId} nationalId={child.nationalId} /> : undefined
          }
        />
        <div className="grid items-start gap-3 lg:grid-cols-2">
          <ChildIdentityCard child={child} esis={isStaff ? (esisInfo ?? null) : undefined} />
          <EnrollmentCard
            child={child}
            archive={archive.data}
            canEdit={hasRole("ADMIN")}
            esisInfo={isStaff ? (esisInfo ?? null) : undefined}
            esisCheck={isStaff ? (esisCheck ?? null) : undefined}
          />
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
      {isStaff ? <LivingCard childId={childId} /> : null}
      {isStaff ? <ChildEsisHousehold childId={childId} /> : null}

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
        ★ Every field ESIS returned for this child — a link at the foot of the
        tab that opens a dialog, 2026-10-01, at the client's request. It was a
        fold in the page's flow; the rows the cards above use are only a few of
        the fields, and the rest (programme, plan, stage, ESIS's teacher, the
        Mongolian-script names, the child's own contact points, the ids) stay
        readable here rather than being dropped. Staff only.
      */}
      {isStaff ? <EsisAllFieldsLink child={child} childId={childId} /> : null}
    </div>
  );
}

/**
 * "ЭСИС-ийн бүх талбарыг харах" and the dialog it opens.
 *
 * The panels inside read with the same query keys the cards above already
 * used, so opening the dialog asks ESIS nothing new — it shows what the page
 * has. `studentInfo` is keyed by the регистр, which travels *to* ESIS only:
 * `personRegNumber` is a refused output (ESIS_REQUEST.md §1.1 (b)).
 */
function EsisAllFieldsLink({ child, childId }: { child: ChildDetail; childId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex justify-end">
      <Button type="button" variant="link" size="sm" onClick={() => setOpen(true)}>
        ЭСИС-ийн бүх талбарыг харах →
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="ЭСИС-ийн бүх мэдээлэл"
        description="ЭСИС-ээс энэ хүүхдийн талаар ирсэн бүх талбар."
        size="wide"
        footer={
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Хаах
          </Button>
        }
      >
        {open ? (
          <div className="flex flex-col gap-5">
            {child.nationalId ? (
              <EsisDataPanel
                resource="studentInfo"
                params={{ personRegNumber: child.nationalId }}
                askForParams={false}
                compact
                title="Сурагчийн ерөнхий мэдээлэл"
              />
            ) : (
              <p className="text-body text-muted">
                Регистрийн дугаар бүртгэгдээгүй тул ЭСИС-ийн ерөнхий мэдээллийг татах боломжгүй.
              </p>
            )}
            <EsisDataPanel
              resource="studentCheck"
              params={{ childId }}
              askForParams={false}
              compact
              title="ЭСИС дэх бүртгэл"
            />
            <EsisDataPanel
              resource="studentContacts"
              params={{ childId }}
              askForParams={false}
              compact
              title="Асран хамгаалагч ба холбоо барих"
            />
            <EsisDataPanel
              resource="studentCondition"
              params={{ childId }}
              askForParams={false}
              compact
              title="Амьдрах орчин"
            />
          </div>
        ) : null}
      </FormDialog>
    </div>
  );
}

function ProfileSectionHeader({
  id,
  title,
  action,
}: {
  id: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id={id} className="text-title font-semibold text-ink">
        {title}
      </h2>
      {action ? <div className="shrink-0">{action}</div> : null}
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
    <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border pb-2">
      <div className="flex min-w-0 items-center gap-2 text-body font-semibold text-ink">
        <span aria-hidden="true" className="shrink-0 text-sky-ink">
          {icon}
        </span>
        <h3 className="truncate">{children}</h3>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

type EsisRow = Record<string, string | null>;

/** "ЭСИС" beside a value that came from the ministry rather than this product. */
function EsisTag() {
  return (
    <span className="ml-1.5 inline-flex rounded-pill bg-sky px-1.5 py-px align-middle text-caption font-semibold text-sky-ink">
      ЭСИС
    </span>
  );
}

/** Lower-cased and trimmed, so "Ахлах А бүлэг" and "ахлах а бүлэг " agree. */
function same(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (value: string) => value.trim().toLocaleLowerCase("mn-MN").replace(/\s+/g, " ");
  return Boolean(a && b) && norm(a!) === norm(b!);
}

/**
 * ESIS-ээс татах — every ESIS read on this tab again, at once.
 *
 * ★ One button for the tab — 2026-10-01, at the client's request. The panels
 * each had their own "Шинэчлэх"; this refetches the ones already on the page
 * for this child (by its id, or by its регистр for `studentInfo`), so there is
 * one press and one place to look for the answer.
 */
function EsisPullAll({ childId, nationalId }: { childId: string; nationalId?: string | null }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { primaryKindergartenId } = useSession();
  const byRegister = nationalId
    ? new URLSearchParams({ personRegNumber: nationalId }).toString()
    : null;

  const predicate = (query: Query) => {
    const key = query.queryKey;
    if (key[0] !== "admin" || key[1] !== "esis" || key[2] !== primaryKindergartenId) return false;
    if (key[3] !== "resource" || typeof key[5] !== "string") return false;
    return (
      key[5].includes(`childId=${childId}`) || Boolean(byRegister && key[5].includes(byRegister))
    );
  };
  const fetching = useIsFetching({ predicate }) > 0;

  return (
    <EsisButton
      pending={fetching}
      onClick={async () => {
        await queryClient.refetchQueries({ predicate });
        toast.success("ЭСИС-ийн мэдээлэл шинэчлэгдлээ.");
      }}
    />
  );
}

function ChildIdentityCard({
  child,
  esis,
}: {
  child: ChildDetail;
  /** ESIS's general record — `undefined` for a guardian, who has no ESIS rows. */
  esis?: EsisRow | null;
}) {
  // A foreign child's identifier stands in for the регистр, labelled apart.
  const register = child.isForeign
    ? child.foreignId
      ? `${child.foreignId} (гадаад)`
      : "Гадаад иргэн"
    : child.nationalId || "—";

  return (
    <Card pad="compact">
      <CardHeading icon={<User size={18} strokeWidth={2} />}>Хүүхдийн үндсэн мэдээлэл</CardHeading>
      <dl>
        {esis !== undefined ? (
          <InfoRow label="Ургийн овог">
            {esis?.familyName ? (
              <>
                {esis.familyName}
                <EsisTag />
              </>
            ) : (
              "—"
            )}
          </InfoRow>
        ) : null}
        <InfoRow label="Овог">{child.lastName}</InfoRow>
        <InfoRow label="Нэр">{child.firstName}</InfoRow>
        <InfoRow label="Регистрийн дугаар">{register}</InfoRow>
        <InfoRow label="Төрсөн огноо">
          {formatAge(child.dateOfBirth)} · {formatDate(child.dateOfBirth)}
        </InfoRow>
        <InfoRow label="Хүйс" last>
          {(child.sex && SEX_LABEL[child.sex]) || "—"}
        </InfoRow>
      </dl>
    </Card>
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
      className={`grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-3 py-2 ${
        last ? "" : "border-b border-border-soft"
      }`}
    >
      <dt className="text-body text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-body font-medium text-ink">{children}</dd>
    </div>
  );
}

function EnrollmentCard({
  child,
  archive,
  canEdit,
  esisInfo,
  esisCheck,
}: {
  child: ChildDetail;
  archive: EnrollmentArchive | undefined;
  canEdit: boolean;
  /** `undefined` for a guardian; `null` while ESIS has not answered. */
  esisInfo?: EsisRow | null;
  esisCheck?: EsisRow | null;
}) {
  const active = child.enrollments.find((enrollment) => enrollment.status === "ACTIVE") ?? null;
  const kindergarten = archive?.current?.kindergarten.name ?? child.kindergarten?.name ?? "—";

  return (
    <Card pad="compact">
      <CardHeading
        icon={<School size={18} strokeWidth={2} />}
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
      {/*
        The child's own status is the badge in the hero above; this card says
        only whether there is a current placement at all, and only when there
        is not.
      */}
      <dl>
        <InfoRow label="Одоогийн цэцэрлэг">
          {active ? kindergarten : <Badge>Бүртгэлгүй</Badge>}
        </InfoRow>
        <InfoRow label="Хичээлийн жил">{schoolYearLabel(active?.schoolYear?.name)}</InfoRow>
        <InfoRow label="Бүлэг">
          {groupLabel(active)}
          {/*
            The group ESIS has, only when it is not this one — attendance sent
            to ESIS fails for a child it files under another group.
          */}
          {esisInfo?.studentGroupName && !same(esisInfo.studentGroupName, active?.group?.name) ? (
            <span className="mt-0.5 flex items-center gap-1 text-caption font-medium text-peach-ink">
              <TriangleAlert size={13} aria-hidden="true" />
              ЭСИС-д: {esisInfo.studentGroupName}
            </span>
          ) : null}
        </InfoRow>
        <InfoRow label="Ангийн багш">{active ? teacherLabel(archive) : "—"}</InfoRow>
        <InfoRow label="Бүлэгт орсон огноо" last={esisInfo === undefined}>
          {formatDate(active?.startedOn)}
        </InfoRow>
        {esisInfo !== undefined ? (
          <>
            <InfoRow label="Суралцах төлөв">
              {esisInfo?.programStatusName ? (
                <>
                  {esisInfo.programStatusName}
                  {esisInfo.actionDate ? (
                    <span className="text-muted"> · {esisInfo.actionDate.slice(0, 10)}</span>
                  ) : null}
                  <EsisTag />
                </>
              ) : (
                "—"
              )}
            </InfoRow>
            <InfoRow label="ЭСИС-д бүртгэл" last>
              {esisCheck?.isRegistered === "true" ? (
                <Badge tone="mint">Бүртгэлтэй</Badge>
              ) : esisCheck?.isRegistered === "false" ? (
                <Badge tone="peach">Бүртгэлгүй</Badge>
              ) : (
                "—"
              )}
            </InfoRow>
          </>
        ) : null}
      </dl>
    </Card>
  );
}

/**
 * Амьдрах орчин — a card like the ones above it, 2026-10-01.
 *
 * ★ At the client's request: it was a fold of raw ESIS rows. Its fields do
 * have names, so it reads like the rest of the tab — only the ones ESIS
 * filled, under their Mongolian labels, with the "send to ESIS" action in the
 * heading. The dormitory fields are a school's and are usually empty for a
 * kindergarten, so an empty one is simply not drawn. The ids ESIS returns
 * (`studentStatisticId`, `institutionId`, `personId`) are not a reader's
 * concern and are left out.
 *
 * `studentLivingPalace` arrives as a code with no published meaning, so it is
 * shown as the code rather than guessed at.
 */
const LIVING_FIELDS: { key: string; label: string; format?: (value: string) => string }[] = [
  { key: "academicYear", label: "Мэдээллийн хичээлийн жил" },
  { key: "studentLivingPalace", label: "Амьдарч буй байр (код)" },
  { key: "livingPlaceDistance", label: "Цэцэрлэг хүртэлх зай" },
  { key: "enrollYear", label: "Цэцэрлэгт элссэн огноо", format: (value) => value.slice(0, 10) },
  {
    key: "annualTuitionFee",
    label: "Жилийн сургалтын төлбөр",
    format: (value) =>
      Number.isFinite(Number(value))
        ? `${new Intl.NumberFormat("mn-MN", { maximumFractionDigits: 0 }).format(Number(value))} ₮`
        : value,
  },
  { key: "dormitoryPropertyType", label: "Дотуур байрны өмчийн хэлбэр" },
  { key: "dormitoryOwner", label: "Дотуур байрны эзэмшигч" },
  { key: "dormitorySchoolId", label: "Дотуур байртай сургуулийн код" },
  { key: "dormitoryId", label: "Дотуур байрны код" },
];

function LivingCard({ childId }: { childId: string }) {
  const living = useEsisRows("studentCondition", { params: { childId } });
  // Unavailable: this role's ESIS list has no such service — draw nothing.
  if (living.isUnavailable) return null;

  const row = living.rows[0];
  const filled = row ? LIVING_FIELDS.filter((field) => row[field.key]) : [];

  return (
    <section aria-labelledby="living-heading">
      <Card pad="compact">
        <CardHeading
          icon={<House size={18} strokeWidth={2} />}
          action={
            <EsisFactsWriteButton
              resource="studentConditionSave"
              childId={childId}
              title="Амьдрах орчин илгээх"
              description="Хүүхдийн амьдрах орчны мэдээллийг ЭСИС рүү илгээнэ."
            />
          }
        >
          <span id="living-heading">Амьдрах орчин</span>
          <EsisTag />
        </CardHeading>
        {living.isPending ? (
          <p className="py-2 text-body text-muted">ЭСИС-ээс уншиж байна…</p>
        ) : living.isError ? (
          <p className="py-2 text-body text-muted">ЭСИС-ээс хариу ирсэнгүй.</p>
        ) : filled.length === 0 ? (
          <p className="py-2 text-body text-muted">ЭСИС-д амьдрах орчны мэдээлэл бүртгэгдээгүй.</p>
        ) : (
          <dl>
            {filled.map((field, index) => (
              <InfoRow key={field.key} label={field.label} last={index === filled.length - 1}>
                {field.format ? field.format(row![field.key]!) : row![field.key]}
              </InfoRow>
            ))}
          </dl>
        )}
      </Card>
    </section>
  );
}

/** One guardian as ESIS holds them: `relInfo`, with their `relPhone`/`relEmail`. */
interface EsisGuardian {
  id: string;
  familyName: string | null;
  lastName: string;
  firstName: string;
  job: string | null;
  phones: string[];
  emails: string[];
}

/**
 * ESIS's contact rows, regrouped by guardian.
 *
 * ★ ESIS sends one row per entry, tagged by `section` (see
 * `esisContactsParser`): the person in `relInfo`, each of their numbers in
 * `relPhone`, each address in `relEmail`, joined by `studentContactId`. A
 * guardian may have several numbers, so phones and emails stay lists. The
 * child's own `contact*` rows are not a guardian and are left out here.
 */
function esisGuardians(rows: EsisRow[]): EsisGuardian[] {
  return rows
    .filter((row) => row.section === "relInfo")
    .map((person) => {
      const id = person.studentContactId ?? "";
      const of = (section: string, field: string) =>
        rows
          .filter((row) => row.section === section && row.studentContactId === id)
          .map((row) => row[field])
          .filter((value): value is string => Boolean(value));
      return {
        id,
        familyName: person.familyName?.trim() || null,
        lastName: person.lastName?.trim() ?? "",
        firstName: person.firstName?.trim() ?? "",
        job: [person.legalEmployerName, person.jobTitle].filter(Boolean).join(" · ") || null,
        phones: of("relPhone", "phoneNumber"),
        emails: of("relEmail", "emailAddress"),
      };
    });
}

/** The last eight digits — how a Mongolian mobile number is compared. */
function phoneKey(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "").slice(-8);
}

/**
 * Which ESIS guardian is this one: the same number first, then the same
 * овог and нэр. Each ESIS record is matched once, so two parents never claim
 * the same ministry row.
 */
function matchGuardians(
  guardianships: ChildDetail["guardianships"],
  esis: EsisGuardian[],
): { byGuardianship: Map<string, EsisGuardian>; unmatched: EsisGuardian[] } {
  const byGuardianship = new Map<string, EsisGuardian>();
  const taken = new Set<string>();
  const claim = (
    test: (
      guardian: NonNullable<ChildDetail["guardianships"][number]["guardian"]>,
      e: EsisGuardian,
    ) => boolean,
  ) => {
    for (const guardianship of guardianships) {
      const guardian = guardianship.guardian;
      if (!guardian || byGuardianship.has(guardianship.id)) continue;
      const found = esis.find((e) => !taken.has(e.id) && test(guardian, e));
      if (found) {
        byGuardianship.set(guardianship.id, found);
        taken.add(found.id);
      }
    }
  };
  claim((guardian, e) => {
    const key = phoneKey(guardian.phone);
    return key.length === 8 && e.phones.some((phone) => phoneKey(phone) === key);
  });
  claim(
    (guardian, e) => same(guardian.firstName, e.firstName) && same(guardian.lastName, e.lastName),
  );
  return { byGuardianship, unmatched: esis.filter((e) => !taken.has(e.id)) };
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
  /*
    ★ ESIS's guardians, person by person — 2026-10-01, phase 3 of the tidy.
    They were a separate table under the cards, so the same parent appeared
    twice and a reader had to compare the two by eye. Each card now says
    whether ESIS has this person and adds what only ESIS holds (workplace, a
    number we do not have); the ESIS guardians nobody here is linked to are
    listed once, below. Staff only, as before.
  */
  const contacts = useEsisRows("studentContacts", { enabled: canManage, params: { childId } });
  const esis = esisGuardians(contacts.rows);
  const { byGuardianship, unmatched } = matchGuardians(child.guardianships, esis);
  // Only say "not in ESIS" once ESIS has actually answered.
  const esisAnswered =
    canManage && !contacts.isPending && !contacts.isError && !contacts.isUnavailable;

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

  const actions = canManage ? (
    <div className="flex flex-wrap items-center gap-2">
      {invite}
      <ChildEsisContactsSend child={child} />
    </div>
  ) : undefined;

  const unmatchedList =
    canManage && unmatched.length > 0 ? (
      <div className="flex flex-col gap-2">
        <h3 className="text-body font-semibold text-ink">
          ЭСИС-д бүртгэлтэй, системд холбогдоогүй ({unmatched.length})
        </h3>
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {unmatched.map((person) => (
            <Card key={person.id} pad="compact" className="border-dashed">
              <CardHeading icon={<Users size={18} strokeWidth={2} />} action={invite}>
                {[person.lastName, person.firstName].filter(Boolean).join(" ") || "Нэргүй"}
                <EsisTag />
              </CardHeading>
              <dl>
                {person.familyName ? (
                  <InfoRow label="Ургийн овог">{person.familyName}</InfoRow>
                ) : null}
                <InfoRow label="Утас">
                  {person.phones.length > 0 ? person.phones.map(phoneLabel).join(", ") : "—"}
                </InfoRow>
                <InfoRow label="Ажлын газар" last>
                  {person.job ?? "—"}
                </InfoRow>
              </dl>
            </Card>
          ))}
        </div>
      </div>
    ) : null;

  if (child.guardianships.length === 0) {
    return (
      <section aria-labelledby="guardians-heading" className="flex flex-col gap-3">
        <ProfileSectionHeader id="guardians-heading" title="Асран хамгаалагч" action={actions} />
        <EmptyState
          icon={<Users size={28} aria-hidden="true" />}
          title="Асран хамгаалагч холбогдоогүй байна"
          description={
            canManage
              ? "Эцэг эх урьсны дараа тэд хүүхдийнхээ хавтсыг гар утаснаасаа харах боломжтой болно."
              : "Асран хамгаалагчийн мэдээлэл одоогоор бүртгэгдээгүй байна."
          }
        />
        {unmatchedList}
      </section>
    );
  }

  return (
    <section aria-labelledby="guardians-heading" className="flex flex-col gap-3">
      <ProfileSectionHeader id="guardians-heading" title="Асран хамгаалагч" action={actions} />
      <div className="grid items-start gap-3 lg:grid-cols-2">
        {child.guardianships.map((guardianship) => {
          const revoked = guardianship.canView === false;
          const guardian = guardianship.guardian;
          const canEdit = Boolean(guardian && (canEditAny || guardian.id === currentUserId));
          const href = guardian?.phone
            ? `tel:${guardian.phone}`
            : guardian?.email
              ? `mailto:${guardian.email}`
              : null;
          const inEsis = byGuardianship.get(guardianship.id);
          // ESIS numbers this kindergarten does not have for the person.
          const otherPhones = (inEsis?.phones ?? []).filter(
            (phone) => phoneKey(phone) !== phoneKey(guardian?.phone),
          );

          return (
            <Card key={guardianship.id} pad="compact">
              <CardHeading
                icon={<Users size={18} strokeWidth={2} />}
                action={
                  canEdit && guardian ? (
                    <EditGuardianDialog
                      childId={childId}
                      guardianship={guardianship}
                      currentUserId={currentUserId}
                    />
                  ) : undefined
                }
              >
                {GUARDIAN_RELATION_LABEL[guardianship.relation] ?? guardianship.relation}
                {inEsis ? (
                  <EsisTag />
                ) : esisAnswered ? (
                  <span className="ml-1.5 align-middle text-caption font-normal text-muted">
                    ЭСИС-д олдсонгүй
                  </span>
                ) : null}
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
                <InfoRow label="Холбоо барих утас" last={!inEsis?.job}>
                  {phoneLabel(guardian?.phone)}
                  {otherPhones.length > 0 ? (
                    <span className="mt-0.5 block text-caption font-medium text-peach-ink">
                      ЭСИС-д: {otherPhones.map(phoneLabel).join(", ")}
                    </span>
                  ) : null}
                </InfoRow>
                {inEsis?.job ? (
                  <InfoRow label="Ажлын газар" last>
                    {inEsis.job}
                    <EsisTag />
                  </InfoRow>
                ) : null}
              </dl>

              {href ? (
                <a
                  href={href}
                  className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-control bg-primary-soft px-4 text-body font-medium text-primary transition-colors hover:bg-sky"
                >
                  <Phone size={18} aria-hidden="true" />
                  Холбоо барих
                </a>
              ) : (
                <div className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-control bg-sunken px-4 text-body text-muted">
                  Холбоо барих мэдээлэл алга
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {unmatchedList}
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

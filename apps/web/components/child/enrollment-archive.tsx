"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Building2,
  ChevronDown,
  GraduationCap,
  Info,
  Mail,
  MapPin,
  Phone,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  enrollmentArchiveSchema,
  ageInMonths,
  ENROLLMENT_STATUS_LABEL,
  TEACHER_ROLE_LABEL,
  type EnrollmentArchive,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { formatDate, fullName, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Art } from "@/components/ui/art";

type Current = NonNullable<EnrollmentArchive["current"]>;
type Past = EnrollmentArchive["history"][number];
type Teacher = Current["teachers"][number];

/** `Group.ageBand` as a family reads it. */
const AGE_BAND_LABEL: Record<string, string> = {
  NURSERY: "Бага бүлэг",
  JUNIOR: "Дунд бүлэг",
  MIDDLE: "Ахлах бүлэг",
  SENIOR: "Бэлтгэл бүлэг",
};

/**
 * "Суралцалтын түүх" — where the child is today, and everywhere they have
 * been. Redrawn 2026-09-24 to the client's own design.
 *
 * ★ Two sections, not five cards. The screen used to be a current-placement
 * card, a transfer timeline, a kindergarten-details card and a teacher-contact
 * card, each repeating the kindergarten's name. The client's drawing folds the
 * details into the placement they belong to: the current kindergarten opens to
 * its capacity, its groups, its address and its teachers, and each past
 * placement opens to the same shape under the school year it belongs to.
 *
 * ★★ The facts come from the endpoint, never from this file. Capacity, group
 * count, headcount and the teacher list are computed by
 * `ChildrenService.getEnrollmentArchive` in bulk — see its note on why a
 * per-card query would be the N+1 §3.4 forbids.
 *
 * ★★★ Contact details belong to the current group's teachers only. A past
 * teacher is a name and a role, which is what `enrollmentArchiveEntrySchema`
 * carries and the whole of what this screen can draw for them.
 */
export function ChildEnrollmentArchive({
  childId,
  dateOfBirth,
}: {
  childId: string;
  dateOfBirth?: string | null;
}) {
  const archive = useQuery({
    queryKey: qk.enrollmentArchive(childId),
    queryFn: () => get(`/children/${childId}/enrollment-archive`, enrollmentArchiveSchema),
  });

  if (archive.isLoading) return <LoadingState rows={4} />;

  if (archive.isError) {
    return (
      <ErrorState
        title={isNotFound(archive.error) ? "Олдсонгүй" : "Алдаа гарлаа"}
        description={
          isNotFound(archive.error)
            ? "Энэ хүүхдийн мэдээлэл олдсонгүй."
            : errorMessage(archive.error)
        }
        action={
          <Button asChild variant="secondary">
            <Link href="/children">Жагсаалт руу буцах</Link>
          </Button>
        }
      />
    );
  }

  const { child, current, history } = archive.data!;
  const effectiveDateOfBirth = child.dateOfBirth ?? dateOfBirth;

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="current-placement-heading" className="flex flex-col gap-3">
        <SectionBar
          id="current-placement-heading"
          tone="mint"
          title="Одоогийн сурч байгаа цэцэрлэг"
        />

        {current ? (
          <CurrentPlacementCard current={current} />
        ) : (
          <EmptyState
            icon={<GraduationCap size={28} aria-hidden="true" />}
            title="Одоогоор бүртгэлгүй байна"
            description="Энэ хүүхэд одоогоор ямар ч бүлэгт идэвхтэй бүртгэлгүй байна."
          />
        )}
      </section>

      <section aria-labelledby="past-placements-heading" className="flex flex-col gap-3">
        <SectionBar id="past-placements-heading" tone="primary" title="Өмнөх суралцсан түүх" />

        {history.length === 0 ? (
          <EmptyState
            title="Өмнөх бүртгэл алга"
            description="Энэ хүүхэд өөр бүлэг, цэцэрлэгт суралцаж байгаагүй байна."
          />
        ) : (
          <ol className="flex flex-col gap-4">
            {history.map((entry) => (
              <PastPlacementRow
                key={entry.id}
                entry={entry}
                dateOfBirth={effectiveDateOfBirth ?? null}
              />
            ))}
          </ol>
        )}
      </section>

      {/*
        ★ ESIS's own movement record, under this product's — 2026-09-10, at the
        client's instruction. It renders nothing for a parent:
        `studentMovements` is not in a guardian's ESIS service list.
      */}
      <EsisDataPanel
        resource="studentMovements"
        title="ЭСИС дэх шилжилтийн түүх"
        description="Элсэлт, шилжилт, гаралт — ЭСИС-ийн бүртгэлээр"
      />
    </div>
  );
}

/** A section heading with the client's colour bar at its left. */
function SectionBar({ id, title, tone }: { id: string; title: string; tone: "mint" | "primary" }) {
  return (
    <h2 id={id} className="flex items-center gap-2.5 text-lead font-bold text-ink">
      <span
        aria-hidden="true"
        className={cn(
          "h-5 w-1 shrink-0 rounded-pill",
          tone === "mint" ? "bg-mint-ink" : "bg-primary",
        )}
      />
      {title}
    </h2>
  );
}

/** The current kindergarten: who teaches there, and what the place is. */
function CurrentPlacementCard({ current }: { current: Current }) {
  const kindergartenName = current.esis?.organization.name ?? current.kindergarten.name;
  const groupName = current.esis?.group?.name ?? current.group?.name ?? null;

  return (
    <Card pad="none" className="overflow-hidden">
      <details open className="group">
        <summary className="flex cursor-pointer list-none flex-col gap-4 p-4 marker:content-none md:flex-row md:items-center md:gap-5 md:p-5 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-3 md:gap-4">
            <Art name="kindergarten" size={56} className="size-12 shrink-0 md:size-14" />
            <span className="min-w-0">
              <span className="block truncate text-title font-bold text-ink">
                {kindergartenName}
              </span>
              <span className="mt-0.5 block truncate text-body text-muted">
                {placementFacts(groupName, current.group?.ageBand, current.group?.childCount)}
              </span>
            </span>
          </span>

          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-3 md:justify-end">
            {current.teachers.map((teacher) => (
              <TeacherChip key={teacher.id} teacher={teacher} />
            ))}
            <span className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-control border border-border px-3 text-body font-medium text-primary">
              Дэлгэрэнгүй
              <ChevronDown
                size={17}
                aria-hidden="true"
                className="transition-transform group-open:rotate-180"
              />
            </span>
          </span>
        </summary>

        <div className="flex flex-col gap-5 border-t border-border-soft p-4 md:p-5">
          <PlacementFacts
            capacity={current.kindergarten.capacity}
            groupCount={current.kindergarten.groupCount}
            organizationType={current.esis?.organization.institutionTypeName}
            address={current.esis?.organization.address ?? current.kindergarten.address}
          />

          {current.teachers.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-body font-semibold text-ink">Багшийн мэдээлэл</h3>
              <div className="grid gap-3 lg:grid-cols-2">
                {current.teachers.map((teacher) => (
                  <TeacherCard key={teacher.id} teacher={teacher} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </details>
    </Card>
  );
}

/** One past placement — its school year on the left, the card on the right. */
function PastPlacementRow({ entry, dateOfBirth }: { entry: Past; dateOfBirth: string | null }) {
  const age =
    dateOfBirth && entry.startedOn
      ? Math.floor(ageInMonths(dateOfBirth, entry.startedOn) / 12)
      : null;

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 md:grid-cols-[132px_minmax(0,1fr)] md:gap-5">
      {/*
        The dot and its rail, drawn on the year column so the cards keep their
        full width — the client's timeline, without a wrapper per row.
      */}
      <div className="flex gap-3 pt-3.5 md:gap-4">
        <span
          aria-hidden="true"
          className="mt-1.5 size-3 shrink-0 rounded-pill border-2 border-primary bg-surface"
        />
        <div className="min-w-0">
          <p className="text-body font-bold text-ink">{schoolYearLabel(entry)}</p>
          {age !== null ? <p className="text-caption text-muted">{age} нас</p> : null}
        </div>
      </div>

      <Card pad="none" className="overflow-hidden">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-3 p-3.5 marker:content-none md:gap-4 md:p-4 [&::-webkit-details-marker]:hidden">
            <Art name="kindergarten" size={44} className="size-10 shrink-0 md:size-11" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-lead font-semibold text-ink">
                {entry.kindergarten.name}
              </span>
              <span className="mt-0.5 block truncate text-caption text-muted">
                {placementFacts(entry.group?.name, entry.group?.ageBand, entry.group?.childCount)}
              </span>
            </span>
            <Badge tone="sky">{ENROLLMENT_STATUS_LABEL[entry.status] ?? "Суралцсан"}</Badge>
            <ChevronDown
              size={18}
              aria-hidden="true"
              className="shrink-0 text-faint transition-transform group-open:rotate-180"
            />
          </summary>

          <div className="grid gap-5 border-t border-border-soft p-4 lg:grid-cols-[minmax(0,1fr)_240px]">
            <PlacementFacts
              capacity={entry.kindergarten.capacity}
              groupCount={entry.kindergarten.groupCount}
              address={entry.kindergarten.address}
            />

            {entry.teachers.length > 0 ? (
              <div className="flex flex-col gap-3 lg:border-s lg:border-border-soft lg:ps-5">
                <h4 className="text-body font-semibold text-ink">Багшийн мэдээлэл</h4>
                {entry.teachers.map((teacher) => (
                  <TeacherChip key={teacher.id} teacher={teacher} />
                ))}
              </div>
            ) : null}
          </div>
        </details>
      </Card>
    </li>
  );
}

/** Хүчин чадал · Байгууллагын төрөл · Нийт бүлэг · Хаяг. */
function PlacementFacts({
  capacity,
  groupCount,
  organizationType,
  address,
}: {
  capacity?: number | null;
  groupCount?: number | null;
  organizationType?: string | null;
  address?: string | null;
}) {
  const rows: { icon: ReactNode; label: string; value: string }[] = [];
  if (capacity)
    rows.push({
      icon: <Info size={18} aria-hidden="true" />,
      label: "Хүчин чадал",
      value: `${capacity} хүүхэд`,
    });
  if (groupCount)
    rows.push({
      icon: <Users size={18} aria-hidden="true" />,
      label: "Нийт бүлэг",
      value: `${groupCount} бүлэг`,
    });
  rows.push({
    icon: <Building2 size={18} aria-hidden="true" />,
    label: "Байгууллагын төрөл",
    value: organizationType || "Цэцэрлэг",
  });
  if (address)
    rows.push({ icon: <MapPin size={18} aria-hidden="true" />, label: "Хаяг", value: address });

  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label} className="flex min-w-0 items-start gap-2.5">
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-faint">
            {row.icon}
          </span>
          <div className="min-w-0">
            <dt className="text-caption text-muted">{row.label}</dt>
            <dd className="break-words font-semibold text-ink">{row.value}</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}

/** A teacher as a face, a name and a role — the header and the past cards. */
function TeacherChip({
  teacher,
}: {
  teacher: { id: string; lastName: string; firstName: string; role: string };
}) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <TeacherAvatar teacher={teacher} size="sm" />
      <span className="min-w-0">
        <span className="block truncate font-semibold text-primary">{fullName(teacher)}</span>
        <span className="block truncate text-caption text-muted">
          {TEACHER_ROLE_LABEL[teacher.role as "LEAD" | "ASSISTANT"] ?? teacher.role}
        </span>
      </span>
    </span>
  );
}

/** The current group's teacher, in full: profession, school, and how to reach them. */
function TeacherCard({ teacher }: { teacher: Teacher }) {
  const rows = [
    ["Мэргэжил", teacher.specialization],
    ["Төгссөн сургууль", teacher.education],
  ].filter(([, value]) => Boolean(value)) as [string, string][];

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border p-3.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <TeacherAvatar teacher={teacher} size="md" />
        <p className="min-w-0 truncate font-bold text-ink">{fullName(teacher)}</p>
        <Badge tone="sky">{TEACHER_ROLE_LABEL[teacher.role] ?? teacher.role}</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {rows.length > 0 ? (
          <dl className="flex flex-col gap-1.5">
            {rows.map(([label, value]) => (
              <div key={label} className="flex min-w-0 gap-2">
                <dt className="shrink-0 text-caption text-muted">{label}</dt>
                <dd className="min-w-0 break-words text-caption font-medium text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <div className="flex flex-col gap-1.5">
          {teacher.phone ? (
            <a
              href={`tel:${teacher.phone}`}
              className="flex items-center gap-2 text-caption text-ink hover:text-primary"
            >
              <Phone size={15} aria-hidden="true" className="shrink-0 text-primary" />
              <span className="min-w-0 break-all">{teacher.phone}</span>
            </a>
          ) : null}
          {teacher.email ? (
            <a
              href={`mailto:${teacher.email}`}
              className="flex items-center gap-2 text-caption text-ink hover:text-primary"
            >
              <Mail size={15} aria-hidden="true" className="shrink-0 text-primary" />
              <span className="min-w-0 break-all">{teacher.email}</span>
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TeacherAvatar({
  teacher,
  size,
}: {
  teacher: { lastName: string; firstName: string };
  size: "sm" | "md";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-pill bg-sky font-semibold text-sky-ink",
        size === "sm" ? "size-9 text-caption" : "size-10 text-body",
      )}
    >
      {initials(teacher)}
    </span>
  );
}

/** "Дэлбээ бүлэг · Ахлах бүлэг · 18 хүүхэд", skipping whatever is missing. */
function placementFacts(
  groupName?: string | null,
  ageBand?: string | null,
  childCount?: number | null,
): string {
  return [
    groupName ?? "Бүлэггүй",
    ageBand ? (AGE_BAND_LABEL[ageBand] ?? null) : null,
    childCount ? `${childCount} хүүхэд` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "2024 - 2025", or the dates themselves when no school year was recorded. */
function schoolYearLabel(entry: Past): string {
  if (entry.schoolYear?.name) return entry.schoolYear.name;
  const from = entry.startedOn.slice(0, 4);
  const to = entry.endedOn?.slice(0, 4);
  return to && to !== from ? `${from} - ${to}` : formatDate(entry.startedOn);
}

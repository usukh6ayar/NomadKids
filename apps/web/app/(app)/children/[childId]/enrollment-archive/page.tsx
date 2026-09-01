"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  GraduationCap,
  Mail,
  MapPin,
  Phone,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  enrollmentArchiveSchema,
  TEACHER_ROLE_LABEL,
  type EnrollmentArchive,
  ENROLLMENT_STATUS_LABEL,
  ENROLLMENT_STATUS_TONE,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { formatDate, fullName, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

type Current = NonNullable<EnrollmentArchive["current"]>;

/**
 * "Цэцэрлэг, бүлгийн архив" — a child's current placement, who to contact
 * there, and every kindergarten/group they were in before.
 *
 * ★ Shared with staff, like every other `/children/[childId]/*` page — a
 * teacher opening a transferred-in child's record can read the same history a
 * parent sees. The home tile (`(app)/home/page.tsx`) and the sidebar entry
 * (`(app)/layout.tsx`'s `parentSections`) that link here are parent-only; staff
 * reach this by URL, from a child's own record, same as every sibling route.
 *
 * The teacher card is deliberately name-only — `enrollmentArchiveSchema` does
 * not carry phone or email, unlike `guardianshipSchema`'s contact fields. That
 * is a scoped choice for this one screen, not a broader "staff have no
 * contact info" stance.
 */
export default function EnrollmentArchivePage() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;

  const archive = useQuery({
    queryKey: qk.enrollmentArchive(childId),
    queryFn: () => get(`/children/${childId}/enrollment-archive`, enrollmentArchiveSchema),
  });

  if (archive.isLoading) return <LoadingState rows={4} />;

  if (archive.isError) {
    return (
      <div className="py-6">
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
      </div>
    );
  }

  const { child, current, history } = archive.data!;

  return (
    <div className="flex flex-col gap-6 py-2">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href={`/children/${childId}/general`}>
          <ArrowLeft size={18} />
          Хүүхдийн бүртгэл
        </Link>
      </Button>

      <ArchiveHero child={child} current={current} />

      <div className="grid gap-3 sm:grid-cols-2">
        <CurrentPlacementDisclosure current={current} />
        <HistoryDisclosure history={history} />
      </div>

      {current ? (
        <>
          <KindergartenInfoCard current={current} />
          <TeacherContactCard current={current} />
        </>
      ) : (
        <EmptyState
          icon={<GraduationCap size={28} aria-hidden="true" />}
          title="Одоогоор бүртгэлгүй байна"
          description="Энэ хүүхэд одоогоор ямар ч бүлэгт идэвхтэй бүртгэлгүй байна."
        />
      )}
    </div>
  );
}

/** The identity strip — a gradient initial, and where this child stands today. */
function ArchiveHero({
  child,
  current,
}: {
  child: EnrollmentArchive["child"];
  current: EnrollmentArchive["current"];
}) {
  const subtitle = current
    ? [current.kindergarten.name, current.group?.name].filter(Boolean).join(" · ")
    : "Одоо бүртгэлгүй";

  return (
    <Card pad="roomy" className="flex items-center gap-4">
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center rounded-card bg-[linear-gradient(135deg,#60a5fa_0%,#8b5cf6_100%)] text-lead font-semibold text-white"
      >
        {initials(child)}
      </span>
      <div className="min-w-0">
        <p className="text-caption font-medium text-muted">Цэцэрлэг, бүлгийн архив</p>
        <h1 className="truncate text-heading font-semibold text-ink">
          {child.firstName}-ийн суралцсан түүх
        </h1>
        <p className="truncate text-body text-muted">{subtitle}</p>
      </div>
    </Card>
  );
}

/**
 * One of the two summary tiles — a label, a figure, an optional subline, and a
 * disclosure chevron. Same `<details className="group">` +
 * `group-open:rotate-180` convention `child-about-me.tsx`'s option picker uses,
 * so one disclosure primitive covers both.
 */
function SummaryDisclosure({
  label,
  value,
  sub,
  children,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-card border border-border bg-surface shadow-sm">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-start justify-between gap-3 px-4 py-4 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <p className="text-caption text-muted">{label}</p>
          <p className="mt-0.5 truncate text-lead font-semibold text-ink">{value}</p>
          {sub ? <p className="truncate text-body text-muted">{sub}</p> : null}
        </div>
        <ChevronDown
          size={18}
          aria-hidden="true"
          className="mt-1 shrink-0 text-faint transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-border-soft px-4 py-3">{children}</div>
    </details>
  );
}

function CurrentPlacementDisclosure({ current }: { current: EnrollmentArchive["current"] }) {
  return (
    <SummaryDisclosure
      label="Одоо суралцаж байгаа"
      value={current?.kindergarten.name ?? "Бүртгэлгүй"}
      sub={current?.group?.name}
    >
      {current ? (
        <dl className="flex flex-col gap-1.5 text-body">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Элссэн</dt>
            <dd className="text-ink">{formatDate(current.startedOn)}</dd>
          </div>
          {current.schoolYear ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Хичээлийн жил</dt>
              <dd className="text-ink">{current.schoolYear.name}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="text-body text-muted">Одоогоор идэвхтэй бүртгэл алга.</p>
      )}
    </SummaryDisclosure>
  );
}

/** Past kindergarten/group/teacher, ended-status-tinted the same way `child-general-info.tsx`'s own history list is. */
function HistoryDisclosure({ history }: { history: EnrollmentArchive["history"] }) {
  return (
    <SummaryDisclosure
      label="Суралцсан түүх"
      value={`${history.length} түүх`}
      sub="Цэцэрлэг, бүлэг, багшийн өөрчлөлт"
    >
      {history.length === 0 ? (
        <p className="text-body text-muted">Өөрчлөлт бүртгэгдээгүй байна.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {history.map((entry) => (
            <li key={entry.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">
                  {[entry.kindergarten.name, entry.group?.name].filter(Boolean).join(" · ")}
                </p>
                <p className="text-caption text-muted">
                  {formatDate(entry.startedOn)} – {entry.endedOn ? formatDate(entry.endedOn) : "…"}
                </p>
              </div>
              <Badge tone={ENROLLMENT_STATUS_TONE[entry.status] ?? "neutral"}>
                {ENROLLMENT_STATUS_LABEL[entry.status] ?? ENROLLMENT_STATUS_LABEL.ENDED}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </SummaryDisclosure>
  );
}

/** The teacher-entered introduction and the kindergarten's own contact details. */
function KindergartenInfoCard({ current }: { current: Current }) {
  const rows: { icon: ReactNode; label: string; value: ReactNode }[] = [];

  if (current.kindergarten.description) {
    rows.push({
      icon: <Building2 size={16} aria-hidden="true" />,
      label: "Танилцуулга",
      value: <span className="whitespace-pre-wrap">{current.kindergarten.description}</span>,
    });
  }
  if (current.kindergarten.address) {
    rows.push({
      icon: <MapPin size={16} aria-hidden="true" />,
      label: "Хаяг",
      value: current.kindergarten.address,
    });
  }
  if (current.kindergarten.phone) {
    rows.push({
      icon: <Phone size={16} aria-hidden="true" />,
      label: "Утас",
      value: (
        <a href={`tel:${current.kindergarten.phone}`} className="hover:text-primary-strong">
          {current.kindergarten.phone}
        </a>
      ),
    });
  }
  if (current.kindergarten.email) {
    rows.push({
      icon: <Mail size={16} aria-hidden="true" />,
      label: "И-мэйл",
      value: (
        <a href={`mailto:${current.kindergarten.email}`} className="hover:text-primary-strong">
          {current.kindergarten.email}
        </a>
      ),
    });
  }
  if (current.group?.schedule) {
    rows.push({
      icon: <CalendarDays size={16} aria-hidden="true" />,
      label: "Хичээлийн хуваарь",
      value: <span className="whitespace-pre-wrap">{current.group.schedule}</span>,
    });
  }
  if (current.group?.rules) {
    rows.push({
      icon: <ClipboardList size={16} aria-hidden="true" />,
      label: "Бүлгийн дүрэм",
      value: <span className="whitespace-pre-wrap">{current.group.rules}</span>,
    });
  }

  return (
    <section aria-label="Одоогийн цэцэрлэг, бүлгийн мэдээлэл">
      <SectionHeader
        title="Одоогийн цэцэрлэг, бүлгийн мэдээлэл"
        lede="Багшийн оруулсан танилцуулга, холбоо барих мэдээлэл."
      />
      <Card pad="roomy">
        {rows.length === 0 ? (
          <p className="text-body text-muted">Дэлгэрэнгүй мэдээлэл оруулаагүй байна.</p>
        ) : (
          <dl className="flex flex-col gap-3">
            {rows.map((row) => (
              <div key={row.label} className="flex items-start gap-3">
                <span aria-hidden="true" className="mt-0.5 text-muted">
                  {row.icon}
                </span>
                <div className="min-w-0">
                  <dt className="text-caption text-muted">{row.label}</dt>
                  <dd className="text-body text-ink">{row.value}</dd>
                </div>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </section>
  );
}

/** The current group's homeroom teacher(s) — name and role only, no contact details. */
function TeacherContactCard({ current }: { current: Current }) {
  const place = [current.kindergarten.name, current.group?.name].filter(Boolean).join(" · ");

  return (
    <section aria-label="Багштай холбогдох">
      <SectionHeader title="Багштай холбогдох" lede="Одоогийн бүлгийн хариуцсан багш." />
      {current.teachers.length === 0 ? (
        <Card pad="roomy">
          <p className="text-body text-muted">Хариуцсан багш бүртгэгдээгүй байна.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {current.teachers.map((teacher) => (
            <div key={teacher.id} className="flex min-h-[64px] items-center gap-3 px-4 py-3">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-pill",
                  "bg-sky text-sky-ink text-lead font-semibold",
                )}
              >
                {initials(teacher)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="truncate font-medium text-ink">{fullName(teacher)}</p>
                  {teacher.role === "ASSISTANT" ? (
                    <Badge tone="neutral">{TEACHER_ROLE_LABEL.ASSISTANT}</Badge>
                  ) : null}
                </div>
                <p className="truncate text-body text-muted">{place}</p>
              </div>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}

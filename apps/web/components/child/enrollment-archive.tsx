"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowRightLeft,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Database,
  GraduationCap,
  Mail,
  MapPin,
  Phone,
  Sparkles,
  UserCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  enrollmentArchiveSchema,
  ageInMonths,
  TEACHER_ROLE_LABEL,
  type EnrollmentArchive,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { formatDate, fullName, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Art } from "@/components/ui/art";

type Current = NonNullable<EnrollmentArchive["current"]>;

/**
 * "Шилжилт хөдөлгөөн" — where a child is placed today, who to contact there,
 * and every kindergarten and group they were in before.
 *
 * ★ A component rather than a page, since 2026-09-04.
 *
 * It was only ever the body of `/children/:id/enrollment-archive`, which a
 * parent reached from their home tile and staff reached by typing the URL. The
 * client asked for it inside the child's own record — "хүүхдүүд дотор дараад
 * орохоор мөн нэмтээр шилжилт хөдөлгөөн байна" — so it is a tab there now and
 * the standalone route is a frame around this same component. One
 * implementation, two entrances: the alternative was a second, shorter history
 * panel that would eventually disagree with this one about a transfer date.
 *
 * ★★ `showHero` is what differs between the two.
 *
 * On the standalone route the child's name has to be on screen, because
 * nothing else on the page says whose history this is. Inside the tab the hero
 * is already above the tab strip, so repeating it would put the same name and
 * the same placement badge twice on one screen.
 */
export function ChildEnrollmentArchive({
  childId,
  showHero = true,
  dateOfBirth,
}: {
  childId: string;
  showHero?: boolean;
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
    <div className="flex flex-col gap-6">
      {showHero ? <ArchiveHero child={child} current={current} /> : null}

      <section aria-labelledby="enrollment-history-heading">
        <SectionHeader
          id="enrollment-history-heading"
          title="Суралцсан түүх"
          lede="Одоогийн бүртгэл болон гарсан өөрчлөлтүүд"
        />

        {current ? (
          <CurrentEnrollmentCard current={current} />
        ) : (
          <EmptyState
            icon={<GraduationCap size={28} aria-hidden="true" />}
            title="Одоогоор бүртгэлгүй байна"
            description="Энэ хүүхэд одоогоор ямар ч бүлэгт идэвхтэй бүртгэлгүй байна."
          />
        )}
      </section>

      <EnrollmentTimeline current={current} history={history} dateOfBirth={effectiveDateOfBirth} />

      {showHero && current ? (
        <>
          <KindergartenInfoCard current={current} />
          <TeacherContactCard current={current} />
        </>
      ) : null}
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
    ? [
        current.esis?.organization.name ?? current.kindergarten.name,
        current.esis?.group?.name ?? current.group?.name,
      ]
        .filter(Boolean)
        .join(" · ")
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

function CurrentEnrollmentCard({ current }: { current: Current }) {
  const teacherNames = current.teachers.map(fullName).join(", ");
  const kindergartenName = current.esis?.organization.name ?? current.kindergarten.name;
  const groupName = current.esis?.group?.name ?? current.group?.name;

  return (
    <div className="overflow-hidden rounded-card border border-primary/30 bg-surface shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-primary-soft px-4 py-4 md:px-5">
        <h3 className="text-lead font-semibold text-ink">Одоогийн бүртгэл</h3>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {current.esis ? (
            <Badge tone={current.esis.mode === "DEMO" ? "sun" : "sky"}>
              {current.esis.mode === "DEMO" ? "ESIS demo data" : "ESIS синк"}
            </Badge>
          ) : null}
          <Badge tone="mint">Суралцаж байгаа</Badge>
        </div>
      </div>

      <details open className="group">
        <summary className="flex min-h-[92px] cursor-pointer list-none items-center justify-between gap-4 px-4 py-5 marker:content-none md:px-5 [&::-webkit-details-marker]:hidden">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center bg-transparent">
              <Art name="kindergarten" size={40} className="size-10" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-lead font-semibold text-ink">{kindergartenName}</p>
              <p className="mt-1 text-body text-muted">
                {groupName ?? "Бүлэггүй"} · {formatDate(current.startedOn)}-ээс
              </p>
            </div>
          </div>
          <ChevronDown
            aria-hidden="true"
            className="shrink-0 text-primary transition-transform group-open:rotate-180"
          />
        </summary>

        <dl className="grid border-t border-border sm:grid-cols-2 sm:divide-x sm:divide-border">
          <div className="flex min-h-[80px] items-center gap-3 px-4 py-4 md:px-5">
            <GraduationCap aria-hidden="true" className="size-5 shrink-0 text-muted" />
            <div>
              <dt className="text-body text-muted">Ангийн багш</dt>
              <dd className="mt-0.5 font-semibold text-ink">
                {teacherNames || "Багш бүртгэгдээгүй"}
              </dd>
            </div>
          </div>
          <div className="flex min-h-[80px] items-center gap-3 border-t border-border px-4 py-4 sm:border-t-0 md:px-5">
            <CalendarDays aria-hidden="true" className="size-5 shrink-0 text-muted" />
            <div>
              <dt className="text-body text-muted">Хичээлийн жил</dt>
              <dd className="mt-0.5 font-semibold text-ink">
                {current.schoolYear?.name ?? "Тодорхойгүй"}
              </dd>
            </div>
          </div>
        </dl>
      </details>
    </div>
  );
}

type Placement = EnrollmentArchive["history"][number] | Current;
type TimelineKind = "INITIAL" | "KINDERGARTEN" | "GROUP" | "CONTINUED";

interface TimelineEvent {
  id: string;
  kind: TimelineKind;
  title: string;
  date: string;
  age: number | null;
  from?: string;
  to: string;
}

function EnrollmentTimeline({
  current,
  history,
  dateOfBirth,
}: {
  current: EnrollmentArchive["current"];
  history: EnrollmentArchive["history"];
  dateOfBirth?: string | null;
}) {
  const events = buildTimeline(current, history, dateOfBirth);

  return (
    <section aria-labelledby="enrollment-timeline-heading">
      <div className="mb-5 flex items-center justify-between gap-3 border-t border-border pt-5">
        <h3 id="enrollment-timeline-heading" className="text-heading font-semibold text-ink">
          Бүртгэл, шилжилтийн түүх
        </h3>
        <span className="shrink-0 text-body text-muted">{events.length} өөрчлөлт</span>
      </div>

      {events.length === 0 ? (
        <EmptyState
          title="Өөрчлөлт бүртгэгдээгүй байна"
          description="Бүртгэл эсвэл шилжилт хийгдэхэд энд дарааллаар харагдана."
        />
      ) : (
        <ol className="relative ml-5 flex flex-col gap-8 pb-1 before:absolute before:bottom-5 before:left-[17px] before:top-5 before:w-0.5 before:bg-primary/20">
          {events.map((event) => (
            <TimelineRow key={event.id} event={event} />
          ))}
        </ol>
      )}

      {/*
        ★ ESIS's own movement record, under this product's — 2026-09-10, at the
        client's instruction: "хүүхэд дээр дараад орохад суралцсан түүх гэдэгт
        шилжилтийн түүх гэдэг хэсэгт л харагдана".

        The timeline above is built from `Enrollment` rows this kindergarten
        wrote. `student/movement/v2` is the ministry's version of the same
        history — enrolments, transfers, releases across every institution the
        child has attended. Side by side is the point: a gap between them is
        exactly what a director needs to see before a token goes live.

        It renders nothing for a parent: `studentMovements` is not in a
        guardian's ESIS service list, so `/esis/catalog` omits it.
      */}
      <div className="mt-8">
        <EsisDataPanel
          resource="studentMovements"
          title="ЭСИС дэх шилжилтийн түүх"
          description="Элсэлт, шилжилт, гаралт — ЭСИС-ийн бүртгэлээр"
        />
      </div>
    </section>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  const Icon =
    event.kind === "KINDERGARTEN"
      ? ArrowRightLeft
      : event.kind === "GROUP"
        ? UserCheck
        : event.kind === "CONTINUED"
          ? CalendarDays
          : Sparkles;

  return (
    <li className="relative grid min-h-[88px] grid-cols-[36px_minmax(0,1fr)] gap-5">
      <span className="relative z-10 flex size-9 items-center justify-center rounded-pill border-2 border-surface bg-primary-soft text-primary">
        <Icon size={17} aria-hidden="true" />
      </span>
      <div className="min-w-0 pb-1 sm:flex sm:items-start sm:justify-between sm:gap-5">
        <div className="min-w-0">
          <h4 className="text-lead font-semibold text-ink">{event.title}</h4>
          {event.age !== null ? (
            <p className="mt-0.5 text-body text-muted">{event.age} нас</p>
          ) : null}
          <p className="mt-2 flex flex-wrap items-center gap-2 font-medium text-primary">
            {event.from ? (
              <>
                <span>{event.from}</span>
                <span aria-hidden="true">→</span>
              </>
            ) : null}
            <span>{event.to}</span>
          </p>
        </div>
        <time dateTime={event.date} className="mt-2 block shrink-0 text-body text-muted sm:mt-0">
          {formatDate(event.date)}
        </time>
      </div>
    </li>
  );
}

function buildTimeline(
  current: EnrollmentArchive["current"],
  history: EnrollmentArchive["history"],
  dateOfBirth?: string | null,
): TimelineEvent[] {
  const placements: Placement[] = [...history, ...(current ? [current] : [])].sort((a, b) =>
    a.startedOn.localeCompare(b.startedOn),
  );

  return placements
    .map((placement, index): TimelineEvent => {
      const previous = placements[index - 1];
      const age = dateOfBirth
        ? Math.max(0, Math.floor(ageInMonths(dateOfBirth, placement.startedOn) / 12))
        : null;

      if (!previous) {
        return {
          id: placement.id,
          kind: "INITIAL",
          title: "Цэцэрлэгт анх элссэн",
          date: placement.startedOn,
          age,
          to: `Анхны цэцэрлэг · ${placement.group?.name ?? placement.kindergarten.name}`,
        };
      }

      if (previous.kindergarten.id !== placement.kindergarten.id) {
        return {
          id: placement.id,
          kind: "KINDERGARTEN",
          title: "Цэцэрлэг шилжсэн",
          date: placement.startedOn,
          age,
          from: previous.kindergarten.name,
          to: placement.kindergarten.name,
        };
      }

      if (previous.group?.id !== placement.group?.id) {
        return {
          id: placement.id,
          kind: "GROUP",
          title: "Бүлэг шилжсэн",
          date: placement.startedOn,
          age,
          from: previous.group?.name ?? "Бүлэггүй",
          to: placement.group?.name ?? "Бүлэггүй",
        };
      }

      return {
        id: placement.id,
        kind: "CONTINUED",
        title: "Шинэ хичээлийн жилд үргэлжлүүлэн суралцсан",
        date: placement.startedOn,
        age,
        to: [placement.kindergarten.name, placement.group?.name].filter(Boolean).join(" · "),
      };
    })
    .reverse();
}

/** ESIS organization output reduced to fields appropriate for a parent. */
function KindergartenInfoCard({ current }: { current: Current }) {
  const rows: { icon: ReactNode; label: string; value: ReactNode }[] = [];
  const esis = current.esis;

  if (esis) {
    const organization = esis.organization;
    const esisRows: Array<[string, string | null]> = [
      ["Байгууллагын нэр", organization.name],
      ["Товчилсон нэр", organization.shortName],
      ["Бүтэн нэр", organization.longName],
      ["Хуулийн этгээдийн нэр", organization.legalName],
      ["Хуулийн этгээдийн нэр (монгол бичиг)", organization.legalNameMgl],
      ["Байгууллагын төрөл", organization.institutionTypeName],
      ["Өмчийн хэлбэр", organization.propertyTypeName],
      ["Ангилал", organization.classificationName],
      ["Аймаг, нийслэл", organization.provinceName],
      ["Сум, дүүрэг", organization.districtName],
      ["Баг, хороо", organization.subDistrictName],
      ["Бүс", organization.regionName],
      ["Хаяг", organization.address],
      ["Бүлэг", esis.group?.name ?? null],
      ["Сургалтын түвшин", esis.group?.academicLevelName ?? null],
      ["Хичээлийн жил", esis.group?.academicYear ?? null],
      ["Хариуцсан багш", esis.group?.instructorName ?? null],
    ];

    for (const [label, value] of esisRows) {
      if (value) {
        rows.push({
          icon:
            label === "Хаяг" ? (
              <MapPin size={16} aria-hidden="true" />
            ) : (
              <Database size={16} aria-hidden="true" />
            ),
          label,
          value,
        });
      }
    }
  } else if (current.kindergarten.description) {
    rows.push({
      icon: <Art name="kindergarten" size={18} className="size-[18px]" />,
      label: "Танилцуулга",
      value: <span className="whitespace-pre-wrap">{current.kindergarten.description}</span>,
    });
  }
  if (!esis && current.kindergarten.address) {
    rows.push({
      icon: <MapPin size={16} aria-hidden="true" />,
      label: "Хаяг",
      value: current.kindergarten.address,
    });
  }
  if (!esis && current.kindergarten.phone) {
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
  if (!esis && current.kindergarten.email) {
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
  if (!esis && current.group?.schedule) {
    rows.push({
      icon: <CalendarDays size={16} aria-hidden="true" />,
      label: "Хичээлийн хуваарь",
      value: <span className="whitespace-pre-wrap">{current.group.schedule}</span>,
    });
  }
  if (!esis && current.group?.rules) {
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
        lede={
          esis
            ? "ESIS-ээс синк хийгдсэн байгууллага болон бүлгийн мэдээлэл."
            : "ESIS мэдээлэл түр боломжгүй тул системд хадгалсан мэдээллийг харуулж байна."
        }
      />
      <Card pad="roomy">
        {esis ? (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
            <Badge tone={esis.mode === "DEMO" ? "sun" : "mint"}>
              {esis.mode === "DEMO" ? "ESIS DEMO DATA" : "ESIS LIVE"}
            </Badge>
            <p className="text-caption text-muted">
              Сүүлийн синк: {formatDate(esis.syncedAt)} · {esis.status}
            </p>
          </div>
        ) : null}
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
  const place = [
    current.esis?.organization.name ?? current.kindergarten.name,
    current.esis?.group?.name ?? current.group?.name,
  ]
    .filter(Boolean)
    .join(" · ");

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

"use client";

import { PersonAvatar } from "@/components/media/media-image";
import { KindergartenLogoAvatar } from "@/components/media/kindergarten-logo";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
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
import { ErrorState, LoadingState } from "@/components/ui/states";
import { formatDate, fullName } from "@/lib/format";
import { useSession } from "@/lib/auth/session";
import { useEsisRows } from "@/components/esis/use-esis-rows";

type Current = NonNullable<EnrollmentArchive["current"]>;
type Past = EnrollmentArchive["history"][number];

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
  nationalId,
}: {
  childId: string;
  dateOfBirth?: string | null;
  /** The регистр, when the caller has it — lets ESIS name this child exactly. */
  nationalId?: string | null;
}) {
  const { hasRole } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");
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
  // Families need one clear contact: the group's lead teacher. Assistants
  // remain visible to staff on the same screen for internal coordination.
  const visibleCurrentTeachers =
    current?.teachers.filter((teacher) => isStaff || teacher.role === "LEAD") ?? [];

  /*
    ★ The same shape as the other tabs — 2026-10-01, at the client's request:
    a heading and rows for the current kindergarten, then tables for its
    teachers, the earlier placements and what ESIS recorded. It was cards
    with folds inside folds (a "Дэлгэрэнгүй" in every placement) and a timeline
    rail; every fact it showed is still here.
  */
  return (
    <div className="flex flex-col gap-5">
      {!isStaff && current ? <FamilyCurrentView current={current} /> : null}

      {isStaff || !current ? (
        <section aria-labelledby="current-placement-heading" className="flex flex-col gap-2">
          <SectionTitle id="current-placement-heading" title="Одоогийн сурч байгаа цэцэрлэг" />
          {current ? (
            <CurrentPlacementCard current={current} />
          ) : (
            <p className="text-body text-muted">
              Энэ хүүхэд одоогоор ямар ч бүлэгт идэвхтэй бүртгэлгүй байна.
            </p>
          )}
        </section>
      ) : null}

      {isStaff && current && visibleCurrentTeachers.length > 0 ? (
        <section aria-labelledby="current-teachers-heading" className="flex flex-col gap-2">
          <SectionTitle id="current-teachers-heading" title="Багш" />
          <Table
            caption="Багшийн мэдээлэл"
            columns={["Нэр", "Үүрэг", "Мэргэжил", "Төгссөн сургууль", "Утас", "И-мэйл"]}
          >
            {visibleCurrentTeachers.map((teacher) => (
              <tr key={teacher.id} className="border-t border-border-soft">
                <td className="px-3 py-2 font-medium text-ink">{fullName(teacher)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {TEACHER_ROLE_LABEL[teacher.role] ?? teacher.role}
                </td>
                <td className="px-3 py-2">{teacher.specialization || "—"}</td>
                <td className="px-3 py-2">{teacher.education || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {teacher.phone ? (
                    <a href={`tel:${teacher.phone}`} className="text-primary hover:underline">
                      {teacher.phone}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">
                  {teacher.email ? (
                    <a
                      href={`mailto:${teacher.email}`}
                      className="break-all text-primary hover:underline"
                    >
                      {teacher.email}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </section>
      ) : null}

      <section aria-labelledby="past-placements-heading" className="flex flex-col gap-2">
        <SectionTitle id="past-placements-heading" title="Өмнөх суралцсан түүх" />
        {history.length === 0 ? (
          <p className="text-body text-muted">
            Энэ хүүхэд өөр бүлэг, цэцэрлэгт суралцаж байгаагүй байна.
          </p>
        ) : (
          <Table
            caption="Өмнөх суралцсан түүх"
            columns={["Хичээлийн жил", "Нас", "Цэцэрлэг", "Бүлэг", "Багш", "Хугацаа", "Төлөв"]}
          >
            {history.map((entry) => {
              const age =
                effectiveDateOfBirth && entry.startedOn
                  ? Math.floor(ageInMonths(effectiveDateOfBirth, entry.startedOn) / 12)
                  : null;
              const visibleTeachers = entry.teachers.filter(
                (teacher) => isStaff || teacher.role === "LEAD",
              );
              return (
                <tr key={entry.id} className="border-t border-border-soft">
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-ink">
                    {schoolYearLabel(entry)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {age !== null ? `${age} нас` : "—"}
                  </td>
                  <td className="px-3 py-2">{entry.kindergarten.name}</td>
                  <td className="px-3 py-2">
                    {placementFacts(
                      entry.group?.name,
                      entry.group?.ageBand,
                      entry.group?.childCount,
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {visibleTeachers.length > 0
                      ? visibleTeachers.map((teacher) => fullName(teacher)).join(", ")
                      : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted">
                    {formatDate(entry.startedOn)}
                    {entry.endedOn ? ` – ${formatDate(entry.endedOn)}` : ""}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone="sky">{ENROLLMENT_STATUS_LABEL[entry.status] ?? "Суралцсан"}</Badge>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </section>

      {isStaff ? <EsisMovements child={{ ...child, nationalId }} /> : null}
    </div>
  );
}

/** What a family calls each teacher — the drawing's words, not the contract's «Ахлах багш». */
const FAMILY_TEACHER_ROLE: Record<string, string> = {
  LEAD: "Бүлгийн багш",
  ASSISTANT: "Багшийн туслах",
};

/**
 * «Цэцэрлэг», then «Бүлэг», then the group's teachers with their faces — the
 * family's view, client 2026-10-06: "эхлээд цэцэрлэг дараа нь бүлэг дараа нь
 * бүлгийн багш туслах багш гээд зурагнууд нь харагддаг арай орчин үеийн".
 *
 * ★ The assistant is shown again. A family had been shown the lead teacher
 * alone; the client names both. Staff keep the full tables above.
 *
 * Every picture here is a tenant image (`KINDERGARTEN_LOGO`, `USER_PHOTO`) the
 * family may already read, through `/media/:id`.
 */
function FamilyCurrentView({ current }: { current: Current }) {
  const esis = current.esis ?? null;
  const kindergartenName = esis?.organization.name ?? current.kindergarten.name;
  const address = esis?.organization.address ?? current.kindergarten.address;
  const groupName = esis?.group?.name ?? current.group?.name ?? "—";
  const teachers = [...current.teachers].sort((a, b) =>
    a.role === b.role ? 0 : a.role === "LEAD" ? -1 : 1,
  );

  /*
    ★ Every fact the staff card has — client, 2026-10-06: "мэдээллүүд маш
    дутуу". Only what is filled is drawn, so a kindergarten that never entered
    its capacity shows no «Хүчин чадал —» row.
  */
  const kindergartenFacts: { label: string; value: ReactNode }[] = [];
  if (address) kindergartenFacts.push({ label: "Хаяг", value: address });
  if (current.kindergarten.phone) {
    kindergartenFacts.push({
      label: "Утас",
      value: (
        <a href={`tel:${current.kindergarten.phone}`} className="text-primary hover:underline">
          {current.kindergarten.phone}
        </a>
      ),
    });
  }
  if (current.kindergarten.email) {
    kindergartenFacts.push({
      label: "И-мэйл",
      value: (
        <a
          href={`mailto:${current.kindergarten.email}`}
          className="break-all text-primary hover:underline"
        >
          {current.kindergarten.email}
        </a>
      ),
    });
  }
  kindergartenFacts.push({
    label: "Байгууллагын төрөл",
    value: esis?.organization.institutionTypeName || "Цэцэрлэг",
  });
  if (current.kindergarten.capacity) {
    kindergartenFacts.push({
      label: "Хүчин чадал",
      value: `${current.kindergarten.capacity} хүүхэд`,
    });
  }
  if (current.kindergarten.groupCount) {
    kindergartenFacts.push({
      label: "Нийт бүлэг",
      value: `${current.kindergarten.groupCount} бүлэг`,
    });
  }

  const groupFacts: { label: string; value: ReactNode }[] = [];
  if (current.group?.ageBand) {
    groupFacts.push({
      label: "Нас",
      value: AGE_BAND_LABEL[current.group.ageBand] ?? current.group.ageBand,
    });
  }
  if (current.group?.childCount) {
    groupFacts.push({ label: "Хүүхдийн тоо", value: `${current.group.childCount} хүүхэд` });
  }
  groupFacts.push({
    label: "Хичээлийн жил",
    value: current.schoolYear?.name ?? esis?.group?.academicYear ?? "—",
  });
  if (esis?.group?.academicLevelName) {
    groupFacts.push({
      label: "Түвшин",
      value: (
        <>
          {esis.group.academicLevelName}
          <EsisTag />
        </>
      ),
    });
  }
  groupFacts.push({ label: "Бүлэгт орсон огноо", value: formatDate(current.startedOn) });

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="family-kindergarten-heading">
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-4">
            <KindergartenLogoAvatar
              size={64}
              fallback={
                <span
                  aria-hidden="true"
                  className="grid size-16 shrink-0 place-items-center rounded-pill bg-primary-soft text-title font-bold text-primary"
                >
                  {kindergartenName.slice(0, 1)}
                </span>
              }
            />
            <div className="min-w-0 flex-1">
              <p className="text-caption font-medium text-muted">Цэцэрлэг</p>
              <h2 id="family-kindergarten-heading" className="text-title font-semibold text-ink">
                {kindergartenName}
              </h2>
            </div>
          </div>
          <dl>
            {kindergartenFacts.map((fact, index) => (
              <Fact
                key={fact.label}
                label={fact.label}
                last={index === kindergartenFacts.length - 1}
              >
                {fact.value}
              </Fact>
            ))}
          </dl>
        </Card>
      </section>

      <section aria-labelledby="family-group-heading">
        <Card className="flex flex-col gap-2 p-4">
          <div>
            <p className="text-caption font-medium text-muted">Бүлэг</p>
            <h2 id="family-group-heading" className="text-title font-semibold text-ink">
              {groupName}
            </h2>
          </div>
          <dl>
            {groupFacts.map((fact, index) => (
              <Fact key={fact.label} label={fact.label} last={index === groupFacts.length - 1}>
                {fact.value}
              </Fact>
            ))}
          </dl>
        </Card>
      </section>

      {teachers.length > 0 ? (
        <section aria-labelledby="family-teachers-heading" className="flex flex-col gap-2">
          <h2 id="family-teachers-heading" className="text-lead font-semibold text-ink">
            Багш нар
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {teachers.map((teacher) => (
              <li key={teacher.id}>
                <Card className="flex h-full flex-col gap-2 p-4">
                  <div className="flex items-center gap-3">
                    <PersonAvatar child={teacher} size={56} />
                    <div className="min-w-0 flex-1">
                      <p className="text-caption font-medium text-primary">
                        {FAMILY_TEACHER_ROLE[teacher.role] ?? "Багш"}
                      </p>
                      <p className="text-body font-semibold text-ink">{fullName(teacher)}</p>
                    </div>
                  </div>
                  <dl>
                    <Fact label="Мэргэжил">{teacher.specialization || "—"}</Fact>
                    <Fact label="Төгссөн сургууль">{teacher.education || "—"}</Fact>
                    <Fact label="Утас">
                      {teacher.phone ? (
                        <a href={`tel:${teacher.phone}`} className="text-primary hover:underline">
                          {teacher.phone}
                        </a>
                      ) : (
                        "—"
                      )}
                    </Fact>
                    <Fact label="И-мэйл" last>
                      {teacher.email ? (
                        <a
                          href={`mailto:${teacher.email}`}
                          className="break-all text-primary hover:underline"
                        >
                          {teacher.email}
                        </a>
                      ) : (
                        "—"
                      )}
                    </Fact>
                  </dl>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function SectionTitle({ id, title }: { id: string; title: string }) {
  return (
    <h2 id={id} className="text-title font-semibold text-ink">
      {title}
    </h2>
  );
}

/** A table drawn like the rest of the child's tabs. */
function Table({
  caption,
  columns,
  children,
}: {
  caption: string;
  columns: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-[640px] border-collapse text-body">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-sunken text-left text-caption font-semibold text-muted">
            {columns.map((column) => (
              <th key={column} className="px-3 py-2">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** A label and its value, as the Ерөнхий tab draws them. */
function Fact({
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

/**
 * The current kindergarten. ESIS's own names lead where the archive carries
 * them (`current.esis`) — the ministry's name for the organisation and the
 * group, its level and its type — marked ЭСИС.
 */
function CurrentPlacementCard({ current }: { current: Current }) {
  const esis = current.esis ?? null;
  const facts: { label: string; value: ReactNode }[] = [
    {
      label: "Цэцэрлэг",
      value: esis?.organization.name ? (
        <>
          {esis.organization.name}
          <EsisTag />
        </>
      ) : (
        current.kindergarten.name
      ),
    },
    { label: "Хичээлийн жил", value: current.schoolYear?.name ?? esis?.group?.academicYear ?? "—" },
    {
      label: "Бүлэг",
      value: placementFacts(
        esis?.group?.name ?? current.group?.name,
        current.group?.ageBand,
        current.group?.childCount,
      ),
    },
  ];
  if (esis?.group?.academicLevelName) {
    facts.push({
      label: "Түвшин",
      value: (
        <>
          {esis.group.academicLevelName}
          <EsisTag />
        </>
      ),
    });
  }
  facts.push({ label: "Бүлэгт орсон огноо", value: formatDate(current.startedOn) });
  facts.push({
    label: "Байгууллагын төрөл",
    value: esis?.organization.institutionTypeName || "Цэцэрлэг",
  });
  if (current.kindergarten.capacity) {
    facts.push({ label: "Хүчин чадал", value: `${current.kindergarten.capacity} хүүхэд` });
  }
  if (current.kindergarten.groupCount) {
    facts.push({ label: "Нийт бүлэг", value: `${current.kindergarten.groupCount} бүлэг` });
  }
  const address = esis?.organization.address ?? current.kindergarten.address;
  if (address) facts.push({ label: "Хаяг", value: address });
  if (current.kindergarten.phone) {
    facts.push({
      label: "Утас",
      value: (
        <a href={`tel:${current.kindergarten.phone}`} className="text-primary hover:underline">
          {current.kindergarten.phone}
        </a>
      ),
    });
  }
  if (current.kindergarten.email)
    facts.push({ label: "И-мэйл", value: current.kindergarten.email });

  return (
    <Card pad="compact">
      <dl>
        {facts.map((fact, index) => (
          <Fact key={fact.label} label={fact.label} last={index === facts.length - 1}>
            {fact.value}
          </Fact>
        ))}
      </dl>
    </Card>
  );
}

function EsisTag() {
  return (
    <span className="ml-1.5 inline-flex rounded-pill bg-sky px-1.5 py-px align-middle text-caption font-semibold text-sky-ink">
      ЭСИС
    </span>
  );
}

/** Lower-cased and trimmed, for comparing a name ESIS typed with ours. */
function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("mn-MN").replace(/\s+/g, " ");
}

/**
 * ЭСИС дэх шилжилт — this child's own moves, as ESIS recorded them.
 *
 * ★ Only this child's — 2026-10-01. `studentMovements` answers for the whole
 * institution since a date, and the panel here used to print all of it: a
 * stranger's transfer under this child's history. The rows are now narrowed
 * to this child — by ESIS's `personId` when the child's регистр lets
 * `studentInfo` say which person they are, and otherwise by овог, нэр and
 * төрсөн огноо together.
 *
 * Read from the child's earliest placement (or birth), so the history is
 * whole. The ministry caps a read at 500 rows, well above one kindergarten's
 * moves. Staff only: neither service is on a guardian's list.
 */
function EsisMovements({
  child,
}: {
  child: {
    id: string;
    lastName: string;
    firstName: string;
    dateOfBirth?: string | null;
    nationalId?: string | null;
  };
}) {
  const beginDate = child.dateOfBirth?.slice(0, 10) ?? "2015-01-01";
  const movements = useEsisRows("studentMovements", { params: { beginDate } });
  const info = useEsisRows("studentInfo", { params: { personRegNumber: child.nationalId } });
  if (movements.isUnavailable) return null;

  const personId = info.rows[0]?.personId ?? null;
  const birth = child.dateOfBirth?.slice(0, 10) ?? null;
  const mine = movements.rows
    .filter((row) =>
      personId
        ? row.personId === personId
        : norm(row.lastName) === norm(child.lastName) &&
          norm(row.firstName) === norm(child.firstName) &&
          (!birth || (row.dateOfBirth ?? "").slice(0, 10) === birth),
    )
    .sort((a, b) => (b.actionDate ?? "").localeCompare(a.actionDate ?? ""));

  return (
    <section aria-labelledby="esis-movements-heading" className="flex flex-col gap-2">
      <h2 id="esis-movements-heading" className="text-title font-semibold text-ink">
        ЭСИС дэх шилжилт
        <EsisTag />
      </h2>
      {movements.isPending ? (
        <p className="text-body text-muted">ЭСИС-ээс уншиж байна…</p>
      ) : movements.isError ? (
        <p className="text-body text-muted">ЭСИС-ээс хариу ирсэнгүй.</p>
      ) : mine.length === 0 ? (
        <p className="text-body text-muted">ЭСИС-д энэ хүүхдийн шилжилт бүртгэгдээгүй.</p>
      ) : (
        <Table
          caption="ЭСИС дэх шилжилт"
          columns={["Огноо", "Үйлдэл", "Бүлэг", "Түвшин", "Хөтөлбөрийн төлөв"]}
        >
          {mine.map((row, index) => (
            <tr key={`${row.actionDate}-${index}`} className="border-t border-border-soft">
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                {row.actionDate ? row.actionDate.slice(0, 10) : "—"}
              </td>
              <td className="px-3 py-2 font-medium text-ink">{row.actionName || "—"}</td>
              <td className="px-3 py-2">{row.studentGroupName || "—"}</td>
              <td className="px-3 py-2">{row.academicLevelName || "—"}</td>
              <td className="px-3 py-2">{row.programStatusName || "—"}</td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}

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

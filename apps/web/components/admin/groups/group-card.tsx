"use client";

import Link from "next/link";
import { ChevronRight, TriangleAlert, UserPlus } from "lucide-react";
import { ATTENDANCE_FORM_LABEL, PROGRAM_KIND_LABEL, type GroupListItem } from "@kinder/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { shortName } from "@/lib/format";

/**
 * One group, as a card.
 *
 * ★ **The card body is the link and the teacher control is not.** A row that
 * navigates *and* carries a button that does not is the shape most likely to
 * take a director somewhere they did not press, so the two targets are drawn
 * apart: the whole upper block opens `/groups/:id`, and the assign control
 * sits below a divider with a label on it.
 *
 * ★★ The route is the **local** group id. `esisGroupId` is the ministry's key
 * for the same class and appears nowhere in a URL — every screen behind this
 * one (attendance, meals, assessment, the roster) resolves children through
 * `Enrollment`, which hangs off our own id.
 */
export function GroupCard({
  group,
  onManageTeachers,
}: {
  group: GroupListItem;
  onManageTeachers: () => void;
}) {
  const children = group._count?.enrollments ?? 0;
  const teachers = (group.teachers ?? []).filter((teacher) => !teacher.endedOn);
  const lead = teachers.find((teacher) => teacher.role === "LEAD") ?? teachers[0];
  const isArchived = group.status === "ARCHIVED";

  return (
    <article className="flex flex-col rounded-card border border-border bg-surface transition-colors hover:border-primary/40">
      <Link
        href={`/groups/${group.id}`}
        className="group/card flex flex-1 flex-col gap-3 p-4 outline-none focus-visible:rounded-card focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-lead font-semibold text-ink">{group.name}</h3>
            <p className="mt-0.5 text-body text-muted">
              <span className="tabular-nums text-ink">{children}</span> суралцагч
            </p>
          </div>
          <ChevronRight
            size={18}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-muted transition-transform group-hover/card:translate-x-0.5"
          />
        </div>

        {/*
          ★ The teacher is the fact this card exists to carry, so it gets a
          labelled block rather than a line of small print. "⚠ Тохируулаагүй"
          is amber, which the design direction reserves for something missing —
          and it is genuinely missing: a group with no assignment is a group no
          teacher can open, because `canAccessChild` resolves through exactly
          these rows.
        */}
        <div className="border-t border-border pt-3">
          {lead ? (
            <>
              <p className="text-caption text-muted">
                {lead.role === "ASSISTANT" ? "Туслах багш" : "Үндсэн багш"}
              </p>
              <p className="mt-0.5 truncate text-body text-ink">
                {shortName(lead.membership?.user)}
                {teachers.length > 1 ? (
                  <span className="text-muted"> +{teachers.length - 1}</span>
                ) : null}
              </p>
            </>
          ) : (
            <>
              <p className="text-caption text-muted">Багш</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-body text-sun-ink">
                <TriangleAlert size={15} aria-hidden="true" className="shrink-0" />
                Тохируулаагүй
              </p>
            </>
          )}
        </div>

        {/*
          Only the exceptions are badged. Most groups are main-programme and
          standard-hours, and two constant chips on every card teach the eye to
          skip the strip the exceptions live in.
        */}
        {isArchived || group.programKind === "ALTERNATIVE" || isSpecialForm(group) ? (
          <div className="flex flex-wrap gap-1.5">
            {isArchived ? <Badge tone="neutral">Архивласан</Badge> : null}
            {group.programKind === "ALTERNATIVE" ? (
              <Badge tone="sky">{PROGRAM_KIND_LABEL.ALTERNATIVE}</Badge>
            ) : null}
            {isSpecialForm(group) ? (
              <Badge tone="sun">{ATTENDANCE_FORM_LABEL[group.attendanceForm!]}</Badge>
            ) : null}
          </div>
        ) : null}
      </Link>

      <div className="border-t border-border p-2.5">
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          onClick={onManageTeachers}
          aria-label={`${group.name} — багш хуваарилах`}
        >
          <UserPlus size={16} aria-hidden />
          {lead ? "Багш өөрчлөх" : "Багш хуваарилах"}
        </Button>
      </div>
    </article>
  );
}

const isSpecialForm = (group: GroupListItem): boolean =>
  Boolean(group.attendanceForm && group.attendanceForm !== "STANDARD");

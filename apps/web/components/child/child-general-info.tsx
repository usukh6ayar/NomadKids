"use client";

import { GraduationCap, Mail, Phone, UserPlus } from "lucide-react";
import {
  GUARDIAN_RELATION_LABEL,
  type ChildDetail,
  ENROLLMENT_STATUS_LABEL,
  ENROLLMENT_STATUS_TONE,
} from "@kinder/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { GuardianAccessButton } from "@/components/child/guardian-access-button";
import { InviteGuardianDialog } from "@/components/child/invite-guardian-dialog";
import { excerpt, formatDate, fullName } from "@/lib/format";

/**
 * The "Ерөнхий" tab: who this child belongs to, and where they have been.
 *
 * ★ Everything here comes from the single `GET /children/:id` the page already
 * made. No second request — guardianships and enrollments travel with the
 * detail response, which is why this component takes data rather than fetching.
 */
export function ChildGeneralInfo({
  child,
  childId,
  isStaff,
}: {
  child: ChildDetail;
  childId: string;
  /** Guardian contact details and health notes are staff-only. */
  isStaff: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      {isStaff ? <Guardians child={child} childId={childId} /> : null}

      <Enrollments child={child} />

      {/*
        Health notes are staff-only and deliberately last: important, but not
        what anyone opens this page for. The hero carries a badge saying there
        is something here, so it does not have to be found by scrolling.
      */}
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
    </div>
  );
}

/**
 * The family.
 *
 * ★ Revoked guardians stay on the list rather than disappearing from it.
 *
 * Hiding them made a revocation look like a deletion and left staff no way back
 * when a situation reversed — and no way to see that the reason a parent cannot
 * open the child is a decision someone made.
 */
function Guardians({ child, childId }: { child: ChildDetail; childId: string }) {
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

  return (
    <section aria-label="Асран хамгаалагч">
      <SectionHeader
        title="Асран хамгаалагч"
        lede="Энэ хүүхдийн хавтсыг харах эрхтэй хүмүүс."
        action={child.guardianships.length > 0 ? invite : undefined}
      />

      {child.guardianships.length === 0 ? (
        <EmptyState
          title="Асран хамгаалагч холбогдоогүй байна"
          description="Эцэг эх урьсны дараа тэд хүүхдийнхээ хавтсыг гар утаснаасаа харах боломжтой болно."
          action={invite}
        />
      ) : (
        <Card className="divide-y divide-border">
          {child.guardianships.map((guardianship) => {
            const revoked = guardianship.canView === false;
            const contacts = [guardianship.guardian?.phone, guardianship.guardian?.email].filter(
              Boolean,
            );

            return (
              <div
                key={guardianship.id}
                className="flex min-h-[64px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p
                      className={`min-w-0 truncate font-medium ${
                        revoked ? "text-muted line-through" : "text-ink"
                      }`}
                    >
                      {fullName(guardianship.guardian)}
                    </p>
                    <Badge tone="neutral">
                      {GUARDIAN_RELATION_LABEL[guardianship.relation] ?? guardianship.relation}
                    </Badge>
                    {revoked ? <Badge tone="neutral">Хураасан</Badge> : null}
                    {guardianship.isPrimary && !revoked ? (
                      <Badge tone="primary">Үндсэн</Badge>
                    ) : null}
                  </div>

                  {contacts.length > 0 ? (
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-body text-muted">
                      {guardianship.guardian?.phone ? (
                        // `tel:` and `mailto:` rather than plain text — a
                        // teacher reaching for a parent's number is on a phone.
                        <a
                          href={`tel:${guardianship.guardian.phone}`}
                          className="flex min-h-[24px] items-center gap-1.5 hover:text-primary-strong"
                        >
                          <Phone size={14} aria-hidden="true" />
                          {guardianship.guardian.phone}
                        </a>
                      ) : null}
                      {guardianship.guardian?.email ? (
                        <a
                          href={`mailto:${guardianship.guardian.email}`}
                          className="flex min-h-[24px] min-w-0 items-center gap-1.5 hover:text-primary-strong"
                        >
                          <Mail size={14} aria-hidden="true" />
                          <span className="truncate">{guardianship.guardian.email}</span>
                        </a>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-1 text-body text-muted">Холбоо барих мэдээлэл алга</p>
                  )}
                </div>

                <GuardianAccessButton
                  guardianshipId={guardianship.id}
                  childId={childId}
                  guardianName={fullName(guardianship.guardian)}
                  canView={!revoked}
                />
              </div>
            );
          })}
        </Card>
      )}
    </section>
  );
}

/**
 * Where this child has been.
 *
 * ★ "Current" is `status === "ACTIVE"`, not "first in the list".
 *
 * The API orders enrollments `startedOn: "desc"`, so the newest is first — and
 * for a child who has left, the newest is an ENDED one. Reading position as
 * state would label their last year as the year they are in.
 */
function Enrollments({ child }: { child: ChildDetail }) {
  const enrollments = child.enrollments ?? [];

  return (
    <section aria-label="Бүртгэлийн түүх">
      <SectionHeader title="Бүртгэлийн түүх" lede="Хамрагдсан бүлэг, хичээлийн жилүүд." />

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
            const period = [
              formatDate(enrollment.startedOn),
              enrollment.endedOn ? formatDate(enrollment.endedOn) : null,
            ]
              .filter(Boolean)
              .join(" — ");

            return (
              <div
                key={enrollment.id ?? `${enrollment.schoolYear?.id}-${index}`}
                className="flex min-h-[60px] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">
                    {enrollment.group?.name ?? "Бүлэг тодорхойгүй"}
                  </p>
                  <p className="truncate text-body text-muted">
                    {[enrollment.schoolYear?.name, period || null].filter(Boolean).join(" · ") ||
                      "Хугацаа тэмдэглэгдээгүй"}
                  </p>
                </div>

                {active ? (
                  <Badge tone="mint">{ENROLLMENT_STATUS_LABEL.ACTIVE}</Badge>
                ) : (
                  <Badge tone={ENROLLMENT_STATUS_TONE[enrollment.status ?? "ENDED"] ?? "neutral"}>
                    {ENROLLMENT_STATUS_LABEL[enrollment.status ?? "ENDED"] ??
                      ENROLLMENT_STATUS_LABEL.ENDED}
                  </Badge>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </section>
  );
}

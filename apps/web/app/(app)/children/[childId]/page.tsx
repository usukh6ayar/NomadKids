"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BookOpen, FileText, Pencil, Plus, UserPlus } from "lucide-react";
import { z } from "zod";
import {
  assessmentSchema,
  childDetailSchema,
  observationSchema,
  paginated,
  GUARDIAN_RELATION_LABEL,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ChildHeader } from "@/components/child/child-header";
import { InviteGuardianDialog } from "@/components/child/invite-guardian-dialog";
import { ReportDialog } from "@/components/reports/report-dialog";
import { ObservationRow } from "@/components/observations/observation-row";
import { excerpt, fullName } from "@/lib/format";

const observationsSchema = paginated(observationSchema);
const assessmentsSchema = z.array(assessmentSchema);

/**
 * The child hub.
 *
 * ★ One screen, one primary job: *understand this child and act on them*. Both
 * audiences land here, and the data is the same request — the API filters it by
 * who is asking, so a parent's `observations` simply does not contain private
 * teaching notes. What differs is the affordances: a teacher gets "record an
 * observation" and the review state; a parent gets the portfolio and the PDF.
 *
 * Not tabs. On a phone a tab bar hides two thirds of the screen behind taps,
 * and this page is short enough to scroll — recent observations and the current
 * assessment are what someone came for, in that order.
 */
export default function ChildDetailPage() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;
  const { hasRole } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  const observations = useQuery({
    queryKey: qk.childObservations(childId, { pageSize: 5 }),
    queryFn: () => get(`/children/${childId}/observations?page=1&pageSize=5`, observationsSchema),
    enabled: child.isSuccess,
  });

  const assessments = useQuery({
    queryKey: qk.childAssessments(childId),
    queryFn: () => get(`/children/${childId}/assessments`, assessmentsSchema),
    enabled: child.isSuccess,
  });

  if (child.isLoading) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <LoadingState rows={4} />
      </div>
    );
  }

  if (child.isError) {
    // 404 covers both "no such child" and "not yours" — the API refuses to
    // distinguish them, and so does this. Saying "танд эрх байхгүй" would leak
    // through the UI exactly what the API works to hide.
    return (
      <div className="py-6">
        <ErrorState
          title={isNotFound(child.error) ? "Олдсонгүй" : "Алдаа гарлаа"}
          description={
            isNotFound(child.error) ? "Энэ хүүхдийн мэдээлэл олдсонгүй." : errorMessage(child.error)
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

  const data = child.data!;

  return (
    <div className="flex flex-col gap-6 py-2">
      <ChildHeader
        child={data}
        actions={
          <>
            {isStaff ? (
              <Button asChild size="sm">
                <Link href={`/children/${childId}/observations/new`}>
                  <Plus size={18} />
                  Ажиглалт
                </Link>
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link href={`/children/${childId}/observations/new`}>
                  <Plus size={18} />
                  Хуваалцах
                </Link>
              </Button>
            )}

            <Button asChild variant="secondary" size="sm">
              <Link href={`/children/${childId}/portfolio`}>
                <BookOpen size={18} />
                Хавтас
              </Link>
            </Button>

            {isStaff ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/children/${childId}/edit`}>
                  <Pencil size={18} />
                  Засах
                </Link>
              </Button>
            ) : null}

            <ReportDialog
              childId={childId}
              trigger={
                <Button variant="secondary" size="sm">
                  <FileText size={18} />
                  PDF
                </Button>
              }
            />
          </>
        }
      />

      {/* ── Development summary ─────────────────────────────────────────── */}
      <section aria-labelledby="assessment-heading">
        <SectionHeader title="Хөгжлийн үнэлгээ" />

        {assessments.isLoading ? (
          <LoadingState rows={1} />
        ) : assessments.isError ? (
          <ErrorState description={errorMessage(assessments.error)} />
        ) : (assessments.data?.length ?? 0) === 0 ? (
          <EmptyState
            title="Үнэлгээ хараахан алга"
            description={
              isStaff
                ? "Бүлгийн үнэлгээний дэлгэцээс энэ улирлын үнэлгээг оруулна уу."
                : "Багш үнэлгээг нийтлэхэд энд харагдана."
            }
          />
        ) : (
          <Card className="divide-y divide-border">
            {assessments.data!.map((assessment) => (
              <div
                key={assessment.id}
                className="flex min-h-[56px] flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{assessment.domain?.name ?? "—"}</p>
                  {assessment.term ? (
                    <p className="text-xs text-muted">{assessment.term.name}</p>
                  ) : null}
                </div>
                {/*
                  The level's label always shows. Its colour is a hint on top of
                  the words, never the only way to read the value.
                */}
                <Badge tone="sky">{assessment.level?.label ?? "—"}</Badge>
              </div>
            ))}
          </Card>
        )}
      </section>

      {/* ── Recent observations ─────────────────────────────────────────── */}
      <section aria-labelledby="observations-heading">
        <SectionHeader title={isStaff ? "Сүүлийн ажиглалт" : "Сүүлийн мөчүүд"} />

        {observations.isLoading ? (
          <LoadingState rows={3} />
        ) : observations.isError ? (
          <ErrorState description={errorMessage(observations.error)} />
        ) : (observations.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title={isStaff ? "Ажиглалт бичигдээгүй байна" : "Одоогоор мөч хуваалцаагүй байна"}
            description={
              isStaff
                ? "Энэ хүүхдийн талаар анхны ажиглалтаа бичнэ үү."
                : "Багшийн хуваалцсан ажиглалт энд харагдана."
            }
            action={
              <Button asChild>
                <Link href={`/children/${childId}/observations/new`}>
                  {isStaff ? "Ажиглалт бичих" : "Мөч хуваалцах"}
                </Link>
              </Button>
            }
          />
        ) : (
          <Card className="divide-y divide-border">
            {observations.data!.items.map((observation) => (
              <ObservationRow
                key={observation.id}
                observation={observation}
                showVisibility={isStaff}
              />
            ))}
          </Card>
        )}
      </section>

      {/* ── Guardians — staff only ──────────────────────────────────────── */}
      {isStaff && data.guardianships.length > 0 ? (
        <section aria-labelledby="guardians-heading">
          <SectionHeader
            title="Асран хамгаалагч"
            action={
              isStaff ? (
                <InviteGuardianDialog
                  childId={childId}
                  childName={fullName(data)}
                  trigger={
                    <Button variant="secondary" size="sm">
                      <UserPlus size={18} />
                      Урих
                    </Button>
                  }
                />
              ) : null
            }
          />
          <Card className="divide-y divide-border">
            {data.guardianships
              .filter((g) => g.canView !== false)
              .map((guardianship) => (
                <div
                  key={guardianship.id}
                  className="flex min-h-[56px] items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">
                      {fullName(guardianship.guardian)}
                    </p>
                    <p className="truncate text-sm text-muted">
                      {[
                        GUARDIAN_RELATION_LABEL[guardianship.relation] ?? guardianship.relation,
                        guardianship.guardian?.phone,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  {guardianship.isPrimary ? <Badge tone="primary">Үндсэн</Badge> : null}
                </div>
              ))}
          </Card>
        </section>
      ) : null}

      {/* Health notes are staff-only and deliberately last: important, but not
          what anyone opens this page for. */}
      {isStaff && data.healthNotes ? (
        <section aria-labelledby="health-heading">
          <SectionHeader title="Эрүүл мэндийн тэмдэглэл" />
          <Card className="px-4 py-3.5">
            <p className="whitespace-pre-wrap text-sm text-ink">{excerpt(data.healthNotes, 500)}</p>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BookOpen, ClipboardList, FileText, Pencil, Plus } from "lucide-react";
import { childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ChildAssessments } from "@/components/child/child-assessments";
import { ChildGeneralInfo } from "@/components/child/child-general-info";
import { ChildHeroProfile } from "@/components/child/child-hero-profile";
import { ChildTabs } from "@/components/child/child-tabs";
import { ChildObservations } from "@/components/child/child-observations";
import { ChildGallery } from "@/components/media/child-gallery";
import { ReportDialog } from "@/components/reports/report-dialog";
import { fullName } from "@/lib/format";

const GENERAL = "general";
const OBSERVATIONS = "observations";
const ASSESSMENTS = "assessments";
const GALLERY = "gallery";

/**
 * The child hub.
 *
 * ★ One screen, one primary job: *understand this child and act on them*. Both
 * audiences land here, and the data is the same request — the API filters it by
 * who is asking, so a parent's `observations` simply does not contain private
 * teaching notes. What differs is the affordances: a teacher gets "record an
 * observation" and the review state; a parent gets the portfolio and the PDF.
 *
 * ★★ Tabs since 2026-08-23, on the client's instruction.
 *
 * This page previously scrolled, deliberately — the note that was here argued
 * that a tab bar hides most of a record behind taps on a phone, and that is
 * still true. The client asked for tabs and that is their decision; what this
 * implementation does about the cost is put the tab in the URL and load each
 * panel only when it is opened. See `child-tabs.tsx`.
 *
 * ★★★ This file assembles; it does not render. The hero, each panel and the tab
 * strip are their own components under `components/child/`, and the only things
 * that belong to the page are the identity request every panel depends on and
 * the decision about who is looking.
 */
export default function ChildDetailPage() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;
  const { hasRole, session } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  if (child.isPending) {
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

  const data = child.data;

  // Relationship, not role: a parent who is also a teacher elsewhere is still
  // this child's guardian, and a revoked guardianship is not one.
  const isGuardian = data.guardianships.some(
    (g) => g.guardian?.id === session?.user.id && g.canView !== false,
  );

  /*
   * ★ Each panel fetches only once its tab is open, and nothing here arranges
   * that.
   *
   * Radix unmounts an inactive `Tabs.Content`, so a panel's component — and its
   * query — does not exist until someone opens it. The page used to fire the
   * observation and assessment requests on mount, which was right when
   * everything was on one scroll; behind tabs it would be three requests to
   * render one panel, on a phone, on a connection this product is explicitly
   * built for.
   *
   * An earlier version of this file passed each panel an `enabled` prop derived
   * from `?tab=` here. It was redundant — and worse than redundant: the tab
   * strip derives the same fact from the same parameter, and two independent
   * derivations of one truth are two things that can disagree. `flows.test.tsx`
   * pins the behaviour so that adding `forceMount` later fails loudly instead
   * of quietly making every tab fetch on mount.
   */

  return (
    <div className="flex flex-col gap-6 py-2">
      <ChildHeroProfile
        child={data}
        showHealthAlert={isStaff}
        actions={
          <>
            <Button asChild size="sm">
              <Link href={`/children/${childId}/observations/new`}>
                <Plus size={18} />
                {isStaff ? "Ажиглалт" : "Хуваалцах"}
              </Link>
            </Button>

            {/*
              The gallery is a tab now, but `/portfolio` is not a duplicate of
              it: that screen also carries "Миний тухай", the age profiles and
              the birthday notes, which the tab does not. It stays, and this
              button keeps pointing at it.
            */}
            <Button asChild variant="secondary" size="sm">
              <Link href={`/children/${childId}/portfolio`}>
                <BookOpen size={18} />
                Хавтас
              </Link>
            </Button>

            {/*
              Both roles, one route: a teacher writes the report and a family
              reads it once finalised. The API filters a guardian to FINAL, so
              the same URL is safe for either.
            */}
            <Button asChild variant="secondary" size="sm">
              <Link href={`/children/${childId}/term-report`}>
                <ClipboardList size={18} />
                Улирлын тайлан
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

      <ChildTabs
        tabs={[
          {
            value: GENERAL,
            label: "Ерөнхий",
            content: <ChildGeneralInfo child={data} childId={childId} isStaff={isStaff} />,
          },
          {
            value: OBSERVATIONS,
            label: "Ажиглалт",
            content: <ChildObservations childId={childId} isStaff={isStaff} />,
          },
          {
            value: ASSESSMENTS,
            label: "Үнэлгээ",
            content: <ChildAssessments childId={childId} isStaff={isStaff} />,
          },
          {
            value: GALLERY,
            label: "Цомог",
            content:
              (
                /*
                 * `canEdit` is a relationship, not a role: a guardian may add to
                 * their own child's album, and a revoked one may not. The same
                 * derivation as `/portfolio`, which is the other way into this
                 * grid.
                 */
                <ChildGallery
                  childId={childId}
                  childName={fullName(data)}
                  canEdit={isStaff || isGuardian}
                  photoMediaFileId={data.photoMediaFileId}
                />
              ),
          },
        ]}
      />
    </div>
  );
}

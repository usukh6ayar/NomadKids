"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BookOpen, ClipboardList, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ChildAssessments } from "@/components/child/child-assessments";
import { ChildAttendance } from "@/components/child/child-attendance";
import { ChildGrowth } from "@/components/child/child-growth";
import { ChildHealth } from "@/components/child/child-health";
import { ChildIncidents } from "@/components/child/child-incidents";
import { ChildArtwork } from "@/components/child/child-artwork";
import { ChildGeneralInfo } from "@/components/child/child-general-info";
import { ChildHeroProfile } from "@/components/child/child-hero-profile";
import { ChildMenu } from "@/components/child/child-menu";
import { ChildTabs } from "@/components/child/child-tabs";
import { ChildObservations } from "@/components/child/child-observations";
import { ChildGallery } from "@/components/media/child-gallery";
import { fullName } from "@/lib/format";
import { GALLERY as GALLERY_LABEL, PORTFOLIO } from "@/lib/vocabulary";

const GENERAL = "general";
const OBSERVATIONS = "observations";
const ASSESSMENTS = "assessments";
const ATTENDANCE = "attendance";
const MENU = "menu";
const GROWTH = "growth";
const HEALTH = "health";
const INCIDENTS = "incidents";
const ARTWORK = "artwork";
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
        actions={<ChildActions childId={childId} isStaff={isStaff} />}
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
            value: ATTENDANCE,
            label: "Ирц",
            content: <ChildAttendance childId={childId} isStaff={isStaff} />,
          },
          {
            value: GROWTH,
            label: "Өсөлт",
            content: <ChildGrowth childId={childId} isStaff={isStaff} />,
          },
          {
            value: HEALTH,
            label: "Эрүүл мэнд",
            content: <ChildHealth childId={childId} isStaff={isStaff} />,
          },
          {
            value: INCIDENTS,
            label: "Аюулгүй байдал",
            content: <ChildIncidents childId={childId} isStaff={isStaff} />,
          },
          {
            value: ARTWORK,
            label: "Бүтээл",
            content: <ChildArtwork childId={childId} isStaff={isStaff} />,
          },
          {
            value: MENU,
            label: "Хоол ба цэс",
            content: (
              <ChildMenu
                kindergartenId={data.kindergarten?.id ?? ""}
                healthNotes={data.healthNotes}
                isStaff={isStaff}
              />
            ),
          },
          {
            value: GALLERY,
            label: GALLERY_LABEL,
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

/**
 * What you can do to this child, in order of how often you do it.
 *
 * ★ This row was five buttons, four of them identical white pills.
 *
 * `[+ Ажиглалт] [Хавтас] [Улирлын тайлан] [Засах] [PDF]` — one primary and four
 * secondaries at the same size, weight and colour, wrapping to three rows at
 * 375px and filling most of the first screen with undifferentiated controls.
 * Five equal targets means the primary action is found by reading rather than
 * by looking, which is Hick's law charging for a decision nobody wanted to make.
 *
 * Two of them also overlapped: **Улирлын тайлан** opened the term report and
 * **PDF** generated one, and the row gave no way to tell which produced the
 * document.
 *
 * Now: the action, the destination, and everything else behind one control.
 *
 * ★★ PDF moved to the portfolio rather than into the menu.
 *
 * The report's type is `CHILD_PORTFOLIO` — it exports the RFP §4 record, which
 * has its own screen. "Export this" belongs on the thing being exported, and
 * that placement also ends the collision with the term report: two documents,
 * two screens, one button each.
 *
 * ★★★ A menu is only a menu when it holds more than one thing.
 *
 * Staff overflow two entries; a family overflows one, and a menu that opens to
 * reveal a single item is a worse button. So the last slot renders as a menu or
 * as a button depending on what is in it, and both audiences see exactly three
 * controls.
 */
function ChildActions({ childId, isStaff }: { childId: string; isStaff: boolean }) {
  // Both roles, one route: a teacher writes the report and a family reads it
  // once finalised. The API filters a guardian to FINAL, so the URL is safe for
  // either.
  const overflow: MenuItem[] = [
    {
      href: `/children/${childId}/term-report`,
      label: "Улирлын тайлан",
      hint: "Улирлын үнэлгээ, багшийн дүгнэлт.",
      icon: <ClipboardList size={18} aria-hidden="true" />,
    },
    ...(isStaff
      ? [
          {
            href: `/children/${childId}/edit`,
            label: "Мэдээлэл засах",
            hint: "Нэр, төрсөн огноо, бүлгийн бүртгэл.",
            icon: <Pencil size={18} aria-hidden="true" />,
          },
        ]
      : []),
  ];

  return (
    <>
      <Button asChild size="sm">
        <Link href={`/children/${childId}/observations/new`}>
          <Plus size={18} />
          {isStaff ? "Ажиглалт" : "Хуваалцах"}
        </Link>
      </Button>

      {/*
        The album is a tab on this page, but `/portfolio` is not a duplicate of
        it: that screen also carries "Миний тухай", the age profiles and the
        birthday notes, which the tab does not.
      */}
      <Button asChild variant="secondary" size="sm">
        <Link href={`/children/${childId}/portfolio`}>
          <BookOpen size={18} />
          {PORTFOLIO}
        </Link>
      </Button>

      {overflow.length > 1 ? (
        <Menu
          variant="secondary"
          ariaLabel="Бусад үйлдэл"
          items={overflow}
          // Icon-only: the standard overflow affordance, and the row has to
          // survive 375px. The name is `sr-only` rather than absent, so the
          // trigger is announced as something other than "button".
          label={
            <>
              <MoreHorizontal size={18} aria-hidden="true" />
              <span className="sr-only">Бусад үйлдэл</span>
            </>
          }
        />
      ) : (
        <Button asChild variant="secondary" size="sm">
          <Link href={overflow[0]!.href}>
            <ClipboardList size={18} />
            {overflow[0]!.label}
          </Link>
        </Button>
      )}
    </>
  );
}

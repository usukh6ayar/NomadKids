"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ClipboardList, FolderOpen, MoreHorizontal, Pencil } from "lucide-react";
import { childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ChildGrowth } from "@/components/child/child-growth";
import { ChildHealth } from "@/components/child/child-health";
import { ChildGeneralInfo } from "@/components/child/child-general-info";
import { ChildHeroProfile } from "@/components/child/child-hero-profile";
import { ChildTabs } from "@/components/child/child-tabs";
import { ChildEnrollmentArchive } from "@/components/child/enrollment-archive";

const GENERAL = "general";
const GROWTH = "growth";
const HEALTH = "health";
/**
 * ★ "Шилжилт хөдөлгөөн" — added 2026-09-04 at the client's request.
 *
 * The placement history already existed at `/children/:id/enrollment-archive`,
 * which a parent reached from their home tile and staff reached only by typing
 * the URL. Making it a tab puts it where somebody looking at a child actually
 * is. `ChildEnrollmentArchive` is the same component the route renders, with
 * its hero suppressed — the name is already above this strip.
 */
const PLACEMENT = "placement";

/**
 * The child's record — identity, actions, and the "Ерөнхий" panel.
 *
 * ★ Replaces the old child hub (`children/[childId]/page.tsx`). Ажиглалт and
 * Зураг moved to their own routes (`/observations`, `/overview`) — same "one
 * destination, not a route and a tab both showing the same thing" reasoning
 * `/attendance` and `/menu` already followed elsewhere in this directory.
 * Growth and health have no outside link pointing at them
 * directly, so they stay here behind "Бусад" rather than becoming routes too.
 *
 * ★★ Artwork left the same way 2026-08-29: the portfolio's own "Хөгжил" page
 * (`portfolio/growth/page.tsx`) now links to it directly, so by this file's
 * own rule above it stopped belonging behind "Бусад" here and moved to be
 * that page's "Бүтээл" tab instead.
 *
 * This is what "Хүүхдийн бүртгэл" now means — every other per-child page's
 * back button points here.
 */
export default function ChildGeneralPage() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;
  const { hasRole } = useSession();
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
    // distinguish them, and so does this.
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

  return (
    <div className="flex flex-col gap-6 py-2">
      {/*
        Reached from the sidebar or from another child page's own back
        button — never by drilling down from within this child's own record,
        which is why this points up to the roster rather than to a sibling
        page the way theirs point here.
      */}
      <BackButton href="/children" />

      <ChildHeroProfile
        child={data}
        showHealthAlert={isStaff}
        canEditPhoto
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
            value: GROWTH,
            label: "Өсөлт",
            content: (
              <ChildGrowth
                childId={childId}
                isStaff={isStaff}
                dateOfBirth={data.dateOfBirth}
                currentSchoolYear={
                  data.enrollments.find((enrollment) => enrollment.status === "ACTIVE")?.schoolYear
                    ?.name
                }
              />
            ),
          },
          {
            value: HEALTH,
            label: "Эрүүл мэнд",
            content: (
              <ChildHealth
                childId={childId}
                isStaff={isStaff}
                dateOfBirth={data.dateOfBirth}
                currentSchoolYear={
                  data.enrollments.find((enrollment) => enrollment.status === "ACTIVE")?.schoolYear
                    ?.name
                }
              />
            ),
          },
          {
            value: PLACEMENT,
            label: "Суралцсан түүх",
            content: (
              <ChildEnrollmentArchive
                childId={childId}
                showHero={false}
                dateOfBirth={data.dateOfBirth}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

/** Profile actions shared by parent and staff views. */
function ChildActions({ childId, isStaff }: { childId: string; isStaff: boolean }) {
  const overflow: MenuItem[] = isStaff
    ? [
        {
          href: `/children/${childId}/edit`,
          label: "Мэдээлэл засах",
          hint: "Нэр, төрсөн огноо, бүлгийн бүртгэл.",
          icon: <Pencil size={18} aria-hidden="true" />,
        },
      ]
    : [];

  return (
    <>
      {isStaff ? (
        <Button asChild size="sm">
          <Link href={`/children/${childId}/portfolio`}>
            <FolderOpen size={18} aria-hidden="true" />
            Цахим хувийн хавтас
          </Link>
        </Button>
      ) : null}

      <Button asChild variant="secondary" size="sm">
        <Link href={`/children/${childId}/term-report`}>
          <ClipboardList size={18} />
          Улирлын тайлан
        </Link>
      </Button>

      {overflow.length > 0 ? (
        <Menu
          variant="secondary"
          ariaLabel="Бусад үйлдэл"
          items={overflow}
          label={
            <>
              <MoreHorizontal size={18} aria-hidden="true" />
              <span className="sr-only">Бусад үйлдэл</span>
            </>
          }
        />
      ) : null}
    </>
  );
}

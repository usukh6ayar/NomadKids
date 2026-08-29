"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, BookOpen, ClipboardList, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ChildGrowth } from "@/components/child/child-growth";
import { ChildHealth } from "@/components/child/child-health";
import { ChildIncidents } from "@/components/child/child-incidents";
import { ChildArtwork } from "@/components/child/child-artwork";
import { ChildGeneralInfo } from "@/components/child/child-general-info";
import { ChildHeroProfile } from "@/components/child/child-hero-profile";
import { ChildTabs } from "@/components/child/child-tabs";
import { PORTFOLIO } from "@/lib/vocabulary";

const GENERAL = "general";
const GROWTH = "growth";
const HEALTH = "health";
const INCIDENTS = "incidents";
const ARTWORK = "artwork";

/**
 * The child's record — identity, actions, and the "Ерөнхий" panel.
 *
 * ★ Replaces the old child hub (`children/[childId]/page.tsx`). Ажиглалт and
 * Зураг moved to their own routes (`/observations`, `/overview`) — same "one
 * destination, not a route and a tab both showing the same thing" reasoning
 * `/attendance` and `/menu` already followed elsewhere in this directory.
 * Growth, health, incidents and artwork have no outside link pointing at them
 * directly, so they stay here behind "Бусад" rather than becoming routes too.
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
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href="/children">
          <ArrowLeft size={18} />
          Хүүхдийн жагсаалт
        </Link>
      </Button>

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
        ]}
      />
    </div>
  );
}

/** Unchanged from the old hub — see git history for `children/[childId]/page.tsx`. */
function ChildActions({ childId, isStaff }: { childId: string; isStaff: boolean }) {
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

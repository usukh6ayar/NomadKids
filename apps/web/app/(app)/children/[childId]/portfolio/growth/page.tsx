"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { childDetailSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ParentGrowthLauncher } from "@/components/child/parent-growth-launcher";
import { PORTFOLIO } from "@/lib/vocabulary";

/**
 * «Явцын үнэлгээ» — the portfolio hub's second door.
 *
 * ★ One page for everybody — client, 2026-10-07: a teacher opening a
 * child's «Цахим хувийн хавтас» should see exactly what the family sees.
 * It used to give staff a page of its own — a hero card and three tabs,
 * «Насны онцлог» (`ChildGrowthAges`, every age-profile field in an
 * accordion), «Ажиглалт» and «Бүтээл».
 *
 * ★★ Read-only for staff. The client's reason the teacher's editor could go:
 * "багш тэмдэглэлийг цахим хувийн хавтас дээр бичихгүй учир нь явцын үнэлгээ
 * дээрээ багш бичээд шууд автоматаар энэ хэсэгт орно". A teacher writes
 * observations where they always have, and those are the «Багшийн
 * тэмдэглэл» this page lists; the family's quick-share form posts to the
 * guardian-only `/parent-observations`, so it is not offered to staff.
 *
 * Nothing stored is touched: `teacherNote` and the other fields only the
 * accordion edited stay in the database and in the PDF.
 */
export default function GrowthPage() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;
  const { hasRole } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  if (child.isLoading) return <LoadingState rows={4} />;

  if (child.isError) {
    return (
      <div className="py-6">
        <ErrorState
          title={isNotFound(child.error) ? "Олдсонгүй" : "Алдаа гарлаа"}
          description={
            isNotFound(child.error) ? `${PORTFOLIO} олдсонгүй.` : errorMessage(child.error)
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

  return (
    <div className="flex flex-col gap-6 py-2">
      <PageHeader backHref={`/children/${childId}/portfolio`} title="Явцын үнэлгээ" />

      <ParentGrowthLauncher child={child.data!} readOnly={isStaff} />
    </div>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { FileText, GraduationCap, HardDrive, Heart, School, Users } from "lucide-react";
import { adminDashboardSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { RequireRole } from "@/components/shell/require-role";
import {
  AssessmentCoverageSection,
  RecentActivitySection,
} from "@/components/admin/dashboard-sections";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { formatFileSize } from "@/lib/format";
import { StatCard } from "@/components/ui/stat-card";

/**
 * Administration.
 *
 * ★ Only what the API actually implements is linked from here.
 *
 * The brief is explicit about no dead navigation, and the temptation on an
 * admin screen is to lay out the whole eventual product — user management,
 * kindergarten settings, domain and level configuration — and wire the links
 * later. Every link here goes somewhere that exists today.
 *
 * ★ The configuration tables were the one exception until 2026-08-25: they had
 * a complete, tested CRUD API and no screen, so they were left unlinked rather
 * than linked and empty. `/admin/assessment-config` is that screen, and RFP
 * §6.1 and §6.2 are the reason CLAUDE.md §2.3 made them tables in the first
 * place — an administrator who cannot edit them is the requirement unmet.
 */
export default function AdminPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <AdminDashboard />
    </RequireRole>
  );
}

function AdminDashboard() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.dashboard.admin(),
    queryFn: () => get("/dashboard/admin", adminDashboardSchema),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-5 py-2">
        <h1 className="text-heading font-semibold text-ink">Удирдлага</h1>
        <LoadingState rows={4} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-2">
        <h1 className="mb-4 text-heading font-semibold text-ink">Удирдлага</h1>
        <ErrorState
          description={errorMessage(error)}
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Дахин оролдох
            </Button>
          }
        />
      </div>
    );
  }

  const { counts, assessmentCoverage, recentActivity, currentTerm, storage } = data!;

  return (
    <div className="flex flex-col gap-6 py-2">
      <header>
        <h1 className="text-heading font-semibold text-ink">Удирдлага</h1>
        <p className="mt-0.5 text-body text-muted">
          {currentTerm ? `${currentTerm.name} · идэвхтэй улирал` : "Идэвхтэй улирал тохируулаагүй"}
        </p>
      </header>

      {/*
        ★ RFP §12.2, and the one screen in this product where a big figure is
        the content rather than context.

        The teacher's dashboard deliberately keeps its counts small — its own
        note argues that "a dashboard whose largest elements are four numbers
        teaches a teacher to read numbers rather than to act", and that is right
        for someone whose next action is with a child. An administrator's job
        *is* the aggregate: how many children, how much storage, how many
        reports. So the figures are large here and nowhere else.

        `art` is a slot. These are lucide glyphs until the illustrated icons
        arrive; swapping them is a change at this call site.
      */}
      <section aria-label="Товч мэдээлэл" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard
          label="Нийт хүүхэд"
          value={counts.children}
          unit="хүүхэд"
          size="wide"
          tone="cornflower"
          art={<Users size={40} aria-hidden />}
        />
        <StatCard
          label="Бүлэг"
          value={counts.groups}
          tone="mint"
          art={<School size={28} aria-hidden />}
        />
        <StatCard
          label="Багш, ажилтан"
          value={counts.staff}
          tone="sky"
          art={<GraduationCap size={28} aria-hidden />}
        />
        <StatCard
          label="Эцэг эх"
          value={counts.guardians}
          tone="peach"
          art={<Heart size={28} aria-hidden />}
        />

        {/*
          Absent rather than zero when the API has not sent it: an older
          response has no `storage` key, and "0 MB" would be a claim about the
          bucket rather than a slower card.
        */}
        {storage ? (
          <>
            <StatCard
              label="Хадгалсан файл"
              value={formatFileSize(storage.totalBytes)}
              unit={`${storage.fileCount} файл`}
              tone="teal"
              art={<HardDrive size={28} aria-hidden />}
            />
            <StatCard
              label="Тайлан"
              value={storage.reports.done}
              unit={
                storage.reports.failed > 0
                  ? `${storage.reports.total} нийт · ${storage.reports.failed} амжилтгүй`
                  : `${storage.reports.total} нийт`
              }
              tone="sun"
              art={<FileText size={28} aria-hidden />}
            />
          </>
        ) : null}
      </section>

      {/*
        The admin's actual work lives on these screens; this page is the read-only
        summary. Ordered by the dependency chain — a group needs a school year,
        a child needs a group — so a new kindergarten can be set up top to bottom.
      */}
      <section aria-label="Удирдлагын хэсгүүд">
        <SectionHeader
          title="Удирдлага"
          lede="Цэцэрлэг, хичээлийн жил, бүлэг, хэрэглэгчийн бүртгэл."
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <AdminLink href="/admin/school-years" title="Хичээлийн жил" note="Эхлээд үүсгэнэ" />
          <AdminLink href="/admin/groups" title="Бүлгүүд" note="Багш хуваарилах" />
          <AdminLink href="/admin/users" title="Хэрэглэгчид" note="Багш, админ урих" />
          <AdminLink href="/admin/terms" title="Улирал" note="Үнэлгээний хугацаа" />
          <AdminLink
            href="/admin/assessment-config"
            title="Үнэлгээний тохиргоо"
            note="Чиглэл, түвшин, ажиглалтын төрөл"
          />
          <AdminLink href="/admin/audit" title="Үйлдлийн түүх" note="Хэн, хэзээ, юу хийсэн" />
          <AdminLink
            href="/admin/kindergarten"
            title="Цэцэрлэгийн мэдээлэл"
            note="Нэр, хаяг, холбоо барих"
          />
        </div>
      </section>

      <AssessmentCoverageSection
        coverage={assessmentCoverage}
        hasCurrentTerm={Boolean(currentTerm)}
        href={(groupId) => `/groups/${groupId}/assessment`}
      />

      <RecentActivitySection entries={recentActivity} />
    </div>
  );
}

/** One destination in the admin hub. */
function AdminLink({ href, title, note }: { href: string; title: string; note: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-[64px] flex-col justify-center rounded-row border border-border bg-surface px-4 py-3 transition-colors hover:border-primary"
    >
      <span className="text-lead font-semibold text-ink">{title}</span>
      <span className="mt-px text-compact text-muted">{note}</span>
    </Link>
  );
}

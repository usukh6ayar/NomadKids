"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { FileText, GraduationCap, HardDrive, Heart, School, Users } from "lucide-react";
import { adminDashboardSchema, AUDIT_ACTION_LABEL } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { formatFileSize, formatRelative } from "@/lib/format";
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

      <section aria-labelledby="coverage-heading">
        <SectionHeader id="coverage-heading" title="Улирлын үнэлгээний явц" />

        {assessmentCoverage.length === 0 ? (
          <EmptyState
            title="Мэдээлэл алга"
            description={
              currentTerm
                ? "Идэвхтэй бүлэг бүртгэгдээгүй байна."
                : "Улирал тохируулсны дараа үнэлгээний явц харагдана."
            }
          />
        ) : (
          <Card className="divide-y divide-border">
            {assessmentCoverage.map((group) => {
              const complete = group.children > 0 && group.assessed >= group.children;
              return (
                <Link
                  key={group.groupId}
                  href={`/groups/${group.groupId}/assessment`}
                  className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3 hover:bg-canvas"
                >
                  <span className="min-w-0 truncate font-medium text-ink">{group.name}</span>
                  {/*
                    The ratio is the signal, in words. A bare colour would leave
                    an administrator guessing whether green meant "done" or
                    "in progress".
                  */}
                  <span
                    className={`shrink-0 rounded-pill px-2.5 py-1 text-caption font-medium ${
                      complete ? "bg-mint text-mint-ink" : "bg-sun text-sun-ink"
                    }`}
                  >
                    {group.assessed} / {group.children} үнэлгээ
                  </span>
                </Link>
              );
            })}
          </Card>
        )}
      </section>

      <section aria-labelledby="activity-heading">
        <SectionHeader id="activity-heading" title="Сүүлийн үйлдэл" />

        {recentActivity.length === 0 ? (
          <EmptyState title="Үйлдэл бүртгэгдээгүй байна" />
        ) : (
          <Card className="divide-y divide-border">
            {recentActivity.map((entry) => (
              <div
                key={entry.id}
                className="flex min-h-[52px] items-center justify-between gap-3 px-4 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-body text-ink">
                    {AUDIT_ACTION_LABEL[entry.action] ?? entry.action}
                    {entry.objectType ? ` · ${entry.objectType}` : ""}
                  </span>
                  {entry.actorLabel ? (
                    <span className="block truncate text-caption text-muted">
                      {entry.actorLabel}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 whitespace-nowrap text-caption text-muted">
                  {formatRelative(entry.createdAt)}
                </span>
              </div>
            ))}
          </Card>
        )}
      </section>
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

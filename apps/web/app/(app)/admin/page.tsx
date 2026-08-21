"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { adminDashboardSchema, AUDIT_ACTION_LABEL } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { formatRelative } from "@/lib/format";

/**
 * Administration.
 *
 * ★ Only what the API actually implements is linked from here.
 *
 * The brief is explicit about no dead navigation, and the temptation on an
 * admin screen is to lay out the whole eventual product — user management,
 * kindergarten settings, domain and level configuration — and wire the links
 * later. Every one of those would 404 today. `GET /users` exists, so it is
 * reachable through the counts; the configuration tables have read endpoints
 * but no admin UI in this phase, so they are not linked at all.
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
        <h1 className="text-xl font-semibold text-ink">Удирдлага</h1>
        <LoadingState rows={4} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-2">
        <h1 className="mb-4 text-xl font-semibold text-ink">Удирдлага</h1>
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

  const { counts, assessmentCoverage, recentActivity, currentTerm } = data!;

  return (
    <div className="flex flex-col gap-6 py-2">
      <header>
        <h1 className="text-xl font-semibold text-ink">Удирдлага</h1>
        <p className="mt-0.5 text-sm text-muted">
          {currentTerm ? `${currentTerm.name} · идэвхтэй улирал` : "Идэвхтэй улирал тохируулаагүй"}
        </p>
      </header>

      <section aria-label="Товч мэдээлэл" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Хүүхэд" value={counts.children} />
        <Stat label="Бүлэг" value={counts.groups} />
        <Stat label="Багш, ажилтан" value={counts.staff} />
        <Stat label="Эцэг эх" value={counts.guardians} />
      </section>
      {/*
        The admin's actual work lives on these screens; this page is the read-only
        summary. Ordered by the dependency chain — a group needs a school year,
        a child needs a group — so a new kindergarten can be set up top to bottom.
      */}
      <section aria-label="Удирдлагын хэсгүүд">
        <SectionHeader title="Удирдлага" lede="Хичээлийн жил, бүлэг, хэрэглэгчийн бүртгэл." />
        <div className="grid gap-2 sm:grid-cols-3">
          <AdminLink href="/admin/school-years" title="Хичээлийн жил" note="Эхлээд үүсгэнэ" />
          <AdminLink href="/admin/groups" title="Бүлгүүд" note="Багш хуваарилах" />
          <AdminLink href="/admin/users" title="Хэрэглэгчид" note="Багш, админ урих" />
        </div>
      </section>

      <section aria-labelledby="coverage-heading">
        <SectionHeader title="Улирлын үнэлгээний явц" />

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
                    className={`shrink-0 rounded-[999px] px-2.5 py-1 text-xs font-medium ${
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
        <SectionHeader title="Сүүлийн үйлдэл" />

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
                  <span className="block truncate text-sm text-ink">
                    {AUDIT_ACTION_LABEL[entry.action] ?? entry.action}
                    {entry.objectType ? ` · ${entry.objectType}` : ""}
                  </span>
                  {entry.actorLabel ? (
                    <span className="block truncate text-xs text-muted">{entry.actorLabel}</span>
                  ) : null}
                </span>
                <span className="shrink-0 whitespace-nowrap text-xs text-muted">
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="px-4 py-3.5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
    </Card>
  );
}

/** One destination in the admin hub. */
function AdminLink({ href, title, note }: { href: string; title: string; note: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-[64px] flex-col justify-center rounded-[14px] border border-border bg-surface px-4 py-3 transition-colors hover:border-primary"
    >
      <span className="text-[.94rem] font-semibold text-ink">{title}</span>
      <span className="mt-px text-[.78rem] text-muted">{note}</span>
    </Link>
  );
}

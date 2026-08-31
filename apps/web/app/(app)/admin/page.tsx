"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  Building2,
  CalendarClock,
  CalendarRange,
  ChevronRight,
  HardDrive,
  Heart,
  School,
  SlidersHorizontal,
  Users,
} from "lucide-react";
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
import { Art } from "@/components/ui/art";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { IconChip } from "@/components/ui/icon-chip";
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

        ★★ Two columns on a phone, three from `lg`, and none of them `wide`.

        This grid was `grid-cols-1 sm:grid-cols-2` with the first card spanning
        both, which produced two faults at once. On a desktop the six cards
        filled 2·2·1 and left the last one orphaned beside a card-shaped hole;
        on a phone every card was full width, so six figures — 1,100px of them
        — stood between the heading and the seven links that are the actual
        reason to open this screen. A count is a glance, not a page.

        Six divides evenly by both two and three, so neither breakpoint
        orphans. The `wide` span went with it: the child count is the most
        important figure here, but making it four times the area of the others
        bought that emphasis with the layout of every other card.
      */}
      <section aria-label="Товч мэдээлэл" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label="Нийт хүүхэд"
          value={counts.children}
          unit="хүүхэд"
          tone="cornflower"
          art={<Art name="child" size={40} />}
        />
        <StatCard
          label="Бүлэг"
          value={counts.groups}
          tone="mint"
          art={<Art name="kindergarten" size={40} />}
        />
        <StatCard
          label="Багш, ажилтан"
          value={counts.staff}
          tone="sky"
          art={<Art name="teacher" size={40} />}
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
            {/*
              ★ The figure counts files; the size is the caption under it.

              It was the other way round, and on a kindergarten that has not
              uploaded anything the card read "—" over "0 файл": `formatFileSize`
              returns an em dash for zero bytes, which is right where a size is
              unknown and wrong where it is known to be nothing. The label says
              "файл", so the number under it should be files — and a size has no
              honest zero to show, while a count does.
            */}
            <StatCard
              label="Хадгалсан файл"
              value={storage.fileCount}
              unit={storage.totalBytes > 0 ? formatFileSize(storage.totalBytes) : "хоосон"}
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
              art={<Art name="report" size={40} />}
            />
          </>
        ) : null}
      </section>

      {/*
        The admin's actual work lives on these screens; this page is the
        read-only summary.

        ★ The heading is no longer "Удирдлага".

        The page's own `h1` is "Удирдлага", and this section's was too — the
        same word twice, 400px apart, naming a screen and then a part of it. A
        reader scanning for structure finds two anchors that do not distinguish
        anything.
      */}
      <section aria-labelledby="sections-heading">
        <SectionHeader
          id="sections-heading"
          title="Удирдлагын хэсгүүд"
          lede="Цэцэрлэг, хичээлийн жил, бүлэг, хэрэглэгчийн бүртгэл."
        />
        {/*
          ★ Six tiles, and the seventh link moved rather than the grid bent.

          Seven is prime, so no column count divides it: three columns orphaned
          a tile on a third row, two columns orphaned one on a fourth, and
          splitting the seven into two grouped cards only moved the ragged edge
          sideways — a four-row card beside a three-row card ends lower than it,
          which is the same hole in a different place. Stretching either the odd
          tile or the short card to fill the gap puts the hole *inside* a
          surface instead of beside it.

          The number was the symptom. `Үйлдлийн түүх` is not a thing an
          administrator sets up — it is the audit log, and this page already
          renders the most recent entries of it at the bottom under `Сүүлийн
          үйлдэл`. A link to the full history belongs on that section, where the
          reader is already looking at three lines of it and wants more, not in
          a grid of setup destinations six rows above.

          Six divides by two and by three, so the grid closes cleanly at every
          breakpoint, and the audit link ended up somewhere it is more likely to
          be found rather than somewhere that made the arithmetic work.
        */}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <AdminLink
            href="/admin/school-years"
            title="Хичээлийн жил"
            note="Эхлээд үүсгэнэ"
            icon={<CalendarRange size={20} aria-hidden />}
          />
          <AdminLink
            href="/admin/terms"
            title="Улирал"
            note="Үнэлгээний хугацаа"
            icon={<CalendarClock size={20} aria-hidden />}
          />
          <AdminLink
            href="/admin/groups"
            title="Бүлгүүд"
            note="Багш хуваарилах"
            icon={<School size={20} aria-hidden />}
          />
          <AdminLink
            href="/admin/users"
            title="Хэрэглэгчид"
            note="Багш, админ урих"
            icon={<Users size={20} aria-hidden />}
          />
          <AdminLink
            href="/admin/assessment-config"
            title="Үнэлгээний тохиргоо"
            note="Чиглэл, түвшин, ажиглалтын төрөл"
            icon={<SlidersHorizontal size={20} aria-hidden />}
          />
          <AdminLink
            href="/admin/kindergarten"
            title="Цэцэрлэгийн мэдээлэл"
            note="Нэр, хаяг, холбоо барих"
            icon={<Building2 size={20} aria-hidden />}
          />
        </div>
      </section>

      <AssessmentCoverageSection
        coverage={assessmentCoverage}
        hasCurrentTerm={Boolean(currentTerm)}
        href={(groupId) => `/groups/${groupId}/assessment`}
      />

      <RecentActivitySection entries={recentActivity} auditHref="/admin/audit" />
    </div>
  );
}

/**
 * One destination in the admin hub.
 *
 * ★ A glyph and a chevron, because seven identical rectangles are not a menu.
 *
 * This rendered as a bordered box with two lines of text, seven times. Nothing
 * in it was wrong and nothing in it was findable: a director looking for
 * "Хэрэглэгчид" had to read all seven titles in order, every time, because
 * there was no shape to remember any of them by. An icon gives each entry a
 * second, faster handle — you learn where the people one is on the page rather
 * than re-reading to find it.
 *
 * ★★ The chip is `primary`, not one of the six semantic tones, and
 * `icon-chip.tsx` argues that at length: these seven destinations do not mean
 * complete, waiting and needs-attention, and borrowing that palette to
 * decorate them would say so in a vocabulary the product reads as meaningful.
 *
 * ★★★ The chevron is the affordance the hover border is carrying alone.
 *
 * A border that changes colour only says "this is a link" once the pointer is
 * already on it — which leaves a touch screen, where there is no hover at all,
 * with no signal whatsoever.
 */
function AdminLink({
  href,
  title,
  note,
  icon,
}: {
  href: string;
  title: string;
  note: string;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-[72px] items-center gap-3 rounded-row border border-border bg-surface px-4 py-3 transition-colors hover:border-primary"
    >
      <IconChip icon={icon} tone="primary" />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-lead font-semibold text-ink">{title}</span>
        <span className="mt-px block truncate text-compact text-muted">{note}</span>
      </span>

      <ChevronRight
        size={18}
        aria-hidden
        className="shrink-0 text-faint transition-colors group-hover:text-primary"
      />
    </Link>
  );
}

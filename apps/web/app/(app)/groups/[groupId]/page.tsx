"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CalendarCheck, ClipboardCheck, UtensilsCrossed } from "lucide-react";
import {
  ATTENDANCE_FORM_LABEL,
  PROGRAM_KIND_LABEL,
  childSummarySchema,
  groupWithTeachersSchema,
  paginated,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { formatAge, fullName } from "@/lib/format";

const childrenSchema = paginated(childSummarySchema);

/** The same four the group list names — one source would be better; see below. */
const BAND_LABEL: Record<string, string> = {
  NURSERY: "Бага бүлэг",
  JUNIOR: "Дунд бүлэг",
  MIDDLE: "Ахлах бүлэг",
  SENIOR: "Бэлтгэл бүлэг",
};

/**
 * One group, in full — "Бүлгийн дэлгэрэнгүй".
 *
 * ★ New on 2026-09-06, at the client's request: "бүлгүүд дотор нэр гэдэг
 * хэсэгт дэлгэрэнгүй харуулдаг хэсэг байх, дараад орохоор дотор нь ирц гэх
 * мэтийг нь засаж болдог боломжийг үүсгэх".
 *
 * `/admin/groups` answered every question about a group *except* "what is this
 * group": its row carried a name, a band, a year, a count and eight controls,
 * and the eight controls were the only way in. So a director wanting the roster
 * and the teachers had to open the assign-a-teacher dialog to read the second
 * and the children screen with a filter to read the first — two places, neither
 * of which is about this group.
 *
 * ★★ It reads; the registers write.
 *
 * The three doors are the same three the list row's buttons opened, and they
 * are still the only place attendance, meals or assessment are recorded. This
 * page does not grow a fourth copy of a register — `/attendance/daily`'s own
 * docblock counts three attendance screens and gives the reason each exists,
 * and a fourth that happened to be inside a group page would be the one nobody
 * could name the purpose of.
 *
 * ★★★ The roster is a page of twenty, linking out.
 *
 * `/children?groupId=` is the roster proper — it searches, filters, exports and
 * pages. Repeating that here would be a second children screen; what this
 * shows is who is in the group, which is the fact a director came for, with a
 * link to the real list when they want to do something to it.
 */
export default function GroupDetailPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <GroupDetail />
    </RequireRole>
  );
}

function GroupDetail() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;

  const group = useQuery({
    // The same key `ManageTeachersDialog` uses, so opening this from the list
    // usually reads a cache that dialog has already filled.
    queryKey: ["admin", "groups", groupId],
    queryFn: () => get(`/groups/${groupId}`, groupWithTeachersSchema),
  });

  const roster = useQuery({
    queryKey: qk.children({ groupId, page: 1, pageSize: 20 }),
    queryFn: () => get(`/children?groupId=${groupId}&page=1&pageSize=20`, childrenSchema),
  });

  if (group.isLoading) return <LoadingState rows={5} />;
  if (group.isError) return <ErrorState description={errorMessage(group.error)} />;

  const data = group.data!;
  // Only assignments that have not ended — `endedOn` is how the API retires one.
  const teachers = (data.teachers ?? []).filter((t) => !t.endedOn);
  const isArchived = data.status === "ARCHIVED";

  return (
    <div className="flex flex-col gap-4">
      <Button asChild variant="ghost" size="sm" className="self-start">
        <Link href="/admin/groups">
          <ArrowLeft size={16} aria-hidden />
          Бүлгүүд
        </Link>
      </Button>

      <PageHeader
        title={data.name}
        lede={[
          data.ageBand ? (BAND_LABEL[data.ageBand] ?? data.ageBand) : null,
          data.schoolYear?.name,
        ]
          .filter(Boolean)
          .join(" · ")}
        meta={
          <>
            {isArchived ? <Badge tone="neutral">Архивласан</Badge> : null}
            {/*
              Same rule the list row follows: the ordinary case gets no badge,
              so the exceptions are what the eye finds.
            */}
            {data.programKind === "ALTERNATIVE" ? (
              <Badge tone="sky">{PROGRAM_KIND_LABEL.ALTERNATIVE}</Badge>
            ) : null}
            {data.attendanceForm && data.attendanceForm !== "STANDARD" ? (
              <Badge tone="sun">{ATTENDANCE_FORM_LABEL[data.attendanceForm]}</Badge>
            ) : null}
            <Badge tone="mint">{data._count?.enrollments ?? 0} хүүхэд</Badge>
          </>
        }
      />

      {/*
        ★ The three registers, as doors rather than as a toolbar.

        This is the reason the client asked for the page — "дараад орохоор
        дотор нь ирцийг нь засаж болдог" — so they are the first thing on it and
        they are the size of something you are meant to press, not three ghost
        buttons in a row's gutter.
      */}
      <div className="grid gap-2.5 sm:grid-cols-3">
        <RegisterDoor
          href={`/groups/${groupId}/attendance`}
          icon={<CalendarCheck size={20} aria-hidden />}
          tone="bg-mint text-mint-ink"
          title="Ирц"
          hint="Өдрийн ирц бүртгэх"
        />
        <RegisterDoor
          href={`/groups/${groupId}/meals`}
          icon={<UtensilsCrossed size={20} aria-hidden />}
          tone="bg-sun text-sun-ink"
          title="Хоол"
          hint="Хоолны бүртгэл"
        />
        <RegisterDoor
          href={`/groups/${groupId}/assessment`}
          icon={<ClipboardCheck size={20} aria-hidden />}
          tone="bg-sky text-sky-ink"
          title="Явцын үнэлгээ"
          hint="Улирлын үнэлгээ"
        />
      </div>

      <Card pad="roomy">
        <SectionHeader title="Хариуцсан багш" as="h2" />
        {teachers.length === 0 ? (
          <p className="text-body text-muted">
            Багш хуваарилаагүй байна. Бүлгүүд хуудсаас хуваарилна.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {teachers.map((assignment) => (
              <li key={assignment.id} className="flex items-center gap-2">
                <span className="text-body text-ink">
                  {assignment.membership?.user ? fullName(assignment.membership.user) : "—"}
                </span>
                {assignment.role ? (
                  <Badge tone={assignment.role === "LEAD" ? "sky" : "neutral"}>
                    {assignment.role === "LEAD" ? "Үндсэн" : "Туслах"}
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SectionHeader
        title="Бүлгийн хүүхдүүд"
        as="h2"
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href={`/children?groupId=${groupId}`}>Бүх жагсаалт</Link>
          </Button>
        }
      />

      {roster.isLoading ? <LoadingState rows={4} /> : null}
      {roster.isError ? <ErrorState description={errorMessage(roster.error)} /> : null}

      {roster.data && roster.data.items.length === 0 ? (
        <EmptyState
          title="Хүүхэд бүртгэгдээгүй"
          description="Энэ бүлэгт идэвхтэй бүртгэлтэй хүүхэд алга байна."
        />
      ) : null}

      {roster.data && roster.data.items.length > 0 ? (
        <Card className="divide-y divide-border">
          {roster.data.items.map((child) => (
            <Link
              key={child.id}
              href={`/children/${child.id}/general`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-sunken"
            >
              <ChildAvatar child={child} size={36} />
              <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                {fullName(child)}
              </span>
              {child.dateOfBirth ? (
                <span className="shrink-0 text-caption text-muted">
                  {formatAge(child.dateOfBirth)}
                </span>
              ) : null}
            </Link>
          ))}
        </Card>
      ) : null}

      {/* The roster is capped at twenty; say so rather than let a group of
          thirty look like a group of twenty. */}
      {roster.data && roster.data.total > roster.data.items.length ? (
        <p className="text-caption text-muted">
          Нийт {roster.data.total} хүүхдээс эхний {roster.data.items.length} нь харагдаж байна.
        </p>
      ) : null}
    </div>
  );
}

function RegisterDoor({
  href,
  icon,
  tone,
  title,
  hint,
}: {
  href: string;
  icon: React.ReactNode;
  tone: string;
  title: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[64px] items-center gap-3 rounded-row border border-border bg-surface px-3.5 py-3 transition-colors hover:border-primary/40 hover:bg-canvas"
    >
      <span className={`grid size-10 shrink-0 place-items-center rounded-control ${tone}`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-body font-semibold text-ink">{title}</span>
        <span className="block truncate text-caption text-muted">{hint}</span>
      </span>
    </Link>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Search } from "lucide-react";
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
import { useSession } from "@/lib/auth/session";
import { EsisGroupWrite } from "@/components/esis/esis-group-write";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { formatAge, fullName, shortName } from "@/lib/format";
import { Art } from "@/components/ui/art";
import { GroupGuardianInvitations } from "@/components/child/group-guardian-invitations";

/** The roster table's columns — the name is the row title, not a column. */
const ROSTER_COLUMNS = [
  { key: "sex", label: "Хүйс", className: "md:w-[110px]" },
  { key: "age", label: "Нас", className: "md:w-[130px]" },
];

const childrenSchema = paginated(childSummarySchema);

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
  const { hasRole, primaryKindergartenId } = useSession();

  const group = useQuery({
    // The same key `ManageTeachersDialog` uses, so opening this from the list
    // usually reads a cache that dialog has already filled.
    queryKey: ["admin", "groups", groupId],
    queryFn: () => get(`/groups/${groupId}`, groupWithTeachersSchema),
  });

  /*
   * ★ The whole group, not the first twenty — 2026-09-20, the client asking
   * for "хүүхдийн жагсаалт хайлт шүүлтүүр байлгая хүснэгтээр".
   *
   * The cap was 20 with a line underneath admitting it, which is honest and
   * useless: a director looking for one child in a group of thirty could not
   * reach eleven of them from here. A search box over twenty rows is also not
   * a search box. 200 is past any group this product describes — the RFP's
   * largest is a few dozen — so the list is complete in practice and the
   * filtering below is over the whole of it.
   */
  const roster = useQuery({
    queryKey: qk.children({ groupId, page: 1, pageSize: 200 }),
    queryFn: () => get(`/children?groupId=${groupId}&page=1&pageSize=200`, childrenSchema),
  });

  const [query, setQuery] = useState("");
  const [sex, setSex] = useState("");

  /*
   * ★ Filtered in the browser, not by the API.
   *
   * The whole group is already here — see the query above — so a round trip
   * per keystroke would be slower and would make the list flicker between
   * results. `/children` does take `q`, and the moment a group is large enough
   * for this to be the wrong call, so is the 200 above; both change together.
   *
   * ★★ `toLocaleLowerCase("mn-MN")` rather than `toLowerCase()`. Cyrillic Ө
   * and Ү case-fold correctly only under the Mongolian locale, and a director
   * typing "өнө" for Өнөбилэг must find her.
   */
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("mn-MN");
    return (roster.data?.items ?? []).filter((child) => {
      if (sex && child.sex !== sex) return false;
      if (!needle) return true;
      /*
        ★ `fullName`, deliberately, while the rows *render* `shortName`.

        The names on screen read "Г.Батбаяр" since 2026-09-22, and matching the
        search against that string would stop "Ганболд" finding him — a teacher
        typing the surname off a document would get an empty list for a child
        who is in the group. The search reads the whole name; the row shows the
        short one.
      */
      return fullName(child).toLocaleLowerCase("mn-MN").includes(needle);
    });
  }, [roster.data, query, sex]);

  if (group.isLoading) return <LoadingState rows={5} />;
  if (group.isError) return <ErrorState description={errorMessage(group.error)} />;

  const data = group.data!;
  // Only assignments that have not ended — `endedOn` is how the API retires one.
  const teachers = (data.teachers ?? []).filter((t) => !t.endedOn);
  const isArchived = data.status === "ARCHIVED";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        backHref="/admin/groups"
        title={data.name}
        /*
          ★ In the header rather than beside the roster below. It acts on the
          whole group, and a control that acts on a list belongs above it —
          `GroupGuardianInvitations` explains why it is one press and thirty
          tokens rather than one code.
        */
        actions={<GroupGuardianInvitations groupId={groupId} groupName={data.name} />}
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
          icon={<Art name="attendance" size={28} className="size-7" />}
          tone="bg-transparent"
          title="Ирц"
          hint="Өдрийн ирц бүртгэх"
        />
        <RegisterDoor
          href={`/groups/${groupId}/meals`}
          icon={<Art name="food" size={28} className="size-7" />}
          tone="bg-transparent"
          title="Хоол"
          hint="Хоолны бүртгэл"
        />
        <RegisterDoor
          href={`/groups/${groupId}/assessment`}
          icon={<Art name="progress" size={28} className="size-7" />}
          tone="bg-transparent"
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
                  {/*
                    ★ "С.Бямбараш" — the client's own example, 2026-09-22. A
                    group header carries the lead and the assistant side by
                    side, and two full Mongolian names there wrap onto a second
                    line on a phone.
                  */}
                  {assignment.membership?.user ? shortName(assignment.membership.user) : "—"}
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
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative min-w-0 flex-1 sm:max-w-[360px]">
              <span className="sr-only">Нэрээр хайх</span>
              <Search
                size={18}
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
              />
              <Input
                type="search"
                aria-label="Нэрээр хайх"
                placeholder="Хүүхдийн нэрээр хайх"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-11"
              />
            </label>
            <Select
              aria-label="Хүйсээр шүүх"
              value={sex}
              onChange={(event) => setSex(event.target.value)}
              className="w-full sm:w-[160px]"
            >
              <option value="">Бүх хүйс</option>
              <option value="MALE">Хүү</option>
              <option value="FEMALE">Охин</option>
            </Select>
            <span className="rounded-pill bg-primary-soft px-3 py-1.5 text-caption font-semibold text-primary">
              {visible.length} / {roster.data.total} хүүхэд
            </span>
          </div>

          {/*
           * ★ A filter that matches nothing is not an empty group, and must
           * not read as one. The empty state above says "nobody is enrolled";
           * this one says "nobody matches", which is the only difference that
           * matters to somebody who has just typed a name.
           */}
          {visible.length === 0 ? (
            <EmptyState
              title="Хайлтад тохирох хүүхэд олдсонгүй"
              description="Хайлт, шүүлтээ өөрчилж үзнэ үү."
            />
          ) : (
            <DataList columns={ROSTER_COLUMNS} leadWidth={null}>
              {visible.map((child) => (
                <DataRow
                  key={child.id}
                  title={
                    <Link
                      href={`/children/${child.id}/general`}
                      className="flex min-w-0 items-center gap-3 text-primary hover:underline"
                    >
                      <ChildAvatar child={child} size={32} />
                      <span className="min-w-0 truncate">{shortName(child)}</span>
                    </Link>
                  }
                  cells={{
                    sex: child.sex ? (
                      <span className="text-body text-muted">
                        {child.sex === "FEMALE" ? "Охин" : "Хүү"}
                      </span>
                    ) : null,
                    age: child.dateOfBirth ? (
                      <span className="text-body tabular-nums text-muted">
                        {formatAge(child.dateOfBirth)}
                      </span>
                    ) : null,
                  }}
                />
              ))}
            </DataList>
          )}
        </>
      ) : null}

      {/*
        ★ The director's only. The routes behind it are `@Roles("ADMIN")`, and a
        teacher seeing a button that always answers 403 is worse than not seeing
        it — the client's 2026-09-14 rule puts the ministry's register of this
        kindergarten's classes on the director.
      */}
      {hasRole("ADMIN") && primaryKindergartenId ? (
        <EsisGroupWrite
          kindergartenId={primaryKindergartenId}
          groupId={groupId}
          groupName={data.name}
        />
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

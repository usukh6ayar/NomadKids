"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
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
import { GroupRosterCheck } from "@/components/admin/groups/group-roster-check";
import { ManageChildrenDialog } from "@/components/admin/groups/manage-children-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Tabs, TabButton } from "@/components/ui/tabs";
import { TableShell, Td, Th } from "@/components/ui/table";
import { Select } from "@/components/ui/field";
import { SearchField } from "@/components/ui/search-field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { formatAge, fullName, shortName } from "@/lib/format";
import { Art } from "@/components/ui/art";
import { GroupGuardianInvitations } from "@/components/child/group-guardian-invitations";

const childrenSchema = paginated(childSummarySchema);

/**
 * One group, in full — "Бүлгийн дэлгэрэнгүй".
 *
 * ★ Built 2026-09-06 at the client's request — "бүлгүүд дотор нэр гэдэг хэсэгт
 * дэлгэрэнгүй харуулдаг хэсэг байх, дараад орохоор дотор нь ирц гэх мэтийг нь
 * засаж болдог боломжийг үүсгэх" — and regrouped 2026-09-23 into two tabs.
 * Everything that was on it is still on it; what changed is that the roster
 * and the group's own facts stopped competing for the same scroll.
 *
 * ★★ **It reads; the registers write.** The three doors lead to the only
 * places attendance, meals and assessment are recorded. This page does not
 * grow a fourth copy of a register — `/attendance/daily`'s docblock counts
 * three attendance screens and gives each a reason, and a fourth that happened
 * to live inside a group page would be the one nobody could name the purpose
 * of.
 *
 * ★★★ **The roster is local, and the ESIS check is a comparison.** The table
 * is `/children?groupId=` — our own `Enrollment` rows, which is what every
 * other screen in the product operates on. `GroupRosterCheck` asks the
 * ministry the same question and reports whether the two agree; it never
 * writes, and the import that does is on `/admin/groups`.
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
  const [tab, setTab] = useState<"children" | "about">("children");
  const [managingChildren, setManagingChildren] = useState(false);

  const group = useQuery({
    // The same key `ManageTeachersDialog` uses, so arriving from the list
    // usually reads a cache that dialog has already filled.
    queryKey: ["admin", "groups", groupId],
    queryFn: () => get(`/groups/${groupId}`, groupWithTeachersSchema),
  });

  /*
   * ★ The whole group, not the first twenty — 2026-09-20, the client asking
   * for "хүүхдийн жагсаалт хайлт шүүлтүүр байлгая хүснэгтээр". A search box
   * over twenty of thirty rows is not a search box. 200 is past any group this
   * product describes, so the list is complete in practice and the filtering
   * below is over the whole of it.
   */
  const roster = useQuery({
    queryKey: qk.children({ groupId, page: 1, pageSize: 200 }),
    queryFn: () => get(`/children?groupId=${groupId}&page=1&pageSize=200`, childrenSchema),
  });

  const [query, setQuery] = useState("");
  const [sex, setSex] = useState("");

  /*
   * ★ Filtered in the browser: the whole group is already here, so a round
   * trip per keystroke would be slower and would make the list flicker.
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
        `fullName`, deliberately, while the rows *render* `shortName`. Matching
        against "Г.Батбаяр" would stop "Ганболд" finding him — a teacher typing
        the surname off a document would get an empty list for a child who is
        in the group.
      */
      return fullName(child).toLocaleLowerCase("mn-MN").includes(needle);
    });
  }, [roster.data, query, sex]);

  if (group.isLoading) return <LoadingState rows={5} />;
  if (group.isError) return <ErrorState description={errorMessage(group.error)} />;

  const data = group.data!;
  // Only assignments that have not ended — `endedOn` is how the API retires one.
  const teachers = (data.teachers ?? []).filter((teacher) => !teacher.endedOn);
  const lead = teachers.find((teacher) => teacher.role === "LEAD") ?? teachers[0];
  const isArchived = data.status === "ARCHIVED";
  const childCount = data._count?.enrollments ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        backHref="/admin/groups"
        title={data.name}
        /*
          In the header rather than beside the roster: it acts on the whole
          group, and a control that acts on a list belongs above it.
        */
        actions={<GroupGuardianInvitations groupId={groupId} groupName={data.name} />}
        meta={
          <>
            <Badge tone="mint">{childCount} суралцагч</Badge>
            {/*
              ★ The lead teacher in the header — "Бага бүлэг → 21 хүүхэд →
              Г.Баяр багш" is the sentence this screen exists to say, and it
              was two scrolls apart before.
            */}
            {lead ? (
              <span className="text-caption text-muted">
                Үндсэн багш: <span className="text-ink">{shortName(lead.membership?.user)}</span>
              </span>
            ) : (
              <Badge tone="sun">Багш тохируулаагүй</Badge>
            )}
            {isArchived ? <Badge tone="neutral">Архивласан</Badge> : null}
            {/* The ordinary case gets no badge, so the exceptions are what the eye finds. */}
            {data.programKind === "ALTERNATIVE" ? (
              <Badge tone="sky">{PROGRAM_KIND_LABEL.ALTERNATIVE}</Badge>
            ) : null}
            {data.attendanceForm && data.attendanceForm !== "STANDARD" ? (
              <Badge tone="sun">{ATTENDANCE_FORM_LABEL[data.attendanceForm]}</Badge>
            ) : null}
          </>
        }
      />

      {/*
        ★ The three registers, as doors rather than as a toolbar — the reason
        the client asked for this page ("дараад орохоор дотор нь ирцийг нь засаж
        болдог"), so they are the first thing on it and they are the size of
        something you are meant to press.

        They stay links rather than joining the tab strip below: a tab that
        navigates away is a tab you cannot come back from, and these three are
        whole screens with their own group switcher.
      */}
      <div className="grid gap-2.5 sm:grid-cols-3">
        <RegisterDoor
          href={`/groups/${groupId}/attendance`}
          icon={<Art name="attendance" size={28} className="size-7" />}
          title="Ирц"
          hint="Өдрийн ирц бүртгэх"
        />
        <RegisterDoor
          href={`/groups/${groupId}/meals`}
          icon={<Art name="food" size={28} className="size-7" />}
          title="Хоол"
          hint="Хоолны бүртгэл"
        />
        <RegisterDoor
          href={`/groups/${groupId}/assessment`}
          icon={<Art name="progress" size={28} className="size-7" />}
          title="Явцын үнэлгээ"
          hint="Улирлын үнэлгээ"
        />
      </div>

      <Tabs label="Бүлгийн харагдац">
        <TabButton
          active={tab === "children"}
          onClick={() => setTab("children")}
          count={childCount}
        >
          Суралцагчид
        </TabButton>
        <TabButton active={tab === "about"} onClick={() => setTab("about")}>
          Мэдээлэл
        </TabButton>
      </Tabs>

      {tab === "children" ? (
        <>
          {roster.isLoading ? <LoadingState rows={4} /> : null}
          {roster.isError ? <ErrorState description={errorMessage(roster.error)} /> : null}

          {roster.data && roster.data.items.length === 0 ? (
            <EmptyState
              title="Суралцагч бүртгэгдээгүй"
              description="Энэ бүлэгт суралцагч бүртгэгдээгүй байна. «Бүлгүүд» хэсгээс ЭСИС-ээс татах боломжтой."
            />
          ) : null}

          {roster.data && roster.data.items.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <SearchField
                  label="Суралцагчийн нэрээр хайх"
                  placeholder="Нэрээр хайх…"
                  value={query}
                  onChange={setQuery}
                  className="sm:max-w-[320px]"
                />
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
                  {visible.length} / {roster.data.total}
                </span>
                <span className="ms-auto flex flex-wrap gap-2">
                  {/*
                    ★ The director's only — `POST /children/:id/enrollments`
                    and `PATCH /enrollments/:id` are both `@Roles("ADMIN")`, and
                    a teacher shown a button that always answers 403 is worse
                    off than one who never sees it.
                  */}
                  {hasRole("ADMIN") ? (
                    <Button variant="secondary" size="sm" onClick={() => setManagingChildren(true)}>
                      Суралцагч хуваарилах
                    </Button>
                  ) : null}
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`/children?groupId=${groupId}`}>Бүх жагсаалт</Link>
                  </Button>
                </span>
              </div>

              {/*
                ★ The ministry's own count for this class, beside ours. It is a
                comparison and never a correction — see `GroupRosterCheck`.
              */}
              <GroupRosterCheck esisGroupId={data.esisGroupId} localCount={roster.data.total} />

              {/*
                ★ A filter that matches nothing is not an empty group, and must
                not read as one. The empty state above says "nobody is
                enrolled"; this one says "nobody matches", which is the only
                difference that matters to somebody who has just typed a name.
              */}
              {visible.length === 0 ? (
                <EmptyState
                  title="Хайлтад тохирох суралцагч олдсонгүй"
                  description="Хайлт, шүүлтээ өөрчилж үзнэ үү."
                />
              ) : (
                /*
                  ★ `min-w-0` and `stacked`: the client's 2026-09-09 rule is no
                  sideways scroll, and a pixel floor is what breaks it.
                */
                <TableShell caption="Бүлгийн суралцагчид" minWidth="min-w-0" stacked>
                  <thead>
                    <tr>
                      <Th>Нэр</Th>
                      <Th>Регистр</Th>
                      <Th>Хүйс</Th>
                      <Th>Нас</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((child) => (
                      <tr key={child.id}>
                        <Td data-label="Нэр">
                          <Link
                            href={`/children/${child.id}/general`}
                            className="flex min-w-0 items-center gap-2.5 font-medium text-primary hover:underline"
                          >
                            <ChildAvatar child={child} size={28} />
                            <span className="min-w-0 truncate">{shortName(child)}</span>
                          </Link>
                        </Td>
                        {/*
                          ★ A foreign child's identifier is labelled as one
                          rather than rendering as a bare number, and an
                          unrecorded регистр is "—": a dash for a гадаад иргэн
                          reads identically to a dash for a child whose регистр
                          nobody has typed yet, and only the second is
                          somebody's to-do.
                        */}
                        <Td data-label="Регистр" className="tabular-nums text-muted">
                          {child.isForeign ? (
                            child.foreignId ? (
                              `${child.foreignId} (гадаад)`
                            ) : (
                              <span className="text-faint">Гадаад иргэн</span>
                            )
                          ) : (
                            child.nationalId || <span className="text-faint">—</span>
                          )}
                        </Td>
                        <Td data-label="Хүйс" className="text-muted">
                          {child.sex ? (child.sex === "FEMALE" ? "Охин" : "Хүү") : "—"}
                        </Td>
                        <Td data-label="Нас" className="tabular-nums text-muted">
                          {child.dateOfBirth ? formatAge(child.dateOfBirth) : "—"}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
              )}
            </>
          ) : null}
        </>
      ) : (
        <GroupAbout
          groupId={groupId}
          groupName={data.name}
          teachers={teachers}
          schoolYear={data.schoolYear?.name ?? null}
          isAdmin={hasRole("ADMIN")}
          kindergartenId={primaryKindergartenId}
        />
      )}

      {managingChildren ? (
        <ManageChildrenDialog
          groupId={groupId}
          groupName={data.name}
          onClose={() => setManagingChildren(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * The Мэдээлэл tab — who teaches the group, and where that stands with ESIS.
 *
 * ★ **The two registers are reported separately, deliberately.** The local
 * `GroupTeacher` row is what NomadKids authorizes on and it is in force the
 * moment it is written; the ministry's `groupInstructor` record is a separate,
 * approved write that a director prepares, reads in full and sends. Showing
 * one tick for both would claim something no press has done — so this says
 * "NomadKids ✓" for the half that is certain and leaves the other half to the
 * panel that performs it.
 */
function GroupAbout({
  groupId,
  groupName,
  teachers,
  schoolYear,
  isAdmin,
  kindergartenId,
}: {
  groupId: string;
  groupName: string;
  teachers: {
    id: string;
    role?: string | null;
    membership?: { user?: { lastName?: string | null; firstName?: string | null } | null } | null;
  }[];
  schoolYear: string | null;
  isAdmin: boolean;
  kindergartenId: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card pad="roomy">
        <SectionHeader title="Хариуцсан багш" as="h2" />
        {teachers.length === 0 ? (
          <p className="text-body text-muted">
            Багш тохируулаагүй байна. «Бүлгүүд» хэсгээс хуваарилна уу.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {teachers.map((assignment) => (
              <li key={assignment.id} className="flex flex-wrap items-center gap-2">
                {/*
                  "С.Бямбараш" — the client's own example, 2026-09-22. A header
                  carrying a lead and an assistant side by side wraps onto a
                  second line on a phone with two full Mongolian names.
                */}
                <span className="text-body text-ink">
                  {assignment.membership?.user ? shortName(assignment.membership.user) : "—"}
                </span>
                <Badge tone={assignment.role === "ASSISTANT" ? "neutral" : "sky"}>
                  {assignment.role === "ASSISTANT" ? "Туслах" : "Үндсэн"}
                </Badge>
                <Badge tone="mint">NomadKids ✓</Badge>
              </li>
            ))}
          </ul>
        )}

        {teachers.length > 0 && isAdmin ? (
          <p className="mt-3 text-caption leading-relaxed text-muted">
            Энэ хуваарилалт NomadKids-ийн эрхэд хүчинтэй. ЭСИС-ийн бүртгэлд тусгахын тулд доорх
            «Багш тохируулах»-аар баталгаажуулж илгээнэ.
          </p>
        ) : null}

        {schoolYear ? (
          <p className="mt-3 text-caption text-muted">Хичээлийн жил: {schoolYear}</p>
        ) : null}
      </Card>

      {/*
        ★ The director's only. The routes behind it are `@Roles("ADMIN")`, and
        a teacher seeing a button that always answers 403 is worse than not
        seeing it — the client's 2026-09-14 rule puts the ministry's register
        of this kindergarten's classes on the director.
      */}
      {isAdmin && kindergartenId ? (
        <EsisGroupWrite kindergartenId={kindergartenId} groupId={groupId} groupName={groupName} />
      ) : null}
    </div>
  );
}

function RegisterDoor({
  href,
  icon,
  title,
  hint,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[64px] items-center gap-3 rounded-row border border-border bg-surface px-3.5 py-3 transition-colors hover:border-primary/40 hover:bg-canvas"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-control">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-body font-semibold text-ink">{title}</span>
        <span className="block truncate text-caption text-muted">{hint}</span>
      </span>
    </Link>
  );
}

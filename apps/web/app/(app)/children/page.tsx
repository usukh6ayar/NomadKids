"use client";

import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Download, Mars, Plus, Upload, Venus } from "lucide-react";
import { useEffect, useState } from "react";
import {
  childSummarySchema,
  esisResourceReadSchema,
  esisScopedCatalogSchema,
  paginated,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { ChildPhotoButton } from "@/components/child/child-photo-button";
import { PageHeader } from "@/components/shell/app-shell";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { RequireRole } from "@/components/shell/require-role";
import { downloadUrl } from "@/lib/api/client";
import { useDebounced } from "@/lib/use-debounced";
import { Art } from "@/components/ui/art";
import { Donut } from "@/components/ui/chart/donut";
import { Ring } from "@/components/ui/chart/ring";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatAge, fullName, shortName } from "@/lib/format";
import { TableShell, Td, Th } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { StatCard } from "@/components/ui/stat-card";
import { useSelectedChild } from "@/lib/selected-child";
import { MY_CHILDREN } from "@/lib/vocabulary";
import { z } from "zod";

const listSchema = paginated(childSummarySchema);
const ownSchema = z.array(childSummarySchema);

/**
 * Find a child.
 *
 * Two audiences, one route — see `(app)/layout.tsx` for why the route tree is
 * shared. A teacher gets a searchable, paginated list of everyone in their
 * groups; a parent gets their own children, which is one or two rows and needs
 * neither search nor pagination.
 *
 * The split is by role because the *endpoints* differ (`/children` versus
 * `/children/mine`), not because the UI hides anything: `/children` already
 * returns only what the caller may see.
 */
export default function ChildrenPage() {
  const { hasRole } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");

  /*
    ★ Wrapped in `RequireRole` since 2026-08-30, and the reason is the two
    roles added that day.

    The branch below is a fork between two audiences, not a gate: anyone who is
    not staff got `MyChildren`. That was true while the only other role was
    PARENT. A cook now falls into the same branch and meets "Миний хүүхдүүд ·
    Таны бүртгэлтэй хүүхдүүд" — the API returns nothing, so no record leaks,
    but the screen tells an employee the app thinks they are somebody's parent.

    The list is the roles that have children to see, which is the question this
    route actually answers.
  */
  return (
    <RequireRole roles={["TEACHER", "ADMIN", "PARENT"]}>
      {isStaff ? <StaffChildren /> : <MyChildren />}
    </RequireRole>
  );
}

// ── Staff ────────────────────────────────────────────────────────────────────

/**
 * ★ `?q=` seeds the box, and changing it re-seeds the box.
 *
 * `PageHeader`'s search submits to `/children?q=…` from any screen. Its docblock
 * has always said "the list picks the term up from the URL and takes over" —
 * this is the half that was missing. Without it the header field navigated here
 * and landed on a complete, unfiltered roster with an empty search box, which
 * reads as "no results for a name I can see on the list".
 *
 * ★★ The URL seeds the state; it is not the state.
 *
 * Typing here stays local and debounced. Writing every keystroke back to the URL
 * is precisely what `HeaderSearch` avoids doing — it would push a history entry
 * per character — and it is not needed, because the only thing that has to
 * survive a navigation is the term someone arrived with.
 */
/** Rows per page — see the note beside `filters` in `StaffChildren`. */
/**
 * How many children the ESIS roster panel shows.
 *
 * ★ 100, the API's maximum, and no pager. The panel is a table of the
 * kindergarten's own children under ESIS's field names; a page boundary inside
 * it would mean a child's record was unreachable from this screen for no reason
 * a reader could see. A kindergarten does not have more than a hundred
 * children; if one ever does, this needs a pager and the panel needs to say so.
 */
const ROSTER_SIZE = 100;

function StaffChildren() {
  const { primaryKindergartenId, hasRole } = useSession();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";

  /*
   * ★ Whether this reader is the institution's or one group's — 2026-09-22, the
   * client: "Багш: Зөвхөн тухайн бүлгийн суралцагчдын нэр харагдана."
   *
   * It decides which roster the screen draws, and the distinction is the whole
   * point of the change: `students/list` is the ministry's roll for the
   * **institution** and takes no group parameter, so a teacher reading it saw
   * all 93 children including every group but their own. `GET /children` is
   * already scoped — `visibleChildrenWhere` admits a teacher only to children
   * enrolled in a group they teach — so the fix is to draw the list the product
   * already had rather than to filter the ministry's after the fact.
   *
   * ★★ A director keeps the ESIS panel. Their question *is* the institution's
   * roll, which is why it was put here on 2026-09-08, and nothing about this
   * request narrows it: "Эцэг эхээс бусад бүх хэсэгт" asked for the ESIS
   * panels to be smaller, not for a director to stop seeing them.
   */
  const isAdmin = hasRole("ADMIN");

  /*
   * ★ A search box on the screen again — 2026-09-09, at the client's request
   * ("нэмэлтээр хайдаг болгох").
   *
   * `?q=` from the header search has driven this roster all along, but with no
   * field on the page the only way to narrow it was to type in the header and
   * navigate. The state seeds from the URL so arriving from the header still
   * shows the term, and typing here does not touch the URL — a search is a
   * view of this screen, not a place to come back to.
   */
  const [typed, setTyped] = useState(urlQuery);
  useEffect(() => setTyped(urlQuery), [urlQuery]);

  /*
   * ★ What is left of the roster query: a total and an export.
   *
   * The list it fed is gone (see the panel below), but two things above still
   * read it — the "Нийт" count in the header and the Excel link, which exports
   * the whole roster now that there are no filters on screen to narrow it.
   */
  const [facets] = useState<RosterFacets>(NO_FACETS);
  const search = useDebounced(typed.trim());

  const exportParams = rosterParams(search, facets).toString();
  const exportQuery = exportParams ? `?${exportParams}` : "";

  const { data } = useQuery({
    queryKey: qk.children({ q: search || undefined, ...facets, page: 1, pageSize: ROSTER_SIZE }),
    queryFn: () => {
      const params = rosterParams(search, facets);
      params.set("page", "1");
      params.set("pageSize", String(ROSTER_SIZE));
      return get(`/children?${params}`, listSchema);
    },
  });

  /*
   * ★ An ESIS row → this kindergarten's own child, by name and date of birth.
   *
   * Added 2026-09-14 so a name in the roster below still opens the record it
   * names. `EsisDataPanel` drops the caller's `hrefs` the moment ESIS answers,
   * and rightly: the ministry's roster is not in our order and need not be the
   * same set of children. So the link has to be derived from the row.
   *
   * ★★ Name **and** birth date, the pairing `attendance.service.ts` and
   * `funding/food-discount.ts` both use. Two children called Б.Сараа in one
   * kindergarten is ordinary; both born the same day is not. A row that
   * matches nothing — a child ESIS holds and we have not registered — or
   * matches twice leads nowhere, rather than opening somebody else's record.
   */
  const childHref = (row: Record<string, string | null>) => {
    const name = `${row.lastName ?? ""} ${row.firstName ?? ""}`.trim().toLocaleLowerCase("mn-MN");
    const birthday = (row.dateOfBirth ?? "").slice(0, 10);
    if (!name || !birthday) return null;

    const matches = (data?.items ?? []).filter(
      (child) =>
        `${child.lastName} ${child.firstName}`.trim().toLocaleLowerCase("mn-MN") === name &&
        child.dateOfBirth.slice(0, 10) === birthday,
    );

    return matches.length === 1 ? `/children/${matches[0]!.id}/general` : null;
  };

  /*
   * ★ **The hand-built roster rows are gone — 2026-09-14.**
   *
   * This screen used to dress its own children in ESIS's field names: local
   * values for the person fields, the catalog's first *sample* row underneath
   * for everything ESIS carries and we do not, and a `personId` counted up from
   * 90000000000001 per row. It then rendered that under the heading
   * "Суралцагчийн жагсаалт", which is the name of a ministry service.
   *
   * Nothing on the screen said which columns were real. A director reading a
   * programme code or an official e-mail off that table was reading a value
   * this application invented, presented as ESIS's answer — the sharpest case
   * of what the client stopped on 2026-09-14 ("ene esis ni real zuil shuu").
   *
   * `EsisDataPanel` below reads `students/list` itself and shows what comes
   * back, or `EsisNoAnswer` naming the endpoint that did not.
   *
   * ★★ **This note used to end "the local roster is still on this screen in its
   * own table above", and it was not** — corrected 2026-09-22. Nothing rendered
   * `data.items`; the query survived only to feed the header's count, the Excel
   * link and `childHref`'s name match. So the sentence describing where a local
   * roster belongs was the only place it existed, and for a teacher that left
   * the ministry's institution-wide roll as the sole list of children on the
   * screen. `LocalRoster` below is that table, and it is what the teacher gets.
   */

  return (
    <div className="page-band">
      <PageHeader
        title="Суралцагч"
        backHref="/dashboard"
        actions={
          /*
            ★ `flex-wrap`, and `gap-2` until there is room for `gap-3`.

            Four controls — the count and three buttons — do not fit one line at
            390px, and this row was the widest thing on the page. Wrapping is
            the honest answer: every action stays visible and tappable, and the
            primary "Хүүхэд бүртгэх" is last so it lands on the second line
            rather than being the one that falls off the edge.

            `justify-end` matches the header's own alignment, so on a desktop —
            where all four still share a line — nothing moves.
          */
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            {/*
              No role check: guardians never reach this component — the page
              routes them to `MyChildren`, which has nothing to register.
            */}
            {/*
              Export and import — RFP §3.4, §12.3.

              ★ The export carries the filters currently on screen, so "export
              what I am looking at" is what happens. It is a link rather than a
              fetch: the session cookie rides along on a navigation and the
              browser saves the file itself.
            */}
            {primaryKindergartenId ? (
              <>
                <Button asChild size="sm" variant="secondary">
                  <a
                    href={downloadUrl(
                      `/kindergartens/${primaryKindergartenId}/children/export${exportQuery}`,
                    )}
                  >
                    <Download size={16} aria-hidden /> Excel
                  </a>
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <Link href="/children/import">
                    <Upload size={16} aria-hidden /> Импорт
                  </Link>
                </Button>
              </>
            ) : null}
            <Button asChild size="sm">
              <Link href="/children/new">
                <Plus size={16} aria-hidden /> Хүүхэд бүртгэх
              </Link>
            </Button>
          </div>
        }
      />

      <EsisDataPanel
        resource="studentByRegister"
        title="РД-ээр сурагч хайх"
        description="Сурагчийн мэдээллийг ESIS-ээс регистрийн дугаараар хайна"
      />

      {/*
        ★ Director only, since 2026-09-22 — and this one is the reason the
        change is not cosmetic.

        `RosterSummary` counts the rows `?resource=students` returned, so it
        fetched the institution's whole roll into the reader's browser to
        report three figures. For a teacher that is both the wrong number —
        93 where their group has twenty — and every child's name and birth date
        travelling to a machine that should not have asked. Gating the panel is
        what stops the *request*, which is the part a heading cannot hide.

        The teacher's count lives on `LocalRoster`'s own header instead, over
        the rows they can actually see.
      */}
      {isAdmin ? <RosterSummary /> : null}

      {/*
        ★ The kindergarten's own roster, scoped by the API — 2026-09-22.

        A teacher gets their groups' children and nothing else, because
        `visibleChildrenWhere` resolves a teacher to the groups they are
        assigned to. That is the property this table is here for: it is not a
        filtered view of the institution's roll, it is a different question
        asked of a different source.
      */}
      <LocalRoster rows={data?.items ?? []} total={data?.total ?? 0} search={search} />

      {/*
        ★ The roster, from ESIS — 2026-09-08, at the client's instruction,
        given twice with the consequence written out first.

        ★★ **Director only, since 2026-09-22.** `students/list` is the
        institution's roll and takes no group parameter, so there is no such
        thing as a teacher-shaped read of it — the client asked that a teacher
        see only their own group, and the honest way to give a service that
        answers one question to somebody who may only know part of the answer
        is not to give it to them. The teacher's list is `LocalRoster` above.

        The local roster is gone, and with it its search, its three filters,
        its pager, the row that opened a child's record, the selection and the
        Excel export. Those routes still exist and still work; nothing on this
        screen reaches them any more. `RosterSummary` above is kept because it
        counts rather than lists — ESIS does not answer "how many, what mean
        age", and a tile is not a second copy of a table.

        ★★ Both services, because they answer different questions: `students`
        is the whole roster, `studentByRegister` is one child a teacher or
        director already holds a document for.

        ★★★ The register search is the one panel whose parameter is a person.
        Every other service pre-fills its ids in demo mode; this one cannot,
        because there is no such thing as a safe invented national identifier
        to put in a form. It stays empty until the staff member types the number,
        we send it, and we keep none of it — `personRegNumber` is a refused
        output here exactly as it is on the roster service (`ESIS_REQUEST.md`
        §1.1 (b)).

        ★★★★ Both panels read the role-scoped catalog. API-000144 belongs to
        both ADMIN and TEACHER, while every other role receives neither the
        catalog entry nor permission to call it.
      */}
      {isAdmin ? (
        <EsisDataPanel
          resource="students"
          /*
          ★ "Жагсаалт", not "ерөнхий мэдээлэл" — 2026-09-09, the client's own
          correction: "ерөөсөө ерөнхий мэдээлэл биш байсан байна".

          `api-8` is `students/list` and returns the roll. A per-student general
          record is a different service (`API-000147`), and a panel titled for
          it would send a director looking for one child's file in a table of
          every child. The catalog's own name for this service has been
          "Суралцагчийн жагсаалт" all along.
        */
          title="Суралцагчийн жагсаалт"
          description="Бүртгэл, бүлэг, элсэлтийн төлөв"
          liveHref={childHref}
          linkField="firstName"
          /*
          ★ A camera on every record we can actually put a photograph on —
          2026-09-20, the client: "жагсаалтаас шууд зураг нэмэх".

          `childHref` is reused as the test rather than repeating the match: if
          the record leads to a child's page then that child is ours, and if it
          leads nowhere offering an upload would promise somewhere to put it.
        */
          rowActions={(row) => {
            const href = childHref(row);
            if (!href) return null;
            return (
              <ChildPhotoButton
                childId={href.split("/")[2]!}
                childName={`${row.lastName ?? ""} ${row.firstName ?? ""}`.trim()}
                variant="inline"
              />
            );
          }}
          /*
           * ★ Reads on open — 2026-09-14, at the client's instruction: "esis ees
           * tatsan medeelluud yr ni haragdahgui baihiin."
           *
           * It did not need to before: the panel fell back to the catalog's
           * sample rows, so the table looked populated whether or not anything
           * had been read. With the samples gone, a panel that waits for a press
           * is a panel that shows nothing — and this is the screen about
           * children, where the roster is the content rather than a reference.
           *
           * ★★ Safe to do here because `students/list` takes no parameter
           * beyond the institution: one call on open, `staleTime: Infinity`, no
           * refetch on focus. The three panels below keep their buttons because
           * each needs an id or a date the reader has to supply first — reading
           * those automatically would mean guessing a group, a register number
           * or a date, and calling the ministry about it.
           */
          autoRead
        />
      ) : null}
      {/*
        ★ The group roster, beside the whole one — 2026-09-09, at the client's
        request ("тэр хүүхдүүд дээр бүлгийн суралцагчийн жагсаалт api-13").
        It was on the attendance register; one home per service, and this is
        the screen about children.
      */}
      <EsisDataPanel
        resource="groupStudents"
        title="Бүлгийн суралцагчийн жагсаалт"
        description="ESIS-д нэг бүлэгт бүртгэлтэй хүүхдүүд"
      />
      {/*
        ★ Суралцагчийн хөдөлгөөн — the last service in the catalog that had
        never been drawn anywhere, placed 2026-09-09 ("Ашиглагдаагүй 7
        ашигла").

        ★★ No grant accompanies it. `studentMovements` has always been callable
        by ADMIN, which resolves to every key; it simply had no screen. It
        stays admin-only rather than joining the teacher's list: a transfer
        register — who arrived, who left, when — is the director's question
        about the institution, not a teacher's about their group. The panel
        renders nothing for a role whose catalog omits the key, so a teacher
        opening this screen sees the roster and no hole where a permission
        failed.

        `beginDate` is the one input, and the panel asks for it. That *is* the
        question this service answers ("хөдөлгөөн хэзээнээс хойш"), so unlike
        a product code it is a parameter the reader actually holds.
      */}
      <EsisDataPanel
        resource="studentMovements"
        title="Суралцагчийн хөдөлгөөн"
        description="Тухайн өдрөөс хойшх элсэлт, шилжилт, гарсан бүртгэл"
        actionLabel="Хөдөлгөөн татах"
      />
    </div>
  );
}

// ── Filters and sorting — RFP §11 ───────────────────────────────────────────

/**
 * Everything the roster query carries besides the search term and the page.
 *
 * One object rather than five `useState`s so that "narrowing changed, go back
 * to page one" is a single call, and so the list and its summary are passed
 * literally the same value.
 */
export interface RosterFacets {
  /**
   * ★ The facet a director asked for first, and the only one the API already
   * understood without being asked.
   *
   * `listChildrenQuerySchema` has taken `groupId` since the roster was written;
   * nothing on this screen ever sent it, so "show me Дэлбээ бүлэг" was
   * answerable only by opening a group's register — a different screen, for a
   * different job, that cannot export or sort.
   */
  groupId?: string;
  sex?: "MALE" | "FEMALE";
  ageMin?: number;
  ageMax?: number;
  sort: "name" | "dateOfBirth" | "age" | "updatedAt";
  order: "asc" | "desc";
}

const NO_FACETS: RosterFacets = { sort: "name", order: "asc" };

/**
 * The kindergarten's own children, as a table.
 *
 * ★ Back on the screen 2026-09-22, because a teacher had no list of their own
 * group. What replaced it on 2026-09-08 was `students/list` — the ministry's
 * roll for the whole institution — and the client's instruction that day was
 * about a director's screen. A teacher reading the same panel saw every child
 * in the building, which is what this restores the answer to.
 *
 * ★★ It renders whatever `GET /children` returned and filters nothing itself.
 * That is deliberate and it is the security property: the scoping lives in
 * `visibleChildrenWhere`, so a teacher's rows are their groups' children before
 * this component ever sees them. A `groupId` filter added here would read as
 * the thing doing the work and would be trivially removable — CLAUDE.md §4.1's
 * argument for testing the route rather than the predicate.
 *
 * ★★★ Names as `shortName` — "С.Бямбараш", the client 2026-09-22. `fullName`
 * spent most of a narrow row on the half a teacher does not read; the register
 * column beside it is the one that disambiguates two children called Б.Сараа.
 */
function LocalRoster({
  rows,
  total,
  search,
}: {
  rows: {
    id: string;
    lastName: string;
    firstName: string;
    nationalId?: string | null;
    isForeign?: boolean | null;
    foreignId?: string | null;
    dateOfBirth: string;
    photoMediaFileId?: string | null;
    enrollments?: { group?: { name?: string | null } | null; status?: string | null }[];
  }[];
  total: number;
  search: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title={search ? "Хайлтад тохирох хүүхэд олдсонгүй" : "Бүртгэгдсэн хүүхэд байхгүй"}
        description={
          search
            ? "Өөр нэр эсвэл регистрийн дугаараар хайж үзнэ үү."
            : "ESIS-ээс татах эсвэл «Хүүхэд бүртгэх»-ээр нэг нэгээр нэмнэ."
        }
      />
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-body font-semibold text-ink">Суралцагчид</h2>
        {/*
          ★ The count is the *table's* count, not the kindergarten's.

          `total` is what the API said matched the filter; `rows.length` is what
          `ROSTER_SIZE` let through. Showing only `total` above a shorter table
          is the disagreement `RosterSummary`'s own note warns about, so when
          they differ the row count leads and the total is named as the total.
        */}
        <p className="text-caption text-muted">
          {rows.length < total ? `${rows.length} / ${total}` : `${total}`} хүүхэд
        </p>
      </div>

      <TableShell caption="Суралцагчдын жагсаалт" minWidth="min-w-0" stacked>
        <thead>
          <tr>
            <Th>Нэр</Th>
            <Th>Регистр</Th>
            <Th>Бүлэг</Th>
            <Th>Нас</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((child) => {
            const enrollment =
              child.enrollments?.find((row) => row.status === "ACTIVE") ?? child.enrollments?.[0];
            /*
              ★ A foreign child's identifier stands in for the регистр, and the
              two are labelled apart rather than both rendering as a number in
              the same column. `childSummarySchema`'s own note makes the case:
              "—" for a foreign child reads identically to "—" for a child whose
              регистр nobody has typed yet, and only the second is a to-do.
            */
            const register = child.isForeign
              ? child.foreignId
                ? `${child.foreignId} (гадаад)`
                : "Гадаад иргэн"
              : (child.nationalId ?? "—");

            return (
              <tr key={child.id}>
                <Td data-label="Нэр">
                  <Link
                    href={`/children/${child.id}/general`}
                    className="flex min-w-0 items-center gap-2 font-medium text-ink hover:underline"
                  >
                    <ChildAvatar child={child} size={28} />
                    <span className="min-w-0 truncate">{shortName(child)}</span>
                  </Link>
                </Td>
                <Td data-label="Регистр" className="tabular-nums">
                  {register}
                </Td>
                <Td data-label="Бүлэг">{enrollment?.group?.name ?? "—"}</Td>
                <Td data-label="Нас">{formatAge(child.dateOfBirth)}</Td>
              </tr>
            );
          })}
        </tbody>
      </TableShell>
    </section>
  );
}

/**
 * The query string for both roster requests.
 *
 * ★ Written once because the two must not diverge.
 *
 * `RosterSummary` heads the list with a total and a mean age, over the *same*
 * filter. It built its own params from `search` alone; adding sex and an age
 * range to the list only would make the header report twelve children above a
 * list showing four. The API extracted `childFilters` one layer down for the
 * same reason.
 *
 * `includeSort` is false for the summary: an order changes nothing about a
 * count, and sending it would put a meaningless key in the query cache.
 */
function rosterParams(
  search: string,
  facets: RosterFacets,
  options: { includeSort?: boolean } = {},
): URLSearchParams {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (facets.groupId) params.set("groupId", facets.groupId);
  if (facets.sex) params.set("sex", facets.sex);
  if (facets.ageMin !== undefined) params.set("ageMin", String(facets.ageMin));
  if (facets.ageMax !== undefined) params.set("ageMax", String(facets.ageMax));

  if (options.includeSort ?? true) {
    params.set("sort", facets.sort);
    params.set("order", facets.order);
  }
  return params;
}

/**
 * The three figures above the roster, **counted from ESIS's own answer**.
 *
 * ★ Rewritten 2026-09-14, at the client's instruction: "local data gej
 * baihgui bugd l esis ees tatagdana shuu."
 *
 * It read `/children/summary`, which counts this kindergarten's own rows
 * server-side. That put two sources on one screen — a local total above a
 * ministry roster below — and the two disagree the moment ESIS enrols a child
 * we have not imported, or we hold one ESIS has moved on. A director reading
 * "Нийт 83" over a table of 84 has no way to tell which number is wrong.
 *
 * ★★ Same query key as the panel beneath it, so this is **not a second call**:
 * React Query serves both from one response. One request, one answer, two
 * renderings of it — which is also why the numbers cannot drift apart.
 *
 * ★★★ The sex split is counted from `genderCode`, ESIS's own field. A row
 * without one falls into neither figure and the card says so, exactly as it
 * did when the count was local — a child whose sex is unrecorded is in the
 * roster and in neither half.
 */
function RosterSummary() {
  const { primaryKindergartenId } = useSession();

  const catalog = useQuery({
    queryKey: qk.esisCatalog(primaryKindergartenId ?? "none"),
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/esis/catalog`, esisScopedCatalogSchema),
    enabled: Boolean(primaryKindergartenId),
    retry: false,
  });

  const read = useQuery({
    queryKey: qk.esisResource(primaryKindergartenId ?? "none", "students", "resource=students"),
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}/esis/resource?resource=students`,
        esisResourceReadSchema,
      ),
    enabled: Boolean(primaryKindergartenId) && Boolean(catalog.data?.canRead),
    /*
     * The panel below sets exactly these: every read is an outbound call to
     * the ministry and an `AuditLog` VIEW row, so alt-tabbing must not repeat
     * it. Matching them is what makes the two components share one response
     * rather than race for two.
     */
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    retry: false,
  });

  const rows = read.data?.status === "SUCCEEDED" ? read.data.rows : null;
  // No figures over a failed read: a zero would read as "no children".
  if (!rows) return null;

  const data = {
    total: rows.length,
    girls: rows.filter((row) => row.genderCode === "F").length,
    boys: rows.filter((row) => row.genderCode === "M").length,
  };

  /*
    Not `data.total`: a child whose sex has not been recorded is in the roster
    and in neither figure, so a bar drawn against the roster would show a gap
    that stands for nothing. `gender-ratio.tsx` on the dashboard divides by the
    same sum for the same reason.
  */
  const counted = data.boys + data.girls;

  /*
   * ★ The ministry's own count — the number of rows `students/list` returned.
   *
   * The client asked on 2026-09-09 that this figure come from the ESIS data,
   * and until 2026-09-14 it did not: it read the ESIS table's row count, but
   * those rows were this screen's own children relabelled, so the number was
   * never the ministry's. It was the local total by a longer route, and past
   * `ROSTER_SIZE` it disagreed with itself — the table was capped and the
   * count was not.
   *
   * Now the table and this card read one response, so there is no second
   * number to drift.
   */
  const total = data.total;

  return (
    <section aria-label="Товч тоо" className="flex flex-col gap-2 md:gap-3">
      {/*
        ★ "Дундаж нас" went and the sex split arrived — 2026-09-06, at the
        client's request: "дундаж нас хэрэггүй арилга, нэмэлтээр хүйсийн
        харьцаагийн dashboard нэм".

        The mean age was a number nobody acted on. Six children aged 2 and six
        aged 5 average to the same figure as twelve aged 3½, and the roster's
        own age filter answers the question that was actually being asked of
        it. The split is the figure a director is asked for — by the ministry,
        on every annual return — and it is one the roster can answer exactly.

        ★★ It narrows with the filters, because it is `RosterSummary`'s own
        data. Selecting a group gives that group's split, which is what makes
        it worth having on this screen rather than only on the dashboard.
      */}
      {/*
        ★ Three across at every width — 2026-09-09.

        "Нийт хүүхэд" spanned both phone columns, so a two-digit number sat in a
        full-width card with the other half empty, and "Хөвгүүд" then wrapped to
        a row of its own beside a hole. Three equal cells is what the three
        figures are: one count and its two parts.
      */}
      <div className="grid grid-cols-3 gap-2 md:gap-3">
        {/*
          ★ The split is drawn inside the cards — 2026-09-09, at the client's
          request, and it replaces the ratio bar that used to sit under them.

          The bar was a fourth card restating what the three above it already
          counted, and each of those three left its right-hand half empty. The
          donut on the total shows the whole division at a glance; the two rings
          show each half's share of it. Same three numbers, one row instead of
          two, and the shape is read before any of them.

          ★★ Hidden below `md`, not shrunk. Three cards across a 390px screen
          leave about 118px each, and a ring in that width squeezes the figure
          it is meant to illustrate — the mistake `StatCard`'s own note records
          about the art that used to close these cards.
        */}
        <StatCard
          label="Нийт хүүхэд"
          value={total}
          art={<Art name="child" size={36} />}
          artSurface={false}
          tone="cornflower"
          className="teacher-stat-card teacher-stat-cornflower"
          chart={
            counted > 0 ? (
              <Donut
                size={56}
                className="hidden md:block"
                label={`${data.girls} охин, ${data.boys} хүү`}
                segments={[
                  { label: "Охид", value: data.girls, tone: "pink" },
                  { label: "Хөвгүүд", value: data.boys, tone: "sky" },
                ]}
              />
            ) : undefined
          }
          footer={
            counted > 0 && counted < total ? (
              <p className="text-caption text-muted">
                {total - counted} хүүхдийн хүйс бүртгэгдээгүй.
              </p>
            ) : undefined
          }
        />
        <StatCard
          label="Охид"
          value={data.girls}
          art={<Venus size={22} />}
          tone="pink"
          className="teacher-stat-card teacher-stat-pink"
          chart={
            counted > 0 ? (
              <Ring
                size="sm"
                tone="pink"
                percent={(data.girls / counted) * 100}
                label={`Охид ${Math.round((data.girls / counted) * 100)}%`}
                className="hidden md:grid"
              />
            ) : undefined
          }
        />
        <StatCard
          label="Хөвгүүд"
          value={data.boys}
          art={<Mars size={22} />}
          tone="sky"
          className="teacher-stat-card teacher-stat-sky"
          chart={
            counted > 0 ? (
              <Ring
                size="sm"
                tone="sky"
                percent={(data.boys / counted) * 100}
                label={`Хөвгүүд ${Math.round((data.boys / counted) * 100)}%`}
                className="hidden md:grid"
              />
            ) : undefined
          }
        />
      </div>
    </section>
  );
}

// ── Parent ───────────────────────────────────────────────────────────────────

function MyChildren() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.myChildren(),
    queryFn: () => get("/children/mine", ownSchema),
  });
  const { setSelectedChildId } = useSelectedChild();

  return (
    <div className="page-band">
      {/*
        ★ The same Буцах the staff header above carries — 2026-09-16. A family
        arrives here from the dashboard's own Суралцагч tile, and this was the
        one branch of the route that opened without a way back to it.
      */}
      <PageHeader title={MY_CHILDREN} backHref="/dashboard" />

      {isLoading ? <LoadingState rows={2} /> : null}

      {isError ? (
        <ErrorState
          description={errorMessage(error)}
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Дахин оролдох
            </Button>
          }
        />
      ) : null}

      {data && data.length === 0 ? (
        <EmptyState
          icon={<Image src="/background/mascot-family.webp" alt="" width={96} height={96} />}
          title="Хүүхэд холбогдоогүй байна"
          description="Танд холбогдсон хүүхэд байхгүй байна. Цэцэрлэгийн багштайгаа холбогдоно уу."
        />
      ) : null}

      {data && data.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {data.map((child) => (
            <Link
              key={child.id}
              href={`/children/${child.id}/general`}
              onClick={() => setSelectedChildId(child.id)}
              className="block"
            >
              <Card
                pad="roomy"
                className="flex min-h-[88px] items-center gap-3 hover:bg-canvas md:gap-4"
              >
                <ChildAvatar child={child} size={56} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{fullName(child)}</span>
                  <span className="block text-body text-muted">{formatAge(child.dateOfBirth)}</span>
                </span>
              </Card>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

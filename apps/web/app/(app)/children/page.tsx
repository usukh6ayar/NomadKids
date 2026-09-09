"use client";

import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Download, Mars, Plus, Search, Upload, Venus } from "lucide-react";
import { useEffect, useState } from "react";
import {
  CHILD_STATUS_LABEL,
  SEX_LABEL,
  childSummarySchema,
  esisScopedCatalogSchema,
  paginated,
  rosterSummarySchema,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
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
import { Input } from "@/components/ui/field";
import { Card } from "@/components/ui/card";
import { formatAge, fullName } from "@/lib/format";
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
  const { primaryKindergartenId } = useSession();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";

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
   * ★ The scoped catalog, so a teacher gets these rows too — 2026-09-09.
   *
   * This read the operator's `/esis`, which is `@Roles("ADMIN")`, so the roster
   * table below rendered for administrators alone. `students` is one of the
   * teacher's six services, and this screen is theirs as much as anybody's.
   */
  const esis = useQuery({
    queryKey: qk.esisCatalog(primaryKindergartenId ?? "none"),
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/esis/catalog`, esisScopedCatalogSchema),
    enabled: Boolean(primaryKindergartenId),
    retry: false,
  });

  /*
   * ★ The roster, in the shape the суралцагч service returns it.
   *
   * The catalog's own demo roster is ten invented people, and a link on one of
   * them leads nowhere — which is why removing the local list took the way into
   * a child's record with it. These rows are this kindergarten's children, laid
   * out under ESIS's field names, so the table reads as the service's answer
   * *and* every row opens the record it names.
   *
   * ★★ Built over the catalog's first sample row, so the fields ESIS carries
   * and we do not — the programme codes, the official e-mails — keep their
   * illustrative values instead of leaving twenty columns of "—". The person
   * fields are the child's own. `personId` varies per row because one number
   * repeated down a roster is the detail that makes a demonstration look like a
   * mock-up; it is invented exactly as the catalog's ten are.
   */
  const students = esis.data?.endpoints.find((endpoint) => endpoint.key === "students");
  const rosterRows = data?.items.map((child, index) => ({
    ...(students?.sampleRows[0] ?? {}),
    personId: String(90000000000000 + index + 1),
    lastName: child.lastName,
    firstName: child.firstName,
    lastNameMgl: child.lastName,
    firstNameMgl: child.firstName,
    dateOfBirth: child.dateOfBirth.slice(0, 10),
    genderCode: child.sex === "FEMALE" ? "F" : "M",
    genderName: (child.sex && SEX_LABEL[child.sex]) || "—",
    studentGroupName: child.enrollments[0]?.group?.name ?? "—",
    academicLevelName: child.enrollments[0]?.group?.ageBand ?? "—",
    programStatusName: CHILD_STATUS_LABEL[child.status ?? "ACTIVE"] ?? "—",
  }));
  const rosterHrefs = data?.items.map((child) => `/children/${child.id}/general`);

  return (
    <div className="page-band">
      <PageHeader
        title="Хүүхдүүд"
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
            {data ? (
              <p className="text-body text-muted" aria-live="polite">
                Нийт {data.total}
              </p>
            ) : null}
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

      <RosterSummary search={search} facets={facets} esisCount={rosterRows?.length} />

      <div className="relative">
        <Search
          size={18}
          aria-hidden
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
        />
        <Input
          type="search"
          // A visible label would be redundant beside a magnifier and a
          // placeholder this explicit, but a screen reader still needs one.
          aria-label="Хүүхдийн нэрээр хайх"
          placeholder="Нэр эсвэл овгоор хайх"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          className="pl-11"
        />
      </div>

      {/*
        ★ The roster, from ESIS — 2026-09-08, at the client's instruction,
        given twice with the consequence written out first.

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
        rows={rosterRows}
        hrefs={rosterHrefs}
        linkField="firstName"
      />
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
      <EsisDataPanel
        resource="studentByRegister"
        title="РД-ээр хайх"
        description="Суралцагчийн мэдээллийг регистрийн дугаараар ESIS-ээс хайх"
        actionLabel="РД-ээр хайх"
        showResponseDetails
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

function RosterSummary({
  search,
  facets,
  esisCount,
}: {
  search: string;
  facets: RosterFacets;
  /**
   * How many children the ESIS roster below this screen is showing.
   *
   * ★ 2026-09-09, at the client's request: "тэр нийт хүүхэд гэсэн тоог тэр
   * ESIS-ээс татсан датагийн хүүхдийн тооноос авдаг болго."
   *
   * Both numbers come from the same query with the same filters, so they agree
   * — and being the *same* number is the point: a director who counts the rows
   * in the table and reads the card above it must not find two answers. The
   * sex split still comes from `/children/summary`, which counts server-side
   * rather than folding whatever rows loaded.
   */
  esisCount?: number;
}) {
  const filters = { q: search || undefined, ...facets };

  const { data } = useQuery({
    queryKey: qk.rosterSummary(filters),
    queryFn: () => {
      // ★ The same builder the list uses. Sorting is dropped by `rosterParams`
      // for this call — it changes an order and means nothing to a total — but
      // every filter is shared, so the header cannot narrow differently from
      // the rows beneath it.
      const params = rosterParams(search, facets, { includeSort: false });
      const query = params.toString();
      return get(`/children/summary${query ? `?${query}` : ""}`, rosterSummarySchema);
    },
    // The roster is the point of this screen; its totals are context. A failure
    // here removes the cards rather than the list.
    retry: false,
  });

  if (!data) return null;

  /*
    Not `data.total`: a child whose sex has not been recorded is in the roster
    and in neither figure, so a bar drawn against the roster would show a gap
    that stands for nothing. `gender-ratio.tsx` on the dashboard divides by the
    same sum for the same reason.
  */
  const counted = data.boys + data.girls;

  /*
   * ★ The ESIS table's row count when there is one, the endpoint's total
   * otherwise — the fallback covers the first paint, before that query lands.
   *
   * They differ only past `ROSTER_SIZE`, where the table is capped and the
   * total is not. A kindergarten of more than a hundred children needs a pager
   * on that table before this figure means anything, and the panel says so.
   */
  const total = esisCount ?? data.total;

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
      <PageHeader title={MY_CHILDREN} />

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

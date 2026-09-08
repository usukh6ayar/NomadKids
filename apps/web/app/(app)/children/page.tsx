"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Download, Mars, Plus, Upload, Venus } from "lucide-react";
import {
  CHILD_STATUS_LABEL,
  SEX_LABEL,
  childSummarySchema,
  esisOverviewSchema,
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
import { Button } from "@/components/ui/button";
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
  const { primaryKindergartenId, hasRole } = useSession();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";

  /*
   * ★ What is left of the roster query: a total and an export.
   *
   * The list it fed is gone (see the panel below), but two things above still
   * read it — the "Нийт" count in the header and the Excel link, which exports
   * the whole roster now that there are no filters on screen to narrow it.
   */
  const [facets] = useState<RosterFacets>(NO_FACETS);
  const search = useDebounced(urlQuery.trim());

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

  const esis = useQuery({
    queryKey: qk.esis(primaryKindergartenId ?? "none"),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/esis`, esisOverviewSchema),
    enabled: Boolean(primaryKindergartenId) && hasRole("ADMIN"),
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

      <RosterSummary search={search} facets={facets} />

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
        is the whole roster, `studentByRegister` is one child the director
        already holds a document for.

        ★★★ The register search is the one panel whose parameter is a person.
        Every other service pre-fills its ids in demo mode; this one cannot,
        because there is no such thing as a safe invented national identifier
        to put in a form. It stays empty until the director types the number,
        we send it, and we keep none of it — `personRegNumber` is a refused
        output here exactly as it is on the roster service (`ESIS_REQUEST.md`
        §1.1 (b)).

        ★★★★ Neither panel renders for a teacher: the route behind them
        answers 404 to anybody but an administrator of this kindergarten. A
        teacher opening `/children` now sees the summary and nothing else.
      */}
      <EsisDataPanel
        resource="students"
        title="Хүүхдүүд"
        description="Суралцагчийн бүртгэл, бүлэг, элсэлтийн төлөв"
        rows={rosterRows}
        hrefs={rosterHrefs}
        linkField="firstName"
      />
      <EsisDataPanel
        resource="studentByRegister"
        title="Регистрээр хайх"
        description="Нэг хүүхдийг регистрийн дугаараар олох"
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

function RosterSummary({ search, facets }: { search: string; facets: RosterFacets }) {
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
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-3">
        <StatCard
          label="Нийт хүүхэд"
          value={data.total}
          unit="хүүхэд"
          art={<Art name="child" size={36} />}
          artSurface={false}
          tone="sky"
          className="teacher-stat-card teacher-stat-sky col-span-2 md:col-span-1"
        />
        <StatCard
          label="Охид"
          value={data.girls}
          unit="хүүхэд"
          art={<Venus size={22} />}
          tone="peach"
          className="teacher-stat-card teacher-stat-peach"
        />
        <StatCard
          label="Хөвгүүд"
          value={data.boys}
          unit="хүүхэд"
          art={<Mars size={22} />}
          tone="mint"
          className="teacher-stat-card teacher-stat-mint"
        />
      </div>

      {/*
        The ratio itself, as one bar.

        Two counts answer "how many"; a length answers "how does it split", and
        the eye reads the second off a bar faster than off a pair of numerals.
        Percentages are printed beside it rather than inside the segments — a
        one-child segment has no room for a label, and a bar whose text vanishes
        at small values is a bar that fails exactly when it is most surprising.

        Hidden when nobody's sex is recorded: an empty rule reads as a
        rendering fault, and the three cards above already say so by showing
        zeroes.
      */}
      {counted > 0 ? (
        <Card pad="compact" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-body text-muted">Хүйсийн харьцаа</p>
            <p className="text-body tabular-nums text-muted">
              {Math.round((data.girls / counted) * 100)}% ·{" "}
              {Math.round((data.boys / counted) * 100)}%
            </p>
          </div>
          <div
            role="img"
            aria-label={`${data.girls} охин, ${data.boys} хүү`}
            className="flex h-2.5 overflow-hidden rounded-pill bg-border-soft"
          >
            {/* Inline widths: the split is data, and a Tailwind class cannot
                express an arbitrary percentage. */}
            <span className="bg-peach" style={{ width: `${(data.girls / counted) * 100}%` }} />
            <span className="bg-primary" style={{ width: `${(data.boys / counted) * 100}%` }} />
          </div>
          {counted < data.total ? (
            <p className="text-caption text-muted">
              {data.total - counted} хүүхдийн хүйс бүртгэгдээгүй.
            </p>
          ) : null}
        </Card>
      ) : null}
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

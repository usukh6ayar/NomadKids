"use client";

import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ChevronRight,
  Download,
  Mars,
  Plus,
  Search,
  Upload,
  UsersRound,
  Venus,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  CHILD_STATUS_LABEL,
  childSummarySchema,
  completionPercent,
  paginated,
  rosterSummarySchema,
  SEX_LABEL,
  type ChildProfileCompletion,
  type ChildSummary,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { useSwitchableGroups } from "@/components/shell/group-switcher";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { RequireRole } from "@/components/shell/require-role";
import { downloadUrl } from "@/lib/api/client";
import { useDebounced } from "@/lib/use-debounced";
import { Button } from "@/components/ui/button";
import { Card, RowList, SectionHeader } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { SelectBox, SelectionBar, useSelection } from "@/components/ui/selection";
import { TableShell, Td, Th } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { useSelectedChild } from "@/lib/selected-child";
import { formatAge, formatDate, fullName } from "@/lib/format";
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
const PAGE_SIZE = 20;

function StaffChildren() {
  const { primaryKindergartenId } = useSession();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";

  const [query, setQuery] = useState(urlQuery);
  const [page, setPage] = useState(1);
  const [facets, setFacets] = useState<RosterFacets>(NO_FACETS);
  const search = useDebounced(query.trim());

  // Only when `?q=` itself changes — arriving from the header, or Back to an
  // earlier search. Local typing does not touch `urlQuery`, so this does not
  // fight the input on every keystroke.
  useEffect(() => {
    setQuery(urlQuery);
    setPage(1);
  }, [urlQuery]);

  /*
   * ★ Twenty a page — the client's number, 2026-09-06: "20 хүүхэд болоход
   * хангалттай".
   *
   * It was 25. The figure matters in two places beyond the query, and both are
   * kept in step by this constant rather than by three literals agreeing:
   * `useSelection` prunes ticks to what is visible, so a page *is* the set
   * somebody can hand-pick, and the export's "these nine" case is bounded by
   * it.
   */
  const filters = { q: search || undefined, ...facets, page, pageSize: PAGE_SIZE };

  // The same filters the list is showing, minus pagination — the export is
  // "what I am looking at", not "page one of it".
  const exportParams = rosterParams(search, facets).toString();
  const exportQuery = exportParams ? `?${exportParams}` : "";

  const { data, isLoading, isError, error, refetch, isPlaceholderData } = useQuery({
    queryKey: qk.children(filters),
    queryFn: () => {
      const params = rosterParams(search, facets);
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      return get(`/children?${params}`, listSchema);
    },
    // Keeps the previous page visible while the next loads, so the list does
    // not collapse to a skeleton and jump the scroll position on every search
    // keystroke.
    placeholderData: (previous) => previous,
  });

  /*
   * ★ Ticking rows, so an export can be a hand-picked set — 2026-09-04.
   *
   * The export has always carried the filters on screen, which answers "give
   * me this group" and "give me the five-year-olds" but not "give me these
   * nine", and the ninth question is the one a director actually asks before a
   * trip or a medical visit. A filter cannot express an arbitrary set.
   *
   * ★★ Scoped to the page, because `useSelection` prunes to what is visible.
   *
   * Paging to page three drops the ticks from page one rather than carrying
   * them invisibly — see `selection.tsx`. That is a real limit and the honest
   * one: a hidden selection is how somebody exports rows they had forgotten
   * they chose. Twenty at a time is also the size of set a person picks by
   * hand.
   */
  const selection = useSelection((data?.items ?? []).map((child) => child.id));

  /*
   * The selected ids as the same `?ids=` the export endpoint filters on. It is
   * ANDed into the roster's own `where` after `visibleChildrenWhere`, so this
   * can only ever narrow what the caller may already download.
   */
  const selectedExportQuery = (() => {
    const params = rosterParams(search, facets);
    params.set("ids", selection.ids.join(","));
    return `?${params}`;
  })();

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
        ★ The filters are on the page again — 2026-09-06, at the client's
        request: "делгэрэнгүйг дардаг биш зүгээр болиулаад филтерийг нь тогтмол
        байлгах".

        They folded behind a "Дэлгэрэнгүй" button from 2026-09-04, and that
        note's argument was a real one — three selects above a roster somebody
        opens twenty times a day are three rows of chrome between the search
        box and the answer. What it did not weigh is that the fold has a cost
        on every *use* of the filters, not just on the reading of the screen:
        narrowing by group is the common case here, and behind a toggle it is
        two clicks and a guess about where the control went.

        The objection the fold existed to answer is answered by the panel
        instead. `RosterFilters` is one row of three controls, not a stacked
        block, so the list still starts near the top of the screen; and a
        narrowing in force is now visible without being counted on a badge,
        because the selects themselves show it.
      */}
      <RosterFilters
        facets={facets}
        onChange={(next) => {
          setFacets(next);
          // A narrowed roster starts at page 1 — otherwise filtering from page
          // three shows an empty result that reads as "no such children".
          setPage(1);
        }}
      />

      <div className="relative">
        <Search
          size={18}
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
        />
        <Input
          type="search"
          // A visible label would be redundant beside a magnifier and a
          // placeholder this explicit, but a screen reader still needs one.
          aria-label="Хүүхдийн нэрээр хайх"
          placeholder="Нэр эсвэл овгоор хайх"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // A new search starts at page 1 — otherwise a search from page 3
            // shows an empty result that looks like "no matches".
            setPage(1);
          }}
          className="pl-11"
        />
      </div>

      {isLoading ? <LoadingState rows={6} shape="rows" /> : null}

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

      {data && data.items.length === 0 ? (
        <EmptyState
          title={search ? "Хайлтад тохирох хүүхэд олдсонгүй" : "Хүүхэд бүртгэгдээгүй байна"}
          description={
            search
              ? "Өөр нэрээр хайж үзнэ үү."
              : "Таны хариуцаж буй бүлэгт хүүхэд бүртгэгдээгүй байна."
          }
        />
      ) : null}

      {data && data.items.length > 0 ? (
        <>
          {/*
            A column of separate cards, per the reference's `.kidlist` —
            not one card with dividers. Every list screen in this product now
            reads the same way.
          */}
          {/*
            ★ A heading over the list — 2026-09-04.

            The roster went straight from a row of stat cards into rows of
            children, so nothing said where the summary stopped and the list
            began. The lede carries the page position because the count in the
            cards above is the *filtered total* and this list is twenty-five of
            it — two numbers that would otherwise appear to disagree.
          */}
          <SectionHeader
            title="Хүүхдийн жагсаалт"
            lede={`${data.total} хүүхдээс ${data.items.length} харагдаж байна · ${data.page} / ${data.totalPages} хуудас`}
          />

          {/*
            ★ "Select all" means this page, and says so.

            `useSelection` cannot tick a row it cannot see, and a control
            labelled "Бүгдийг сонгох" over a paginated list would promise the
            whole roster. The label names the page instead of the promise being
            broken quietly.
          */}
          <div className="flex items-center gap-2 px-1 pb-1 lg:hidden">
            <SelectBox
              checked={selection.allSelected}
              indeterminate={selection.someSelected}
              onChange={selection.toggleAll}
              label="Энэ хуудсын бүх хүүхдийг сонгох"
            />
            <span className="text-caption text-muted">Энэ хуудсыг сонгох</span>
          </div>

          {/*
            ★ A table on a desktop, the card rows on a phone — 2026-09-04.

            The client's reference screen is a twelve-column table and they are
            right that it suits this screen: a roster is compared *across* —
            "who has no регистр", "who is in Дэлбээ" — and those are answered by
            running an eye down a column, which a stack of cards cannot offer.

            ★★ Both, rather than one replacing the other, because CLAUDE.md §5
            is mobile-first and a twelve-column table on a 375px screen is a
            horizontal scroll nobody scrolls. `RowList` keeps the phone honest;
            `TableShell` gives the desk the density it asked for. One query, one
            selection, two shapes — the rows are the same objects in both, so
            there is no second source of truth to drift.
          */}
          <div className={isPlaceholderData ? "opacity-60" : ""} aria-busy={isPlaceholderData}>
            <RowList className="lg:hidden">
              {data.items.map((child) => (
                <ChildRow
                  key={child.id}
                  child={child}
                  checked={selection.has(child.id)}
                  onToggle={() => selection.toggle(child.id)}
                />
              ))}
            </RowList>

            <div className="hidden lg:block">
              <TableShell caption="Хүүхдийн жагсаалт" minWidth="min-w-[900px]">
                <thead>
                  <tr>
                    <Th className="w-10">
                      <SelectBox
                        checked={selection.allSelected}
                        indeterminate={selection.someSelected}
                        onChange={selection.toggleAll}
                        label="Энэ хуудсын бүх хүүхдийг сонгох"
                      />
                    </Th>
                    <Th numeric className="w-12">
                      №
                    </Th>
                    <Th>Хүүхэд</Th>
                    <Th>Регистр</Th>
                    <Th>Хүйс</Th>
                    <Th>Бүлэг</Th>
                    <Th>Нас</Th>
                    <Th>Төрсөн огноо</Th>
                    <Th>Төлөв</Th>
                    <Th className="w-10">
                      <span className="sr-only">Нээх</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((child, index) => (
                    <ChildTableRow
                      key={child.id}
                      child={child}
                      /* Continues across pages, so row 26 is the first of page two
                         rather than a second row 1. */
                      index={(data.page - 1) * 25 + index + 1}
                      checked={selection.has(child.id)}
                      onToggle={() => selection.toggle(child.id)}
                    />
                  ))}
                </tbody>
              </TableShell>
            </div>
          </div>

          {/*
            Excel only, and that is the whole action list for now.

            Moving a set of children to another group and archiving them are
            both real bulk operations, and both are enrollment decisions with
            dates and history behind them — `POST /children/:id/enrollments`
            per child is not the same act as "transfer these nine". Offering
            the button before that endpoint exists is the dead navigation this
            product deletes screens over.
          */}
          <SelectionBar count={selection.count} onClear={selection.clear}>
            {primaryKindergartenId ? (
              <Button asChild size="sm" variant="secondary">
                <a
                  href={downloadUrl(
                    `/kindergartens/${primaryKindergartenId}/children/export${selectedExportQuery}`,
                  )}
                >
                  <Download size={16} aria-hidden /> Сонгосныг Excel
                </a>
              </Button>
            ) : null}
          </SelectionBar>

          <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
        </>
      ) : null}

      {/*
        ★ Both ESIS roster services, under the local roster.

        `EsisDataPanel` renders nothing for a teacher — the route behind it
        answers 404 to anybody but an administrator of this kindergarten — so
        these two are the director's half of a screen the whole staff shares.

        ★★ The register search is the one panel whose parameter is a person.
        Every other service pre-fills its ids in demo mode; this one cannot,
        because there is no such thing as a safe invented national identifier
        to put in a form. It stays empty until the director types the number
        from the document in front of them, we send it, and we keep none of it
        — `personRegNumber` is a refused output here exactly as it is on the
        roster service above (`ESIS_REQUEST.md` §1.1 (b)).
      */}
      <EsisDataPanel
        resource="students"
        description="ESIS-д бүртгэлтэй суралцагчид — элсэлт тулгах эхний эх сурвалж"
      />
      <EsisDataPanel
        resource="studentByRegister"
        title="ESIS мэдээлэл — Регистрээр хайх"
        description="Нэг хүүхдийг регистрийн дугаараар ESIS-ээс олох"
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

/** The sort options, as one control: the field and its direction together. */
const SORT_CHOICES: {
  value: string;
  label: string;
  sort: RosterFacets["sort"];
  order: RosterFacets["order"];
}[] = [
  { value: "name:asc", label: "Нэр (А–Я)", sort: "name", order: "asc" },
  { value: "name:desc", label: "Нэр (Я–А)", sort: "name", order: "desc" },
  { value: "age:asc", label: "Нас (багаас их)", sort: "age", order: "asc" },
  { value: "age:desc", label: "Нас (ихээс бага)", sort: "age", order: "desc" },
  { value: "dateOfBirth:asc", label: "Төрсөн огноо (эртнээс)", sort: "dateOfBirth", order: "asc" },
  { value: "updatedAt:desc", label: "Сүүлд шинэчлэгдсэн", sort: "updatedAt", order: "desc" },
];

/**
 * Sex, an age range and an order — RFP §11.
 *
 * ★ One row of selects, not a filter drawer. Three controls do not earn a modal,
 * and on a phone a drawer hides the fact that a filter is active — which is how
 * a teacher concludes that half their group has vanished.
 *
 * The age bounds go to 7 rather than stopping at the portfolio's 2–5: a roster
 * holds children who arrived before their second birthday and others who have
 * not yet left at six, and a control that cannot express them hides real rows.
 */
function RosterFilters({
  facets,
  onChange,
}: {
  facets: RosterFacets;
  onChange: (next: RosterFacets) => void;
}) {
  const active =
    facets.groupId !== undefined ||
    facets.sex !== undefined ||
    facets.ageMin !== undefined ||
    facets.ageMax !== undefined;

  /*
   * ★ The same query the registers use, so a screen reached from one of them
   * finds the list of groups already in cache.
   */
  const groups = useSwitchableGroups();

  return (
    <section aria-label="Шүүлт, эрэмбэ" className="flex flex-wrap items-end gap-3">
      {/*
        Group leads the row: it is the coarsest cut and the one a director
        reaches for, where sex and age narrow whatever it leaves.
      */}
      <Field label="Бүлэг" className="min-w-[160px] flex-1">
        {({ id, describedBy }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            value={facets.groupId ?? ""}
            onChange={(e) => onChange({ ...facets, groupId: e.target.value || undefined })}
          >
            <option value="">Бүх бүлэг</option>
            {(groups.data?.items ?? []).map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="Хүйс" className="min-w-[140px] flex-1">
        {({ id, describedBy }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            value={facets.sex ?? ""}
            onChange={(e) =>
              onChange({
                ...facets,
                sex: e.target.value ? (e.target.value as "MALE" | "FEMALE") : undefined,
              })
            }
          >
            <option value="">Бүгд</option>
            <option value="MALE">{SEX_LABEL.MALE}</option>
            <option value="FEMALE">{SEX_LABEL.FEMALE}</option>
          </Select>
        )}
      </Field>

      <Field label="Хамгийн бага нас" className="min-w-[120px] flex-1">
        {({ id, describedBy }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            value={facets.ageMin ?? ""}
            onChange={(e) =>
              onChange({
                ...facets,
                ageMin: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          >
            <option value="">Хязгааргүй</option>
            {AGE_CHOICES.map((age) => (
              <option key={age} value={age}>
                {age} нас
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="Хамгийн их нас" className="min-w-[120px] flex-1">
        {({ id, describedBy }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            value={facets.ageMax ?? ""}
            onChange={(e) =>
              onChange({
                ...facets,
                ageMax: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          >
            <option value="">Хязгааргүй</option>
            {AGE_CHOICES.map((age) => (
              <option key={age} value={age}>
                {age} нас
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="Эрэмбэ" className="min-w-[180px] flex-1">
        {({ id, describedBy }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            value={`${facets.sort}:${facets.order}`}
            onChange={(e) => {
              const choice = SORT_CHOICES.find((c) => c.value === e.target.value);
              if (choice) onChange({ ...facets, sort: choice.sort, order: choice.order });
            }}
          >
            {SORT_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {/*
        Only when something is actually narrowed. A permanently visible "clear"
        beside untouched controls is noise, and its absence is how you can tell
        at a glance that the list is showing everyone.
      */}
      {active ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ ...NO_FACETS, sort: facets.sort, order: facets.order })}
        >
          Шүүлт цэвэрлэх
        </Button>
      ) : null}
    </section>
  );
}

const AGE_CHOICES = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * One child.
 *
 * The same markup at every width — a compact row that already reads well on a
 * phone. A separate mobile card component would be two things to keep in step
 * for no visual gain, so the group and age simply wrap under the name below
 * `sm`.
 */
function ChildRow({
  child,
  checked,
  onToggle,
}: {
  child: {
    id: string;
    lastName: string;
    firstName: string;
    dateOfBirth: string;
    photoMediaFileId?: string | null;
    enrollments?: { group?: { name: string } | null }[];
    /** Staff rosters only — `/children/mine` does not compute it. */
    profile?: ChildProfileCompletion;
  };
  checked: boolean;
  onToggle: () => void;
}) {
  const group = child.enrollments?.[0]?.group?.name;

  return (
    /*
      ★ REDESIGN 2026-09-03 — the row lifts, and it has a chevron.

      The affordance was a border moving to the brand colour on hover, which is
      invisible on a phone — where this screen is mostly used, and where hover
      does not exist — so a tappable roster looked exactly like a read-only
      list.

      `card-interactive` (globals.css) is the product's one answer for a
      clickable surface: a 1px lift, one step of shadow, a tinted border, and a
      return to rest on press, so the press registers under a thumb. The chevron
      is the part that works with no pointer at all — it says "this opens" while
      sitting still.

      ★★ 2026-09-04 — the card is a `div` and the link is inside it.

      The whole row used to be one `<a>`. A checkbox inside an anchor is an
      interactive element inside an interactive element: invalid HTML, and in
      practice a tap that both ticks the box and navigates away from the list
      the tick was for. So the card became the container, the checkbox and the
      link became siblings, and the link kept everything that is genuinely
      "open this child".

      The lift still belongs to the whole card rather than to the link alone —
      the row is one object to the eye and splitting the hover would make the
      checkbox look detached from the name beside it.
    */
    <div className="card-interactive flex min-h-[68px] items-center gap-3 rounded-row border border-border bg-surface px-3 py-3 shadow-sm md:px-4">
      <SelectBox checked={checked} onChange={onToggle} label={`${fullName(child)} — сонгох`} />

      <Link
        href={`/children/${child.id}/general`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-row"
      >
        <ChildAvatar child={child} size={44} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-lead font-semibold leading-[1.35] text-ink">
            {fullName(child)}
          </span>
          <span className="mt-0.5 block truncate text-compact text-muted">
            {[group, formatAge(child.dateOfBirth)].filter(Boolean).join(" · ")}
          </span>
        </span>

        {child.profile ? <ProfileCompletion profile={child.profile} /> : null}

        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-faint" />
      </Link>
    </div>
  );
}

/**
 * How much of a child's record is filled in.
 *
 * ★ Only when something is missing.
 *
 * A complete record draws nothing. Thirty rows each carrying a green "100%"
 * is thirty pieces of noise saying there is nothing to do, and it would bury
 * the two rows that do need attention — which is the entire purpose of the
 * indicator. So the finished ones are silent and the unfinished ones are not.
 *
 * ★★ It names what is missing, not only how much.
 *
 * "67%" tells a teacher there is a problem and not what to do about it. The
 * `title` and the screen-reader text list the actual gaps, because "Цээж зураг
 * дутуу" is a task and a percentage is a score.
 *
 * ★★★ Not a link. The row already opens the child, and a second target inside
 * it competes with the first for the same tap.
 */
function ProfileCompletion({ profile }: { profile: ChildProfileCompletion }) {
  const missing = [
    !profile.photo ? "Цээж зураг" : null,
    !profile.health ? "Эрүүл мэндийн мэдээлэл" : null,
    !profile.guardianContact ? "Асран хамгаалагчийн холбоо барих" : null,
  ].filter((v): v is string => v !== null);

  if (missing.length === 0) return null;

  const percent = completionPercent(profile);
  const detail = `${missing.join(", ")} дутуу`;

  return (
    <span
      title={detail}
      className="hidden shrink-0 items-center gap-1.5 rounded-pill bg-sun px-2.5 py-1 text-caption font-semibold text-sun-ink sm:inline-flex"
    >
      <AlertTriangle size={13} aria-hidden="true" />
      {percent}%<span className="sr-only"> бүрдсэн. {detail}.</span>
    </span>
  );
}

/**
 * The roster's headline numbers — RFP §12.1.
 *
 * ★ Two cards, and the wireframe's third is deliberately absent.
 *
 * It asked for Total / Average age / **Attendance**. The first two are
 * computable from data this system holds; attendance has no model, no
 * migration and no endpoint anywhere in the API, so a card for it could only
 * render a number somebody invented. `dashboard/page.tsx` records the same
 * decision, taken three times now.
 *
 * ★★ The count comes from `GET /children/summary`, not from `data.total`.
 *
 * Both would be correct for the total — but the average cannot be computed on
 * the client at all: the list is paginated at 25, so a mean taken from the rows
 * on screen changes when you press "next" and describes no cohort. One request
 * answers both over the whole filtered roster, and the endpoint shares its
 * `where` with the list so the header cannot contradict the rows.
 */
/**
 * One roster row as a table row — the desktop half of the list.
 *
 * ★ The link is on the name cell, not on the `<tr>`.
 *
 * A whole row cannot be an anchor: `<tr>` may only contain `<td>`, so wrapping
 * it is invalid, and making the row clickable with `onClick` gives a keyboard
 * user nothing to focus and a reader nothing to middle-click. The name is what
 * somebody aims at anyway, and the trailing chevron is a second, wider target
 * on the same href.
 *
 * ★★ An em dash where a fact is missing, never an empty cell.
 *
 * A blank in a grid reads as "this column does not apply here"; a dash says the
 * value is absent. `nationalId` genuinely is absent for a newly arrived child —
 * see `childSummarySchema` — and that is the state a director scans this column
 * to find.
 */
function ChildTableRow({
  child,
  index,
  checked,
  onToggle,
}: {
  child: ChildSummary;
  index: number;
  checked: boolean;
  onToggle: () => void;
}) {
  const group = child.enrollments?.[0]?.group?.name;
  const href = `/children/${child.id}/general`;

  return (
    <tr className="transition-colors hover:bg-sunken">
      <Td>
        <SelectBox checked={checked} onChange={onToggle} label={`${fullName(child)} — сонгох`} />
      </Td>
      <Td numeric className="text-caption text-muted">
        {index}
      </Td>
      <Td>
        <Link href={href} className="flex min-w-0 items-center gap-2.5">
          <ChildAvatar child={child} size={32} />
          <span className="min-w-0 truncate font-medium text-ink">{fullName(child)}</span>
        </Link>
      </Td>
      {/*
        ★ A foreign child's own identifier, marked as such.

        Their `nationalId` is null and always will be — the Mongolian format
        cannot express one — so an unmarked "—" here would read exactly like a
        child whose регистр nobody has typed in yet. The first is finished; the
        second is a to-do, and this column is where a director looks for the
        second.
      */}
      <Td className="whitespace-nowrap text-muted">
        {child.isForeign ? (
          <span className="flex items-center gap-1.5">
            <Badge tone="sky">Гадаад</Badge>
            <span className="tabular-nums">{child.foreignId ?? "—"}</span>
          </span>
        ) : (
          <span className="tabular-nums">{child.nationalId ?? "—"}</span>
        )}
      </Td>
      <Td className="whitespace-nowrap text-muted">
        {child.sex ? (SEX_LABEL[child.sex] ?? child.sex) : "—"}
      </Td>
      <Td className="text-muted">{group ?? "—"}</Td>
      <Td className="whitespace-nowrap text-muted">{formatAge(child.dateOfBirth)}</Td>
      <Td className="whitespace-nowrap tabular-nums text-muted">{formatDate(child.dateOfBirth)}</Td>
      <Td>
        {child.status ? (
          <Badge tone={child.status === "ACTIVE" ? "mint" : "sky"}>
            {CHILD_STATUS_LABEL[child.status] ?? child.status}
          </Badge>
        ) : (
          "—"
        )}
      </Td>
      <Td>
        <Link href={href} aria-label={`${fullName(child)} — нээх`} className="block">
          <ChevronRight size={18} aria-hidden="true" className="text-faint" />
        </Link>
      </Td>
    </tr>
  );
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
          art={<UsersRound size={22} />}
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

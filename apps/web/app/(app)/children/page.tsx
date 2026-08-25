"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { childSummarySchema, paginated, rosterSummarySchema, SEX_LABEL } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { PageHeader } from "@/components/shell/app-shell";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { useDebounced } from "@/lib/use-debounced";
import { Button } from "@/components/ui/button";
import { Card, RowList } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { formatAge, formatAgeFromMonths, fullName } from "@/lib/format";
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

  return isStaff ? <StaffChildren /> : <MyChildren />;
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
function StaffChildren() {
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

  const filters = { q: search || undefined, ...facets, page, pageSize: 25 };

  const { data, isLoading, isError, error, refetch, isPlaceholderData } = useQuery({
    queryKey: qk.children(filters),
    queryFn: () => {
      const params = rosterParams(search, facets);
      params.set("page", String(page));
      params.set("pageSize", "25");
      return get(`/children?${params}`, listSchema);
    },
    // Keeps the previous page visible while the next loads, so the list does
    // not collapse to a skeleton and jump the scroll position on every search
    // keystroke.
    placeholderData: (previous) => previous,
  });

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Хүүхдүүд"
        lede="Хариуцсан бүлгийн хүүхдүүд."
        actions={
          <div className="flex items-center gap-3">
            {data ? (
              <p className="text-body text-muted" aria-live="polite">
                Нийт {data.total}
              </p>
            ) : null}
            {/*
              No role check: guardians never reach this component — the page
              routes them to `MyChildren`, which has nothing to register.
            */}
            <Button asChild size="sm">
              <Link href="/children/new">
                <Plus size={16} aria-hidden /> Хүүхэд бүртгэх
              </Link>
            </Button>
          </div>
        }
      />

      <RosterSummary search={search} facets={facets} />

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

      {isLoading ? <LoadingState rows={5} /> : null}

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
          <RowList className={isPlaceholderData ? "opacity-60" : ""} aria-busy={isPlaceholderData}>
            {data.items.map((child) => (
              <ChildRow key={child.id} child={child} />
            ))}
          </RowList>

          {data.totalPages > 1 ? (
            <nav aria-label="Хуудаслалт" className="flex items-center justify-between gap-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Өмнөх
              </Button>
              <span className="text-body text-muted" aria-live="polite">
                {data.page} / {data.totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Дараах
              </Button>
            </nav>
          ) : null}
        </>
      ) : null}
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
    facets.sex !== undefined || facets.ageMin !== undefined || facets.ageMax !== undefined;

  return (
    <section aria-label="Шүүлт, эрэмбэ" className="flex flex-wrap items-end gap-3">
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
}: {
  child: {
    id: string;
    lastName: string;
    firstName: string;
    dateOfBirth: string;
    photoMediaFileId?: string | null;
    enrollments?: { group?: { name: string } | null }[];
  };
}) {
  const group = child.enrollments?.[0]?.group?.name;

  return (
    <Link
      href={`/children/${child.id}`}
      // The whole row is one card and one link. `hover:border-primary` is the
      // reference's `.kidrow:hover` — the affordance is the border moving to
      // the brand colour, not a background wash.
      className="flex min-h-[64px] items-center gap-2.5 rounded-row border border-border bg-surface px-3 py-2.5 transition-colors hover:border-primary md:gap-3 md:px-4 md:py-3"
    >
      <ChildAvatar child={child} size={44} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-lead font-semibold leading-[1.35] text-ink">
          {fullName(child)}
        </span>
        <span className="mt-px block truncate text-compact text-muted">
          {[group, formatAge(child.dateOfBirth)].filter(Boolean).join(" · ")}
        </span>
      </span>
    </Link>
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

  return (
    <section aria-label="Товч тоо" className="grid grid-cols-2 gap-2 md:gap-3">
      <Card pad="compact">
        <p className="text-body text-muted">Нийт хүүхэд</p>
        <p className="mt-1 text-display font-semibold tabular-nums text-ink">{data.total}</p>
      </Card>
      <Card pad="compact">
        <p className="text-body text-muted">Дундаж нас</p>
        <p className="mt-1 text-display font-semibold tabular-nums text-ink">
          {/*
            Months, formatted as the product formats every other age. A mean of
            41 months is "3 нас 5 сар"; rounded to whole years it would read "3"
            for most of a school year and stop moving.
          */}
          {data.averageAgeMonths === null ? "—" : formatAgeFromMonths(data.averageAgeMonths)}
        </p>
      </Card>
    </section>
  );
}

// ── Parent ───────────────────────────────────────────────────────────────────

function MyChildren() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.myChildren(),
    queryFn: () => get("/children/mine", ownSchema),
  });

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <h1 className="text-heading font-semibold text-ink">{MY_CHILDREN}</h1>

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
          title="Хүүхэд холбогдоогүй байна"
          description="Танд холбогдсон хүүхэд байхгүй байна. Цэцэрлэгийн багштайгаа холбогдоно уу."
        />
      ) : null}

      {data && data.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {data.map((child) => (
            <Link key={child.id} href={`/children/${child.id}`} className="block">
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

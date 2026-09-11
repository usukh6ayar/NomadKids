"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  ChevronRight,
  FolderOpen,
  PenLine,
  Plus,
  Search,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import {
  MAX_PAGE_SIZE,
  childDetailSchema,
  observationSchema,
  paginated,
  termSchema,
} from "@kinder/contracts";
import { z } from "zod";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { SearchField } from "@/components/ui/search-field";
import { ChildAvatar } from "@/components/media/media-image";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ObservationRow } from "@/components/observations/observation-row";
import { ObservationDetailDialog } from "./child-observations";
import { ChildPickerDialog } from "./child-picker-dialog";
import { formatAge, fullName } from "@/lib/format";
import { termNumberForDay } from "@/lib/terms";
import { cn } from "@/lib/utils";

const observationsSchema = paginated(observationSchema);
const termsSchema = z.array(termSchema);

/**
 * The four doors, one set per kind of record.
 *
 * ★ Written out per kind rather than templated from the type's name.
 *
 * "Шинээр ярилцлагын тэмдэглэл үүсгэх" is not "Шинээр {name} үүсгэх" — Mongolian
 * takes a genitive on the middle word and the artwork set is not parallel at
 * all ("Бүтээл нэмэх", "Бүтээлд дүн шинжилгээ хийх"). A template would produce
 * three labels, one of which reads correctly.
 */
const DOORS: Record<
  string,
  { total: string; tiles: { key: string; label: string; Icon: typeof PenLine; tone: string }[] }
> = {
  daily: {
    total: "Нийт ажиглалт",
    tiles: [
      {
        key: "new",
        label: "Шинээр ажиглалт үүсгэх",
        Icon: PenLine,
        tone: "bg-primary-soft text-primary",
      },
      {
        key: "search",
        label: "Ажиглалтаас хайх",
        Icon: Search,
        tone: "bg-primary-soft text-primary",
      },
      {
        key: "report",
        label: "Нэгдсэн ажиглалтын тайлан",
        Icon: BarChart3,
        tone: "bg-mint text-mint-ink",
      },
      {
        key: "parent",
        label: "Эцэг эхийн бичсэн ажиглалтууд",
        Icon: Users,
        tone: "bg-cornflower text-cornflower-ink",
      },
    ],
  },
  conversation: {
    total: "Нийт тэмдэглэл",
    tiles: [
      {
        key: "new",
        label: "Шинээр ярилцлагын тэмдэглэл үүсгэх",
        Icon: PenLine,
        tone: "bg-primary-soft text-primary",
      },
      {
        key: "search",
        label: "Ярилцлагын тэмдэглэлээс хайх",
        Icon: Search,
        tone: "bg-primary-soft text-primary",
      },
      {
        key: "report",
        label: "Нэгдсэн тайлан харах",
        Icon: BarChart3,
        tone: "bg-mint text-mint-ink",
      },
      {
        key: "parent",
        label: "Эцэг эхтэй хийсэн ярилцлагын тэмдэглэл",
        Icon: Users,
        tone: "bg-cornflower text-cornflower-ink",
      },
    ],
  },
  artwork: {
    total: "Нийт бүтээл",
    tiles: [
      { key: "new", label: "Бүтээл нэмэх", Icon: PenLine, tone: "bg-primary-soft text-primary" },
      {
        key: "search",
        label: "Бүтээлээс хайх",
        Icon: Search,
        tone: "bg-primary-soft text-primary",
      },
      {
        key: "report",
        label: "Бүтээлд дүн шинжилгээ хийх",
        Icon: BarChart3,
        tone: "bg-mint text-mint-ink",
      },
      {
        key: "parent",
        label: "Бүтээлийн цогцолбор",
        Icon: FolderOpen,
        tone: "bg-cornflower text-cornflower-ink",
      },
    ],
  },
};

/**
 * One child's records of one kind — the client's 2026-09-11 hub.
 *
 * ★ A landing between the door and the form, which is new.
 *
 * Pressing Ажиглалт used to open a blank compose form. That is the right
 * destination when a teacher has already decided what to write; it is the
 * wrong one when they came to look — and looking is most of what this screen
 * is for. The four tiles say what can be done, and the totals underneath say
 * whether it is worth doing.
 *
 * ★★ One component for all three kinds, because the shape is identical and
 * only the words differ. Three files that start the same are three files that
 * drift, and `DOORS` is the whole of the difference.
 *
 * ★★★ The term counts come from the records already loaded, not a second
 * endpoint. One bounded request for the child's notes is what the list below
 * needs anyway, and counting them here cannot disagree with what it shows.
 */
export function ObservationHub({
  childId,
  typeCode,
  typeId,
  groupId,
}: {
  childId: string;
  /** `daily` · `conversation` · `artwork` — which set of doors to draw. */
  typeCode: string;
  typeId: string;
  /** Narrows the Солих picker to one group; omitted, it is every child. */
  groupId?: string;
}) {
  const router = useRouter();
  const { primaryKindergartenId } = useSession();
  const [picking, setPicking] = useState(false);
  const [yearId, setYearId] = useState("");
  const [recordScope, setRecordScope] = useState<"all" | string | null>(null);
  const [detail, setDetail] = useState<z.infer<typeof observationSchema> | null>(null);
  const [searchText, setSearchText] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterTermId, setFilterTermId] = useState("");

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  const observations = useQuery({
    queryKey: qk.childObservations(childId, { pageSize: MAX_PAGE_SIZE }),
    queryFn: () =>
      get(`/children/${childId}/observations?page=1&pageSize=${MAX_PAGE_SIZE}`, observationsSchema),
  });

  const terms = useQuery({
    queryKey: qk.terms(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/terms`, termsSchema),
    enabled: Boolean(primaryKindergartenId),
    staleTime: 5 * 60_000,
  });

  if (child.isLoading || observations.isLoading) return <LoadingState rows={5} />;
  if (child.isError) return <ErrorState description={errorMessage(child.error)} />;
  if (observations.isError) {
    return <ErrorState description={errorMessage(observations.error)} />;
  }

  const doors = DOORS[typeCode] ?? DOORS.daily!;

  /*
    ★ Filtered to this kind, and by `code` rather than by id.

    A kindergarten may add its own observation types, so the id differs per
    deployment while `daily` / `conversation` / `artwork` are the system rows'
    stable codes — the same keys `NewRecordStrip` filters its doors on.
  */
  const mine = (observations.data?.items ?? []).filter(
    (row) => (row.type?.code ?? "") === typeCode,
  );

  /*
    ★ The school years come from the terms, not a second request.

    `termSchema` carries its year as a named reference, so the picker is built
    from what this screen already has — and it can only offer years that
    actually have terms, which is the only kind a count can be taken over.
  */
  const years = [
    ...new Map(
      (terms.data ?? [])
        .filter((term) => term.schoolYear)
        .map((term) => [term.schoolYear!.id, term.schoolYear!]),
    ).values(),
  ];
  const selectedYearId = yearId || years[0]?.id || "";
  const termsInYear = (terms.data ?? []).filter(
    (term) => !selectedYearId || term.schoolYear?.id === selectedYearId,
  );

  const inYear = mine.filter((row) =>
    termsInYear.some(
      (term) =>
        term.startsOn &&
        term.endsOn &&
        row.observedOn.slice(0, 10) >= term.startsOn.slice(0, 10) &&
        row.observedOn.slice(0, 10) <= term.endsOn.slice(0, 10),
    ),
  );

  const selectedTerm = termsInYear.find((term) => term.id === recordScope);
  const scopedRecords =
    recordScope === "all"
      ? mine
      : selectedTerm?.startsOn && selectedTerm.endsOn
        ? mine.filter((row) => {
            const day = row.observedOn.slice(0, 10);
            return (
              day >= selectedTerm.startsOn!.slice(0, 10) && day <= selectedTerm.endsOn!.slice(0, 10)
            );
          })
        : [];
  const normalizedSearch = searchText.trim().toLocaleLowerCase("mn-MN");
  const shownRecords = scopedRecords.filter((row) => {
    const termMatches =
      !filterTermId ||
      (() => {
        const term = termsInYear.find((candidate) => candidate.id === filterTermId);
        const day = row.observedOn.slice(0, 10);
        return Boolean(term?.startsOn && term.endsOn && day >= term.startsOn && day <= term.endsOn);
      })();
    const text = [row.situation, row.childDid, row.childSaid, row.teacherComment, row.activityName]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("mn-MN");
    return termMatches && (!normalizedSearch || text.includes(normalizedSearch));
  });

  const domainCounts = new Map<string, { name: string; color?: string | null; count: number }>();
  for (const observation of mine) {
    for (const entry of observation.domains) {
      const current = domainCounts.get(entry.domain.id);
      domainCounts.set(entry.domain.id, {
        name: entry.domain.name,
        color: entry.domain.color,
        count: (current?.count ?? 0) + 1,
      });
    }
  }

  const href = (key: string) => {
    if (key === "new") return `/children/${childId}/observations/new?typeId=${typeId}`;
    if (key === "parent") return `/children/${childId}/observations?type=${typeCode}&source=parent`;
    if (key === "report") return `/children/${childId}/term-report`;
    return `/children/${childId}/observations?type=${typeCode}`;
  };

  const data = child.data!;
  const group = data.enrollments?.find((row) => row.group)?.group?.name;

  return (
    <div className="flex flex-col gap-4">
      {/*
        ★ The child is named at the top of every screen in this flow, with the
        way to change them beside it.

        A teacher writing notes works down a roster, and the commonest next
        action after finishing one child is the same screen for the next. Going
        back to the group to re-enter is three presses for what Солих does in
        one.
      */}
      <Card pad="compact" className="flex items-center gap-3">
        <ChildAvatar child={data} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold leading-snug text-ink">{fullName(data)}</p>
          <p className="truncate text-caption text-muted">
            {formatAge(data.dateOfBirth)}
            {group ? ` · ${group}` : ""}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
          <Users size={15} aria-hidden="true" />
          Солих
        </Button>
      </Card>

      {typeCode === "daily" ? (
        <Link
          href={href("new")}
          className="flex min-h-12 items-center justify-center gap-2 rounded-button bg-primary px-4 text-body font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5"
        >
          <Plus size={19} strokeWidth={2.5} aria-hidden="true" />
          Шинээр ажиглалт үүсгэх
        </Link>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        {doors.tiles
          .filter((tile) => typeCode !== "daily" || !["new", "search"].includes(tile.key))
          .map((tile) => (
            <Link
              key={tile.key}
              href={href(tile.key)}
              className={cn(
                "flex min-h-[104px] flex-col items-center justify-center gap-2 rounded-card px-3 py-4 text-center transition-transform hover:-translate-y-0.5",
                tile.tone,
              )}
            >
              <tile.Icon size={22} aria-hidden="true" />
              <span className="text-caption font-semibold leading-snug">{tile.label}</span>
            </Link>
          ))}
      </div>

      {typeCode === "daily" ? (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <SearchField
              label="Ажиглалтаас хайх"
              placeholder="Ажиглалтаас хайх"
              value={searchText}
              onChange={(value) => {
                setSearchText(value);
                setRecordScope("all");
              }}
            />
            <Button
              type="button"
              size="icon"
              variant={filtersOpen ? "primary" : "secondary"}
              aria-label="Шүүлтүүр"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <SlidersHorizontal aria-hidden="true" />
            </Button>
          </div>
          {filtersOpen ? (
            <div className="rounded-card border border-border bg-surface p-3">
              <Select
                aria-label="Улирлаар шүүх"
                value={filterTermId}
                onChange={(event) => {
                  setFilterTermId(event.target.value);
                  setRecordScope("all");
                }}
              >
                <option value="">Бүх улирал</option>
                {termsInYear.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          <Card pad="compact">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-body font-semibold text-ink">Чиглэлийн хамралт</h2>
              <span className="text-caption text-muted">{domainCounts.size} чиглэл</span>
            </div>
            {domainCounts.size > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {[...domainCounts.entries()].map(([id, row]) => (
                  <div key={id} className="rounded-row bg-canvas px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="size-2 shrink-0 rounded-pill"
                        style={{ backgroundColor: row.color ?? "var(--color-primary)" }}
                      />
                      <span className="min-w-0 flex-1 truncate text-caption text-muted">
                        {row.name}
                      </span>
                      <strong className="text-body tabular-nums text-ink">{row.count}</strong>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-caption text-muted">Чиглэлтэй ажиглалт ороогүй.</p>
            )}
          </Card>
        </div>
      ) : null}

      <button
        type="button"
        aria-expanded={recordScope === "all"}
        onClick={() => setRecordScope((current) => (current === "all" ? null : "all"))}
        className="group flex items-center gap-3 rounded-card border border-border bg-surface px-3.5 py-3 text-left transition-colors hover:border-primary"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-caption text-muted">{doors.total}</span>
          <span className="block text-display font-semibold tabular-nums leading-none text-ink">
            {mine.length}
          </span>
        </span>
        <ChevronRight
          size={18}
          aria-hidden="true"
          className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5"
        />
      </button>

      {/*
        ★ Улирлаар, over the kindergarten's own terms.

        The design draws four; `Term` is administrator-editable (§2.3) and a
        kindergarten may run three. Building the rows from the configured terms
        rather than a fixed four means the screen matches whatever the office
        set up, and a deployment with none draws nothing rather than four empty
        rows.
      */}
      {termsInYear.length > 0 ? (
        <Card pad="roomy" className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-body font-semibold text-ink">Улирлаар</h2>
            {years.length > 1 ? (
              <Select
                aria-label="Хичээлийн жил"
                value={selectedYearId}
                onChange={(event) => setYearId(event.target.value)}
                className="w-auto min-w-[140px]"
              >
                {years.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.name}
                  </option>
                ))}
              </Select>
            ) : (
              <span className="text-caption text-muted">{years[0]?.name}</span>
            )}
          </div>

          <ul className="flex flex-col">
            {termsInYear
              .slice()
              .sort((a, b) => a.number - b.number)
              .map((term) => {
                const count = inYear.filter(
                  (row) =>
                    termNumberForDay(row.observedOn.slice(0, 10), terms.data ?? []) === term.number,
                ).length;

                return (
                  <li key={term.id}>
                    <button
                      type="button"
                      aria-expanded={recordScope === term.id}
                      onClick={() =>
                        setRecordScope((current) => (current === term.id ? null : term.id))
                      }
                      className="group flex min-h-11 w-full items-center gap-3 border-b border-border-soft py-2 text-left last:border-0"
                    >
                      <span className="min-w-0 flex-1 truncate text-body text-ink">
                        {term.name}
                      </span>
                      <span className="shrink-0 text-body font-semibold tabular-nums text-ink">
                        {count}
                      </span>
                      <ChevronRight
                        size={16}
                        aria-hidden="true"
                        className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5"
                      />
                    </button>
                  </li>
                );
              })}
          </ul>
        </Card>
      ) : null}

      {recordScope ? (
        <section
          aria-label="Бичсэн тэмдэглэлүүд"
          className="overflow-hidden rounded-card border border-border bg-surface"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-body font-semibold text-ink">
                {recordScope === "all" ? doors.total : selectedTerm?.name}
              </h2>
              <p className="text-caption text-muted">{shownRecords.length} тэмдэглэл</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setRecordScope(null)}>
              Хаах
            </Button>
          </div>

          {shownRecords.length > 0 ? (
            <div className="divide-y divide-border-soft">
              {shownRecords.map((observation) => (
                <ObservationRow
                  key={observation.id}
                  observation={observation}
                  showVisibility
                  onClick={() => setDetail(observation)}
                />
              ))}
            </div>
          ) : (
            <EmptyState title="Тэмдэглэл ороогүй" />
          )}
        </section>
      ) : null}

      <ObservationDetailDialog observation={detail} onClose={() => setDetail(null)} />

      {picking ? (
        <ChildPickerDialog
          groupId={groupId}
          selectedId={childId}
          onClose={() => setPicking(false)}
          onSelect={(next) => {
            /*
              A push, not a `window.location` assignment: the roster and the
              terms are already in the cache and a full reload would fetch them
              again for the child next door.
            */
            if (next !== childId) {
              router.push(`/children/${next}/observations?type=${typeCode}`);
            }
          }}
        />
      ) : null}
    </div>
  );
}

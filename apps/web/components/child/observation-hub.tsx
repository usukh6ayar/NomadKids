"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, PenLine, Plus, SlidersHorizontal, Users } from "lucide-react";
import {
  MAX_PAGE_SIZE,
  ARTWORK_TYPES,
  assessmentConfigSchema,
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
import { Field, Input, Select } from "@/components/ui/field";
import { SearchField } from "@/components/ui/search-field";
import { FormDialog } from "@/components/ui/form-dialog";
import { BackButton } from "@/components/ui/back-button";
import { ChildAvatar } from "@/components/media/media-image";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import {
  DeleteObservationDialog,
  EditObservationDialog,
  MomentCard,
  ObservationDetailDialog,
} from "./child-observations";
import { ChildPickerDialog } from "./child-picker-dialog";
import { ArchiveTab, WrittenReports } from "@/components/assessment/report-archive";
import { ChildArtwork } from "./child-artwork";
import { formatAge, fullName, capitalize } from "@/lib/format";
import { cn } from "@/lib/utils";

const observationsSchema = paginated(observationSchema);
const termsSchema = z.array(termSchema);

/**
 * The words and the colour of one kind of record.
 *
 * ★ Written out per kind rather than templated from the type's name.
 *
 * "Шинээр ярилцлагын тэмдэглэл үүсгэх" is not "Шинээр {name} үүсгэх" — Mongolian
 * takes a genitive on the middle word and the artwork set is not parallel at
 * all ("Бүтээл нэмэх"). A template would produce three labels, one of which
 * reads correctly.
 *
 * ★★ The four tiles are gone — 2026-09-14.
 *
 * Two of them (Дүгнэлт, Эцэг эх) became the panels at the foot, and the other
 * two are the screen's own controls: the button that opens the form and the
 * box that searches. What is left per kind is the wording and the colour.
 *
 * ★★★ One colour per kind, at the client's request: "ажиглалт товчууд ногоон,
 * ярилцлага товчууд цэнхэр, бүтээл товчууд улбар шар."
 *
 * ★★★★ Not the deep step and not the pale one — the client bracketed it in
 * two notes the same day: "зөөлөн ... болго, гүн огт биш", then "арай хэт усан
 * өнгөтэй байна, арай орчин үеийн болго."
 *
 * `-ink` is a near-black of the hue (the first note's "гүн"); the tint is the
 * second note's "усан"; and `-chart` is bright but sits at 3.2:1 under white
 * text. So globals.css gained a `-solid` step for these three, measured
 * against white at 4.6–4.7:1 — saturated enough to read as a colour and
 * legible enough to carry a label.
 *
 * ★★★★★ The bright step, with the product's own ink on it — 2026-09-16, after
 * two notes the same day: the solid surfaces were "хэт бараан", the tint that
 * replaced them "хэт цайвар", and what is wanted is "арай тод, хар бараан
 * биш, энгийн тод өнгүүд".
 *
 * White text is what made the first version dark, and that is arithmetic
 * rather than taste: `-solid` measures 4.59–4.72:1 against white, so no
 * lighter fill can carry white lettering and stay readable. The tint went the
 * other way and lost the colour. `-bright` (globals.css) is the middle the
 * client is describing — a fully saturated mid-tone.
 *
 * ★★★★★★ The label is white on it, asked for directly and kept on the record
 * — the client, 2026-09-16: "энэ өнгө болж, одоо энэ дээр байгаа
 * товчлууруудын үсэгнүүдийг цагаан өнгөтэй болгоод өг."
 *
 * It is below the contrast floor and the numbers are the reason this comment
 * exists rather than a silent change: white measures **2.65:1 on the green,
 * 2.84:1 on the blue and 2.61:1 on the orange**, against 4.5:1 for body text
 * and 3:1 even for large text. `--color-ink` on the same three is 5.1–5.6:1.
 * The colour is the client's choice and the pairing was named explicitly, so
 * it ships; what a reader loses in bright sunlight or with low vision is
 * written down here so nobody has to re-measure it, and a deeper step of the
 * same three hues is what restores white lettering if it is ever asked for.
 *
 * The border is the hue's `-solid` at half strength, so the edge stays drawn,
 * and `shadow-sm` keeps these reading as raised controls. The kind *badges*
 * keep the solid fill with white on it — that pairing is the measured one.
 */
/** The three doors, in the order the group's screen draws them. */
const KIND_SWITCH = [
  { code: "daily", label: "Ажиглалт" },
  { code: "conversation", label: "Ярилцлага" },
  { code: "artwork", label: "Бүтээл" },
] as const;

const KINDS: Record<string, { create: string; search: string; accent: string }> = {
  daily: {
    create: "Шинээр ажиглалт үүсгэх",
    search: "Ажиглалтаас хайх",
    accent: "border border-mint-solid/50 bg-mint-bright text-white shadow-sm",
  },
  conversation: {
    create: "Шинээр ярилцлагын тэмдэглэл үүсгэх",
    search: "Ярилцлагын тэмдэглэлээс хайх",
    accent: "border border-sky-solid/50 bg-sky-bright text-white shadow-sm",
  },
  artwork: {
    create: "Бүтээл нэмэх",
    search: "Бүтээлээс хайх",
    accent: "border border-peach-solid/50 bg-peach-bright text-white shadow-sm",
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
  title,
  groupId,
  initialPanel = "notes",
}: {
  childId: string;
  /** `daily` · `conversation` · `artwork` — which set of doors to draw. */
  typeCode: string;
  typeId: string;
  /** The kind's own name, drawn in the header beside Буцах. */
  title: string;
  /** Narrows the Солих picker to one group; omitted, it is every child. */
  groupId?: string;
  /** Opens the requested archive when returning from a focused workflow. */
  initialPanel?: "notes" | "parent" | "reports";
}) {
  const router = useRouter();
  const { primaryKindergartenId } = useSession();
  const [picking, setPicking] = useState(false);
  const [yearId, setYearId] = useState("");
  const [recordScope, setRecordScope] = useState("all");
  const [coverageMonth, setCoverageMonth] = useState("");
  const [detail, setDetail] = useState<z.infer<typeof observationSchema> | null>(null);
  const [editing, setEditing] = useState<z.infer<typeof observationSchema> | null>(null);
  const [deleting, setDeleting] = useState<z.infer<typeof observationSchema> | null>(null);
  const [searchText, setSearchText] = useState("");
  /** Тэмдэглэл · Эцэг эх · Дүгнэлт — which part of the record is shown. */
  const [archive, setArchive] = useState<"notes" | "parent" | "reports">(initialPanel);
  const [filtering, setFiltering] = useState(false);
  /** "" — every strand. A `DevelopmentDomain` id otherwise. */
  const [domainId, setDomainId] = useState("");
  /** "" — this screen's own kind. `all`, or another kind's `code`. */
  const [typeFilter, setTypeFilter] = useState("");
  /** Artwork alone uses its fixed work-category vocabulary in the filter. */
  const [artworkType, setArtworkType] = useState("");
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  const observations = useQuery({
    queryKey: qk.childObservations(childId, { pageSize: MAX_PAGE_SIZE }),
    queryFn: () =>
      get(`/children/${childId}/observations?page=1&pageSize=${MAX_PAGE_SIZE}`, observationsSchema),
  });

  /*
    The kindergarten's strands, for the one rule the filter needs from them:
    which id is Зураг, урлал. `assessment-config` is readable by every member
    and every other screen in this flow asks for it, so this normally reads a
    warm cache rather than a request.
  */
  const config = useQuery({
    queryKey: qk.assessmentConfig(primaryKindergartenId ?? ""),
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/assessment-config`, assessmentConfigSchema),
    enabled: Boolean(primaryKindergartenId),
    staleTime: 5 * 60_000,
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

  const kind = KINDS[typeCode] ?? KINDS.daily!;

  /*
    ★ Filtered to this kind, and by `code` rather than by id.

    A kindergarten may add its own observation types, so the id differs per
    deployment while `daily` / `conversation` / `artwork` are the system rows'
    stable codes — the same keys `NewRecordStrip` filters its doors on.
  */
  const everyRecord = observations.data?.items ?? [];
  const mine = everyRecord.filter((row) => (row.type?.code ?? "") === typeCode);

  /*
    ★ The list's source, which Төрөл may widen past this screen's own kind.

    The strand chart stays on this kind's teacher-written notes: it answers
    "what has the curriculum been covered with", which is a question about
    what the teacher recorded, not about what the list happens to be narrowed
    to. The counts in the period select do follow the list, because a total
    over records the screen is not showing is how a note is declared missing.
  */
  const listSource =
    typeFilter === "all"
      ? everyRecord
      : typeFilter
        ? everyRecord.filter((row) => (row.type?.code ?? "") === typeFilter)
        : mine;

  /*
    ★ Эцэг эх is a panel now, not a door with a `?source=parent` of its own.

    The two note tabs are the same list split by who wrote it: a teacher
    reading their own term should not have to read past what families sent in,
    and a family's notes are exactly what a teacher checks before a parents'
    evening. The door this replaces navigated to a URL the hub ignored, so it
    showed the unsplit list and looked broken.

    The split sits above the term scope so the counts in the period select
    describe the list being shown — "Нийт (4)" over three cards is how a
    teacher concludes a note went missing.
  */
  const authored = listSource.filter((row) =>
    archive === "parent" ? row.source === "PARENT" : row.source !== "PARENT",
  );

  const creativeDomainId = (config.data?.domains ?? []).find(
    (domain) => domain.code === "creative",
  )?.id;

  /*
    The strands and the kinds that are actually on file, for the filter.

    ★ Бүтээл offers Зураг, урлал and nothing else — the client, 2026-09-14:
    "бүтээл дээр зөвхөн зураг урлал чиглэл байх", which is the filter's half of
    the rule the compose form already applies when it files an artwork note
    under `creative` (see `observations/new`). A strand list that offers six
    answers the record cannot hold is six ways to empty the list.

    Matched on the strand's `code`, never its name: an administrator may rename
    a strand (§2.3) and the code is the part that does not move.
  */
  const domainOptions = [
    ...new Map(
      everyRecord.flatMap((row) => row.domains.map((entry) => [entry.domain.id, entry.domain])),
    ).values(),
  ].filter(
    (domain) =>
      typeCode !== "artwork" ||
      // Until the config arrives nothing is hidden: a filter that empties
      // itself for a render is worse than one that narrows a beat late.
      !creativeDomainId ||
      domain.id === creativeDomainId,
  );
  const typeOptions = [
    ...new Map(
      everyRecord
        .filter((row) => row.type?.code)
        .map((row) => [row.type!.code!, { code: row.type!.code!, name: row.type!.name }]),
    ).values(),
  ];
  const activeFilters =
    (domainId ? 1 : 0) +
    (fromDay || toDay ? 1 : 0) +
    (typeCode === "artwork"
      ? artworkType
        ? 1
        : 0
      : typeFilter && typeFilter !== typeCode
        ? 1
        : 0);
  const clearFilters = () => {
    setDomainId("");
    setTypeFilter("");
    setArtworkType("");
    setFromDay("");
    setToDay("");
  };

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
      ? authored
      : selectedTerm?.startsOn && selectedTerm.endsOn
        ? authored.filter((row) => {
            const day = row.observedOn.slice(0, 10);
            return (
              day >= selectedTerm.startsOn!.slice(0, 10) && day <= selectedTerm.endsOn!.slice(0, 10)
            );
          })
        : [];
  const normalizedSearch = searchText.trim().toLocaleLowerCase("mn-MN");
  const shownRecords = scopedRecords.filter((row) => {
    const text = [row.situation, row.childDid, row.childSaid, row.teacherComment, row.activityName]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("mn-MN");
    if (normalizedSearch && !text.includes(normalizedSearch)) return false;

    const day = row.observedOn.slice(0, 10);
    if (fromDay && day < fromDay) return false;
    if (toDay && day > toDay) return false;
    if (domainId && !row.domains.some((entry) => entry.domain.id === domainId)) return false;
    if (typeCode === "artwork" && artworkType && row.activityName !== artworkType) return false;

    return true;
  });

  const configuredMonths = monthsCoveredByTerms(termsInYear);
  const coverageMonths =
    configuredMonths.length > 0
      ? configuredMonths
      : [...new Set(inYear.map((row) => row.observedOn.slice(0, 7)))].sort();
  const currentMonth = todayMonth();
  const selectedCoverageMonth = coverageMonths.includes(coverageMonth)
    ? coverageMonth
    : coverageMonths.includes(currentMonth)
      ? currentMonth
      : (coverageMonths.at(-1) ?? "");
  const coverageRecords = mine.filter(
    (observation) =>
      observation.source !== "PARENT" &&
      observation.observedOn.slice(0, 7) === selectedCoverageMonth,
  );
  const domainCounts = new Map<string, { name: string; color?: string | null; count: number }>();
  for (const observation of coverageRecords) {
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
    return `/children/${childId}/observations?type=${typeCode}`;
  };

  const data = child.data!;
  const group = capitalize(data.enrollments?.find((row) => row.group)?.group?.name);

  return (
    <div className="flex flex-col gap-3">
      {/*
        ★ Буцах, the kind's name and the school year on one row — 2026-09-14,
        the client's drawing.

        The three were stacked: a back arrow on its own line, the title under
        it, and the year picker a screen further down among the note filters.
        They are one thought — where am I, whose year am I reading — and on a
        phone the stack cost a third of the first viewport before a single
        record. The year moves here from the record list for the same reason
        it belongs with the title rather than with the filters: it names what
        the whole screen is about, not what the list below is narrowed to.

        ★★ No card behind it — the client, 2026-09-14: "энэний арын хайрцаг
        арилга, зайг хасаж дээш шах." A white panel on the white page drew a
        box around a title that needs no box, and its padding pushed the
        child's own card a row further down the first screen.
      */}
      <header className="flex items-center gap-2">
        {/*
          ★ Nothing painted behind the row — the client, 2026-09-14: "энэний
          ард цагаан арилгаад өг, тунгалаг бай." The arrow and the year sit on
          the page's own ground; a filled disc and a filled pill were two
          panels drawn around controls that read perfectly well without them.
        */}
        <BackButton href="/dashboard" />
        <h1 className="min-w-0 flex-1 truncate text-title font-semibold leading-heading text-ink">
          {title}
        </h1>
        {years.length > 0 ? (
          <div className="relative shrink-0">
            <CalendarDays
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-primary"
            />
            <Select
              aria-label="Хичээлийн жил"
              value={selectedYearId}
              onChange={(event) => {
                setYearId(event.target.value);
                setRecordScope("all");
                setCoverageMonth("");
              }}
              className="h-11 w-auto min-w-[150px] rounded-pill bg-transparent pl-9"
            >
              {years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </header>

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

      {/*
        ★★ The three kinds, on the child's own screen — 2026-09-17, the client:
        "хүүхэд дээр дарахаар ... дээр нь ажиглалт, ярилцлага, бүтээл гэсэн 3
        товчоо нэмээд өг."

        The doors exist on the group's assessment screen, so switching from a
        child's Ажиглалт to their Ярилцлага meant going back to the group,
        pressing the other door and picking the same child again — three
        presses to change one word. Here they are a switch, and the child
        stays.

        Links rather than buttons: each is a real route (`?type=…`), so the
        browser's own Back steps between kinds and a teacher can open one in a
        second tab.
      */}
      <nav aria-label="Тэмдэглэлийн төрөл" className="grid grid-cols-3 gap-1.5">
        {KIND_SWITCH.map((entry) => {
          const active = entry.code === typeCode;
          return (
            <Link
              key={entry.code}
              href={`/children/${childId}/observations?type=${entry.code}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center justify-center gap-1.5 rounded-control border px-2",
                "text-caption font-semibold transition-colors sm:text-body",
                active
                  ? "border-transparent bg-primary text-primary-ink"
                  : "border-border bg-surface text-muted hover:bg-canvas hover:text-ink",
              )}
            >
              {entry.label}
            </Link>
          );
        })}
      </nav>

      {/*
        ★ Every kind gets the Ажиглалт screen — the client, 2026-09-14:
        "ярилцлага, бүтээл, ажиглалтыг ижил загвартай болго."

        Ярилцлага and Бүтээл used to draw four tiles and nothing else: no
        search, no strand chart, and a create button one press deeper than the
        one Ажиглалт has. They are the same screen about different records, so
        the layout is the same and only the words and the colour differ.
      */}
      <Link
        href={href("new")}
        className={cn(
          "flex min-h-12 items-center justify-center gap-2 rounded-button px-4",
          "text-body font-semibold shadow-sm transition-transform hover:-translate-y-0.5",
          kind.accent,
        )}
      >
        <Plus size={19} strokeWidth={2.5} aria-hidden="true" />
        {kind.create}
      </Link>

      <div className="flex flex-col gap-2">
        {/*
            ★ Шүүлтүүр beside the search box — 2026-09-14, the client's
            "ажиглалтаас хайхын арад шүүлтүүр товч".

            Search answers "where is the note that said X"; the filter answers
            "show me the movement notes from last month", which no amount of
            typing can. They are one row because they narrow the same list, and
            the badge says how many narrowings are in force — a filtered list
            that looks like a short list is how a teacher concludes they never
            wrote anything.
          */}
        <div className="flex items-center gap-2">
          <SearchField
            label={kind.search}
            placeholder={kind.search}
            value={searchText}
            onChange={setSearchText}
          />
          <button
            type="button"
            onClick={() => setFiltering(true)}
            aria-label="Шүүлтүүр"
            className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-field border border-border bg-surface text-muted transition-colors hover:text-ink"
          >
            <SlidersHorizontal size={18} aria-hidden="true" />
            {activeFilters > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-pill bg-primary px-1 text-caption font-semibold text-primary-ink">
                {activeFilters}
              </span>
            ) : null}
          </button>
        </div>

        {typeCode === "artwork" ? null : (
          <Card pad="compact">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-body font-semibold text-ink">Сургалтын чиглэл</h2>
              {coverageMonths.length > 0 ? (
                <Select
                  aria-label="Сургалтын чиглэлийн сар"
                  value={selectedCoverageMonth}
                  onChange={(event) => setCoverageMonth(event.target.value)}
                  className="w-auto min-w-[116px]"
                >
                  {coverageMonths.map((month) => (
                    <option key={month} value={month}>
                      {monthLabel(month)}
                    </option>
                  ))}
                </Select>
              ) : null}
            </div>
            {domainCounts.size > 0 ? (
              <div className="flex flex-col gap-2.5">
                {[...domainCounts.entries()].map(([id, row]) => {
                  const peak = Math.max(...[...domainCounts.values()].map((item) => item.count), 1);
                  return (
                    <div
                      key={id}
                      className="grid grid-cols-[minmax(92px,1fr)_minmax(72px,1.2fr)_24px] items-center gap-2"
                    >
                      <span className="min-w-0 truncate text-caption text-ink">{row.name}</span>
                      <span
                        role="img"
                        aria-label={`${row.name}: ${row.count} тэмдэглэл`}
                        className="h-2 overflow-hidden rounded-pill bg-track"
                      >
                        <span
                          className="block h-full rounded-pill"
                          style={{
                            width: `${(row.count / peak) * 100}%`,
                            backgroundColor: row.color ?? "var(--color-primary)",
                          }}
                        />
                      </span>
                      <strong className="text-right text-caption tabular-nums text-ink">
                        {row.count}
                      </strong>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-caption text-muted">
                {selectedCoverageMonth
                  ? `${monthLabel(selectedCoverageMonth)} чиглэлтэй ажиглалт ороогүй.`
                  : "Чиглэлтэй ажиглалт ороогүй."}
              </p>
            )}
          </Card>
        )}
      </div>

      {/*
        ★ Нийт ба улирлууд нэг compact dropdown-д — 2026-09-14.

        Previously Нийт was one full-width row, the terms were a separate card
        below it, and the chosen records opened after every term. On a phone a
        teacher pressed near the top and then had to scroll past the whole
        selector to find what changed. These are filters over the same cards, so
        one dropdown now carries the count and opens the result immediately.

        The design draws four; `Term` is administrator-editable (§2.3) and a
        kindergarten may run three. Building the rows from the configured terms
        rather than a fixed four means the screen matches whatever the office
        set up, and a deployment with none draws nothing rather than four empty
        rows.
      */}
      <section
        aria-label={
          typeCode === "artwork" ? "Бичсэн бүтээл ба ахицын цуваа" : "Бичсэн тэмдэглэл ба дүгнэлт"
        }
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-body font-semibold text-ink">
            {archive === "notes"
              ? "Бичсэн тэмдэглэлүүд"
              : typeCode === "artwork" && archive === "reports"
                ? "Бүтээлийн ахиц"
                : "Бичсэн дүгнэлтүүд"}
          </h2>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {archive === "reports" ? null : (
              <Select
                aria-label="Тэмдэглэлийн хугацаа"
                value={recordScope}
                onChange={(event) => setRecordScope(event.target.value)}
                className="w-auto min-w-[148px]"
              >
                <option value="all">Нийт ({authored.length})</option>
                {termsInYear
                  .slice()
                  .sort((a, b) => a.number - b.number)
                  .map((term) => {
                    const count = authored.filter(
                      (row) =>
                        row.observedOn.slice(0, 10) >= (term.startsOn ?? "").slice(0, 10) &&
                        row.observedOn.slice(0, 10) <= (term.endsOn ?? "").slice(0, 10),
                    ).length;
                    return (
                      <option key={term.id} value={term.id}>
                        {capitalize(term.name)} ({count})
                      </option>
                    );
                  })}
              </Select>
            )}
          </div>
        </div>

        {/*
          ★ Тэмдэглэл · Дүгнэлт — the client's 2026-09-14 ask, on the screen
          where the notes are.

          "Багш бичсэн ажиглалт, тэмдэглэл, ярилцлагаасаа сонгон дүгнэлт бичнэ."
          The conclusion is written from these records, so the place to read it
          back is beside them rather than one screen away — and the citation
          under each conclusion names which of them it was written from.

          The same pair is at the foot of Улирлын тайлан, from the same
          component, because two lists of the same rows drift and the one
          nobody edits is the one the teacher is looking at.
        */}
        <div
          role="tablist"
          aria-label={
            typeCode === "artwork"
              ? "Тэмдэглэл, эцэг эх ба ахицын цуваа"
              : "Тэмдэглэл, эцэг эх ба дүгнэлт"
          }
          className="grid grid-cols-3 gap-2"
        >
          <ArchiveTab
            active={archive === "notes"}
            controls="hub-notes"
            onSelect={() => setArchive("notes")}
            className={cn("w-full", archive === "notes" && kind.accent)}
          >
            Тэмдэглэл
          </ArchiveTab>
          <ArchiveTab
            active={archive === "parent"}
            controls="hub-parent"
            onSelect={() => setArchive("parent")}
            className={cn("w-full", archive === "parent" && kind.accent)}
          >
            Эцэг эх
          </ArchiveTab>
          <ArchiveTab
            active={archive === "reports"}
            controls="hub-reports"
            onSelect={() => setArchive("reports")}
            className={cn("w-full", archive === "reports" && kind.accent)}
          >
            {typeCode === "artwork" ? "Ахицын цуваа" : "Дүгнэлт"}
          </ArchiveTab>
        </div>

        {archive !== "reports" ? (
          <div
            id={archive === "notes" ? "hub-notes" : "hub-parent"}
            role="tabpanel"
            aria-label={archive === "notes" ? "Тэмдэглэл" : "Эцэг эх"}
          >
            {shownRecords.length > 0 ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {shownRecords.map((observation) => (
                  <li key={observation.id}>
                    <MomentCard
                      observation={observation}
                      canManage
                      showPlaceholderArt={false}
                      showTeacherMetadata
                      onOpen={() => setDetail(observation)}
                      onEdit={() => setEditing(observation)}
                      onDelete={() => setDeleting(observation)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title={
                  archive === "notes" ? "Тэмдэглэл ороогүй" : "Эцэг эхээс ирсэн тэмдэглэл алга"
                }
              />
            )}
          </div>
        ) : typeCode === "artwork" ? (
          <div id="hub-reports" role="tabpanel" aria-label="Ахицын цуваа">
            <ChildArtwork childId={childId} isStaff />
          </div>
        ) : (
          <div
            id="hub-reports"
            role="tabpanel"
            aria-label="Дүгнэлт"
            className="flex flex-col gap-3"
          >
            <Link
              href={`/children/${childId}/term-report`}
              className={cn(
                "inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-button px-4",
                "text-body font-semibold transition-transform hover:-translate-y-0.5",
                kind.accent,
              )}
            >
              <PenLine size={17} aria-hidden="true" />
              Дүгнэлт бичих
            </Link>

            <WrittenReports
              childId={childId}
              terms={termsInYear}
              showCitedNotes
              emptyDescription="Дүгнэлт бичих дээр дараад бичсэн тэмдэглэлүүдээсээ сонгон дүгнэлтээ бичнэ үү."
            />
          </div>
        )}
      </section>

      {/*
        ★ Чиглэл · Огноо · Төрөл, the three questions the client named.

        A dialog rather than a row of selects on the screen: on a phone three
        controls above the list push the records themselves below the fold,
        which is the thing the filter exists to help someone read. Цэвэрлэх is
        in the footer rather than per-field, because the way out of a filtered
        list nobody meant to filter has to be one press.
      */}
      <FormDialog
        open={filtering}
        onOpenChange={setFiltering}
        title="Шүүлтүүр"
        description="Чиглэл, огноо, төрлөөр нарийсгана."
        footer={
          <>
            <Button variant="secondary" onClick={clearFilters} disabled={activeFilters === 0}>
              Цэвэрлэх
            </Button>
            <Button onClick={() => setFiltering(false)}>Харах</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Сургалтын чиглэл">
            {({ id }) => (
              <Select
                id={id}
                value={domainId}
                onChange={(event) => setDomainId(event.target.value)}
              >
                <option value="">Бүх чиглэл</option>
                {domainOptions.map((domain) => (
                  <option key={domain.id} value={domain.id}>
                    {capitalize(domain.name)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {typeCode === "artwork" ? (
            <Field label="Төрөл">
              {({ id }) => (
                <Select
                  id={id}
                  value={artworkType}
                  onChange={(event) => setArtworkType(event.target.value)}
                >
                  <option value="">Бүх төрөл</option>
                  {ARTWORK_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <Field label="Төрөл">
              {({ id }) => (
                <Select
                  id={id}
                  value={typeFilter || typeCode}
                  onChange={(event) =>
                    setTypeFilter(event.target.value === typeCode ? "" : event.target.value)
                  }
                >
                  {typeOptions.map((type) => (
                    <option key={type.code} value={type.code}>
                      {capitalize(type.name)}
                    </option>
                  ))}
                  <option value="all">Бүх төрөл</option>
                </Select>
              )}
            </Field>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Эхлэх огноо">
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={fromDay}
                  max={toDay || undefined}
                  onChange={(event) => setFromDay(event.target.value)}
                />
              )}
            </Field>
            <Field label="Дуусах огноо">
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={toDay}
                  min={fromDay || undefined}
                  onChange={(event) => setToDay(event.target.value)}
                />
              )}
            </Field>
          </div>
        </div>
      </FormDialog>

      <ObservationDetailDialog
        observation={detail}
        showTeacherMetadata
        onClose={() => setDetail(null)}
      />
      {editing ? (
        <EditObservationDialog
          childId={childId}
          observation={editing}
          terms={terms.data ?? []}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <DeleteObservationDialog
        childId={childId}
        observation={deleting}
        onClose={() => setDeleting(null)}
      />

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

function monthsCoveredByTerms(terms: z.infer<typeof termsSchema>): string[] {
  const starts = terms.flatMap((term) => (term.startsOn ? [term.startsOn.slice(0, 7)] : []));
  const ends = terms.flatMap((term) => (term.endsOn ? [term.endsOn.slice(0, 7)] : []));
  if (starts.length === 0 || ends.length === 0) return [];

  const first = starts.sort()[0]!;
  const last = ends.sort().at(-1)!;
  const months: string[] = [];
  let year = Number(first.slice(0, 4));
  let month = Number(first.slice(5, 7));

  while (months.length < 24) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (key > last) break;
    months.push(key);
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

function monthLabel(month: string): string {
  return `${Number(month.slice(5, 7))}-р сар`;
}

function todayMonth(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 7);
}

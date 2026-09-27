"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";
import { z } from "zod";
import {
  MAX_PAGE_SIZE,
  assessmentConfigSchema,
  childDetailSchema,
  childSummarySchema,
  observationSchema,
  observationTypeSchema,
  paginated,
  termReportSchema,
  termSchema,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BackButton } from "@/components/ui/back-button";
import { Input, Select } from "@/components/ui/field";
import { FilterChip } from "@/components/ui/filter-chip";
import { SearchField } from "@/components/ui/search-field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { ChildPickerDialog } from "@/components/child/child-picker-dialog";
import { ConclusionNotes } from "@/components/assessment/conclusion-notes";
import { ConclusionForm } from "@/components/assessment/conclusion-form";
import { formatAge, fullName } from "@/lib/format";

/**
 * Дүгнэлт бичих — the teacher's conclusion about one child, one term.
 *
 * ★ Rebuilt to the client's drawing, 2026-09-14.
 *
 * The screen used to be a column: a term select, a list of notes to tick, then
 * four textareas under it. Writing a conclusion means reading the term back
 * while writing, and a column makes that a scroll — the evidence is off-screen
 * exactly when it is being summarised. Two panes put the notes beside the text
 * on a laptop, which is where this is written, and stack on a phone, which is
 * where it is read.
 *
 * ★★ **Staff only** — the client, same day: "удирдлага бичсэнг харна, эцэг эх
 * харахгүй." The API answers a guardian with the shape an unwritten report
 * has, so this screen tells them why rather than showing them a blank one.
 *
 * ★★★ The previously written conclusions are **not** here any more.
 *
 * They are a tab on the record hub — "энэ явцын үнэлгээний дүгнэлт доор орсон
 * тул дээрээ байх хэрэггүй" — and a second copy at the foot of the screen
 * where the next one is written is the duplication that instruction is about.
 */
const termsSchema = z.array(termSchema);
const observationsSchema = paginated(observationSchema);
const observationTypesSchema = z.array(observationTypeSchema);
const childrenPageSchema = paginated(childSummarySchema);

export default function TermReportPage() {
  const params = useParams<{ childId: string }>();
  return <TermReport childId={params.childId} />;
}

function TermReport({ childId }: { childId: string }) {
  const router = useRouter();
  const { hasRole, primaryKindergartenId } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");

  /*
    ★ A date range, not a school year and a term — the client, 2026-09-14:
    "2026-2027, 1. I улирал энэ хэрэггүй, оронд эхлэх дуусах хугацаа оруул."

    The two selects answered "which notes" twice over, and a teacher writing up
    a fortnight had to pick the term that contained it and then read past
    everything else in it. The range says the same thing directly.

    The term itself does not disappear — a conclusion belongs to one, the API
    saves it against `termId`, and a family's report is read per term. It is
    *derived* from the start of the range and named on the form, so the screen
    stops asking a question it can answer and nothing about the record changes.
  */
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [domainId, setDomainId] = useState("");
  const [typeCode, setTypeCode] = useState("all");
  const [search, setSearch] = useState("");
  const [picking, setPicking] = useState(false);
  const [citedIds, setCitedIds] = useState<string[]>([]);

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  const terms = useQuery({
    queryKey: qk.adminTerms(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/terms`, termsSchema),
    enabled: Boolean(primaryKindergartenId),
  });

  const config = useQuery({
    queryKey: qk.assessmentConfig(primaryKindergartenId ?? ""),
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/assessment-config`, assessmentConfigSchema),
    enabled: Boolean(primaryKindergartenId) && isStaff,
    staleTime: 5 * 60_000,
  });

  const types = useQuery({
    queryKey: qk.observationTypes(childId),
    queryFn: () => get(`/children/${childId}/observations/types`, observationTypesSchema),
    enabled: isStaff,
    staleTime: 5 * 60_000,
  });

  /*
    ★ The strand goes to the server; every other filter does not.

    A note's list shape carries no domains, so `?domainId=` is the only way to
    ask that question. The term, the kind and the keyword are all answerable
    from rows this screen already has, and refetching for them would be a
    request to answer something already on screen.
  */
  const notes = useQuery({
    queryKey: qk.childObservations(childId, { pageSize: MAX_PAGE_SIZE, domainId }),
    queryFn: () =>
      get(
        `/children/${childId}/observations?page=1&pageSize=${MAX_PAGE_SIZE}` +
          (domainId ? `&domainId=${domainId}` : ""),
        observationsSchema,
      ),
    enabled: isStaff,
  });

  /** The roster, for the arrows beside the child's name. */
  const roster = useQuery({
    queryKey: qk.children({ page: 1, pageSize: MAX_PAGE_SIZE }),
    queryFn: () => get(`/children?page=1&pageSize=${MAX_PAGE_SIZE}`, childrenPageSchema),
    enabled: isStaff,
    staleTime: 60_000,
  });

  const termItems = useMemo(() => terms.data ?? [], [terms.data]);

  const ordered = useMemo(
    () => [...termItems].sort((a, b) => (a.startsOn ?? "").localeCompare(b.startsOn ?? "")),
    [termItems],
  );

  /*
    The term the range starts in — the one this conclusion is saved against.

    Falling back to the last configured term rather than to none: a range that
    lands in a school holiday still has to be written up somewhere, and the
    form names whichever term it resolved to.
  */
  const term =
    ordered.find(
      (row) => (row.startsOn ?? "").slice(0, 10) <= from && from <= (row.endsOn ?? "").slice(0, 10),
    ) ?? ordered[ordered.length - 1];
  const termId = term?.id ?? "";

  const report = useQuery({
    queryKey: qk.termReport(childId, termId),
    queryFn: () => get(`/children/${childId}/term-report?termId=${termId}`, termReportSchema),
    enabled: isStaff && Boolean(termId),
  });

  // Opens on the term today falls inside, and on the last one otherwise —
  // which in June is the term a teacher is actually writing up.
  useEffect(() => {
    if (from || ordered.length === 0) return;

    const today = new Date().toISOString().slice(0, 10);
    const current = ordered.find(
      (row) => (row.startsOn ?? "") <= today && today <= (row.endsOn ?? ""),
    );
    const opening = current ?? ordered[ordered.length - 1]!;
    setFrom((opening.startsOn ?? "").slice(0, 10));
    setTo((opening.endsOn ?? "").slice(0, 10));
  }, [ordered, from]);

  // The citation is seeded from the saved report, and re-seeded per term.
  useEffect(() => {
    setCitedIds((report.data?.observations ?? []).map((row) => row.id));
  }, [report.data, termId]);

  /*
    The notes in range, before the kind chips — which are counted from this
    set, so a chip's number and the list under it cannot disagree.
  */
  const keyword = search.trim().toLocaleLowerCase("mn-MN");
  const inTerm = (notes.data?.items ?? []).filter((note) => {
    const day = note.observedOn.slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;

    if (!keyword) return true;
    return [note.situation, note.childDid, note.childSaid, note.teacherComment, note.activityName]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("mn-MN")
      .includes(keyword);
  });

  const shownNotes =
    typeCode === "all" ? inTerm : inTerm.filter((note) => (note.type?.code ?? "") === typeCode);

  /*
    ★ A ticked note is shown in the citation even when the filter hides it.

    The selection outlives the filter, so the right-hand list is resolved from
    the whole term rather than from what is currently on the left — otherwise
    changing a chip would appear to have unticked half the citation.
  */
  const citedNotes = useMemo(() => {
    const byId = new Map((notes.data?.items ?? []).map((note) => [note.id, note]));
    return citedIds
      .map((id) => byId.get(id))
      .filter((note): note is NonNullable<typeof note> => Boolean(note))
      .sort((a, b) => a.observedOn.localeCompare(b.observedOn));
  }, [citedIds, notes.data]);

  const rosterItems = roster.data?.items ?? [];
  const atIndex = rosterItems.findIndex((row) => row.id === childId);
  const step = (delta: number) => {
    const next = rosterItems[atIndex + delta];
    if (next) router.push(`/children/${next.id}/term-report`);
  };

  if (child.isLoading) return <LoadingState rows={4} />;
  if (child.isError) return <ErrorState description={errorMessage(child.error)} />;

  const data = child.data!;
  const group = data.enrollments?.find((row) => row.group)?.group?.name;

  return (
    <div className="flex flex-col gap-4 py-2">
      <header className="flex items-center gap-2">
        <BackButton href={`/children/${childId}/observations?type=daily`} />
        <h1 className="min-w-0 flex-1 truncate text-title font-semibold leading-heading text-ink">
          Дүгнэлт бичих
        </h1>

        {/*
          The trail, on the widths that have room for it. A phone gets the back
          arrow, which is the same journey in one control.
        */}
        <nav aria-label="Замнал" className="hidden shrink-0 text-caption text-muted lg:block">
          <Link href="/children" className="hover:text-ink">
            Суралцагч
          </Link>
          <span aria-hidden="true"> / </span>
          <Link href={`/children/${childId}/general`} className="hover:text-ink">
            {fullName(data)}
          </Link>
          <span aria-hidden="true"> / </span>
          <Link href={`/children/${childId}/observations?type=daily`} className="hover:text-ink">
            Ажиглалт
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="font-semibold text-ink">Дүгнэлт</span>
        </nav>
      </header>

      {!isStaff ? (
        /*
          ★ A family is told, rather than shown an empty form — 2026-09-14.

          The conclusion is the teacher's professional judgement, written for
          the kindergarten's record; what a family reads is the portfolio, the
          notes marked visible and the assessments released to them. Saying so
          in one sentence is the difference between a rule and a screen that
          looks broken.
        */
        <EmptyState
          title="Улирлын дүгнэлт нээлттэй биш"
          description="Багшийн бичсэн улирлын дүгнэлтийг цэцэрлэгийн багш, удирдлага үзнэ. Та хүүхдийнхээ тэмдэглэл, зураг, үнэлгээг цахим хувийн хавтаснаас харна уу."
        />
      ) : (
        <>
          {/*
            ★ The child is named at the top, with both ways to change them.

            A teacher writing conclusions works down a roster, and the commonest
            next action after finishing one child is the same screen for the
            next: the arrows are that in one press, Сурагч солих is for jumping.
          */}
          <Card pad="compact" className="flex items-center gap-3">
            <ChildAvatar child={data} size={44} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-lead font-semibold leading-snug text-ink">
                {fullName(data)}
              </p>
              <p className="truncate text-caption text-muted">
                {formatAge(data.dateOfBirth)}
                {group ? ` · ${group}` : ""}
              </p>
            </div>

            <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
              <Users size={15} aria-hidden="true" />
              Сурагч солих
            </Button>

            <div className="hidden shrink-0 gap-1 sm:flex">
              <Button
                size="icon"
                variant="ghost"
                aria-label="Өмнөх сурагч"
                disabled={atIndex <= 0}
                onClick={() => step(-1)}
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Дараагийн сурагч"
                disabled={atIndex < 0 || atIndex >= rosterItems.length - 1}
                onClick={() => step(1)}
              >
                <ChevronRight size={18} aria-hidden="true" />
              </Button>
            </div>
          </Card>

          {termItems.length === 0 ? (
            <EmptyState
              title="Улирал бүртгэгдээгүй байна"
              description="Улирлын дүгнэлт улиралд харьяалагддаг. Захирал эхлээд улирал үүсгэнэ."
            />
          ) : (
            <>
              {/*
                ★ Эхлэх · Дуусах · Сургалтын чиглэл on one line, labelled by
                their own values — the client, 2026-09-14: "нэг цуваанд
                харуулаад өг, доошоо болохоор зай их эзлээд байна", and then
                "2026-2027, 1. I улирал энэ хэрэггүй, оронд эхлэх дуусах
                хугацаа оруул".

                Three stacked `Field`s cost three label lines and three rows
                before a single note, on the screen whose whole point is the
                notes. The name of each control is carried by `aria-label`
                rather than a printed line — the same trade the record hub's
                own period select makes, and what §5's "every field has a
                label" is actually asking for: a control a screen reader can
                name, not a word printed above every box.

                The keyword box keeps the row under them: it answers a
                different question and it is the one control whose value is
                typed rather than chosen.
              */}
              <Card pad="compact" className="flex flex-col gap-2">
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    type="date"
                    aria-label="Эхлэх огноо"
                    value={from}
                    max={to || undefined}
                    onChange={(event) => setFrom(event.target.value)}
                  />
                  <Input
                    type="date"
                    aria-label="Дуусах огноо"
                    value={to}
                    min={from || undefined}
                    onChange={(event) => setTo(event.target.value)}
                  />
                  <Select
                    aria-label="Сургалтын чиглэл"
                    value={domainId}
                    onChange={(event) => setDomainId(event.target.value)}
                  >
                    <option value="">Бүх чиглэл</option>
                    {(config.data?.domains ?? []).map((domain) => (
                      <option key={domain.id} value={domain.id}>
                        {domain.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <SearchField
                  label="Тэмдэглэл хайх"
                  placeholder="Тэмдэглэл хайх…"
                  value={search}
                  onChange={setSearch}
                />
              </Card>

              {/* The kinds, counted over everything the filters left standing. */}
              <div className="flex flex-wrap gap-2">
                <FilterChip active={typeCode === "all"} onClick={() => setTypeCode("all")}>
                  Бүгд ({inTerm.length})
                </FilterChip>
                {(types.data ?? []).map((type) => {
                  const count = inTerm.filter(
                    (note) => (note.type?.code ?? "") === (type.code ?? ""),
                  ).length;
                  return (
                    <FilterChip
                      key={type.id}
                      active={typeCode === type.code}
                      onClick={() => setTypeCode(type.code ?? "")}
                    >
                      {type.name} ({count})
                    </FilterChip>
                  );
                })}
              </div>

              {notes.isError ? <ErrorState description={errorMessage(notes.error)} /> : null}
              {report.isError ? <ErrorState description={errorMessage(report.error)} /> : null}

              {notes.isLoading || report.isLoading || !term ? (
                <LoadingState rows={4} />
              ) : (
                <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
                  <ConclusionNotes
                    notes={shownNotes}
                    selected={citedIds}
                    onToggle={(id) =>
                      setCitedIds((current) =>
                        current.includes(id)
                          ? current.filter((row) => row !== id)
                          : [...current, id],
                      )
                    }
                  />

                  <ConclusionForm
                    key={termId}
                    childId={childId}
                    term={term}
                    report={report.data}
                    citedNotes={citedNotes}
                    citedIds={citedIds}
                    onRemove={(id) => setCitedIds((current) => current.filter((row) => row !== id))}
                    onClear={() => setCitedIds([])}
                  />
                </div>
              )}
            </>
          )}

          {picking ? (
            <ChildPickerDialog
              selectedId={childId}
              title="Сурагч солих"
              onSelect={(nextId) => {
                setPicking(false);
                router.push(`/children/${nextId}/term-report`);
              }}
              onClose={() => setPicking(false)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

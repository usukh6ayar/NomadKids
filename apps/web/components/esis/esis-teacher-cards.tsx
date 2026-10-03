"use client";

import { useState } from "react";
import { capitalize } from "@/lib/format";
import { Card, SectionHeader } from "@/components/ui/card";
import { SearchField } from "@/components/ui/search-field";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { TableShell, Td, Th } from "@/components/ui/table";
import { useEsisRows } from "@/components/esis/use-esis-rows";

/*
  «Заах аргын нэгдэл» and «Багшийн жагсаалт» on the settings page — 2026-10-02,
  at the client's request: both were `EsisDataPanel`s, which print every field
  ESIS returns, ids and codes included (`institutionId`, `personId`,
  `subjectDepartmentId`, `instructorTypeId`, …). A teacher reads names, not
  codes, so these draw only the fields that mean something to a reader, under
  their Mongolian labels. The ids are still ESIS's; nothing here stores them.
*/

type Row = Record<string, string | null>;

function personName(row: Row): string {
  const name = [row.lastName, row.firstName]
    .filter((part): part is string => Boolean(part))
    .map(capitalize)
    .join(" ");
  return name || row.displayName || "—";
}

function Status({
  isPending,
  isError,
  empty,
}: {
  isPending: boolean;
  isError: boolean;
  empty: string;
}) {
  if (isPending) return <LoadingState rows={2} />;
  return (
    <p className="py-2 text-body text-muted">{isError ? "ЭСИС-ээс хариу ирсэнгүй." : empty}</p>
  );
}

/** The signed-in teacher's own unit and post, as ESIS has them. */
export function EsisAcademicOrgCard() {
  const own = useEsisRows("teacherAcademicOrg");
  if (own.isUnavailable) return null;

  return (
    <section aria-labelledby="esis-academic-org" className="flex flex-col gap-3">
      <SectionHeader
        as="h3"
        id="esis-academic-org"
        title="Заах аргын нэгдэл"
        lede="ЭСИС-д бүртгэлтэй заах аргын нэгдэл, албан тушаал"
      />
      {own.rows.length === 0 ? (
        <Status
          isPending={own.isPending}
          isError={own.isError}
          empty="ЭСИС-д заах аргын нэгдэл бүртгэгдээгүй."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {own.rows.map((row, index) => (
            <Card key={index} pad="compact" className="flex flex-col gap-2">
              <dl className="flex flex-col gap-2">
                <div>
                  <dt className="text-caption text-muted">Заах аргын нэгдэл</dt>
                  <dd className="text-body font-semibold text-ink">
                    {row.subjectDepartmentName ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-muted">Албан тушаал</dt>
                  <dd className="text-body text-ink">{row.jobName ?? "—"}</dd>
                </div>
              </dl>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

/** The kindergarten's teachers as ESIS lists their appointments. */
export function EsisTeacherListCard() {
  const teachers = useEsisRows("teachers");
  const [search, setSearch] = useState("");
  if (teachers.isUnavailable) return null;

  const needle = search.trim().toLocaleLowerCase("mn-MN");
  const rows = teachers.rows
    .filter(
      (row) =>
        !needle ||
        [personName(row), row.positionName, row.subjectDepartmentName]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("mn-MN")
          .includes(needle),
    )
    .sort((a, b) => personName(a).localeCompare(personName(b), "mn"));

  return (
    <section aria-labelledby="esis-teacher-list" className="flex flex-col gap-3">
      <SectionHeader
        as="h3"
        id="esis-teacher-list"
        title="Багшийн жагсаалт"
        lede="ЭСИС-д бүртгэлтэй багш нарын томилгоо"
      />
      {teachers.rows.length === 0 ? (
        <Status
          isPending={teachers.isPending}
          isError={teachers.isError}
          empty="ЭСИС-д бүртгэлтэй багш алга."
        />
      ) : (
        <>
          <SearchField
            label="Багш хайх"
            placeholder="Нэр, албан тушаал, нэгдлээр хайх…"
            value={search}
            onChange={setSearch}
          />
          {rows.length === 0 ? (
            <EmptyState title="Багш олдсонгүй" description="Хайлтаа өөрчилж дахин оролдоно уу." />
          ) : (
            <TableShell caption="ЭСИС-ийн багшийн жагсаалт" minWidth="min-w-[720px]">
              <thead>
                <tr>
                  <Th className="w-12">№</Th>
                  <Th>Овог, нэр</Th>
                  <Th>Албан тушаал</Th>
                  <Th>Багшийн төрөл</Th>
                  <Th>Заах аргын нэгдэл</Th>
                  <Th>Ажиллах боломж</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.assignmentId ?? `${row.personId}-${index}`}>
                    <Td className="tabular-nums text-muted">{index + 1}</Td>
                    <Td className="font-medium text-ink">{personName(row)}</Td>
                    <Td>{row.positionName ?? "—"}</Td>
                    <Td>{row.instructorTypeName ?? "—"}</Td>
                    <Td>{row.subjectDepartmentName ?? "—"}</Td>
                    <Td>{row.instructorAvailability ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </>
      )}
    </section>
  );
}

/*
  «Ажлын мэдээлэл» — the signed-in person's own ESIS record, 2026-10-03.

  ★ Same request as the two sections above: the tab printed every field the
  `teachers` / `staff` service returns, codes and ids included
  (`institutionId`, `assignmentId`, `personId`, `instructorTypeId`,
  `positionCode`, `jobCode`, …). It now draws only what a person reads about
  their own job, under Mongolian labels, and only the fields ESIS filled. The
  civil id and register number are left out as well: they are identifiers,
  not facts about the job, and this screen is not where they are checked.
*/

type WorkField = { key: string; label: string; format?: (value: string) => string };

const yesNo = (value: string) =>
  ["1", "true", "y", "yes"].includes(value.toLowerCase()) ? "Тийм" : "Үгүй";

const PERSON_FIELDS: WorkField[] = [
  { key: "familyName", label: "Ургийн овог" },
  { key: "genderName", label: "Хүйс" },
  { key: "dateOfBirth", label: "Төрсөн огноо", format: (value) => value.slice(0, 10) },
];

const EMAIL_FIELDS: WorkField[] = [
  { key: "microsoftEmail", label: "Албан и-мэйл (Microsoft)" },
  { key: "googleEmail", label: "Албан и-мэйл (Google)" },
];

const WORK_FIELDS: Record<"teachers" | "staff", WorkField[]> = {
  teachers: [
    { key: "positionName", label: "Албан тушаал" },
    { key: "instructorTypeName", label: "Багшийн төрөл" },
    { key: "subjectDepartmentName", label: "Заах аргын нэгдэл" },
    { key: "instructorAvailability", label: "Ажиллах боломж" },
    ...PERSON_FIELDS,
    ...EMAIL_FIELDS,
  ],
  staff: [
    { key: "institutionName", label: "Байгууллага" },
    { key: "parentInstitutionName", label: "Дээд байгууллага" },
    { key: "positionName", label: "Албан тушаал" },
    { key: "minor", label: "Мэргэшил" },
    { key: "primaryFlag", label: "Үндсэн ажлын байр", format: yesNo },
    { key: "educationSectorYears", label: "Боловсролын салбарт ажилласан жил" },
    { key: "yearsOfService", label: "Нийт ажилласан жил" },
    { key: "propertyClassificationName", label: "Өмчийн ангилал" },
    ...PERSON_FIELDS,
    ...EMAIL_FIELDS,
  ],
};

export function EsisWorkRecord({
  resource,
  row,
}: {
  resource: "teachers" | "staff";
  row: Record<string, string | null>;
}) {
  const filled = WORK_FIELDS[resource].filter((field) => row[field.key]);
  const name = personName(row);

  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {name !== "—" ? (
        <div className="sm:col-span-2">
          <dt className="text-caption text-muted">Овог, нэр</dt>
          <dd className="text-lead font-semibold text-ink">{name}</dd>
        </div>
      ) : null}
      {filled.map((field) => (
        <div key={field.key}>
          <dt className="text-caption text-muted">{field.label}</dt>
          <dd className="text-body text-ink">
            {field.format ? field.format(row[field.key]!) : row[field.key]}
          </dd>
        </div>
      ))}
      {filled.length === 0 && name === "—" ? (
        <p className="text-body text-muted">ESIS-д ажлын мэдээлэл бүртгэгдээгүй.</p>
      ) : null}
    </dl>
  );
}

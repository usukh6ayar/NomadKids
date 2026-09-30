"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CloudDownload, Pencil, Save } from "lucide-react";
import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { z } from "zod";
import {
  esisResourceReadSchema,
  esisScopedCatalogSchema,
  type ChildDetail,
  type EsisResourceKey,
  type EsisResourceRead,
  type EsisRow,
} from "@kinder/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";

type ChildEsisData = {
  student: EsisRow;
  registration: EsisRow | null;
  contacts: EsisRow[];
  household: EsisRow | null;
  living: EsisRow | null;
  source: "MOCK" | "LIVE";
};

type EsisDraft = {
  student: Record<string, string>;
  registration: Record<string, string>;
  contacts: Record<string, string>[];
  household: Record<string, string>;
  living: Record<string, string>;
};

const ChildEsisContext = createContext<{
  draft: EsisDraft;
  setDraft: Dispatch<SetStateAction<EsisDraft>>;
} | null>(null);

export function useChildEsisDraft(): EsisDraft | null {
  return useContext(ChildEsisContext)?.draft ?? null;
}

type FieldSpec = readonly [key: string, label: string, kind?: "boolean"];

const PERSONAL_FIELDS: FieldSpec[] = [
  ["familyName", "Ургийн овог"],
  ["familyNameMgl", "Ургийн овог (монгол бичиг)"],
  ["lastNameMgl", "Овог (монгол бичиг)"],
  ["firstNameMgl", "Нэр (монгол бичиг)"],
];

const EDUCATION_FIELDS: FieldSpec[] = [
  ["academicLevelName", "Боловсролын түвшин"],
  ["programOfStudyName", "Сургалтын хөтөлбөр"],
  ["programPlanName", "Сургалтын төлөвлөгөө"],
  ["programStageName", "Хөтөлбөрийн шат"],
];

const DIGITAL_FIELDS: FieldSpec[] = [
  ["microsoftEmail", "Microsoft и-мэйл"],
  ["googleEmail", "Google и-мэйл"],
];

const CONTACT_FIELDS: FieldSpec[] = [
  ["phoneNumber2", "Нэмэлт утас"],
  ["email", "И-мэйл"],
  ["address", "Хаяг"],
  ["occupation", "Мэргэжил"],
  ["workplace", "Ажлын газар"],
  ["primaryFlag", "Үндсэн асран хамгаалагч", "boolean"],
  ["liveTogetherFlag", "Хамт амьдардаг", "boolean"],
];

const HOUSEHOLD_FIELDS: FieldSpec[] = [
  ["familyMemberCount", "Өрхийн гишүүдийн тоо"],
  ["childrenCount", "Хүүхдийн тоо"],
  ["familyTypeName", "Өрхийн төрөл"],
  ["incomeTypeName", "Орлогын төрөл"],
  ["livelihoodTypeName", "Амьжиргааны түвшин"],
  ["isHerderFamily", "Малчин өрх", "boolean"],
  ["isSingleParent", "Өрх толгойлсон", "boolean"],
  ["hasDisabledMember", "Хөгжлийн бэрхшээлтэй гишүүнтэй", "boolean"],
  ["socialWelfareFlag", "Нийгмийн халамж авдаг", "boolean"],
];

const LIVING_FIELDS: FieldSpec[] = [
  ["dwellingTypeName", "Орон сууцны төрөл"],
  ["ownershipTypeName", "Эзэмшлийн хэлбэр"],
  ["heatingTypeName", "Халаалтын төрөл"],
  ["waterSourceName", "Усны эх үүсвэр"],
  ["toiletTypeName", "Ариун цэврийн байгууламж"],
  ["electricityFlag", "Цахилгаантай", "boolean"],
  ["internetFlag", "Интернэттэй", "boolean"],
  ["roomCount", "Өрөөний тоо"],
  ["distanceToSchool", "Цэцэрлэг хүртэлх зай"],
];

async function readResource(
  kindergartenId: string,
  resource: EsisResourceKey,
  params: Record<string, string> = {},
): Promise<EsisResourceRead> {
  const search = new URLSearchParams({ resource, ...params });
  return get(`/kindergartens/${kindergartenId}/esis/resource?${search}`, esisResourceReadSchema);
}

function firstSuccessful(read: EsisResourceRead): EsisRow | null {
  return read.status === "SUCCEEDED" ? (read.rows[0] ?? null) : null;
}

function strings(row: EsisRow | null | undefined): Record<string, string> {
  if (!row) return {};
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value === null ? "" : String(value)]),
  );
}

/** ESIS only completes gaps; an empty or differing ministry value never erases local work. */
function fillEmpty(
  current: Record<string, string>,
  incoming: Record<string, string>,
): Record<string, string> {
  const next = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (!next[key]?.trim() && value.trim()) next[key] = value;
  }
  return next;
}

function fillContacts(
  current: Record<string, string>[],
  incoming: EsisRow[],
): Record<string, string>[] {
  const length = Math.max(current.length, incoming.length);
  return Array.from({ length }, (_, index) =>
    fillEmpty(current[index] ?? {}, strings(incoming[index])),
  );
}

function initialDraft(child: ChildDetail): EsisDraft {
  return {
    student: {
      lastName: child.lastName,
      firstName: child.firstName,
      dateOfBirth: child.dateOfBirth?.slice(0, 10) ?? "",
      genderName: child.sex === "MALE" ? "Эрэгтэй" : child.sex === "FEMALE" ? "Эмэгтэй" : "",
    },
    registration: {},
    contacts: child.guardianships.map(({ guardian }) => ({
      lastName: guardian?.lastName ?? "",
      firstName: guardian?.firstName ?? "",
      phoneNumber: guardian?.phone ?? "",
      email: guardian?.email ?? "",
    })),
    household: {},
    living: {},
  };
}

function DraftFields({
  specs,
  values,
  onChange,
}: {
  specs: FieldSpec[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {specs.map(([key, label, kind]) => (
        <Field key={key} label={label}>
          {({ id, describedBy }) =>
            kind === "boolean" ? (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={values[key] ?? ""}
                onChange={(event) => onChange(key, event.target.value)}
              >
                <option value="">Сонгоогүй</option>
                <option value="true">Тийм</option>
                <option value="false">Үгүй</option>
              </Select>
            ) : (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={values[key] ?? ""}
                onChange={(event) => onChange(key, event.target.value)}
              />
            )
          }
        </Field>
      ))}
    </div>
  );
}

function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-border-soft pt-4 first:border-t-0 first:pt-0">
      <h4 className="mb-3 text-body font-semibold text-ink">{title}</h4>
      {children}
    </div>
  );
}

function ReadonlyFields({ specs, values }: { specs: FieldSpec[]; values: Record<string, string> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {specs.map(([key, label, kind]) => {
        const value = values[key];
        const shown =
          kind === "boolean"
            ? value === "true"
              ? "Тийм"
              : value === "false"
                ? "Үгүй"
                : "—"
            : value || "—";
        return (
          <div key={key} className="rounded-row border border-border-soft bg-canvas px-4 py-3">
            <dt className="text-caption text-muted">{label}</dt>
            <dd className="mt-1 break-words font-medium text-ink">{shown}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function EditModeButton({ editing, onClick }: { editing: boolean; onClick: () => void }) {
  return (
    <Button size="sm" variant="secondary" onClick={onClick}>
      {editing ? <Check size={16} aria-hidden /> : <Pencil size={16} aria-hidden />}
      {editing ? "Дуусгах" : "Засах"}
    </Button>
  );
}

/** ESIS fields embedded in the product's existing four child-information sections. */
export function ChildEsisFields({ section }: { section: "personal" | "education" | "guardian" }) {
  const context = useContext(ChildEsisContext);
  const [editing, setEditing] = useState(false);
  if (!context) return null;
  const { draft, setDraft } = context;
  const updateSection = (target: keyof Omit<EsisDraft, "contacts">, key: string, value: string) =>
    setDraft((current) => ({ ...current, [target]: { ...current[target], [key]: value } }));

  if (section === "personal") {
    return (
      <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
        <div className="flex justify-end">
          <EditModeButton editing={editing} onClick={() => setEditing((value) => !value)} />
        </div>
        <FieldGroup title="Нэмэлт хувийн мэдээлэл">
          {editing ? (
            <DraftFields
              specs={PERSONAL_FIELDS}
              values={draft.student}
              onChange={(key, value) => updateSection("student", key, value)}
            />
          ) : (
            <ReadonlyFields specs={PERSONAL_FIELDS} values={draft.student} />
          )}
        </FieldGroup>
        <FieldGroup title="Цахим бүртгэл">
          {editing ? (
            <DraftFields
              specs={DIGITAL_FIELDS}
              values={draft.student}
              onChange={(key, value) => updateSection("student", key, value)}
            />
          ) : (
            <ReadonlyFields specs={DIGITAL_FIELDS} values={draft.student} />
          )}
        </FieldGroup>
      </div>
    );
  }

  if (section === "education") {
    return (
      <div className="mt-4 border-t border-border pt-4">
        <div className="mb-4 flex justify-end">
          <EditModeButton editing={editing} onClick={() => setEditing((value) => !value)} />
        </div>
        <FieldGroup title="Сургалтын нэмэлт мэдээлэл">
          {editing ? (
            <DraftFields
              specs={EDUCATION_FIELDS}
              values={draft.student}
              onChange={(key, value) => updateSection("student", key, value)}
            />
          ) : (
            <ReadonlyFields specs={EDUCATION_FIELDS} values={draft.student} />
          )}
        </FieldGroup>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <EditModeButton editing={editing} onClick={() => setEditing((value) => !value)} />
      </div>
      <FieldGroup title="Асран хамгаалагчийн нэмэлт мэдээлэл">
        <div className="flex flex-col gap-4">
          {draft.contacts.length ? (
            draft.contacts.map((contact, index) => (
              <div key={contact.contactId || String(index)} className="rounded-row bg-canvas p-4">
                <p className="mb-3 font-medium text-ink">Асран хамгаалагч {index + 1}</p>
                {editing ? (
                  <DraftFields
                    specs={CONTACT_FIELDS}
                    values={contact}
                    onChange={(key, value) =>
                      setDraft((current) => ({
                        ...current,
                        contacts: current.contacts.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, [key]: value } : item,
                        ),
                      }))
                    }
                  />
                ) : (
                  <ReadonlyFields specs={CONTACT_FIELDS} values={contact} />
                )}
              </div>
            ))
          ) : (
            <p className="text-body text-muted">
              ESIS-ээс татахад асран хамгаалагчийн нэмэлт мэдээлэл бөглөгдөнө.
            </p>
          )}
        </div>
      </FieldGroup>
      <FieldGroup title="Өрхийн мэдээлэл">
        {editing ? (
          <DraftFields
            specs={HOUSEHOLD_FIELDS}
            values={draft.household}
            onChange={(key, value) => updateSection("household", key, value)}
          />
        ) : (
          <ReadonlyFields specs={HOUSEHOLD_FIELDS} values={draft.household} />
        )}
      </FieldGroup>
      <FieldGroup title="Амьдрах орчны мэдээлэл">
        {editing ? (
          <DraftFields
            specs={LIVING_FIELDS}
            values={draft.living}
            onChange={(key, value) => updateSection("living", key, value)}
          />
        ) : (
          <ReadonlyFields specs={LIVING_FIELDS} values={draft.living} />
        )}
      </FieldGroup>
    </div>
  );
}

/** Uses the already-open child's registered ID; no register prompt or second picker. */
export function ChildEsisProfile({
  child,
  children,
  header,
}: {
  child: ChildDetail;
  children?: ReactNode;
  header?: (action: ReactNode) => ReactNode;
}) {
  const { primaryKindergartenId } = useSession();
  const kindergartenId = primaryKindergartenId ?? "";
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<EsisDraft>(() => initialDraft(child));
  const [meta, setMeta] = useState<{ personId: string; source: "MOCK" | "LIVE" } | null>(null);
  const catalog = useQuery({
    queryKey: qk.esisCatalog(kindergartenId || "none"),
    queryFn: () => get(`/kindergartens/${kindergartenId}/esis/catalog`, esisScopedCatalogSchema),
    enabled: Boolean(kindergartenId),
    retry: false,
  });

  const pull = useMutation({
    mutationFn: async (): Promise<ChildEsisData> => {
      if (!kindergartenId) throw new Error("Цэцэрлэгийн ESIS холболт тохируулагдаагүй байна.");
      if (!child.nationalId)
        throw new Error("Энэ хүүхдийн бүртгэлд регистрийн дугаар байхгүй байна.");
      const studentRead = await readResource(kindergartenId, "studentInfo", {
        personRegNumber: child.nationalId,
      });
      const student = firstSuccessful(studentRead);
      const personId = student?.personId;
      if (!student || !personId) throw new Error("ESIS-ээс энэ хүүхдийн мэдээлэл олдсонгүй.");
      const [registration, contacts, household, living] = await Promise.all([
        readResource(kindergartenId, "studentCheck", { personId }),
        readResource(kindergartenId, "studentContacts"),
        readResource(kindergartenId, "studentStatistics", { personId }),
        readResource(kindergartenId, "studentCondition", { personId }),
      ]);
      return {
        student,
        registration: firstSuccessful(registration),
        contacts:
          contacts.status === "SUCCEEDED"
            ? contacts.rows.filter((row) => row.personId === personId)
            : [],
        household: firstSuccessful(household),
        living: firstSuccessful(living),
        source: studentRead.source,
      };
    },
    onSuccess: (data) => {
      setMeta({ personId: data.student.personId!, source: data.source });
      setDraft((current) => ({
        student: fillEmpty(current.student, strings(data.student)),
        registration: fillEmpty(current.registration, strings(data.registration)),
        contacts: data.contacts.length
          ? fillContacts(current.contacts, data.contacts)
          : current.contacts,
        household: fillEmpty(current.household, strings(data.household)),
        living: fillEmpty(current.living, strings(data.living)),
      }));
      toast.success("ESIS мэдээлэл талбаруудад бөглөгдлөө. Шалгаад хадгална уу.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : errorMessage(error)),
  });

  const save = useMutation({
    mutationFn: () =>
      mutate(`/children/${child.id}/esis/import`, z.unknown(), {
        method: "POST",
        body: { personId: meta?.personId, source: meta?.source, ...draft },
      }),
    onSuccess: () => {
      toast.success("ESIS-ээс татсан хүүхдийн мэдээлэл хадгалагдлаа.");
      void queryClient.invalidateQueries({ queryKey: qk.child(child.id) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const allowed = catalog.data?.endpoints.some((endpoint) => endpoint.key === "studentInfo");
  if (!primaryKindergartenId || catalog.isError || (catalog.data && !allowed))
    return (
      <>
        {header?.(null)}
        <ChildEsisContext.Provider value={{ draft, setDraft }}>
          <div className="flex flex-col gap-4">{children}</div>
        </ChildEsisContext.Provider>
      </>
    );

  const action = (
    <Button
      size="sm"
      variant="secondary"
      disabled={catalog.isPending || pull.isPending}
      onClick={() => pull.mutate()}
    >
      <CloudDownload size={17} aria-hidden />
      {pull.isPending ? "Татаж байна…" : meta ? "ESIS-ээс дахин татах" : "ESIS-ээс татах"}
    </Button>
  );
  return (
    <>
      {header?.(action)}
      <ChildEsisContext.Provider value={{ draft, setDraft }}>
        <div className="flex flex-col gap-4">
          {children}
          {pull.isError ? (
            <p
              role="alert"
              className="rounded-control bg-danger-soft px-3 py-2 text-body text-danger"
            >
              {pull.error instanceof Error ? pull.error.message : errorMessage(pull.error)}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-body text-muted">
              {!header ? action : null}
              <span>ESIS нь зөвхөн хоосон талбаруудыг нөхнө.</span>
              {meta ? (
                <Badge tone={meta.source === "LIVE" ? "mint" : "sun"}>
                  {meta.source === "LIVE" ? "ESIS LIVE" : "ESIS DEMO"}
                </Badge>
              ) : null}
            </div>
            <Button disabled={!meta || save.isPending} onClick={() => save.mutate()}>
              <Save size={17} aria-hidden />
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </div>
        </div>
      </ChildEsisContext.Provider>
    </>
  );
}

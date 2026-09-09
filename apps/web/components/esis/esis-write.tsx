"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudUpload, Plus, Trash2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import {
  esisScopedCatalogSchema,
  esisWriteResultSchema,
  type EsisField as EsisCatalogField,
  type EsisResourceKey,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { useToast } from "@/components/ui/toast";

/**
 * Sending a record **to** ESIS — the other half of the panels that read one.
 *
 * ★ Why this exists at all. Until 2026-09-10 this product carried exactly one
 * write service, `saveAttendanceV3`, and `esis.endpoints.ts` refused the food
 * income saves with a rule worth repeating: a service is not given a scope
 * request until something here can honestly file it. The client then asked for
 * three суралцагч writes with their reads, and this file is the condition that
 * refusal named — the screens that actually send them.
 *
 * ★★ **The form is built from the catalog, not hand-listed.** Every write
 * service already declares its inputs in `ESIS_FIELDS` with a Mongolian label,
 * and `/esis/catalog` serves them. Re-typing that list here would be a second
 * catalog to keep in step with the first, and the first is the one the
 * operator screen shows a reviewer.
 *
 * ★★★ `institutionId` is never a form field. The server fills it from the
 * tenant's confirmed mapping — see `esisWriteSchema`'s note in `esis.dto.ts`.
 * A kindergarten's own staff cannot be asked which institution they are
 * writing to, because the answer is not theirs to give.
 */

/** Inputs the operator fills. `institutionId` is the server's to supply. */
function operatorInputs(fields: EsisCatalogField[]): EsisCatalogField[] {
  return fields.filter(
    (field) => field.io === "INPUT" && field.name !== "institutionId" && !field.name.includes("["),
  );
}

/**
 * How one input is typed, read from its name.
 *
 * ★ A convention rather than a table, for the same reason the fields are not
 * hand-listed: a fourth write service should not need an edit here. ESIS names
 * its booleans `…Flag`, `is…` and `has…`, and its identifiers and tallies
 * `…Id` and `…Count`, consistently enough across the catalog that the rule
 * reads the whole of it correctly today.
 */
type InputKind = "boolean" | "number" | "text";

function inputKind(name: string): InputKind {
  if (name.endsWith("Flag") || name.startsWith("is") || name.startsWith("has")) return "boolean";
  if (name.endsWith("Id") || name.endsWith("Count")) return "number";
  return "text";
}

type Values = Record<string, string | boolean>;

function initialValues(fields: EsisCatalogField[], seed: Values): Values {
  const values: Values = {};
  for (const field of fields) {
    values[field.name] = seed[field.name] ?? (inputKind(field.name) === "boolean" ? false : "");
  }
  return values;
}

/**
 * Turns the form's strings into the payload the upload schema expects.
 *
 * ★ An empty optional is dropped rather than sent as `0` or `""`. The upload
 * schemas are `.strict()` with `.optional()` members: a key that is absent is
 * "not answered", and a key sent as an empty string is a validation failure at
 * best and a wrong answer written into the ministry's record at worst.
 */
function toPayload(fields: EsisCatalogField[], values: Values): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.name];
    const kind = inputKind(field.name);
    if (kind === "boolean") {
      payload[field.name] = Boolean(value);
      continue;
    }
    const text = String(value ?? "").trim();
    if (text === "") continue;
    payload[field.name] = kind === "number" ? Number(text) : text;
  }
  return payload;
}

function useEsisWrite(onDone: () => void) {
  const { primaryKindergartenId } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { resource: EsisResourceKey; payload: Record<string, unknown> }) =>
      mutate(`/kindergartens/${primaryKindergartenId}/esis/write`, esisWriteResultSchema, {
        method: "POST",
        body: input,
      }),
    onSuccess: (result) => {
      /*
       * ★ A FAILED result is not an exception — the route answers 200 with the
       * upstream's own code, exactly as the read route does, so the operator
       * sees "ESIS хариу өгсөнгүй" rather than a generic request error. The
       * toast has to tell those apart or a refused write reads as a saved one.
       */
      if (result.status === "FAILED") {
        toast.error("ЭСИС хүлээж авсангүй. Дахин оролдоно уу.");
        return;
      }
      toast.success(
        result.source === "MOCK"
          ? "Илгээлээ. Энэ deployment дээр ЭСИС холболт идэвхгүй тул demo хариу ирлээ."
          : "ЭСИС рүү амжилттай илгээлээ.",
      );
      /*
       * ★ Every ESIS read of this kindergarten, by prefix. The panels set
       * `staleTime: Infinity` so nothing refetches on its own — deliberately,
       * because each read is an outbound call to the ministry. A write is the
       * one event that genuinely invalidates them: what ESIS holds has just
       * changed, so the panel beside the button must not keep showing what it
       * held a moment ago.
       */
      void queryClient.invalidateQueries({ queryKey: ["esis"] });
      onDone();
    },
    onError: () => {
      toast.error("Илгээж чадсангүй.");
    },
  });
}

/**
 * A flat write form — өрхийн мэдээлэл and амьдрах орчин.
 *
 * Both services carry one record about one child and a dozen scalar fields, so
 * one component draws both. The contacts service is a list and gets its own
 * below.
 */
export function EsisFactsWriteButton({
  resource,
  personId,
  title,
  description,
}: {
  resource: EsisResourceKey;
  /** The child's ESIS person id, when the screen knows it. */
  personId?: string;
  title: string;
  description: string;
}) {
  const { primaryKindergartenId } = useSession();
  const [open, setOpen] = useState(false);
  const formId = useId();

  const catalog = useQuery({
    queryKey: qk.esisCatalog(primaryKindergartenId ?? "none"),
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/esis/catalog`, esisScopedCatalogSchema),
    enabled: Boolean(primaryKindergartenId),
    retry: false,
  });

  const endpoint = catalog.data?.endpoints.find((item) => item.key === resource);
  const fields = useMemo(() => operatorInputs(endpoint?.fields ?? []), [endpoint]);
  const [values, setValues] = useState<Values>({});

  const write = useEsisWrite(() => setOpen(false));

  // A service outside this role's list is simply not in the catalog, and the
  // button draws nothing rather than a control that would answer 404.
  if (!endpoint) return null;

  function start() {
    setValues(initialValues(fields, personId ? { personId } : {}));
    setOpen(true);
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={start}>
        <CloudUpload aria-hidden />
        ЭСИС рүү илгээх
      </Button>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        busy={write.isPending}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={write.isPending}>
              Цуцлах
            </Button>
            <Button type="submit" form={formId} disabled={write.isPending}>
              {write.isPending ? "Илгээж байна…" : "Илгээх"}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (write.isPending) return;
            write.mutate({ resource, payload: toPayload(fields, values) });
          }}
        >
          {write.isError ? (
            <p
              role="alert"
              className="rounded-control bg-danger-soft px-4 py-3 text-body text-danger"
            >
              {errorMessage(write.error)}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((field) => {
              const kind = inputKind(field.name);
              if (kind === "boolean") {
                return (
                  <Checkbox
                    key={field.name}
                    label={field.label}
                    checked={Boolean(values[field.name])}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.name]: event.target.checked }))
                    }
                  />
                );
              }
              return (
                <Field key={field.name} label={field.label} required={field.name === "personId"}>
                  {({ id }) => (
                    <Input
                      id={id}
                      inputMode={kind === "number" ? "numeric" : undefined}
                      value={String(values[field.name] ?? "")}
                      onChange={(event) =>
                        setValues((current) => ({ ...current, [field.name]: event.target.value }))
                      }
                    />
                  )}
                </Field>
              );
            })}
          </div>

          <p className="text-caption text-muted">
            Байгууллагын кодыг сервер өөрөө нэмнэ. Бөглөөгүй талбарыг илгээхгүй.
          </p>
        </form>
      </FormDialog>
    </>
  );
}

/** One guardian row in the contacts form. */
interface ContactRow {
  relationTypeId: string;
  lastName: string;
  firstName: string;
  phoneNumber: string;
  email: string;
  primaryFlag: boolean;
}

const EMPTY_CONTACT: ContactRow = {
  relationTypeId: "",
  lastName: "",
  firstName: "",
  phoneNumber: "",
  email: "",
  primaryFlag: false,
};

/**
 * The guardians of one child, sent to ESIS.
 *
 * ★ **Prefilled from the guardians this product already holds.** The whole
 * point of the write is that a kindergarten's own record is ahead of the
 * ministry's; a blank form would ask a teacher to re-type what is on the
 * screen behind the dialog. `prefill` is the guardianship list the child's
 * record already drew.
 *
 * ★★ `contactList` is why this is not the generic form above: the payload is a
 * list, and a catalog-driven flat form cannot express one. The nested field
 * names (`contactList[].relationTypeId`) are filtered out of `operatorInputs`
 * for the same reason.
 */
export function EsisContactsWriteButton({
  personId,
  prefill,
}: {
  personId?: string;
  prefill?: { lastName: string; firstName: string; phone: string | null; email: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState(personId ?? "");
  const [rows, setRows] = useState<ContactRow[]>([EMPTY_CONTACT]);
  const formId = useId();
  const write = useEsisWrite(() => setOpen(false));

  function start() {
    setPerson(personId ?? "");
    setRows(
      prefill && prefill.length > 0
        ? prefill.map((guardian, index) => ({
            relationTypeId: "",
            lastName: guardian.lastName,
            firstName: guardian.firstName,
            phoneNumber: guardian.phone ?? "",
            email: guardian.email ?? "",
            primaryFlag: index === 0,
          }))
        : [EMPTY_CONTACT],
    );
    setOpen(true);
  }

  const valid =
    person.trim() !== "" &&
    rows.every((row) => row.relationTypeId && row.lastName && row.firstName && row.phoneNumber);

  return (
    <>
      <Button size="sm" variant="secondary" onClick={start}>
        <CloudUpload aria-hidden />
        ЭСИС рүү илгээх
      </Button>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Асран хамгаалагчийг ЭСИС рүү илгээх"
        description="Цэцэрлэгт бүртгэлтэй асран хамгаалагчийн мэдээллийг ЭСИС рүү илгээнэ."
        busy={write.isPending}
        size="wide"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={write.isPending}>
              Цуцлах
            </Button>
            <Button type="submit" form={formId} disabled={write.isPending || !valid}>
              {write.isPending ? "Илгээж байна…" : "Илгээх"}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (write.isPending || !valid) return;
            write.mutate({
              resource: "studentContactsSave",
              payload: {
                personId: Number(person),
                contactList: rows.map((row) => ({
                  relationTypeId: Number(row.relationTypeId),
                  lastName: row.lastName.trim(),
                  firstName: row.firstName.trim(),
                  phoneNumber: row.phoneNumber.trim(),
                  ...(row.email.trim() ? { email: row.email.trim() } : {}),
                  primaryFlag: row.primaryFlag,
                })),
              },
            });
          }}
        >
          {write.isError ? (
            <p
              role="alert"
              className="rounded-control bg-danger-soft px-4 py-3 text-body text-danger"
            >
              {errorMessage(write.error)}
            </p>
          ) : null}

          <Field label="Хүүхдийн ЭСИС дугаар" required>
            {({ id }) => (
              <Input
                id={id}
                inputMode="numeric"
                value={person}
                onChange={(event) => setPerson(event.target.value)}
              />
            )}
          </Field>

          <div className="flex flex-col gap-3">
            {rows.map((row, index) => (
              <Card key={index} pad="compact" className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-caption font-semibold uppercase text-muted">
                    Асран хамгаалагч {index + 1}
                  </p>
                  {rows.length > 1 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                    >
                      <Trash2 size={16} aria-hidden />
                      Хасах
                    </Button>
                  ) : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Хамаарлын код" required hint="ЭСИС-ийн хамаарлын лавлах дугаар">
                    {({ id }) => (
                      <Input
                        id={id}
                        inputMode="numeric"
                        value={row.relationTypeId}
                        onChange={(event) =>
                          setRows((current) =>
                            current.map((item, i) =>
                              i === index ? { ...item, relationTypeId: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    )}
                  </Field>
                  <Field label="Овог" required>
                    {({ id }) => (
                      <Input
                        id={id}
                        value={row.lastName}
                        onChange={(event) =>
                          setRows((current) =>
                            current.map((item, i) =>
                              i === index ? { ...item, lastName: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    )}
                  </Field>
                  <Field label="Нэр" required>
                    {({ id }) => (
                      <Input
                        id={id}
                        value={row.firstName}
                        onChange={(event) =>
                          setRows((current) =>
                            current.map((item, i) =>
                              i === index ? { ...item, firstName: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    )}
                  </Field>
                  <Field label="Утас" required>
                    {({ id }) => (
                      <Input
                        id={id}
                        inputMode="tel"
                        value={row.phoneNumber}
                        onChange={(event) =>
                          setRows((current) =>
                            current.map((item, i) =>
                              i === index ? { ...item, phoneNumber: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    )}
                  </Field>
                  <Field label="И-мэйл">
                    {({ id }) => (
                      <Input
                        id={id}
                        type="email"
                        value={row.email}
                        onChange={(event) =>
                          setRows((current) =>
                            current.map((item, i) =>
                              i === index ? { ...item, email: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    )}
                  </Field>
                </div>

                <Checkbox
                  label="Үндсэн асран хамгаалагч"
                  checked={row.primaryFlag}
                  onChange={(event) =>
                    setRows((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, primaryFlag: event.target.checked } : item,
                      ),
                    )
                  }
                />
              </Card>
            ))}
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRows((current) => [...current, EMPTY_CONTACT])}
          >
            <Plus size={16} aria-hidden />
            Асран хамгаалагч нэмэх
          </Button>

          <p className="text-caption text-muted">
            Регистрийн дугаар илгээхгүй. Байгууллагын кодыг сервер өөрөө нэмнэ.
          </p>
        </form>
      </FormDialog>
    </>
  );
}

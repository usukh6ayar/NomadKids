"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { z } from "zod";
import {
  assessmentLevelSchema,
  developmentDomainSchema,
  observationTypeConfigSchema,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";

const domainsSchema = z.array(developmentDomainSchema);
const levelsSchema = z.array(assessmentLevelSchema);
const typesSchema = z.array(observationTypeConfigSchema);

/**
 * The latin slug an administrator types when creating a row — `physical`,
 * `daily`.
 *
 * ★ It stays on screen, and it moves to its own column.
 *
 * It reads as a leak, and the first instinct is to delete it: an English word
 * in the middle of a Mongolian row on the one screen a director configures.
 * But `code` is a required field on the create form — the administrator
 * supplies it — and it is what the API and every report key on, so hiding it
 * would leave them editing a value they cannot see. Set in a fixed column at
 * the end of the row instead, it reads as a reference rather than as an
 * interruption, and the names line up down the list.
 */
function CodeCell({ code }: { code?: string | null }) {
  if (!code) return null;

  return (
    <code className="hidden w-[104px] shrink-0 truncate text-caption text-faint sm:block">
      {code}
    </code>
  );
}

/**
 * Assessment configuration — RFP §6.1, §6.2 and §2.1's "Хөгжлийн шалгуур,
 * үнэлгээний мэдээллийг удирдах".
 *
 * ★ The API for this shipped complete and tested, and nothing linked to it.
 *
 * CLAUDE.md §2.3 requires these three to be tables rather than TypeScript
 * enums *precisely* so an administrator can edit them — and until this screen
 * existed, they could not. That is the whole gap this closes.
 *
 * ★★ A system row is shown and not editable, rather than hidden.
 *
 * `kindergartenId = null` rows are the shared defaults every kindergarten
 * inherits. Hiding them would make the list look wrong — a director seeing two
 * domains where the assessment grid shows seven — so they are listed, marked,
 * and carry no edit control. The API refuses the write either way; not offering
 * the button is what stops someone learning that by being refused.
 */
export default function AssessmentConfigPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <AssessmentConfig />
    </RequireRole>
  );
}

function AssessmentConfig() {
  const { primaryKindergartenId } = useSession();
  const kindergartenId = primaryKindergartenId ?? "";

  const domains = useQuery({
    queryKey: qk.configDomains(kindergartenId),
    queryFn: () => get(`/kindergartens/${kindergartenId}/development-domains`, domainsSchema),
    enabled: Boolean(kindergartenId),
  });

  const levels = useQuery({
    queryKey: qk.configLevels(kindergartenId),
    queryFn: () => get(`/kindergartens/${kindergartenId}/assessment-levels`, levelsSchema),
    enabled: Boolean(kindergartenId),
  });

  const types = useQuery({
    queryKey: qk.configTypes(kindergartenId),
    queryFn: () => get(`/kindergartens/${kindergartenId}/observation-types`, typesSchema),
    enabled: Boolean(kindergartenId),
  });

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader title="Үнэлгээний тохиргоо" />

      <ConfigSection
        title="Хөгжлийн чиглэл"
        lede="Үнэлгээ, радар графикт ашиглагдана."
        query={domains}
        queryKey={qk.configDomains(kindergartenId)}
        collectionPath={`/kindergartens/${kindergartenId}/development-domains`}
        itemPath="/development-domains"
        emptyDescription="Чиглэл нэмээгүй байна."
        renderRow={(row) => (
          <>
            <ColorDot color={row.color} />
            <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
              {row.name}
            </span>
            <CodeCell code={row.code} />
          </>
        )}
        createFields={[
          { name: "name", label: "Нэр", required: true },
          { name: "code", label: "Код", required: true, hint: "Латин жижиг үсэг: physical" },
          { name: "color", label: "Өнгө", type: "color", defaultValue: "#94a3b8" },
        ]}
        editFields={[
          { name: "name", label: "Нэр", required: true },
          { name: "color", label: "Өнгө", type: "color" },
          { name: "description", label: "Тайлбар", multiline: true },
        ]}
      />

      <ConfigSection
        title="Үнэлгээний түвшин"
        lede="1-ээс 4 хүртэл. Нэр, өнгө, тайлбарыг өөрчилж болно."
        query={levels}
        queryKey={qk.configLevels(kindergartenId)}
        collectionPath={`/kindergartens/${kindergartenId}/assessment-levels`}
        itemPath="/assessment-levels"
        emptyDescription="Түвшин нэмээгүй байна."
        renderRow={(row) => (
          <>
            <ColorDot color={row.color} />
            <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
              {row.value}. {row.label}
            </span>
          </>
        )}
        createFields={[
          { name: "value", label: "Түвшин (1–4)", type: "number", required: true },
          { name: "label", label: "Нэр", required: true },
          { name: "color", label: "Өнгө", type: "color", defaultValue: "#94a3b8" },
        ]}
        editFields={[
          { name: "label", label: "Нэр", required: true },
          { name: "color", label: "Өнгө", type: "color" },
          { name: "description", label: "Тайлбар", multiline: true },
        ]}
      />

      <ConfigSection
        title="Ажиглалтын төрөл"
        lede="Багш ажиглалт бүртгэхдээ сонгоно."
        query={types}
        queryKey={qk.configTypes(kindergartenId)}
        collectionPath={`/kindergartens/${kindergartenId}/observation-types`}
        itemPath="/observation-types"
        emptyDescription="Төрөл нэмээгүй байна."
        renderRow={(row) => (
          <>
            <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
              {row.name}
            </span>
            <CodeCell code={row.code} />
          </>
        )}
        createFields={[
          { name: "name", label: "Нэр", required: true },
          { name: "code", label: "Код", required: true, hint: "Латин жижиг үсэг: daily" },
        ]}
        editFields={[{ name: "name", label: "Нэр", required: true }]}
      />
    </div>
  );
}

function ColorDot({ color }: { color?: string | null }) {
  if (!color) return null;
  return (
    <span
      aria-hidden="true"
      className="size-3 shrink-0 rounded-pill border border-border"
      style={{ background: color }}
    />
  );
}

interface FieldSpec {
  name: string;
  label: string;
  type?: "text" | "number" | "color";
  required?: boolean;
  hint?: string;
  multiline?: boolean;
  defaultValue?: string;
}

/** Anything the three lists have in common — enough to render and key a row. */
interface ConfigRow {
  id: string;
  name?: string;
  label?: string;
  code?: string;
  value?: number;
  color?: string | null;
  description?: string | null;
  isActive?: boolean | null;
  isSystem: boolean;
}

/**
 * One list, its add form and its per-row edit.
 *
 * ★ Written once for three lists rather than three times.
 *
 * They differ only in their fields and their paths; the behaviour that matters
 * — a system row cannot be edited, deleting deactivates, the create form
 * collapses when idle — is identical, and three copies would be three places to
 * get the `isSystem` check subtly different.
 */
function ConfigSection<T extends ConfigRow>({
  title,
  lede,
  query,
  queryKey,
  collectionPath,
  itemPath,
  emptyDescription,
  renderRow,
  createFields,
  editFields,
}: {
  title: string;
  lede: string;
  query: { data?: T[]; isPending: boolean; isError: boolean; error: unknown };
  queryKey: readonly unknown[];
  collectionPath: string;
  itemPath: string;
  emptyDescription: string;
  renderRow: (row: T) => ReactNode;
  createFields: FieldSpec[];
  editFields: FieldSpec[];
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <SectionHeader
        title={title}
        lede={lede}
        action={
          !adding ? (
            /*
              ★ `secondary`, because there are three of these on one screen.

              Filled blue is the product's call to action, and a page carrying
              three of them stacked down its right edge has no call to action —
              it has three equal claims on the eye, none of which is what an
              administrator opened this screen to do. Each one is still the
              primary action *of its own section*, which is what a bordered
              button beside a section heading already says.
            */
            <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
              Нэмэх
            </Button>
          ) : null
        }
      />

      {adding ? (
        <ConfigForm
          fields={createFields}
          path={collectionPath}
          method="POST"
          queryKey={queryKey}
          onDone={() => setAdding(false)}
        />
      ) : null}

      {query.isPending ? <LoadingState rows={3} /> : null}
      {query.isError ? <ErrorState description={errorMessage(query.error)} /> : null}

      {query.data && query.data.length === 0 && !adding ? (
        <EmptyState title="Хоосон" description={emptyDescription} />
      ) : null}

      <ul className="flex flex-col gap-2">
        {(query.data ?? []).map((row) => (
          <li key={row.id}>
            <Card pad="compact" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {renderRow(row)}

                {/*
                  A system row is marked and carries no controls. The API
                  refuses the write regardless; not offering the button is what
                  stops an administrator learning that by being refused.
                */}
                {row.isSystem ? (
                  <Badge tone="neutral">Системийн</Badge>
                ) : row.isActive === false ? (
                  <Badge tone="neutral">Идэвхгүй</Badge>
                ) : null}

                {!row.isSystem && editingId !== row.id ? (
                  <span className="ml-auto flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(row.id)}>
                      Засах
                    </Button>
                    <DeactivateButton id={row.id} itemPath={itemPath} queryKey={queryKey} />
                  </span>
                ) : null}
              </div>

              {editingId === row.id ? (
                <ConfigForm
                  fields={editFields}
                  path={`${itemPath}/${row.id}`}
                  method="PATCH"
                  queryKey={queryKey}
                  initial={row as unknown as Record<string, unknown>}
                  onDone={() => setEditingId(null)}
                />
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** `DELETE` deactivates rather than removing — the API's own behaviour. */
function DeactivateButton({
  id,
  itemPath,
  queryKey,
}: {
  id: string;
  itemPath: string;
  queryKey: readonly unknown[];
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const deactivate = useMutation({
    mutationFn: () => mutate(`${itemPath}/${id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Идэвхгүй болголоо.");
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Идэвхгүй болгох
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-caption text-muted">Идэвхгүй болгох уу?</span>
      <Button
        variant="danger"
        size="sm"
        disabled={deactivate.isPending}
        onClick={() => deactivate.mutate()}
      >
        Тийм
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
        Үгүй
      </Button>
    </span>
  );
}

function ConfigForm({
  fields,
  path,
  method,
  queryKey,
  initial,
  onDone,
}: {
  fields: FieldSpec[];
  path: string;
  method: "POST" | "PATCH";
  queryKey: readonly unknown[];
  initial?: Record<string, unknown>;
  onDone: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => [f.name, String(initial?.[f.name] ?? f.defaultValue ?? "")]),
    ),
  );

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      for (const field of fields) {
        const raw = values[field.name]?.trim() ?? "";
        // An untouched optional field is omitted rather than sent as "": a
        // PATCH that sends every key would blank the ones nobody edited.
        if (raw === "" && !field.required) continue;
        body[field.name] = field.type === "number" ? Number(raw) : raw;
      }
      return mutate(path, z.unknown(), { method, body });
    },
    onSuccess: () => {
      toast.success("Тохиргоо хадгалагдлаа.");
      void queryClient.invalidateQueries({ queryKey });
      onDone();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const errors = fieldErrors(save.error);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!save.isPending) save.mutate();
      }}
      className="flex flex-col gap-3 rounded-control border border-border bg-canvas p-3.5"
      noValidate
    >
      <FormError
        message={save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <Field
            key={field.name}
            label={field.label}
            hint={field.hint}
            error={errors[field.name]}
            required={field.required}
          >
            {({ id, describedBy, invalid }) =>
              field.multiline ? (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  rows={2}
                  value={values[field.name] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                />
              ) : (
                <Input
                  id={id}
                  type={field.type ?? "text"}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={values[field.name] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                />
              )
            }
          </Field>
        ))}
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
        </Button>
        <Button variant="secondary" size="sm" onClick={onDone}>
          Цуцлах
        </Button>
      </div>
    </form>
  );
}

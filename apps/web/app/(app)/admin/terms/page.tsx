"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { z } from "zod";
import { schoolYearSchema, termSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { formatDate } from "@/lib/format";

const TERM_COLUMNS = [
  { key: "startsOn", label: "Эхлэх", className: "md:w-[112px]" },
  { key: "endsOn", label: "Дуусах", className: "md:w-[112px]" },
  { key: "year", label: "Хичээлийн жил", className: "md:w-[128px]" },
];

/**
 * Whether today falls inside the term.
 *
 * Dates only — a term that ends on the 31st includes the whole of the 31st, so
 * the comparison is against the day rather than the instant.
 */
function isRunning(
  startsOn: string | null | undefined,
  endsOn: string | null | undefined,
): boolean {
  if (!startsOn || !endsOn) return false;
  const today = new Date().toISOString().slice(0, 10);
  return startsOn.slice(0, 10) <= today && today <= endsOn.slice(0, 10);
}

/**
 * Terms.
 *
 * ★ Nothing in the assessment half of this product works without one.
 *
 * An assessment is stored against a child, a domain and a **term**; a term
 * report is a term's worth of them. `POST /kindergartens/:id/terms` has existed
 * since Phase 8 with no screen, so a kindergarten that finished setting itself
 * up still found "Идэвхтэй улирал тохируулаагүй" on the admin dashboard and no
 * way to answer it. The assessment grid could read terms and never create one.
 *
 * Numbered 1–3 by the API, which is the Mongolian preschool year. The number is
 * fixed at creation and is not editable afterwards: assessments already point
 * at the term, and renumbering would silently move a term's worth of records
 * into a different part of the year.
 */
const listSchema = z.array(termSchema);
const yearsSchema = z.array(schoolYearSchema);

export default function AdminTermsPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <AdminTerms />
    </RequireRole>
  );
}

function AdminTerms() {
  const { primaryKindergartenId } = useSession();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<z.infer<typeof termSchema> | null>(null);

  const years = useQuery({
    queryKey: qk.adminSchoolYears(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/school-years`, yearsSchema),
    enabled: Boolean(primaryKindergartenId),
  });

  const terms = useQuery({
    queryKey: qk.adminTerms(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/terms`, listSchema),
    enabled: Boolean(primaryKindergartenId),
  });

  const yearItems = years.data ?? [];
  const items = terms.data ?? [];
  const currentYear = yearItems.find((year) => year.isCurrent) ?? yearItems[0];

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Улирал"
        lede="Үнэлгээ ба улирлын тайлан улиралд харьяалагдана."
        actions={
          currentYear ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden /> Улирал нэмэх
            </Button>
          ) : null
        }
      />

      {terms.isLoading || years.isLoading ? (
        <LoadingState rows={3} />
      ) : terms.isError ? (
        <ErrorState description={errorMessage(terms.error)} />
      ) : !currentYear ? (
        // The dependency chain has one more link above this screen, and saying
        // so is more useful than an empty list with an "add" button that would
        // fail on submit.
        <EmptyState
          title="Эхлээд хичээлийн жил үүсгэнэ"
          description="Улирал хичээлийн жилд харьяалагддаг тул хичээлийн жилгүйгээр үүсгэх боломжгүй."
          action={
            <Button asChild variant="secondary">
              <Link href="/admin/school-years">Хичээлийн жил рүү</Link>
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="Улирал бүртгэгдээгүй байна"
          description="Ихэвчлэн намар, өвөл, хавар гэсэн гурван улирал байдаг."
        />
      ) : (
        /*
          ★ These rows had no card around them.

          They were `RowList`'s children but plain `<div>`s, so unlike every
          other administrative list in the product they rendered as bare text
          floating on the canvas with an 8px gap — `RowList` is documented as
          "the column those rows sit in", and `RowCard` is the row. One screen
          out of the seven looked like a different product.
        */
        <DataList columns={TERM_COLUMNS} leadWidth={null} actionsWidth="w-[44px]">
          {items.map((term) => (
            <DataRow
              key={term.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate">
                    {term.number}. {term.name}
                  </span>
                  {/*
                    ★ Derived from the dates, not from a flag, because that is
                    what the server does too.

                    `school-years/page.tsx` records that the dashboard resolves
                    "this term" by testing today against `startsOn`/`endsOn`
                    rather than reading `SchoolYear.isCurrent`. This says the
                    same thing on the screen where the terms are edited — an
                    administrator setting up next year's dates could not tell
                    from this list which term the product currently considers
                    live.
                  */}
                  {isRunning(term.startsOn, term.endsOn) ? (
                    <Badge tone="mint">Идэвхтэй</Badge>
                  ) : null}
                </span>
              }
              cells={{
                startsOn: (
                  <span className="text-body tabular-nums text-ink">
                    {formatDate(term.startsOn)}
                  </span>
                ),
                endsOn: (
                  <span className="text-body tabular-nums text-muted">
                    {formatDate(term.endsOn)}
                  </span>
                ),
                year: term.schoolYear ? (
                  <span className="text-body text-muted">{term.schoolYear.name}</span>
                ) : null,
              }}
              actions={
                <Button variant="ghost" size="icon" onClick={() => setEditing(term)}>
                  <Pencil size={18} />
                  <span className="sr-only">{term.name} засах</span>
                </Button>
              }
            />
          ))}
        </DataList>
      )}

      {creating && currentYear ? (
        <CreateTermDialog
          kindergartenId={primaryKindergartenId!}
          years={yearItems}
          defaultYearId={currentYear.id}
          nextNumber={Math.min(items.length + 1, 3)}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editing ? <EditTermDialog term={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function CreateTermDialog({
  kindergartenId,
  years,
  defaultYearId,
  nextNumber,
  onClose,
}: {
  kindergartenId: string;
  years: z.infer<typeof yearsSchema>;
  defaultYearId: string;
  nextNumber: number;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [schoolYearId, setSchoolYearId] = useState(defaultYearId);
  const [number, setNumber] = useState(String(nextNumber));
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");

  const create = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/terms`, z.unknown(), {
        method: "POST",
        body: { schoolYearId, number: Number(number), name: name.trim(), startsOn, endsOn },
      }),
    onSuccess: () => {
      toast.success("Улирал үүслээ.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "terms"] });
      // The admin dashboard prints the current term in its header.
      void queryClient.invalidateQueries({ queryKey: qk.dashboard.admin() });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const errors = fieldErrors(create.error);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Улирал нэмэх"
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
    >
      <div className="w-full max-w-[420px] rounded-card border border-border bg-surface p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!create.isPending) create.mutate();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <h2 className="text-title font-semibold text-ink">Улирал нэмэх</h2>

          <FormError message={create.isError ? errorMessage(create.error) : null} />

          <Field label="Хичээлийн жил" error={errors.schoolYearId} required>
            {({ id, describedBy, invalid }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={schoolYearId}
                onChange={(e) => setSchoolYearId(e.target.value)}
              >
                {years.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.name}
                    {year.isCurrent ? " (одоогийн)" : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Дугаар"
              error={errors.number}
              hint="Жилд гурав. Дараа нь өөрчлөх боломжгүй."
              required
            >
              {({ id, describedBy, invalid }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </Select>
              )}
            </Field>

            <Field label="Нэр" error={errors.name} hint="Жишээ: Намар" required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Намар"
                  autoFocus
                />
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Эхлэх" error={errors.startsOn} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="date"
                  value={startsOn}
                  onChange={(e) => setStartsOn(e.target.value)}
                />
              )}
            </Field>

            <Field label="Дуусах" error={errors.endsOn} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="date"
                  value={endsOn}
                  onChange={(e) => setEndsOn(e.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Болих
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Хадгалж байна…" : "Нэмэх"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Correcting a term.
 *
 * ★ The number is not here.
 *
 * `PATCH /terms/:id` accepts a name and dates and nothing else, deliberately:
 * assessments and term reports already point at the term, so renumbering would
 * silently move a term's worth of records into a different part of the year.
 * A term created with the wrong number is deleted and made again, before any
 * assessment is written against it.
 */
function EditTermDialog({
  term,
  onClose,
}: {
  term: z.infer<typeof termSchema>;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(term.name);
  const [startsOn, setStartsOn] = useState((term.startsOn ?? "").slice(0, 10));
  const [endsOn, setEndsOn] = useState((term.endsOn ?? "").slice(0, 10));

  const save = useMutation({
    mutationFn: () =>
      mutate(`/terms/${term.id}`, z.unknown(), {
        method: "PATCH",
        body: { name: name.trim(), startsOn, endsOn },
      }),
    onSuccess: () => {
      toast.success("Улирал хадгалагдлаа.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "terms"] });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard.admin() });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const errors = fieldErrors(save.error);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Улирал засах"
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
    >
      <div className="w-full max-w-[420px] rounded-card border border-border bg-surface p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!save.isPending) save.mutate();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <h2 className="text-title font-semibold text-ink">{term.number}-р улирал засах</h2>

          <FormError message={save.isError ? errorMessage(save.error) : null} />

          <Field label="Нэр" error={errors.name} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Эхлэх" error={errors.startsOn} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="date"
                  value={startsOn}
                  onChange={(e) => setStartsOn(e.target.value)}
                />
              )}
            </Field>

            <Field label="Дуусах" error={errors.endsOn} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="date"
                  value={endsOn}
                  onChange={(e) => setEndsOn(e.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Болих
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

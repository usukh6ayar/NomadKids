"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { z } from "zod";
import { OfficialDocuments } from "@/components/documents/official-documents";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { FormError } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors, isNotFound } from "@/lib/api/errors";
import {
  OFFICIAL_AUDIENCES,
  OFFICIAL_DOCUMENTS_KEY,
  OFFICIAL_SOURCE_LEVELS,
  useOfficialDocuments,
  type OfficialDocumentInput,
} from "@/lib/official-documents-api";
import { OFFICIAL_CATEGORIES, type OfficialDocument } from "@/lib/official-documents";

/** Said wherever the API is not there yet — one sentence, one place to change. */
const NOT_READY = "Сервер бэлэн болоогүй байна — нэмэх, засах, устгах удахгүй ажиллана.";

/**
 * The operator's register — add, edit, remove, 2026-10-20, the user. What each
 * kindergarten's «Баримт бичгийн сан» shows on top.
 *
 * ★ Built ahead of the API (`lib/official-documents-api.ts`). While the list
 * still comes from the code, the form opens so the operator sees what they
 * will fill in, but Хадгалах stays off and Устгах says why instead of asking —
 * a form that accepted the work and then failed would lose it.
 */
export function OfficialDocumentsAdmin() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { source } = useOfficialDocuments();
  const ready = source === "api";
  const [editing, setEditing] = useState<OfficialDocument | "new" | null>(null);
  const [removing, setRemoving] = useState<OfficialDocument | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: OFFICIAL_DOCUMENTS_KEY });

  const remove = useMutation({
    mutationFn: (doc: OfficialDocument) =>
      mutate(`/official-documents/${doc.id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Баримт хасагдлаа.");
      setRemoving(null);
      refresh();
    },
    onError: (error) => toast.error(isNotFound(error) ? NOT_READY : errorMessage(error)),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3 rounded-card bg-sunken px-4 py-3">
        <p className="min-w-0 flex-1 text-caption text-muted">
          Энэ жагсаалт бүх цэцэрлэгийн «Баримт бичгийн сан»-д харагдана. Баримт дээр дарахад албан
          эх сурвалж нь шинэ цонхонд нээгдэнэ, манай серверт файл хадгалахгүй.
          {ready ? null : <span className="mt-1 block font-medium text-ink">{NOT_READY}</span>}
        </p>
        <Button size="sm" className="shrink-0" onClick={() => setEditing("new")}>
          <Plus size={16} aria-hidden /> Нэмэх
        </Button>
      </div>

      <OfficialDocuments
        onEdit={setEditing}
        // Nothing to remove from yet: the list is the code's until the API exists.
        onDelete={ready ? setRemoving : () => toast.info(NOT_READY)}
      />

      {editing ? (
        <OfficialDocumentForm
          document={editing === "new" ? null : editing}
          ready={ready}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => (open ? undefined : setRemoving(null))}
        title="Баримтыг хасах уу?"
        description={`"${removing?.title ?? ""}" бүх цэцэрлэгийн жагсаалтаас хасагдана. Бүртгэлд үлдэнэ.`}
        confirmLabel="Хасах"
        pendingLabel="Хасаж байна…"
        cancelLabel="Болих"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </div>
  );
}

function OfficialDocumentForm({
  document: doc,
  ready,
  onClose,
  onSaved,
}: {
  document: OfficialDocument | null;
  ready: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(doc?.title ?? "");
  const [category, setCategory] = useState(doc?.category ?? OFFICIAL_CATEGORIES[0]);
  const [number, setNumber] = useState(doc?.number ?? "");
  const [year, setYear] = useState(String(doc?.year ?? new Date().getFullYear()));
  const [url, setUrl] = useState(doc?.url ?? "");
  const [sourceLevel, setSourceLevel] = useState<OfficialDocumentInput["sourceLevel"]>(
    doc?.sourceLevel ?? "official_pdf",
  );
  const [audience, setAudience] = useState<OfficialDocumentInput["audience"]>(
    doc?.audience ?? [...OFFICIAL_AUDIENCES],
  );
  const [reviewRequired, setReviewRequired] = useState(doc?.reviewRequired ?? false);
  const [featured, setFeatured] = useState(doc?.featured ?? false);
  const [notes, setNotes] = useState(doc?.notes ?? "");
  const [problem, setProblem] = useState("");

  const save = useMutation({
    mutationFn: (body: OfficialDocumentInput) =>
      mutate(doc ? `/official-documents/${doc.id}` : "/official-documents", z.unknown(), {
        method: doc ? "PATCH" : "POST",
        body,
      }),
    onSuccess: () => {
      toast.success("Хадгалагдлаа.");
      onSaved();
    },
    onError: (error) => {
      if (isNotFound(error)) toast.error(NOT_READY);
      else if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });
  const errors = fieldErrors(save.error);

  function submit() {
    if (!title.trim()) return setProblem("Гарчгаа оруулна уу.");
    if (!/^\d{4}$/.test(year.trim())) return setProblem("Оныг дөрвөн оронтойгоор оруулна уу.");
    if (!/^https:\/\/\S+$/.test(url.trim()))
      return setProblem("Холбоос https://-ээр эхэлсэн бүтэн хаяг байна.");
    if (sourceLevel === "official_pdf" && !/\.pdf(\?|$)/i.test(url.trim()))
      return setProblem("«PDF файл» гэж сонгосон бол холбоос нь .pdf файл руу заана.");
    if (audience.length === 0) return setProblem("Хэнд зориулсныг дор хаяж нэгийг сонгоно уу.");
    setProblem("");
    save.mutate({
      title: title.trim(),
      category,
      number: number.trim() || null,
      year: Number(year),
      url: url.trim(),
      sourceLevel,
      audience,
      reviewRequired,
      featured,
      notes: notes.trim() || null,
    });
  }

  const toggleAudience = (who: (typeof OFFICIAL_AUDIENCES)[number]) =>
    setAudience((current) =>
      current.includes(who) ? current.filter((value) => value !== who) : [...current, who],
    );

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={doc ? "Баримт засах" : "Баримт нэмэх"}
      busy={save.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Цуцлах
          </Button>
          <Button onClick={submit} disabled={!ready || save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {ready ? null : (
          <p className="rounded-control bg-sunken px-3 py-2 text-caption text-muted">{NOT_READY}</p>
        )}
        <FormError message={problem || null} />
        <Field label="Гарчиг" error={errors.title} required>
          {({ id }) => (
            <Input
              id={id}
              value={title}
              maxLength={240}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ангилал" error={errors.category}>
            {({ id }) => (
              <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                {[...new Set([...OFFICIAL_CATEGORIES, category])].map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Дугаар" error={errors.number}>
            {({ id }) => (
              <Input
                id={id}
                value={number}
                maxLength={60}
                placeholder="А/79"
                onChange={(e) => setNumber(e.target.value)}
              />
            )}
          </Field>
          <Field label="Он" error={errors.year} required>
            {({ id }) => (
              <Input
                id={id}
                inputMode="numeric"
                value={year}
                maxLength={4}
                onChange={(e) => setYear(e.target.value)}
              />
            )}
          </Field>
          <Field label="Эх сурвалжийн төрөл" error={errors.sourceLevel}>
            {({ id }) => (
              <Select
                id={id}
                value={sourceLevel}
                onChange={(e) =>
                  setSourceLevel(e.target.value as OfficialDocumentInput["sourceLevel"])
                }
              >
                {OFFICIAL_SOURCE_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Холбоос" error={errors.url} required>
          {({ id }) => (
            <Input
              id={id}
              type="url"
              value={url}
              placeholder="https://legalinfo.mn/..."
              onChange={(e) => setUrl(e.target.value)}
            />
          )}
        </Field>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-caption font-semibold text-ink">Хэнд зориулсан</legend>
          {OFFICIAL_AUDIENCES.map((who) => (
            <Checkbox
              key={who}
              label={who}
              checked={audience.includes(who)}
              onChange={() => toggleAudience(who)}
            />
          ))}
        </fieldset>
        <Checkbox
          label="Онцлох"
          description="Багш нарын жагсаалтын хамгийн эхэнд гарна."
          checked={featured}
          onChange={(e) => setFeatured(e.target.checked)}
        />
        <Checkbox
          label="Эх хувийг тулгаж байна"
          description="Холбоос нь баримтын эх хувь мөн эсэхийг шалгаж дуусаагүй бол сонгоно."
          checked={reviewRequired}
          onChange={(e) => setReviewRequired(e.target.checked)}
        />
        <Field label="Тэмдэглэл" error={errors.notes}>
          {({ id }) => (
            <Textarea
              id={id}
              rows={2}
              maxLength={400}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}
        </Field>
      </div>
    </FormDialog>
  );
}

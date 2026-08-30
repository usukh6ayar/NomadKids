"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bookmark, BookmarkCheck, FileText, Search } from "lucide-react";
import { z } from "zod";
import { documentSchema, paginated, DOCUMENT_CATEGORIES } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { mediaUrl } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { useDebounced } from "@/lib/use-debounced";
import { formatDate, formatFileSize } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Card, RowList, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";

const listSchema = paginated(documentSchema);
const categoriesSchema = z.array(z.string());

/**
 * The document library — RFP §9.
 *
 * ★ Staff only, and the route is role-gated as well as API-gated. §9 opens with
 * "Багшид зориулсан PDF баримт бичгийн сан" — a family has no route here, and
 * the sidebar does not offer one.
 *
 * ★★ A document opens through `/media/:id` like every other file in this
 * system: private bucket, presigned URL behind a staff check, download written
 * to the audit log. There is no public link to a curriculum any more than there
 * is to a photograph of a child.
 */
export default function DocumentsPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <DocumentLibrary />
    </RequireRole>
  );
}

function DocumentLibrary() {
  const { primaryKindergartenId } = useSession();
  const kindergartenId = primaryKindergartenId ?? "";

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [adding, setAdding] = useState(false);
  const search = useDebounced(query.trim());

  const filters = { q: search || undefined, category: category || undefined, bookmarkedOnly };

  const documents = useQuery({
    queryKey: qk.documents(kindergartenId, filters),
    queryFn: () => {
      const params = new URLSearchParams({ page: "1", pageSize: "50" });
      if (search) params.set("q", search);
      if (category) params.set("category", category);
      if (bookmarkedOnly) params.set("bookmarkedOnly", "true");
      return get(`/kindergartens/${kindergartenId}/documents?${params}`, listSchema);
    },
    enabled: Boolean(kindergartenId),
  });

  const categories = useQuery({
    queryKey: qk.documentCategories(kindergartenId),
    queryFn: () => get(`/kindergartens/${kindergartenId}/documents/categories`, categoriesSchema),
    enabled: Boolean(kindergartenId),
  });

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Баримт бичгийн сан"
        lede="Хөтөлбөр, арга зүй, дотоод журам."
        actions={
          !adding ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              Баримт нэмэх
            </Button>
          ) : null
        }
      />

      {adding ? (
        <PublishForm kindergartenId={kindergartenId} onDone={() => setAdding(false)} />
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search
            size={18}
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
          />
          <Input
            type="search"
            aria-label="Баримтын нэрээр хайх"
            placeholder="Нэрээр хайх"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-11"
          />
        </div>

        {/*
          ★ The four shelves, plus whatever older rows actually carry.

          The endpoint returns the distinct categories in use, which before this
          change was whatever anybody had typed. Listing the vocabulary
          unconditionally means a shelf exists to file into even when it is
          empty — a teacher looking for Журам should find the option rather than
          conclude the library has none — and unioning the two means a document
          filed under an old spelling is still reachable rather than orphaned by
          a filter that no longer names it.
        */}
        <Field label="Ангилал" className="min-w-[160px]">
          {({ id }) => (
            <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Бүгд</option>
              {[
                ...DOCUMENT_CATEGORIES,
                ...(categories.data ?? []).filter(
                  (name) => !DOCUMENT_CATEGORIES.includes(name as never),
                ),
              ].map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Button
          variant={bookmarkedOnly ? "primary" : "secondary"}
          size="sm"
          aria-pressed={bookmarkedOnly}
          onClick={() => setBookmarkedOnly((on) => !on)}
        >
          <Bookmark size={16} aria-hidden="true" />
          Тэмдэглэсэн
        </Button>
      </div>

      {documents.isPending ? <LoadingState rows={4} /> : null}
      {documents.isError ? <ErrorState description={errorMessage(documents.error)} /> : null}

      {documents.data && documents.data.items.length === 0 ? (
        <EmptyState
          title={search || category || bookmarkedOnly ? "Олдсонгүй" : "Баримт нэмээгүй байна"}
          description={
            search || category || bookmarkedOnly
              ? "Өөр шүүлтээр хайж үзнэ үү."
              : "PDF хөтөлбөр, журам зэргийг энд байршуулна."
          }
        />
      ) : null}

      {documents.data && documents.data.items.length > 0 ? (
        <RowList>
          {documents.data.items.map((doc) => (
            <DocumentRow
              key={doc.id}
              document={doc}
              kindergartenId={kindergartenId}
              filters={filters}
            />
          ))}
        </RowList>
      ) : null}
    </div>
  );
}

function DocumentRow({
  document,
  kindergartenId,
  filters,
}: {
  document: z.infer<typeof documentSchema>;
  kindergartenId: string;
  filters: Record<string, unknown>;
}) {
  const queryClient = useQueryClient();

  const toggle = useMutation({
    mutationFn: () =>
      mutate(`/documents/${document.id}/bookmark`, z.unknown(), {
        method: document.isBookmarked ? "DELETE" : "POST",
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: qk.documents(kindergartenId, filters) }),
  });

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <FileText size={20} aria-hidden="true" className="shrink-0 text-muted" />

      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-ink">{document.title}</p>
        <p className="text-caption text-muted">
          {document.category ? `${document.category} · ` : ""}
          {document.version ? `${document.version} · ` : ""}
          {document.publishedAt ? formatDate(document.publishedAt) : ""}
        </p>
        {document.description ? (
          <p className="mt-0.5 text-caption text-muted">{document.description}</p>
        ) : null}
      </div>

      <Button
        variant="ghost"
        size="sm"
        aria-pressed={document.isBookmarked}
        aria-label={document.isBookmarked ? "Тэмдэглэгээг авах" : "Тэмдэглэх"}
        disabled={toggle.isPending}
        onClick={() => toggle.mutate()}
      >
        {document.isBookmarked ? (
          <BookmarkCheck size={18} aria-hidden="true" className="text-primary" />
        ) : (
          <Bookmark size={18} aria-hidden="true" />
        )}
      </Button>

      {/*
        A plain link to `/media/:id`, which 302s to a presigned URL after the
        staff check. Opened in a new tab because §9 asks for "PDF-г веб дээр
        шууд харах" — the browser's own viewer is the reader, and nothing here
        needs a PDF library.
      */}
      <Button asChild variant="secondary" size="sm">
        <a href={mediaUrl(document.fileMediaFileId)} target="_blank" rel="noreferrer">
          Нээх
        </a>
      </Button>
    </div>
  );
}

function PublishForm({ kindergartenId, onDone }: { kindergartenId: string; onDone: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  /*
   * ★ "Журам" is the default, and that is the point of the change.
   *
   * RFP §9 names the library "хөтөлбөр, арга зүй, дотоод журам", and what an
   * administrator publishes to their staff is almost always the third — a
   * rule, a procedure, an internal order. Starting there means the commonest
   * document is filed correctly by somebody who changes nothing, and a teacher
   * opening the library sees a Журам shelf rather than four spellings of it.
   */
  const [category, setCategory] = useState<string>("Журам");
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("title", title.trim());
      if (category.trim()) form.append("category", category.trim());
      if (version.trim()) form.append("version", version.trim());
      if (description.trim()) form.append("description", description.trim());
      if (file) form.append("file", file);
      // No Content-Type: the browser adds the multipart boundary.
      return mutate(`/kindergartens/${kindergartenId}/documents`, z.unknown(), {
        method: "POST",
        body: form,
      });
    },
    onSuccess: () => {
      toast.success("Баримт нэмэгдлээ.");
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      onDone();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const errors = fieldErrors(save.error);

  return (
    <Card pad="roomy">
      <SectionHeader title="Шинэ баримт" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!save.isPending) save.mutate();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <FormError
          message={
            save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null
          }
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Нэр" error={errors.title} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </Field>

          {/*
            ★ A select over §9's own shelves, where this was a free-text box.

            The library has no full-text search, so the category *is* the way
            in — and a typed one produced "Журам", "журам" and "Дотоод журам"
            as three separate shelves holding one thing. `DOCUMENT_CATEGORIES`
            is where the four are named once, shared with the filter above.
          */}
          <Field label="Ангилал" error={errors.category}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {DOCUMENT_CATEGORIES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Хувилбар" error={errors.version}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                placeholder="2026.1"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Тайлбар" error={errors.description}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>

        <Field label="PDF файл" error={errors.file} required>
          {({ id, describedBy }) => (
            <input
              id={id}
              type="file"
              accept="application/pdf"
              aria-describedby={describedBy}
              className="text-body text-ink"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          )}
        </Field>

        {file ? (
          <p className="text-caption text-muted">
            {file.name} · {formatFileSize(file.size)}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending || !file}>
            {save.isPending ? "Илгээж байна…" : "Нийтлэх"}
          </Button>
          <Button variant="secondary" onClick={onDone}>
            Цуцлах
          </Button>
        </div>
      </form>
    </Card>
  );
}

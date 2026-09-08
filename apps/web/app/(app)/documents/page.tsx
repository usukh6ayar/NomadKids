"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bookmark, BookmarkCheck, FileText, Pencil, Search, Trash2, Upload } from "lucide-react";
import { z } from "zod";
import {
  documentSchema,
  groupListItemSchema,
  paginated,
  DOCUMENT_CATEGORIES,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { mediaUrl } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { useDebounced } from "@/lib/use-debounced";
import { formatDate, formatFileSize } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Card, SectionHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import { RowMenu, type RowMenuItem } from "@/components/ui/menu";
import { renderPdfCover } from "@/components/documents/pdf-cover";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";

const listSchema = paginated(documentSchema);
const groupsSchema = paginated(groupListItemSchema);
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

  /*
    The audience options, and the names the cards print. Same key every
    register uses, so this normally reads a cache the shell has already filled.
  */
  const groups = useQuery({
    queryKey: qk.groups({ pageSize: 100 }),
    queryFn: () => get("/groups?page=1&pageSize=100", groupsSchema),
    enabled: Boolean(kindergartenId),
    staleTime: 60_000,
  });

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Баримт бичгийн сан"
        actions={
          !adding ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              Баримт нэмэх
            </Button>
          ) : null
        }
      />

      {adding ? (
        <PublishForm
          kindergartenId={kindergartenId}
          groups={groups.data?.items ?? []}
          onDone={() => setAdding(false)}
        />
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

      {/*
        ★ A shelf of covers, where this was a list of rows — 2026-09-06.

        The client's words: "одоо харагдаж байгаа нь icon тэгээд нэр нээх гэж
        байгаа, түүний оронд шууд pdf-ийн эхний хуудсыг cover болгож нэмэх, яг
        л номын сан шиг дунд зэргийн дөрвөлжин".

        A row of `[icon] [title] [Нээх]` makes every document look the same,
        which for a library of curricula and internal orders is exactly the
        thing that makes one hard to find: the only distinguishing mark is a
        line of text you have to read. A page of first pages is recognisable at
        a glance, the way a shelf is.

        The grid is capped at four across rather than filling a 1336px screen
        with eight postage stamps — "дунд зэргийн" is the size that shows a
        heading on the page you are looking at.
      */}
      {documents.data && documents.data.items.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
          {documents.data.items.map((doc) => (
            <DocumentCard
              key={doc.id}
              document={doc}
              kindergartenId={kindergartenId}
              filters={filters}
              groups={groups.data?.items ?? []}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * One document, as a cover — 2026-09-06.
 *
 * ★ Three things on the card, and everything else behind "⋯".
 *
 * The cover, the title, and who it is for. Opening it is the card itself; the
 * bookmark is the one control that stays visible, because it is a toggle whose
 * *state* is information — a menu that hid it would hide whether this document
 * is one of yours.
 *
 * ★★ Засах and Устгах live here now. `PATCH /documents/:id` and
 * `DELETE /documents/:id` have both existed since the library shipped and no
 * screen called either, so a mistyped title was permanent and a superseded
 * circular stayed on the shelf for ever. The client asked for both by name.
 */
type CardDialog = "edit" | "delete" | null;

function DocumentCard({
  document,
  kindergartenId,
  filters,
  groups,
}: {
  document: z.infer<typeof documentSchema>;
  kindergartenId: string;
  filters: Record<string, unknown>;
  groups: z.infer<typeof groupListItemSchema>[];
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<CardDialog>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.documents(kindergartenId, filters) });
  };

  const toggle = useMutation({
    mutationFn: () =>
      mutate(`/documents/${document.id}/bookmark`, z.unknown(), {
        method: document.isBookmarked ? "DELETE" : "POST",
      }),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: () => mutate(`/documents/${document.id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Баримт устгагдлаа.");
      setDialog(null);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const items: RowMenuItem[] = [
    { label: "Засах", icon: <Pencil size={16} aria-hidden />, onSelect: () => setDialog("edit") },
    {
      label: "Устгах",
      icon: <Trash2 size={16} aria-hidden />,
      tone: "danger",
      onSelect: () => setDialog("delete"),
    },
  ];

  return (
    <li className="group relative flex flex-col">
      <Card pad="none" className="flex h-full flex-col overflow-hidden">
        {/*
          A link over the cover and the title, not over the whole card: the
          bookmark button and the menu sit inside it, and nesting an interactive
          control inside an anchor is invalid and unpredictable to a keyboard.
        */}
        <a
          href={mediaUrl(document.fileMediaFileId)}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 flex-1 flex-col"
        >
          {/*
            ★ 3:4, the proportions of a page.

            An arbitrary square would crop a portrait A4 to its middle, which
            for a cover page means cutting the heading off the top. Fixed rather
            than intrinsic so the shelf stays a grid: covers of different aspect
            ratios would leave the titles at different heights on every row.
          */}
          <span className="relative block aspect-[3/4] w-full overflow-hidden bg-sunken">
            {document.coverMediaFileId ? (
              // `/media/:id` 302s to a presigned URL, which `next/image` cannot
              // follow — every media surface in this product uses a plain <img>.
              <img
                src={mediaUrl(document.coverMediaFileId)}
                alt=""
                loading="lazy"
                className="size-full object-cover object-top transition-transform duration-200 group-hover:scale-[1.02]"
              />
            ) : (
              /*
                The fallback, for a PDF whose first page could not be rendered
                (see `renderPdfCover`) and for every document published before
                covers existed. A typographic card rather than a lone icon: the
                title is what tells them apart, so the fallback puts the title
                on the paper instead of under it.
              */
              <span className="flex size-full flex-col justify-between p-3">
                <FileText size={20} aria-hidden="true" className="text-faint" />
                <span className="line-clamp-4 text-body font-semibold leading-snug text-muted">
                  {document.title}
                </span>
              </span>
            )}
          </span>

          <span className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
            <span className="line-clamp-2 text-body font-medium leading-snug text-ink">
              {document.title}
            </span>
            <span className="text-caption text-muted">
              {[document.category, document.publishedAt ? formatDate(document.publishedAt) : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {/*
              Who it went to. "Бүх багш" is printed rather than left blank: a
              missing line would read as "we do not know", and the difference
              between a circular and a group's own material is the point of the
              field.
            */}
            <span className="text-caption text-muted">{document.group?.name ?? "Бүх багш"}</span>
          </span>
        </a>

        <div className="flex items-center justify-between border-t border-border-soft px-1.5 py-1">
          <Button
            variant="ghost"
            size="icon"
            aria-pressed={document.isBookmarked}
            aria-label={
              document.isBookmarked
                ? `${document.title} — тэмдэглэгээг авах`
                : `${document.title} — тэмдэглэх`
            }
            disabled={toggle.isPending}
            onClick={() => toggle.mutate()}
          >
            {document.isBookmarked ? (
              <BookmarkCheck size={18} aria-hidden="true" className="text-primary" />
            ) : (
              <Bookmark size={18} aria-hidden="true" />
            )}
          </Button>

          <RowMenu ariaLabel={`${document.title} — үйлдэл`} items={items} />
        </div>
      </Card>

      {dialog === "edit" ? (
        <EditDocumentDialog
          document={document}
          groups={groups}
          onClose={() => setDialog(null)}
          onSaved={refresh}
        />
      ) : null}

      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(next) => setDialog(next ? "delete" : null)}
        title="Баримтыг устгах уу?"
        description={`"${document.title}" номын сангаас хасагдана. Файл нь архивт хадгалагдана.`}
        confirmLabel="Устгах"
        pendingLabel="Устгаж байна…"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </li>
  );
}

/**
 * Correcting a document's title, shelf, description or audience —
 * `PATCH /documents/:id`.
 *
 * ★ Not the PDF itself. Replacing the file is `POST /documents/:id/file`, which
 * is a different act with a different consequence — it is what writes a version
 * label — and it does not belong behind a button called "Засах".
 */
function EditDocumentDialog({
  document,
  groups,
  onClose,
  onSaved,
}: {
  document: z.infer<typeof documentSchema>;
  groups: z.infer<typeof groupListItemSchema>[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(document.title);
  const [category, setCategory] = useState(document.category ?? "Журам");
  const [description, setDescription] = useState(document.description ?? "");
  const [groupId, setGroupId] = useState(document.groupId ?? "");

  const save = useMutation({
    mutationFn: () =>
      mutate(`/documents/${document.id}`, z.unknown(), {
        method: "PATCH",
        body: {
          title: title.trim(),
          category: category.trim() || null,
          description: description.trim() || null,
          groupId: groupId || null,
        },
      }),
    onSuccess: () => {
      toast.success("Хадгалагдлаа.");
      onSaved();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const errors = fieldErrors(save.error);

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      busy={save.isPending}
      title="Баримт засах"
      description={document.title}
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={save.isPending}
            onClick={onClose}
          >
            Болих
          </Button>
          <Button type="submit" form="edit-document-form" size="sm" disabled={save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </>
      }
    >
      <form
        id="edit-document-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!save.isPending) save.mutate();
        }}
      >
        <FormError
          message={
            save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null
          }
        />

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

        <AudienceField groups={groups} value={groupId} onChange={setGroupId} />

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
      </form>
    </FormDialog>
  );
}

/**
 * Who a document is for — "Бүх багш" or one group's.
 *
 * ★ By group, not by teacher, and the hint says so.
 *
 * The client asked for the choice to be a group rather than a name — "багшийн
 * нэрээр нь биш бүлгээр нь choose хийнэ, тэгээд зөвхөн тэр багш руу нь л явна".
 * That is the more durable of the two: assignments change, and a document
 * addressed to a person would follow them out of the group and would not
 * follow their replacement in.
 */
function AudienceField({
  groups,
  value,
  onChange,
}: {
  groups: z.infer<typeof groupListItemSchema>[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <Field label="Хэнд харагдах" hint="Бүлэг сонговол зөвхөн тухайн бүлгийн багш харна.">
      {({ id, describedBy }) => (
        <Select
          id={id}
          aria-describedby={describedBy}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Бүх багш</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function PublishForm({
  kindergartenId,
  groups,
  onDone,
}: {
  kindergartenId: string;
  groups: z.infer<typeof groupListItemSchema>[];
  onDone: () => void;
}) {
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
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  /** "" is every teacher — see `AudienceField`. */
  const [groupId, setGroupId] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("title", title.trim());
      if (category.trim()) form.append("category", category.trim());
      if (description.trim()) form.append("description", description.trim());
      if (groupId) form.append("groupId", groupId);
      if (file) {
        form.append("file", file);

        /*
          ★ The cover is the PDF's own first page, rendered here.

          `renderPdfCover` is best-effort by design and resolves to `null` on
          any failure — a document that will not rasterise still publishes,
          and its card falls back to a typographic cover. The API has taken a
          `cover` part since the library shipped; nothing on the server
          changed for this.
        */
        const cover = await renderPdfCover(file);
        if (cover) form.append("cover", cover, "cover.png");
      }
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

          {/*
            ★ "Хувилбар" was here and is gone — 2026-09-06, at the client's
            request ("хувилбар гэдэг нь хэрэггүй арилга").

            It asked somebody publishing a PDF to invent a version string for a
            document that had never had one, and almost every row carried
            nothing. The column and the label survive: `POST /documents/:id/file`
            writes a version when a PDF is *replaced*, which is the one moment
            the number is a fact rather than a guess.

            Its place is taken by the field that actually needed asking.
          */}
          <AudienceField groups={groups} value={groupId} onChange={setGroupId} />
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

        {/*
          ★ A labelled drop zone, where this was a bare `<input type="file">` —
          2026-09-06: "pdf file choose н ялгагдаж харагдахгүй байна, үүнийг
          button гэдгийг тодорхой болго".

          The browser's native file control is a small grey "Choose File" the
          platform draws in its own language, sitting in a form of 48px inputs
          and 48px buttons — so on the one screen whose whole purpose is
          attaching a file, the control that attaches it was the least visible
          thing on it.

          The input is still an `<input type="file">`, visually hidden and
          wrapped in its own `<label>`: that keeps the click, the keyboard and
          the accessible name the platform gives it, where a `<button>` calling
          `.click()` on a hidden input re-implements all three and gets the
          third wrong.
        */}
        <Field label="PDF файл" error={errors.file} required>
          {({ id, describedBy }) => (
            <label
              htmlFor={id}
              className="flex cursor-pointer flex-col items-center gap-1.5 rounded-card border border-dashed border-border bg-canvas px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-primary-soft/30"
            >
              <Upload size={22} aria-hidden="true" className="text-primary" />
              <span className="text-body font-semibold text-ink">
                {file ? "Өөр файл сонгох" : "PDF файл сонгох"}
              </span>
              <span className="text-caption text-muted">
                {file ? `${file.name} · ${formatFileSize(file.size)}` : "Зөвхөн PDF."}
              </span>
              <input
                id={id}
                type="file"
                accept="application/pdf"
                aria-describedby={describedBy}
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          )}
        </Field>

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

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { TeachingMaterials } from "@/components/materials/teaching-materials";
import { OfficialDocuments } from "@/components/documents/official-documents";
import { ViewToggle, useLibraryView, type LibraryView } from "@/components/documents/view-toggle";
import { FilterButton } from "@/components/ui/filter-chip";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  ChevronRight,
  FileText,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { z } from "zod";
import {
  documentSchema,
  groupListItemSchema,
  paginated,
  DOCUMENT_CATEGORIES,
  MAX_PAGE_SIZE,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { mediaUrl } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { useDebounced } from "@/lib/use-debounced";
import { formatDate, formatFileSize, groupLabel } from "@/lib/format";
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

type LibraryDoc = z.infer<typeof documentSchema>;
type LibraryGroup = z.infer<typeof groupListItemSchema>;
type LibrarySort = "new" | "az";

/** How many covers a shelf shows before «Бүгдийг харах» — one row on a wide screen. */
const SHELF_SIZE = 6;

/** The shelf a document without a category sits on — not a filter the API knows. */
const UNFILED = "Ангилалгүй";

function sortDocuments(docs: LibraryDoc[], sort: LibrarySort) {
  if (sort === "new") return docs; // The API's own order: newest published first.
  return [...docs].sort((a, b) => a.title.localeCompare(b.title, "mn"));
}

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
      {/* `?material=` is read below — a shared material link (2026-10-14). */}
      <Suspense fallback={<LoadingState rows={3} />}>
        <DocumentsHome />
      </Suspense>
    </RequireRole>
  );
}

/**
 * ★ «Сургалтын хэрэглэгдэхүүн» beside the library — for a teacher only
 * (client, 2026-10-09: "зөвхөн багш"). A director sees the library alone.
 */
function DocumentsHome() {
  const { hasRole } = useSession();
  const teacher = hasRole("TEACHER");
  // A shared material's link opens on the materials (2026-10-14, the user).
  const fromLink = Boolean(useSearchParams().get("material"));
  const [tab, setTab] = useState<"docs" | "official" | "materials">(
    fromLink ? "materials" : "docs",
  );

  /*
    ★ Two libraries, two tabs — 2026-10-20, the user: «Цэцэрлэгийн баримт
    бичиг» (what this kindergarten published) and «Үндсэн баримт бичиг» (the
    ministry's curricula and regulations, linked out). A teacher also keeps
    «Сургалтын хэрэглэгдэхүүн».
  */
  const tabs = [
    ["docs", "Цэцэрлэгийн баримт бичиг"],
    ["official", "Үндсэн баримт бичиг"],
    ...(teacher ? ([["materials", "Сургалтын хэрэглэгдэхүүн"]] as const) : []),
  ] as const;

  const switcher = (
    <div
      role="tablist"
      aria-label="Баримт бичгийн сангийн хэсэг"
      className={cn(
        "grid w-full gap-1 rounded-control bg-canvas p-1",
        tabs.length === 3 ? "max-w-2xl grid-cols-3" : "max-w-md grid-cols-2",
      )}
    >
      {tabs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={tab === key}
          onClick={() => setTab(key)}
          className={cn(
            "min-h-[40px] rounded-control px-2 text-caption font-semibold leading-tight transition-colors sm:text-body",
            tab === key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (tab === "official") return <OfficialLibrary switcher={switcher} />;
  if (teacher && tab === "materials") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Баримт бичгийн сан" backHref="/dashboard" />
        {switcher}
        <TeachingMaterials />
      </div>
    );
  }
  return <DocumentLibrary switcher={switcher} />;
}

/** «Үндсэн баримт бичиг» — the ministry's register, links out, nothing stored. */
function OfficialLibrary({ switcher }: { switcher: ReactNode }) {
  const { hasRole } = useSession();
  // Who the register is for: a teacher, a director, or both.
  const audience = [
    ...(hasRole("TEACHER") ? (["Багш"] as const) : []),
    ...(hasRole("ADMIN") ? (["Эрхлэгч"] as const) : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Баримт бичгийн сан" backHref="/dashboard" />
      {switcher}
      <OfficialDocuments audience={audience} />
    </div>
  );
}

function DocumentLibrary({ switcher }: { switcher?: ReactNode }) {
  const { primaryKindergartenId } = useSession();
  const kindergartenId = primaryKindergartenId ?? "";

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [sort, setSort] = useState<LibrarySort>("new");
  const [view, setView] = useLibraryView();
  const [filterOpen, setFilterOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const search = useDebounced(query.trim());

  const filters = { q: search || undefined, category: category || undefined, bookmarkedOnly };

  const documents = useQuery({
    queryKey: qk.documents(kindergartenId, filters),
    queryFn: () => {
      const params = new URLSearchParams({ page: "1", pageSize: String(MAX_PAGE_SIZE) });
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

  const focused = Boolean(search || category || bookmarkedOnly);
  const showAll = () => {
    setQuery("");
    setCategory("");
    setBookmarkedOnly(false);
  };
  const docs = sortDocuments(documents.data?.items ?? [], sort);
  const collection = (items: LibraryDoc[]) => (
    <DocumentCollection
      documents={items}
      view={view}
      kindergartenId={kindergartenId}
      filters={filters}
      groups={groups.data?.items ?? []}
    />
  );

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Баримт бичгийн сан"
        backHref="/dashboard"
        actions={
          !adding ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              Баримт нэмэх
            </Button>
          ) : null
        }
      />

      {switcher}

      {adding ? (
        <PublishForm
          kindergartenId={kindergartenId}
          groups={groups.data?.items ?? []}
          onDone={() => setAdding(false)}
        />
      ) : null}

      {/*
        ★ One row — 2026-10-20, the user: "цэгцтэй ойлгомжтой зай бага эзлэх".
        Search, the filter button and Хавтсаар/Жагсаалтаар; Ангилал and Эрэмбэ
        open under the filter button, as the materials shop's do. The filter's
        count says when either is set, so nothing narrows the shelf unseen.

        The category list is the four shelves plus whatever older rows carry:
        the vocabulary unconditionally, so a shelf exists to file into even
        when empty, unioned with the endpoint's distinct values, so a document
        filed under an old spelling is still reachable.
      */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <SearchField
            label="Баримтын нэрээр хайх"
            placeholder="Нэрээр хайх"
            value={query}
            onChange={setQuery}
            className="min-w-0"
          />
          <FilterButton
            expanded={filterOpen}
            controls="document-filters"
            count={(category ? 1 : 0) + (sort === "az" ? 1 : 0)}
            onClick={() => setFilterOpen((open) => !open)}
          />
          <ViewToggle value={view} onChange={setView} />
        </div>
        <div
          id="document-filters"
          hidden={!filterOpen}
          className={cn("flex-wrap gap-2", filterOpen && "flex")}
        >
          <div className="w-48">
            <Field label="Ангиллаар шүүх" labelHidden>
              {({ id }) => (
                <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Бүх ангилал</option>
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
          </div>
          <div className="w-44">
            <Field label="Эрэмбэлэх" labelHidden>
              {({ id }) => (
                <Select
                  id={id}
                  value={sort}
                  onChange={(e) => setSort(e.target.value as LibrarySort)}
                >
                  <option value="new">Эрэмбэ: шинэ нь эхэндээ</option>
                  <option value="az">Эрэмбэ: А–Я</option>
                </Select>
              )}
            </Field>
          </div>
        </div>
      </div>

      {focused ? (
        <div className="-mb-2 flex items-center gap-2 lg:-mb-4">
          <Button variant="ghost" size="sm" onClick={showAll}>
            <ArrowLeft size={16} aria-hidden />
            Бүх тавиур
          </Button>
          <span className="min-w-0 truncate text-body font-semibold text-ink">
            {bookmarkedOnly ? "Таалагдсан" : category || "Хайлтын үр дүн"}
          </span>
        </div>
      ) : null}

      {documents.isPending ? <LoadingState rows={4} /> : null}
      {documents.isError ? <ErrorState description={errorMessage(documents.error)} /> : null}

      {documents.data && documents.data.items.length === 0 ? (
        <EmptyState
          title={
            search || category || bookmarkedOnly ? "Олдсонгүй" : "Цэцэрлэгийн баримт нэмээгүй байна"
          }
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

        ★★ Five and six across on the wide screens — 2026-09-16, the client:
        "оруулсан баримт бичгүүдийг хэмжээ хэт том байна арай жижиг болгоод өг".

        Four across a 1512px monitor is a cover about 350px wide, which is a
        poster rather than a shelf. The phone keeps its two — that is where
        "дунд зэргийн" was judged and it is right there — and the extra columns
        arrive only where there is width to spend: five from `lg`, six from
        `xl`, which lands each cover back around 200px.
      */}
      {documents.data && docs.length > 0 && focused ? collection(docs) : null}

      {/*
        ★ Shelves, the way a shop is laid out — 2026-10-20, the user: "дэлгүүр
        шиг ... таалагдсан эсвэл төрөлжүүл". «Таалагдсан» first and always
        there, so a reader sees where a liked document goes; then one shelf per
        category. «Бүгдийг харах» narrows to that shelf on the server, so it
        shows every document rather than the first page's share.
      */}
      {documents.data && docs.length > 0 && !focused ? (
        <>
          {/* Only once something is liked — an empty shelf was a line of noise. */}
          {docs.some((doc) => doc.isBookmarked) ? (
            <Shelf
              title="Таалагдсан"
              count={docs.filter((doc) => doc.isBookmarked).length}
              onSeeAll={() => setBookmarkedOnly(true)}
            >
              {collection(docs.filter((doc) => doc.isBookmarked).slice(0, SHELF_SIZE))}
            </Shelf>
          ) : null}
          {shelvesOf(docs).map(([name, items]) => (
            <Shelf
              key={name}
              title={name}
              count={items.length}
              onSeeAll={name === UNFILED ? undefined : () => setCategory(name)}
            >
              {collection(name === UNFILED ? items : items.slice(0, SHELF_SIZE))}
            </Shelf>
          ))}
        </>
      ) : null}
    </div>
  );
}

/** The documents by category, in the vocabulary's order, then any older spelling. */
function shelvesOf(docs: LibraryDoc[]): [string, LibraryDoc[]][] {
  const byName = new Map<string, LibraryDoc[]>();
  for (const doc of docs) {
    const name = doc.category || UNFILED;
    byName.set(name, [...(byName.get(name) ?? []), doc]);
  }
  const order = [...DOCUMENT_CATEGORIES, ...byName.keys()];
  return [...new Set(order)]
    .filter((name) => byName.has(name))
    .sort((a, b) => Number(a === UNFILED) - Number(b === UNFILED))
    .map((name) => [name, byName.get(name)!]);
}

function Shelf({
  title,
  count,
  onSeeAll,
  children,
}: {
  title: string;
  count: number;
  onSeeAll?: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="min-w-0 flex-1 truncate text-lead font-semibold leading-heading text-ink">
          {title}
          <span className="ml-2 text-caption font-normal tabular-nums text-muted">{count}</span>
        </h2>
        {onSeeAll && count > SHELF_SIZE ? (
          <button
            type="button"
            onClick={onSeeAll}
            className="inline-flex shrink-0 items-center gap-0.5 text-caption font-semibold text-primary hover:underline"
          >
            Бүгдийг харах
            <ChevronRight size={15} aria-hidden />
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * One set of documents, as covers or as rows — the same cards either way, so
 * the bookmark, Засах and Устгах behave identically in both.
 */
function DocumentCollection({
  documents,
  view,
  kindergartenId,
  filters,
  groups,
}: {
  documents: LibraryDoc[];
  view: LibraryView;
  kindergartenId: string;
  filters: Record<string, unknown>;
  groups: LibraryGroup[];
}) {
  return (
    <ul
      className={
        view === "grid"
          ? "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
          : "flex flex-col overflow-hidden rounded-card border border-border-soft bg-surface"
      }
    >
      {documents.map((doc) => (
        <DocumentCard
          key={doc.id}
          document={doc}
          view={view}
          kindergartenId={kindergartenId}
          filters={filters}
          groups={groups}
        />
      ))}
    </ul>
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
  view = "grid",
  kindergartenId,
  filters,
  groups,
}: {
  document: z.infer<typeof documentSchema>;
  view?: LibraryView;
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

  const bookmarkButton = (
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
  );

  const dialogs = (
    <>
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
    </>
  );

  // Жагсаалт — a row: a small first page, the title and its facts, the two controls.
  if (view === "list") {
    return (
      <li className="flex items-center gap-3 border-b border-border-soft px-3 py-2 last:border-b-0">
        <a
          href={mediaUrl(document.fileMediaFileId)}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <span className="grid h-12 w-9 shrink-0 place-items-center overflow-hidden rounded-check bg-sunken">
            {document.coverMediaFileId ? (
              <img
                src={mediaUrl(document.coverMediaFileId)}
                alt=""
                loading="lazy"
                className="size-full object-cover object-top"
              />
            ) : (
              <FileText size={16} aria-hidden="true" className="text-faint" />
            )}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-body font-medium text-ink">{document.title}</span>
            <span className="truncate text-caption text-muted">
              {[
                document.category,
                document.group?.name ?? "Бүх багш",
                document.publishedAt ? formatDate(document.publishedAt) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </a>
        {bookmarkButton}
        <RowMenu ariaLabel={`${document.title} — үйлдэл`} items={items} />
        {dialogs}
      </li>
    );
  }

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

          <span className="flex min-w-0 flex-col gap-0.5 px-2.5 py-2">
            <span className="line-clamp-2 text-caption font-semibold leading-snug text-ink sm:text-body sm:font-medium">
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
          {bookmarkButton}

          <RowMenu ariaLabel={`${document.title} — үйлдэл`} items={items} />
        </div>
      </Card>

      {dialogs}
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
              {groupLabel(group.name)}
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

        <div className="flex justify-end gap-2">
          <Button type="submit" size="sm" disabled={save.isPending || !file}>
            {save.isPending ? "Илгээж байна…" : "Нийтлэх"}
          </Button>
          <Button variant="secondary" size="sm" onClick={onDone}>
            Цуцлах
          </Button>
        </div>
      </form>
    </Card>
  );
}

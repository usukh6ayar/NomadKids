"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { RowMenu } from "@/components/ui/menu";
import { ViewToggle, useLibraryView, type LibraryView } from "@/components/documents/view-toggle";
import { Field, Select } from "@/components/ui/field";
import { FilterButton } from "@/components/ui/filter-chip";
import { SearchField } from "@/components/ui/search-field";
import { useOfficialDocuments } from "@/lib/official-documents-api";
import {
  OFFICIAL_CATEGORIES,
  sourceHost,
  type OfficialAudience,
  type OfficialDocument,
} from "@/lib/official-documents";
import { cn } from "@/lib/utils";

/** How many covers show before «Бүгдийг харах» — one row on a wide screen. */
const SHELF_SIZE = 6;

/** One tint per family of category, so a shelf of covers is told apart at a glance. */
const COVER_TONE: Record<string, string> = {
  Хууль: "bg-primary-soft text-primary-strong",
  "Дүрэм, журам": "bg-sky text-sky-ink",
  "Сургалтын хөтөлбөр": "bg-mint text-mint-ink",
  Аргачлал: "bg-teal text-teal-ink",
  "Гарын авлага": "bg-peach text-peach-ink",
  Тогтоол: "bg-pink text-pink-ink",
  Норматив: "bg-sun text-sun-ink",
  Жагсаалт: "bg-sun text-sun-ink",
  Стандарт: "bg-cornflower text-cornflower-ink",
  "Барилгын норм": "bg-cornflower text-cornflower-ink",
  "Бодлогын чиглэл": "bg-sunken text-ink",
};

/**
 * «Яамны хөтөлбөр, журам» — the official shelf, 2026-10-20. The list comes
 * from `useOfficialDocuments` (the API once built, `lib/official-documents.ts`
 * until then); a card is a plain link out to the source.
 *
 * `onEdit` / `onDelete` are the operator's: given, each card carries a ⋯ menu.
 *
 * `audience` narrows to who the register says a document is for — a teacher
 * does not see a director's management guide. Omitted, everything shows (the
 * operator's own view).
 */
export function OfficialDocuments({
  audience,
  onEdit,
  onDelete,
}: {
  audience?: OfficialAudience[];
  onEdit?: (document: OfficialDocument) => void;
  onDelete?: (document: OfficialDocument) => void;
}) {
  // ★ Its own toolbar, the kindergarten tab's shape — 2026-10-20, the user:
  // search, a filter button with Ангилал behind it, Хавтсаар/Жагсаалтаар.
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [view, setView] = useLibraryView();
  const [expanded, setExpanded] = useState(false);
  const { documents } = useOfficialDocuments();

  const term = query.trim().toLocaleLowerCase("mn");
  const forReader = documents.filter(
    (doc) => !audience || doc.audience.some((who) => audience.includes(who)),
  );
  const matching = forReader.filter(
    (doc) =>
      !term ||
      doc.title.toLocaleLowerCase("mn").includes(term) ||
      (doc.number ?? "").toLocaleLowerCase("mn").includes(term),
  );
  // Онцлох first; otherwise the register's own order (a stable sort keeps it).
  const visible = matching
    .filter((doc) => !category || doc.category === category)
    .sort((a, b) => Number(b.featured) - Number(a.featured));
  // The register's order first, then any category the operator has added.
  const categories = [
    ...new Set([...OFFICIAL_CATEGORIES, ...forReader.map((d) => d.category)]),
  ].filter((name) => forReader.some((doc) => doc.category === name));
  const shown = expanded || view === "list" ? visible : visible.slice(0, SHELF_SIZE);

  return (
    <section aria-labelledby="official-documents" className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <SearchField
            label="Нэр эсвэл дугаараар хайх"
            placeholder="Нэр эсвэл дугаараар хайх (А/79)"
            value={query}
            onChange={setQuery}
            className="min-w-0"
          />
          <FilterButton
            expanded={filterOpen}
            controls="official-filters"
            count={category ? 1 : 0}
            onClick={() => setFilterOpen((open) => !open)}
          />
          <ViewToggle value={view} onChange={setView} />
        </div>
        <div
          id="official-filters"
          hidden={!filterOpen}
          className={cn("flex-wrap gap-2", filterOpen && "flex")}
        >
          <div className="w-56">
            <Field label="Ангиллаар шүүх" labelHidden>
              {({ id }) => (
                <Select
                  id={id}
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setExpanded(false);
                  }}
                >
                  <option value="">Бүх ангилал</option>
                  {categories.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </div>
      </div>

      <h2 id="official-documents" className="text-lead font-semibold leading-heading text-ink">
        {category || "Яамны хөтөлбөр, журам"}
        <span className="ml-2 text-caption font-normal tabular-nums text-muted">
          {visible.length}
        </span>
      </h2>

      {visible.length === 0 ? (
        <p className="py-6 text-center text-body text-muted">
          {term
            ? `«${query.trim()}» гэсэн баримт олдсонгүй. Өөр үгээр хайж үзнэ үү.`
            : "Энэ ангилалд баримт алга."}
        </p>
      ) : null}

      <ul
        className={
          view === "list"
            ? "flex flex-col overflow-hidden rounded-card border border-border-soft bg-surface"
            : "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
        }
      >
        {shown.map((doc) => (
          <OfficialCard
            key={doc.id}
            document={doc}
            view={view}
            onEdit={onEdit && (() => onEdit(doc))}
            onDelete={onDelete && (() => onDelete(doc))}
          />
        ))}
      </ul>

      {view === "grid" && visible.length > SHELF_SIZE ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="inline-flex items-center gap-1 self-center text-caption font-semibold text-primary hover:underline"
        >
          {expanded ? "Хураах" : `Бүгдийг харах (${visible.length})`}
          <ChevronDown
            size={15}
            aria-hidden
            className={cn("transition-transform", expanded && "rotate-180")}
          />
        </button>
      ) : null}
    </section>
  );
}

/**
 * One document: a drawn cover (no image to fetch) and a link out.
 *
 * ★ `noopener noreferrer` — the source site gets neither a handle on this tab
 * nor the address it was opened from.
 */
function OfficialCard({
  document: doc,
  view,
  onEdit,
  onDelete,
}: {
  document: OfficialDocument;
  view: LibraryView;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const host = sourceHost(doc.url);
  // Outside the link: a control nested in an anchor is invalid.
  const menu =
    onEdit || onDelete ? (
      <RowMenu
        ariaLabel={`${doc.title} — үйлдэл`}
        items={[
          ...(onEdit
            ? [{ label: "Засах", icon: <Pencil size={16} aria-hidden />, onSelect: onEdit }]
            : []),
          ...(onDelete
            ? [
                {
                  label: "Устгах",
                  icon: <Trash2 size={16} aria-hidden />,
                  tone: "danger" as const,
                  onSelect: onDelete,
                },
              ]
            : []),
        ]}
      />
    ) : null;

  // Жагсаалт — a small first page or the number, the title, its facts, the way in.
  if (view === "list") {
    return (
      <li className="flex items-center gap-3 border-b border-border-soft px-3 py-2 last:border-b-0">
        <a
          href={doc.url}
          target="_blank"
          rel="noopener noreferrer"
          title={doc.notes || doc.title}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          {doc.cover ? (
            <img
              src={doc.cover}
              alt=""
              loading="lazy"
              className="h-12 w-9 shrink-0 rounded-check bg-sunken object-cover object-top"
            />
          ) : (
            <span
              className={cn(
                "grid h-12 w-9 shrink-0 place-items-center overflow-hidden break-words rounded-check px-0.5 text-center text-caption font-bold leading-none",
                COVER_TONE[doc.category] ?? "bg-sunken text-ink",
              )}
            >
              {doc.number ?? doc.year}
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body font-medium text-ink">{doc.title}</span>
            <span className="truncate text-caption text-muted">
              {[doc.category, doc.number, host, doc.year].filter(Boolean).join(" · ")}
            </span>
          </span>
          {doc.featured ? (
            <span className="hidden shrink-0 rounded-pill bg-primary-soft px-2 py-0.5 text-caption font-semibold text-primary sm:inline">
              Онцлох
            </span>
          ) : null}
          <span className="inline-flex shrink-0 items-center gap-1 text-caption font-semibold text-primary">
            <span className="hidden sm:inline">{doc.actionLabel}</span>
            <ExternalLink size={14} aria-hidden />
          </span>
          <span className="sr-only">(шинэ цонхонд нээгдэнэ)</span>
        </a>
        {menu}
      </li>
    );
  }

  return (
    <li className="flex flex-col overflow-hidden rounded-card border border-border-soft bg-surface shadow-sm transition-shadow hover:shadow-md">
      <a
        href={doc.url}
        target="_blank"
        rel="noopener noreferrer"
        title={doc.notes || doc.title}
        className="group flex flex-1 flex-col"
      >
        {doc.cover ? (
          <span className="relative block aspect-[3/4] w-full overflow-hidden bg-sunken">
            {/* A static file under `public/` — a plain <img>, as the library's covers are. */}
            <img
              src={doc.cover}
              alt=""
              loading="lazy"
              className="size-full object-cover object-top transition-transform duration-200 group-hover:scale-[1.02]"
            />
          </span>
        ) : (
          <span
            className={cn(
              "flex aspect-[3/4] w-full flex-col justify-between p-3",
              COVER_TONE[doc.category] ?? "bg-sunken text-ink",
            )}
          >
            {/*
              ★ The category and the number — «ХУУЛЬ / 2023» — and no title:
              the title is printed under the cover, and twice read as a
              mistake (2026-10-20, the user).
            */}
            <span className="text-caption font-semibold uppercase tracking-wide opacity-80">
              {doc.category}
            </span>
            <span className="text-title font-bold leading-tight">{doc.number ?? doc.year}</span>
            <span aria-hidden />
          </span>
        )}

        <span className="flex min-w-0 flex-1 flex-col gap-1 px-2.5 py-2">
          <span className="line-clamp-2 text-caption font-semibold leading-snug text-ink sm:text-body sm:font-medium">
            {doc.title}
          </span>
          <span className="text-caption text-muted">
            {host} · {doc.year}
          </span>
          {doc.featured ? (
            <span className="self-start rounded-pill bg-primary-soft px-2 py-0.5 text-caption font-semibold text-primary">
              Онцлох
            </span>
          ) : null}
          {doc.reviewRequired ? (
            <span className="self-start rounded-pill bg-sunken px-2 py-0.5 text-caption text-muted">
              Эх хувийг тулгаж байна
            </span>
          ) : null}
          <span className="mt-auto inline-flex items-center gap-1 pt-1 text-caption font-semibold text-primary">
            {doc.actionLabel}
            <ExternalLink size={13} aria-hidden />
          </span>
          <span className="sr-only">(шинэ цонхонд нээгдэнэ)</span>
        </span>
      </a>
      {menu ? (
        <div className="flex justify-end border-t border-border-soft px-1.5 py-1">{menu}</div>
      ) : null}
    </li>
  );
}

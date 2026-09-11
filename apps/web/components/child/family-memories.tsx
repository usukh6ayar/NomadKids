"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Baby,
  CalendarDays,
  Check,
  HeartHandshake,
  Images,
  Pencil,
  PersonStanding,
  Smile,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { mediaListSchema, type FamilyMemory, type Media } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { mediaUrl } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { MediaThumb } from "@/components/media/media-image";
import { PhotoUpload } from "@/components/media/photo-upload";
import { FAMILY_MEMBER_TYPES, type PortfolioAge } from "@/lib/age-development";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * "Гэр бүлийн дурсамж" — the pieces of the family section's memory builder.
 *
 * ★ A memory is a `FamilyMemory` entry plus an ordinary album photograph.
 *
 * Nothing here owns an image. The picture is uploaded through `PhotoUpload` to
 * `POST /children/:id/media` tagged `category=FAMILY` and `age=N` — the same
 * write the age album's own "+" button makes — and the memory stores its id.
 * That is what makes a memory's photograph appear under
 * `portfolio/gallery/:age` → "Миний гэр бүл" without a second write, and it is
 * why the archive below can offer photographs the family added anywhere else.
 *
 * ★★ Kept out of `age-profile-cards.tsx` rather than inlined in `FamilyCard`.
 *
 * That file holds five sibling cards that are deliberately near-identical, and
 * one of them growing a photo picker, an archive and a preview pane would bury
 * the shape the other four still follow. These are presentational pieces —
 * every mutation stays in `FamilyCard`, which already owns the save.
 */

/**
 * A tint and a mark per family member.
 *
 * ★ Not an age, and that is deliberate. The client's reference screenshot
 * draws "Аав · 32 нас" beside each face, and the product has no such field:
 * `familyMemberTypes` is five fixed strings chosen by tick, and nothing
 * anywhere records how old a child's father is. Printing an invented number
 * would be the mock-data problem the rest of this codebase refuses. The second
 * line carries a real fact instead — how many memories name this person.
 */
const MEMBER_ART: Record<string, { icon: LucideIcon; tone: string }> = {
  "Эмээ, өвөө": { icon: HeartHandshake, tone: "bg-sun text-sun-ink" },
  "Аав, ээж": { icon: Users, tone: "bg-sky text-sky-ink" },
  "Ах, эгч": { icon: Smile, tone: "bg-mint text-mint-ink" },
  "Хүү, охин": { icon: PersonStanding, tone: "bg-cornflower text-cornflower-ink" },
  "Нялх охин, нялх хүү": { icon: Baby, tone: "bg-pink text-pink-ink" },
};

const FALLBACK_ART = { icon: Users, tone: "bg-primary-soft text-primary" } as const;

export function memberArt(member: string) {
  return MEMBER_ART[member] ?? FALLBACK_ART;
}

/** A memory being written. Becomes a `FamilyMemory` once it passes validation. */
export type MemoryDraft = {
  id: string;
  mediaId: string | null;
  members: string[];
  title: string;
  description: string;
  date: string;
};

/**
 * An id for a memory inside a JSON column.
 *
 * `crypto.randomUUID` needs a secure context and the kindergarten's own tablets
 * are not always on one, so a timestamp and a random suffix stand in.
 * Uniqueness only has to hold within one child's one age — a list the API caps
 * at fifty entries.
 */
export function newMemoryId(): string {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyDraft(members: string[] = []): MemoryDraft {
  return {
    id: newMemoryId(),
    mediaId: null,
    members: [...members],
    title: "",
    description: "",
    date: "",
  };
}

export function draftFrom(memory: FamilyMemory): MemoryDraft {
  return {
    id: memory.id,
    mediaId: memory.mediaId ?? null,
    members: [...memory.members],
    title: memory.title,
    description: memory.description ?? "",
    date: memory.date ?? "",
  };
}

/** How many stored memories name this member — the selector's second line. */
export function memoryCountFor(memories: FamilyMemory[], member: string): number {
  return memories.filter((memory) => memory.members.includes(member)).length;
}

// ── Family members ───────────────────────────────────────────────────────────

/**
 * The member picker.
 *
 * ★ Buttons with `aria-pressed`, where this used to be a column of checkboxes.
 *
 * The stored value is unchanged — the same five strings, the same array, the
 * same PATCH — so nothing about the data moved. What moved is that a memory
 * needs its own second member choice ("who was this one with?"), and two
 * checkbox lists on one screen read as one long column of ticks. A pressed
 * card states the choice at a glance and keeps the 44px tap floor
 * `responsive.test.tsx` asks of every control.
 */
export function FamilyMemberSelector({
  legend,
  hint,
  selected,
  onToggle,
  noteFor,
  error,
  compact = false,
}: {
  legend: string;
  hint?: string;
  selected: string[];
  onToggle: (member: string) => void;
  /** A real second line — memory counts on the section picker, nothing on a draft's. */
  noteFor?: (member: string) => string;
  error?: string | null;
  compact?: boolean;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="flex items-center gap-2 text-body font-semibold text-ink">
        <Users size={17} aria-hidden="true" className="text-primary" />
        {legend}
      </legend>
      {hint ? <p className="mt-1 text-caption text-muted">{hint}</p> : null}

      <ul className="mt-2.5 grid gap-2 sm:grid-cols-2">
        {FAMILY_MEMBER_TYPES.map((member) => {
          const art = memberArt(member);
          const Icon = art.icon;
          const active = selected.includes(member);
          const note = noteFor?.(member);

          return (
            <li key={member} className="min-w-0">
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onToggle(member)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-row border px-3 text-left transition-colors",
                  compact ? "min-h-[52px] py-2" : "min-h-[60px] py-2.5",
                  active
                    ? "border-primary bg-primary-soft"
                    : "border-border bg-surface hover:border-faint hover:bg-canvas",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid shrink-0 place-items-center rounded-row",
                    compact ? "size-8" : "size-9",
                    art.tone,
                  )}
                >
                  <Icon size={compact ? 16 : 18} />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold text-ink">{member}</span>
                  {note ? (
                    <span className="mt-0.5 block truncate text-caption text-muted">{note}</span>
                  ) : null}
                </span>

                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-pill border transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-ink"
                      : "border-border bg-surface text-transparent",
                  )}
                >
                  <Check size={14} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {error ? (
        <p role="alert" className="mt-2 text-caption font-medium text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** The members of one memory, as read-only chips. */
export function MemberChips({ members }: { members: string[] }) {
  if (members.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-1.5">
      {members.map((member) => {
        const art = memberArt(member);
        const Icon = art.icon;
        return (
          <li
            key={member}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-caption font-semibold",
              art.tone,
            )}
          >
            <Icon size={13} aria-hidden="true" />
            {member}
          </li>
        );
      })}
    </ul>
  );
}

// ── The photograph ───────────────────────────────────────────────────────────

/**
 * Choosing the memory's photograph: upload a new one, or reuse one already here.
 *
 * ★ One row, not two sections. Rewritten 2026-09-10 on the client's
 * instruction — "delete the «Зураг нэмэх» text and tidy it up".
 *
 * It was a labelled button in a dashed panel, a separate preview tile with its
 * own remove button, and below that a second headed section for the archive:
 * four blocks of prose, three of them saying "зураг". The trigger is now the
 * first cell of the same grid the photographs sit in — the shape says "add one
 * of these" without a sentence — and selecting is a toggle, so clicking the
 * chosen photograph again clears it and the separate ✕ is gone with it.
 *
 * ★★ There is no local preview tile either. The pane on the right of the
 * dialog already shows the chosen photograph at full size, and drawing it
 * twice on one screen was the clutter, not the clarity.
 *
 * ★★★ A freshly uploaded photograph appears in this grid on its own.
 *
 * `PhotoUpload` invalidates `["child", id, "media"]` on success, which is a
 * structural prefix of this query's key, and the upload is tagged
 * `category=FAMILY` with the same `age` this grid asks for. So it comes back
 * in the listing, already selected — no optimistic insert, and nothing to keep
 * in sync.
 */
export function MemoryPhotoPicker({
  childId,
  age,
  selectedMediaId,
  onSelect,
  onLoaded,
}: {
  childId: string;
  age: PortfolioAge;
  selectedMediaId: string | null;
  /** Toggles: the same photograph twice means "no photograph". */
  onSelect: (media: Media) => void;
  /** Hands the caller the facets it needs to decide whether a photo wants filing. */
  onLoaded?: (items: Media[]) => void;
}) {
  const [allAges, setAllAges] = useState(false);

  const archive = useQuery({
    queryKey: qk.childMedia(childId, { archive: true, pageSize: 40, ...(allAges ? {} : { age }) }),
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: "40" });
      if (!allAges) params.set("age", String(age));
      return get(`/children/${childId}/media?${params}`, mediaListSchema);
    },
  });

  const items = archive.data?.items ?? [];

  /*
    ★ An effect, not a line inside `queryFn`.

    `queryFn` runs on a fetch and not on a cache hit, so reopening the dialog
    inside the cache window handed the caller nothing — and the caller uses
    these facets to decide whether a photograph still needs filing. The second
    time round it would have decided "unknown, leave it", which looks exactly
    like a photo that was already tagged.
  */
  useEffect(() => {
    if (items.length > 0) onLoaded?.(items);
  }, [items, onLoaded]);

  return (
    <section aria-labelledby="memory-photo-heading" className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <h4
          id="memory-photo-heading"
          className="flex items-center gap-2 text-body font-semibold text-ink"
        >
          <Images size={17} aria-hidden="true" className="text-primary" />
          Зураг
        </h4>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={allAges}
          onClick={() => setAllAges((current) => !current)}
        >
          {allAges ? `${age} нас` : "Бүх нас"}
        </Button>
      </div>

      <div className="mt-2 flex items-start gap-2">
        <div className="w-[84px] shrink-0">
          <PhotoUpload
            childId={childId}
            purpose="CHILD_PHOTO"
            category="FAMILY"
            age={age}
            multiple={false}
            trigger="tile"
            label="Зураг нэмэх"
            hint={null}
            onUploaded={(uploadedId) =>
              onSelect({ id: uploadedId, age, category: "FAMILY", caption: null, takenAt: null })
            }
          />
        </div>

        {archive.isLoading ? (
          <p className="py-6 text-caption text-muted">Ачаалж байна…</p>
        ) : items.length === 0 ? (
          <p className="min-w-0 flex-1 self-center text-caption leading-relaxed text-muted">
            {allAges
              ? "Хадгалсан зураг алга. Зүүн талын товчоор эхний зургаа нэмээрэй."
              : `${age} насны зураг алга. «Бүх нас» дарж бусад жилийн зургаас сонгоно уу.`}
          </p>
        ) : (
          <ul className="grid min-w-0 flex-1 grid-cols-3 gap-2 sm:grid-cols-5">
            {items.map((photo) => {
              const active = photo.id === selectedMediaId;
              return (
                <li key={photo.id} className="min-w-0">
                  <button
                    type="button"
                    aria-pressed={active}
                    aria-label={`${photo.caption || "Тэмдэглэлгүй зураг"} — дурсамжид сонгох`}
                    onClick={() => onSelect(photo)}
                    className={cn(
                      "relative block w-full overflow-hidden rounded-control border-2 transition-colors",
                      active ? "border-primary" : "border-transparent hover:border-faint",
                    )}
                  >
                    <MediaThumb mediaId={photo.id} caption={photo.caption} flush />
                    {active ? (
                      <span
                        aria-hidden="true"
                        className="absolute bottom-1 right-1 grid size-5 place-items-center rounded-pill bg-primary text-primary-ink"
                      >
                        <Check size={12} />
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

// ── The preview ──────────────────────────────────────────────────────────────

/**
 * The large card on the right: exactly what is being written, as it is written.
 *
 * ★ A plain `<img>`, not `next/image` — `mediaUrl` 302s to a presigned URL that
 * expires in five minutes, so there is nothing for the optimiser to cache and
 * it must not try. Same reasoning as `MediaThumb`'s own note.
 */
export function MemoryPreview({
  memory,
  age,
  saved,
  onEdit,
  onDelete,
  confirming = false,
  onConfirmDelete,
  onCancelDelete,
}: {
  memory: MemoryDraft | FamilyMemory | null;
  age: PortfolioAge;
  /** A stored memory offers edit and delete; a draft in progress does not. */
  saved?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Confirmed in place — CLAUDE.md §5 asks for a confirmation, not a dialog on a dialog. */
  confirming?: boolean;
  onConfirmDelete?: () => void;
  onCancelDelete?: () => void;
}) {
  const title = memory?.title.trim();
  const description = (memory?.description ?? "").trim();
  const members = memory?.members ?? [];
  const mediaId = memory?.mediaId ?? null;

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-sunken p-3">
      {mediaId ? (
        <img
          src={mediaUrl(mediaId)}
          alt={title || "Гэр бүлийн дурсамжийн зураг"}
          className="max-h-[280px] w-full rounded-row object-cover"
        />
      ) : (
        <p className="flex min-h-[160px] items-center justify-center rounded-row border border-dashed border-border bg-surface px-4 text-center text-caption text-muted">
          Зураг сонгоход энд харагдана.
        </p>
      )}

      <div className="flex flex-col gap-2 rounded-row bg-surface p-3">
        <div className="flex items-start justify-between gap-2">
          <h4 className="min-w-0 flex-1 text-body font-semibold leading-snug text-ink">
            {title || <span className="font-normal text-muted">Дурсамжийн гарчиг</span>}
          </h4>

          {saved ? (
            <span className="flex shrink-0 items-center gap-1">
              {/*
                ★ Named for the *pane*, not for the memory in it.

                `MemoryList` already labels a row's own buttons with the
                memory's title, and this card is a second view of one of those
                rows — so deriving the label from the title too gave two
                buttons one accessible name, and a screen reader user tabbing
                the dialog heard "Ааваараа дугуй унасан засах" twice with no
                way to tell which was which.
              */}
              {onEdit ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label="Харж байгаа дурсамжийг засах"
                  onClick={onEdit}
                >
                  <Pencil aria-hidden="true" />
                </Button>
              ) : null}
              {onDelete ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label="Харж байгаа дурсамжийг устгах"
                  onClick={onDelete}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              ) : null}
            </span>
          ) : null}
        </div>

        <p className="flex items-center gap-1.5 text-caption text-muted">
          <CalendarDays size={14} aria-hidden="true" />
          {memory?.date ? formatDate(memory.date) : `${age} нас — огноо тэмдэглээгүй`}
        </p>

        <MemberChips members={members} />

        <p className="whitespace-pre-wrap text-body leading-relaxed text-ink">
          {description || <span className="text-muted">Дурсамжийн тайлбар энд харагдана.</span>}
        </p>

        {confirming ? (
          <span className="flex flex-wrap items-center gap-2 rounded-row bg-danger-soft px-2.5 py-2">
            <span className="text-caption text-ink">Энэ дурсамжийг устгах уу?</span>
            <Button type="button" variant="danger" size="sm" onClick={onConfirmDelete}>
              Тийм
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onCancelDelete}>
              Үгүй
            </Button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ── The stored list ──────────────────────────────────────────────────────────

/**
 * Every memory saved for this age.
 *
 * `onEdit`/`onDelete` are optional so the same list draws the card's read-only
 * detail view — a guardian reading their child's record sees the memories, and
 * the edit affordances belong to the form.
 */
export function MemoryList({
  memories,
  activeId,
  onSelect,
  onEdit,
  onDelete,
  confirmingId = null,
  onConfirmDelete,
  onCancelDelete,
  emptyText = "Дурсамж нэмээгүй байна.",
}: {
  memories: FamilyMemory[];
  activeId?: string | null;
  onSelect?: (memory: FamilyMemory) => void;
  onEdit?: (memory: FamilyMemory) => void;
  onDelete?: (memory: FamilyMemory) => void;
  /** The row asking "устгах уу?" — one at a time, confirmed in place. */
  confirmingId?: string | null;
  onConfirmDelete?: (memory: FamilyMemory) => void;
  onCancelDelete?: () => void;
  emptyText?: string;
}) {
  if (memories.length === 0) {
    return (
      <p className="rounded-row border border-border bg-sunken px-3 py-4 text-caption text-muted">
        {emptyText}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {memories.map((memory) => (
        <li key={memory.id} className="min-w-0">
          <div
            className={cn(
              "flex items-center gap-3 rounded-row border bg-surface p-2.5 transition-colors",
              memory.id === activeId ? "border-primary bg-primary-soft" : "border-border",
            )}
          >
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(memory)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <MemoryRowBody memory={memory} />
                <span className="sr-only">— урьдчилан харах</span>
              </button>
            ) : (
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <MemoryRowBody memory={memory} />
              </span>
            )}

            {memory.id === confirmingId ? (
              <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                <span className="text-caption text-muted">Устгах уу?</span>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => onConfirmDelete?.(memory)}
                >
                  Тийм
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={onCancelDelete}>
                  Үгүй
                </Button>
              </span>
            ) : onEdit || onDelete ? (
              <span className="flex shrink-0 items-center gap-1">
                {onEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${memory.title} засах`}
                    onClick={() => onEdit(memory)}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                ) : null}
                {onDelete ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${memory.title} устгах`}
                    onClick={() => onDelete(memory)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : null}
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function MemoryRowBody({ memory }: { memory: FamilyMemory }) {
  return (
    <>
      {memory.mediaId ? (
        <MediaThumb
          mediaId={memory.mediaId}
          caption={memory.title}
          className="size-12 shrink-0 rounded-control"
        />
      ) : (
        <span
          aria-hidden="true"
          className="grid size-12 shrink-0 place-items-center rounded-control bg-peach text-peach-ink"
        >
          <HeartHandshake size={18} />
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-semibold text-ink">{memory.title}</span>
        <span className="mt-0.5 block truncate text-caption text-muted">
          {[memory.date ? formatDate(memory.date) : null, memory.members.join(", ") || null]
            .filter(Boolean)
            .join(" · ") || "Огноо, гишүүн тэмдэглээгүй"}
        </span>
      </span>
    </>
  );
}

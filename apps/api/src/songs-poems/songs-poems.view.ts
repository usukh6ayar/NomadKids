import type { SongPoem, SongPoemLibrary, SongPoemMonth } from "@kinder/contracts";
import type { SongPoemRow } from "./songs-poems.repository";

const TYPE_TO_WIRE = {
  SONG: "song",
  POEM: "poem",
  FOLKLORE: "folklore",
  FAIRY_TALE: "fairy_tale",
} as const;

export const TYPE_FROM_WIRE = {
  song: "SONG",
  poem: "POEM",
  folklore: "FOLKLORE",
  fairy_tale: "FAIRY_TALE",
} as const;

/** API paths, never bucket URLs (CLAUDE.md §1.4); the web adds the origin. */
export function songPoemView(row: SongPoemRow): SongPoem {
  return {
    id: row.id,
    month: row.month as SongPoem["month"],
    type: TYPE_TO_WIRE[row.type],
    title: row.title,
    description: row.description,
    coverUrl: row.coverKey ? `/songs-poems/${row.id}/cover` : null,
    coverFileName: row.coverKey ? row.coverName : null,
    fileUrl: row.fileKey ? `/songs-poems/${row.id}/file` : null,
    fileName: row.fileKey ? row.fileName : null,
    fileType: row.fileKey ? row.fileMimeType : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function libraryView(
  group: { id: string; name: string },
  months: { month: string; label: string; subtitle: string }[],
  items: SongPoemRow[],
): SongPoemLibrary {
  return {
    group: { id: group.id, name: group.name },
    months: months.map((m) => ({ ...m, month: m.month as SongPoemMonth["month"] })),
    items: items.map(songPoemView),
  };
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { songPoemLibrarySchema, songPoemSchema } from "@kinder/contracts";
import { z } from "zod";
import { get, mutate } from "@/lib/api/browser";
import { downloadUrl } from "@/lib/api/client";

export type SchoolMonthKey = "09" | "10" | "11" | "12" | "01" | "02" | "03" | "04" | "05";

export type SchoolMonth = {
  key: SchoolMonthKey;
  label: string;
  subtitle: string;
  cover: string;
  spine: string;
  ink: string;
};

export const SCHOOL_MONTHS: readonly SchoolMonth[] = [
  {
    key: "09",
    label: "9-р сар",
    subtitle: "Намрын эхлэл",
    cover: "from-amber-100 to-orange-100",
    spine: "bg-orange-300",
    ink: "text-orange-900",
  },
  {
    key: "10",
    label: "10-р сар",
    subtitle: "Алтан намар",
    cover: "from-rose-100 to-pink-100",
    spine: "bg-rose-300",
    ink: "text-rose-900",
  },
  {
    key: "11",
    label: "11-р сар",
    subtitle: "Өвлийн угтал",
    cover: "from-sky-100 to-cyan-100",
    spine: "bg-sky-300",
    ink: "text-sky-900",
  },
  {
    key: "12",
    label: "12-р сар",
    subtitle: "Шинэ жилийн аялгуу",
    cover: "from-indigo-100 to-violet-100",
    spine: "bg-indigo-300",
    ink: "text-indigo-900",
  },
  {
    key: "01",
    label: "1-р сар",
    subtitle: "Цасан үлгэр",
    cover: "from-blue-100 to-sky-100",
    spine: "bg-blue-300",
    ink: "text-blue-900",
  },
  {
    key: "02",
    label: "2-р сар",
    subtitle: "Нөхөрлөлийн сар",
    cover: "from-fuchsia-100 to-purple-100",
    spine: "bg-fuchsia-300",
    ink: "text-fuchsia-900",
  },
  {
    key: "03",
    label: "3-р сар",
    subtitle: "Хаврын мэнд",
    cover: "from-emerald-100 to-green-100",
    spine: "bg-emerald-300",
    ink: "text-emerald-900",
  },
  {
    key: "04",
    label: "4-р сар",
    subtitle: "Байгаль сэрлээ",
    cover: "from-lime-100 to-yellow-100",
    spine: "bg-lime-300",
    ink: "text-lime-900",
  },
  {
    key: "05",
    label: "5-р сар",
    subtitle: "Төгсөлтийн дурсамж",
    cover: "from-yellow-100 to-amber-100",
    spine: "bg-yellow-300",
    ink: "text-amber-900",
  },
] as const;

export type SongPoemType = "song" | "poem" | "folklore" | "fairy_tale";

/*
 * ★ A link to listen to — YouTube, Google Drive or any page (the user,
 * 2026-10-12). Read here before `@kinder/contracts` carries it, and sent with
 * the form; until the API keeps `linkUrl` it is dropped on save.
 */
const itemSchema = songPoemSchema.extend({ linkUrl: z.string().nullish() });
const librarySchema = songPoemLibrarySchema.extend({ items: z.array(itemSchema) });
type SongPoemItem = z.infer<typeof itemSchema>;

/** One item as the screens show it — files as full URLs, the date as «2026.10.11». */
export type SongPoemResource = {
  id: string;
  month: SchoolMonthKey;
  type: SongPoemType;
  title: string;
  description: string;
  linkUrl?: string;
  coverUrl?: string;
  coverFileName?: string;
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  updatedAt: string;
};

/** What the teacher's form sends: the text, and whichever files were chosen. */
export type SongPoemDraft = {
  month: SchoolMonthKey;
  type: SongPoemType;
  title: string;
  description: string;
  linkUrl?: string;
  cover: File | null;
  file: File | null;
};

/**
 * Whose library — a teacher's group, or the family's child (the server finds
 * the child's group from the enrollment).
 */
export type SongPoemSource = { group: string } | { child: string };

function basePath(source: SongPoemSource): string {
  return "group" in source
    ? `/groups/${source.group}/songs-poems`
    : `/children/${source.child}/songs-poems`;
}

/**
 * A cover or a file: the API answers its own path (`/songs-poems/:id/cover`),
 * which checks the reader and redirects to a five-minute presigned URL
 * (CLAUDE.md §1.4); the page needs the API origin in front of it.
 */
function apiUrl(path: string | null): string | undefined {
  return path ? downloadUrl(path) : undefined;
}

function toResource(item: SongPoemItem): SongPoemResource {
  return {
    id: item.id,
    month: item.month,
    type: item.type,
    title: item.title,
    description: item.description,
    linkUrl: item.linkUrl ?? undefined,
    coverUrl: apiUrl(item.coverUrl),
    coverFileName: item.coverFileName ?? undefined,
    fileUrl: apiUrl(item.fileUrl),
    fileName: item.fileName ?? undefined,
    fileType: item.fileType ?? undefined,
    updatedAt: item.updatedAt.slice(0, 10).replaceAll("-", "."),
  };
}

function toForm(draft: SongPoemDraft): FormData {
  const form = new FormData();
  form.set("month", draft.month);
  form.set("type", draft.type);
  form.set("title", draft.title);
  form.set("description", draft.description);
  if (draft.linkUrl) form.set("linkUrl", draft.linkUrl);
  if (draft.cover) form.set("cover", draft.cover);
  if (draft.file) form.set("file", draft.file);
  return form;
}

/**
 * The library, from the server: the nine month books (the group's own names
 * where the teacher changed them) and their items.
 *
 * ★ Since 2026-10-11 nothing is kept in the browser: what a teacher adds is in
 * the database and reaches every family of the group.
 */
export function useSongPoemLibrary(source: SongPoemSource | null) {
  const queryClient = useQueryClient();
  const path = source ? basePath(source) : null;
  const key = ["songs-poems", path] as const;

  const query = useQuery({
    queryKey: key,
    queryFn: () => get(path!, librarySchema),
    enabled: path !== null,
  });

  const overrides = new Map((query.data?.months ?? []).map((m) => [m.month, m]));
  const months: SchoolMonth[] = SCHOOL_MONTHS.map((month) => {
    const own = overrides.get(month.key);
    return own ? { ...month, label: own.label, subtitle: own.subtitle } : { ...month };
  });
  const resources = (query.data?.items ?? []).map(toResource);
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const groupPath = source && "group" in source ? basePath(source) : null;
  const actions = groupPath
    ? {
        saveMonth: async (
          month: SchoolMonthKey,
          values: Pick<SchoolMonth, "label" | "subtitle">,
        ) => {
          await mutate(`${groupPath}/months/${month}`, z.unknown(), {
            method: "PUT",
            body: values,
          });
          await refresh();
        },
        save: async (draft: SongPoemDraft, id?: string) => {
          await mutate(id ? `${groupPath}/${id}` : groupPath, songPoemSchema, {
            method: id ? "PUT" : "POST",
            body: toForm(draft),
          });
          await refresh();
        },
        remove: async (id: string) => {
          await mutate(`${groupPath}/${id}`, z.unknown(), { method: "DELETE" });
          await refresh();
        },
      }
    : null;

  return { months, resources, isLoading: query.isLoading, error: query.error, actions };
}

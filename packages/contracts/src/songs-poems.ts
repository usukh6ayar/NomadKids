import { z } from "zod";
import { uuidSchema } from "./ids";

/**
 * Дуу, шүлэг — a group's songs, poems, folklore and tales, a book per month of
 * the school year (#195, 2026-10-11). The group's teacher keeps it; the
 * group's families read it.
 *
 * ★ `coverUrl`/`fileUrl` are **API paths** (`/songs-poems/:id/cover`), never
 * bucket URLs: the route checks the reader and redirects to a five-minute
 * presigned URL (CLAUDE.md §1.4). The web puts the API origin in front.
 */

/** September to May — the months a book is kept for. */
export const SCHOOL_MONTH_KEYS = ["09", "10", "11", "12", "01", "02", "03", "04", "05"] as const;
export const schoolMonthKeySchema = z.enum(SCHOOL_MONTH_KEYS);
export type SchoolMonthKeyValue = z.infer<typeof schoolMonthKeySchema>;

export const SONG_POEM_TYPES = ["song", "poem", "folklore", "fairy_tale"] as const;
export const songPoemTypeSchema = z.enum(SONG_POEM_TYPES);

/** Items per month's book — a generous ceiling, so no list is unbounded (§3.4). */
export const SONG_POEMS_PER_MONTH_MAX = 50;

export const songPoemSchema = z.object({
  id: uuidSchema,
  month: schoolMonthKeySchema,
  type: songPoemTypeSchema,
  title: z.string(),
  description: z.string(),
  coverUrl: z.string().nullable(),
  coverFileName: z.string().nullable(),
  fileUrl: z.string().nullable(),
  fileName: z.string().nullable(),
  /** The attachment's real type, from its content — `audio/mpeg`, `application/pdf` … */
  fileType: z.string().nullable(),
  updatedAt: z.string(),
});
export type SongPoem = z.infer<typeof songPoemSchema>;

/** A month the group renamed; months not listed keep the web's defaults. */
export const songPoemMonthSchema = z.object({
  month: schoolMonthKeySchema,
  label: z.string(),
  subtitle: z.string(),
});
export type SongPoemMonth = z.infer<typeof songPoemMonthSchema>;

export const songPoemLibrarySchema = z.object({
  group: z.object({ id: uuidSchema, name: z.string() }),
  months: z.array(songPoemMonthSchema),
  items: z.array(songPoemSchema),
});
export type SongPoemLibrary = z.infer<typeof songPoemLibrarySchema>;

export const songPoemMonthInputSchema = z.object({
  label: z.string().trim().min(1).max(40),
  subtitle: z.string().trim().max(60).default(""),
});
export type SongPoemMonthInput = z.infer<typeof songPoemMonthInputSchema>;

/** The text parts of the multipart form; `cover` and `file` arrive beside them. */
export const songPoemFormSchema = z.object({
  month: schoolMonthKeySchema,
  type: songPoemTypeSchema,
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(""),
});
export type SongPoemForm = z.infer<typeof songPoemFormSchema>;

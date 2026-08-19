import { z } from "zod";

export const DEFAULT_PAGE_SIZE = 25;

/**
 * A hard ceiling, not a suggestion. Without it, `?pageSize=100000` turns any
 * list endpoint into a bulk export of a kindergarten's children.
 */
export const MAX_PAGE_SIZE = 100;

/**
 * Every list endpoint is paginated. No endpoint returns an unbounded set —
 * CLAUDE.md §3.4.
 *
 * Defined here rather than in the API so the web app's query hooks and the
 * backend's validation cannot drift apart.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Shape of every list response. Generic over the item schema so a caller writes
 * `paginated(childSummarySchema)` and gets both validation and the inferred
 * type.
 */
export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
    totalPages: z.number().int().min(0),
  });
}

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

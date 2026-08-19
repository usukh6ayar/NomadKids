import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type Paginated } from "@kinder/contracts";

/**
 * Pagination helpers shared by every list endpoint.
 *
 * Every list is paginated — CLAUDE.md §3.4. No endpoint returns an unbounded
 * set, because "all children in the kindergarten" is a bulk export waiting to
 * be discovered.
 */

export interface PageParams {
  page: number;
  pageSize: number;
}

export function toSkipTake(params: PageParams): { skip: number; take: number } {
  const pageSize = Math.min(Math.max(params.pageSize || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = Math.max(params.page || 1, 1);
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function paginate<T>(items: T[], total: number, params: PageParams): Paginated<T> {
  const { take } = toSkipTake(params);
  return {
    items,
    page: Math.max(params.page || 1, 1),
    pageSize: take,
    total,
    totalPages: Math.ceil(total / take),
  };
}

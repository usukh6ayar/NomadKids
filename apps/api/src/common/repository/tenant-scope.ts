/**
 * The tenant and soft-delete filters every repository query must carry.
 *
 * Django hid deleted rows behind a model manager and this project's predecessor
 * relied on that. Prisma has no equivalent, so the guarantee has to be
 * reconstructed by hand — and a guarantee reconstructed by hand at every call
 * site is a guarantee that will eventually be forgotten at one of them.
 *
 * The shape below makes the safe thing the short thing: a repository composes
 * `baseWhere()` and adds its own conditions, rather than assembling a `where`
 * clause from scratch and hoping it remembered.
 *
 * docs/ARCHITECTURE.md §4.1 · docs/SECURITY.md §8 · CLAUDE.md §2.2
 */

/**
 * The kindergartens an actor may see. Derived from the authenticated user's
 * active memberships — never from a request parameter, a body field, or a
 * session value. CLAUDE.md §1.3.
 */
export interface TenantScope {
  readonly kindergartenIds: readonly string[];
}

/** A Prisma `where` fragment. Deliberately loose: it is spread into a query. */
export type WhereFragment = Record<string, unknown>;

/**
 * The filter every tenant-scoped query starts from.
 *
 * An empty scope produces `kindergartenId: { in: [] }`, which matches nothing.
 * That is the correct outcome: a user with no memberships sees nothing. It must
 * never be optimised into "no filter", which would show them everything.
 */
export function baseWhere(scope: TenantScope): WhereFragment {
  return {
    deletedAt: null,
    kindergartenId: { in: [...scope.kindergartenIds] },
  };
}

/**
 * For tables that carry `deletedAt` but no `kindergartenId` — the handful of
 * platform-level tables such as `User`.
 */
export function baseWhereUnscoped(): WhereFragment {
  return { deletedAt: null };
}

/**
 * Combines the base filter with a repository's own conditions.
 *
 * Conditions are nested under `AND` rather than merged at the top level, so a
 * caller passing `{ deletedAt: { not: null } }` cannot overwrite the
 * soft-delete filter — the two become contradictory conditions that match
 * nothing, instead of a silently disabled guard.
 */
export function scopedWhere(scope: TenantScope, conditions: WhereFragment = {}): WhereFragment {
  return { AND: [baseWhere(scope), conditions] };
}

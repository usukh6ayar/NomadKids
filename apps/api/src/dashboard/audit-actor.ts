/**
 * Who performed an audited action, as a name.
 *
 * ★ `AuditLog.actorLabel` is written by two call sites out of a hundred and ten.
 *
 * The column exists and is documented — "stored as plain text so a deleted
 * user's actions stay attributable" — but only `auth.service` ever fills it, on
 * `LOGIN` and `LOGIN_FAILED`. Every other `audit.append()` passes `actorUserId`
 * and leaves the label null, which is correct: making a hundred and eight call
 * sites carry a display name would be a second source of truth for something
 * the `User` row already holds, and filling it inside `append()` would put a
 * user lookup on the write path of every audited request.
 *
 * So the name is resolved on **read** instead, from the `actor` relation the
 * schema already declares and the `actorUserId` index already serves. One
 * `include` on a query that is already paginated — no second round trip, and
 * nothing per row (CLAUDE.md §3.4).
 *
 * ★★ The live user wins over the stored label, and the stored label is the
 * fallback rather than the other way round.
 *
 * The two orderings differ only for a renamed account, where the live row is
 * the better answer — the log records who acted, and that person is the same
 * person under their new name. The stored label then covers exactly the case it
 * was written for: `actorUserId` is `SetNull` on delete, so a hard-deleted user
 * leaves the relation empty and the plain text is all that remains.
 *
 * Both are null for an unauthenticated action (a failed login against an
 * unknown identifier), and the caller renders that as "—".
 */

/** The shape both audit queries select — the relation, narrowed to a name. */
export interface AuditActorRow {
  actorLabel: string | null;
  actor: { lastName: string; firstName: string } | null;
}

/** What to select for `actor` on an audit query. Named so the two queries cannot drift. */
export const AUDIT_ACTOR_SELECT = { select: { lastName: true, firstName: true } } as const;

export function resolveActorLabel(row: AuditActorRow): string | null {
  if (row.actor) return `${row.actor.lastName} ${row.actor.firstName}`;
  return row.actorLabel ?? null;
}

/**
 * Replaces the joined `actor` with a resolved `actorLabel`.
 *
 * ★ The relation is dropped rather than passed through.
 *
 * It was fetched to compute a label, and a response that also carried the raw
 * user object would be widening what the audit endpoint discloses as a side
 * effect of a display change — the next field added to that `select` for some
 * other reason would ship to the browser without anyone deciding to.
 */
export function withActorLabel<T extends AuditActorRow>(row: T): Omit<T, "actor"> {
  const { actor: _actor, ...rest } = row;
  return { ...rest, actorLabel: resolveActorLabel(row) };
}

import { SetMetadata } from "@nestjs/common";

export const ALLOW_LAPSED = "allowLapsed";

/**
 * Gives a route the staff memberships of kindergartens whose paid service has
 * lapsed — `Actor.lapsedMemberships` (the user, 2026-10-27).
 *
 * ★ Only for paying for the service itself: «Үйлчилгээний эрх», its contract,
 * invoice and QR. Everywhere else a lapsed kindergarten's staff are not staff,
 * and this marker on a route that serves kindergarten data would undo the
 * gate. Roles are still checked as usual on the widened set.
 */
export const AllowLapsed = () => SetMetadata(ALLOW_LAPSED, true);

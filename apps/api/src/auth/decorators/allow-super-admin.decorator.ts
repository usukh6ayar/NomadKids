import { SetMetadata } from "@nestjs/common";

export const ALLOW_SUPER_ADMIN = "allowSuperAdmin";

/**
 * Lets a platform operator through a `@Roles(...)` gate.
 *
 * ★ **Opt-in, one route at a time, and that is the whole design.**
 *
 * `RolesGuard` reads roles from `Membership`, so a superadmin who belongs to no
 * kindergarten holds none and is refused. That is correct almost everywhere: a
 * platform operator has no business in one kindergarten's register, and if they
 * need to be there they can be given a membership, which leaves a record.
 *
 * It is wrong for the handful of routes that ask a question about the
 * *deployment* rather than about a kindergarten — "are the fonts installed",
 * "can Chromium start". Gating those on membership of some kindergarten is a
 * category error, and it bites hardest before any kindergarten exists, which is
 * exactly when the answer is needed (`docs/VPS_DEPLOYMENT.md` §3.7).
 *
 * Adding this to a route that serves kindergarten data would be a real
 * widening. Adding it to one that serves none is not.
 */
export const AllowSuperAdmin = () => SetMetadata(ALLOW_SUPER_ADMIN, true);

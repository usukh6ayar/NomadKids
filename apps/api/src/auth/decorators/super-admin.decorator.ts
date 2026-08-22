import { SetMetadata } from "@nestjs/common";

export const REQUIRE_SUPER_ADMIN = "requireSuperAdmin";

/**
 * Requires a platform operator.
 *
 * ★ A coarse gate, like `@Roles(...)`. The service still calls
 * `PlatformAccessService.assertSuperAdmin` — a decorator is a filter in front
 * of the decision, never the decision. docs/SECURITY.md §4.
 */
export const SuperAdmin = () => SetMetadata(REQUIRE_SUPER_ADMIN, true);

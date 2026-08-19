import { SetMetadata } from "@nestjs/common";
import type { Role } from "../../domain/enums";

export const REQUIRED_ROLES = "requiredRoles";

/**
 * Requires the actor to hold at least one of these roles, in any kindergarten.
 *
 * ★ This is a coarse gate, not an authorization decision. It keeps a parent off
 * the teacher dashboard; it does NOT establish which children anyone may see.
 * Every child-scoped endpoint must still call ChildAccessService — a role alone
 * is never sufficient. docs/SECURITY.md §4.
 */
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

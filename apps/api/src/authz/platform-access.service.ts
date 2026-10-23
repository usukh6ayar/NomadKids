import { Injectable, NotFoundException } from "@nestjs/common";
import type { Actor } from "./actor";

/**
 * Authorization for platform-level resources — registering a kindergarten,
 * which by definition has no tenant to be scoped by.
 *
 * ★ This is the ONLY thing `isSuperAdmin` grants. It deliberately does not
 * appear in `TenantAccessService` or `ChildAccessService`: a platform operator
 * registers kindergartens, they do not read children. Keeping the flag out of
 * those two services is what makes that structural rather than a promise —
 * test/platform.test.ts asserts a superadmin still gets 404 on a child, its
 * portfolio, its observations and its guardians.
 *
 * 404, never 403 — docs/SECURITY.md §5.4 · CLAUDE.md §1.7.
 */
@Injectable()
export class PlatformAccessService {
  assertSuperAdmin(actor: Actor): void {
    if (!actor.isSuperAdmin) throw new NotFoundException();
  }

  /**
   * «Үндсэн баримт бичиг» — the platform-wide register (№7, 2026-10-23):
   * the operator, and the staff of any kindergarten — every role but
   * PARENT. A family's shell has no shelf of ministry rules; 404 otherwise.
   */
  assertCanReadOfficialDocuments(actor: Actor): void {
    if (actor.isSuperAdmin) return;
    if (actor.memberships.some((m) => m.role !== "PARENT")) return;
    throw new NotFoundException();
  }
}

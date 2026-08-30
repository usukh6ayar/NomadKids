import { Injectable } from "@nestjs/common";
import { ChildAccessService } from "../authz/child-access.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { paginate, toSkipTake, type PageParams } from "../common/pagination";
import { DashboardRepository } from "./dashboard.repository";
import { withActorLabel } from "./audit-actor";
import type { AuditAction } from "../domain/enums";

/**
 * Reading the audit log.
 *
 * ★ Read only, and admin only. The log answers "who accessed this child's
 * record" — RFP §971 — which is itself sensitive: it lists which staff opened
 * which children's files and when.
 *
 * Scoped to the admin's own kindergartens, and a `childId` filter is checked
 * against child access first, so the filter cannot be used to confirm that a
 * child exists elsewhere.
 */
@Injectable()
export class AuditReadService {
  constructor(
    private readonly repo: DashboardRepository,
    private readonly tenants: TenantAccessService,
    private readonly childAccess: ChildAccessService,
  ) {}

  async list(
    actor: Actor,
    query: PageParams & {
      childId?: string;
      actorUserId?: string;
      action?: AuditAction;
      from?: Date;
      to?: Date;
    },
  ) {
    const kindergartenIds = this.tenants.adminKindergartenIds(actor);

    // Filtering by child requires being able to reach that child. Without this
    // the filter answers "does child X exist in a kindergarten I administer"
    // for any id an attacker cares to try.
    if (query.childId) {
      await this.childAccess.assertCanAccess(actor, query.childId);
    }

    const page: PageParams = { page: query.page, pageSize: query.pageSize };
    const { items, total } = await this.repo.listAudit(
      kindergartenIds,
      {
        childId: query.childId,
        actorUserId: query.actorUserId,
        action: query.action,
        from: query.from,
        to: query.to,
      },
      toSkipTake(page),
    );

    // `withActorLabel` resolves the name and drops the joined relation — see
    // `audit-actor.ts` for why the label is read rather than stored.
    return paginate(items.map(withActorLabel), total, page);
  }
}

import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { FeedbackInboxQuery, FeedbackReply, NewFeedback } from "@kinder/contracts";
import { AuditRepository } from "../audit/audit.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { paginate, toSkipTake, type PageParams } from "../common/pagination";
import { FeedbackRepository, type FeedbackRow } from "./feedback.repository";
import { toFeedbackView } from "./feedback.view";

/**
 * Санал хүсэлт — a family writes to the administration, the administration
 * acknowledges and replies.
 *
 * ★ No teacher route, by design. A family will not complain about a teacher
 * that teacher can read.
 *
 * ★★ Anonymous means anonymous **to the administration**. The server keeps the
 * author so the family can follow their item and the daily limit has a
 * sender; the admin's copy, the inbox's group filter and the audit trail all
 * leave the family out.
 */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly repo: FeedbackRepository,
    private readonly childAccess: ChildAccessService,
    private readonly tenants: TenantAccessService,
    private readonly audit: AuditRepository,
  ) {}

  // ── The family's side ─────────────────────────────────────────────────────

  async listOwn(actor: Actor, page: PageParams) {
    const { items, total } = await this.repo.listForAuthor(actor.userId, toSkipTake(page));
    return paginate(
      items.map((row) => toFeedbackView(row, "author")),
      total,
      page,
    );
  }

  /**
   * ★ The kindergarten and the group come from the child's enrollment, never
   * from the request (CLAUDE.md §1.2). Only the child's own guardian may write,
   * and an unpaid portal fee answers 402 here as it does on every other page.
   */
  async create(actor: Actor, dto: NewFeedback) {
    await this.childAccess.assertIsGuardian(actor, dto.childId);
    const placement = await this.repo.resolvePlacement(dto.childId);
    if (!placement) throw new NotFoundException();

    const row = await this.repo.create({
      kindergartenId: placement.kindergartenId,
      childId: dto.childId,
      authorUserId: actor.userId,
      groupId: placement.groupId,
      category: dto.category,
      body: dto.body,
      anonymous: dto.anonymous,
      // Stated by the family, so it says who they are. Never kept when anonymous.
      relation: dto.anonymous ? null : (dto.relation ?? null),
    });

    return toFeedbackView(row, "author");
  }

  /** Takes it off the family's list. The administration still has it. */
  async removeOwn(actor: Actor, id: string) {
    const row = await this.repo.findForAuthor(id, actor.userId);
    if (!row) throw new NotFoundException();

    await this.repo.removeForAuthor(id, new Date());
    await this.audit.append({
      action: "DELETE",
      kindergartenId: row.kindergartenId,
      // ★ An anonymous item's removal must not name its sender either.
      actorUserId: row.anonymous ? null : actor.userId,
      actorLabel: row.anonymous ? "anonymous" : null,
      objectType: "Feedback",
      objectId: id,
      childId: row.anonymous ? null : row.childId,
      metadata: { side: "author" },
    });
  }

  // ── The administration's side ─────────────────────────────────────────────

  async inbox(actor: Actor, kindergartenId: string, query: FeedbackInboxQuery) {
    this.tenants.assertAdmin(actor, kindergartenId);

    const page = { page: query.page, pageSize: query.pageSize };
    const { items, total } = await this.repo.listForKindergarten(
      kindergartenId,
      { status: query.status, category: query.category, groupId: query.groupId },
      toSkipTake(page),
    );
    return paginate(
      items.map((row) => toFeedbackView(row, "admin")),
      total,
      page,
    );
  }

  /** NEW → ACKNOWLEDGED. Again is not an error: it returns where it is now. */
  async acknowledge(actor: Actor, kindergartenId: string, id: string) {
    this.tenants.assertAdmin(actor, kindergartenId);
    const before = await this.inInbox(id, kindergartenId);

    const moved = await this.repo.acknowledge(id, kindergartenId, actor.userId, new Date());
    if (moved) {
      await this.auditAdmin(actor, before, "UPDATE", {
        before: { status: before.status },
        after: { status: "ACKNOWLEDGED" },
      });
    }

    return toFeedbackView(await this.inInbox(id, kindergartenId), "admin");
  }

  /**
   * The formal reply. 409 on an anonymous item — there is nobody to answer —
   * and 409 on one already answered, because a reply is a statement on the
   * record and is not silently replaced.
   */
  async reply(actor: Actor, kindergartenId: string, id: string, dto: FeedbackReply) {
    this.tenants.assertAdmin(actor, kindergartenId);
    const before = await this.inInbox(id, kindergartenId);

    if (before.anonymous) {
      throw new ConflictException("Нэргүй саналд хариу өгөх боломжгүй.");
    }
    const moved = await this.repo.reply(id, kindergartenId, actor.userId, dto.body, new Date());
    if (!moved) throw new ConflictException("Энэ саналд аль хэдийн хариу өгсөн байна.");

    await this.auditAdmin(actor, before, "UPDATE", {
      before: { status: before.status },
      after: { status: "ANSWERED", replyBody: dto.body },
    });

    return toFeedbackView(await this.inInbox(id, kindergartenId), "admin");
  }

  /** Takes it out of the inbox. The family keeps it, and the reply. */
  async removeFromInbox(actor: Actor, kindergartenId: string, id: string) {
    this.tenants.assertAdmin(actor, kindergartenId);
    const row = await this.inInbox(id, kindergartenId);

    await this.repo.removeFromInbox(id, new Date());
    await this.auditAdmin(actor, row, "DELETE", { side: "admin" });
  }

  private async inInbox(id: string, kindergartenId: string): Promise<FeedbackRow> {
    const row = await this.repo.findInInbox(id, kindergartenId);
    if (!row) throw new NotFoundException();
    return row;
  }

  private async auditAdmin(
    actor: Actor,
    row: FeedbackRow,
    action: "UPDATE" | "DELETE",
    metadata: Record<string, unknown>,
  ) {
    await this.audit.append({
      action,
      kindergartenId: row.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Feedback",
      objectId: row.id,
      // The administration's own audit trail must not undo the redaction.
      childId: row.anonymous ? null : row.childId,
      metadata,
    });
  }
}

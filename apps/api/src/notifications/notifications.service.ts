import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { TenantAccessService } from "../authz/tenant-access.service";
import { Role } from "../domain/enums";
import type { Actor } from "../authz/actor";
import { paginate, type PageParams } from "../common/pagination";
import { NotificationsRepository } from "./notifications.repository";
import type {
  CreateNotificationDto,
  ListNotificationsQuery,
  UpdateNotificationDto,
} from "./notifications.dto";

/**
 * Announcements — REST only, no realtime (D: MVP decision, ARCHITECTURE.md §7).
 *
 * The unread count is polled while the tab is visible. At this product's
 * cadence — a teacher posts a handful of notices a day — that is
 * indistinguishable from realtime to the user, and it removes a stateful
 * connection layer and a second auth path.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly repo: NotificationsRepository,
    private readonly tenants: TenantAccessService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Chooses the audience filter for this actor.
   *
   * ★ A user who is *only* a parent gets the guardian filter — derived from
   * their children, never from their memberships. Staff get the kindergarten
   * filter. Someone who is both sees the union, which is correct: a teacher
   * whose own child attends should see the notice sent to that child's group
   * as well as the ones sent to their kindergarten.
   */
  private async audienceFilter(actor: Actor, now = new Date()) {
    const staffKindergartens = [
      ...new Set(
        actor.memberships
          .filter((m) => m.role === Role.TEACHER || m.role === Role.ADMIN)
          .map((m) => m.kindergartenId),
      ),
    ];

    const isGuardianSomewhere = actor.memberships.some((m) => m.role === Role.PARENT);

    const filters: Record<string, unknown>[] = [];

    if (staffKindergartens.length > 0) {
      filters.push(this.repo.staffWhere(staffKindergartens, actor.userId));
    }

    if (isGuardianSomewhere) {
      const scope = await this.repo.loadGuardianScope(actor.userId);
      // A guardian with no reachable children matches nothing — `in: []`. That
      // is the correct answer and must never be optimised into "no filter".
      filters.push(this.repo.guardianWhere(scope, now));
    }

    if (filters.length === 0) return { id: "__none__" };
    return filters.length === 1 ? filters[0]! : { OR: filters };
  }

  async list(actor: Actor, query: ListNotificationsQuery) {
    const where = await this.audienceFilter(actor);
    const page: PageParams = { page: query.page, pageSize: query.pageSize };

    const { items, total } = await this.repo.list(
      where as Record<string, unknown>,
      actor.userId,
      page,
      query.unread === true,
    );

    return paginate(
      items.map((n) => ({ ...n, isRead: n.reads.length > 0, reads: undefined })),
      total,
      page,
    );
  }

  /** Polled at 60 s while the tab is visible — the no-realtime decision. */
  async unreadCount(actor: Actor) {
    const where = await this.audienceFilter(actor);
    const count = await this.repo.countUnread(where as Record<string, unknown>, actor.userId);
    return { count };
  }

  async get(actor: Actor, id: string) {
    const where = await this.audienceFilter(actor);
    const notification = await this.repo.findReadable(
      id,
      where as Record<string, unknown>,
      actor.userId,
    );
    // 404 for a draft somebody else is writing, or a notice for another family.
    if (!notification) throw new NotFoundException();

    return { ...notification, isRead: notification.reads.length > 0, reads: undefined };
  }

  /**
   * Creates a DRAFT.
   *
   * Publishing is a separate act, so a half-written notice cannot reach two
   * hundred families because someone hit save.
   */
  async create(actor: Actor, kindergartenId: string, dto: CreateNotificationDto) {
    this.tenants.assertStaff(actor, kindergartenId);
    await this.assertTargetsBelong(dto.targets, kindergartenId);

    const notification = await this.repo.create(
      {
        kindergartenId,
        title: dto.title,
        body: dto.body,
        isImportant: dto.isImportant,
        startsOn: dto.startsOn ?? null,
        endsOn: dto.endsOn ?? null,
        authorId: actor.userId,
      },
      dto.targets,
    );

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "Notification",
      objectId: notification.id,
      metadata: { targetCount: dto.targets.length },
    });

    return notification;
  }

  async update(actor: Actor, id: string, dto: UpdateNotificationDto) {
    const row = await this.requireStaffOwned(actor, id);

    if (dto.targets) await this.assertTargetsBelong(dto.targets, row.kindergartenId);

    const { targets, ...rest } = dto;
    const updated = await this.repo.update(id, definedOnly(rest), targets);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: row.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Notification",
      objectId: id,
    });

    return updated;
  }

  async publish(actor: Actor, id: string) {
    const row = await this.requireStaffOwned(actor, id);
    if (row.status === "PUBLISHED") {
      throw new BadRequestException("Энэ мэдэгдэл аль хэдийн нийтлэгдсэн байна");
    }

    const published = await this.repo.publish(id);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: row.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Notification",
      objectId: id,
      metadata: { published: true },
    });

    return published;
  }

  async archive(actor: Actor, id: string) {
    const row = await this.requireStaffOwned(actor, id);
    const archived = await this.repo.softDelete(id);

    await this.audit.append({
      action: "DELETE",
      kindergartenId: row.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Notification",
      objectId: id,
    });

    return { id: archived.id };
  }

  /**
   * Marks as read.
   *
   * Goes through the audience filter first: marking a notice read must not be a
   * way to confirm that one exists.
   */
  async markRead(actor: Actor, id: string) {
    const where = await this.audienceFilter(actor);
    const notification = await this.repo.findReadable(
      id,
      where as Record<string, unknown>,
      actor.userId,
    );
    if (!notification) throw new NotFoundException();

    await this.repo.markRead(id, actor.userId);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Staff in the notice's kindergarten. Any of them may edit; §8.1 is a shared queue. */
  private async requireStaffOwned(actor: Actor, id: string) {
    const row = await this.repo.findForAuthorization(id);
    if (!row) throw new NotFoundException();
    this.tenants.assertStaff(actor, row.kindergartenId);
    return row;
  }

  /**
   * Every target must belong to this kindergarten.
   *
   * ★ Without this an author could aim a notice at another kindergarten's group
   * by id. The targeting rows would then match that kindergarten's families —
   * the guardian filter checks the notice's kindergarten, but a target pointing
   * outside it is still a mistake worth refusing at the source.
   */
  private async assertTargetsBelong(
    targets: { groupId?: string; childId?: string }[],
    kindergartenId: string,
  ) {
    const groupIds = targets.map((t) => t.groupId).filter((v): v is string => Boolean(v));
    const childIds = targets.map((t) => t.childId).filter((v): v is string => Boolean(v));

    if (groupIds.length > 0) {
      const found = await this.repo.findGroupsInKindergarten(groupIds, kindergartenId);
      if (found !== new Set(groupIds).size) throw new BadRequestException("Бүлэг олдсонгүй");
    }

    if (childIds.length > 0) {
      const found = await this.repo.findChildrenInKindergarten(childIds, kindergartenId);
      if (found !== new Set(childIds).size) throw new BadRequestException("Хүүхэд олдсонгүй");
    }
  }
}

function definedOnly(dto: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined));
}

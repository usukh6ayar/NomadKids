import { Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import type { FeedbackCategory, FeedbackRelation, FeedbackStatus } from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Санал хүсэлт — a family's feedback and the administration's reply.
 *
 * ★ Two base filters, one per side, and neither replaces the other. The
 * family's list is scoped by `authorUserId` and `authorDeletedAt`; the inbox by
 * `kindergartenId` and `adminDeletedAt`. Every read and every write below
 * starts from one of them, so a removal on one side never reaches the other.
 */
@Injectable()
export class FeedbackRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Everything either side's copy is built from, in one query per page.
   *
   * ★ The teacher is the group's lead **as of reading**, not as of sending:
   * the spec asks for the group's teacher, and a group whose lead changed is
   * answered by the new one. Exactly one, oldest assignment first, so two
   * leads cannot make the name flicker between reads.
   */
  private readonly detail = {
    author: { select: { firstName: true, lastName: true, phone: true } },
    child: { select: { firstName: true } },
    group: {
      select: {
        id: true,
        name: true,
        teachers: {
          where: {
            role: "LEAD" as const,
            endedOn: null,
            deletedAt: null,
            membership: { deletedAt: null, isActive: true },
          },
          orderBy: [{ startedOn: "asc" as const }, { createdAt: "asc" as const }],
          take: 1,
          select: {
            membership: { select: { user: { select: { firstName: true, lastName: true } } } },
          },
        },
      },
    },
  } satisfies Prisma.FeedbackInclude;

  private authorScope(authorUserId: string): Prisma.FeedbackWhereInput {
    return { authorUserId, authorDeletedAt: null };
  }

  private inboxScope(kindergartenId: string): Prisma.FeedbackWhereInput {
    return { kindergartenId, adminDeletedAt: null };
  }

  /**
   * Where the child is now, for stamping onto a new item (CLAUDE.md §1.2).
   *
   * The current enrollment gives both the kindergarten and the group. A child
   * whose enrollments have all ended still belongs to the kindergarten of the
   * latest one, with no group. Only a child with no enrollment at all falls
   * back to `Child.kindergartenId` — the one exception §1.2 allows.
   */
  async resolvePlacement(
    childId: string,
  ): Promise<{ kindergartenId: string; groupId: string | null } | null> {
    const child = await this.prisma.child.findFirst({
      where: { id: childId, deletedAt: null },
      select: {
        kindergartenId: true,
        enrollments: {
          where: { deletedAt: null },
          orderBy: [{ startedOn: "desc" }, { createdAt: "desc" }],
          select: { kindergartenId: true, groupId: true, status: true, endedOn: true },
        },
      },
    });
    if (!child) return null;

    const current = child.enrollments.find((e) => e.status === "ACTIVE" && e.endedOn === null);
    if (current) return { kindergartenId: current.kindergartenId, groupId: current.groupId };

    const latest = child.enrollments[0];
    if (latest) return { kindergartenId: latest.kindergartenId, groupId: null };

    return { kindergartenId: child.kindergartenId, groupId: null };
  }

  async create(data: {
    kindergartenId: string;
    childId: string;
    authorUserId: string;
    groupId: string | null;
    category: FeedbackCategory;
    body: string;
    anonymous: boolean;
    relation: FeedbackRelation | null;
  }) {
    return this.prisma.feedback.create({ data, include: this.detail });
  }

  /** A family's own items, newest first. */
  async listForAuthor(authorUserId: string, page: { skip: number; take: number }) {
    const where = this.authorScope(authorUserId);
    const [items, total] = await Promise.all([
      this.prisma.feedback.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: page.skip,
        take: page.take,
        include: this.detail,
      }),
      this.prisma.feedback.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * The administration's inbox, newest first.
   *
   * ★ A group filter never returns an anonymous item. If it did, the item's
   * appearing under "Нарлаг бүлэг" would tell the director which group its
   * family is in — the redaction in the response would be undone by the query.
   */
  async listForKindergarten(
    kindergartenId: string,
    filters: { status?: FeedbackStatus; category?: FeedbackCategory; groupId?: string },
    page: { skip: number; take: number },
  ) {
    const where: Prisma.FeedbackWhereInput = {
      ...this.inboxScope(kindergartenId),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.groupId ? { groupId: filters.groupId, anonymous: false } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.feedback.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: page.skip,
        take: page.take,
        include: this.detail,
      }),
      this.prisma.feedback.count({ where }),
    ]);
    return { items, total };
  }

  async findForAuthor(id: string, authorUserId: string) {
    return this.prisma.feedback.findFirst({
      where: { id, ...this.authorScope(authorUserId) },
      include: this.detail,
    });
  }

  async findInInbox(id: string, kindergartenId: string) {
    return this.prisma.feedback.findFirst({
      where: { id, ...this.inboxScope(kindergartenId) },
      include: this.detail,
    });
  }

  /**
   * NEW → ACKNOWLEDGED. Conditional on the state, so two directors clicking at
   * once cannot move an answered item backwards. Returns whether it moved.
   */
  async acknowledge(id: string, kindergartenId: string, actorUserId: string, at: Date) {
    const { count } = await this.prisma.feedback.updateMany({
      where: { id, ...this.inboxScope(kindergartenId), status: "NEW" },
      data: { status: "ACKNOWLEDGED", acknowledgedAt: at, acknowledgedById: actorUserId },
    });
    return count === 1;
  }

  /**
   * → ANSWERED, from NEW or ACKNOWLEDGED, and never on an anonymous item.
   * Replying to a NEW item acknowledges it in the same write. Returns whether
   * it moved; the caller explains why not.
   */
  async reply(id: string, kindergartenId: string, actorUserId: string, body: string, at: Date) {
    const where = {
      id,
      ...this.inboxScope(kindergartenId),
      anonymous: false,
      status: { in: ["NEW", "ACKNOWLEDGED"] as FeedbackStatus[] },
    };
    return this.prisma.$transaction(async (tx) => {
      await tx.feedback.updateMany({
        where: { ...where, acknowledgedAt: null },
        data: { acknowledgedAt: at, acknowledgedById: actorUserId },
      });
      const { count } = await tx.feedback.updateMany({
        where,
        data: { status: "ANSWERED", replyBody: body, repliedAt: at, repliedById: actorUserId },
      });
      return count === 1;
    });
  }

  async removeForAuthor(id: string, at: Date) {
    await this.prisma.feedback.update({ where: { id }, data: { authorDeletedAt: at } });
  }

  async removeFromInbox(id: string, at: Date) {
    await this.prisma.feedback.update({ where: { id }, data: { adminDeletedAt: at } });
  }
}

export type FeedbackRow = NonNullable<Awaited<ReturnType<FeedbackRepository["findInInbox"]>>>;

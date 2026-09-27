import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { Prisma } from "../../generated/prisma/client";

/**
 * The only file that reaches Prisma for ESIS write requests.
 *
 * ★ A new repository rather than more methods on `EsisRepository`, and the
 * reason is the base filter rather than file size. Reference rows are
 * hard-replaced and may be national (`kindergartenId` NULL); a write request is
 * tenant-scoped and soft-deleted. Two different base filters living in one
 * repository is how a forgotten one becomes a cross-tenant leak — CLAUDE.md
 * §2.2 is about exactly that, and it is easier to keep them apart than to
 * remember which methods extend which.
 */
@Injectable()
export class EsisWriteRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The base filter every tenant read below extends and none replaces. */
  private scope(kindergartenId: string) {
    return { kindergartenId, deletedAt: null };
  }

  create(input: {
    kindergartenId: string;
    service: string;
    apiId: number;
    groupId: string;
    payload: Prisma.InputJsonValue;
    idempotencyKey: string;
    preparedById: string;
  }) {
    return this.prisma.esisWriteRequest.create({ data: input });
  }

  findByIdempotencyKey(kindergartenId: string, idempotencyKey: string) {
    return this.prisma.esisWriteRequest.findFirst({
      where: { ...this.scope(kindergartenId), idempotencyKey },
    });
  }

  findOne(kindergartenId: string, id: string) {
    return this.prisma.esisWriteRequest.findFirst({
      where: { ...this.scope(kindergartenId), id },
    });
  }

  /**
   * The row as the worker reads it, by id alone.
   *
   * ★ Unscoped by tenant on purpose, and it is the one method here that is. A
   * job carries an id, not an actor — the authorization happened at approve
   * time, inside the request that created the job. Threading a
   * `kindergartenId` through Redis and trusting it on the way back would be
   * worse than this: the row's own `kindergartenId` is the authority, and it is
   * what every write below keys off.
   */
  findForWorker(id: string) {
    return this.prisma.esisWriteRequest.findFirst({ where: { id, deletedAt: null } });
  }

  approve(id: string, approvedById: string) {
    return this.prisma.esisWriteRequest.update({
      where: { id },
      data: { state: "APPROVED", approvedById, approvedAt: new Date() },
    });
  }

  cancel(id: string) {
    return this.prisma.esisWriteRequest.update({
      where: { id },
      data: { state: "CANCELLED" },
    });
  }

  markSent(id: string, response: Prisma.InputJsonValue) {
    return this.prisma.esisWriteRequest.update({
      where: { id },
      data: { state: "SENT", sentAt: new Date(), response, errorCode: null },
    });
  }

  markFailed(id: string, errorCode: string) {
    return this.prisma.esisWriteRequest.update({
      where: { id },
      data: { state: "FAILED", failedAt: new Date(), errorCode },
    });
  }

  /**
   * The create whose answer a delete needs — spec №3б §5.
   *
   * ★ `SENT` only. A prepared or approved create has not been to the ministry,
   * so there is no group there to remove, and treating one as proof would let a
   * delete be prepared against a group ESIS has never heard of.
   */
  findSentCreate(kindergartenId: string, groupId: string) {
    return this.prisma.esisWriteRequest.findFirst({
      where: { ...this.scope(kindergartenId), groupId, service: "groupCreate", state: "SENT" },
      orderBy: { sentAt: "desc" },
    });
  }

  /**
   * Stamps the ministry's own group id onto our `Group`.
   *
   * ★ The second repository in this codebase that writes `Group`, and the one
   * exception to this file's own note above — so it says why rather than being
   * discovered later. It runs **inside the worker**, where there is no actor
   * and no tenant to scope by: the `groupId` comes from an `EsisWriteRequest`
   * row that a tenant-scoped read produced at prepare time and that nothing can
   * edit afterwards, so the id has already been proved to belong to the
   * kindergarten whose director approved the write.
   *
   * ★★ It sets one column that only this flow ever writes. If a second caller
   * ever needs it, move it to the groups repository rather than copying it —
   * two places stamping one external id is how they come to disagree.
   */
  setGroupEsisId(groupId: string, esisGroupId: string) {
    return this.prisma.group.update({ where: { id: groupId }, data: { esisGroupId } });
  }

  /** Newest first, paginated — no endpoint returns an unbounded set (§3.4). */
  async list(kindergartenId: string, page: { skip: number; take: number }) {
    const [items, total] = await Promise.all([
      this.prisma.esisWriteRequest.findMany({
        where: this.scope(kindergartenId),
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
        include: {
          group: { select: { id: true, name: true } },
          preparedBy: { select: { lastName: true, firstName: true } },
          approvedBy: { select: { lastName: true, firstName: true } },
        },
      }),
      this.prisma.esisWriteRequest.count({ where: this.scope(kindergartenId) }),
    ]);
    return { items, total };
  }
}

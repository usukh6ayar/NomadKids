import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { AuditAction } from "../generated/prisma/enums";

/**
 * The audit log.
 *
 * ★ Exposes `append()` and reads. There is deliberately no update and no
 * delete — a record that can be edited is not an audit record, and the
 * cheapest way to guarantee that is to never write the method.
 *
 * docs/SECURITY.md §12.
 */
@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async append(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        kindergartenId: entry.kindergartenId ?? null,
        actorUserId: entry.actorUserId ?? null,
        actorRole: entry.actorRole ?? null,
        // Stored as plain text so a deleted user's actions stay attributable.
        actorLabel: entry.actorLabel ?? null,
        action: entry.action,
        objectType: entry.objectType ?? null,
        objectId: entry.objectId ?? null,
        childId: entry.childId ?? null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        metadata: (entry.metadata ?? {}) as object,
      },
    });
  }

  /**
   * "Who has accessed this child's record" — one indexed query, which is the
   * whole reason `childId` is denormalised onto the log.
   */
  async listForChild(childId: string, take = 50) {
    return this.prisma.auditLog.findMany({
      where: { childId },
      orderBy: { createdAt: "desc" },
      take,
    });
  }

  async listForKindergarten(kindergartenId: string, params: { skip: number; take: number }) {
    return this.prisma.auditLog.findMany({
      where: { kindergartenId },
      orderBy: { createdAt: "desc" },
      skip: params.skip,
      take: params.take,
    });
  }

  async countForKindergarten(kindergartenId: string): Promise<number> {
    return this.prisma.auditLog.count({ where: { kindergartenId } });
  }
}

export interface AuditEntry {
  action: AuditAction;
  kindergartenId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  actorLabel?: string | null;
  objectType?: string | null;
  objectId?: string | null;
  childId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { AuditAction } from "../generated/prisma/enums";
import { AUDIT_ACTOR_SELECT } from "../dashboard/audit-actor";

/**
 * The financial slice of `AuditLog.objectType` — нэмэлт.md §13's "Санхүүгийн
 * audit log", one of exactly seven things the role must reach.
 *
 * ★ A filter, not a second table. §14's ten financial action types
 * (tariff changed, invoice created, payment recorded, ...) are already
 * `CREATE`/`UPDATE`/`DELETE` rows against these object types — the same table
 * `/admin/audit` reads, narrowed to what an accountant is allowed to see.
 */
export const FINANCIAL_OBJECT_TYPES = [
  "FundingRule",
  "FundingCalculation",
  "Invoice",
  "InvoiceLineItem",
  "Payment",
] as const;

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

  /** нэмэлт.md §13's "Санхүүгийн audit log" — this kindergarten's financial slice only. */
  async listFinancial(kindergartenId: string, params: { skip: number; take: number }) {
    return this.prisma.auditLog.findMany({
      where: { kindergartenId, objectType: { in: [...FINANCIAL_OBJECT_TYPES] } },
      orderBy: { createdAt: "desc" },
      skip: params.skip,
      take: params.take,
      include: { actor: AUDIT_ACTOR_SELECT },
    });
  }

  async countFinancial(kindergartenId: string): Promise<number> {
    return this.prisma.auditLog.count({
      where: { kindergartenId, objectType: { in: [...FINANCIAL_OBJECT_TYPES] } },
    });
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

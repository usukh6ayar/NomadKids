import { Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import { toSkipTake, type PageParams } from "../common/pagination";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Persistence for the platform-wide register (№7).
 *
 * ★ The base filter is `deletedAt: null` and nothing else: this is the one
 * table with no tenant scope to add (CLAUDE.md §3.1's exception, the user
 * 2026-10-23) — the same register for every kindergarten, no child in it.
 */
const LIVE = { deletedAt: null } as const;

@Injectable()
export class OfficialDocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** «Онцлох» first, then the register's order — its code, a new entry last. */
  async list(page: PageParams) {
    const [items, total] = await Promise.all([
      this.prisma.officialDocument.findMany({
        where: LIVE,
        orderBy: [
          { featured: "desc" },
          { code: { sort: "asc", nulls: "last" } },
          { createdAt: "asc" },
        ],
        ...toSkipTake(page),
      }),
      this.prisma.officialDocument.count({ where: LIVE }),
    ]);
    return { items, total };
  }

  findLive(id: string) {
    return this.prisma.officialDocument.findFirst({ where: { id, ...LIVE } });
  }

  create(data: Prisma.OfficialDocumentUncheckedCreateInput) {
    return this.prisma.officialDocument.create({ data });
  }

  update(id: string, data: Prisma.OfficialDocumentUncheckedUpdateInput) {
    return this.prisma.officialDocument.update({ where: { id }, data });
  }

  /** Soft delete, never a row removed (§3.2). `false` when it was already gone. */
  async softDelete(id: string, at: Date): Promise<boolean> {
    const result = await this.prisma.officialDocument.updateMany({
      where: { id, ...LIVE },
      data: { deletedAt: at },
    });
    return result.count > 0;
  }
}

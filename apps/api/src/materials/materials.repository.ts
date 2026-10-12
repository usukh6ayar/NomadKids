import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type {
  MaterialFileType,
  MaterialLevel,
  MaterialPreviewStatus,
} from "../generated/prisma/enums";

/**
 * The teaching-materials catalog and its purchases (client, 2026-10-09).
 *
 * ★ Platform-owned, so there is no tenant scope here — the scope is the
 * **shop's**: published and not deleted. Every shop read carries that base
 * filter. The one deliberate exception is what a teacher **owns**
 * (`listOwned`, `findOwned`): a material taken off the shop stays with whoever
 * bought it, so those two read past `deletedAt` and `published` — and only
 * through a PAID purchase of that very user.
 */

/** §3.4 — no unbounded list. Far above any real catalog or library. */
const CATALOG_MAX = 500;

const ON_SALE = { published: true, deletedAt: null } as const;

const PREVIEWS = {
  where: { deletedAt: null },
  orderBy: { order: "asc" },
  select: { order: true },
} as const;

const MATERIAL_SELECT = {
  id: true,
  title: true,
  description: true,
  area: true,
  level: true,
  fileType: true,
  price: true,
  contents: true,
  pages: true,
  published: true,
  previewStatus: true,
  originalName: true,
  previews: PREVIEWS,
} as const;

export interface MaterialData {
  title: string;
  description: string | null;
  area: string;
  level: MaterialLevel | null;
  price: number;
  contents: string[];
  published: boolean;
  /** MANUAL for the operator's own pictures, PENDING while the server draws them. */
  previewStatus: MaterialPreviewStatus;
}

export interface MaterialFileData {
  fileType: MaterialFileType;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface PreviewData {
  storageKey: string;
  mimeType: string;
}

@Injectable()
export class MaterialsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listShop(params: {
    q?: string;
    area?: string;
    level?: MaterialLevel;
    skip: number;
    take: number;
  }) {
    const where = {
      ...ON_SALE,
      ...(params.area ? { area: params.area } : {}),
      ...(params.level ? { level: params.level } : {}),
      ...(params.q ? { title: { contains: params.q, mode: "insensitive" as const } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.teachingMaterial.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: params.skip,
        take: params.take,
        select: MATERIAL_SELECT,
      }),
      this.prisma.teachingMaterial.count({ where }),
    ]);
    return { items, total };
  }

  /** Which of these materials this user has paid for — one query for a page. */
  async ownedIds(userId: string, materialIds: string[]): Promise<Set<string>> {
    if (materialIds.length === 0) return new Set();
    const rows = await this.prisma.materialPurchase.findMany({
      where: { userId, status: "PAID", materialId: { in: materialIds } },
      select: { materialId: true },
    });
    return new Set(rows.map((r) => r.materialId));
  }

  /** Everything this user owns — on sale or not, deleted or not. */
  async listOwned(userId: string) {
    const rows = await this.prisma.materialPurchase.findMany({
      where: { userId, status: "PAID" },
      orderBy: { paidAt: "desc" },
      take: CATALOG_MAX,
      select: { material: { select: MATERIAL_SELECT } },
    });
    return rows.map((r) => r.material);
  }

  findOnSale(id: string) {
    return this.prisma.teachingMaterial.findFirst({
      where: { id, ...ON_SALE },
      select: MATERIAL_SELECT,
    });
  }

  /** A material this user has paid for, past `deletedAt` and `published`, with its file. */
  async findOwned(id: string, userId: string) {
    const purchase = await this.prisma.materialPurchase.findFirst({
      where: { materialId: id, userId, status: "PAID" },
      select: {
        material: {
          select: { id: true, title: true, storageKey: true, mimeType: true },
        },
      },
    });
    return purchase?.material ?? null;
  }

  findPurchase(materialId: string, userId: string) {
    return this.prisma.materialPurchase.findUnique({
      where: { materialId_userId: { materialId, userId } },
      select: { id: true, status: true, amount: true, paidAt: true },
    });
  }

  /**
   * The user's purchase of this material, created on demand; while unpaid its
   * amount follows the material's current price.
   */
  ensurePurchase(materialId: string, userId: string, amount: number) {
    return this.prisma.materialPurchase.upsert({
      where: { materialId_userId: { materialId, userId } },
      create: { materialId, userId, amount },
      update: {},
      select: { id: true, status: true, amount: true, paidAt: true },
    });
  }

  async setUnpaidAmount(purchaseId: string, amount: number): Promise<void> {
    await this.prisma.materialPurchase.updateMany({
      where: { id: purchaseId, status: "UNPAID" },
      data: { amount },
    });
  }

  /** UNPAID → PAID for a free material, once. */
  async markFree(purchaseId: string, paidAt: Date): Promise<boolean> {
    const result = await this.prisma.materialPurchase.updateMany({
      where: { id: purchaseId, status: "UNPAID" },
      data: { status: "PAID", paidAt, amount: 0 },
    });
    return result.count > 0;
  }

  /** The n-th live sample page of a material, and whether it is on sale. */
  findPreview(materialId: string, order: number) {
    return this.prisma.teachingMaterialPreview.findFirst({
      where: { materialId, order, deletedAt: null },
      select: {
        storageKey: true,
        mimeType: true,
        material: { select: { published: true, deletedAt: true } },
      },
    });
  }

  async isOwnedBy(materialId: string, userId: string): Promise<boolean> {
    const row = await this.prisma.materialPurchase.findFirst({
      where: { materialId, userId, status: "PAID" },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * The system learning-area names — a material belongs to no kindergarten,
   * so only the rows every kindergarten inherits (CLAUDE.md §2.3).
   */
  async systemAreaNames(): Promise<Set<string>> {
    const rows = await this.prisma.developmentDomain.findMany({
      where: { kindergartenId: null, deletedAt: null, isActive: true },
      select: { name: true },
    });
    return new Set(rows.map((r) => r.name));
  }

  // ── The operator's catalog ──────────────────────────────────────────────

  async listAll() {
    const items = await this.prisma.teachingMaterial.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: CATALOG_MAX,
      select: MATERIAL_SELECT,
    });
    const sales = await this.salesFor(items.map((i) => i.id));
    return { items, sales };
  }

  findLive(id: string) {
    return this.prisma.teachingMaterial.findFirst({
      where: { id, deletedAt: null },
      select: { ...MATERIAL_SELECT, storageKey: true },
    });
  }

  /** PAID purchases per material — one grouped query, never one per row. */
  async salesFor(materialIds: string[]): Promise<Map<string, number>> {
    if (materialIds.length === 0) return new Map();
    const rows = await this.prisma.materialPurchase.groupBy({
      by: ["materialId"],
      where: { materialId: { in: materialIds }, status: "PAID" },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.materialId, r._count._all]));
  }

  create(data: MaterialData & MaterialFileData, previews: PreviewData[], createdById: string) {
    return this.prisma.teachingMaterial.create({
      data: {
        ...data,
        createdById,
        previews: { create: previews.map((p, order) => ({ ...p, order })) },
      },
      select: { id: true },
    });
  }

  /**
   * Updates the fields; replaces the file and the sample pages **only when
   * new ones were sent**. Returns the storage keys that are no longer used,
   * for the caller to remove once this has committed.
   */
  async update(
    id: string,
    data: MaterialData,
    file: MaterialFileData | null,
    previews: PreviewData[] | null,
  ): Promise<string[]> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.teachingMaterial.findUniqueOrThrow({
        where: { id },
        select: {
          storageKey: true,
          previews: { where: { deletedAt: null }, select: { id: true, storageKey: true } },
        },
      });
      await tx.teachingMaterial.update({ where: { id }, data: { ...data, ...(file ?? {}) } });

      const unused: string[] = [];
      if (file) unused.push(before.storageKey);
      if (previews) {
        await tx.teachingMaterialPreview.updateMany({
          where: { materialId: id, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        await tx.teachingMaterialPreview.createMany({
          data: previews.map((p, order) => ({ ...p, order, materialId: id })),
        });
        unused.push(...before.previews.map((p) => p.storageKey));
      }
      return unused;
    });
  }

  /** Back to PENDING for «дахин үүсгэх»; the file the job will draw. */
  async markPreviewsPending(id: string): Promise<{ storageKey: string }> {
    return this.prisma.teachingMaterial.update({
      where: { id },
      data: { previewStatus: "PENDING" },
      select: { storageKey: true },
    });
  }

  /** The material a sample-page job was asked for — if it still wants one, on that file. */
  findPendingRender(id: string, storageKey: string) {
    return this.prisma.teachingMaterial.findFirst({
      where: { id, storageKey, previewStatus: "PENDING" },
      select: { storageKey: true, mimeType: true },
    });
  }

  /**
   * Swaps in the pages a job drew — **only if the material is still PENDING on
   * the file the job drew**, checked by the same statement that marks it
   * READY, so an operator's edit committed meanwhile wins. `null` when it was
   * not current (the caller removes what it stored); otherwise the storage
   * keys of the pages replaced, for removal after the commit.
   */
  async savePreviewsIfCurrent(
    id: string,
    storageKey: string,
    previews: PreviewData[],
  ): Promise<string[] | null> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.teachingMaterial.updateMany({
        where: { id, storageKey, previewStatus: "PENDING" },
        data: { previewStatus: "READY" },
      });
      if (count === 0) return null;

      const before = await tx.teachingMaterialPreview.findMany({
        where: { materialId: id, deletedAt: null },
        select: { storageKey: true },
      });
      await tx.teachingMaterialPreview.updateMany({
        where: { materialId: id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await tx.teachingMaterialPreview.createMany({
        data: previews.map((p, order) => ({ ...p, order, materialId: id })),
      });
      return before.map((p) => p.storageKey);
    });
  }

  /** FAILED, under the same "still current" condition as a save. */
  async failPreviewsIfCurrent(id: string, storageKey: string): Promise<void> {
    await this.prisma.teachingMaterial.updateMany({
      where: { id, storageKey, previewStatus: "PENDING" },
      data: { previewStatus: "FAILED" },
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.teachingMaterial.update({
      where: { id },
      data: { deletedAt: new Date(), published: false },
    });
  }
}

export type MaterialRow = NonNullable<Awaited<ReturnType<MaterialsRepository["findOnSale"]>>>;

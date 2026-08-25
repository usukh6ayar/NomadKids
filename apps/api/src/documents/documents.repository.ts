import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { toSkipTake, type PageParams } from "../common/pagination";

/**
 * The document library — RFP §9.
 *
 * Kindergarten-scoped reference material, not child data: the tenant filter is
 * the whole of the isolation here, which is why every method takes a
 * `kindergartenId` and none takes an actor.
 */
@Injectable()
export class DocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The library, filtered and paginated.
   *
   * ★ `bookmarks` is loaded for the **reading user only**.
   *
   * A bookmark is per-reader (RFP §9's "Bookmark хийсэн эсэх"), so including
   * every colleague's rows would both leak who is reading what and make the
   * flag meaningless. `some` with the user's id turns it into a boolean the
   * service can flatten.
   */
  async list(
    kindergartenId: string,
    userId: string,
    filters: { q?: string; category?: string; bookmarkedOnly?: boolean },
    page: PageParams,
  ) {
    const { skip, take } = toSkipTake(page);

    const where = {
      kindergartenId,
      deletedAt: null,
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.q
        ? {
            OR: [
              { title: { contains: filters.q, mode: "insensitive" as const } },
              { description: { contains: filters.q, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(filters.bookmarkedOnly ? { bookmarks: { some: { userId } } } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        orderBy: { publishedAt: "desc" },
        skip,
        take,
        include: {
          publishedBy: { select: { id: true, lastName: true, firstName: true } },
          bookmarks: { where: { userId }, select: { id: true } },
        },
      }),
      this.prisma.document.count({ where }),
    ]);

    return { items, total };
  }

  /** The distinct categories in use — what the filter chips are built from. */
  async listCategories(kindergartenId: string) {
    const rows = await this.prisma.document.findMany({
      where: { kindergartenId, deletedAt: null, category: { not: null } },
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    });
    return rows.map((r) => r.category).filter((c): c is string => c !== null);
  }

  async findById(id: string) {
    return this.prisma.document.findFirst({
      where: { id, deletedAt: null },
      include: {
        publishedBy: { select: { id: true, lastName: true, firstName: true } },
      },
    });
  }

  async create(data: Record<string, unknown>) {
    return this.prisma.document.create({
      data: data as never,
      include: { publishedBy: { select: { id: true, lastName: true, firstName: true } } },
    });
  }

  async update(id: string, data: Record<string, unknown>) {
    return this.prisma.document.update({
      where: { id },
      data,
      include: { publishedBy: { select: { id: true, lastName: true, firstName: true } } },
    });
  }

  async softDelete(id: string) {
    return this.prisma.document.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /**
   * Replaces the stored file — RFP §9's "Баримт шинэ хувилбараар солих".
   *
   * The previous MediaFile is soft-deleted in the same transaction, because
   * `fileMediaFileId` is `@unique`: leaving the old row live would both orphan
   * its bytes and stop the new one claiming the column.
   */
  async replaceFile(id: string, newMediaFileId: string, version: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.document.findUniqueOrThrow({
        where: { id },
        select: { fileMediaFileId: true },
      });

      await tx.mediaFile.update({
        where: { id: current.fileMediaFileId },
        data: { deletedAt: new Date() },
      });

      return tx.document.update({
        where: { id },
        data: {
          fileMediaFileId: newMediaFileId,
          ...(version === null ? {} : { version }),
          publishedAt: new Date(),
        },
        include: { publishedBy: { select: { id: true, lastName: true, firstName: true } } },
      });
    });
  }

  /** Idempotent: bookmarking twice is one bookmark, not an error. */
  async addBookmark(kindergartenId: string, documentId: string, userId: string) {
    return this.prisma.documentBookmark.upsert({
      where: { documentId_userId: { documentId, userId } },
      create: { kindergartenId, documentId, userId },
      update: {},
    });
  }

  async removeBookmark(documentId: string, userId: string) {
    return this.prisma.documentBookmark.deleteMany({ where: { documentId, userId } });
  }
}

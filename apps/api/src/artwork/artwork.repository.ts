import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Artwork comparisons — RFP §5.3.
 *
 * The images themselves live in `MediaFile` and are read through the gallery;
 * this repository owns only the pairing and the conclusion.
 */
@Injectable()
export class ArtworkRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly mediaShape = {
    select: {
      id: true,
      caption: true,
      takenAt: true,
      uploadedAt: true,
      originalName: true,
    },
  };

  private readonly detail = {
    earlierMedia: this.mediaShape,
    laterMedia: this.mediaShape,
    author: { select: { id: true, lastName: true, firstName: true } },
  };

  /**
   * The child's artwork in time order — RFP §5.3's "хугацааны дарааллаар".
   *
   * ★ Ordered by `takenAt` with `uploadedAt` as the fallback, ascending.
   *
   * This is the one list in the product where *when the work was made* is the
   * only sensible order: a development sequence read in upload order tells you
   * about the teacher's filing, not about the child. The gallery's own order
   * leads with the hand-arranged `order` column, which is right there and wrong
   * here.
   *
   * `nulls: "last"` keeps photographs uploaded before `takenAt` existed at the
   * end rather than pretending they are the oldest.
   */
  async listArtwork(childId: string) {
    return this.prisma.mediaFile.findMany({
      where: {
        childId,
        deletedAt: null,
        status: "READY",
        category: "ARTWORK",
      },
      orderBy: [{ takenAt: { sort: "asc", nulls: "last" } }, { uploadedAt: "asc" }],
      select: {
        id: true,
        caption: true,
        takenAt: true,
        uploadedAt: true,
        originalName: true,
        observationId: true,
      },
    });
  }

  async listComparisons(childId: string) {
    return this.prisma.artworkComparison.findMany({
      where: { childId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: this.detail,
    });
  }

  /** The two photographs, checked to belong to this child before pairing. */
  async findMediaForComparison(childId: string, ids: string[]) {
    return this.prisma.mediaFile.findMany({
      where: { id: { in: ids }, childId, deletedAt: null, status: "READY" },
      select: { id: true, takenAt: true, uploadedAt: true, category: true },
    });
  }

  async create(data: Record<string, unknown>) {
    return this.prisma.artworkComparison.create({
      data: data as never,
      include: this.detail,
    });
  }

  async findById(id: string) {
    return this.prisma.artworkComparison.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, childId: true, kindergartenId: true },
    });
  }

  async update(id: string, data: Record<string, unknown>) {
    return this.prisma.artworkComparison.update({ where: { id }, data, include: this.detail });
  }

  async softDelete(id: string) {
    return this.prisma.artworkComparison.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

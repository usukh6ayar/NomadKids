import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { MediaPurpose } from "../domain/enums";

@Injectable()
export class MediaRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A media row for an authorization decision.
   *
   * Returns `childId` so the caller can run `canAccessChild` — the file is
   * reachable only through the child it belongs to, never on its own account.
   */
  async findForAuthorization(id: string) {
    return this.prisma.mediaFile.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        childId: true,
        kindergartenId: true,
        observationId: true,
        storageKey: true,
        originalName: true,
        mimeType: true,
        status: true,
        purpose: true,
      },
    });
  }

  async listForChild(childId: string, purpose?: MediaPurpose) {
    return this.prisma.mediaFile.findMany({
      where: {
        childId,
        deletedAt: null,
        status: "READY",
        ...(purpose ? { purpose } : {}),
      },
      orderBy: [{ order: "asc" }, { uploadedAt: "desc" }],
      select: {
        id: true,
        caption: true,
        originalName: true,
        mimeType: true,
        width: true,
        height: true,
        uploadedAt: true,
        observationId: true,
        purpose: true,
      },
    });
  }

  /**
   * Photos a guardian may see.
   *
   * ★ An observation photo inherits its observation's visibility. Without this
   * clause the gallery would show a family every picture attached to a private
   * teaching note — the note itself stays hidden while its images do not, which
   * is the more embarrassing half of the same leak.
   */
  async listVisibleForGuardian(childId: string, guardianUserId: string) {
    return this.prisma.mediaFile.findMany({
      where: {
        childId,
        deletedAt: null,
        status: "READY",
        OR: [
          // Profile photos and gallery images not tied to an observation.
          { observationId: null, purpose: "CHILD_PHOTO" },
          // Attached to an observation the guardian may read.
          {
            observation: {
              deletedAt: null,
              OR: [
                { visibleToParents: true, reviewStatus: "APPROVED" },
                { source: "PARENT", authorId: guardianUserId },
              ],
            },
          },
        ],
      },
      orderBy: [{ order: "asc" }, { uploadedAt: "desc" }],
      select: {
        id: true,
        caption: true,
        originalName: true,
        mimeType: true,
        width: true,
        height: true,
        uploadedAt: true,
        observationId: true,
        purpose: true,
      },
    });
  }

  async create(data: CreateMediaData) {
    return this.prisma.mediaFile.create({ data });
  }

  async archive(id: string) {
    return this.prisma.mediaFile.update({
      where: { id },
      data: { status: "ARCHIVED", deletedAt: new Date() },
    });
  }

  async setCaption(id: string, caption: string | null) {
    return this.prisma.mediaFile.update({ where: { id }, data: { caption } });
  }

  /** Sets a child's profile photo, replacing whatever was there. */
  async setChildPhoto(childId: string, mediaFileId: string) {
    return this.prisma.child.update({
      where: { id: childId },
      data: { photoMediaFileId: mediaFileId },
    });
  }

  async findObservationForAttachment(observationId: string) {
    return this.prisma.observation.findFirst({
      where: { id: observationId, deletedAt: null },
      select: { id: true, childId: true, kindergartenId: true },
    });
  }

  async countForObservation(observationId: string): Promise<number> {
    return this.prisma.mediaFile.count({
      where: { observationId, deletedAt: null },
    });
  }

  /**
   * Objects whose row is gone or long archived — the orphan sweep.
   *
   * Only rows archived more than the grace period ago, so a delete that is
   * still being undone is not collected.
   */
  async listArchivedBefore(cutoff: Date) {
    return this.prisma.mediaFile.findMany({
      where: { status: "ARCHIVED", deletedAt: { lt: cutoff } },
      select: { id: true, storageKey: true },
      take: 500,
    });
  }

  async hardDelete(ids: string[]) {
    await this.prisma.mediaFile.deleteMany({ where: { id: { in: ids } } });
  }
}

export interface CreateMediaData {
  kindergartenId: string;
  childId: string | null;
  observationId: string | null;
  purpose: MediaPurpose;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  caption: string | null;
  order: number;
}

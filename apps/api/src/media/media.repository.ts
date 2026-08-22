import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { toSkipTake, type PageParams } from "../common/pagination";
import type { WhereFragment } from "../common/repository/tenant-scope";
import type { MediaAttribution, MediaPurpose } from "../domain/enums";

/**
 * ★ Album order, and why it is not `takenAt` first.
 *
 * `order` is what a teacher arranged by hand (RFP §4.4, "зургийн дараалал
 * өөрчлөх") and what pins an observation's photos to the sequence they were
 * attached in. `takenAt` only exists on photographs uploaded since the field
 * did, so leading with it would scatter every older album behind the new ones.
 * Hand order first, then when the photograph was taken, then when it arrived.
 */
const GALLERY_ORDER = [
  { order: "asc" as const },
  { takenAt: { sort: "desc" as const, nulls: "last" as const } },
  { uploadedAt: "desc" as const },
];

const GALLERY_SELECT = {
  id: true,
  caption: true,
  originalName: true,
  mimeType: true,
  width: true,
  height: true,
  uploadedAt: true,
  observationId: true,
  purpose: true,
  takenAt: true,
  age: true,
  category: true,
  attribution: true,
  uploadedBy: { select: { id: true, lastName: true, firstName: true } },
} as const;

/** The facets `GET /children/:id/media` accepts. */
export interface MediaFilters {
  purpose?: MediaPurpose;
  observationId?: string;
  category?: string;
  age?: number;
}

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
        notificationId: true,
        storageKey: true,
        originalName: true,
        mimeType: true,
        status: true,
        purpose: true,
      },
    });
  }

  /**
   * The filters a gallery request may add on top of the visibility rules.
   *
   * `observationId` is not a nicety: `ObservationPhotos` renders the photos of
   * ONE observation, and before pagination it got there by fetching every
   * `OBSERVATION` photo of the child and filtering in the browser. Page one of
   * twenty-five may contain none of the ones it wants.
   */
  private facetWhere(filters: MediaFilters): WhereFragment {
    return {
      ...(filters.purpose ? { purpose: filters.purpose } : {}),
      ...(filters.observationId ? { observationId: filters.observationId } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.age === undefined ? {} : { age: filters.age }),
    };
  }

  /**
   * ★ The one definition of "photos of this child a guardian may see".
   *
   * An observation photo inherits its observation's visibility. Without this
   * clause the gallery would show a family every picture attached to a private
   * teaching note — the note stays hidden while its images do not, which is the
   * more embarrassing half of the same leak.
   *
   * It is a `where` fragment rather than a method because **two** callers need
   * it and they must never disagree: the paginated gallery, and the per-file
   * authorization check in `MediaService`. When those were one method returning
   * a list, the check worked by loading the whole set and searching it — which
   * paginating would have quietly turned into "a guardian 404s on photo 26 of
   * their own child".
   */
  private guardianVisibleWhere(childId: string, guardianUserId: string): WhereFragment {
    return {
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
    };
  }

  async listForChild(childId: string, filters: MediaFilters, page: PageParams) {
    const { skip, take } = toSkipTake(page);
    const where = {
      childId,
      deletedAt: null,
      status: "READY" as const,
      ...this.facetWhere(filters),
    };

    const [items, total] = await Promise.all([
      this.prisma.mediaFile.findMany({
        where,
        orderBy: GALLERY_ORDER,
        skip,
        take,
        select: GALLERY_SELECT,
      }),
      this.prisma.mediaFile.count({ where }),
    ]);

    return { items, total };
  }

  /** Photos a guardian may see, paginated. Same visibility rule as the check. */
  async listVisibleForGuardian(
    childId: string,
    guardianUserId: string,
    filters: MediaFilters,
    page: PageParams,
  ) {
    const { skip, take } = toSkipTake(page);
    const where = {
      ...this.guardianVisibleWhere(childId, guardianUserId),
      ...this.facetWhere(filters),
    };

    const [items, total] = await Promise.all([
      this.prisma.mediaFile.findMany({
        where,
        orderBy: GALLERY_ORDER,
        skip,
        take,
        select: GALLERY_SELECT,
      }),
      this.prisma.mediaFile.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Whether this one file is visible to this guardian.
   *
   * The authorization counterpart of the list above, composed from the same
   * predicate. One indexed row instead of loading the child's whole album to
   * search it in memory.
   */
  async isVisibleToGuardian(
    childId: string,
    mediaId: string,
    guardianUserId: string,
  ): Promise<boolean> {
    const found = await this.prisma.mediaFile.findFirst({
      where: { ...this.guardianVisibleWhere(childId, guardianUserId), id: mediaId },
      select: { id: true },
    });
    return found !== null;
  }

  async create(data: CreateMediaData) {
    return this.prisma.mediaFile.create({ data });
  }

  /** The notice a photo is being attached to. Only what authorization needs. */
  async findNotificationForAttachment(id: string) {
    return this.prisma.notification.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, kindergartenId: true },
    });
  }

  async countForNotification(notificationId: string): Promise<number> {
    return this.prisma.mediaFile.count({
      where: { notificationId, deletedAt: null, status: "READY" },
    });
  }

  async archive(id: string) {
    return this.prisma.mediaFile.update({
      where: { id },
      data: { status: "ARCHIVED", deletedAt: new Date() },
    });
  }

  /**
   * Caption and album metadata — RFP §4.4.
   *
   * `undefined` leaves a field alone; `null` clears it. Without that
   * distinction a request editing only the caption would erase the date the
   * photograph was taken.
   */
  async updateMetadata(id: string, data: MediaMetadataUpdate) {
    return this.prisma.mediaFile.update({
      where: { id },
      data: {
        ...(data.caption === undefined ? {} : { caption: data.caption }),
        ...(data.takenAt === undefined ? {} : { takenAt: data.takenAt }),
        ...(data.age === undefined ? {} : { age: data.age }),
        ...(data.category === undefined ? {} : { category: data.category }),
        ...(data.attribution === undefined ? {} : { attribution: data.attribution }),
      },
      select: GALLERY_SELECT,
    });
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
  /** Null for a class-board photo — a notice is addressed to a group. */
  childId?: string | null;
  observationId?: string | null;
  notificationId?: string | null;
  purpose: MediaPurpose;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  caption: string | null;
  order: number;
  /** Album metadata — RFP §4.4. All optional; see the schema comments. */
  uploadedById?: string | null;
  takenAt?: Date | null;
  age?: number | null;
  category?: string | null;
  attribution?: MediaAttribution | null;
}

export interface MediaMetadataUpdate {
  caption?: string | null;
  takenAt?: Date | null;
  age?: number | null;
  category?: string | null;
  attribution?: MediaAttribution | null;
}

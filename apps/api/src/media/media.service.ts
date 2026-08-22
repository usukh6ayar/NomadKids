import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import { NotificationsService } from "../notifications/notifications.service";
import { isGuardianOf } from "../authz/child-access";
import type { Actor } from "../authz/actor";
import { StorageService } from "../storage/storage.service";
import { MediaRepository } from "./media.repository";
import { sanitiseFilename, UploadRejected, validateImageUpload } from "./upload-validation";
import type { MediaPurpose } from "../domain/enums";

/** A generous ceiling; the UI shows far fewer per observation. */
const MAX_PHOTOS_PER_OBSERVATION = 12;
const MAX_PHOTOS_PER_NOTIFICATION = 12;

@Injectable()
export class MediaService {
  constructor(
    private readonly repo: MediaRepository,
    private readonly storage: StorageService,
    private readonly childAccess: ChildAccessService,
    private readonly tenants: TenantAccessService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Uploads a photo for a child.
   *
   * ★ Through the API, not a presigned PUT (D10). A presigned PUT hands the
   * client a URL it can write anything to, and content sniffing, size limits
   * and EXIF stripping cannot be enforced on the far side of it. The cost is
   * bandwidth through the API container, which at this volume is irrelevant.
   */
  async upload(
    actor: Actor,
    childId: string,
    file: { buffer: Buffer; originalname: string },
    options: { purpose?: MediaPurpose; observationId?: string; caption?: string | null } = {},
  ) {
    // Writing about a child needs record access; a guardian uploads through
    // their own observation, not straight into the gallery.
    const facts = await this.childAccess.assertCanRecord(actor, childId);

    let validated;
    try {
      validated = await validateImageUpload(file.buffer);
    } catch (error) {
      if (error instanceof UploadRejected) throw new BadRequestException(error.reason);
      throw error;
    }

    let observationId: string | null = null;
    if (options.observationId) {
      const observation = await this.repo.findObservationForAttachment(options.observationId);
      // The observation must be about THIS child. Otherwise a valid observation
      // id from elsewhere would attach a photo to someone else's record.
      if (!observation || observation.childId !== childId) {
        throw new BadRequestException("Ажиглалт олдсонгүй");
      }

      const existing = await this.repo.countForObservation(options.observationId);
      if (existing >= MAX_PHOTOS_PER_OBSERVATION) {
        throw new BadRequestException(
          `Нэг ажиглалтад дээд тал нь ${MAX_PHOTOS_PER_OBSERVATION} зураг хавсаргана`,
        );
      }
      observationId = observation.id;
    }

    // ★ Random key. Never derived from the child, the observation or the
    // uploaded filename — the real name lives only in `originalName`, for
    // display, and is never used to build a path.
    const storageKey = this.storage.buildKey(childId);

    await this.storage.put(storageKey, validated.buffer, validated.mimeType);

    // The object exists before the row does. That ordering means a crash
    // between the two leaves an orphaned object — collectable by the sweep —
    // rather than a row pointing at nothing, which would 404 for ever.
    const media = await this.repo.create({
      kindergartenId: facts.childKindergartenId,
      childId,
      observationId,
      purpose: options.purpose ?? (observationId ? "OBSERVATION" : "CHILD_PHOTO"),
      storageKey,
      originalName: sanitiseFilename(file.originalname),
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      width: validated.width,
      height: validated.height,
      caption: options.caption ?? null,
      order: observationId ? await this.repo.countForObservation(observationId) : 0,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId: facts.childKindergartenId,
      actorUserId: actor.userId,
      objectType: "MediaFile",
      objectId: media.id,
      childId,
      metadata: { purpose: media.purpose, sizeBytes: media.sizeBytes },
    });

    return this.toPublicShape(media);
  }

  /**
   * Uploads several photos in one request.
   *
   * ★ The point is the rate limit, not the click count.
   *
   * The browser could already pick a dozen photographs at once — it just sent
   * a dozen requests. At 60 uploads an hour per user, a teacher posting one
   * class-board announcement with twenty photographs spent a third of their
   * day's budget on it and was refused halfway through the next one. One
   * request is one unit.
   *
   * ★ Partial success is reported, not hidden and not rolled back.
   *
   * Each file is validated and stored on its own, so a HEIC in the middle of a
   * selection cannot discard the nine that were fine. Rolling the good ones
   * back would mean deleting objects a teacher watched upload; failing the
   * whole request would mean asking them to find which one was wrong by
   * bisection. The caller gets both lists and can say "10 орлоо, 2 орсонгүй".
   *
   * Sequential rather than parallel: `upload` re-reads the per-observation
   * count each time, and decoding six photographs at once would hold six
   * sharp buffers in a container that also runs Chromium.
   */
  async uploadMany(
    actor: Actor,
    childId: string,
    files: { buffer: Buffer; originalname: string }[],
    options: { purpose?: MediaPurpose; observationId?: string; caption?: string | null } = {},
  ) {
    // Once, before the loop. Every file goes to the same child, so failing the
    // whole request on an unauthorized caller is right — and it means an
    // unauthorized caller cannot use the batch to probe one file at a time.
    await this.childAccess.assertCanRecord(actor, childId);

    const items: Awaited<ReturnType<MediaService["upload"]>>[] = [];
    const failed: { name: string; reason: string }[] = [];

    for (const file of files) {
      try {
        items.push(await this.upload(actor, childId, file, options));
      } catch (error) {
        // A rejection is about this file. Anything else — storage down, the
        // database gone — is about the request, and swallowing it would report
        // "2 орсонгүй" for an outage.
        if (error instanceof BadRequestException) {
          failed.push({
            name: sanitiseFilename(file.originalname),
            reason: describeBadRequest(error),
          });
          continue;
        }
        throw error;
      }
    }

    return { items, failed };
  }

  /**
   * Issues a short-lived download URL.
   *
   * ★ The authorization check runs BEFORE the URL is created — the reference
   * suite tests that ordering explicitly, because a presigned URL is a bearer
   * credential and generating one for an unauthorized caller has already leaked
   * the object even if the response is then discarded.
   */
  async getDownloadUrl(actor: Actor, mediaId: string): Promise<string> {
    const media = await this.repo.findForAuthorization(mediaId);
    if (!media) throw new NotFoundException();
    if (media.status !== "READY") throw new NotFoundException();

    /*
     * ★ Two kinds of media, two authorities.
     *
     * A class-board photo belongs to a notice, not a child, so there is no
     * child to check it against — it is readable exactly when the notice is.
     * `NotificationsService` owns that rule and is asked rather than copied.
     *
     * This branch is why the child guard below is not simply `!media.childId`
     * any more: that test used to stand in for "is this a real file", and a
     * notice photo is a real file with no child.
     */
    if (media.notificationId) {
      const readable = await this.notifications.isReadable(actor, media.notificationId);
      if (!readable) throw new NotFoundException();

      await this.audit.append({
        action: "DOWNLOAD",
        kindergartenId: media.kindergartenId,
        actorUserId: actor.userId,
        objectType: "MediaFile",
        objectId: mediaId,
      });

      return this.storage.presignedGetUrl(media.storageKey, media.originalName);
    }

    if (!media.childId) throw new NotFoundException();

    const facts = await this.childAccess.assertCanAccess(actor, media.childId);

    // A guardian may reach the child, which is not the same as being allowed
    // this particular file: an observation photo inherits its observation's
    // visibility.
    if (isGuardianOf(actor, facts)) {
      const visible = await this.repo.listVisibleForGuardian(media.childId, actor.userId);
      if (!visible.some((m) => m.id === mediaId)) throw new NotFoundException();
    }

    await this.audit.append({
      action: "DOWNLOAD",
      kindergartenId: media.kindergartenId,
      actorUserId: actor.userId,
      objectType: "MediaFile",
      objectId: mediaId,
      childId: media.childId,
    });

    // Never logged: the URL grants access until it expires.
    return this.storage.presignedGetUrl(media.storageKey, media.originalName);
  }

  /** Metadata without a URL — for a gallery that has not been clicked yet. */
  async getMetadata(actor: Actor, mediaId: string) {
    const media = await this.repo.findForAuthorization(mediaId);
    if (!media || !media.childId || media.status !== "READY") throw new NotFoundException();

    const facts = await this.childAccess.assertCanAccess(actor, media.childId);
    if (isGuardianOf(actor, facts)) {
      const visible = await this.repo.listVisibleForGuardian(media.childId, actor.userId);
      if (!visible.some((m) => m.id === mediaId)) throw new NotFoundException();
    }

    return this.toPublicShape(media);
  }

  /** A child's photos, filtered to what this viewer may see. */
  async listForChild(actor: Actor, childId: string, purpose?: MediaPurpose) {
    const facts = await this.childAccess.assertCanAccess(actor, childId);

    const items = isGuardianOf(actor, facts)
      ? await this.repo.listVisibleForGuardian(childId, actor.userId)
      : await this.repo.listForChild(childId, purpose);

    return items;
  }

  /** Archives a photo. Record access — a guardian cannot delete gallery items. */
  async archive(actor: Actor, mediaId: string) {
    const media = await this.repo.findForAuthorization(mediaId);
    if (!media || !media.childId) throw new NotFoundException();

    await this.childAccess.assertCanRecord(actor, media.childId);

    // Soft: the object stays in R2 until the sweep collects it, so an
    // accidental delete is recoverable for the grace period.
    const archived = await this.repo.archive(mediaId);

    await this.audit.append({
      action: "DELETE",
      kindergartenId: media.kindergartenId,
      actorUserId: actor.userId,
      objectType: "MediaFile",
      objectId: mediaId,
      childId: media.childId,
    });

    return { id: archived.id, status: archived.status };
  }

  async setCaption(actor: Actor, mediaId: string, caption: string | null) {
    const media = await this.repo.findForAuthorization(mediaId);
    if (!media || !media.childId) throw new NotFoundException();

    await this.childAccess.assertCanRecord(actor, media.childId);
    const updated = await this.repo.setCaption(mediaId, caption);
    return this.toPublicShape(updated);
  }

  /**
   * Attaches a photo to a class-board announcement.
   *
   * ★ Staff only, and scoped by kindergarten rather than by child.
   *
   * A notice is addressed to a group, so there is no child to run
   * `assertCanRecord` against — the tenant check is what protects it, and the
   * caller must hold a staff membership in the notice's kindergarten. Guardians
   * may like a notice, never illustrate one: posting is a staff act, and an
   * upload endpoint that accepted a parent would be a way around that.
   *
   * The storage key is kindergarten-scoped for the same reason. It stays
   * random — never derived from the notice, the kindergarten name or the
   * uploaded filename.
   */
  async uploadForNotification(
    actor: Actor,
    notificationId: string,
    file: { buffer: Buffer; originalname: string },
    caption?: string | null,
  ) {
    const notification = await this.repo.findNotificationForAttachment(notificationId);
    if (!notification) throw new NotFoundException();
    this.tenants.assertStaff(actor, notification.kindergartenId);

    let validated;
    try {
      validated = await validateImageUpload(file.buffer);
    } catch (error) {
      if (error instanceof UploadRejected) throw new BadRequestException(error.reason);
      throw error;
    }

    const existing = await this.repo.countForNotification(notificationId);
    if (existing >= MAX_PHOTOS_PER_NOTIFICATION) {
      throw new BadRequestException(
        `Нэг мэдэгдэлд дээд тал нь ${MAX_PHOTOS_PER_NOTIFICATION} зураг хавсаргана`,
      );
    }

    const storageKey = this.storage.buildKindergartenKey(
      notification.kindergartenId,
      "notifications",
    );
    await this.storage.put(storageKey, validated.buffer, validated.mimeType);

    const media = await this.repo.create({
      kindergartenId: notification.kindergartenId,
      notificationId,
      purpose: "NOTIFICATION",
      storageKey,
      originalName: sanitiseFilename(file.originalname),
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      width: validated.width,
      height: validated.height,
      caption: caption ?? null,
      order: existing,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId: notification.kindergartenId,
      actorUserId: actor.userId,
      objectType: "MediaFile",
      objectId: media.id,
      metadata: { purpose: media.purpose, sizeBytes: media.sizeBytes, notificationId },
    });

    return this.toPublicShape(media);
  }

  /** Makes an already-uploaded photo the child's profile picture. */
  async setAsChildPhoto(actor: Actor, childId: string, mediaId: string) {
    await this.childAccess.assertCanRecord(actor, childId);

    const media = await this.repo.findForAuthorization(mediaId);
    if (!media || media.childId !== childId || media.status !== "READY") {
      throw new NotFoundException();
    }

    await this.repo.setChildPhoto(childId, mediaId);
    return { childId, photoMediaFileId: mediaId };
  }

  /**
   * Never exposes `storageKey`.
   *
   * The key is not secret in the cryptographic sense — the bucket is private —
   * but publishing it invites a future code path to build a URL from it, and
   * that is the one thing the design forbids.
   */
  private toPublicShape(media: {
    id: string;
    caption?: string | null;
    originalName: string;
    mimeType: string;
    width?: number | null;
    height?: number | null;
    purpose: MediaPurpose;
    observationId?: string | null;
  }) {
    return {
      id: media.id,
      caption: media.caption ?? null,
      originalName: media.originalName,
      mimeType: media.mimeType,
      width: media.width ?? null,
      height: media.height ?? null,
      purpose: media.purpose,
      observationId: media.observationId ?? null,
    };
  }
}

/**
 * The human-readable half of a Nest `BadRequestException`.
 *
 * Its `getResponse()` is a string when the exception was constructed with one
 * and an object when a pipe built it, so reading `.message` off the instance
 * would print "Bad Request Exception" for the very cases a teacher needs to
 * understand.
 */
function describeBadRequest(error: BadRequestException): string {
  const body = error.getResponse();
  if (typeof body === "string") return body;

  const message = (body as { message?: unknown }).message;
  if (typeof message === "string") return message;
  if (Array.isArray(message)) return message.join(", ");

  return "Зургийг хүлээж авсангүй";
}

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { ChatAccessService } from "../authz/chat-access.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import { NotificationsService } from "../notifications/notifications.service";
import { isGuardianOf } from "../authz/child-access";
import type { Actor } from "../authz/actor";
import { StorageService } from "../storage/storage.service";
import { MediaRepository, type MediaFilters } from "./media.repository";
import { sanitiseFilename, UploadRejected, validateImageUpload } from "./upload-validation";
import { paginate, type PageParams } from "../common/pagination";
import { MediaAttribution, type MediaPurpose } from "../domain/enums";
import type { ListMediaQuery, UpdateMediaDto } from "./media.dto";

/** What a caller may set when a photograph is uploaded. */
export interface UploadOptions {
  purpose?: MediaPurpose;
  observationId?: string;
  /** RFP §4.5 — a photograph of a remembered first. */
  milestoneId?: string;
  /** RFP Module 2.1 — "фото зураг хавсаргах" on a safety incident. */
  incidentId?: string;
  caption?: string | null;
  takenAt?: Date | null;
  age?: number | null;
  category?: string | null;
  attribution?: MediaAttribution | null;
}

/** A generous ceiling; the UI shows far fewer per observation. */
const MAX_PHOTOS_PER_OBSERVATION = 12;
const MAX_PHOTOS_PER_NOTIFICATION = 12;
/** RFP §4.5 asks for "Зураг" — one memory does not need a dozen. */
const MAX_PHOTOS_PER_MILESTONE = 6;
/** RFP Module 2.1 — a few photographs of an injury, not an album. */
const MAX_PHOTOS_PER_INCIDENT = 6;

/**
 * Media that belongs to a kindergarten rather than to a child.
 *
 * ★ Rows with these purposes carry no `childId`, so `canAccessChild` has
 * nothing to decide about and membership of the file's own kindergarten is the
 * authority. Adding a purpose here widens who may read it — do not extend this
 * set without reading §7 of docs/SECURITY.md.
 *
 * The routes that write them are `uploadKindergartenLogo`, `uploadUserPhoto`
 * and `uploadGroupPhoto` below.
 */
const TENANT_IMAGE_PURPOSES: ReadonlySet<MediaPurpose> = new Set<MediaPurpose>([
  "KINDERGARTEN_LOGO",
  "USER_PHOTO",
  "GROUP_PHOTO",
  // A dish photo on the weekly menu — readable by anyone in the kindergarten,
  // families included, exactly like the plain menu it illustrates.
  "MENU_DISH",
]);

/**
 * Tenant files only **staff** may read — RFP §9's document library.
 *
 * ★ A separate set from the images above, and the difference is the check.
 *
 * A logo is readable by anyone in the kindergarten, families included: it is on
 * the letterhead of every report they receive. §9 opens with "Багшид зориулсан
 * PDF баримт бичгийн сан" — a library *for teachers*, holding curricula,
 * methodology and regulations. Folding it into `TENANT_IMAGE_PURPOSES` would
 * widen `assertMember` over material no family was meant to open, which is the
 * quietest way this endpoint could leak.
 */
const STAFF_ONLY_TENANT_PURPOSES: ReadonlySet<MediaPurpose> = new Set<MediaPurpose>([
  "DOCUMENT",
  "DOCUMENT_COVER",
]);

@Injectable()
export class MediaService {
  constructor(
    private readonly repo: MediaRepository,
    private readonly storage: StorageService,
    private readonly childAccess: ChildAccessService,
    private readonly tenants: TenantAccessService,
    /*
     * ★ The room authority, for `CHAT_MESSAGE` photographs. It lives in the
     * `@Global` `AuthzModule`, so this needs no import wiring — §1.1's rule
     * that authorization lives in exactly one module is what makes asking it
     * cheaper than copying it.
     */
    private readonly chatAccess: ChatAccessService,
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
    options: UploadOptions = {},
  ) {
    // ★ Staff, or one of this child's own guardians — RFP §2.3 gives a family
    // the album in as many words. See `canContributeMediaForChild` for why this
    // is wider than every other write about a child.
    const facts = await this.childAccess.assertCanContributeMedia(actor, childId);
    const isGuardian = isGuardianOf(actor, facts);

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

      /*
       * ★ A guardian may illustrate only their OWN note.
       *
       * Uploading to the album is theirs by right; a teacher's observation is
       * not. Without this a family could attach a photograph to a private
       * teaching note — the note stays hidden from them while a picture they
       * chose sits inside it, and it would surface in the teacher's report.
       *
       * The same message as "not found", because which observation exists is
       * not a family's business either.
       */
      if (
        isGuardian &&
        !(observation.source === "PARENT" && observation.authorId === actor.userId)
      ) {
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

    let milestoneId: string | null = null;
    if (options.milestoneId) {
      const milestone = await this.repo.findMilestoneForAttachment(options.milestoneId);
      // Must be about THIS child, for the same reason the observation branch
      // checks: a valid id from elsewhere would attach a photograph to another
      // family's record.
      if (!milestone || milestone.childId !== childId) {
        throw new BadRequestException("Онцгой үйл явдал олдсонгүй");
      }

      /*
       * ★ No author check here, unlike an observation, and the asymmetry is the
       * point.
       *
       * A teacher's observation is a professional record a family may not
       * illustrate. A milestone is the family's own memory: either guardian may
       * add a photograph to "анхны алхам" whoever typed the date, and a teacher
       * who was there may too. `assertCanContributeMedia` above has already
       * established that this person belongs to this child.
       */
      const existing = await this.repo.countForMilestone(options.milestoneId);
      if (existing >= MAX_PHOTOS_PER_MILESTONE) {
        throw new BadRequestException(
          `Нэг үйл явдалд дээд тал нь ${MAX_PHOTOS_PER_MILESTONE} зураг хавсаргана`,
        );
      }
      milestoneId = milestone.id;
    }

    let incidentId: string | null = null;
    if (options.incidentId) {
      const incident = await this.repo.findIncidentForAttachment(options.incidentId);
      if (!incident || incident.childId !== childId) {
        throw new BadRequestException("Тохиолдол олдсонгүй");
      }

      /*
       * ★ Staff only, unlike a milestone photograph.
       *
       * An incident is the kindergarten's account of what happened, and its
       * photographs are evidence of an injury. A family may read them; adding
       * to them is not theirs, for the same reason they may not write the
       * record itself.
       */
      if (isGuardian) throw new BadRequestException("Тохиолдол олдсонгүй");

      const existing = await this.repo.countForIncident(options.incidentId);
      if (existing >= MAX_PHOTOS_PER_INCIDENT) {
        throw new BadRequestException(
          `Нэг тохиолдолд дээд тал нь ${MAX_PHOTOS_PER_INCIDENT} зураг хавсаргана`,
        );
      }
      incidentId = incident.id;
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
      milestoneId,
      incidentId,
      purpose:
        options.purpose ??
        (incidentId
          ? "INCIDENT"
          : milestoneId
            ? "MILESTONE"
            : observationId
              ? "OBSERVATION"
              : "CHILD_PHOTO"),
      storageKey,
      originalName: sanitiseFilename(file.originalname),
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      width: validated.width,
      height: validated.height,
      caption: options.caption ?? null,
      order: observationId
        ? await this.repo.countForObservation(observationId)
        : milestoneId
          ? await this.repo.countForMilestone(milestoneId)
          : incidentId
            ? await this.repo.countForIncident(incidentId)
            : 0,
      // ★ Who sent the bytes. Recorded from the authenticated actor, never from
      // the request body — a client-supplied uploader is an attribution anyone
      // could forge.
      uploadedById: actor.userId,
      takenAt: options.takenAt ?? null,
      age: options.age ?? null,
      category: options.category ?? null,
      // RFP §4.4 "багшийн, эцэг эхийн эсвэл хамтын".
      //
      // ★ Defaulted from the relationship to THIS child, not from a role: a
      // teacher whose own child attends the same kindergarten uploads as a
      // parent for their own child and as a teacher for everyone else's —
      // the same rule `editableAgeProfileFields` applies to the two notes.
      // `JOINT`, and the family photograph a teacher was handed, are set
      // explicitly.
      attribution:
        options.attribution ?? (isGuardian ? MediaAttribution.PARENT : MediaAttribution.TEACHER),
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
    options: UploadOptions = {},
  ) {
    // Once, before the loop. Every file goes to the same child, so failing the
    // whole request on an unauthorized caller is right — and it means an
    // unauthorized caller cannot use the batch to probe one file at a time.
    await this.childAccess.assertCanContributeMedia(actor, childId);

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
  async getDownloadUrl(actor: Actor, mediaId: string, forceDownload = false): Promise<string> {
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

    /*
     * ★★ A chat photograph — authorised by the ROOM, never by the tenant.
     *
     * This branch exists because the obvious shortcut is a leak. Putting
     * `CHAT_MESSAGE` in `TENANT_IMAGE_PURPOSES` below would make it readable by
     * anyone holding a membership in the kindergarten — and a guardian whose
     * child is in group A holds one. They would be able to read a photograph
     * posted in group B's room, of somebody else's children.
     *
     * So the authority is `ChatAccessService`, the same one that decides
     * whether the message may be read, answering the same 404 (§1.7). One
     * question, one place (§1.1).
     */
    if (media.purpose === "CHAT_MESSAGE") {
      // A photograph whose message was deleted, or which never had one, is not
      // readable: there is no room to ask about.
      if (!media.chatMessage || media.chatMessage.deletedAt) throw new NotFoundException();

      // Throws 404 for a room the actor is not in.
      await this.chatAccess.assertMember(actor, media.chatMessage.roomKey);

      await this.audit.append({
        action: "DOWNLOAD",
        kindergartenId: media.kindergartenId,
        actorUserId: actor.userId,
        objectType: "MediaFile",
        objectId: mediaId,
      });

      return this.storage.presignedGetUrl(media.storageKey, media.originalName);
    }

    /*
     * ★ Tenant images — a kindergarten's logo, a teacher's portrait, a group's
     * class photo.
     *
     * These have no `childId` either, and unlike an observation photo they are
     * not child data at all: a logo appears in the letterhead of every report a
     * family receives. Membership is therefore the whole check, and it is
     * membership of the file's OWN kindergarten — read from the row, never from
     * the request.
     *
     * They still go through this endpoint rather than a public URL. CLAUDE.md
     * §1.4 admits no exception for "harmless" files, and a bucket that is
     * private except for one prefix is a bucket somebody will widen.
     */
    if (STAFF_ONLY_TENANT_PURPOSES.has(media.purpose)) {
      this.tenants.assertStaff(actor, media.kindergartenId);

      await this.audit.append({
        action: "DOWNLOAD",
        kindergartenId: media.kindergartenId,
        actorUserId: actor.userId,
        objectType: "MediaFile",
        objectId: mediaId,
      });

      return this.storage.presignedGetUrl(media.storageKey, media.originalName);
    }

    if (TENANT_IMAGE_PURPOSES.has(media.purpose)) {
      this.tenants.assertMember(actor, media.kindergartenId);

      await this.audit.append({
        action: "DOWNLOAD",
        kindergartenId: media.kindergartenId,
        actorUserId: actor.userId,
        objectType: "MediaFile",
        objectId: mediaId,
      });

      return this.storage.presignedGetUrl(media.storageKey, media.originalName);
    }

    /*
     * A doctor's note belongs to the child's attendance record, not to their
     * gallery. Everyone who may read that child's attendance may open it; the
     * separate purpose keeps the file out of the photo list and avoids treating
     * a PDF as an image.
     */
    if (media.purpose === "ATTENDANCE_ATTACHMENT") {
      if (!media.childId) throw new NotFoundException();
      await this.childAccess.assertCanAccess(actor, media.childId);

      await this.audit.append({
        action: "DOWNLOAD",
        kindergartenId: media.kindergartenId,
        actorUserId: actor.userId,
        objectType: "MediaFile",
        objectId: mediaId,
        childId: media.childId,
      });

      return this.storage.presignedGetUrl(media.storageKey, media.originalName);
    }

    if (!media.childId) throw new NotFoundException();

    const facts = await this.childAccess.assertCanAccess(actor, media.childId);

    // A guardian may reach the child, which is not the same as being allowed
    // this particular file: an observation photo inherits its observation's
    // visibility.
    if (isGuardianOf(actor, facts)) {
      const visible = await this.repo.isVisibleToGuardian(media.childId, mediaId, actor.userId);
      if (!visible) throw new NotFoundException();
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
    return this.storage.presignedGetUrl(
      media.storageKey,
      media.originalName,
      forceDownload ? "attachment" : "inline",
    );
  }

  /** Metadata without a URL — for a gallery that has not been clicked yet. */
  async getMetadata(actor: Actor, mediaId: string) {
    const media = await this.repo.findForAuthorization(mediaId);
    if (!media || !media.childId || media.status !== "READY") throw new NotFoundException();

    const facts = await this.childAccess.assertCanAccess(actor, media.childId);
    if (isGuardianOf(actor, facts)) {
      const visible = await this.repo.isVisibleToGuardian(media.childId, mediaId, actor.userId);
      if (!visible) throw new NotFoundException();
    }

    return this.toPublicShape(media);
  }

  /**
   * A child's photos, filtered to what this viewer may see — paginated.
   *
   * ★ The guardian branch and the per-file check in `getDownloadUrl` compose
   * the same `where` fragment in the repository. They used to be one method
   * returning a list, which the download path searched in memory; paginating
   * that would have made a guardian 404 on photo twenty-six of their own child
   * while the gallery happily showed it on page two.
   */
  async listForChild(actor: Actor, childId: string, query: ListMediaQuery) {
    const facts = await this.childAccess.assertCanAccess(actor, childId);

    const filters: MediaFilters = {
      purpose: query.purpose,
      observationId: query.observationId,
      category: query.category,
      age: query.age,
      attribution: query.attribution,
    };
    const page: PageParams = { page: query.page, pageSize: query.pageSize };

    const { items, total } = isGuardianOf(actor, facts)
      ? await this.repo.listVisibleForGuardian(childId, actor.userId, filters, page)
      : await this.repo.listForChild(childId, filters, page);

    return paginate(items, total, page);
  }

  /** Twelve category totals and their first thumbnails for one age. */
  async ageAlbumSummary(actor: Actor, childId: string, age: number) {
    const facts = await this.childAccess.assertCanAccess(actor, childId);
    return isGuardianOf(actor, facts)
      ? this.repo.ageAlbumSummaryForGuardian(childId, actor.userId, age)
      : this.repo.ageAlbumSummaryForStaff(childId, age);
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

  /**
   * Caption and album metadata — RFP §4.4.
   *
   * ★ Staff may edit any photograph of a child they record for. A guardian may
   * edit **only the ones they uploaded themselves.**
   *
   * A photograph you can add but never title is half a feature — §4.4 lists the
   * title, the date taken and the category as album capabilities, and a family
   * that may create an album must be able to fill those in. Letting them edit a
   * teacher's photograph would be a different thing entirely, so the test is
   * authorship, not role.
   */
  async updateMetadata(actor: Actor, mediaId: string, dto: UpdateMediaDto) {
    const media = await this.repo.findForAuthorization(mediaId);
    if (!media || !media.childId) throw new NotFoundException();

    const facts = await this.childAccess.assertCanContributeMedia(actor, media.childId);
    if (isGuardianOf(actor, facts) && media.uploadedById !== actor.userId) {
      throw new NotFoundException();
    }

    const updated = await this.repo.updateMetadata(mediaId, dto);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: media.kindergartenId,
      actorUserId: actor.userId,
      objectType: "MediaFile",
      objectId: mediaId,
      childId: media.childId,
      metadata: { fields: Object.keys(dto) },
    });

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

  /**
   * A photograph of a dish on the weekly menu — Хоол үйлдвэрлэл.
   *
   * ★ Kindergarten-scoped, like a class photo — not tied to a `MenuDay` row or
   * a specific dish.
   *
   * `MenuDay.dishes` is a JSON array with no per-dish row to attach a foreign
   * key to (`dish-json.ts`), and a day may not even exist yet the first time a
   * cook picks a photo for it. So this creates a standalone `MediaFile` and
   * hands its id back; the client stores that id on the dish it is building
   * and it is only persisted once `MealsService.saveDay` writes the day —
   * which is also where the id gets checked against `isMenuDishPhoto` below,
   * so a client cannot claim an arbitrary media id as a dish's photo.
   *
   * Same access as editing the menu itself (`assertCanManageMeals`): a
   * teacher plates what the cook planned and may want to swap the picture.
   */
  async uploadForMenuDish(
    actor: Actor,
    kindergartenId: string,
    file: { buffer: Buffer; originalname: string },
  ) {
    this.tenants.assertCanManageMeals(actor, kindergartenId);

    let validated;
    try {
      validated = await validateImageUpload(file.buffer);
    } catch (error) {
      if (error instanceof UploadRejected) throw new BadRequestException(error.reason);
      throw error;
    }

    const storageKey = this.storage.buildKindergartenKey(kindergartenId, "menu-dishes");
    await this.storage.put(storageKey, validated.buffer, validated.mimeType);

    const media = await this.repo.create({
      kindergartenId,
      purpose: "MENU_DISH",
      storageKey,
      originalName: sanitiseFilename(file.originalname),
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      width: validated.width,
      height: validated.height,
      uploadedById: actor.userId,
      caption: null,
      order: 0,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "MediaFile",
      objectId: media.id,
      metadata: { purpose: media.purpose, sizeBytes: media.sizeBytes },
    });

    return this.toPublicShape(media);
  }

  /**
   * Whether `mediaId` is a real, ready `MENU_DISH` photo belonging to this
   * kindergarten — `MealsService.saveDay` calls this for every dish carrying
   * a `photoMediaFileId` before it is written, so a menu cannot be made to
   * point at a file the client merely guessed the id of (a private child
   * photo, another kindergarten's upload) — the id must have come from this
   * kindergarten's own `uploadForMenuDish` call.
   */
  async isMenuDishPhoto(kindergartenId: string, mediaId: string): Promise<boolean> {
    const media = await this.repo.findForAuthorization(mediaId);
    return Boolean(
      media &&
      media.kindergartenId === kindergartenId &&
      media.purpose === "MENU_DISH" &&
      media.status === "READY",
    );
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

  /** Selects any visible photo from the requested age as that age album's cover. */
  async setAgeAlbumCover(actor: Actor, childId: string, age: number, mediaId: string) {
    const facts = await this.childAccess.assertCanContributeMedia(actor, childId);
    const media = await this.repo.findForAuthorization(mediaId);
    if (!media || media.childId !== childId || media.status !== "READY" || media.age !== age) {
      throw new NotFoundException();
    }

    if (isGuardianOf(actor, facts)) {
      const visible = await this.repo.isVisibleToGuardian(childId, mediaId, actor.userId);
      if (!visible) throw new NotFoundException();
    }

    await this.repo.setAgeAlbumCover(childId, age, mediaId);
    await this.audit.append({
      action: "UPDATE",
      kindergartenId: media.kindergartenId,
      actorUserId: actor.userId,
      objectType: "MediaFile",
      objectId: mediaId,
      childId,
      metadata: { albumCoverAge: age },
    });
    return { age, coverMediaFileId: mediaId };
  }

  // ── Tenant images — RFP §3.2 (лого, ангийн зураг), §3.3 (профайл зураг) ────

  /**
   * The kindergarten's logo. RFP §3.2, and §10.3 wants it on every PDF.
   *
   * Administrator only. A logo is the kindergarten's identity on every report
   * it issues, which is a different thing from a class photo a teacher takes.
   */
  async uploadKindergartenLogo(
    actor: Actor,
    kindergartenId: string,
    file: { buffer: Buffer; originalname: string },
  ) {
    this.tenants.assertAdmin(actor, kindergartenId);

    const kindergarten = await this.repo.findKindergartenForImage(kindergartenId);
    if (!kindergarten) throw new NotFoundException();

    return this.storeTenantImage(actor, {
      owner: "kindergarten",
      ownerId: kindergartenId,
      kindergartenId,
      purpose: "KINDERGARTEN_LOGO",
      prefix: "logos",
      file,
    });
  }

  /**
   * A staff portrait — RFP §3.3.
   *
   * ★ Own account only, whatever the role.
   *
   * An administrator may create and deactivate users, but replacing somebody's
   * face is not administration, and the RFP puts the profile photo under "Багш
   * дараах боломжуудтай: өөрийн профайлыг харах, засах". Letting an admin write
   * it would also make the picture unattributable — a portrait would no longer
   * be evidence that the person themselves put it there.
   *
   * The file is scoped to one of the account's kindergartens because
   * `MediaFile` has exactly one tenant. An account with no active membership
   * has no tenant to store it under and gets a 404.
   */
  async uploadUserPhoto(
    actor: Actor,
    userId: string,
    file: { buffer: Buffer; originalname: string },
  ) {
    if (userId !== actor.userId) throw new NotFoundException();

    const memberships = await this.repo.findUserMembershipKindergartens(userId);
    const first = memberships[0];
    if (!first) throw new NotFoundException();

    return this.storeTenantImage(actor, {
      owner: "user",
      ownerId: userId,
      kindergartenId: first.kindergartenId,
      purpose: "USER_PHOTO",
      prefix: "portraits",
      file,
    });
  }

  /** The class photo — RFP §3.2 "ангийн зураг". Teachers and admins. */
  async uploadGroupPhoto(
    actor: Actor,
    groupId: string,
    file: { buffer: Buffer; originalname: string },
  ) {
    const group = await this.repo.findGroupForImage(groupId);
    if (!group) throw new NotFoundException();
    this.tenants.assertStaff(actor, group.kindergartenId);

    return this.storeTenantImage(actor, {
      owner: "group",
      ownerId: groupId,
      kindergartenId: group.kindergartenId,
      purpose: "GROUP_PHOTO",
      prefix: "groups",
      file,
    });
  }

  /**
   * Validate, store, attach — the half the three routes above share.
   *
   * Authorization is deliberately *not* here. Each caller decides it first,
   * because the three answers genuinely differ (admin, self, staff) and a
   * single method taking a "who may do this" parameter is how one of them
   * quietly becomes wrong.
   */
  private async storeTenantImage(
    actor: Actor,
    input: {
      owner: "kindergarten" | "user" | "group";
      ownerId: string;
      kindergartenId: string;
      purpose: MediaPurpose;
      prefix: string;
      file: { buffer: Buffer; originalname: string };
    },
  ) {
    let validated;
    try {
      validated = await validateImageUpload(input.file.buffer);
    } catch (error) {
      if (error instanceof UploadRejected) throw new BadRequestException(error.reason);
      throw error;
    }

    const storageKey = this.storage.buildKindergartenKey(input.kindergartenId, input.prefix);
    await this.storage.put(storageKey, validated.buffer, validated.mimeType);

    const { media, previousId } = await this.repo.attachTenantImage({
      owner: input.owner,
      ownerId: input.ownerId,
      kindergartenId: input.kindergartenId,
      purpose: input.purpose,
      storageKey,
      originalName: sanitiseFilename(input.file.originalname),
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      width: validated.width,
      height: validated.height,
      uploadedById: actor.userId,
    });

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: input.kindergartenId,
      actorUserId: actor.userId,
      objectType: "MediaFile",
      objectId: media.id,
      metadata: {
        purpose: media.purpose,
        sizeBytes: media.sizeBytes,
        owner: input.owner,
        ownerId: input.ownerId,
        // The row this one displaced, so "where did the old logo go" has an
        // answer that outlives the soft-deleted record.
        replacedMediaFileId: previousId,
      },
    });

    return this.toPublicShape(media);
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
    // Album metadata — RFP §4.4. Optional in the parameter because some callers
    // load only what authorization needs, and one response shape that sometimes
    // omits a field is better than two shapes that drift.
    takenAt?: Date | null;
    age?: number | null;
    category?: string | null;
    albumCoverAge?: number | null;
    attribution?: MediaAttribution | null;
    uploadedBy?: { id: string; lastName: string; firstName: string } | null;
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
      takenAt: media.takenAt ?? null,
      age: media.age ?? null,
      category: media.category ?? null,
      albumCoverAge: media.albumCoverAge ?? null,
      attribution: media.attribution ?? null,
      uploadedBy: media.uploadedBy ?? null,
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

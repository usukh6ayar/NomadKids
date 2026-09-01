import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Redirect,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { idParamSchema } from "@kinder/contracts";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { RateLimit, RateLimitGuard } from "../common/rate-limit/rate-limit.guard";
import { UseGuards } from "@nestjs/common";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import type { Actor } from "../authz/actor";
import { Roles } from "../auth/decorators/roles.decorator";
import { MediaService } from "./media.service";
import {
  listMediaQuerySchema,
  updateMediaSchema,
  uploadMetadataSchema,
  type ListMediaQuery,
  type UpdateMediaDto,
} from "./media.dto";
import { MAX_UPLOAD_BYTES } from "./upload-validation";

/**
 * Files one request may carry.
 *
 * Six, not twelve. Multer buffers every file in memory before the handler
 * runs, so this number multiplied by MAX_UPLOAD_BYTES is the worst case a
 * single request can hold — 60 MB here, in a container that also runs
 * Chromium for the report worker. A full twelve-photo observation is two
 * requests instead of twelve, which is already the whole point.
 */
const MAX_FILES_PER_UPLOAD = 6;

const uploadOptionsSchema = uploadMetadataSchema
  .extend({
    observationId: z.uuid().optional(),
    milestoneId: z.uuid().optional(),
    incidentId: z.uuid().optional(),
    purpose: z.enum(["CHILD_PHOTO", "OBSERVATION", "MILESTONE", "INCIDENT"]).optional(),
  })
  .refine(
    (body) => [body.observationId, body.milestoneId, body.incidentId].filter(Boolean).length <= 1,
    {
      // A photograph belongs to one thing. Accepting both would silently pick
      // whichever branch the service checked first.
      message: "Зургийг зөвхөн нэг зүйлд хавсаргана",
      path: ["milestoneId"],
    },
  );
type UploadOptionsDto = z.infer<typeof uploadOptionsSchema>;

@Controller("children/:id/media")
@UseGuards(RateLimitGuard)
export class ChildMediaController {
  constructor(private readonly service: MediaService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listMediaQuerySchema)) query: ListMediaQuery,
  ) {
    return this.service.listForChild(actor, params.id, query);
  }

  /**
   * Uploads a photo.
   *
   * `memoryStorage` with a hard byte limit: the file has to be in memory to be
   * sniffed and re-encoded anyway, and writing it to disk first would mean an
   * unvalidated file briefly living on the server's filesystem.
   *
   * Rate-limited per user — an upload is the most expensive request this API
   * serves, and the limit is what stops one client filling the bucket.
   */
  @Post()
  @RateLimit({ limit: 60, windowMs: 60 * 60 * 1000, byUser: true })
  @UseInterceptors(
    FilesInterceptor("file", MAX_FILES_PER_UPLOAD, {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_FILES_PER_UPLOAD },
    }),
  )
  async upload(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @UploadedFiles() files: { buffer: Buffer; originalname: string }[] | undefined,
    @Body(new ZodValidationPipe(uploadOptionsSchema)) body: UploadOptionsDto,
  ) {
    if (!files?.length) throw new BadRequestException("Файл хавсаргаагүй байна");

    const result = await this.service.uploadMany(actor, params.id, files, {
      observationId: body.observationId,
      milestoneId: body.milestoneId,
      incidentId: body.incidentId,
      caption: body.caption ?? null,
      purpose: body.purpose,
      // ★ Forwarded, not dropped. The schema accepted these before this line
      // did, which meant a client could send `takenAt` on an upload, get a 201,
      // and find the field empty — validation that silently discards what it
      // just approved is worse than not accepting it at all.
      takenAt: body.takenAt ?? null,
      age: body.age ?? null,
      category: body.category ?? null,
      attribution: body.attribution ?? null,
    });

    /*
     * ★ Nothing stored means the request failed.
     *
     * Partial success is a 201 carrying both lists — nine photographs really
     * were stored and the tenth really was not. But a batch where every file
     * was refused is not a success with footnotes, and answering 201 for it
     * would mean a renamed executable, or a HEIC, came back as "created".
     * The first reason is the message; the rest are in the body.
     */
    if (result.items.length === 0) {
      throw new BadRequestException(result.failed[0]?.reason ?? "Зургийг хүлээж авсангүй");
    }

    return result;
  }

  /** Makes an existing photo the child's profile picture. */
  @Post("profile-photo")
  async setProfilePhoto(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(z.object({ mediaId: z.uuid() }))) body: { mediaId: string },
  ) {
    return this.service.setAsChildPhoto(actor, params.id, body.mediaId);
  }
}

/**
 * Photos on a class-board announcement.
 *
 * Separate controller because the scope is different: child media is authorised
 * per child, this is authorised per kindergarten, and folding them together
 * would mean one method with two authorization paths — the shape mistake
 * CLAUDE.md §1.1 exists to prevent.
 */
@Controller("notifications/:id/media")
@UseGuards(RateLimitGuard)
export class NotificationMediaController {
  constructor(private readonly service: MediaService) {}

  @Post()
  @Roles("TEACHER", "ADMIN")
  @RateLimit({ limit: 60, windowMs: 60 * 60 * 1000, byUser: true })
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  async upload(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
    @Body(new ZodValidationPipe(z.object({ caption: z.string().max(500).optional() })))
    body: { caption?: string },
  ) {
    if (!file) throw new BadRequestException("Файл хавсаргаагүй байна");

    return this.service.uploadForNotification(actor, params.id, file, body.caption ?? null);
  }
}

/**
 * Images that belong to a kindergarten rather than to a child — RFP §3.2's
 * лого and ангийн зураг, and §3.3's профайл зураг.
 *
 * ★ Three routes on three paths, not one `POST /images?owner=…`.
 *
 * They authorize differently — the logo is an administrator's, the portrait is
 * the account holder's own, the class photo is any staff member's — and the
 * parameterised version would put those three decisions inside one method
 * behind a switch, which is exactly the shape CLAUDE.md §1.1 exists to prevent.
 * The paths also read as what they are in a route list.
 */
@Controller()
@UseGuards(RateLimitGuard)
export class TenantImageController {
  constructor(private readonly service: MediaService) {}

  @Post("kindergartens/:id/logo")
  @Roles("ADMIN")
  @RateLimit({ limit: 20, windowMs: 60 * 60 * 1000, byUser: true })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async uploadLogo(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
  ) {
    if (!file) throw new BadRequestException("Файл хавсаргаагүй байна");
    return this.service.uploadKindergartenLogo(actor, params.id, file);
  }

  /*
   * No `@Roles`: a guardian has a profile too, and the service refuses any
   * `userId` that is not the caller's own. A role guard here would be the
   * wrong check in the right place — see `uploadUserPhoto`.
   */
  @Post("users/:id/photo")
  @RateLimit({ limit: 20, windowMs: 60 * 60 * 1000, byUser: true })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async uploadUserPhoto(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
  ) {
    if (!file) throw new BadRequestException("Файл хавсаргаагүй байна");
    return this.service.uploadUserPhoto(actor, params.id, file);
  }

  @Post("groups/:id/photo")
  @Roles("TEACHER", "ADMIN")
  @RateLimit({ limit: 20, windowMs: 60 * 60 * 1000, byUser: true })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async uploadGroupPhoto(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
  ) {
    if (!file) throw new BadRequestException("Файл хавсаргаагүй байна");
    return this.service.uploadGroupPhoto(actor, params.id, file);
  }
}

/**
 * A dish's photo on the weekly menu — Хоол үйлдвэрлэл.
 *
 * ★ Kindergarten-scoped, not day- or dish-scoped — `MenuDay.dishes` has no
 * row of its own for a photo to attach to (see `MediaService.uploadForMenuDish`).
 * The route still lives under `kindergartens/:id/menu` rather than a bare
 * `POST media?purpose=MENU_DISH`, so it reads as what it is in a route list —
 * the same reasoning `TenantImageController`'s three routes follow.
 */
@Controller("kindergartens/:id/menu/dish-photo")
@UseGuards(RateLimitGuard)
export class MenuDishMediaController {
  constructor(private readonly service: MediaService) {}

  @Post()
  @Roles("TEACHER", "ADMIN", "COOK")
  @RateLimit({ limit: 60, windowMs: 60 * 60 * 1000, byUser: true })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async upload(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
  ) {
    if (!file) throw new BadRequestException("Файл хавсаргаагүй байна");
    return this.service.uploadForMenuDish(actor, params.id, file);
  }
}

@Controller("media")
export class MediaController {
  constructor(private readonly service: MediaService) {}

  /**
   * Redirects to a short-lived presigned URL.
   *
   * ★ A 302 rather than returning the URL in JSON. The browser follows it
   * immediately, so the credential spends less time in client memory, never
   * reaches a template, and cannot be copied out of a devtools response by
   * someone looking over a shoulder. The permission check runs first — the
   * reference suite tests that ordering by name.
   */
  @Get(":id")
  @Redirect()
  async download(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    const url = await this.service.getDownloadUrl(actor, params.id);
    return { url, statusCode: 302 };
  }

  /** Metadata only — no URL, so a gallery can render without issuing credentials. */
  @Get(":id/meta")
  async meta(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.getMetadata(actor, params.id);
  }

  /** Caption and album metadata — RFP §4.4. */
  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateMediaSchema)) body: UpdateMediaDto,
  ) {
    return this.service.updateMetadata(actor, params.id, body);
  }

  @Delete(":id")
  async archive(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.archive(actor, params.id);
  }
}

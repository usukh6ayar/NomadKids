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

const uploadOptionsSchema = z.object({
  observationId: z.uuid().optional(),
  caption: z.string().max(255).optional(),
  purpose: z.enum(["CHILD_PHOTO", "OBSERVATION"]).optional(),
});

const captionSchema = z.object({ caption: z.string().max(255).nullable() });
const listQuerySchema = z.object({
  purpose: z.enum(["CHILD_PHOTO", "OBSERVATION", "REPORT_OUTPUT"]).optional(),
});

@Controller("children/:id/media")
@UseGuards(RateLimitGuard)
export class ChildMediaController {
  constructor(private readonly service: MediaService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listQuerySchema))
    query: { purpose?: "CHILD_PHOTO" | "OBSERVATION" | "REPORT_OUTPUT" },
  ) {
    return this.service.listForChild(actor, params.id, query.purpose);
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
    @Body(new ZodValidationPipe(uploadOptionsSchema))
    body: { observationId?: string; caption?: string; purpose?: "CHILD_PHOTO" | "OBSERVATION" },
  ) {
    if (!files?.length) throw new BadRequestException("Файл хавсаргаагүй байна");

    const result = await this.service.uploadMany(actor, params.id, files, {
      observationId: body.observationId,
      caption: body.caption ?? null,
      purpose: body.purpose,
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

  @Patch(":id")
  async setCaption(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(captionSchema)) body: { caption: string | null },
  ) {
    return this.service.setCaption(actor, params.id, body.caption);
  }

  @Delete(":id")
  async archive(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.archive(actor, params.id);
  }
}

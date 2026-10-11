import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Redirect,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import {
  schoolMonthKeySchema,
  songPoemFormSchema,
  songPoemMonthInputSchema,
  uuidSchema,
  type SongPoemForm,
  type SongPoemMonthInput,
} from "@kinder/contracts";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { RateLimit, RateLimitGuard } from "../common/rate-limit/rate-limit.guard";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { MAX_ATTACHMENT_BYTES } from "./song-poem-file";
import { SongsPoemsService, type UploadedPart } from "./songs-poems.service";

const HOUR = 60 * 60 * 1000;

const groupParams = z.object({ groupId: uuidSchema });
const itemParams = z.object({ groupId: uuidSchema, id: uuidSchema });
const monthParams = z.object({ groupId: uuidSchema, month: schoolMonthKeySchema });
const childParams = z.object({ childId: uuidSchema });
const objectParams = z.object({ id: uuidSchema });

type UploadFields = { cover?: UploadedPart[]; file?: UploadedPart[] };

const UPLOAD = FileFieldsInterceptor(
  [
    { name: "cover", maxCount: 1 },
    { name: "file", maxCount: 1 },
  ],
  { limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 2 } },
);

/** A group's library. The director reads; writing is the group teacher's. */
@Controller("groups/:groupId/songs-poems")
@UseGuards(RateLimitGuard)
export class GroupSongsPoemsController {
  constructor(private readonly service: SongsPoemsService) {}

  @Get()
  @Roles("TEACHER", "ADMIN")
  async read(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(groupParams)) params: { groupId: string },
  ) {
    return this.service.forGroup(actor, params.groupId);
  }

  @Put("months/:month")
  @Roles("TEACHER")
  async saveMonth(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(monthParams)) params: { groupId: string; month: string },
    @Body(new ZodValidationPipe(songPoemMonthInputSchema)) body: SongPoemMonthInput,
  ) {
    return this.service.saveMonth(actor, params.groupId, params.month, body);
  }

  @Post()
  @Roles("TEACHER")
  @RateLimit({ limit: 120, windowMs: HOUR, byUser: true })
  @UseInterceptors(UPLOAD)
  async create(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(groupParams)) params: { groupId: string },
    @UploadedFiles() files: UploadFields | undefined,
    @Body(new ZodValidationPipe(songPoemFormSchema)) body: SongPoemForm,
  ) {
    return this.service.create(actor, params.groupId, body, files?.cover?.[0], files?.file?.[0]);
  }

  @Put(":id")
  @Roles("TEACHER")
  @RateLimit({ limit: 120, windowMs: HOUR, byUser: true })
  @UseInterceptors(UPLOAD)
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(itemParams)) params: { groupId: string; id: string },
    @UploadedFiles() files: UploadFields | undefined,
    @Body(new ZodValidationPipe(songPoemFormSchema)) body: SongPoemForm,
  ) {
    return this.service.update(
      actor,
      params.groupId,
      params.id,
      body,
      files?.cover?.[0],
      files?.file?.[0],
    );
  }

  @Delete(":id")
  @Roles("TEACHER")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(itemParams)) params: { groupId: string; id: string },
  ) {
    await this.service.remove(actor, params.groupId, params.id);
  }
}

/** The library of a child's group, as the family reads it. */
@Controller("children/:childId/songs-poems")
export class ChildSongsPoemsController {
  constructor(private readonly service: SongsPoemsService) {}

  @Get()
  @Roles("PARENT", "TEACHER", "ADMIN")
  async read(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(childParams)) params: { childId: string },
  ) {
    return this.service.forChild(actor, params.childId);
  }
}

/** A cover or an attachment: a 302 to a five-minute presigned URL, after the check. */
@Controller("songs-poems/:id")
export class SongPoemObjectsController {
  constructor(private readonly service: SongsPoemsService) {}

  @Get("cover")
  @Roles("PARENT", "TEACHER", "ADMIN")
  @Redirect()
  async cover(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(objectParams)) params: { id: string },
  ) {
    return { url: await this.service.objectUrl(actor, params.id, "cover"), statusCode: 302 };
  }

  @Get("file")
  @Roles("PARENT", "TEACHER", "ADMIN")
  @Redirect()
  async file(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(objectParams)) params: { id: string },
  ) {
    return { url: await this.service.objectUrl(actor, params.id, "file"), statusCode: 302 };
  }
}
